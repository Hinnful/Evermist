// viewport.js — view sync helpers + Player map delivery
// Loaded before the inline script; function bodies reference inline-script globals
// lazily (resolved at call time, not definition time).

// ─── Pure coordinate helpers ──────────────────────────────────────────────────

// Compute the source/destination rectangles for a pan+zoom viewport.
// Pure function — takes explicit params so it can be tested without DOM.
// Returns { cw, ch, srcX, srcY, srcW, srcH, dstX, dstY, dstW, dstH }.
function calcViewportRect(panX, panY, zoom, mapW, mapH, vpW, vpH) {
  const srcX = Math.max(0, -panX / zoom);
  const srcY = Math.max(0, -panY / zoom);
  const srcW = Math.min(mapW - srcX, vpW / zoom);
  const srcH = Math.min(mapH - srcY, vpH / zoom);
  const dstX = Math.max(0, panX);
  const dstY = Math.max(0, panY);
  const dstW = srcW * zoom;
  const dstH = srcH * zoom;
  return { cw: vpW, ch: vpH, srcX, srcY, srcW, srcH, dstX, dstY, dstW, dstH };
}

// Map → screen coordinate conversion. Reads pan/zoom globals lazily.
function toScreen(mapX, mapY) {
  return { sx: mapX * zoom + panX, sy: mapY * zoom + panY };
}

function resolveView(v) {
  const { w: vpW, h: vpH } = getViewportSize();
  return {
    panX: vpW / 2 - v.mapCX * v.zoom,
    panY: vpH / 2 - v.mapCY * v.zoom,
    zoom: v.zoom,
  };
}

function applyView(v) {
  const r = resolveView(v);
  panX = r.panX; panY = r.panY; zoom = r.zoom;
}

// ─── Screen ↔ map + fit-to-screen ─────────────────────────────────────────────

function screenToMap(clientX, clientY) {
  const rect = container.getBoundingClientRect();
  return {
    x: (clientX - rect.left - panX) / zoom,
    y: (clientY - rect.top  - panY) / zoom,
  };
}

function fitToScreen() {
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  zoom = Math.min(cw / mapWidth, ch / mapHeight) * 0.95;
  panX = (cw - mapWidth  * zoom) / 2;
  panY = (ch - mapHeight * zoom) / 2;
  pixiSetViewport(zoom, panX, panY);
}

function startViewLerp(target) {
  viewLerpFrom  = { panX, panY, zoom };
  viewLerpTo    = { panX: target.panX, panY: target.panY, zoom: target.zoom };
  viewLerpStart = performance.now();
  viewLerpActive = true;
  requestAnimationFrame(viewLerpTick);
}

function viewLerpTick(ts) {
  if (!viewLerpActive) return;
  const t    = Math.min((ts - viewLerpStart) / VIEW_LERP_MS, 1);
  const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  panX = viewLerpFrom.panX + (viewLerpTo.panX - viewLerpFrom.panX) * ease;
  panY = viewLerpFrom.panY + (viewLerpTo.panY - viewLerpFrom.panY) * ease;
  zoom = viewLerpFrom.zoom + (viewLerpTo.zoom - viewLerpFrom.zoom) * ease;
  viewportDirty = true;
  scheduleRender();
  if (t < 1) requestAnimationFrame(viewLerpTick);
  else viewLerpActive = false;
}

function notifyDMOfMode() {
  if (!window.opener) return;
  const msg = { type: 'PLAYER_MODE', mode: playerFollowDM ? 'follow' : 'freelook' };
  if (!playerFollowDM) {
    const { w: vpW, h: vpH } = getViewportSize();
    msg.mapCX = (vpW / 2 - panX) / zoom;
    msg.mapCY = (vpH / 2 - panY) / zoom;
    msg.zoom  = zoom;
  }
  window.opener.postMessage(msg, '*');
}

function updatePlayerModeIndicator() {
  const btn = document.getElementById('btn-player');
  if (!btn) return;
  btn.classList.toggle('player-following', playerFollowMode);
  btn.classList.toggle('player-freelook',  !playerFollowMode);
}

// ─── Player map-request protocol ─────────────────────────────────────────────

// Deferred player resync: set when the Player requests the map (PLAYER_READY / need-map)
// but the DM has no scene loaded yet (e.g. mid-scene-switch on a large video). Once the
// scene finishes loading, onSceneLoaded() flushes the pending request.
let _playerResyncPending = false;

// Called once during Player init. Sends need-map to the DM, retrying every 5 s
// (up to 6 attempts, ~34 s total) until mapOffscreen is populated.
function initPlayerMapRetry() {
  let attempts = 0;
  function tryNeedMap() {
    if (mapOffscreen || !window.opener || attempts >= 6) return;
    attempts++;
    window.opener.postMessage({ type: 'need-map' }, '*');
    setTimeout(tryNeedMap, 5000);
  }
  setTimeout(tryNeedMap, 4000);
}

