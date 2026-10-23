'use strict';
// minimap.js — DM-window live mirror + remote control for the Player camera.
//
// Owns minimapView {mapCX, mapCY, zoom} — the triple that IS the Player's intended view — and a
// <canvas> of map and fog that IS the TV: the box has the TV's shape and the picture fills it
// edge to edge. Drag and wheel update the triple and post view-snap to playerWindow
// live; the lock gates pointer input. tvControl.js owns what sits over the picture. Called once
// from index.html; toolbar.js and mapTurn.js call minimapSetView, ...SyncFromPlayer, ...Layout.

// ─── Constants ────────────────────────────────────────────────────────────────
const MINIMAP_W        = 240;  // px — the box's width at seat 0/180 (before zoom)
const MINIMAP_MIN_LONG = 160;  // px — the box never shrinks below this on its long side
const MINIMAP_EDGE     = 16;   // px — the gap to the window's bottom and left edges
const MINIMAP_BACKING  = 1.25; // backing store px per CSS px
const MINIMAP_ZOOM_MIN = 0.02;
const MINIMAP_ZOOM_MAX = 20;
// Two maps: the gap between the halves, as a share of the TV's width (stage.js's chasm).
const MINIMAP_CHASM    = 46 / 1920;

// ─── Module-local state ───────────────────────────────────────────────────────
let _canvas  = null;
let _ctx     = null;
let _inited  = false;

// The chosen TV's size while none is open, so the box takes its shape before the Player exists.
let _mmShape = null;

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
let _dragHalf      = null;

// rAF-throttled view-snap posting
let _snapPending = false;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _uiZoom() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1;
}

// Two maps: the left column's share of the Player screen, as the DM's divider has it.
function _mmSplit() {
  const row = document.getElementById('panes-row');
  const a = row && row.querySelector('.pane-col[data-pane="A"]');
  const w = row ? row.getBoundingClientRect().width : 0;
  return a && w > 0 ? Math.max(0.15, Math.min(0.85, a.getBoundingClientRect().width / w)) : 0.5;
}

// The TV's size in Player px: the chosen screen, else what the open Player reports, else 16:9.
function _mmTv() {
  if (_mmShape) return _mmShape;
  if (panesActive) {
    if (!stageIsOpen()) return { w: 1920, h: 1080 };
    const a = paneScopeOf('A'), b = paneScopeOf('B');
    return { w: ((a.playerScreenW || 960) + (b.playerScreenW || 960)) / (1 - MINIMAP_CHASM), h: a.playerScreenH || 1080 };
  }
  const s = paneScope();
  return { w: s.playerScreenW || 1920, h: s.playerScreenH || 1080 };
}

// Everything the draw and the pointer share: the canvas, and each picture in it with its own view,
// the TV size it is measured in, and the rectangle it fills. One entry, or two with two maps.
function _mmGeom() {
  const cw = _canvas.width, ch = _canvas.height;
  const tv = _mmTv();
  let halves;
  if (!panesActive) {
    halves = [{ id: null, scope: paneScope(), view: minimapView, tv, dst: { x: 0, y: 0, w: cw, h: ch } }];
  } else {
    const gap = Math.round(cw * MINIMAP_CHASM);
    const frac = _mmSplit();
    const wA = Math.round((cw - gap) * frac);
    const live = stageIsOpen() && !_mmShape;
    halves = PANE_IDS.map((id, i) => {
      const scope = paneScopeOf(id);
      const share = i ? 1 - frac : frac;
      return {
        id, scope,
        view: id === panesSelected ? minimapView : (scope.minimapView || minimapView),
        tv: live ? { w: scope.playerScreenW || 960, h: scope.playerScreenH || 1080 }
                 : { w: tv.w * (1 - MINIMAP_CHASM) * share, h: tv.h },
        dst: i ? { x: wA + gap, y: 0, w: cw - gap - wA, h: ch } : { x: 0, y: 0, w: wA, h: ch },
      };
    });
  }
  return { cw, ch, tv, halves };
}

// A picture's Fit to TV: the turn the TV draws that map by (tvFit.js). It is the same turn the
// Player's canvas stack takes, so the picture below turns inside its half by it, on top of the seat.
function _mmFitTurn(scope) { return scope.tvFit ? scope.tvFit.turn : 0; }
function _mmFitSideways(scope) { return _mmFitTurn(scope) % 180 !== 0; }

