'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  setFullScreen: (flag) => ipcRenderer.send('set-fullscreen', flag),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),

  saveVideoFile: (sourcePath, sceneId, mimeType) =>
    ipcRenderer.invoke('save-video-file', sourcePath, sceneId, mimeType),
  saveVideoBlob: (sceneId, arrayBuffer, mimeType) =>
    ipcRenderer.invoke('save-video-blob', sceneId, arrayBuffer, mimeType),
  getVideoFilePath: (sceneId) =>
    ipcRenderer.invoke('get-video-file-path', sceneId),
  deleteVideoFile: (sceneId) =>
    ipcRenderer.invoke('delete-video-file', sceneId),
  onVideoSaveProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('video-save-progress', handler);
    return () => ipcRenderer.removeListener('video-save-progress', handler);
  },

  showSaveDialog: (opts) => ipcRenderer.invoke('show-save-dialog', opts),
  showOpenDialog: (opts) => ipcRenderer.invoke('show-open-dialog', opts),
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
});
