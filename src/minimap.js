'use strict';
// minimap.js — DM-window live mirror + remote control for the Player camera.
//
// Owns:
//   • minimapView {mapCX, mapCY, zoom} — the triple that IS the Player's intended view.
//   • A <canvas> composite of map + fog + grid at that triple's framing.
//   • Drag + wheel input → updates triple → posts view-snap to playerWindow live.
//   • Lock toggle — gates pointer input so the DM can't nudge the Player mid-reveal.
//
// Called once from index.html: if (!isPlayer) initMinimap();
// Three functions are also called from toolbar.js:
//   minimapSetView(v)        — update triple from Sync View button
//   minimapSyncFromPlayer(v) — update triple from Player freelook reports
//   minimapRefreshAspect()   — resize canvas when playerScreenW/H arrive

// ─── Constants ────────────────────────────────────────────────────────────────
const MINIMAP_W        = 176; // px — matches toolbar width (before zoom)
const MINIMAP_ZOOM_MIN = 0.02;
const MINIMAP_ZOOM_MAX = 20;

// ─── Module-local state ───────────────────────────────────────────────────────
let _canvas  = null;
let _ctx     = null;
let _inited  = false;

// Pointer drag tracking
let _isDragging    = false;
let _dragPointerId = null;
let _dragStartX    = 0;
let _dragStartY    = 0;
let _dragStartCX   = 0;
let _dragStartCY   = 0;

// rAF-throttled view-snap posting
let _snapPending = false;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _playerAspect() {
  const w = playerScreenW || 1920;
  const h = playerScreenH || 1080;
  return h / w;
}

function _minimapH() {
  return Math.round(MINIMAP_W * _playerAspect());
}

function _visibleExtent() {
  // Map-space dimensions visible to the Player at the current triple.
  const w = playerScreenW || 1920;
  const h = playerScreenH || 1080;
  const z = minimapView.zoom;
  return { visW: w / z, visH: h / z };
}

function _postSnapThrottled() {
  if (_snapPending) return;
  _snapPending = true;
  requestAnimationFrame(() => {
    _snapPending = false;
    if (playerWindow && !playerWindow.closed) {
      playerWindow.postMessage({ type: 'view-snap', ...minimapView }, '*');
    }
  });
}

function _markDirty() {
  minimapDirty = true;
  scheduleRender();
}

// ─── Public API ───────────────────────────────────────────────────────────────

function minimapSetView(v) {
  minimapView = { mapCX: v.mapCX, mapCY: v.mapCY, zoom: v.zoom };
  _markDirty();
}

function minimapSyncFromPlayer(v) {
  if (minimapLocked) return;
  if (v.mapCX == null || v.mapCY == null || v.zoom == null) return;
  minimapView = { mapCX: v.mapCX, mapCY: v.mapCY, zoom: v.zoom };
  _markDirty();
}

function minimapRefreshAspect() {
  if (!_canvas) return;
  const h = _minimapH();
  _canvas.width  = MINIMAP_W;
  _canvas.height = h;
  _markDirty();
}

// ─── Render ───────────────────────────────────────────────────────────────────

function drawMinimap() {
  minimapDirty = false;
  if (!_ctx || !_canvas) return;

  const mW = _canvas.width;
  const mH = _canvas.height;

  _ctx.clearRect(0, 0, mW, mH);

  if (!mapOffscreen || !mapWidth || !mapHeight) {
    // No map loaded — leave blank (panel shows via CSS background).
    const panel = document.getElementById('minimap-panel');
    if (panel) panel.classList.add('minimap-no-map');
    return;
  }
  const panel = document.getElementById('minimap-panel');
  if (panel) panel.classList.remove('minimap-no-map');

  const { visW, visH } = _visibleExtent();
  const srcX = minimapView.mapCX - visW / 2;
  const srcY = minimapView.mapCY - visH / 2;

  // ── 1. Map layer ──────────────────────────────────────────────────────────
  _ctx.save();
  _ctx.beginPath();
  _ctx.rect(0, 0, mW, mH);
  _ctx.clip();
  _ctx.drawImage(mapOffscreen, srcX, srcY, visW, visH, 0, 0, mW, mH);
  _ctx.restore();

  // ── 2. Fog approximation ─────────────────────────────────────────────────
  // Source: fogBlurCanvas (feathered 1/FOG_SCALE alpha mask) — always current
  // after rebuildFogBlur(). Apply a CSS blur on draw + a solid fog-color fill
  // composited source-atop so it reads as misty, not a hard flat block.
  if (fogBlurCanvas && fogBlurCanvas.width > 0) {
    const fSrcX = srcX / FOG_SCALE;
    const fSrcY = srcY / FOG_SCALE;
    const fSrcW = visW / FOG_SCALE;
    const fSrcH = visH / FOG_SCALE;

    // Draw the blur mask into an offscreen scratch so we can composite.
    const scratch = document.createElement('canvas');
    scratch.width  = mW;
    scratch.height = mH;
    const sc = scratch.getContext('2d');
    sc.filter = 'blur(3px)';
    sc.drawImage(fogBlurCanvas, fSrcX, fSrcY, fSrcW, fSrcH, 0, 0, mW, mH);
    sc.filter = 'none';

    // Fill fog base color under the mask, then composite over map.
    _ctx.save();
    _ctx.globalAlpha = 0.92;
    // First: paint fog base color clipped to the blurred mask shape.
    const sc2 = scratch.getContext('2d');
    sc2.globalCompositeOperation = 'source-in';
    sc2.fillStyle = fogBaseColor;
    sc2.fillRect(0, 0, mW, mH);
    // Restore GCO for tint pass.
    sc2.globalCompositeOperation = 'source-over';
    sc2.globalAlpha = 0.35;
    sc2.fillStyle = fogTintColor;
    sc2.fillRect(0, 0, mW, mH);

    _ctx.drawImage(scratch, 0, 0);
    _ctx.restore();
  }

  // ── 3. Grid ───────────────────────────────────────────────────────────────
  if (gridEnabled) {
    drawGridLines(_ctx, {
      cw: mW, ch: mH,
      srcX, srcY, srcW: visW, srcH: visH,
      dstX: 0, dstY: 0, dstW: mW, dstH: mH,
    });
  }
}

