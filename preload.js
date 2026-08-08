'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  // Electron 32 removed File.path. webUtils.getPathForFile is the supported
  // replacement and MUST be called here in the preload — it is not available to the
  // renderer under contextIsolation. Returns null for a File with no path on disk
  // (one built in-page rather than picked or dropped), so callers can fall back to
  // sending bytes. Without this, saveVideoFile(file.path, …) rejected with
  // ERR_INVALID_ARG_TYPE and stranded the "Saving video map…" overlay forever.
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file) || null; } catch (_) { return null; }
  },

  // A Dungeon Alchemist map ships with its floor plan as a sibling file. Main resolves the
  // sibling from the map's own path; there is deliberately no way to ask it for an
  // arbitrary path. Resolves to { name, text } or null.
  findFloorPlan: (mapPath) => ipcRenderer.invoke('find-floor-plan', mapPath),

  setFullScreen: (flag) => ipcRenderer.send('set-fullscreen', flag),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),

  saveVideoFile: (sourcePath, sceneId, mimeType) =>
    ipcRenderer.invoke('save-video-file', sourcePath, sceneId, mimeType),
  saveVideoBlob: (sceneId, arrayBuffer, mimeType) =>
    ipcRenderer.invoke('save-video-blob', sceneId, arrayBuffer, mimeType),
  getVideoFilePath: (sceneId) =>
    ipcRenderer.invoke('get-video-file-path', sceneId),
  readVideoFile: (sceneId) =>
    ipcRenderer.invoke('read-video-file', sceneId),
  deleteVideoFile: (sceneId) =>
    ipcRenderer.invoke('delete-video-file', sceneId),
  onVideoSaveProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('video-save-progress', handler);
    return () => ipcRenderer.removeListener('video-save-progress', handler);
  },

  // A campaign module ships as a PDF, so the app converts it. Main-process only, because
  // pdfjs-dist is ESM-only and browser-side `import` breaks on file:// — see main.js.
  extractPdfText: (arrayBuffer) => ipcRenderer.invoke('extract-pdf-text', arrayBuffer),

  showSaveDialog: (opts) => ipcRenderer.invoke('show-save-dialog', opts),
  createBackupZip: (destPath, scenesData) => ipcRenderer.invoke('create-backup-zip', destPath, scenesData),
  readBackupManifest: (zipPath) => ipcRenderer.invoke('read-backup-manifest', zipPath),
  extractBackupScenes: (zipPath, assignments) => ipcRenderer.invoke('extract-backup-scenes', zipPath, assignments),
  onBackupProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('backup-progress', handler);
    return () => ipcRenderer.removeListener('backup-progress', handler);
  },

  onDisplayInfo: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('display-info', handler);
    return () => ipcRenderer.removeListener('display-info', handler);
  },

  // Fires when the OS minimizes or restores this window — visibilitychange does
  // not fire reliably on Windows minimize, so we use the main-process event instead.
  onWindowVisibility: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('window-visibility', handler);
    return () => ipcRenderer.removeListener('window-visibility', handler);
  },

  diagAppendLine: (mode, line) => ipcRenderer.send('diag-append-line', mode, line),

  // Per-process working set for the memory probe (src/memProbe.js). Main-process only:
  // a renderer sees just its own JS heap, and the allocations that matter here are native.
  memMetrics: () => ipcRenderer.invoke('mem-metrics'),
  listMapFiles: () => ipcRenderer.invoke('list-map-files'),
});
