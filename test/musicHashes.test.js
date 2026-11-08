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
  return { dir, cache: path.join(root, 'sync', 'music-hashes.json'), h: createMusicHashes(dir, path.join(root, 'sync', 'music-hashes.json')) };
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

test('a track in Claude\'s undo folder is listed by its hash, and its undo brings the hash back', async () => {
  const { dir, h } = setup();
  fs.writeFileSync(path.join(dir, 'A.mp3'), 'one');
  await h.list(true);
  fs.mkdirSync(path.join(dir, '.removed'));
  fs.renameSync(path.join(dir, 'A.mp3'), path.join(dir, '.removed', 't1.mp3'));
  await h.stashed('A.mp3', 't1.mp3');
  assert.deepEqual(await h.list(false), { tracks: [], stashed: [sha('one')] });
  fs.renameSync(path.join(dir, '.removed', 't1.mp3'), path.join(dir, 'A.mp3'));
  await h.unstashed('t1.mp3', 'A.mp3');
  assert.deepEqual(await h.list(false), { tracks: [{ name: 'A.mp3', size: 3, hash: sha('one') }], stashed: [] });
});

test('a downloaded track lands under a free name, and a remove takes only the same content', async () => {
  const { dir, h } = setup();
  fs.writeFileSync(path.join(dir, 'Theme.mp3'), 'mine');
  fs.writeFileSync(h.partPath(sha('theirs')), 'theirs');
  assert.equal(await h.place(h.partPath(sha('theirs')), 'Theme.mp3', sha('theirs')), 'Theme (2).mp3');
  assert.equal(fs.existsSync(h.partPath(sha('theirs'))), false);
  assert.equal(fs.readFileSync(path.join(dir, 'Theme.mp3'), 'utf8'), 'mine');
  assert.equal(await h.remove('Theme.mp3', sha('theirs')), false);
  assert.equal(await h.remove('Theme (2).mp3', sha('theirs')), true);
  assert.deepEqual((await h.list(false)).tracks.map(t => t.name), ['Theme.mp3']);
  await assert.rejects(h.place(h.partPath(sha('x')), '../x.mp3', sha('x')));
});
