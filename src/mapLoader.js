'use strict';
// mapLoader.js — image-map loading (loadMapFromFile) + shared progress-bar helpers
// (showMapProgress / updateMapProgress / hideMapProgress) used by backup.js and sceneManager.js.
// Video loading lives in video.js; render helpers (scheduleRender, fitToScreen) stay in the inline script.

function loadMapFromFile(file, onMapLoaded) {
  if (!file) return;
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|gif|bmp|webp|svg)$/i.test(file.name)) return;
  cleanupVideo();
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onerror = () => { URL.revokeObjectURL(url); hideMapProgress(); alert('Failed to load map image.'); };
  img.onload = () => {
    mapWidth  = img.naturalWidth;
    mapHeight = img.naturalHeight;

    mapOffscreen = document.createElement('canvas');
    mapOffscreen.width  = mapWidth;
    mapOffscreen.height = mapHeight;
    mapOffscreen.getContext('2d').drawImage(img, 0, 0);

    if (mapBitmap) { mapBitmap.close(); mapBitmap = null; }
    pixiSetMap(prepareTextureCanvas(mapOffscreen, mapWidth, mapHeight), mapWidth, mapHeight);
    minimapSeedView();
    viewportDirty = true;
    scheduleRender();
    if (onMapLoaded) onMapLoaded(mapOffscreen, file);

    fogDataCanvas = document.createElement('canvas');
    fogDataCanvas.width  = Math.ceil(mapWidth  / FOG_SCALE);
    fogDataCanvas.height = Math.ceil(mapHeight / FOG_SCALE);
    fogDataCtx = fogDataCanvas.getContext('2d');
    fogDataCtx.fillStyle = '#1a1a2e';
    fogDataCtx.fillRect(0, 0, fogDataCanvas.width, fogDataCanvas.height);

    baseFogCanvas = document.createElement('canvas');
    baseFogCanvas.width = fogDataCanvas.width;
    baseFogCanvas.height = fogDataCanvas.height;
    baseFogCtx = baseFogCanvas.getContext('2d');
    baseFogCtx.fillStyle = '#1a1a2e';
    baseFogCtx.fillRect(0, 0, baseFogCanvas.width, baseFogCanvas.height);

    polygons = []; activePolygon = null; selectedPolygonId = null;
    nextPolygonId = 1;
    playerMapSent = false;

    if (!cloudPattern) generateCloudFrames(512, CLOUD_FRAME_COUNT);
    rebuildFogEffect();
    if (!isPlayer) { pixiInitFog(fogDataCanvas, fogBlurCanvas, cloudBlendCanvas, mapWidth, mapHeight); pixiFlushTexturePool(); pixiUpdateFogBlurTexture(); }

    URL.revokeObjectURL(url);
    fitToScreen();
    if (!isPlayer) container.style.cursor = 'crosshair';
    landing.style.display = 'none';
    viewportDirty = true;
    scheduleRender();
  };
  img.src = url;
}

function showMapProgress(label) {
  document.getElementById('map-progress-label').textContent = label || 'Saving...';
  document.getElementById('map-progress-bar').style.width = '0%';
  document.getElementById('map-progress').style.display = 'flex';
}
function updateMapProgress(pct) {
  document.getElementById('map-progress-bar').style.width = Math.min(100, pct) + '%';
}
function hideMapProgress() {
  document.getElementById('map-progress').style.display = 'none';
}

if (window.electronAPI && window.electronAPI.onVideoSaveProgress) {
  window.electronAPI.onVideoSaveProgress(({ written, total }) => {
    updateMapProgress(Math.round((written / total) * 100));
  });
}
