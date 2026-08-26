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

// Zoom that fits a map-space region (viewW × viewH) entirely onto a
// vpW × vpH canvas. min() so the region always fits, never crops.
function zoomToFitRegion(viewW, viewH, vpW, vpH) {
  if (!(viewW > 0) || !(viewH > 0) || !(vpW > 0) || !(vpH > 0)) return null;
  return Math.min(vpW / viewW, vpH / viewH);
}

// The map-space region a viewport actually shows MAP in — the viewport rectangle
// intersected with the map. Returns { cx, cy, w, h } in map units.
//
// Why intersect rather than send the viewport rectangle whole: nothing is ever drawn
// outside the map (the fog canvas is map-sized, the grid is clamped to it, room labels
// never reach the Player), so the empty background around a zoomed-out map carries no
// information. Sending it makes the Player reproduce the DM's letterboxing and then add
// its own on the mismatched axis, which is what left the map small and boxed in on all
// four sides. Clipping is lossless for the same reason: the trimmed margins were empty.
//
// Degenerate case — a viewport parked entirely off the map has no intersection to send,
// so fall back to the raw viewport rect and let the Player frame it as before.
function visibleMapRegion(panX, panY, zoom, mapW, mapH, vpW, vpH) {
  const vx0 = -panX / zoom, vx1 = (vpW - panX) / zoom;
  const vy0 = -panY / zoom, vy1 = (vpH - panY) / zoom;
  const x0 = Math.max(0, vx0), x1 = Math.min(mapW, vx1);
  const y0 = Math.max(0, vy0), y1 = Math.min(mapH, vy1);
  if (!(x1 > x0) || !(y1 > y0)) {
    return { cx: (vx0 + vx1) / 2, cy: (vy0 + vy1) / 2, w: vx1 - vx0, h: vy1 - vy0 };
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

// The region the DM is looking at, packaged for the wire. Both places that send a view
// (Sync View and a manual Send) go through here so they can't drift apart.
// `zoom` rides along only as the fallback for a payload with no region.
//
// Deliberately NOT subtracting the strip hidden behind the control panel. That was tried
// and reverted: it made the TV crop to the DM's readable area, which shifted the framing
// and took content away from the players that used to reach them. Correct on paper, and
// it read as the Player view no longer matching the DM's. Don't re-add it.
function dmVisibleRegion() {
  const { w: vpW, h: vpH } = getViewportSize();
  const r = visibleMapRegion(panX, panY, zoom, mapWidth, mapHeight, vpW, vpH);
  return { mapCX: r.cx, mapCY: r.cy, zoom, viewW: r.w, viewH: r.h };
}

// Map → screen coordinate conversion. Reads pan/zoom globals lazily.
function toScreen(mapX, mapY) {
  return { sx: mapX * zoom + panX, sy: mapY * zoom + panY };
}

// A view crosses the wire as a REGION (centre + viewW/viewH in map units), not as a
// zoom: zoom is px-per-map-unit on the SENDER's canvas, so replaying it verbatim on a
// differently-sized canvas shows a different amount of map (a 1920 TV covers ~25% more
// than a 1536 laptop at the same zoom). Refitting the region here is what makes Sync
// View mean "the players see at least what the DM sees".
// `v.zoom` is still honoured as a fallback for views that carry no region — the
// minimap's own snaps (already in Player terms) and any older-shaped payload.
function resolveView(v) {
  const { w: vpW, h: vpH } = getViewportSize();
  const z = zoomToFitRegion(v.viewW, v.viewH, vpW, vpH) ?? v.zoom;
  return {
    panX: vpW / 2 - v.mapCX * z,
    panY: vpH / 2 - v.mapCY * z,
    zoom: z,
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
  if (!fogOnly) view = dmVisibleRegion();

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
        effects,
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
    // Effects ride along as SHAPE DESCRIPTORS PLUS A MATERIAL NAME, never as pixels — the same
    // precedent the grid config set. The Player paints the material itself from the same
    // seeded masks, so a 40-metre wall of fire costs the wire a few dozen bytes.
    playerWindow.postMessage({
      type: 'fog-update',
      mapWidth, mapHeight, fogDataUrl, view, isShroud, sceneChange, fogChanged, effects,
      gridEnabled, gridSize, gridOffsetX, gridOffsetY, gridColor, gridOpacity, gridMode, gridLineWidth,
    }, '*');
  }
}

// Syncs fog-animation and video-frame-rate params to the Player window.
// pass includeWarp=true when cloud warp params changed (triggers regen on Player).
function syncAnimToPlayer(includeWarp) {
  if (!playerWindow || playerWindow.closed) return;
  const msg = { type: 'anim-params', fogAnimEnabled, fogAnimSpeed, driftScale, cloudFrameSpeed, alphaPulseAmp };
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

if (typeof module !== 'undefined') module.exports = { calcViewportRect, zoomToFitRegion, visibleMapRegion };
