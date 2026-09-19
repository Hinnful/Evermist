'use strict';
// tools.js — which tool is in hand, the state every tool shares, and the dispatch that hands a
// click to it. A tool's own behaviour lives in its own file.

// ─── Tool state ───────────────────────────────────────────────────────────────
let tool  = 'reveal';
let shape = 'select';   // the tool the app is used with; setPlaceMode keeps it across modes
let brushSize = 40;
let isDrawing = false;
let pendingBrushOps = [];
let fogModifiedThisStroke = false;
let lastMapX, lastMapY;
let rectStartX, rectStartY;
let circleCenter = null;
// The cone's point of origin, held for the length of the drag. Same lifetime as circleCenter:
// set on mousedown, cleared on every release path including the one outside the canvas.
let coneApex = null;
// Direction snap for a cone, in degrees, when straighten-walls is on. 15 is what table tools
// settled on: eight compass points plus the halves between them.
const CONE_SNAP_DEG = 15;

// ─── Polygon tool state ───────────────────────────────────────────────────────
let activePolygon = null;   // polygon currently being drawn

// ─── Drawing aids ─────────────────────────────────────────────────────────────
let snapToGrid = false;
// Straighten-walls toggle. Runtime-only, like snapToGrid — never per scene, never in a backup.
let axisLock = false;
const AXIS_LOCK_PX = 12;   // screen px of slack before the snap lets go

// ─── Polygon helpers ──────────────────────────────────────────────────────────

function snapVertex(mapX, mapY) {
  if (!snapToGrid || !gridEnabled) return { x: mapX, y: mapY };
  if (gridMode !== 'square') return { x: mapX, y: mapY };
  return {
    x: Math.round((mapX - gridOffsetX) / gridSize) * gridSize + gridOffsetX,
    y: Math.round((mapY - gridOffsetY) / gridSize) * gridSize + gridOffsetY,
  };
}

// Straighten the point being placed against the one just placed. AXIS_LOCK_PX over zoom keeps
// the slack constant on screen; docs/DECISIONS.md carries the rest of the rule.
function axisLockDraw(pos) {
  if (!axisLock || !activePolygon || !activePolygon.vertices.length) return pos;
  const prev = activePolygon.vertices[activePolygon.vertices.length - 1];
  return snapToAxis(pos, [prev], AXIS_LOCK_PX / zoom);
}

// getPolyBBox lives in fogGeometry.js (pure geometry kernel, loaded first).

function segmentsIntersect(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  if (t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999) {
    return { x: p1.x + t * d1x, y: p1.y + t * d1y };
  }
  return null;
}

// ─── The tools ────────────────────────────────────────────────────────────────
// ⚠ ONE ROW PER TOOL, AND THE ROW IS THE WHOLE CONTRACT. A tool with no `drags` acts on the
// click itself; a dragging one gets start, move and finish, with the fog settled around it.
// A new tool is a file plus a row here, and nothing in this file learns its name.
const TOOLS = {
  select: { down: (raw, e) => selectMouseDown(raw, e) },
  poly:   { down: raw => toolPolyDown(raw) },
  door:   { down: raw => doorMouseDown(raw.x, raw.y) },
  cut:    { down: raw => cutMouseDown(raw.x, raw.y) },
  brush:  { drags: true, start: pos => toolBrushStart(pos),  move: pos => toolBrushMove(pos) },
  rect:   { drags: true, start: pos => toolRectStart(pos),   finish: pos => toolRectFinish(pos) },
  circle: { drags: true, start: pos => toolCircleStart(pos), finish: pos => toolCircleFinish(pos) },
  cone:   { drags: true, start: pos => toolConeStart(pos),   finish: pos => toolConeFinish(pos) },
};

// ─── Tool mouse handlers ──────────────────────────────────────────────────────
// Called from index.html with pre-converted MAP coordinates; panning and conversion are its job.

function toolMouseDown(raw, e) {
  const t = TOOLS[shape];
  if (!t) return;
  if (!t.drags) {
    const r = container.getBoundingClientRect();
    t.down(raw, e);
    drawCursor(e.clientX - r.left, e.clientY - r.top);
    return;
  }
  isDrawing = true;
  if (!isPlayer) pixiSetFogBrushing(true);
  fogModifiedThisStroke = false;
  t.start(raw);
}

function toolMouseMove(pos, e, screenX, screenY) {
  if (shape === 'select' && !selectDragging()) container.style.cursor = selectHoverCursor(pos);
  if (selectMouseMove(pos, screenX, screenY, e)) return;

  if (!isDrawing) return;
  const t = TOOLS[shape];
  if (t && t.move) t.move(pos);
  scheduleRender();
}

function toolMouseUp(pos, e) {
  if (selectMouseUp()) return;
  const t = TOOLS[shape];
  if (!t || !t.drags || !isDrawing) return;
  isDrawing = false;
  if (!isPlayer) pixiSetFogBrushing(false);
  lastMapX = lastMapY = null;
  if (t.finish) t.finish(pos);
  settleFogAfterStroke();
}

// Catches a drag released outside the canvas. Nothing is committed there - the shape in progress
// is dropped - but the fog the stroke already touched still has to settle.
function toolWindowMouseUp() {
  selectMouseUp();
  if (!isDrawing) return;
  isDrawing = false; lastMapX = lastMapY = null;
  if (!isPlayer) pixiSetFogBrushing(false);
  circleCenter = null;
  coneApex = null;
  settleFogAfterStroke();
}

// What a finished stroke leaves: the stencil rebuilt where fog was touched, then the transition
// that shows it. Gated on the stroke having touched fog, so drawing an effect rebuilds nothing.
function settleFogAfterStroke() {
  if (fogModifiedThisStroke && polygons.length > 0) rebuildFogFromPolygons();
  if (fogModifiedThisStroke) {
    startFogTransition(tool === 'shroud');
    rebuildFogEffect();
    scheduleAutoSync();
  }
  fogModifiedThisStroke = false;
  fogDirty = true;
  scheduleRender();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { segmentsIntersect };
}
