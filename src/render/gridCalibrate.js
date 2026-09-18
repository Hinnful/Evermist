'use strict';
// gridCalibrate.js — fitting the grid to the map by hand. How the gesture works: ARCHITECTURE.md.
// `gridCalArmed` lives in state.js because grid.js and input.js read it.
//
// ⚠ A LIVE DRAG WRITES THE GLOBALS AND RENDERS. Only a finished gesture calls commitGridChange,
// which rebuilds fog for the new cell size and pushes to the Player - per mouse move that would
// resize every placed door and repaint the TV once a frame.

const GRIDCAL_MAG_FACTOR = 4;    // the magnifier shows this many times what the screen shows
const GRIDCAL_MAG_FLOOR  = 2;    // ...but never below this many screen px per map px
const GRIDCAL_MAG_RADIUS = 70;
const GRIDCAL_HIT_PX     = 12;   // grab radius on the correction handle, screen px
const GRIDCAL_REFINE_MIN = 3;    // cells clear of the square before the handle offers itself
const GRIDCAL_HUD_GAP    = 14;   // screen px between the square and the count HUD
const GRIDCAL_HUD_MARGIN = 12;   // ...and between the HUD and the window edge
const GRIDCAL_HUD_LIFT   = 14;   // ...above the bottom toolbar, where it waits with no square yet

let gridCalSpan   = null;   // {ax, ay, bx, by, n} the committed square, MAP coords
let gridCalDrag   = null;   // {which:'span'|'refine', ...}
let gridCalRefine = null;   // {x, y, n, m} the hovered or dragged intersection
let gridCalFreeze = null;   // {canvas, ctx, still} a held frame of an animated map

function initGridCalibrate() {
  if (isPlayer) return;
  const dec  = document.getElementById('gridcal-count-dec');
  const inc  = document.getElementById('gridcal-count-inc');
  const num  = document.getElementById('gridcal-count');
  const done = document.getElementById('gridcal-done');
  if (done) done.addEventListener('click', () => armGridCalibration(false));
  if (dec) dec.addEventListener('click', () => gridCalNudgeCount(-1));
  if (inc) inc.addEventListener('click', () => gridCalNudgeCount(1));
  if (num) num.addEventListener('change', () => {
    const v = parseInt(num.value, 10);
    if (gridCalSpan && gridCalCellFits(gridCalSpanReach(gridCalSpan), v)) {
      gridCalSpan.n = v; gridCalApplySpan(); gridCalCommit();
    }
    gridCalRefreshUI();
  });
}

// ─── Arming ───────────────────────────────────────────────────────────────────
// ⚠ gridEnabled is NEVER touched here. It is the scene's and it reaches the TV, so switching it on
// to calibrate would put a grid in front of the players; renderGrid shows the grid for the
// duration instead, the same way it does for the Door tool.
function armGridCalibration(on) {
  if (isPlayer) return;
  if (on && !mapWidth) return;   // nothing to calibrate against
  if (on === gridCalArmed) return;
  gridCalArmed = on;
  cpHoldTabForCalibration(on);
  gridCalDrag = null;
  gridCalRefine = null;
  if (on) {
    gridCalSpan = null;
    container.style.cursor = 'crosshair';   // Select leaves it 'default', which reads as no tool
    gridCalHoldMap();
  } else {
    container.style.cursor = shape === 'select' ? 'default' : (shape === 'door' ? 'pointer' : 'crosshair');
    gridCalReleaseMap();
  }
  const btn = document.getElementById('cp-grid-calibrate');
  if (btn) btn.classList.toggle('active', on);
  updateContextPanels();
  gridCalRefreshUI();
  gridDirty = true;
  scheduleRender();
  drawCursor(lastScreenX, lastScreenY);
}

