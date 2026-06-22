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
});
