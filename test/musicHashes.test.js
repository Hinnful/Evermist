'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMusicHashes } = require('../electron/musicHashes.js');

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evmusic-'));
  const dir = path.join(root, 'music');
  fs.mkdirSync(dir);
  const trash = path.join(root, 'trash', 'music');
  return { dir, trash, cache: path.join(root, 'sync', 'music-hashes.json'), h: createMusicHashes(dir, path.join(root, 'sync', 'music-hashes.json'), trash) };
};

test('a track is hashed only when asked, and the hash is kept while the file is unchanged', async () => {
  const { dir, cache, h } = setup();
  fs.writeFileSync(path.join(dir, 'A.mp3'), 'one');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a track');
  assert.deepEqual((await h.list(false)).tracks, [{ name: 'A.mp3', size: 3, hash: null }]);
  assert.equal((await h.list(true)).tracks[0].hash, sha('one'));
  const again = createMusicHashes(dir, cache);
  assert.equal((await again.list(false)).tracks[0].hash, sha('one'), 'the kept hash outlives a restart');
  fs.writeFileSync(path.join(dir, 'A.mp3'), 'changed');
  assert.equal((await again.list(false)).tracks[0].hash, null, 'a changed file is not read by its old hash');
});

test('a deleted track moves into the trash folder with its hash, and comes back under a free name', async () => {
  const { dir, trash, cache, h } = setup();
  fs.writeFileSync(path.join(dir, 'A.mp3'), 'one');
  assert.equal(await h.trash('A.mp3', 't1.mp3'), sha('one'), 'an unhashed track is hashed as it goes');
  assert.equal(fs.existsSync(path.join(dir, 'A.mp3')), false);
  assert.equal(fs.readFileSync(path.join(trash, 't1.mp3'), 'utf8'), 'one');
  assert.deepEqual((await h.list(false)).tracks, []);
  fs.writeFileSync(path.join(dir, 'A.mp3'), 'other');
  const again = createMusicHashes(dir, cache, trash);
  assert.equal(await again.untrash('t1.mp3', 'A.mp3'), 'A (2).mp3', 'a taken name is never written over');
  assert.equal(fs.existsSync(path.join(trash, 't1.mp3')), false);
  assert.equal((await again.list(false)).tracks.find(t => t.name === 'A (2).mp3').hash, sha('one'), 'the hash comes back with it');
  await assert.rejects(h.trash('A.mp3', '../x'));
  await assert.rejects(h.untrash('../A.mp3', 'A.mp3'));
});

test('a purge unlinks only inside the trash folder', async () => {
  const { dir, trash, h } = setup();
  fs.writeFileSync(path.join(dir, 'A.mp3'), 'one');
  await h.trash('A.mp3', 't1.mp3');
  await h.purgeTrash('t1.mp3');
  assert.deepEqual(fs.readdirSync(trash), []);
  await assert.rejects(h.purgeTrash('..'));
});

test('a downloaded track lands under a free name, and a remove takes only the same content', async () => {
  const { dir, trash, h } = setup();
  fs.writeFileSync(path.join(dir, 'Theme.mp3'), 'mine');
  fs.writeFileSync(h.partPath(sha('theirs')), 'theirs');
  assert.equal(await h.place(h.partPath(sha('theirs')), 'Theme.mp3', sha('theirs')), 'Theme (2).mp3');
  assert.equal(fs.existsSync(h.partPath(sha('theirs'))), false);
  assert.equal(fs.readFileSync(path.join(dir, 'Theme.mp3'), 'utf8'), 'mine');
  assert.equal(await h.remove('Theme.mp3', sha('theirs'), 'r1.mp3'), false);
  assert.equal(await h.remove('Theme (2).mp3', sha('theirs'), 'r1.mp3'), true);
  assert.deepEqual((await h.list(false)).tracks.map(t => t.name), ['Theme.mp3']);
  assert.equal(fs.readFileSync(path.join(trash, 'r1.mp3'), 'utf8'), 'theirs', 'a removed track waits in the trash folder');
  await assert.rejects(h.place(h.partPath(sha('x')), '../x.mp3', sha('x')));
});