// ─── Holding an animated map still ────────────────────────────────────────────
// A loop point drops visible quality for a moment and the drift pulls the eye off the intersection
// being aimed at. The still goes in at the MAP's layer - before #fog-canvas, the slot #pixi-canvas
// uses - so fog, grid and the handles all stay above it. Created and removed with the gesture, so
// the canvas stack carries nothing extra the rest of the time.
function gridCalHoldMap() {
  if (!mapVideo || !mapVideo.videoWidth) return;
  const still = document.createElement('canvas');
  still.width = mapVideo.videoWidth;
  still.height = mapVideo.videoHeight;
  still.getContext('2d').drawImage(mapVideo, 0, 0, still.width, still.height);
  const canvas = document.createElement('canvas');
  canvas.id = 'gridcal-hold-canvas';
  canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
  container.insertBefore(canvas, document.getElementById('fog-canvas'));
  gridCalFreeze = { canvas, ctx: canvas.getContext('2d'), still };
}

function gridCalReleaseMap() {
  if (!gridCalFreeze) return;
  if (gridCalFreeze.canvas.parentNode) gridCalFreeze.canvas.parentNode.removeChild(gridCalFreeze.canvas);
  gridCalFreeze = null;
}

// Redrawn under the live transform, so panning and zooming keep working while the frame is held.
function gridCalDrawHeld() {
  if (!gridCalFreeze) return;
  const f = gridCalFreeze;
  const cw = container.clientWidth, ch = container.clientHeight;
  if (f.canvas.width !== cw) f.canvas.width = cw;
  if (f.canvas.height !== ch) f.canvas.height = ch;
  f.ctx.clearRect(0, 0, cw, ch);
  f.ctx.drawImage(f.still, 0, 0, f.still.width, f.still.height,
                  panX, panY, mapWidth * zoom, mapHeight * zoom);
}

// ─── Square or hexagon ────────────────────────────────────────────────────────
// One span record, two readings. A square span is a corner and its opposite corner; a hex span
// is a CENTRE and a radius handle, because a hex grid's phase is where a hex centre sits.
function gridCalIsHex() {
  return gridMode === 'hex-flat' || gridMode === 'hex-pointy';
}

// Off drawGridLines (grid.js): gridSize is the circumradius, and the two modes swap which axis
// carries the 1.5R centre-to-centre step.
function gridCalHexGeom() {
  const flat = gridMode === 'hex-flat';
  return {
    flat,
    a0: flat ? 0 : Math.PI / 6,
    stepX: flat ? 1.5 : Math.sqrt(3),
    stepY: flat ? Math.sqrt(3) : 1.5,
  };
}

// What the DM dragged out: a square's side or a hexagon's circumradius. Both divide by the count.
function gridCalSpanReach(s) {
  return gridCalIsHex() ? Math.hypot(s.bx - s.ax, s.by - s.ay) : Math.abs(s.bx - s.ax);
}

function gridCalHexVerts(s) {
  const g = gridCalHexGeom();
  const r = Math.hypot(s.bx - s.ax, s.by - s.ay);
  const out = [];
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 3 * k + g.a0;
    out.push({ x: s.ax + r * Math.cos(a), y: s.ay + r * Math.sin(a) });
  }
  return out;
}

// ─── The maths ────────────────────────────────────────────────────────────────
// The control's own range is the clamp, so a widened slider cannot disagree with a gesture.
function gridCalCellRange() {
  const el = document.getElementById('grid-size');
  return { min: Number(el && el.min) || 10, max: Number(el && el.max) || 400 };
}

// The dominant axis is the one being dragged. Near a diagonal drag the two are equal anyway, so
// the square never appears to jump between them.
function gridCalSquareEnd(ax, ay, mx, my) {
  const dx = mx - ax, dy = my - ay;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return { bx: ax + (dx < 0 ? -side : side), by: ay + (dy < 0 ? -side : side) };
}

function gridCalPhase(v, step) {
  return ((v % step) + step) % step;
}

