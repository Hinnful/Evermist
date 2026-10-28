'use strict';
// mapFiles.js — the IPC behind Claude's map tools: a search of the DM's usual folders, and the bytes of a
// map file or of the maps in a folder. The scanning itself is mapScan.js.

const fs = require('fs');
const { app, ipcMain } = require('electron');
const { findMapFiles, readMapFiles } = require('./mapScan.js');

const MAX_BESTIARY_BYTES = 20 * 1024 * 1024;
const FOLDERS = ['downloads', 'desktop', 'documents', 'pictures'];

function roots() {
  const out = [];
  for (const name of FOLDERS) { try { out.push(app.getPath(name)); } catch { /* no such folder here */ } }
  return out;
}

// One Evermist bestiary export, as text. Only a .json file, and never one over 20 MB.
async function readBestiaryFile(p) {
  if (typeof p !== 'string' || !/\.json$/i.test(p)) return { error: 'Only an Evermist bestiary export (a .json file) can be read here.' };
  try {
    const st = await fs.promises.stat(p);
    if (!st.isFile()) return { error: 'There is no file at "' + p + '".' };
    if (st.size > MAX_BESTIARY_BYTES) return { error: 'That file is over 20 MB, too big for a bestiary export.' };
    return { text: await fs.promises.readFile(p, 'utf8') };
  } catch { return { error: 'There is no file at "' + p + '".' }; }
}

// The files Claude's import tools read by path. A .dd2vtt carries its map's image inside, so its cap is the larger.
const PREP_FILES = {
  plan: { re: /\.(dd2vtt|uvtt|df2vtt)$/i, max: 150, what: 'a floor plan (.dd2vtt)' },
  module: { re: /\.(txt|md|pdf)$/i, max: 20, what: 'module text (.txt, .md or .pdf)' },
};

// A floor plan or a module's text, as bytes. A PDF answers { pdf: true } and is read from its path (pdfText.js).
async function readPrepFile(p, kind) {
  const k = PREP_FILES[kind];
  if (!k || typeof p !== 'string' || !k.re.test(p)) return { error: 'Only ' + (k ? k.what : 'a known file') + ' can be read here.' };
  try {
    const st = await fs.promises.stat(p);
    if (!st.isFile()) return { error: 'There is no file at "' + p + '".' };
    if (/\.pdf$/i.test(p)) return { pdf: true };
    if (st.size > k.max * 1024 * 1024) return { error: 'That file is over ' + k.max + ' MB, too big for ' + k.what + '.' };
    return { bytes: await fs.promises.readFile(p) };
  } catch { return { error: 'There is no file at "' + p + '".' }; }
}

function register() {
  ipcMain.handle('read-prep-file', (_event, p, kind) => readPrepFile(p, kind));
  ipcMain.handle('find-map-files', (_event, query) => findMapFiles(roots(), { query: typeof query === 'string' ? query : '' }).catch(() => []));
  ipcMain.handle('read-bestiary-file', (_event, p) => readBestiaryFile(p));
  ipcMain.handle('read-map-files', (_event, p) => (typeof p === 'string' && p ? readMapFiles(p) : { files: [], skipped: [], error: 'A path is needed.' }));
}

module.exports = { register };
