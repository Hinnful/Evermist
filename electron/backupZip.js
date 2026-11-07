'use strict';
// backupZip.js — the backup zip: what goes into one, and what comes back out of it.

const { ipcMain, dialog, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const yauzl = require('yauzl');

let mapsDir, sendTo, isSafeId;

// The renderer names each picture from its id (galleryPlan.js); anything else is refused here.
const PICTURE_NAME_RE = /^pic-[a-z0-9]{1,32}\.(jpg|png|gif|webp|svg)$/;

function register(ctx) {
  ({ mapsDir, sendTo, isSafeId } = ctx);
}

// The running zip write or read, stopped by the progress window's Cancel. One at a time.
let stopZip = null;
ipcMain.handle('cancel-backup', () => { if (stopZip) stopZip(); });

// --- Backup / Restore IPC ---

ipcMain.handle('show-save-dialog', async (event, opts) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, opts || {});
  return canceled ? null : filePath;
});

// The export crosses one scene per call (open, add-scene, finish): a library past the renderer's memory cannot
// cross in one message. Video maps are read from mapsDir by id; image, fog and thumb arrive as ArrayBuffers.
let exp = null;

function wake(job) { const w = job.wake; job.wake = null; if (w) w(); }

// ⚠ Resolves only once archiver has written every entry appended so far, or main's queue grows without limit.
function drained(job) {
  return new Promise((resolve, reject) => {
    const check = () => {
      if (job.failed) return reject(job.failed);
      if (job.cancelled || job.closed || job.written >= job.appended) return resolve();
      job.wake = check;
    };
    check();
  });
}

function openExport(destPath) {
  const job = { appended: 0, written: 0, metas: [], missingVideos: [], opened: false, failed: null, cancelled: false, closed: false, wake: null };
  const out = fs.createWriteStream(destPath);
  const archive = archiver('zip', { zlib: { level: 6 } });
  job.archive = archive;
  // A failed or cancelled export leaves no half-written zip under the DM's name, but never deletes a file it could not open.
  job.ended = new Promise(resolve => out.on('close', resolve)).then(async () => {
    if ((job.failed || job.cancelled) && job.opened) await fs.promises.unlink(destPath).catch(() => {});
    job.closed = true;
    wake(job);
  });
  out.on('open', () => { job.opened = true; });
  const fail = (err) => {
    if (job.cancelled) return;
    job.failed = job.failed || err; archive.abort(); out.destroy(); wake(job);
  };
  out.on('error', fail);
  archive.on('error', fail);
  archive.on('entry', () => { job.written++; wake(job); });
  archive.pipe(out);
  job.stop = () => { job.cancelled = true; archive.abort(); out.destroy(); wake(job); };
  return job;
}

function appendTo(job, source, name) {
  job.appended++;
  if (typeof source === 'string') job.archive.file(source, { name });
  else job.archive.append(Buffer.from(source), { name });
}

ipcMain.handle('backup-zip-open', (_event, destPath) => {
  if (exp && !exp.closed) exp.stop();
  const job = openExport(destPath);
  exp = job;
  stopZip = () => job.stop();
});

// s is one scene: { id, mapType, mapExt, metadata, mapBuffer, fogBuffer, thumbBuffer, pictures: [{ name, buffer }] }.
ipcMain.handle('backup-zip-add-scene', async (event, s, done, total) => {
  const job = exp;
  if (!job || job.cancelled) return { cancelled: true };
  if (job.failed) throw job.failed;
  const base = `scenes/${s.id}`;
  let videoFile = null;
  if (s.mapType === 'video') {
    videoFile = path.join(mapsDir, s.id + s.mapExt);
    try { await fs.promises.access(videoFile); } catch { videoFile = null; }
    if (job.cancelled) return { cancelled: true };
  }
  job.metas.push(s.metadata);
  if (s.mapType === 'video') {
    // A scene whose file has gone leaves the zip with no map, and only the renderer can say so.
    if (videoFile) appendTo(job, videoFile, `${base}/map${s.mapExt}`);
    else job.missingVideos.push((s.metadata && s.metadata.name) || s.id);
  } else if (s.mapBuffer) {
    appendTo(job, s.mapBuffer, `${base}/map${s.mapExt}`);
  }
  if (s.fogBuffer)   appendTo(job, s.fogBuffer,   `${base}/fog.png`);
  if (s.thumbBuffer) appendTo(job, s.thumbBuffer, `${base}/thumb.jpg`);
  for (const p of s.pictures || []) {
    if (p && PICTURE_NAME_RE.test(p.name) && p.buffer) appendTo(job, p.buffer, `${base}/${p.name}`);
  }
  await drained(job);
  if (job.cancelled) return { cancelled: true };
  sendTo(event.sender, 'backup-progress', { done, total, phase: 'export' });
  return {};
});

