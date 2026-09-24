'use strict';
// backupZip.js — the backup zip: what goes into one, and what comes back out of it.

const { ipcMain, dialog, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const yauzl = require('yauzl');

let mapsDir, sendTo, isSafeId;

function register(ctx) {
  ({ mapsDir, sendTo, isSafeId } = ctx);
}

// --- Backup / Restore IPC ---

ipcMain.handle('show-save-dialog', async (event, opts) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, opts || {});
  return canceled ? null : filePath;
});

// Video maps are read from mapsDir by id; image, fog and thumb arrive as ArrayBuffers.
// moduleText and combat are campaign-level, so they land at the zip root beside manifest.json.
ipcMain.handle('create-backup-zip', async (event, destPath, scenesData, moduleText, combat) => {
  for (const s of scenesData) {
    if (s.mapType === 'video') {
      try { await fs.promises.access(path.join(mapsDir, s.id + s.mapExt)); s._videoExists = true; }
      catch { s._videoExists = false; }
    }
  }

  // A scene whose file has gone leaves the zip with no map, and only the renderer can say so.
  const missingVideos = scenesData.filter(s2 => s2.mapType === 'video' && !s2._videoExists)
                                  .map(s2 => (s2.metadata && s2.metadata.name) || s2.id);

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(destPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    out.on('close', resolve);
    out.on('error', reject);
    archive.on('error', reject);
    archive.pipe(out);

    archive.append(JSON.stringify(scenesData.map(s => s.metadata), null, 2), { name: 'manifest.json' });
    if (moduleText) archive.append(moduleText, { name: 'moduleText.json' });
    if (combat) archive.append(combat, { name: 'combat.json' });

    scenesData.forEach((s, idx) => {
      const base = `scenes/${s.id}`;
      if (s.mapType === 'video') {
        if (s._videoExists) archive.file(path.join(mapsDir, s.id + s.mapExt), { name: `${base}/map${s.mapExt}` });
      } else if (s.mapBuffer) {
        archive.append(Buffer.from(s.mapBuffer), { name: `${base}/map${s.mapExt}` });
      }
      if (s.fogBuffer)   archive.append(Buffer.from(s.fogBuffer),   { name: `${base}/fog.png` });
      if (s.thumbBuffer) archive.append(Buffer.from(s.thumbBuffer), { name: `${base}/thumb.jpg` });
      sendTo(event.sender, 'backup-progress', { done: idx + 1, total: scenesData.length, phase: 'export' });
    });

    archive.finalize();
  });

  return { missingVideos };
});

// Returns parsed manifest.json array from the zip.
ipcMain.handle('read-backup-manifest', async (_event, zipPath) => {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      zipfile.readEntry();
      zipfile.on('entry', entry => {
        if (entry.fileName === 'manifest.json') {
          zipfile.openReadStream(entry, (err2, rs) => {
            if (err2) { zipfile.close(); return reject(err2); }
            const chunks = [];
            rs.on('data', c => chunks.push(c));
            rs.on('end', () => {
              try { zipfile.close(); resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
              catch (e) { reject(e); }
            });
            rs.on('error', e => { zipfile.close(); reject(e); });
          });
        } else {
          zipfile.readEntry();
        }
      });
      zipfile.on('end', () => { zipfile.close(); reject(new Error('manifest.json not found in zip')); });
      zipfile.on('error', reject);
    });
  });
});

// Returns a root entry from the zip as a RAW STRING, or null. Absence RESOLVES NULL rather than
// rejecting, unlike the manifest above: a backup older than the entry is the normal case.
function readRootEntry(zipPath, name) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      zipfile.readEntry();
      zipfile.on('entry', entry => {
        if (entry.fileName === name) {
          zipfile.openReadStream(entry, (err2, rs) => {
            if (err2) { zipfile.close(); return reject(err2); }
            const chunks = [];
            rs.on('data', c => chunks.push(c));
            rs.on('end', () => { zipfile.close(); resolve(Buffer.concat(chunks).toString('utf8')); });
            rs.on('error', e => { zipfile.close(); reject(e); });
          });
        } else {
          zipfile.readEntry();
        }
      });
      zipfile.on('end', () => { zipfile.close(); resolve(null); });
      zipfile.on('error', reject);
    });
  });
}
ipcMain.handle('read-backup-module-text', (_event, zipPath) => readRootEntry(zipPath, 'moduleText.json'));
ipcMain.handle('read-backup-combat', (_event, zipPath) => readRootEntry(zipPath, 'combat.json'));