// ⚠ A HEX LATTICE STAGGERS every other column (flat) or row (pointy) by half a step, so one axis's
// phase depends on the anchor's index (drawGridLines) - a plain modulo lands half a cell off.
function gridCalWrite(cell, ax, ay) {
  const r = gridCalCellRange();
  gridSize = Math.max(r.min, Math.min(r.max, cell));
  const g = gridCalIsHex() ? gridCalHexGeom() : null;
  if (!g) {
    gridOffsetX = gridCalPhase(ax, gridSize);
    gridOffsetY = gridCalPhase(ay, gridSize);
  } else {
    const px = gridSize * g.stepX, py = gridSize * g.stepY;
    if (g.flat) {
      gridOffsetX = gridCalPhase(ax, px);
      const col = Math.round((ax - gridOffsetX) / px);
      gridOffsetY = gridCalPhase(ay - (col & 1) * py / 2, py);
    } else {
      gridOffsetY = gridCalPhase(ay, py);
      const row = Math.round((ay - gridOffsetY) / py);
      gridOffsetX = gridCalPhase(ax - (row & 1) * px / 2, px);
    }
  }
  gridDirty = true;
  scheduleRender();
}

// Finished path. Through applyGridConfig so the sliders and number chips move with the globals,
// then commitGridChange so the scene keeps it and the Player gets it.
function gridCalCommit() {
  applyGridConfig({ ...captureGridConfig(), cellSize: gridSize, offsetX: gridOffsetX, offsetY: gridOffsetY });
  commitGridChange();
  gridCalRefreshUI();
}

// gridCalWrite's clamp paints a 10px lattice over the whole map, so a span that small is refused.
function gridCalCellFits(reach, n) {
  return n >= 1 && reach / n >= gridCalCellRange().min;
}

function gridCalApplySpan() {
  const s = gridCalSpan;
  if (!s || !s.n) return;
  gridCalWrite(gridCalSpanReach(s) / s.n, s.ax, s.ay);
}

// The count is GUESSED from the size already set, so a map whose size is far out guesses wrong and
// the stepper is the way back.
function gridCalCommitSpan(ax, ay, bx, by) {
  const n = Math.round(gridCalSpanReach({ ax, ay, bx, by }) / gridSize);
  if (n < 1) return;
  gridCalSpan = { ax, ay, bx, by, n };
  gridCalApplySpan();
  gridCalCommit();
}

function gridCalNudgeCount(by) {
  const s = gridCalSpan;
  if (!s) return;
  const n = Math.max(1, s.n + by);
  if (!gridCalCellFits(gridCalSpanReach(s), n)) return;
  s.n = n;
  gridCalApplySpan();
  gridCalCommit();
}

// n cells across and m down are two readings of one number. Least squares over both weights the
// longer axis, which is the reason to correct at a distance at all, and survives n or m being 0.
function gridCalSolveCell(n, m, w, h) {
  const d = n * n + m * m;
  return d ? (n * w + m * h) / d : 0;
}

// Correcting inside the square just measured says nothing new, so the handle keeps clear of it.
function gridCalRefineMinCells() {
  return gridCalSpan ? Math.max(GRIDCAL_REFINE_MIN, gridCalSpan.n + 1) : GRIDCAL_REFINE_MIN;
}

function gridCalFindRefine(pos) {
  if (!gridCalSpan || gridMode !== 'square') return null;
  const n = Math.round((pos.x - gridCalSpan.ax) / gridSize);
  const m = Math.round((pos.y - gridCalSpan.ay) / gridSize);
  if (Math.max(Math.abs(n), Math.abs(m)) < gridCalRefineMinCells()) return null;
  const px = gridCalSpan.ax + n * gridSize, py = gridCalSpan.ay + m * gridSize;
  const s = toScreen(px, py), c = toScreen(pos.x, pos.y);
  if (Math.hypot(s.sx - c.sx, s.sy - c.sy) > GRIDCAL_HIT_PX * 2) return null;
  return { x: px, y: py, n, m };
}

