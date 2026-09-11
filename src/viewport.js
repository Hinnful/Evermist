'use strict';
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

// The map-space region a viewport actually shows MAP in, in map units.
// ⚠ Intersect rather than sending the viewport whole: the empty background carries nothing, and
// sending it makes the Player reproduce the DM's letterboxing and add its own on the mismatched
// axis. Clipping is lossless for the same reason.
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
// through here, so they cannot drift apart.
// ⚠ NEVER subtract the strip hidden behind the control panel. It crops the TV to the DM's
// readable area, which shifts the framing and takes content away from the players.
function dmVisibleRegion() {
  const { w: vpW, h: vpH } = getViewportSize();
  const r = visibleMapRegion(panX, panY, zoom, mapWidth, mapHeight, vpW, vpH);
  return { mapCX: r.cx, mapCY: r.cy, zoom, viewW: r.w, viewH: r.h };
}

function toScreen(mapX, mapY) {
  return { sx: mapX * zoom + panX, sy: mapY * zoom + panY };
}

// ⚠ A view crosses the wire as a REGION (centre plus viewW/viewH in map units), never as a zoom:
// zoom is px-per-map-unit on the SENDER's canvas, so replaying it on a differently-sized canvas
// shows a different amount of map. `v.zoom` is honoured only for a view carrying no region.
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

// The camera as the map point in the middle, plus the zoom. A column adopts one when it takes
// over a map or changes width, so a narrower column shows less of the map, never a smaller one.
function captureCamera() {
  if (!(zoom > 0)) return null;
  const { w, h } = getViewportSize();
  return { mapCX: (w / 2 - panX) / zoom, mapCY: (h / 2 - panY) / zoom, zoom };
}

function applyCamera(c) {
  if (!(mapWidth > 0 && mapHeight > 0)) return;   // an empty column has no camera to keep
  if (!c || !(c.zoom > 0)) { fitToScreen(); return; }
  const { w, h } = getViewportSize();
  zoom = c.zoom;
  panX = w / 2 - c.mapCX * zoom;
  panY = h / 2 - c.mapCY * zoom;
  pixiSetViewport(zoom, panX, panY);
}

