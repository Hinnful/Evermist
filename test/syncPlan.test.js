'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/scenes/syncPlan.js');

const H = c => c.repeat(64);
const DAY = 24 * 3600 * 1000;

describe('what goes up', () => {
  it('lists a record whose hash is not the one last uploaded', () => {
    const index = { 'scene:a': { hash: 'h2' }, 'scene:b': { hash: 'h1' }, 'pic:p': { hash: 'x' } };
    assert.deepEqual(S.syToUpload(index, { 'scene:a': 'h1', 'scene:b': 'h1' }), ['pic:p', 'scene:a']);
  });
  it('does not send a pulled change back: the index and the synced hash match after a pull', () => {
    assert.deepEqual(S.syToUpload({ 'scene:a': { hash: 'r' } }, { 'scene:a': 'r' }), []);
  });
  it('sends again after a rollback edit moved the hash past the last upload', () => {
    assert.deepEqual(S.syToUpload({ 'scene:a': { hash: 'edited-on-old-release' } }, { 'scene:a': 'h1' }), ['scene:a']);
  });
});

describe('what comes down', () => {
  const idx = { 'scene:a': { hash: 'mine' } };
  it('takes a record from another computer that differs from the last pull and from here', () => {
    const r = S.syNewRemote([{ machine: 'B', key: 'scene:a', hash: 'theirs', format: 1 }], 'A', idx, {});
    assert.equal(r.take.length, 1);
  });
  it('skips its own folder and a hash it already pulled', () => {
    const r = S.syNewRemote([{ machine: 'A', key: 'scene:a', hash: 'x', format: 1 }, { machine: 'B', key: 'scene:a', hash: 'x', format: 1 }], 'A', idx, { 'B/scene:a': 'x' });
    assert.deepEqual([r.take.length, r.same.length], [0, 0]);
  });
  it('notes a record that already matches here as same, not as a change to apply', () => {
    const r = S.syNewRemote([{ machine: 'B', key: 'scene:a', hash: 'mine', format: 1 }], 'A', idx, {});
    assert.deepEqual([r.take.length, r.same.length], [0, 1]);
  });
  it('skips a record from a newer sync format and one with an unsafe key', () => {
    const r = S.syNewRemote([{ machine: 'B', key: 'scene:a', hash: 'z', format: 2 }, { machine: 'B', key: 'scene:../x', hash: 'z', format: 1 },
      { machine: 'B', key: 'local:evermist.combat', hash: 'z', format: 1 }], 'A', idx, {});
    assert.deepEqual([r.take.length, r.tooNew.length, r.bad.length], [1, 1, 1]);
  });
});

describe('map files', () => {
  it('uploads a file once even when two records name it, and not when the Drive holds it', () => {
    const w = [{ owner: 's1', hash: H('a') }, { owner: 's1', hash: H('a') }, { owner: 's2', hash: H('b') }];
    assert.deepEqual(S.syBlobsToUpload(w, [S.syBlobName('s2', H('b'))]), [w[0]]);
  });
  it('names a replaced map file as unreferenced once no record uses it', () => {
    const old = S.syBlobName('s1', H('a')), now = S.syBlobName('s1', H('c'));
    assert.deepEqual(S.syBlobsUnreferenced([old, now], [{ owner: 's1', hash: H('c') }], ['s1']), [old]);
  });
  it('leaves alone a file whose record is not on the Drive yet, a fog file included', () => {
    const map = S.syBlobName('s2', H('a')), fog = S.syBlobName('f_s2', H('b')), pic = S.syBlobName('p1', H('d'));
    assert.deepEqual(S.syBlobsUnreferenced([map, fog, pic], [], ['s1']), []);
    assert.deepEqual(S.syBlobsUnreferenced([map, fog, pic], [], ['s2', 'p1']), [map, fog, pic]);
  });
  it('checks a name read from the Drive', () => {
    assert.ok(S.syBlobNameOk(S.syBlobName('s_1-a', H('f'))));
    for (const bad of ['../x.' + H('a'), 'a/b.' + H('a'), 'a.' + H('A'), 'a.short', '', null]) assert.equal(S.syBlobNameOk(bad), false, String(bad));
  });
});

