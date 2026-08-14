'use strict';
// mapLoader.js — image-map loading (loadMapFromFile) + shared progress-bar helpers
// (showMapProgress / updateMapProgress / hideMapProgress) used by backup.js and sceneManager.js.
// Video loading lives in video.js; render helpers (scheduleRender, fitToScreen) stay in the inline script.

// ⚠ EVERY EXIT ANSWERS. onMapLoaded fires on success; onFail fires on ALL FOUR ways this can
// end badly, including the two that used to return silently. An import loop awaits one of the two
// callbacks, so a silent return leaves it waiting forever with the progress overlay up.
//
// Passing onFail also hands the REPORTING to the caller — it knows whether this file is one of
// ten, and two dialogs for one bad map is worse than one. Without it, this shows its own dialog
// exactly as it always did (replaceSceneMap's path).
function loadMapFromFile(file, onMapLoaded, onFail) {
  const fail = reason => {
    hideMapProgress();
    if (onFail) onFail(reason);
    else messageDialog({
      title: 'Map would not open',
      message: 'Evermist could not read this image. It may be damaged, or saved in a format the app does not handle.',
    });
  };
  if (!file) { fail('is not a file Evermist can read.'); return; }
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|gif|bmp|webp|svg)$/i.test(file.name)) {
    fail('is not an image or an animated map.');
    return;
  }
  cleanupVideo();
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onerror = () => {
    URL.revokeObjectURL(url);
    fail('could not be read. It may be damaged, or saved in a format the app does not handle.');
  };
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

// A batch import sets this to "Map 3 of 10 - Watcherhouse" and every stage label that follows
// carries it, so the DM can see where the run is without the loop having to hold the overlay up
// across ten maps — each map still raises and lowers its own, which is what keeps the overlay from
// ever sitting above a dialog.
let _mapProgressPrefix = '';
function setMapProgressPrefix(prefix) { _mapProgressPrefix = prefix || ''; }

function showMapProgress(label) {
  document.getElementById('map-progress-label').textContent =
    (_mapProgressPrefix ? _mapProgressPrefix + ' - ' : '') + (label || 'Saving...');
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
