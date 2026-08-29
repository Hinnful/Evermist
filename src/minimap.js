'use strict';
// minimap.js — DM-window live mirror + remote control for the Player camera.
//
// Owns minimapView {mapCX, mapCY, zoom} — the triple that IS the Player's intended view — and a
// square <canvas> composite of map, fog and grid, with the Player's own frame marked in dotted
// lines. Drag and wheel update the triple and post view-snap to playerWindow live; the lock gates
// pointer input so the DM cannot nudge the Player mid-reveal.
//
// Called once from index.html. toolbar.js also calls minimapSetView, minimapSyncFromPlayer and
// minimapRefreshAspect.

// ─── Constants ────────────────────────────────────────────────────────────────
const MINIMAP_W        = 176; // px — square canvas side (before zoom)
const MINIMAP_ZOOM_MIN = 0.02;
const MINIMAP_ZOOM_MAX = 20;
// The preview is square and shows MORE map than the Player sees. Its side is the TV frame's
// LONGEST edge, so the extra room is all vertical context and none is spent on padding. The TV's
// edges are dotted lines only, with no fill or dimming, so the map stays readable.

// ─── Module-local state ───────────────────────────────────────────────────────
let _canvas  = null;
let _ctx     = null;
let _inited  = false;

// Scratch canvas for the fog composite, reused across redraws — allocating one per frame
// churned a canvas on every minimap repaint. Resized only when the preview's size changes.
let _mmFogScratch    = null;
let _mmFogScratchCtx = null;

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

function _visibleExtent() {
  // Map-space dimensions visible to the Player at the current triple — i.e. the TV frame.
  const w = playerScreenW || 1920;
  const h = playerScreenH || 1080;
  const z = minimapView.zoom;
  return { visW: w / z, visH: h / z };
}

// Side of the square map-space region the preview draws, in map px: exactly the TV
// frame's longest edge, so the frame fills that axis and can never overflow.
function _frameExtent() {
  const w = playerScreenW || 1920;
  const h = playerScreenH || 1080;
  return Math.max(w, h) / minimapView.zoom;
}

// The canvas's ON-SCREEN size, in the same space as pointer clientX/clientY. ⚠ Never _canvas.width
// (the backing store) and never getBoundingClientRect() (the layout box, while clientX/Y are
// zoomed — the trap documented in controlPanel.js). offsetWidth × --ui-zoom is engine-agnostic.
function _canvasScreenSize() {
  const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1;
  return {
    w: (_canvas.offsetWidth  || 1) * z,
    h: (_canvas.offsetHeight || 1) * z,
  };
}

function _postSnapThrottled() {
  if (_snapPending) return;
  _snapPending = true;
  requestAnimationFrame(() => {
    _snapPending = false;
    if (playerWindow && !playerWindow.closed) {
      // No viewW/viewH on purpose: minimapView.zoom is already in Player-canvas terms, so
      // resolveView's plain-zoom fallback replays it exactly. A region is only needed when the
      // zoom was measured on the DM's canvas.
      playerWindow.postMessage({ type: 'view-snap', ...minimapView }, '*');
    }
  });
}