// ─── Input ────────────────────────────────────────────────────────────────────

function _onPointerDown(e) {
  if (minimapLocked || !mapOffscreen) return;
  e.preventDefault();
  _isDragging    = true;
  _dragPointerId = e.pointerId;
  _dragStartX    = e.clientX;
  _dragStartY    = e.clientY;
  _dragStartCX   = minimapView.mapCX;
  _dragStartCY   = minimapView.mapCY;
  _canvas.setPointerCapture(e.pointerId);
}

function _onPointerMove(e) {
  if (!_isDragging || e.pointerId !== _dragPointerId) return;
  e.preventDefault();
  const mW = _canvas.width;
  const mH = _canvas.height;
  const { visW, visH } = _visibleExtent();
  const dx = (e.clientX - _dragStartX) / mW * visW;
  const dy = (e.clientY - _dragStartY) / mH * visH;
  minimapView = {
    mapCX: _dragStartCX - dx,
    mapCY: _dragStartCY - dy,
    zoom:  minimapView.zoom,
  };
  _markDirty();
  _postSnapThrottled();
}

function _onPointerUp(e) {
  if (e.pointerId !== _dragPointerId) return;
  _isDragging = false;
  _dragPointerId = null;
}

function _onWheel(e) {
  e.preventDefault();
  if (minimapLocked || !mapOffscreen) return;
  const factor  = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
  const newZoom = Math.max(MINIMAP_ZOOM_MIN, Math.min(MINIMAP_ZOOM_MAX, minimapView.zoom * factor));

  // Pivot zoom about the cursor position in map space.
  const rect  = _canvas.getBoundingClientRect();
  const cx    = (e.clientX - rect.left) / rect.width;
  const cy    = (e.clientY - rect.top)  / rect.height;
  const { visW, visH } = _visibleExtent();
  const mapX  = minimapView.mapCX + (cx - 0.5) * visW;
  const mapY  = minimapView.mapCY + (cy - 0.5) * visH;

  const newVisW = (playerScreenW || 1920) / newZoom;
  const newVisH = (playerScreenH || 1080) / newZoom;

  minimapView = {
    mapCX: mapX - (cx - 0.5) * newVisW,
    mapCY: mapY - (cy - 0.5) * newVisH,
    zoom:  newZoom,
  };
  _markDirty();
  _postSnapThrottled();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function initMinimap() {
  if (_inited) return;
  _inited = true;

  _canvas = document.getElementById('minimap-canvas');
  _ctx    = _canvas.getContext('2d');

  // Set initial aspect from playerScreenW/H (may still be defaults).
  minimapRefreshAspect();

  // Seed view: fit the whole map if dimensions are known, else leave default.
  if (mapWidth && mapHeight) {
    _seedView();
  }

  // Lock toggle
  document.getElementById('btn-minimap-lock').addEventListener('click', () => {
    minimapLocked = !minimapLocked;
    document.getElementById('btn-minimap-lock').classList.toggle('active', minimapLocked);
    document.getElementById('btn-minimap-lock').textContent = minimapLocked ? 'Locked' : 'Lock';
    if (playerWindow && !playerWindow.closed) {
      playerWindow.postMessage({ type: 'player-lock', locked: minimapLocked }, '*');
    }
  });

  // Pointer events for drag-to-pan
  _canvas.addEventListener('pointerdown', _onPointerDown);
  _canvas.addEventListener('pointermove', _onPointerMove);
  _canvas.addEventListener('pointerup',   _onPointerUp);
  _canvas.addEventListener('pointercancel', _onPointerUp);

  // Wheel for zoom
  _canvas.addEventListener('wheel', _onWheel, { passive: false });

  _markDirty();
}

// Seed minimapView to fit the whole map (like fitToScreen but for the minimap).
// Called on init if mapWidth is already set, or externally when a map first loads.
function minimapSeedView() {
  if (!mapWidth || !mapHeight) return;
  _seedView();
  _markDirty();
}

function _seedView() {
  const w = playerScreenW || 1920;
  const h = playerScreenH || 1080;
  const z = Math.min(w / mapWidth, h / mapHeight) * 0.95;
  minimapView = { mapCX: mapWidth / 2, mapCY: mapHeight / 2, zoom: z };
}
