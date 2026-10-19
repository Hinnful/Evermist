'use strict';
// mapFiles.js — the IPC behind Claude's map tools: a search of the DM's usual folders, and the bytes of a
// map file or of the maps in a folder. The scanning itself is mapScan.js.

const { app, ipcMain } = require('electron');
const { findMapFiles, readMapFiles } = require('./mapScan.js');

const FOLDERS = ['downloads', 'desktop', 'documents', 'pictures'];

function roots() {
  const out = [];
  for (const name of FOLDERS) { try { out.push(app.getPath(name)); } catch { /* no such folder here */ } }
  return out;
}

function register() {
  ipcMain.handle('find-map-files', (_event, query) => findMapFiles(roots(), { query: typeof query === 'string' ? query : '' }).catch(() => []));
  ipcMain.handle('read-map-files', (_event, p) => (typeof p === 'string' && p ? readMapFiles(p) : { files: [], skipped: [], error: 'A path is needed.' }));
}

module.exports = { register };