function gridCalApplyRefine(tx, ty) {
  const s = gridCalSpan;
  const cell = gridCalSolveCell(gridCalRefine.n, gridCalRefine.m, tx - s.ax, ty - s.ay);
  if (!cell) return;
  gridCalWrite(cell, s.ax, s.ay);
  // The square redraws to the new cell size, so the box on screen never lies about the count it
  // claims. The handle rides the intersection it is solving for rather than the cursor: one number
  // is being fitted to two axes, and the gap shows how far the two disagree.
  s.bx = s.ax + (s.bx < s.ax ? -1 : 1) * s.n * gridSize;
  s.by = s.ay + (s.by < s.ay ? -1 : 1) * s.n * gridSize;
  gridCalRefine.x = s.ax + gridCalRefine.n * gridSize;
  gridCalRefine.y = s.ay + gridCalRefine.m * gridSize;
}

// ─── What the pointer is over ─────────────────────────────────────────────────
// The far corner wins over the body, or a square small on screen could never be resized.
function gridCalHitPart(pos) {
  const s = gridCalSpan;
  if (!s) return null;
  const c = toScreen(pos.x, pos.y), b = toScreen(s.bx, s.by);
  if (Math.hypot(c.sx - b.sx, c.sy - b.sy) <= GRIDCAL_HIT_PX) return 'resize';
  if (gridCalIsHex()) return pointInPolygon(pos.x, pos.y, gridCalHexVerts(s)) ? 'move' : null;
  const inX = pos.x >= Math.min(s.ax, s.bx) && pos.x <= Math.max(s.ax, s.bx);
  const inY = pos.y >= Math.min(s.ay, s.by) && pos.y <= Math.max(s.ay, s.by);
  return (inX && inY) ? 'move' : null;
}

function gridCalPartCursor(part) {
  if (part === 'move') return 'move';
  if (part !== 'resize') return 'crosshair';
  if (gridCalIsHex()) return 'grab';   // a radius handle, with no diagonal to point along
  const s = gridCalSpan;
  return ((s.bx - s.ax < 0) !== (s.by - s.ay < 0)) ? 'nesw-resize' : 'nwse-resize';
}

// The window mouseup carries no coordinates, and the hover magnifier runs before any drag.
function gridCalLastMapPos() {
  return { x: (lastScreenX - panX) / zoom, y: (lastScreenY - panY) / zoom };
}

// ─── Mouse, routed from input.js ──────────────────────────────────────────────
function gridCalMouseDown(raw) {
  // The correction handle wins over every other grab, or it could never be taken. It is only set
  // while the pointer sits on it, so its presence is the hit test.
  const part = gridCalRefine ? 'refine' : gridCalHitPart(raw);
  if (part === 'refine') {
    gridCalDrag = { which: 'refine', ox: gridCalRefine.x - raw.x, oy: gridCalRefine.y - raw.y };
  } else if (part === 'resize') {
    gridCalDrag = { which: 'resize' };
  } else if (part === 'move') {
    gridCalDrag = { which: 'move', ox: gridCalSpan.ax - raw.x, oy: gridCalSpan.ay - raw.y };
  } else {
    gridCalDrag = { which: 'span', ax: raw.x, ay: raw.y, bx: raw.x, by: raw.y };
  }
  // The magnifier's dot is the aim for a drag setting one point; a move aims with the whole span.
  container.style.cursor = part === 'move' ? 'grabbing' : 'none';
  drawCursor(lastScreenX, lastScreenY);
}