// A column changes width whenever the split moves, so it keeps the camera the DM set. The DM
// window's own resize leaves the map where it is, as it always has.
// ⚠ CAPTURE BEFORE syncSize. The map area reports its OLD size until pixiResize runs inside
// syncSize, and once it has, nothing can say which map point had been in the middle.
function resizeViewport() {
  if (!isPane) { syncSize(); return; }
  const held = captureCamera();
  syncSize();
  applyCamera(held);
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

// ⚠ A PLAYER WINDOW ANSWERS ITS OPENER; A PLAYER FRAME HAS NONE, so the DM window binds each
// half of the Player screen to the column that drives it. Top-level functions on purpose: the
// DM window calls them across the frame boundary, where a `let` is not reachable.
let _playerReplyTo = null;
function bindReplyTarget(w) { _playerReplyTo = w; }
function playerReplyTarget() { return _playerReplyTo || window.opener; }

// The other end: a column is told which half of the Player screen is its own.
function bindPlayerWindow(w) {
  playerWindow = w;
  playerMapSent = false;
  if (typeof refreshPlayerControlUI === 'function') refreshPlayerControlUI();
}

function notifyDMOfMode() {
  if (!playerReplyTarget()) return;
  const msg = { type: 'PLAYER_MODE', mode: playerFollowDM ? 'follow' : 'freelook' };
  if (!playerFollowDM) {
    const { w: vpW, h: vpH } = getViewportSize();
    msg.mapCX = (vpW / 2 - panX) / zoom;
    msg.mapCY = (vpH / 2 - panY) / zoom;
    msg.zoom  = zoom;
  }
  playerReplyTarget().postMessage(msg, '*');
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

// ⚠ ONE NAME PER COLUMN. window.open reuses a browsing context BY NAME, so two columns sharing
// the fixed name would hand the second one the first's window and the first TV would go dark.
// ⚠ Keyed on `paneId` alone, not on the mode: a column's Player carries the same `?pane=` and
// has to answer to the same name, or main.js's display push never reaches it.
// ⚠ ONE NAME, because one window serves both columns. A per-column name made a column reject
// the display push describing its own half, so its map texture was never sized to the screen.
function playerWindowName() {
  // A Player FRAME sits inside the shell, and the shell is the window main.js knows about.
  if (isPlayer && parent !== window) { try { return parent.name || 'evermist-player'; } catch (_) {} }
  return 'evermist-player';
}

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
  return window.open(playerWindowUrl(), playerWindowName(), 'toolbar=no,menubar=no,scrollbars=no');
}

// ⚠ NEVER WHILE A PLAYER IS OPEN. window.open reuses a browsing context by NAME, so warming one
// over a live Player re-navigates it and the TV reloads mid-session.
function prewarmPlayer() {
  if (isPlayer || isPane || panesActive) return;   // two-map mode has one shell, opened by the DM
  if (_playerPrewarm && !_playerPrewarm.closed) return;
  if (playerWindow && !playerWindow.closed) return;
  _playerPrewarm = openPlayerWindow();
}

// Same name reuse, the other way round: a window still closing can answer to the name, so the
// warm handle lands on a corpse. Bounded, or a window that never closes stops the warming.
function prewarmPlayerAfter(dying) {
  if (!dying || dying.closed) { prewarmPlayer(); return; }
  let tries = 0;
  const poll = () => {
    if (dying.closed || ++tries > 40) prewarmPlayer();
    else setTimeout(poll, 50);
  };
  setTimeout(poll, 50);
}

// A whole hidden renderer, so a parent handing its map to the columns drops it.
function closePrewarmedPlayer() {
  if (_playerPrewarm && !_playerPrewarm.closed) _playerPrewarm.close();
  _playerPrewarm = null;
}

// The button's "open": main.js keeps every Player window hidden until this.
function revealPlayerWindow() {
  playerWindow = (_playerPrewarm && !_playerPrewarm.closed) ? _playerPrewarm : openPlayerWindow();
  _playerPrewarm = null;
  if (!playerWindow) return;   // window.open can answer null; a throw here kills the button
  if (window.electronAPI && window.electronAPI.playerReveal) {
    window.electronAPI.playerReveal(playerWindowName());
  }
  // ⚠ A pre-warmed window announced itself while playerWindow was still null, so its PLAYER_READY
  // was dropped by the handler's source check. Ask again or nothing is ever sent to it.
  playerWindow.postMessage({ type: 'player-hello' }, '*');
}

// The Player button is a toggle: window.open on an already-open named window only re-navigates
// it, so without the close branch the second press looks dead.
function togglePlayerWindow() {
  if (playerWindow && !playerWindow.closed) {
    const dying = playerWindow;
    playerWindow.close();
    playerWindow = null;
    if (typeof refreshPlayerControlUI === 'function') refreshPlayerControlUI();
    prewarmPlayerAfter(dying);   // the next press should be as fast as this one was
    return;
  }
  revealPlayerWindow();
}

// ─── Player map-request protocol ─────────────────────────────────────────────

// Deferred player resync: set when the Player asks for the map but the DM has no scene loaded yet.
// onSceneLoaded() flushes the pending request.
let _playerResyncPending = false;

// Retries need-map every 5s, up to 6 attempts, until mapOffscreen is populated.
function initPlayerMapRetry() {
  let attempts = 0;
  function tryNeedMap() {
    if (mapOffscreen || !playerReplyTarget() || attempts >= 6) return;
    attempts++;
    playerReplyTarget().postMessage({ type: 'need-map' }, '*');
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
      }).catch(() => {});   // the request stays pending, so the Player asks again
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
  const msg = { type: 'anim-params', fogAnimEnabled, fogAnimSpeed, driftScale, cloudFrameSpeed, alphaPulseAmp };
  if (includeWarp) { msg.cloudWarpStrength = cloudWarpStrength; msg.cloudWarpRadius = cloudWarpRadius; }
  // The same parameter set every animation control ends in, so one forward covers the presets,
  // the advanced sliders and the on/off button together.
  if (paneForward('anim', msg)) return;
  if (!playerWindow || playerWindow.closed) return;
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