// The map-space size one picture draws: the TV's own view, its sides swapped under a sideways fit.
function _mmRegion(half) {
  const z = half.view.zoom;
  return _mmFitSideways(half.scope) ? { w: half.tv.h / z, h: half.tv.w / z } : { w: half.tv.w / z, h: half.tv.h / z };
}

// The canvas's ON-SCREEN size, in the same space as pointer clientX/clientY. ⚠ Never _canvas.width
// (the backing store) and never getBoundingClientRect() (the layout box, while clientX/Y are
// zoomed — the trap documented in controlPanel.js). offsetWidth × --ui-zoom is engine-agnostic.
function _canvasScreenSize() {
  const z = _uiZoom();
  return {
    w: (_canvas.offsetWidth  || 1) * z,
    h: (_canvas.offsetHeight || 1) * z,
  };
}

// The picture under a pointer: its place is the panel's centre turned back by My seat.
function _halfAt(geom, e) {
  if (geom.halves.length === 1) return geom.halves[0];
  const r = document.getElementById('minimap-panel').getBoundingClientRect();
  const d = turnDelta(e.clientX - (r.left + r.right) / 2, e.clientY - (r.top + r.bottom) / 2);
  const fx = (d.x + _canvasScreenSize().w / 2) / _canvasScreenSize().w;
  const [a, b] = geom.halves;
  return fx < (a.dst.w + (b.dst.x - a.dst.w) / 2) / geom.cw ? a : b;
}