// Called by the DM message handler instead of setting playerMapSent inline.
// Sends immediately if mapOffscreen is ready; defers to onSceneLoaded() if not.
function onPlayerResyncRequest() {
  _playerResyncPending = true;
  playerMapSent = false;
  sendToPlayer();
}

// Called at the end of a successful switchScene load.
// If the Player asked for the map while the scene was loading, send it now.
function onSceneLoaded() {
  if (!_playerResyncPending) return;
  _playerResyncPending = false;
  sendToPlayer();
}

function sendToPlayer(fogOnly = false, sceneChange = false) {
  if (!mapOffscreen || !fogDataCanvas || !playerWindow || playerWindow.closed) return;

  // Fog sent at 1/4 scale (native fogDataCanvas size) — much smaller than upscaling.
  const fogDataUrl = fogDataCanvas.toDataURL('image/png');

  // fogOnly=true (Auto-sync): omit view so player keeps its pan/zoom.
  // fogOnly=false (manual Send/Sync): include view so player follows DM viewport.
  let view;
  if (!fogOnly) {
    const { w: vpW, h: vpH } = getViewportSize();
    view = { mapCX: (vpW / 2 - panX) / zoom, mapCY: (vpH / 2 - panY) / zoom, zoom };
  }

  const isShroud   = fogTransIsShroud;
  // Only trigger a Player transition when fog actually changed.
  // Grid toggles / manual Send leave fogTransRafId null → fogChanged=false → no flash.
  const fogChanged = fogTransRafId !== null;

  if (!playerMapSent) {
    const sendMap = (mapUrl, mapType) => {
      playerWindow.postMessage({
        type: 'fog-update',
        mapUrl, mapType, mapWidth, mapHeight, fogDataUrl, view, isShroud, sceneChange, fogChanged,
        mapSceneId: currentScene ? currentScene.id : null,
        sceneName: currentScene ? currentScene.name : null,
        gridEnabled, gridSize, gridOffsetX, gridOffsetY, gridColor, gridOpacity, gridMode, gridLineWidth,
        pickedHex: fogPickedHex, fogTintAlpha: FOG_TINT_ALPHA,
      }, '*');
      playerMapSent = true;
    };
    if (currentScene && currentScene.mapPath && window.electronAPI) {
      window.electronAPI.getVideoFilePath(currentScene.id).then(absPath => {
        if (!absPath || !playerWindow || playerWindow.closed) return;
        sendMap('file:///' + absPath.replace(/\\/g, '/'), 'video');
      });
    } else if (mapVideoBlob) {
      sendMap(URL.createObjectURL(mapVideoBlob), 'video');
    } else if (currentScene && currentScene.mapBlob) {
      sendMap(URL.createObjectURL(currentScene.mapBlob), 'image');
    } else if (mapOffscreen) {
      mapOffscreen.toBlob(blob => {
        if (!playerWindow || playerWindow.closed) return;
        sendMap(URL.createObjectURL(blob), 'image');
      }, 'image/jpeg', 0.9);
    }
  } else {
    playerWindow.postMessage({
      type: 'fog-update',
      mapWidth, mapHeight, fogDataUrl, view, isShroud, sceneChange, fogChanged,
      sceneName: currentScene ? currentScene.name : null,
      gridEnabled, gridSize, gridOffsetX, gridOffsetY, gridColor, gridOpacity, gridMode, gridLineWidth,
    }, '*');
  }
}

// Syncs fog-animation and video-frame-rate params to the Player window.
// pass includeWarp=true when cloud warp params changed (triggers regen on Player).
function syncAnimToPlayer(includeWarp) {
  if (!playerWindow || playerWindow.closed) return;
  const msg = { type: 'anim-params', fogAnimEnabled, fogAnimSpeed, driftScale, cloudFrameSpeed, alphaPulseAmp, videoFrameIntervalMs };
  if (includeWarp) { msg.cloudWarpStrength = cloudWarpStrength; msg.cloudWarpRadius = cloudWarpRadius; }
  playerWindow.postMessage(msg, '*');
}

// Sends the current fog color to the Player window without a full fog re-send.
// pickedHex: the raw value from the DM's fog-color input (Player derives base+tint itself).
function syncFogColorToPlayer(pickedHex) {
  if (!playerWindow || playerWindow.closed) return;
  playerWindow.postMessage({ type: 'fog-color', pickedHex, fogTintAlpha: FOG_TINT_ALPHA }, '*');
}

// ─── Auto-Sync helper ─────────────────────────────────────────────────────────
// Debounces an auto-save + Player fog push after every fog-changing operation.
function scheduleAutoSync() {
  scheduleAutoSave();
  if (!autoSync) return;
  clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(() => sendToPlayer(true), 300);
}

if (typeof module !== 'undefined') module.exports = { calcViewportRect };