function gridCalMouseMove(pos) {
  if (!gridCalDrag) {
    gridCalRefine = gridCalFindRefine(pos);
    container.style.cursor = gridCalRefine ? 'grab' : gridCalPartCursor(gridCalHitPart(pos));
  } else if (gridCalDrag.which === 'span') {
    // A hexagon has no dominant axis: the press is its centre, the pointer its radius.
    const sq = gridCalIsHex() ? { bx: pos.x, by: pos.y }
                              : gridCalSquareEnd(gridCalDrag.ax, gridCalDrag.ay, pos.x, pos.y);
    gridCalDrag.bx = sq.bx; gridCalDrag.by = sq.by;
  } else if (gridCalDrag.which === 'move') {
    // The cell size holds and only the offset follows - sliding onto the map's lines is the point.
    const s = gridCalSpan;
    const w = s.bx - s.ax, h = s.by - s.ay;
    s.ax = pos.x + gridCalDrag.ox; s.ay = pos.y + gridCalDrag.oy;
    s.bx = s.ax + w; s.by = s.ay + h;
    gridCalWrite(gridSize, s.ax, s.ay);
  } else if (gridCalDrag.which === 'resize') {
    const s = gridCalSpan;
    const sq = gridCalIsHex() ? { bx: pos.x, by: pos.y }
                              : gridCalSquareEnd(s.ax, s.ay, pos.x, pos.y);
    const reach = gridCalSpanReach({ ax: s.ax, ay: s.ay, bx: sq.bx, by: sq.by });
    if (gridCalCellFits(reach, s.n)) {
      s.bx = sq.bx; s.by = sq.by;
      gridCalApplySpan();   // the count holds and the cell size follows
    }
  } else {
    gridCalApplyRefine(pos.x + gridCalDrag.ox, pos.y + gridCalDrag.oy);
  }
  drawCursor(lastScreenX, lastScreenY);
}

function gridCalMouseUp() {
  if (!gridCalDrag) return;
  const d = gridCalDrag;
  gridCalDrag = null;
  if (d.which === 'span') gridCalCommitSpan(d.ax, d.ay, d.bx, d.by);
  else gridCalCommit();
  container.style.cursor = gridCalPartCursor(gridCalHitPart(gridCalLastMapPos()));
  drawCursor(lastScreenX, lastScreenY);
}

// ─── The count HUD ────────────────────────────────────────────────────────────
// Contents and visibility; WHERE it goes is gridCalPlaceHud. The px stays on the square's label.
function gridCalRefreshUI() {
  const hud  = document.getElementById('gridcal-hud');
  const wrap = document.getElementById('gridcal-count-wrap');
  const num  = document.getElementById('gridcal-count');
  const hint = document.getElementById('gridcal-hint');
  if (num)  num.value = gridCalSpan ? gridCalSpan.n : '';
  if (wrap) wrap.style.display = gridCalSpan ? '' : 'none';
  if (hint) hint.style.display = gridCalSpan ? 'none' : '';
  if (!hud) return;
  hud.style.display = gridCalArmed ? 'flex' : 'none';
  if (gridCalArmed) gridCalPlaceHud();
}

// Under the square, flipped above near the window's bottom. Called from the draw path, so it
// tracks a pan, a zoom and a live drag alike.
// ⚠ The HUD carries the room card's ui-zoom, so a screen number written straight to style.left
// lands short. _rpScreenToStyle is the only correct conversion - see roomPanel.js.
function gridCalPlaceHud() {
  const hud = document.getElementById('gridcal-hud');
  if (!hud || hud.style.display === 'none') return;
  const r = hud.getBoundingClientRect();
  // toScreen is container-relative and the HUD is fixed, so the container's own origin goes back on.
  const box = container.getBoundingClientRect();
  const s = (gridCalDrag && gridCalDrag.which === 'span') ? gridCalDrag : gridCalSpan;
  let cx, top;
  if (!s) {
    // The toolbar's own box is the measure, so a taller context row carries the prompt with it.
    const bar = document.getElementById('tools-wrapper');
    const barTop = bar ? bar.getBoundingClientRect().top : window.innerHeight - 60;
    cx = box.left + box.width / 2;
    top = barTop - GRIDCAL_HUD_LIFT - r.height;
  } else {
    const a = toScreen(s.ax, s.ay), b = toScreen(s.bx, s.by);
    cx = box.left + (a.sx + b.sx) / 2;
    top = box.top + Math.max(a.sy, b.sy) + GRIDCAL_HUD_GAP;
    if (top + r.height > window.innerHeight - GRIDCAL_HUD_MARGIN) {
      top = box.top + Math.min(a.sy, b.sy) - GRIDCAL_HUD_GAP - r.height;
    }
  }
  const left = Math.max(GRIDCAL_HUD_MARGIN,
    Math.min(window.innerWidth - r.width - GRIDCAL_HUD_MARGIN, cx - r.width / 2));
  top = Math.max(GRIDCAL_HUD_MARGIN,
    Math.min(window.innerHeight - r.height - GRIDCAL_HUD_MARGIN, top));
  const st = _rpScreenToStyle(hud, left, top);
  hud.style.left = st.left + 'px';
  hud.style.top  = st.top  + 'px';
}

