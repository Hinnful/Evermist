'use strict';

// shapeBox.js — the object-level bounding box and the rotate and scale it drives. One set of
// code serves a room, an effect and a hole. Loaded after shapeSelect.js.
//
// ⚠ THE BOX IS AXIS-ALIGNED AND NO ANGLE IS STORED. A rotate rewrites the points and the box
// re-derives from them, so a room, an effect and a hole all behave the same and no angle has to
// be kept in step with `holes` through a delete or a repair. Figma tilts its box instead, which
// needs a stored angle per ring.

// ─── Affine kernel ────────────────────────────────────────────────────────────
// [a,b,c,d,e,f]: x' = a·x + c·y + e, y' = b·x + d·y + f.

function matMul(m, n) {   // n applied first, then m
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
function matTranslate(tx, ty) { return [1, 0, 0, 1, tx, ty]; }
function matScale(sx, sy)     { return [sx, 0, 0, sy, 0, 0]; }
function matRotate(t) { const c = Math.cos(t), s = Math.sin(t); return [c, s, -s, c, 0, 0]; }

function applyMat(m, p) {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}
// ⚠ THE LINEAR PART ALONE. A curve handle is an offset, so applyMat would add the translation a
// second time and leave every control point adrift.
function applyMatVec(m, v) {
  return { x: m[0] * v.x + m[2] * v.y, y: m[1] * v.x + m[3] * v.y };
}

// ─── The box ──────────────────────────────────────────────────────────────────
// Corners only - an edge midpoint read as a fifth "vertex" on a simple room and was dropped.
const BOX_SIDES = ['nw', 'ne', 'se', 'sw'];
const BOX_MIN_SPAN = 2;        // map units a scale may never take a box under
const ROT_SNAP_DEG = 15;       // Shift, as in Figma

function boxFromPoints(points) {
  if (!points || points.length < 3) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

// y grows downward in map space, so 'n' is minY.
function boxSidePoint(b, name) {
  const mx = (b.minX + b.maxX) / 2, my = (b.minY + b.maxY) / 2;
  return {
    x: name.indexOf('w') >= 0 ? b.minX : name.indexOf('e') >= 0 ? b.maxX : mx,
    y: name.indexOf('n') >= 0 ? b.minY : name.indexOf('s') >= 0 ? b.maxY : my,
  };
}
function boxSidePoints(b) {
  return BOX_SIDES.map(name => { const p = boxSidePoint(b, name); return { name, x: p.x, y: p.y }; });
}
function boxCentre(b) { return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }; }

// The OPPOSITE side holds still: dragging 'se' pins 'nw', and dragging 'e' pins 'w'.
// ⚠ NO MIRRORING. A handle dragged past its anchor gives a negative factor, and that reverses
// every ring's winding — see the `floor-plan` skill for what winding decides.
function boxScaleFactors(b, name, pt, proportional) {
  const mx = (b.minX + b.maxX) / 2, my = (b.minY + b.maxY) / 2;
  const h = boxSidePoint(b, name);
  const ax = name.indexOf('w') >= 0 ? b.maxX : name.indexOf('e') >= 0 ? b.minX : mx;
  const ay = name.indexOf('n') >= 0 ? b.maxY : name.indexOf('s') >= 0 ? b.minY : my;
  const dx = h.x - ax, dy = h.y - ay;
  let sx = dx ? (pt.x - ax) / dx : 1;
  let sy = dy ? (pt.y - ay) / dy : 1;
  if (proportional && dx && dy) { const k = Math.max(sx, sy); sx = k; sy = k; }
  const w = b.maxX - b.minX, ht = b.maxY - b.minY;
  if (dx) sx = Math.max(sx, w ? BOX_MIN_SPAN / w : 1);
  if (dy) sy = Math.max(sy, ht ? BOX_MIN_SPAN / ht : 1);
  return { ax, ay, sx, sy };
}

function boxScaleMatrix(f) {
  return matMul(matTranslate(f.ax, f.ay),
         matMul(matScale(f.sx, f.sy), matTranslate(-f.ax, -f.ay)));
}
function boxRotateMatrix(c, angle) {
  return matMul(matTranslate(c.x, c.y), matMul(matRotate(angle), matTranslate(-c.x, -c.y)));
}
function snapAngle(rad, stepDeg) {
  const step = stepDeg * Math.PI / 180;
  return Math.round(rad / step) * step;
}

// Rings and curve handles only. ⚠ cornerRadii ARE LEFT ALONE, matching Figma's resize, and a door
// is {edge, t} along its wall, so it rides the transform untouched.
function transformRing(ring, m) { return ring.map(p => applyMat(m, p)); }
function transformHandle(h, m) {
  if (!h || (!h.ix && !h.iy && !h.ox && !h.oy)) return null;
  const i = applyMatVec(m, { x: h.ix || 0, y: h.iy || 0 });
  const o = applyMatVec(m, { x: h.ox || 0, y: h.oy || 0 });
  return { ix: i.x, iy: i.y, ox: o.x, oy: o.y };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    matMul, matTranslate, matScale, matRotate, applyMat, applyMatVec,
    boxFromPoints, boxSidePoint, boxSidePoints, boxCentre, boxScaleFactors,
    boxScaleMatrix, boxRotateMatrix, snapAngle, transformRing, transformHandle,
    BOX_SIDES, BOX_MIN_SPAN, ROT_SNAP_DEG,
  };
}

