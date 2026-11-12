'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSoundFiles, SOUND_MAX_BYTES } = require('../electron/soundFiles.js');
const { createMusicHashes } = require('../electron/musicHashes.js');

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evsound-'));
  const dir = path.join(root, 'sounds'), src = path.join(root, 'src');
  fs.mkdirSync(src);
  return { root, dir, src, own: createSoundFiles(dir) };
};

test('a file over 10 MB is refused and nothing is copied; the rest still land', async () => {
  const { dir, src, own } = setup();
  fs.writeFileSync(path.join(src, 'Big.mp3'), Buffer.alloc(SOUND_MAX_BYTES + 1));
  fs.writeFileSync(path.join(src, 'Edge.mp3'), Buffer.alloc(SOUND_MAX_BYTES));
  fs.writeFileSync(path.join(src, 'notes.txt'), 'x');
  const res = await own.copy([path.join(src, 'Big.mp3'), path.join(src, 'Edge.mp3'), path.join(src, 'notes.txt')]);
  assert.deepEqual(res.added, ['Edge.mp3']);
  assert.deepEqual(res.failed.map(f => [f.name, !!f.tooBig]), [['Big.mp3', true], ['notes.txt', false]]);
  assert.deepEqual(fs.readdirSync(dir), ['Edge.mp3'], 'the big file left nothing behind');
});

test('a copy never lands over a sound already there', async () => {
  const { src, own } = setup();
  fs.writeFileSync(path.join(src, 'Bell.ogg'), 'a');
  assert.deepEqual((await own.copy([path.join(src, 'Bell.ogg')])).added, ['Bell.ogg']);
  assert.deepEqual((await own.copy([path.join(src, 'Bell.ogg')])).added, ['Bell (2).ogg']);
  assert.deepEqual(await own.list(), ['Bell (2).ogg', 'Bell.ogg']);
});

test('only a bare audio file name in the folder is read', async () => {
  const { root, dir, src, own } = setup();
  fs.writeFileSync(path.join(src, 'Ok.wav'), 'ok');
  await own.copy([path.join(src, 'Ok.wav')]);
  fs.writeFileSync(path.join(root, 'secret.wav'), 'no');
  assert.equal(String(await own.read('Ok.wav')), 'ok');
  for (const bad of ['../secret.wav', '..\\secret.wav', 'sub/Ok.wav', '/etc/passwd', '..', '.hidden.wav', 'Ok.exe', '', null, 42]) {
    assert.equal(await own.read(bad), null, String(bad));
    assert.equal(own.soundPath(bad), null, String(bad));
  }
  assert.equal(own.soundPath('Ok.wav'), path.join(dir, 'Ok.wav'));
});

test('a renamed sound keeps its hash and takes a free name', async () => {
  const { root, dir, src, own } = setup();
  fs.writeFileSync(path.join(src, 'A.mp3'), 'one');
  fs.writeFileSync(path.join(src, 'B.mp3'), 'two');
  await own.copy([path.join(src, 'A.mp3'), path.join(src, 'B.mp3')]);
  const h = createMusicHashes(dir, path.join(root, 'sync', 'h.json'), path.join(root, 'trash'));
  const before = (await h.list(true)).tracks.find(t => t.name === 'A.mp3').hash;
  assert.equal(await h.rename('A.mp3', 'B.mp3'), 'B (2).mp3');
  const after = (await h.list(false)).tracks.find(t => t.name === 'B (2).mp3');
  assert.equal(after.hash, before, 'read by its kept hash, never as unhashed');
  assert.equal(await h.rename('B.mp3', 'b.mp3'), 'b.mp3', 'a change of case alone is its own name');
  await assert.rejects(() => h.rename('../x.mp3', 'y.mp3'));
});
