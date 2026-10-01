'use strict';
// sounds.js — the soundboard's built-in sound files, which ship inside the app.

const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const SOUNDS_DIR = path.join(__dirname, '..', 'assets', 'sounds');

function register() {}

// ⚠ A NAME FROM THE RENDERER IS NOT A PATH: only a bare lowercase file name passes.
ipcMain.handle('sound-read', async (_event, name) => {
  if (typeof name !== 'string' || !/^[a-z0-9-]+\.(mp3|ogg|wav)$/.test(name)) return null;
  try { return await fs.promises.readFile(path.join(SOUNDS_DIR, name)); } catch { return null; }
});

module.exports = { register };
