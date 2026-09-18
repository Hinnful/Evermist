'use strict';
// videoFiles.js — an animated map's own file on disk: written on import, read back for the
// Player, listed for the memory probe, removed with its scene.

const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mapsDir, sendTo, isSafeId;

function register(ctx) {
  ({ mapsDir, sendTo, isSafeId } = ctx);
}

// --- Video file storage IPC ---

ipcMain.handle('save-video-file', async (event, sourcePath, sceneId, mimeType) => {
  if (!isSafeId(sceneId)) throw new Error(`Invalid sceneId: ${sceneId}`);
  const ext = mimeType === 'video/mp4' ? '.mp4' : '.webm';
  const destPath = path.join(mapsDir, sceneId + ext);
  const stat = await fs.promises.stat(sourcePath);
  const total = stat.size;
  return new Promise((resolve, reject) => {
    let written = 0;
    const rs = fs.createReadStream(sourcePath);
    const ws = fs.createWriteStream(destPath);
    // A half-copied map plays as a broken clip rather than reporting, so a failure unlinks it.
    const fail = (err) => {
      rs.destroy(); ws.destroy();
      fs.promises.unlink(destPath).catch(() => {}).then(() => reject(err));
    };
    rs.on('data', (chunk) => {
      written += chunk.length;
      sendTo(event.sender, 'video-save-progress', { sceneId, written, total });
    });
    rs.on('error', fail);
    ws.on('error', fail);
    ws.on('finish', () => resolve(destPath));
    rs.pipe(ws);
  });
});

ipcMain.handle('save-video-blob', async (event, sceneId, arrayBuffer, mimeType) => {
  if (!isSafeId(sceneId)) throw new Error(`Invalid sceneId: ${sceneId}`);
  const ext = mimeType === 'video/mp4' ? '.mp4' : '.webm';
  const destPath = path.join(mapsDir, sceneId + ext);
  const buffer = Buffer.from(arrayBuffer);
  const total = buffer.length;
  const CHUNK = 4 * 1024 * 1024;
  const fd = await fs.promises.open(destPath, 'w');
  try {
    let written = 0;
    while (written < total) {
      const end = Math.min(written + CHUNK, total);
      await fd.write(buffer, written, end - written);
      written = end;
      sendTo(event.sender, 'video-save-progress', { sceneId, written, total });
    }
  } finally {
    await fd.close();
  }
  return destPath;
});

ipcMain.handle('get-video-file-path', async (_event, sceneId) => {
  if (!isSafeId(sceneId)) return null;
  for (const ext of ['.webm', '.mp4']) {
    const filePath = path.join(mapsDir, sceneId + ext);
    try {
      await fs.promises.access(filePath);
      return filePath;
    } catch {}
  }
  return null;
});

// Read a scene's video into an ArrayBuffer so the Player plays an in-memory blob rather than the
// file:// path the DM is already streaming. ⚠ Two <video> elements on one file starve Chromium's
// media pipeline and both windows stall.
ipcMain.handle('read-video-file', async (_event, sceneId) => {
  if (!isSafeId(sceneId)) return null;
  for (const ext of ['.webm', '.mp4']) {
    const filePath = path.join(mapsDir, sceneId + ext);
    try {
      const buf = await fs.promises.readFile(filePath);
      // Hand back an exact-length ArrayBuffer for structured-clone transfer.
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } catch {}
  }
  return null;
});

// Lists the video maps present on disk with their sizes, so the memory probe can pick the
// largest one to measure. Read-only, and it never leaves mapsDir.
ipcMain.handle('list-map-files', async () => {
  try {
    const names = await fs.promises.readdir(mapsDir);
    const out = [];
    for (const n of names) {
      const m = n.match(/^([0-9a-zA-Z_-]+)\.(webm|mp4)$/);
      if (!m) continue;
      try {
        const st = await fs.promises.stat(path.join(mapsDir, n));
        if (st.isFile()) out.push({ id: m[1], ext: m[2], size: st.size });
      } catch {}
    }
    return out;
  } catch { return []; }
});

ipcMain.handle('delete-video-file', async (_event, sceneId) => {
  if (!isSafeId(sceneId)) return;
  for (const ext of ['.webm', '.mp4']) {
    try { await fs.promises.unlink(path.join(mapsDir, sceneId + ext)); } catch {}
  }
});

module.exports = { register };