describe('a record hash leaves the Blobs out', () => {
  it('is the same text whatever the Blobs hold, and the same for any key order', () => {
    const a = S.syRecordBody({ id: 's', name: 'N', mapBlob: { size: 1 }, baseFogBlob: 'x', thumbnail: 1 });
    const b = S.syRecordBody({ thumbnail: 2, name: 'N', id: 's' });
    assert.equal(a, b);
    assert.notEqual(a, S.syRecordBody({ id: 's', name: 'M' }));
  });
});

describe('what waits', () => {
  const ctx = { openScene: 'o', tvScene: 't', paneScenes: ['l', 'r'], fightTable: true, openNoteKey: 'local:evermist.campaignNotes' };
  it('holds the open, TV and Two-maps maps and lets another map in', () => {
    assert.ok(S.syHeld('scene:o', ctx) && S.syHeld('scene:t', ctx) && S.syHeld('scene:l', ctx) && S.syHeld('scene:r', ctx));
    assert.equal(S.syHeld('scene:x', ctx), null);
  });
  it('holds fights and bestiary only while the fight table is shown', () => {
    assert.ok(S.syHeld('local:evermist.combat', ctx));
    assert.equal(S.syHeld('local:evermist.combat', { ...ctx, fightTable: false }), null);
  });
  it('holds the record of the note open in the editor', () => {
    assert.ok(S.syHeld('local:evermist.campaignNotes', ctx));
    assert.equal(S.syHeld('local:evermist.placeNotes', ctx), null);
  });
});

