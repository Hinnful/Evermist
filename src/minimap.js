'use strict';
// minimap.js — DM-window live mirror + remote control for the Player camera.
//
// Owns:
//   • minimapView {mapCX, mapCY, zoom} — the triple that IS the Player's intended view.
//   • A square <canvas> composite of map + fog + grid over a region as wide as the
//     Player's longest edge, with the Player's own frame marked by dotted lines inside it.
//   • Drag + wheel input → updates triple → posts view-snap to playerWindow live.
//   • Lock toggle — gates pointer input so the DM can't nudge the Player mid-reveal.
//
// Called once from index.html: if (!isPlayer) initMinimap();
// Three functions are also called from toolbar.js:
//   minimapSetView(v)        — update triple from Sync View button
//   minimapSyncFromPlayer(v) — update triple from Player freelook reports
//   minimapRefreshAspect()   — resize canvas when playerScreenW/H arrive

// ─── Constants ────────────────────────────────────────────────────────────────
const MINIMAP_W        = 176; // px — square canvas side (before zoom)
const MINIMAP_ZOOM_MIN = 0.02;
const MINIMAP_ZOOM_MAX = 20;
// The preview is square and shows MORE map than the Player sees. The square's side is
// the TV frame's LONGEST edge, so the TV spans the preview's full width (for a landscape
// screen) and the extra room is all vertical context — no horizontal real estate is
// spent on padding. The TV's own edges are marked with dotted lines only: no fill and no
// dimming, so the frame never obstructs the map underneath it.

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

// The canvas's ON-SCREEN size, in the same space as pointer clientX/clientY. NOT
// _canvas.width (that's the backing store, 176px) and NOT getBoundingClientRect()
// (which reports the layout box while clientX/Y are zoomed on Chromium < 128 /
// Electron 28 — the same trap documented in controlPanel.js). offsetWidth is layout
// px and --ui-zoom scales it to screen px, which is engine-agnostic.
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

// The canvas itself is always square — the Player's aspect shows up as the shape of the
// stroked TV frame inside it, not as the canvas shape. Still called when playerScreenW/H
// arrive so that frame gets redrawn at the right proportions.
function minimapRefreshAspect() {
  if (!_canvas) return;
  _canvas.width  = MINIMAP_W;
  _canvas.height = MINIMAP_W;
  _markDirty();
}

// ─── Zoom API (the Player tab's − / % / + stepper) ────────────────────────────
// Same triple, same view-snap path as the wheel — it just pivots about the view
// centre instead of the cursor, so the framing stays put as the zoom changes.
// Deliberately NOT gated on minimapLocked: the lock exists to stop accidental
// drag/wheel nudges, and the Player honours view-snap while locked either way.
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
  // Source: fogBlurCanvas (feathered 1/FOG_SCALE alpha mask) — always current
  // after rebuildFogBlur(). Apply a CSS blur on draw + a solid fog-color fill
  // composited source-atop so it reads as misty, not a hard flat block.
  if (fogBlurCanvas && fogBlurCanvas.width > 0) {
    const fSrcX = srcX / FOG_SCALE;
    const fSrcY = srcY / FOG_SCALE;
    const fSrcW = side / FOG_SCALE;
    const fSrcH = side / FOG_SCALE;

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
    // Tint pass, also clipped to the mask. MUST be source-atop, not source-over: a
    // full-canvas fillRect with source-over ignores the mask and washes fogTintColor
    // over the whole preview, veiling revealed map (a pure-white map rendered as
    // (209,199,245) with zero fog painted). source-atop keeps the mask's alpha.
    sc2.globalCompositeOperation = 'source-atop';
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
      srcX, srcY, srcW: side, srcH: side,
      dstX: 0, dstY: 0, dstW: mW, dstH: mH,
    });
  }

  // ── 4. TV frame ───────────────────────────────────────────────────────────
  // Two dotted lines, nothing else. The frame already spans the preview's long axis
  // (side IS the TV's longest edge), so only its two inner edges need marking — and
  // marking them with an unfilled dotted line keeps the map fully readable underneath.
  // Always centred: the view triple is the TV centre and the square shares that centre.
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
  // Screen px → map px against the square region that's actually on screen, so the map
  // tracks the cursor 1:1. Dividing the clientX delta by _canvas.width (the 176px
  // backing store) instead of the on-screen width made every drag over-shoot by their
  // ratio — ~1.42× at the default UI scale.
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

// Zoom about the view CENTRE, not the cursor. Cursor-pivot zoom is right for the DM's
// own canvas, but this canvas is a remote control for the TV: pivoting about an off-centre
// cursor necessarily shifts mapCX/mapCY, so zooming also panned what the players were
// looking at. Centre-pivot keeps the framing put and makes the wheel agree with the
// − / + stepper, which has always gone through minimapSetZoom.
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