// rest is null to abandon the export, or the campaign-level entries that land at the zip root beside manifest.json:
// moduleText, combat and campaign as JSON text, worldBg as { meta, buffer } or null, gallery as { meta, files: [{ name, buffer }] } or null.
ipcMain.handle('backup-zip-finish', async (_event, rest) => {
  const job = exp;
  if (!job) return { cancelled: true };
  try {
    if (!rest) { if (!job.closed) job.stop(); }
    else if (!job.cancelled && !job.failed) {
      const { archive } = job;
      archive.append(JSON.stringify(job.metas, null, 2), { name: 'manifest.json' });
      if (rest.moduleText) archive.append(rest.moduleText, { name: 'moduleText.json' });
      if (rest.combat) archive.append(rest.combat, { name: 'combat.json' });
      if (rest.campaign) archive.append(rest.campaign, { name: 'campaign.json' });
      const { worldBg, gallery } = rest;
      if (worldBg && worldBg.meta && worldBg.buffer) {
        archive.append(worldBg.meta, { name: 'world-background.json' });
        archive.append(Buffer.from(worldBg.buffer), { name: 'world-background.img' });
      }
      if (gallery && gallery.meta) {
        archive.append(gallery.meta, { name: 'gallery.json' });
        for (const p of gallery.files || []) {
          if (p && PICTURE_NAME_RE.test(p.name) && p.buffer) archive.append(Buffer.from(p.buffer), { name: `gallery/${p.name}` });
        }
      }
      // Its failures arrive on 'error' too.
      archive.finalize().catch(() => {});
    }
    await job.ended;
  } finally {
    if (exp === job) { exp = null; stopZip = null; }
  }
  if (job.cancelled || !rest) return { cancelled: true };
  if (job.failed) throw job.failed;
  return { missingVideos: job.missingVideos };
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
function readRootEntry(zipPath, name, asBuffer) {
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
            rs.on('end', () => { zipfile.close(); const all = Buffer.concat(chunks); resolve(asBuffer ? all : all.toString('utf8')); });
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
ipcMain.handle('read-backup-campaign', (_event, zipPath) => readRootEntry(zipPath, 'campaign.json'));
// The backdrop: its numbers and its picture, or null when the backup has none.
ipcMain.handle('read-backup-world-background', async (_event, zipPath) => {
  const meta = await readRootEntry(zipPath, 'world-background.json');
  const img = meta ? await readRootEntry(zipPath, 'world-background.img', true) : null;
  return meta && img ? { meta, buffer: img } : null;
});

// The gallery: its list and each picture's bytes by zip name, or null when the backup has none.
ipcMain.handle('read-backup-gallery', (_event, zipPath) => new Promise((resolve, reject) => {
  yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
    if (err) return reject(err);
    let meta = null;
    const files = {};
    zipfile.readEntry();
    zipfile.on('entry', entry => {
      const m = /^gallery\/([^/]+)$/.exec(entry.fileName);
      const isMeta = entry.fileName === 'gallery.json';
      if (!isMeta && !(m && PICTURE_NAME_RE.test(m[1]))) { zipfile.readEntry(); return; }
      zipfile.openReadStream(entry, (err2, rs) => {
        if (err2) { zipfile.close(); return reject(err2); }
        const chunks = [];
        rs.on('data', c => chunks.push(c));
        rs.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (isMeta) meta = buf.toString('utf8');
          else files[m[1]] = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
          zipfile.readEntry();
        });
        rs.on('error', e => { zipfile.close(); reject(e); });
      });
    });
    zipfile.on('end', () => { zipfile.close(); resolve(meta ? { meta, files } : null); });
    zipfile.on('error', reject);
  });
}));

const MAP_EXT_RE = /^\.[a-z0-9]{1,5}$/;