function _markDirty() {
  minimapDirty = true;
  scheduleRender();
  // Keep the Player tab's zoom readout honest when the triple moves from anywhere
  // else — wheel, drag, Sync View, or a Player free-look report.
  if (typeof refreshPlayerZoomUI === 'function') refreshPlayerZoomUI();
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

// The canvas is always square: the Player's aspect shows as the stroked TV frame inside it. Still
// called when playerScreenW/H arrive, so that frame is redrawn at the right proportions.
function minimapRefreshAspect() {
  if (!_canvas) return;
  _canvas.width  = MINIMAP_W;
  _canvas.height = MINIMAP_W;
  _markDirty();
}

// ─── Zoom API (the Player tab's − / % / + stepper) ────────────────────────────
// Same triple and view-snap path as the wheel, pivoting about the view centre rather than the
// cursor. ⚠ Never gate this on minimapLocked: the lock stops accidental drag and wheel nudges,
// and the Player honours view-snap while locked either way.
function minimapGetZoom() {
  return minimapView.zoom;
}

function minimapSetZoom(z) {
  if (!isFinite(z)) return;
  const nz = Math.max(MINIMAP_ZOOM_MIN, Math.min(MINIMAP_ZOOM_MAX, z));
  if (nz === minimapView.zoom) return;
  minimapView = { mapCX: minimapView.mapCX, mapCY: minimapView.mapCY, zoom: nz };
  _markDirty();
  _postSnapThrottled();
}

// dir > 0 zooms in, dir < 0 out — one step equals one wheel notch.
function minimapNudgeZoom(dir) {
  minimapSetZoom(minimapView.zoom * (dir > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR));
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

  // Everything below draws the SQUARE region (side × side), which is taller than the TV
  // frame — the frame itself is marked over the top in step 4.
  const side = _frameExtent();
  const srcX = minimapView.mapCX - side / 2;
  const srcY = minimapView.mapCY - side / 2;

  // ── 1. Map layer ──────────────────────────────────────────────────────────
  _ctx.save();
  _ctx.beginPath();
  _ctx.rect(0, 0, mW, mH);
  _ctx.clip();
  _ctx.drawImage(mapOffscreen, srcX, srcY, side, side, 0, 0, mW, mH);
  _ctx.restore();

  // ── 2. Fog approximation ─────────────────────────────────────────────────
  // fogBlurCanvas is always current after rebuildFogBlur(). A CSS blur plus a source-atop
  // fog-colour fill keeps it misty rather than a flat block.
  if (fogBlurCanvas && fogBlurCanvas.width > 0) {
    const fSrcX = srcX / FOG_SCALE;
    const fSrcY = srcY / FOG_SCALE;
    const fSrcW = side / FOG_SCALE;
    const fSrcH = side / FOG_SCALE;

    // Draw the blur mask into the reused offscreen scratch so we can composite.
    if (!_mmFogScratch) {
      _mmFogScratch = document.createElement('canvas');
    }
    if (_mmFogScratch.width !== mW || _mmFogScratch.height !== mH) {
      _mmFogScratch.width  = mW;
      _mmFogScratch.height = mH;
      _mmFogScratchCtx = null; // a resize resets the context state anyway
    }
    if (!_mmFogScratchCtx) _mmFogScratchCtx = _mmFogScratch.getContext('2d');
    const sc = _mmFogScratchCtx;
    // ⚠ MUST reset on EVERY reuse, not just after a resize: this function exits with source-atop
    // and alpha still set, so the next frame's mask draw lands tinted over the last.
    sc.globalCompositeOperation = 'source-over';
    sc.globalAlpha = 1;
    sc.clearRect(0, 0, mW, mH);
    sc.filter = 'blur(3px)';
    sc.drawImage(fogBlurCanvas, fSrcX, fSrcY, fSrcW, fSrcH, 0, 0, mW, mH);
    sc.filter = 'none';

    // Fill fog base color under the mask, then composite over map.
    _ctx.save();
    _ctx.globalAlpha = 0.92;
    // First: paint fog base color clipped to the blurred mask shape.
    sc.globalCompositeOperation = 'source-in';
    sc.fillStyle = fogBaseColor;
    sc.fillRect(0, 0, mW, mH);
    // Tint pass, clipped to the mask. ⚠ MUST be source-atop: source-over ignores the mask and
    // washes fogTintColor over the whole preview, veiling revealed map.
    sc.globalCompositeOperation = 'source-atop';
    sc.globalAlpha = 0.35;
    sc.fillStyle = fogTintColor;
    sc.fillRect(0, 0, mW, mH);

    _ctx.drawImage(_mmFogScratch, 0, 0);
    _ctx.restore();
  }

  // ── 3. Grid ───────────────────────────────────────────────────────────────
  if (gridEnabled) {
    drawGridLines(_ctx, {
      cw: mW, ch: mH,
      srcX, srcY, srcW: side, srcH: side,
      dstX: 0, dstY: 0, dstW: mW, dstH: mH,
    });
  }

  // ── 4. TV frame ───────────────────────────────────────────────────────────
  // Two dotted lines. The frame already spans the preview's long axis, so only its inner edges
  // need marking. Always centred: the view triple is the TV centre and the square shares it.
  const { visW, visH } = _visibleExtent();
  _ctx.save();
  _ctx.strokeStyle = 'rgba(140,180,255,0.85)';
  _ctx.lineWidth = 1;
  _ctx.setLineDash([3, 3]);
  _ctx.beginPath();
  if (visW >= visH) {
    // Landscape TV: full width, so mark the horizontal edges. The .5 offsets keep the
    // 1px lines on the pixel grid instead of straddling two rows at half alpha.
    const rh = (visH / side) * mH;
    const yTop = Math.round((mH - rh) / 2) + 0.5;
    const yBot = Math.round((mH + rh) / 2) - 0.5;
    _ctx.moveTo(0, yTop); _ctx.lineTo(mW, yTop);
    _ctx.moveTo(0, yBot); _ctx.lineTo(mW, yBot);
  } else {
    const rw = (visW / side) * mW;
    const xL = Math.round((mW - rw) / 2) + 0.5;
    const xR = Math.round((mW + rw) / 2) - 0.5;
    _ctx.moveTo(xL, 0); _ctx.lineTo(xL, mH);
    _ctx.moveTo(xR, 0); _ctx.lineTo(xR, mH);
  }
  _ctx.stroke();
  _ctx.restore();
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
  // Screen px → map px against the square region actually on screen, so the map tracks the cursor
  // 1:1. ⚠ Dividing by _canvas.width, the backing store, over-shoots every drag.
  const { w: scrW, h: scrH } = _canvasScreenSize();
  const side = _frameExtent();
  const dx = (e.clientX - _dragStartX) / scrW * side;
  const dy = (e.clientY - _dragStartY) / scrH * side;
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

// ⚠ Zoom about the view CENTRE, never the cursor. This canvas is a remote control for the TV, and
// pivoting about an off-centre cursor shifts mapCX/mapCY, so zooming would also pan what the
// players see. Centre-pivot also makes the wheel agree with the − / + stepper.
function _onWheel(e) {
  e.preventDefault();
  if (minimapLocked || !mapOffscreen) return;
  minimapSetZoom(minimapView.zoom * (e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR));
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
