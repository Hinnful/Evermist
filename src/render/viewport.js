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


if (typeof module !== 'undefined') module.exports = { calcViewportRect, zoomToFitRegion, visibleMapRegion };