function _postSnapThrottled() {
  if (_snapPending) return;
  _snapPending = true;
  requestAnimationFrame(() => {
    _snapPending = false;
    // One minimap, and it drives whichever column is selected. Its Player is that column's.
    if (paneForward('player-view', { view: minimapView })) return;
    // Manual: the framing goes with the next Send.
    if (!autoSync) { tvWait.view = true; playerUnsent = true; return; }
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
  // A column's own preview is never on screen; its job is to tell the parent's one.
  // ⚠ NOT BEFORE IT HAS A MAP: at boot the triple is still {0, 0, 1}, a view no map is at.
  if (isPane && parent !== window && mapWidth > 0) {
    parent.postMessage({ type: 'pane-player-view', pane: paneId, view: minimapView }, '*');
  }
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

// The box takes the TV's shape. Still called when playerScreenW/H arrive.
function minimapRefreshAspect() {
  minimapLayout();
}

// The size of the screen the TV will be, or null once the open Player reports its own.
function minimapSetShape(dims) {
  const same = (!dims && !_mmShape) || (dims && _mmShape && dims.w === _mmShape.w && dims.h === _mmShape.h);
  if (same) return;
  _mmShape = dims ? { w: dims.w, h: dims.h } : null;
  minimapLayout();
}

// The panel is the TV as the DM sees it from their seat: at 90/270 its sides swap and the canvas
// turns inside it. On a window too narrow it shrinks rather than cover the centred toolbar.
function minimapLayout() {
  const panel = document.getElementById('minimap-panel');
  if (!_canvas || !panel) return;
  const tv = _mmTv();
  const turned = seatTurn % 180 !== 0;
  let w = MINIMAP_W, h = w * tv.h / tv.w;
  const z = _uiZoom();
  const room = (window.innerWidth / 2 - _dockBarW() / 2 - DOCK_TOOLBAR_GAP) / z - MINIMAP_EDGE;
  const across = turned ? h : w;
  if (across > room) {
    const k = Math.max(room / across, MINIMAP_MIN_LONG / Math.max(w, h));
    w *= k; h *= k;
  }
  w = Math.round(w); h = Math.round(h);
  const bw = turned ? h : w, bh = turned ? w : h;
  panel.style.width = bw + 'px';
  panel.style.height = bh + 'px';
  _canvas.style.width = w + 'px';
  _canvas.style.height = h + 'px';
  _canvas.style.transform = seatTurn ? 'rotate(' + seatTurn + 'deg)' : '';
  const bw2 = Math.round(w * MINIMAP_BACKING), bh2 = Math.round(h * MINIMAP_BACKING);
  if (_canvas.width !== bw2 || _canvas.height !== bh2) { _canvas.width = bw2; _canvas.height = bh2; }
  _markDirty();
}

// ─── Zoom ─────────────────────────────────────────────────────────────────────
// The wheel's path, pivoting about the view centre. ⚠ Never gate this on minimapLocked: the
// Player honours view-snap while locked either way.
function minimapSetZoom(z) {
  if (!isFinite(z)) return;
  const nz = Math.max(MINIMAP_ZOOM_MIN, Math.min(MINIMAP_ZOOM_MAX, z));
  if (nz === minimapView.zoom) return;
  minimapView = { mapCX: minimapView.mapCX, mapCY: minimapView.mapCY, zoom: nz };
  _markDirty();
  _postSnapThrottled();
}

// ─── Render ───────────────────────────────────────────────────────────────────

// One picture: map and the fog over it.
function _drawHalf(half) {
  const s = half.scope;
  if (!s.mapOffscreen || !s.mapWidth || !s.mapHeight || !(half.view.zoom > 0)) return false;
  const { dst } = half;
  const reg = _mmRegion(half);
  const srcX = half.view.mapCX - reg.w / 2;
  const srcY = half.view.mapCY - reg.h / 2;

  // The picture is laid out in map axes (pw × ph) and turned about its half's centre by its own fit.
  const fit = _mmFitTurn(s);
  const pw = _mmFitSideways(s) ? dst.h : dst.w, ph = _mmFitSideways(s) ? dst.w : dst.h;
  const place = c => {
    c.translate(dst.x + dst.w / 2, dst.y + dst.h / 2);
    c.rotate(fit * Math.PI / 180);
    c.translate(-pw / 2, -ph / 2);
  };

  _ctx.save();
  _ctx.beginPath();
  _ctx.rect(dst.x, dst.y, dst.w, dst.h);
  _ctx.clip();
  place(_ctx);
  _ctx.drawImage(s.mapOffscreen, srcX, srcY, reg.w, reg.h, 0, 0, pw, ph);
  _ctx.restore();

  // fogBlurCanvas is always current after rebuildFogBlur(). A CSS blur plus a source-atop
  // fog-colour fill keeps it misty rather than a flat block.
  if (s.fogBlurCanvas && s.fogBlurCanvas.width > 0) {
    if (!_mmFogScratch) _mmFogScratch = document.createElement('canvas');
    // Square, so a half turned a quarter still fits.
    const side = Math.max(_canvas.width, _canvas.height);
    if (_mmFogScratch.width !== side || _mmFogScratch.height !== side) {
      _mmFogScratch.width  = side;
      _mmFogScratch.height = side;
      _mmFogScratchCtx = null; // a resize resets the context state anyway
    }
    if (!_mmFogScratchCtx) _mmFogScratchCtx = _mmFogScratch.getContext('2d');
    const sc = _mmFogScratchCtx;
    // ⚠ MUST reset on EVERY reuse, not just after a resize: this function exits with source-atop
    // and alpha still set, so the next frame's mask draw lands tinted over the last.
    sc.globalCompositeOperation = 'source-over';
    sc.globalAlpha = 1;
    sc.clearRect(0, 0, _mmFogScratch.width, _mmFogScratch.height);
    sc.filter = 'blur(3px)';
    sc.drawImage(s.fogBlurCanvas, srcX / FOG_SCALE, srcY / FOG_SCALE, reg.w / FOG_SCALE, reg.h / FOG_SCALE,
                 0, 0, pw, ph);
    sc.filter = 'none';
    sc.globalCompositeOperation = 'source-in';
    sc.fillStyle = s.fogBaseColor;
    sc.fillRect(0, 0, pw, ph);
    // ⚠ MUST be source-atop: source-over ignores the mask and washes fogTintColor over the whole
    // preview, veiling revealed map.
    sc.globalCompositeOperation = 'source-atop';
    sc.globalAlpha = 0.35;
    sc.fillStyle = s.fogTintColor;
    sc.fillRect(0, 0, pw, ph);

    _ctx.save();
    _ctx.beginPath();
    _ctx.rect(dst.x, dst.y, dst.w, dst.h);
    _ctx.clip();
    _ctx.globalAlpha = 0.92;
    place(_ctx);
    _ctx.drawImage(_mmFogScratch, 0, 0, pw, ph, 0, 0, pw, ph);
    _ctx.restore();
  }

  return true;
}

function drawMinimap() {
  minimapDirty = false;
  // ⚠ A COLUMN DRAWS NO PREVIEW OF ITS OWN; it tells the parent its picture changed, because
  // the one preview draws from here and nothing else would say so.
  if (isPane) {
    if (parent !== window) parent.postMessage({ type: 'pane-repaint', pane: paneId }, '*');
    return;
  }
  if (!_ctx || !_canvas) return;

  _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
  let drew = false;
  for (const half of _mmGeom().halves) drew = _drawHalf(half) || drew;
  const panel = document.getElementById('minimap-panel');
  if (panel) panel.classList.toggle('minimap-no-map', !drew);
}

// ─── Input ────────────────────────────────────────────────────────────────────

function _onPointerDown(e) {
  if (minimapLocked || !paneScope().mapOffscreen) return;
  e.preventDefault();
  // With two maps a press on a half selects its column, so the drag below drives that one.
  const half = _halfAt(_mmGeom(), e);
  if (half.id && half.id !== panesSelected) selectPane(half.id);
  _dragHalf      = half.id;
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
  // Screen px → map px against the picture actually on screen, so the map tracks the cursor
  // 1:1. ⚠ Dividing by _canvas.width, the backing store, over-shoots every drag.
  const { w: scrW, h: scrH } = _canvasScreenSize();
  const geom = _mmGeom();
  const half = geom.halves.find(h => h.id === _dragHalf) || geom.halves[0];
  const reg = _mmRegion(half);
  // The preview turns with the DM's seat and then with this picture's fit, so the drag is turned
  // back through both into the map's own axes.
  const c = turnDelta(e.clientX - _dragStartX, e.clientY - _dragStartY);
  const d = turnVec(c.x, c.y, unturn(_mmFitTurn(half.scope)));
  const picW = scrW * half.dst.w / geom.cw, picH = scrH * half.dst.h / geom.ch;
  const sideways = _mmFitSideways(half.scope);
  const dx = d.x / (sideways ? picH : picW) * reg.w;
  const dy = d.y / (sideways ? picW : picH) * reg.h;
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
// players see.
const _wheelSt = wheelState();
function _onWheel(e) {
  e.preventDefault();
  if (minimapLocked || !paneScope().mapOffscreen) return;
  const half = _halfAt(_mmGeom(), e);
  if (half.id && half.id !== panesSelected) selectPane(half.id);
  const kind = classifyWheel(e, _wheelSt, e.timeStamp);
  if (kind === 'touchpad') return;   // a two-finger scroll is not a zoom
  minimapSetZoom(minimapView.zoom * wheelZoomFactor(kind, e.deltaY, ZOOM_FACTOR));
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function initMinimap() {
  if (_inited) return;
  _inited = true;

  _canvas = document.getElementById('minimap-canvas');
  _ctx    = _canvas.getContext('2d');

  // Seed view: fit the whole map if dimensions are known, else leave default.
  if (mapWidth && mapHeight) {
    _seedView();
  }

  document.getElementById('btn-minimap-lock').addEventListener('click', () => {
    minimapLocked = !minimapLocked;
    document.getElementById('btn-minimap-lock').classList.toggle('active', minimapLocked);
    document.getElementById('btn-minimap-lock').textContent = minimapLocked ? 'Locked' : 'Lock';
    // Both columns' Players, so the lock holds whichever half the DM drags.
    if (paneBroadcast('player-lock', { locked: minimapLocked })) return;
    if (playerWindow && !playerWindow.closed) {
      playerWindow.postMessage({ type: 'player-lock', locked: minimapLocked }, '*');
    }
  });

  // Pointer events for drag-to-pan
  _canvas.addEventListener('pointerdown', _onPointerDown);
  _canvas.addEventListener('pointermove', _onPointerMove);
  _canvas.addEventListener('pointerup',   _onPointerUp);
  _canvas.addEventListener('pointercancel', _onPointerUp);

  _canvas.addEventListener('wheel', _onWheel, { passive: false });

  // The toolbar's width and the window's decide how wide the box may be.
  const bars = new ResizeObserver(minimapLayout);
  bars.observe(document.documentElement);
  ['toolbar-bottom', 'context-row'].forEach(id => { const el = document.getElementById(id); if (el) bars.observe(el); });

  minimapLayout();
}

// Seed minimapView to fit the whole map (like fitToScreen but for the minimap).
// Called on init if mapWidth is already set, or externally when a map first loads.
function minimapSeedView() {
  const s = paneScope();
  if (!s.mapWidth || !s.mapHeight) return;
  _seedView();
  _markDirty();
}

function _seedView() {
  const s = paneScope();
  const sideways = _mmFitSideways(s);
  const w = sideways ? (s.playerScreenH || 1080) : (s.playerScreenW || 1920);
  const h = sideways ? (s.playerScreenW || 1920) : (s.playerScreenH || 1080);
  const z = Math.min(w / s.mapWidth, h / s.mapHeight) * 0.95;
  minimapView = { mapCX: s.mapWidth / 2, mapCY: s.mapHeight / 2, zoom: z };
}