describe('the 30-day trash', () => {
  const NOW = 100 * DAY;
  it('a deletion newer than the last edit removes the map; an edit after it keeps it', () => {
    assert.equal(S.syGoneWins({ at: 50 * DAY }, 40 * DAY, NOW), true);
    assert.equal(S.syGoneWins({ at: 50 * DAY }, 60 * DAY, NOW), false);
    assert.equal(S.syGoneWins(undefined, 1, NOW), false);
  });
  it('a stamp from a fast clock counts as now', () => {
    assert.equal(S.syGoneWins({ at: NOW + 5 * DAY }, NOW, NOW), true);
    assert.equal(S.sySceneEditedAt({ edits: { scene: { name: NOW + 9 * DAY }, rooms: { u: { shape: 3 } } } }, NOW), NOW);
  });
  it('Restore lifts the deletion, and a later deletion stands again', () => {
    let g = S.syGoneNote({}, 's', 10 * DAY);
    assert.deepEqual(S.syTrashIds(g), ['s']);
    g = S.syRestore(g, 's', 11 * DAY);
    assert.equal(S.syGoneWins(g.s, 5 * DAY, NOW), false);
    assert.deepEqual(S.syTrashIds(g), []);
    g = S.syGoneNote(g, 's', 20 * DAY);
    assert.equal(S.syGoneWins(g.s, 5 * DAY, NOW), true);
  });
  it('lists what is past 30 days, and a purge keeps the record so the map cannot come back', () => {
    let g = { old: { at: 10 * DAY }, fresh: { at: 90 * DAY } };
    assert.deepEqual(S.syTrashDue(g, NOW), ['old']);
    g = S.syPurge(g, ['old']);
    assert.deepEqual(S.syTrashIds(g), ['fresh']);
    assert.ok(g.old.purged && g.old.at === 10 * DAY);
    assert.equal(S.syRestore(g, 'old', NOW), g, 'a purged map is not restorable');
  });
  it('a computer offline past the purge cannot bring the map back', () => {
    const g = S.syPurge({ m: { at: 10 * DAY } }, ['m']);
    const offline = { edits: { scene: { name: 9 * DAY } } };
    assert.equal(S.syGoneWins(g.m, S.sySceneEditedAt(offline, 200 * DAY), 200 * DAY), true);
  });
  it('merges two computers\' records field by field and never loses a purge', () => {
    const m = S.syGoneMerge({ a: { at: 5, restoredAt: 6 } }, { a: { at: 9, purged: true }, b: { at: 1 } });
    assert.deepEqual(m, { a: { at: 9, restoredAt: 6, purged: true }, b: { at: 1 } });
  });
  it('a purged map stays gone even against a copy edited later', () => {
    const g = S.syPurge({ m: { at: 10 * DAY } }, ['m']);
    assert.equal(S.syGoneWins(g.m, 50 * DAY, NOW), true);
  });
  it('sends and reads back only well-formed records, in one stable text', () => {
    const g = { b: { at: 2, id: 'b', extra: 1 }, a: { at: 1, restoredAt: 3, purged: true }, 'x/y': { at: 1 }, c: { at: -1 } };
    assert.deepEqual(S.syGoneClean(g), { a: { at: 1, restoredAt: 3, purged: true }, b: { at: 2 } });
    assert.equal(S.syGoneText(g), S.syGoneText({ a: { purged: true, restoredAt: 3, at: 1 }, b: { at: 2 } }));
    assert.deepEqual(S.syGoneParse(S.syGoneText(g)), S.syGoneClean(g));
    assert.deepEqual(S.syGoneParse('not json'), {});
  });
  it('a restored map comes back where it is missing, from the newest copy any computer holds', () => {
    const g = { r: { at: 5, restoredAt: 6 }, d: { at: 5 }, p: { at: 5, restoredAt: 6, purged: true }, here: { at: 5, restoredAt: 6 } };
    assert.deepEqual(S.syRestored(g, ['here']), ['r']);
    const recs = [{ key: 'scene:r', edited: 3, at: 9, machine: 'a' }, { key: 'scene:r', edited: 4, at: 1, machine: 'b' }, { key: 'scene:x', edited: 9, at: 9 }];
    assert.equal(S.syNewestRecord(recs, 'scene:r').machine, 'b');
    assert.equal(S.syNewestRecord(recs, 'scene:q'), null);
  });
  it('a purge removes every computer\'s record of the map and its map and fog files, nothing else', () => {
    const recs = [{ key: 'scene:m', fileId: 1 }, { key: 'scene:m', fileId: 2 }, { key: 'scene:k', fileId: 3 }, { key: 'gone', fileId: 4 }];
    const blobs = [{ name: 'm.' + 'a'.repeat(64), id: 5 }, { name: 'f_m.' + 'b'.repeat(64), id: 6 }, { name: 'k.' + 'a'.repeat(64), id: 7 }, { name: 'mm.' + 'a'.repeat(64), id: 8 }];
    assert.deepEqual(S.syPurgeFiles(recs, blobs, ['m']), [1, 2, 5, 6]);
  });
  it('a deleted picture leaves the Drive: every computer\'s record of it and its file, nothing else', () => {
    const recs = [
      { key: 'pic:d', edited: 5, fileId: 1, machine: 'a' }, { key: 'pic:d', edited: 5, fileId: 2, machine: 'b' },
      { key: 'pic:later', edited: 9, fileId: 3 }, { key: 'pic:k', edited: 1, fileId: 4 },
      { key: 'scene:d', edited: 1, fileId: 5 }, { key: 'backdrop', edited: 1, fileId: 6 }, { key: 'local:evermist.gonePictures', edited: 1, fileId: 7 },
    ];
    const blobs = [{ name: 'd.' + H('a'), id: 8 }, { name: 'k.' + H('a'), id: 9 }, { name: 'later.' + H('b'), id: 10 },
      { name: 'f_d.' + H('c'), id: 11 }, { name: 'backdrop.' + H('d'), id: 12 }];
    assert.deepEqual(S.syPicFilesGone(recs, blobs, { d: 6, later: 7 }), [1, 2, 8]);
    assert.deepEqual(S.syPicFilesGone(recs, blobs, { d: 5 }), [1, 2, 8]);
    assert.deepEqual(S.syPicFilesGone(recs, blobs, {}), []);
  });
  it('the deletion records and the Campaign travel under keys of their own', () => {
    for (const k of ['gone', 'campaign', 'backdrop', 'scene:a1', 'local:evermist.combat']) assert.ok(S.syKeyOk(k), k);
    for (const k of ['gone:x', 'campaigns', 'scene:a/b']) assert.equal(S.syKeyOk(k), false, k);
  });
  it('finds a map synced before and now missing, once', () => {
    const synced = { 'scene:a': 'h', 'scene:b': 'h', 'pic:p': 'h' };
    assert.deepEqual(S.syMissingScenes(synced, ['a'], {}), ['b']);
    assert.deepEqual(S.syMissingScenes(synced, ['a'], { b: { at: 1 } }), []);
  });
});

