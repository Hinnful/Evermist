'use strict';
// mapLoader.js — image-map loading (loadMapFromFile) + shared progress-bar helpers
// (showMapProgress / updateMapProgress / hideMapProgress) used by backup.js, mapImport.js and sceneSwitch.js.
// Video loading lives in video.js; render helpers (scheduleRender, fitToScreen) stay in the inline script.

// ⚠ EVERY EXIT ANSWERS. onMapLoaded fires on success; onFail fires on ALL FOUR ways this can
// end badly, including the two that used to return silently. An import loop awaits one of the two
// callbacks, so a silent return leaves it waiting forever with the progress overlay up.
//
// Passing onFail also hands the REPORTING to the caller — it knows whether this file is one of
// ten, and two dialogs for one bad map is worse than one. Without it, this reports for itself.
function loadMapFromFile(file, onMapLoaded, onFail) {
  const fail = reason => {
    hideMapProgress();
    if (onFail) onFail(reason);
    else messageDialog({
      title: 'Map would not open',
      message: 'Evermist could not read this image. It may be damaged, or saved in a format the app does not handle.',
    });
  };
  if (!file) { fail(t('is not a file Evermist can read.')); return; }
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|gif|bmp|webp|svg)$/i.test(file.name)) {
    fail(t('is not an image or an animated map.'));
    return;
  }
  cleanupVideo();
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onerror = () => {
    URL.revokeObjectURL(url);
    fail(t('could not be read. It may be damaged, or saved in a format the app does not handle.'));
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

    polygons = []; activePolygon = null; clearShapeSelection();
    nextPolygonId = 1;
    clearEffects(); nextEffectId = 1;
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

// A batch import sets the count ("3 of 10") and the file, and every stage that follows shows them,
// so the DM can see where the run is without the loop having to hold the overlay up across ten
// maps — each map still raises and lowers its own, which is what keeps the overlay from ever
// sitting above a dialog.
let _mapProgressCount = '', _mapProgressFile = '';
function setMapProgressRun(count, file) { _mapProgressCount = count || ''; _mapProgressFile = file || ''; }

// A long job the DM can stop. `ask` is the question Cancel puts first; the job reads `stopped`
// between its own steps and undoes what it must.
let _mapJob = null, _mapProgressUp = false, _mapProgressAsking = false;
function mapJobStart(ask, onStop) {
  _mapJob = { stopped: false, ask, onStop };
  _mapProgressPaint();
  return _mapJob;
}
function mapJobEnd(job) {
  if (_mapJob === job) _mapJob = null;
  _mapProgressPaint();
}
function mapJobStopped() { return !!(_mapJob && _mapJob.stopped); }

// ⚠ The overlay sits above every dialog, so it steps aside while the question is up.
function _mapProgressPaint() {
  const el = document.getElementById('map-progress');
  el.style.display = _mapProgressUp && !_mapProgressAsking ? 'flex' : 'none';
  el.classList.toggle('stoppable', !!(_mapJob && !_mapJob.stopped));
}

function _mapProgressAsk() {
  const job = _mapJob;
  if (!job || job.stopped) return;
  _mapProgressAsking = true;
  _mapProgressPaint();
  const back = () => { _mapProgressAsking = false; _mapProgressPaint(); };
  confirmDialog({
    title: job.ask.title, message: job.ask.message, confirmLabel: 'Stop', cancelLabel: 'Keep going',
    onConfirm: () => {
      if (_mapJob === job) {
        job.stopped = true;
        document.getElementById('map-progress-label').textContent = t('Stopping…');
        if (job.onStop) job.onStop();
      }
      back();
    },
    onCancel: back,
  });
}

function showMapProgress(label) {
  document.getElementById('map-progress-label').textContent = t(mapJobStopped() ? 'Stopping…' : label || 'Saving...');
  document.getElementById('map-progress-count').textContent = _mapProgressCount;
  document.getElementById('map-progress-file').textContent = _mapProgressFile;
  document.getElementById('map-progress-bar').style.width = '0%';
  _mapProgressUp = true;
  _mapProgressPaint();
}
function updateMapProgress(pct) {
  document.getElementById('map-progress-bar').style.width = Math.min(100, pct) + '%';
}
function hideMapProgress() {
  _mapProgressUp = false;
  _mapProgressPaint();
}

document.getElementById('map-progress-stop').addEventListener('click', _mapProgressAsk);

if (window.electronAPI && window.electronAPI.onVideoSaveProgress) {
  window.electronAPI.onVideoSaveProgress(({ written, total }) => {
    updateMapProgress(Math.round((written / total) * 100));
  });
}
