'use strict';
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createFakeDrive } = require('../tools/rig/fakeDrive.js');
const { createRemote, keyToName, nameToKey } = require('../electron/syncRemote.js');

const sha = b => crypto.createHash('sha256').update(b).digest('hex');

describe('the Drive remote', () => {
  const drive = createFakeDrive();
  let remote;
  before(async () => {
    await drive.start();
    remote = createRemote({ clientId: 'c', clientSecret: 's', apiBase: drive.url }, { retryMs: 5 });
  });
  after(() => drive.stop());
  beforeEach(() => { drive.pageSize = 0; drive.quotaFull = false; drive.cutNext = null; });

  test('a record goes up under its machine, and the listing names it', async () => {
    await remote.putRecord('m1', 'scene:abc', '{"x":1}', { hash: 'h1', format: 1, at: 5, edited: 4 });
    const snap = await remote.snapshot();
    const r = snap.records.find(x => x.key === 'scene:abc');
    assert.equal(r.machine, 'm1');
    assert.equal(r.hash, 'h1');
    assert.equal(r.format, 1);
    assert.equal(await remote.getText(r.fileId), '{"x":1}');
  });

  test('a replaced record leaves one file, and a newer format is reported as it is', async () => {
    await remote.putRecord('m1', 'scene:abc', '{"x":2}', { hash: 'h2', format: 9, at: 6 });
    const snap = await remote.snapshot();
    const mine = snap.records.filter(x => x.key === 'scene:abc');
    assert.equal(mine.length, 1);
    assert.equal(mine[0].hash, 'h2');
    assert.equal(mine[0].format, 9);
  });

  test('a listing in pages comes back whole', async () => {
    drive.pageSize = 2;
    for (let i = 0; i < 5; i++) await remote.putRecord('m2', 'pic:p' + i, '{}', { hash: 'x' + i, format: 1 });
    const snap = await remote.snapshot();
    assert.equal(snap.records.filter(x => x.machine === 'm2').length, 5);
  });

  test('an upload cut off mid-way resumes and the file is whole', async () => {
    const data = crypto.randomBytes(5000);
    const name = 'big.' + sha(data);
    drive.cutNext = { bytes: 1500 };
    await remote.putBlobBuffer(name, data);
    const b = (await remote.snapshot()).blobs.find(x => x.name === name);
    assert.ok(b, 'the file is on the Drive');
    assert.equal(Buffer.compare(await remote.getBlob(b.id, name), data), 0);
    assert.equal(drive.stats.uploads.filter(u => u.name === name).length, 1, 'one finished upload, not a half one beside it');
  });

  test('a file already on the Drive is not sent again', async () => {
    const data = Buffer.from('same bytes');
    const name = 'once.' + sha(data);
    await remote.putBlobBuffer(name, data);
    assert.equal(await remote.putBlobBuffer(name, data), null);
    assert.equal(drive.stats.uploads.filter(u => u.name === name).length, 1);
  });

  test('a full Drive is reported as full and leaves no file', async () => {
    drive.quotaFull = true;
    const data = Buffer.from('no room');
    await assert.rejects(remote.putBlobBuffer('full.' + sha(data), data), e => e.syncCode === 'quota');
    assert.equal((await remote.snapshot()).blobs.some(b => b.name.startsWith('full.')), false);
  });

  test('an expired token is refreshed after a 401 and the call goes through', async () => {
    const before = drive.stats.refreshes;
    drive.expireToken();
    await remote.snapshot();
    assert.equal(drive.stats.refreshes, before + 1);
  });

  test('a file whose bytes do not match its name is refused', async () => {
    const data = Buffer.from('honest');
    const lie = 'liar.' + sha(Buffer.from('something else'));
    const f = drive.put({ name: lie, parents: [(await remote.snapshot(), drive.files().find(x => x.name === 'blobs').id)] }, data);
    await assert.rejects(remote.getBlob(f.id, lie), e => e.syncCode === 'corrupt');
  });

  test('a file to disk is checked too, and a bad one is not left behind', async () => {
    const data = Buffer.from('to disk');
    const name = 'disk.' + sha(data);
    await remote.putBlobBuffer(name, data);
    const id = (await remote.snapshot()).blobs.find(b => b.name === name).id;
    const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evsync-')), 'out.bin');
    await remote.getBlobToFile(id, name, dest);
    assert.equal(fs.readFileSync(dest).toString(), 'to disk');
    const bad = 'bad.' + sha(Buffer.from('other'));
    const f = drive.put({ name: bad, parents: [drive.files().find(x => x.name === 'blobs').id] }, data);
    await assert.rejects(remote.getBlobToFile(f.id, bad, dest + '2'), e => e.syncCode === 'corrupt');
    assert.equal(fs.existsSync(dest + '2'), false);
  });

  test('a name that is not a record or a map file is skipped', async () => {
    const m = drive.files().find(x => x.name === 'rec-m1');
    drive.put({ name: '..~evil.json', parents: [m.id] }, Buffer.from('{}'));
    drive.put({ name: 'scene~..%2Fx.json', parents: [m.id] }, Buffer.from('{}'));
    const snap = await remote.snapshot();
    assert.equal(snap.records.some(r => /evil|\.\./.test(r.key)), false);
  });

  test('record names round-trip', () => {
    assert.equal(keyToName('local:evermist.combat'), 'local~evermist.combat.json');
    assert.equal(nameToKey('local~evermist.combat.json'), 'local:evermist.combat');
    assert.equal(nameToKey('scene~a b.json'), null);
    assert.equal(nameToKey('x.json'), null);
    for (const k of ['gone', 'campaign', 'backdrop', 'music']) assert.equal(nameToKey(keyToName(k)), k);
  });

  test('the Drive space reads as the quota says, a set usage included', async () => {
    drive.quotaUsed = 74;
    drive.quotaLimit = 100;
    try { assert.deepEqual(await remote.about(), { limit: 100, usage: 74 }); } finally { drive.quotaUsed = null; drive.quotaLimit = 15 * 1024 ** 3; }
  });

  test('a track goes to the music folder, never to blobs, and the listing keeps the two apart', async () => {
    const data = Buffer.from('a track');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evsync-'));
    fs.writeFileSync(path.join(dir, 'Theme.mp3'), data);
    const name = 'm1.' + sha(data);
    await remote.putMusicFile(name, path.join(dir, 'Theme.mp3'));
    assert.equal(await remote.putMusicFile(name, path.join(dir, 'Theme.mp3')), null, 'a track already there is not sent twice');
    const snap = await remote.snapshot();
    assert.deepEqual(snap.music.map(f => f.name), [name]);
    assert.equal(snap.blobs.some(b => b.name === name), false);
    const folder = drive.files().find(f => f.name === 'music');
    assert.ok(drive.files().find(f => f.name === name).parents.includes(folder.id));
  });
});