describe('the Campaign and the backdrop as records', () => {
  it('reads one Campaign the same whatever order its keys were written in', () => {
    const a = JSON.stringify({ placeShapes: { Keep: { vertices: [1], uid: 'p1' } }, party: { x: 1, y: 2 } });
    const b = JSON.stringify({ party: { y: 2, x: 1 }, placeShapes: { Keep: { uid: 'p1', vertices: [1] } } });
    assert.equal(S.syCampaignText(a), S.syCampaignText(b));
    assert.deepEqual(JSON.parse(S.syCampaignText(a)), JSON.parse(a));
  });
  it('answers null for no Campaign or one that does not parse', () => {
    assert.equal(S.syCampaignText(null), null);
    assert.equal(S.syCampaignText('{not json'), null);
  });
  it('reads a backdrop picked here and one imported the same', () => {
    const picked = JSON.stringify({ x: 1, y: 2, scale: 1, alpha: 0.6, w: 10, h: 5, name: 'm', at: 7 });
    const imported = JSON.stringify({ name: 'm', at: 7, x: 1, y: 2, scale: 1, alpha: 0.6, w: 10, h: 5 });
    assert.equal(S.syBackdropMetaText(picked), S.syBackdropMetaText(imported));
    assert.notEqual(S.syBackdropMetaText(picked), S.syBackdropMetaText(picked.replace('"x":1', '"x":2')));
  });
});

describe("Settings' status line", () => {
  it('shows progress while syncing, and plain Syncing without a count', () => {
    assert.deepEqual(S.syStatusLine({ state: 'syncing', progress: { done: 3, total: 9 } }), { text: 'Syncing {done} of {total}…', vars: { done: 3, total: 9 } });
    assert.deepEqual(S.syStatusLine({ state: 'syncing', progress: null, last: 5 }), { text: 'Syncing…' });
  });
  it('names offline, signed out, a full Drive and a failure', () => {
    for (const st of ['offline', 'signedOut', 'full', 'error']) assert.match(S.syStatusLine({ state: st, last: 5, message: 'update' }).text, /\w/);
    assert.match(S.syStatusLine({ state: 'signedOut' }).text, /^Signed out/);
    assert.match(S.syStatusLine({ state: 'full' }).text, /full/);
  });
  it('asks for an update before it shows the last sync', () => {
    assert.match(S.syStatusLine({ state: 'idle', last: 5, message: 'update' }).text, /newer Evermist/);
  });
  it('gives the last sync time, or says it never synced', () => {
    assert.deepEqual(S.syStatusLine({ state: 'idle', last: 1234 }), { text: 'Last synced {time}', when: 1234 });
    assert.deepEqual(S.syStatusLine({ state: 'idle', last: 0 }), { text: 'Not synced yet.' });
    assert.deepEqual(S.syStatusLine(null), { text: 'Not synced yet.' });
  });
  it('reads as signed out before this computer ever connected', () => {
    assert.deepEqual(S.syStatusLine({ state: 'off', last: 0 }), { text: 'Signed out. Connect to Google to sync.' });
  });
});

