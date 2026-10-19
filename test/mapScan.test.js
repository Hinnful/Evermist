'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findMapFiles, readMapFiles, MAX_FOLDER_FILES } = require('../electron/mapScan.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evermist-scan-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const put = (rel, bytes, mtime) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, bytes || 'x');
  if (mtime) fs.utimesSync(p, mtime, mtime);
  return p;
};

put('old-cave.png', 'a', new Date('2026-01-01'));
put('new-cave.webp', 'bb', new Date('2026-03-01'));
put('a/b/crypt.mp4', 'c', new Date('2026-02-01'));
put('a/b/c/too-deep.png');
put('notes.txt');
put('.hidden/secret.png');
put('pack.zip', 'z', new Date('2026-04-01'));

describe('findMapFiles', () => {
  it('lists images, videos and zips two levels down, newest first', async () => {
    const found = await findMapFiles([root]);
    assert.deepEqual(found.map(f => f.name), ['pack.zip', 'new-cave.webp', 'crypt.mp4', 'old-cave.png']);
    assert.deepEqual(found.map(f => f.kind), ['zip', 'image', 'video', 'image']);
    assert.equal(found[1].size, 2);
  });
  it('filters by name in any case', async () => {
    assert.deepEqual((await findMapFiles([root], { query: 'CAVE' })).map(f => f.name), ['new-cave.webp', 'old-cave.png']);
  });
  it('keeps at most 50 and skips a folder that is missing', async () => {
    const many = path.join(root, 'many');
    for (let i = 0; i < 60; i++) put('many/m' + i + '.png');
    const found = await findMapFiles([many, path.join(root, 'nowhere')]);
    assert.equal(found.length, 50);
  });
});

describe('readMapFiles', () => {
  it('reads one file with its type', async () => {
    const r = await readMapFiles(path.join(root, 'new-cave.webp'));
    assert.deepEqual(r.files.map(f => [f.name, f.type, f.bytes.length]), [['new-cave.webp', 'image/webp', 2]]);
  });
  it('reads the maps directly inside a folder and leaves a zip out', async () => {
    const r = await readMapFiles(root);
    assert.deepEqual(r.files.map(f => f.name), ['new-cave.webp', 'old-cave.png']);
    assert.deepEqual(r.skipped.map(s => s.name), ['pack.zip']);
  });
  it('takes at most the limit from one folder', async () => {
    const r = await readMapFiles(path.join(root, 'many'));
    assert.equal(r.files.length, MAX_FOLDER_FILES);
    assert.equal(r.skipped.length, 60 - MAX_FOLDER_FILES);
  });
  it('says so for a path that is missing, a folder with no maps and a file that is no map', async () => {
    assert.match((await readMapFiles(path.join(root, 'nope.png'))).error, /no file or folder/);
    fs.mkdirSync(path.join(root, 'empty'));
    assert.match((await readMapFiles(path.join(root, 'empty'))).error, /no image or video/);
    assert.equal((await readMapFiles(path.join(root, 'notes.txt'))).skipped.length, 1);
  });
});
