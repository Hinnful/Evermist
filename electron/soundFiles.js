'use strict';
// soundFiles.js — the DM's own sounds folder: files copied in under the 10 MB limit, a new name from the soundboard, and
// the read that only a bare file name in that folder passes. Pure Node, no Electron. Tested.

const fs = require('fs');
const path = require('path');
const { uniqueMusicName } = require('../src/ui/musicPlan.js');
const { syMuNameOk } = require('../src/scenes/syncMusicPlan.js');

const SOUND_MAX_BYTES = 10 * 1024 * 1024;

function createSoundFiles(dir) {
  // ⚠ A NAME FROM THE RENDERER IS NOT A PATH: no separator, no leading dot, an audio extension.
  const soundPath = name => (syMuNameOk(name) ? path.join(dir, name) : null);

  async function list() {
    let names = [];
    try { names = await fs.promises.readdir(dir); } catch (_) { return []; }
    const out = [];
    for (const name of names) {
      if (!syMuNameOk(name)) continue;
      try { if ((await fs.promises.stat(path.join(dir, name))).isFile()) out.push(name); } catch (_) { /* gone meanwhile */ }
    }
    return out.sort((a, b) => a.localeCompare(b));
  }

  async function read(name) {
    const full = soundPath(name);
    if (!full) return null;
    try { return await fs.promises.readFile(full); } catch (_) { return null; }
  }

  // Never over a file already there. A file over the limit is refused before anything is written; a bad file does not
  // stop the rest.
  async function copy(paths) {
    const added = [], failed = [];
    await fs.promises.mkdir(dir, { recursive: true });
    const taken = await fs.promises.readdir(dir).catch(() => []);
    for (const src of Array.isArray(paths) ? paths : []) {
      const base = typeof src === 'string' ? path.basename(src) : '';
      try {
        if (!syMuNameOk(base)) throw new Error('Not an audio file.');
        if ((await fs.promises.stat(src)).size > SOUND_MAX_BYTES) { failed.push({ name: base, tooBig: true }); continue; }
        for (;;) {
          const name = uniqueMusicName(base, taken);
          taken.push(name);
          try {
            await fs.promises.copyFile(src, path.join(dir, name), fs.constants.COPYFILE_EXCL);
            added.push(name);
            break;
          } catch (err) { if (!err || err.code !== 'EEXIST') throw err; }
        }
      } catch (err) {
        failed.push({ name: base || String(src), message: (err && err.message) || String(err) });
      }
    }
    return { added, failed };
  }

  return { soundPath, list, read, copy };
}

// The file name a typed name asks for: the text trimmed, separators and control characters out, the old extension
// kept. Null when nothing is left.
function soundFileName(typed, oldName) {
  const ext = path.extname(String(oldName || ''));
  const stem = String(typed || '').replace(/[/\\:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 120).trim();
  return stem ? stem + ext : null;
}

module.exports = { createSoundFiles, soundFileName, SOUND_MAX_BYTES };