describe('the first-sync question', () => {
  const rec = (machine, key, edited) => ({ machine, key, edited: edited || 0 });
  it('counts the maps other computers hold on the Drive once each, and those computers', () => {
    const records = [rec('mA', 'scene:a'), rec('mB', 'scene:a'), rec('mB', 'scene:b'), rec('mB', 'campaign'), rec('mC', 'gone'), rec('me', 'scene:z')];
    assert.deepEqual(S.syDriveCounts(records, 'me', {}, 1000), { maps: 2, computers: 3 });
  });
  it('leaves out a map whose deletion stands, and keeps one edited since', () => {
    const records = [rec('mA', 'scene:a', 100), rec('mA', 'scene:b', 900)];
    assert.deepEqual(S.syDriveCounts(records, 'me', { a: { at: 500 }, b: { at: 500 } }, 1000), { maps: 1, computers: 1 });
  });
  it('is nothing on an empty Drive or one only this computer wrote to', () => {
    assert.deepEqual(S.syDriveCounts([], 'me', {}, 1), { maps: 0, computers: 0 });
    assert.deepEqual(S.syDriveCounts([rec('me', 'scene:a')], 'me', null, 1), { maps: 0, computers: 0 });
  });
});

describe('a map file a sync replaced', () => {
  it('is named by its map, the time kept and its type', () => {
    assert.equal(S.syKeptName('abc', 1234, 'jpg'), 'abc.1234.jpg');
  });
  it('is due for purging only past its 30 days, and nothing else in the folder is', () => {
    const now = 100 * DAY;
    const names = [S.syKeptName('a', now - 31 * DAY, 'jpg'), S.syKeptName('b', now - 29 * DAY, 'webm'), S.syKeptName('c', now - 30 * DAY - 1, 'png'), 'notes.txt', 'x.y.z.jpg', '../a.1.jpg'];
    assert.deepEqual(S.syKeptDue(names, now), [names[0], names[2]]);
  });
  it('reads back its map, time and type, and refuses any other name', () => {
    assert.deepEqual(S.syKeptParse('abc.1234.jpg'), { name: 'abc.1234.jpg', sceneId: 'abc', at: 1234, ext: 'jpg', video: false, mime: 'image/jpeg' });
    assert.equal(S.syKeptParse('abc.1234.mp4').video, true);
    assert.equal(S.syKeptParse('abc.1234.bin').mime, '');
    for (const bad of ['../a.1.jpg', 'a/b.1.jpg', 'a.b.c.jpg', 'a.1.exe', 'a.x.jpg', 'a.1.jpg/', '', null, 5]) assert.equal(S.syKeptParse(bad), null, String(bad));
  });
  it('lists the well-formed names newest first', () => {
    const l = S.syKeptList(['a.100.jpg', 'notes.txt', 'b.300.webm', 'c.200.png', '../d.400.jpg']);
    assert.deepEqual(l.map(x => x.name), ['b.300.webm', 'c.200.png', 'a.100.jpg']);
    assert.deepEqual(S.syKeptList(null), []);
  });
});

describe('how full the Drive reads', () => {
  it('says nothing under 70%, amber from 70%, red from 90%, and nothing with no limit', () => {
    const G = 1e9;
    assert.equal(S.syDriveSpace({ limit: 100 * G, usage: 69.9 * G }), null);
    assert.deepEqual(S.syDriveSpace({ limit: 100 * G, usage: 74 * G }), { pct: 74, level: 'y' });
    assert.deepEqual(S.syDriveSpace({ limit: 100 * G, usage: 90 * G }), { pct: 90, level: 'r' });
    assert.deepEqual(S.syDriveSpace({ limit: 100 * G, usage: 120 * G }), { pct: 100, level: 'r' });
    assert.equal(S.syDriveSpace({ limit: 0, usage: 5 }), null);
    assert.equal(S.syDriveSpace(undefined), null);
  });
});