// ─── Drawing, from drawCursor ─────────────────────────────────────────────────
function gridCalHandle(sx, sy, r, fill, stroke) {
  cursorCtx.beginPath();
  cursorCtx.arc(sx, sy, r, 0, Math.PI * 2);
  cursorCtx.shadowColor = stroke; cursorCtx.shadowBlur = 10;
  cursorCtx.fillStyle = fill; cursorCtx.fill();
  cursorCtx.shadowBlur = 0;
  cursorCtx.strokeStyle = stroke; cursorCtx.lineWidth = 2; cursorCtx.stroke();
}

// Relative to what the screen already shows, so it keeps magnifying as the DM zooms in. A fixed
// multiple of the map's own pixels matched the map exactly at 2x zoom and shrank it above that.
// The floor keeps it above the map's own resolution when the whole map is on screen.
function gridCalMagnifier(p) {
  const src = mapOffscreen || (gridCalFreeze && gridCalFreeze.still) || mapVideo;
  if (!src) return;
  const natW = src.width || src.videoWidth || 0;
  if (!natW || !mapWidth) return;
  const ratio = natW / mapWidth;   // an animated map's frame is the video's size, not the map's
  const scale = Math.max(zoom * GRIDCAL_MAG_FACTOR, GRIDCAL_MAG_FLOOR);
  const half = GRIDCAL_MAG_RADIUS / scale;
  const s = toScreen(p.x, p.y);
  const R = GRIDCAL_MAG_RADIUS;
  cursorCtx.save();
  cursorCtx.beginPath(); cursorCtx.arc(s.sx, s.sy, R, 0, Math.PI * 2); cursorCtx.clip();
  cursorCtx.fillStyle = '#12121c';
  cursorCtx.fillRect(s.sx - R, s.sy - R, R * 2, R * 2);
  cursorCtx.drawImage(src,
    (p.x - half) * ratio, (p.y - half) * ratio, half * 2 * ratio, half * 2 * ratio,
    s.sx - R, s.sy - R, R * 2, R * 2);
  // A dot, not crosshair lines: lines cover the intersection the DM is aiming at.
  cursorCtx.beginPath(); cursorCtx.arc(s.sx, s.sy, 2.5, 0, Math.PI * 2);
  cursorCtx.fillStyle = 'rgba(255,60,60,0.95)'; cursorCtx.fill();
  cursorCtx.beginPath(); cursorCtx.arc(s.sx, s.sy, 2.5, 0, Math.PI * 2);
  cursorCtx.strokeStyle = 'rgba(255,255,255,0.8)'; cursorCtx.lineWidth = 1; cursorCtx.stroke();
  cursorCtx.restore();
  cursorCtx.beginPath(); cursorCtx.arc(s.sx, s.sy, R, 0, Math.PI * 2);
  cursorCtx.strokeStyle = 'rgba(255,255,255,0.85)'; cursorCtx.lineWidth = 2; cursorCtx.stroke();
}