// ─── What the box is drawn around ─────────────────────────────────────────────
// Two moments, and only two: a shape picked as an object, and a hole picked inside its room.
// `hole` is -1 for the whole shape, otherwise an index into polyHoleRings().

const BOX_GRAB_PX   = 9;     // slack around a handle
const BOX_ROTATE_PX = 26;    // the rotate ring reaches this far outside a corner

function boxTargetOf(poly) {
  if (!poly) return null;
  if (!shapeEditMode) return -1;
  if (selectedHoleIndex >= 0 && !holeEditMode &&
      polyHoleRings(poly)[selectedHoleIndex]) return selectedHoleIndex;
  return null;
}

// Flat index range a target ring occupies.
function boxFlatRange(poly, hole) {
  const rings = polyRings(poly);
  if (hole < 0) return { from: 0, count: flatVertexCount(poly) };
  let from = 0;
  for (let r = 0; r <= hole; r++) from += rings[r].length;
  return { from, count: rings[hole + 1].length };
}

// ⚠ THE FLATTENED OUTLINE, not the anchors — a box drawn off the anchors cuts through the bulge
// of every bent wall.
function boxOutlinePoints(poly, hole) {
  const rings = polyRings(poly);
  const out = [];
  let off = 0;
  for (let r = 0; r < rings.length; r++) {
    if (hole < 0 || r === hole + 1) {
      const pts = poly.handles ? flattenRing(rings[r], poly.handles, off) : rings[r];
      for (const p of pts) out.push(p);
    }
    off += rings[r].length;
  }
  return out;
}

function shapeBoxOf(poly) {
  const hole = boxTargetOf(poly);
  if (hole == null) return null;
  const b = boxFromPoints(boxOutlinePoints(poly, hole));
  return b ? { ...b, hole } : null;
}

// ─── The gesture ──────────────────────────────────────────────────────────────
let boxDragSide   = null;    // which handle is held
let boxRotating   = false;
let boxDragBox    = null;    // the box as it stood at mousedown
let boxDragRings  = null;    // every ring of the shape, as it stood at mousedown
let boxDragHandles = null;   // poly.handles at mousedown, or null
let boxDragHole   = -1;
let boxDragFlat   = null;
let boxDragAngle0 = 0;
let boxDragHoleStuck = false;

// A corner first, then the ring just outside it that rotates.
function findBoxHandleAt(poly, mapX, mapY) {
  const b = shapeBoxOf(poly);
  if (!b) return null;
  const grab = BOX_GRAB_PX / zoom;
  const pts = boxSidePoints(b);
  for (const p of pts) {
    if (Math.abs(mapX - p.x) < grab && Math.abs(mapY - p.y) < grab) {
      return { box: b, name: p.name, rotate: false };
    }
  }
  // ⚠ OUTSIDE THE BOX ONLY. A bare radius round each corner meets in the middle of a small shape,
  // and a press meant to move it turns it instead.
  if (mapX > b.minX && mapX < b.maxX && mapY > b.minY && mapY < b.maxY) return null;
  const reach = BOX_ROTATE_PX / zoom;
  for (const p of pts) {
    const d = Math.hypot(mapX - p.x, mapY - p.y);
    if (d >= grab && d < reach) return { box: b, name: p.name, rotate: true };
  }
  return null;
}

