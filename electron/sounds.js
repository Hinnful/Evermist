'use strict';
// sounds.js — the soundboard's files: the built-in ones that ship inside the app, and the DM's own in
// `userData/sounds`, which sync like the music folder and stay out of the backup zip.

const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { createMusicHashes } = require('./musicHashes.js');
const { createSoundFiles } = require('./soundFiles.js');

const SOUNDS_DIR = path.join(__dirname, '..', 'assets', 'sounds');

let own = null, hashes = null;

function register(ctx) {
  const dir = path.join(ctx.userData, 'sounds');
  fs.mkdirSync(dir, { recursive: true });
  own = createSoundFiles(dir);
  hashes = createMusicHashes(dir, path.join(ctx.userData, 'sync', 'sound-hashes.json'), path.join(ctx.userData, 'trash', 'sounds'));
}

// ⚠ A NAME FROM THE RENDERER IS NOT A PATH: only a bare lowercase file name passes.
ipcMain.handle('sound-read', async (_event, name) => {
  if (typeof name !== 'string' || !/^[a-z0-9-]+\.(mp3|ogg|wav)$/.test(name)) return null;
  try { return await fs.promises.readFile(path.join(SOUNDS_DIR, name)); } catch { return null; }
});

ipcMain.handle('sound-own-list', () => own.list());
ipcMain.handle('sound-own-read', (_event, name) => own.read(name));
ipcMain.handle('sound-own-copy', (_event, paths) => own.copy(paths));

ipcMain.handle('sound-own-trash', async (_event, name, token) => {
  if (!own.soundPath(name)) throw new Error('Not a sound in the sounds folder.');
  return hashes.trash(name, token);
});

ipcMain.handle('sound-own-untrash', async (_event, token, name) => {
  if (!own.soundPath(name)) throw new Error('Not a sound in the Trash.');
  return hashes.untrash(token, name);
});

ipcMain.handle('sound-own-purge-trash', async (_event, token) => hashes.purgeTrash(token));

module.exports = { register, soundHashes: () => hashes };