// assignments: [{newId, originalId, mapType, mapExt}]
// Video maps are written to mapsDir/{newId}.ext; all others returned as ArrayBuffers.
ipcMain.handle('extract-backup-scenes', async (event, zipPath, assignments) => {
  for (const a of assignments) {
    if (!isSafeId(a.newId))      throw new Error(`Invalid newId: ${a.newId}`);
    if (!isSafeId(a.originalId)) throw new Error(`Invalid originalId: ${a.originalId}`);
  }

  // Map zip entry path → assignment role
  const pathMap = {};
  assignments.forEach(a => {
    const base = `scenes/${a.originalId}`;
    pathMap[`${base}/map${a.mapExt}`] = { newId: a.newId, type: 'map', a };
    pathMap[`${base}/fog.png`]        = { newId: a.newId, type: 'fog', a };
    pathMap[`${base}/thumb.jpg`]      = { newId: a.newId, type: 'thumb', a };
  });

  const results = {};
  const pending = {};
  assignments.forEach(a => {
    results[a.newId] = { newId: a.newId, mapBuffer: null, fogBuffer: null, thumbBuffer: null,
                         // false until an entry turns up; a zip can carry none for a video.
                         mapWritten: a.mapType !== 'video' };
    pending[a.newId] = ['map', 'fog', 'thumb'];
  });
  let doneScenes = 0;

  const markDone = (newId, type) => {
    const p = pending[newId];
    const i = p.indexOf(type);
    if (i !== -1) p.splice(i, 1);
    if (p.length === 0) {
      doneScenes++;
      sendTo(event.sender, 'backup-progress', { done: doneScenes, total: assignments.length, phase: 'restore' });
    }
  };

  await new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      zipfile.readEntry();

      zipfile.on('entry', entry => {
        if (/\/$/.test(entry.fileName)) { zipfile.readEntry(); return; }
        const info = pathMap[entry.fileName];
        if (!info) { zipfile.readEntry(); return; }

        const { newId, type, a } = info;
        zipfile.openReadStream(entry, (err2, rs) => {
          if (err2) { zipfile.close(); return reject(err2); }

          if (type === 'map' && a.mapType === 'video') {
            const dest = path.join(mapsDir, newId + a.mapExt);
            const ws = fs.createWriteStream(dest);
            rs.pipe(ws);
            ws.on('finish', () => { results[newId].mapWritten = true; markDone(newId, type); zipfile.readEntry(); });
            ws.on('error', e => { zipfile.close(); reject(e); });
            // ⚠ pipe() forwards no error: without this a damaged entry hangs the whole restore.
            rs.on('error', e => { ws.destroy(); zipfile.close(); reject(e); });
          } else {
            const chunks = [];
            rs.on('data', c => chunks.push(c));
            rs.on('end', () => {
              const buf = Buffer.concat(chunks);
              const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
              if (type === 'map')        results[newId].mapBuffer   = ab;
              else if (type === 'fog')   results[newId].fogBuffer   = ab;
              else if (type === 'thumb') results[newId].thumbBuffer = ab;
              markDone(newId, type);
              zipfile.readEntry();
            });
            rs.on('error', e => { zipfile.close(); reject(e); });
          }
        });
      });

      // A FINAL 100%. pending[] is seeded with all three parts, but a zip need not carry every
      // one, and such a scene never empties its list — so the bar stops short of a finished
      // restore without this.
      zipfile.on('end', () => {
        zipfile.close();
        if (doneScenes < assignments.length) {
          sendTo(event.sender, 'backup-progress',
            { done: assignments.length, total: assignments.length, phase: 'restore' });
        }
        resolve();
      });
      zipfile.on('error', reject);
    });
  });

  return Object.values(results);
});

module.exports = { register };
