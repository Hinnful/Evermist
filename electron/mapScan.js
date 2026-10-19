'use strict';
// mapScan.js — looking for map files on disk: what a folder holds, and a search of the DM's usual folders.
// Pure Node, no Electron. Tested.

const fs = require('fs');
const path = require('path');

const IMAGE_RE = /\.(jpe?g|png|gif|bmp|webp|svg)$/i;
const VIDEO_RE = /\.(mp4|webm)$/i;
const ZIP_RE = /\.zip$/i;
const MAX_DEPTH = 2;
const MAX_RESULTS = 50;
const MAX_VISITED = 20000;
const MAX_FOLDER_FILES = 20;
const MAX_FILE_BYTES = 500 * 1024 * 1024;
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm' };

const kindOf = name => (IMAGE_RE.test(name) ? 'image' : VIDEO_RE.test(name) ? 'video' : ZIP_RE.test(name) ? 'zip' : null);
const mimeOf = name => MIME[path.extname(name).slice(1).toLowerCase()] || '';

// Images, videos and zips under `roots`, two folder levels down, newest first. `query` keeps names that
// contain it, in any case. Folders that are hidden or unreadable are skipped.
async function findMapFiles(roots, opts) {
  const o = opts || {};
  const q = String(o.query || '').trim().toLowerCase();
  const limit = Math.min(MAX_RESULTS, o.limit || MAX_RESULTS);
  const found = [];
  const seen = new Set();
  let visited = 0;
  async function walk(dir, depth) {
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (++visited > MAX_VISITED) return;
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < MAX_DEPTH && e.name !== 'node_modules') await walk(full, depth + 1); continue; }
      if (!e.isFile() || !kindOf(e.name) || (q && !e.name.toLowerCase().includes(q)) || seen.has(full)) continue;
      try {
        const st = await fs.promises.stat(full);
        seen.add(full);
        found.push({ path: full, name: e.name, kind: kindOf(e.name), size: st.size, modified: st.mtime.toISOString() });
      } catch { /* gone since the listing */ }
    }
  }
  for (const r of roots) await walk(r, 0);
  found.sort((a, b) => (a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : 0));
  return found.slice(0, limit);
}

// The files a path stands for: itself, or the maps directly inside a folder (never a zip, never deeper).
// `files` carry their bytes; `skipped` say why a file did not come.
async function readMapFiles(p) {
  const out = { files: [], skipped: [] };
  let st;
  try { st = await fs.promises.stat(p); } catch { return { ...out, error: 'There is no file or folder at "' + p + '".' }; }
  let names;
  let dir;
  if (st.isDirectory()) {
    dir = p;
    names = (await fs.promises.readdir(p, { withFileTypes: true })).filter(e => e.isFile() && !e.name.startsWith('.')).map(e => e.name).sort();
    if (!names.some(n => kindOf(n) === 'image' || kindOf(n) === 'video')) return { ...out, error: 'The folder "' + p + '" holds no image or video maps.' };
  } else { dir = path.dirname(p); names = [path.basename(p)]; }
  for (const name of names) {
    const kind = kindOf(name);
    if (!kind) { if (!st.isDirectory()) out.skipped.push({ name, reason: 'is not an image or an animated map.' }); continue; }
    if (kind === 'zip') { out.skipped.push({ name, reason: 'is an export zip; the DM imports it in Evermist.' }); continue; }
    if (out.files.length >= MAX_FOLDER_FILES) { out.skipped.push({ name, reason: 'was left out: a call takes at most ' + MAX_FOLDER_FILES + ' maps.' }); continue; }
    try {
      const full = path.join(dir, name);
      const size = (await fs.promises.stat(full)).size;
      if (size > MAX_FILE_BYTES) { out.skipped.push({ name, reason: 'is over 500 MB.' }); continue; }
      out.files.push({ name, type: mimeOf(name), bytes: await fs.promises.readFile(full) });
    } catch { out.skipped.push({ name, reason: 'could not be read.' }); }
  }
  return out;
}

module.exports = { findMapFiles, readMapFiles, MAX_RESULTS, MAX_FOLDER_FILES };
