// viewport.js — view sync helpers + Player map delivery. Loaded before the inline script; its
// globals resolve lazily, at call time.

// ─── Pure coordinate helpers ──────────────────────────────────────────────────

// The source and destination rectangles for a pan+zoom viewport. Pure, so it tests without DOM.
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

// The map-space region a viewport actually shows MAP in — the viewport rectangle intersected with
// the map, in map units.
//
// ⚠ Intersect rather than sending the viewport whole. Nothing is drawn outside the map, so the
// empty background carries no information, and sending it makes the Player reproduce the DM's
// letterboxing and add its own on the mismatched axis. Clipping is lossless for the same reason.
//
// A viewport parked entirely off the map has no intersection, so fall back to the raw rect.
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

// The region the DM is looking at, packaged for the wire. Sync View and a manual Send both go
// through here, so they cannot drift apart. `zoom` rides along as the fallback for a payload with
// no region.
//
// ⚠ NEVER subtract the strip hidden behind the control panel. It crops the TV to the DM's readable
// area, which shifts the framing and takes content away from the players.
function dmVisibleRegion() {
  const { w: vpW, h: vpH } = getViewportSize();
  const r = visibleMapRegion(panX, panY, zoom, mapWidth, mapHeight, vpW, vpH);
  return { mapCX: r.cx, mapCY: r.cy, zoom, viewW: r.w, viewH: r.h };
}

function toScreen(mapX, mapY) {
  return { sx: mapX * zoom + panX, sy: mapY * zoom + panY };
}

// ⚠ A view crosses the wire as a REGION (centre plus viewW/viewH in map units), never as a zoom.
// Zoom is px-per-map-unit on the SENDER's canvas, so replaying it on a differently-sized canvas
// shows a different amount of map. Refitting the region is what makes Sync View mean "the players
// see at least what the DM sees".
// `v.zoom` is still honoured for views carrying no region — the minimap's own snaps.
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

// ─── The Player window's life ────────────────────────────────────────────────
// ⚠ PRE-WARMED, AND `playerWindow` STAYS NULL UNTIL THE BUTTON IS PRESSED. Adopting the warm
// window early would send every fog push, and pull every map, into a window nobody opened.
let _playerPrewarm = null;

function playerWindowUrl() {
  const sp = new URLSearchParams(window.location.search);
  let url = window.location.href.split('?')[0] + '?mode=player';
  if (sp.get('stress') === '1') url += '&stress=1';
  const stressMs = sp.get('stressMs');
  if (stressMs) url += '&stressMs=' + encodeURIComponent(stressMs);
  // A second process with its own copy of every canvas, so the probe has to run there too.
  if (sp.get('memprobe') === '1') url += '&memprobe=1';
  return url;
}

function openPlayerWindow() {
  return window.open(playerWindowUrl(), 'evermist-player', 'toolbar=no,menubar=no,scrollbars=no');
}

// ⚠ NEVER WHILE A PLAYER IS OPEN. window.open reuses a browsing context by NAME, so warming one
// over a live Player re-navigates it and the TV reloads mid-session.
function prewarmPlayer() {
  if (isPlayer) return;
  if (_playerPrewarm && !_playerPrewarm.closed) return;
  if (playerWindow && !playerWindow.closed) return;
  _playerPrewarm = openPlayerWindow();
}

// Same name reuse, the other way round: a window still closing can answer to the name and the
// warm handle ends up on a corpse, so the next press pays the page load the warming exists to
// remove. Bounded, because a window that never reports closed must not stop the warming.
function prewarmPlayerAfter(dying) {
  if (!dying || dying.closed) { prewarmPlayer(); return; }
  let tries = 0;
  const poll = () => {
    if (dying.closed || ++tries > 40) prewarmPlayer();
    else setTimeout(poll, 50);
  };
  setTimeout(poll, 50);
}

// The button's "open": main.js keeps every Player window hidden until this.
function revealPlayerWindow() {
  playerWindow = (_playerPrewarm && !_playerPrewarm.closed) ? _playerPrewarm : openPlayerWindow();
  _playerPrewarm = null;
  if (!playerWindow) return;   // window.open can answer null; a throw here kills the button
  if (window.electronAPI && window.electronAPI.playerReveal) {
    window.electronAPI.playerReveal();
  }
  // ⚠ A pre-warmed window announced itself while playerWindow was still null, so its PLAYER_READY
  // was dropped by the handler's source check. Ask again or nothing is ever sent to it.
  playerWindow.postMessage({ type: 'player-hello' }, '*');
}

// ─── Player map-request protocol ─────────────────────────────────────────────

// Deferred player resync: set when the Player asks for the map but the DM has no scene loaded yet.
// onSceneLoaded() flushes the pending request.
let _playerResyncPending = false;

// Retries need-map every 5s, up to 6 attempts, until mapOffscreen is populated.
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

// The one condition under which a push can go out at all. Shared with sendToPlayer's own guard.
function canSendToPlayer() {
  return !!(mapOffscreen && fogDataCanvas && playerWindow && !playerWindow.closed);
}

// Sends immediately if mapOffscreen is ready, and defers to onSceneLoaded() if not.
//
// ⚠ THE FLAG MEANS "ASKED AND NOT YET SERVED", AND ONLY A REAL DELIVERY CLEARS IT, in sendMap()
// at the moment the payload goes out. Clearing it in onSceneLoaded leaves it clear after a flush
// that delivered nothing, and never clearing it leaves it set after a send that went out — which
// makes the next scene switch push a second payload mid-cover.
//
// Clearing it up front on "a send is possible" loses the deferred retry: the first send is
// ASYNCHRONOUS for a video scene, and its callback returns without sending when the clip is
// missing.
function onPlayerResyncRequest() {
  _playerResyncPending = true;
  playerMapSent = false;
  sendToPlayer();
}

// Called at the end of a successful switchScene load: if the Player asked for the map while the
// scene was loading, send it now.
// ⚠ DOES NOT CLEAR THE FLAG. sendMap() clears it when the payload goes out, so a flush that
// delivers nothing leaves the request standing for the next scene load.
function onSceneLoaded() {
  if (!_playerResyncPending) return;
  sendToPlayer();
}

function sendToPlayer(fogOnly = false, sceneChange = false) {
  if (!canSendToPlayer()) return;

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
      // THE ONE PLACE A FIRST DELIVERY ACTUALLY HAPPENS, so it is the one place the Player's
      // outstanding request is answered. Every branch above this can bail without sending.
      _playerResyncPending = false;
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
    // Effects ride along as SHAPE DESCRIPTORS PLUS A MATERIAL NAME, never as pixels. The Player
    // paints the material itself from the same seeded masks.
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