// A Buffer's bytes as an ArrayBuffer, copied only when the Buffer is a view into a larger one.
function toArrayBuffer(buf) {
  return buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength
    ? buf.buffer : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// One scene per call, so neither process holds more than one scene's files: a library past the renderer's memory
// cannot come back in one reply. a is {newId, originalId, mapType, mapExt, pictures?, want?, temp?}. `want` says which
// of map, fog and thumb to read (all when absent). A video map is written to mapsDir/{newId}.ext, or with `temp` to
// {newId}.ext.import, which settle-import-video renames into place once the scene's record is saved. All else
// returns as ArrayBuffers.
ipcMain.handle('extract-backup-scene', async (_event, zipPath, a) => {
  if (!isSafeId(a.newId))      throw new Error(`Invalid newId: ${a.newId}`);
  // The original id only names zip entries, never a file on disk, so any text will do.
  if (typeof a.originalId !== 'string' || !a.originalId || a.originalId.length > 200) throw new Error(`Invalid originalId: ${a.originalId}`);
  if (!MAP_EXT_RE.test(a.mapExt)) throw new Error(`Invalid mapExt: ${a.mapExt}`);

  const base = `scenes/${a.originalId}`;
  const parts = { map: `${base}/map${a.mapExt}`, fog: `${base}/fog.png`, thumb: `${base}/thumb.jpg` };
  const pathMap = {};
  for (const k of ['map', 'fog', 'thumb']) if (!a.want || a.want[k]) pathMap[parts[k]] = k;
  for (const name of (Array.isArray(a.pictures) ? a.pictures : []).filter(n => PICTURE_NAME_RE.test(n))) pathMap[`${base}/${name}`] = 'pic:' + name;
  let left = Object.keys(pathMap).length;

  const result = { newId: a.newId, mapBuffer: null, fogBuffer: null, thumbBuffer: null,
                   // false until an entry turns up; a zip can carry none for a video.
                   mapWritten: a.mapType !== 'video' || !pathMap[parts.map], pictures: {} };

  let writing = null, cancelled = false;
  stopZip = () => { cancelled = true; };
  await new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      if (cancelled || !left) { zipfile.close(); return resolve(); }
      // The renderer deletes whatever already landed in mapsDir; this only stops the reading.
      stopZip = () => { if (writing) writing.destroy(); zipfile.close(); resolve(); };
      const next = () => { if (--left === 0) { zipfile.close(); resolve(); } else zipfile.readEntry(); };
      zipfile.readEntry();

      zipfile.on('entry', entry => {
        const type = pathMap[entry.fileName];
        if (!type) { zipfile.readEntry(); return; }
        delete pathMap[entry.fileName];
        zipfile.openReadStream(entry, (err2, rs) => {
          if (err2) { zipfile.close(); return reject(err2); }

          if (type === 'map' && a.mapType === 'video') {
            const dest = path.join(mapsDir, a.newId + a.mapExt + (a.temp ? '.import' : ''));
            const ws = fs.createWriteStream(dest);
            writing = ws;
            rs.pipe(ws);
            ws.on('finish', () => { writing = null; result.mapWritten = true; next(); });
            ws.on('error', e => { zipfile.close(); reject(e); });
            // ⚠ pipe() forwards no error: without this a damaged entry hangs the whole restore.
            rs.on('error', e => { ws.destroy(); zipfile.close(); reject(e); });
          } else {
            const chunks = [];
            rs.on('data', c => chunks.push(c));
            rs.on('end', () => {
              const ab = toArrayBuffer(Buffer.concat(chunks));
              if (type === 'map')        result.mapBuffer   = ab;
              else if (type === 'fog')   result.fogBuffer   = ab;
              else if (type === 'thumb') result.thumbBuffer = ab;
              else result.pictures[type.slice(4)] = ab;
              next();
            });
            rs.on('error', e => { zipfile.close(); reject(e); });
          }
        });
      });

      zipfile.on('end', () => { zipfile.close(); resolve(); });
      zipfile.on('error', reject);
    });
  }).finally(() => { stopZip = null; });

  return result;
});

// An imported video written under a temporary name: moved over the old file, or deleted.
ipcMain.handle('settle-import-video', async (_event, id, ext, keep) => {
  if (!isSafeId(id) || !MAP_EXT_RE.test(ext)) throw new Error('Invalid video name');
  const tmp = path.join(mapsDir, id + ext + '.import');
  if (!keep) { await fs.promises.unlink(tmp).catch(() => {}); return; }
  const dest = path.join(mapsDir, id + ext);
  await fs.promises.rename(tmp, dest);
  // ⚠ The readers try .webm before .mp4, so a map whose file type changed would go on playing the old file.
  // One that cannot go (being played) fails the settle, and the import keeps the old map whole.
  for (const other of ['.webm', '.mp4']) {
    if (other === ext) continue;
    try { await fs.promises.unlink(path.join(mapsDir, id + other)); } catch (e) {
      if (e.code === 'ENOENT') continue;
      await fs.promises.rename(dest, tmp);
      throw e;
    }
  }
});

module.exports = { register };