function drawGridCalibration() {
  if (!gridCalArmed) return;
  gridCalDrawHeld();
  gridCalPlaceHud();
  const s = (gridCalDrag && gridCalDrag.which === 'span') ? gridCalDrag : gridCalSpan;
  if (!s) {
    // A hex span is placed by its CENTRE, so the magnifier rides the pointer before any drag.
    if (!gridCalDrag && lastScreenX != null) gridCalMagnifier(gridCalLastMapPos());
    return;
  }
  const a = toScreen(s.ax, s.ay), b = toScreen(s.bx, s.by);
  cursorCtx.save();
  cursorCtx.fillStyle = 'rgba(96,160,255,0.12)';
  cursorCtx.strokeStyle = 'rgba(96,160,255,0.9)';
  cursorCtx.lineWidth = 1.5;
  let x, y, w, h;
  if (gridCalIsHex()) {
    const v = gridCalHexVerts(s).map(q => toScreen(q.x, q.y));
    x = Math.min(...v.map(q => q.sx)); y = Math.min(...v.map(q => q.sy));
    w = Math.max(...v.map(q => q.sx)) - x; h = Math.max(...v.map(q => q.sy)) - y;
    cursorCtx.beginPath();
    v.forEach((q, i) => (i ? cursorCtx.lineTo(q.sx, q.sy) : cursorCtx.moveTo(q.sx, q.sy)));
    cursorCtx.closePath();
    cursorCtx.fill();
    cursorCtx.setLineDash([6, 4]); cursorCtx.stroke(); cursorCtx.setLineDash([]);
    // The handle is a radius rather than a corner, so the line says what it is measuring.
    cursorCtx.beginPath();
    cursorCtx.moveTo(a.sx, a.sy); cursorCtx.lineTo(b.sx, b.sy);
    cursorCtx.strokeStyle = 'rgba(96,160,255,0.45)'; cursorCtx.lineWidth = 1;
    cursorCtx.stroke();
  } else {
    x = Math.min(a.sx, b.sx); y = Math.min(a.sy, b.sy);
    w = Math.abs(b.sx - a.sx); h = Math.abs(b.sy - a.sy);
    cursorCtx.fillRect(x, y, w, h);
    cursorCtx.setLineDash([6, 4]); cursorCtx.strokeRect(x, y, w, h); cursorCtx.setLineDash([]);
  }

  // The count is on the HUD, so the label carries only what the count works out to. A committed
  // span reads gridSize, the clamped number the grid is drawn at; a live drag has written nothing
  // yet, so it previews.
  const n = s.n != null ? s.n : Math.round(gridCalSpanReach(s) / gridSize);
  if (n >= 1) {
    const label = (s.n != null ? gridSize : gridCalSpanReach(s) / n).toFixed(1) + ' px';
    cursorCtx.font = 'bold 12px ui-monospace, monospace';
    const tw = cursorCtx.measureText(label).width;
    cursorCtx.fillStyle = 'rgba(18,18,28,0.9)';
    cursorCtx.fillRect(x + w + 8, y - 20, tw + 12, 20);
    cursorCtx.fillStyle = '#8fb4ff';
    cursorCtx.fillText(label, x + w + 14, y - 6);
  }

  gridCalHandle(a.sx, a.sy, 5, '#ffffff', '#4080ff');
  gridCalHandle(b.sx, b.sy, 5, '#ffd166', '#c98a1e');
  if (gridCalRefine) {
    const r = toScreen(gridCalRefine.x, gridCalRefine.y);
    gridCalHandle(r.sx, r.sy, 6, '#ffd98a', '#e08b1e');
  }
  cursorCtx.restore();

  if (!gridCalDrag) return;
  // A move aims with the anchor corner; every other drag aims with the point it is setting.
  const grab = gridCalDrag.which;
  if (grab === 'span' || grab === 'resize') gridCalMagnifier({ x: s.bx, y: s.by });
  else if (grab === 'move') gridCalMagnifier({ x: s.ax, y: s.ay });
  else if (gridCalRefine) gridCalMagnifier(gridCalRefine);
}