function startBoxDrag(poly, hit, raw) {
  const rings = polyRings(poly);
  boxDragSide   = hit.name;
  boxRotating   = hit.rotate;
  boxDragBox    = hit.box;
  boxDragHole   = hit.box.hole;
  boxDragRings  = rings.map(r => r.map(v => ({ x: v.x, y: v.y })));
  boxDragHandles = poly.handles ? poly.handles.slice() : null;
  boxDragFlat   = boxFlatRange(poly, boxDragHole);
  const c = boxCentre(hit.box);
  boxDragAngle0 = Math.atan2(raw.y - c.y, raw.x - c.x);
  // ⚠ READ ONCE, for the reason spelled out on holeDragWasStuck in shapeSelect.js.
  boxDragHoleStuck = boxDragHole >= 0 &&
    !holeStaysOnRoom(poly, polyHoleRings(poly)[boxDragHole]);
  armDragUndo();
}

function boxDragging() { return boxDragSide !== null; }

// Over the SNAPSHOT every frame, so a drag never compounds its own rounding.
function boxDragMove(poly, pos, shiftHeld) {
  if (!boxDragSide || !boxDragRings) return;
  let m;
  if (boxRotating) {
    const c = boxCentre(boxDragBox);
    let d = Math.atan2(pos.y - c.y, pos.x - c.x) - boxDragAngle0;
    if (shiftHeld) d = snapAngle(d, ROT_SNAP_DEG);
    m = boxRotateMatrix(c, d);
  } else {
    m = boxScaleMatrix(boxScaleFactors(boxDragBox, boxDragSide, pos, shiftHeld));
  }
  const next = boxDragHole < 0
    ? boxDragRings.map(r => transformRing(r, m))
    : [transformRing(boxDragRings[boxDragHole + 1], m)];
  // Refused frames write nothing, as in the hole drag.
  if (boxDragHole >= 0 && !boxDragHoleStuck && !holeStaysOnRoom(poly, next[0])) return;
  pushDragUndo();
  if (boxDragHole < 0) {
    poly.vertices = next[0];
    setShapeHoles(poly, next.slice(1));
  } else {
    editHoles(poly, hs => { hs[boxDragHole] = next[0]; });
  }
  if (boxDragHandles) {
    const { from, count } = boxDragFlat;
    editHandles(poly, hs => {
      for (let k = from; k < from + count; k++) hs[k] = transformHandle(boxDragHandles[k], m);
    });
  }
  shapeGeometryChanged();
  fogDirty = true;
  scheduleRender();
}

function endBoxDrag() {
  boxDragSide = null;
  boxRotating = false;
  boxDragRings = null;
  boxDragHandles = null;
  boxDragBox = null;
  boxDragHole = -1;
  boxDragFlat = null;
}

function boxHoverCursor(poly, pos) {
  const hit = findBoxHandleAt(poly, pos.x, pos.y);
  if (!hit) return null;
  if (hit.rotate) return 'grab';
  return (hit.name === 'nw' || hit.name === 'se') ? 'nwse-resize' : 'nesw-resize';
}

// ─── Drawing ──────────────────────────────────────────────────────────────────
// Object level (a single click, before edit mode) is "focused": the same rounded-square corner
// edit mode draws unpicked, so a corner reads the same family everywhere it shows up.
function drawShapeBox(poly) {
  const b = shapeBoxOf(poly);
  if (!b) return;
  const a = toScreen(b.minX, b.minY), c = toScreen(b.maxX, b.maxY);
  const boxRgb = b.hole >= 0 ? SHAPE_PART_SELECTED_RGB : HELD_RGB;
  const handleStroke = b.hole >= 0 ? SHAPE_PART_SELECTED : POLY_EDGE_SELECTED;
  cursorCtx.save();
  cursorCtx.setLineDash([]);
  cursorCtx.shadowBlur = 0;
  cursorCtx.strokeStyle = `rgba(${boxRgb},${HELD_BOX_A})`;
  cursorCtx.lineWidth = 1;
  cursorCtx.strokeRect(a.sx, a.sy, c.sx - a.sx, c.sy - a.sy);
  for (const p of boxSidePoints(b)) {
    const s = toScreen(p.x, p.y);
    drawCorner(s.sx, s.sy, false, false, '#ffffff', handleStroke);
  }
  cursorCtx.restore();
}
