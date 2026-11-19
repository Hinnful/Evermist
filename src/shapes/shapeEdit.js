'use strict';

// Hand edits on the open shape: corner, wall, bend and curve-handle drags, a corner added or
// deleted. The selection itself, its levels and hit tests stay in shapeSelect.js.
// Every edit here reshapes by hand, so an effect's placed size (`preset`) goes with it: it reads "By hand".

// ─── Drag state ───────────────────────────────────────────────────────────────
// Transient, private to a gesture, so it stays out of state.js.
let isDraggingVertex = false;
let isDraggingEdge = false;
let edgeDragIndex = -1;         // flat index of the dragged edge's first vertex
let edgeDragOrigVerts = null;
let edgeDragStartMapX = 0, edgeDragStartMapY = 0;
// Ctrl+drag bends a wall; the two control points of the SELECTED vertex can then be dragged alone.
let isBendingEdge = false;
let bendEdgeIndex = -1, bendEndFlat = -1;
let bendT = 0.5;
let bendOrigCubic = null;
let bendStartMapX = 0, bendStartMapY = 0;
let bendMoved = false;
let isDraggingHandle = false;
let handleDragFlat = -1, handleDragPart = 'out';
let vertexDragFrom = null;      // the corner where its drag began: Shift keeps it level or plumb with this

function editCornerRadii(poly, edit) {
  const next = poly.cornerRadii ? poly.cornerRadii.slice()
                                : new Array(flatVertexCount(poly)).fill(null);
  edit(next);
  poly.cornerRadii = next;
}

// ⚠ SPLICED WHEREVER cornerRadii IS: both are flat-index parallel arrays, and one left behind puts
// every later curve on the wrong wall.
function editHandles(poly, edit) {
  const next = poly.handles ? poly.handles.slice()
                            : new Array(flatVertexCount(poly)).fill(null);
  edit(next);
  poly.handles = next.some(h => h) ? next : undefined;
  if (!poly.handles) delete poly.handles;
}

// Writes one control point as an offset from its anchor. The anchor keeps its own radius — the
// fog outline fillets a curved side against its own tangent (fogGeometry.js's computeFillet).
function setShapeHandle(poly, flat, part, dx, dy) {
  delete poly.preset;
  editHandles(poly, hs => {
    const h = hs[flat] ? { ...hs[flat] } : { ix: 0, iy: 0, ox: 0, oy: 0 };
    if (part === 'out') { h.ox = dx; h.oy = dy; } else { h.ix = dx; h.iy = dy; }
    hs[flat] = (h.ix || h.iy || h.ox || h.oy) ? h : null;
  });
}

// Copied, edited, reassigned, never spliced in place. A ring left under three points is dropped.
function editHoles(poly, edit) {
  delete poly.preset;
  // ⚠ FROM polyRings, not poly.holes: `edit` indexes the same rings flatVertexRef counted.
  const next = polyHoleRings(poly).map(h => h.slice());
  edit(next);
  setShapeHoles(poly, next.filter(h => h && h.length >= 3));
}

// The outer outline keeps three points; a hole falling below three is DROPPED, and ⚠ EVERY FLAT
// INDEX IT HELD GOES WITH IT — cornerRadii and doors are keyed by that index, so splicing one
// entry for a ring that took three away moves later doors onto other walls.
function deleteShapeVertex(poly, flat) {
  const ref = flatVertexRef(poly, flat);
  if (!ref) return false;
  const ring = polyRings(poly)[ref.ring];
  if (ref.ring === 0 && ring.length <= (poly.open ? 2 : 3)) return false;
  const dropRing = ref.ring > 0 && ring.length <= 3;
  // A dropped ring takes every index from its first; a single delete takes only its own.
  const at = dropRing ? flat - ref.i : flat;
  const gone = dropRing ? ring.length : 1;
  const ringLen = ring.length;
  pushUndo();
  delete poly.preset;
  if (ref.ring === 0) poly.vertices.splice(ref.i, 1);
  else editHoles(poly, hs => { hs[ref.ring - 1].splice(ref.i, 1); });
  if (poly.cornerRadii) editCornerRadii(poly, r => r.splice(at, gone));
  if (poly.handles) editHandles(poly, h => h.splice(at, gone));
  if (poly.doors) {
    poly.doors = dropRing
      ? poly.doors.filter(d => d.edge < at || d.edge >= at + gone)
                  .map(d => ({ ...d, edge: d.edge >= at + gone ? d.edge - gone : d.edge }))
      : remapDoorsForVertexChange(poly.doors, flat, -1, undefined, flat - ref.i, ringLen);
  }
  return true;
}

// The flat indices the ring held go with it, exactly as in deleteShapeVertex's drop-a-ring branch.
function deleteShapeHole(poly, holeIdx) {
  const rings = polyRings(poly);
  // ⚠ GUARDED BELOW ZERO: rings[0] is the OUTER ring, so -1 splices the outline's own radii away.
  const ring = holeIdx >= 0 ? rings[holeIdx + 1] : null;
  if (!ring) return false;
  let at = 0;
  for (let r = 0; r <= holeIdx; r++) at += rings[r].length;
  const gone = ring.length;
  pushUndo();
  delete poly.preset;
  editHoles(poly, hs => { hs.splice(holeIdx, 1); });
  if (poly.cornerRadii) editCornerRadii(poly, r => r.splice(at, gone));
  if (poly.handles) editHandles(poly, h => h.splice(at, gone));
  if (poly.doors) {
    poly.doors = poly.doors.filter(d => d.edge < at || d.edge >= at + gone)
                           .map(d => ({ ...d, edge: d.edge >= at + gone ? d.edge - gone : d.edge }));
  }
  return true;
}

// The pure half of starting a bend: everything derivable from the poly and the grab point alone,
// with no gesture state touched. THE GRAB POINT DECIDES THE SHAPE: the drag is shared between the
// wall's two control points by their weight at t, so the curve leans where it was grabbed. A
// single bow number would arc symmetrically, which is why it was refused. Pure. Unit-tested.
function computeBendStart(poly, ei, raw) {
  const ref = flatVertexRef(poly, ei);
  if (!ref) return null;
  const ring = polyRings(poly)[ref.ring];
  const fb = edgeEndFlat(ring, ref.i, ei);
  const near = closestOnEdge(poly, ring, ref.i, ei, raw.x, raw.y);
  // Clamped off the ends, where one control point's weight reaches zero and the share divides by it.
  const t = Math.max(0.05, Math.min(0.95, near.t));
  const cubic = edgeCubic(ring[ref.i], ring[(ref.i + 1) % ring.length],
                          handleAt(poly.handles, ei), handleAt(poly.handles, fb));
  return { fb, t, cubic };
}

// Ctrl+drag a wall bends it, Figma's gesture.
function startBend(poly, ei, raw) {
  const start = computeBendStart(poly, ei, raw);
  if (!start) return false;
  armDragUndo();
  isBendingEdge = true;
  bendEdgeIndex = ei;
  bendEndFlat = start.fb;
  bendT = start.t;
  bendOrigCubic = start.cubic;
  bendStartMapX = raw.x;
  bendStartMapY = raw.y;
  bendMoved = false;
  return true;
}

function straightenBentEdge(poly) {
  setShapeHandle(poly, bendEdgeIndex, 'out', 0, 0);
  setShapeHandle(poly, bendEndFlat, 'in', 0, 0);
}

// ─── Mouse ────────────────────────────────────────────────────────────────────
// The edit-mode press on the open shape's own parts. True when it took the press.
// Priority: a curve handle, then vertex, then edge; a hole's middle is shapeSelect.js's.
function editMouseDown(selPoly, raw, e) {
  const hp = findHandleAt(selPoly, raw.x, raw.y);
  if (hp) {
    armDragUndo();
    isDraggingHandle = true;
    handleDragFlat = selectedVertexIndex;
    handleDragPart = hp.part;
    return true;
  }
  const vi = findVertexAt(selPoly, raw.x, raw.y);
  if (vi >= 0) {
    armDragUndo();
    selectedVertexIndex = vi;
    // ⚠ NOT INSIDE THE HOLE'S OWN LEVEL: the index names the ring that level is open on, and
    // clearing it hands every hit test back to the room's outline.
    if (!holeEditMode) selectedHoleIndex = -1;
    isDraggingVertex = true;
    const ref = flatVertexRef(selPoly, vi);
    vertexDragFrom = ref ? { ...polyRings(selPoly)[ref.ring][ref.i] } : null;
    return true;
  }
  const ei = findEdgeAt(selPoly, raw.x, raw.y);
  if (ei < 0) return false;
  // Bend in the edit row's hand (editRow.js) is Ctrl+drag with no key held.
  if ((editRowBend() || (e && (e.ctrlKey || e.metaKey))) && startBend(selPoly, ei, raw)) return true;
  armDragUndo();
  isDraggingEdge = true;
  edgeDragIndex = ei;
  edgeDragStartMapX = raw.x;
  edgeDragStartMapY = raw.y;
  // Every ring, so a hole's wall drags like any other. edgeDragIndex is flat.
  edgeDragOrigVerts = polyRings(selPoly).map(r => r.map(v => ({ x: v.x, y: v.y })));
  return true;
}

function bendMove(pos, screenX, screenY) {
  const poly = findActiveShape();
  if (!poly || !bendOrigCubic) return;
  const dx = pos.x - bendStartMapX, dy = pos.y - bendStartMapY;
  if (dx || dy) bendMoved = true;
  const t = bendT, u = 1 - t;
  const w1 = 3 * u * u * t, w2 = 3 * u * t * t;
  const q = w1 * w1 + w2 * w2;
  const p0 = bendOrigCubic[0], c1 = bendOrigCubic[1];
  const c2 = bendOrigCubic[2], p3 = bendOrigCubic[3];
  const n1 = { x: c1.x + dx * w1 / q, y: c1.y + dy * w1 / q };
  const n2 = { x: c2.x + dx * w2 / q, y: c2.y + dy * w2 / q };
  const span = Math.hypot(p3.x - p0.x, p3.y - p0.y) || 1;
  pushDragUndo();
  // Dragged back near straight it SNAPS to straight, so flattening a wall needs no key at all.
  if (Math.hypot(n1.x - p0.x, n1.y - p0.y) < span * CURVE_FLAT_EPS &&
      Math.hypot(n2.x - p3.x, n2.y - p3.y) < span * CURVE_FLAT_EPS) {
    straightenBentEdge(poly);
  } else {
    setShapeHandle(poly, bendEdgeIndex, 'out', n1.x - p0.x, n1.y - p0.y);
    setShapeHandle(poly, bendEndFlat, 'in', n2.x - p3.x, n2.y - p3.y);
  }
  shapeGeometryChanged();
  fogDirty = true;
  scheduleRender();
  drawCursor(screenX, screenY);
}

function handleMove(pos, screenX, screenY) {
  const poly = findActiveShape();
  const ref = poly ? flatVertexRef(poly, handleDragFlat) : null;
  if (!ref) return;
  const v = polyRings(poly)[ref.ring][ref.i];
  pushDragUndo();
  setShapeHandle(poly, handleDragFlat, handleDragPart, pos.x - v.x, pos.y - v.y);
  shapeGeometryChanged();
  fogDirty = true;
  scheduleRender();
  drawCursor(screenX, screenY);
}

function vertexMove(pos, screenX, screenY, shift) {
  const poly = findActiveShape();
  const ref = poly ? flatVertexRef(poly, selectedVertexIndex) : null;
  if (!ref) return;
  const ring = polyRings(poly)[ref.ring];
  const n    = ring.length;
  // An open line's ends have one neighbour, and the other is that one.
  const prev = poly.open && ref.i === 0 ? ring[1] : ring[(ref.i - 1 + n) % n];
  const next = poly.open && ref.i === n - 1 ? ring[n - 2] : ring[(ref.i + 1) % n];
  // Straighten against BOTH ring neighbours, so either adjoining wall can go square.
  // Shift keeps the corner on the level or plumb line through where it started, whichever is nearer.
  const from = vertexDragFrom;
  const p = shift && from ? (Math.abs(pos.x - from.x) >= Math.abs(pos.y - from.y) ? { x: pos.x, y: from.y } : { x: from.x, y: pos.y })
    : axisLock ? snapToAxis(pos, [prev, next], AXIS_LOCK_PX / zoom) : pos;
  const VERT_EPSILON = 0.5; // map units — prevents coincident/zero-length edges
  if (Math.hypot(p.x - prev.x, p.y - prev.y) >= VERT_EPSILON &&
      Math.hypot(p.x - next.x, p.y - next.y) >= VERT_EPSILON) {
    pushDragUndo();
    delete poly.preset;
    if (ref.ring === 0) poly.vertices[ref.i] = { x: p.x, y: p.y };
    else editHoles(poly, hs => { hs[ref.ring - 1][ref.i] = { x: p.x, y: p.y }; });
    shapeGeometryChanged();
    fogDirty = true;
    scheduleRender();
  }
  drawCursor(screenX, screenY);
}

function edgeMove(pos, screenX, screenY) {
  const poly = findActiveShape();
  const ref = poly ? flatVertexRef(poly, edgeDragIndex) : null;
  // ⚠ THE EDGE WRAPS INSIDE ITS OWN RING. Wrapping against the outer ring's length reads
  // undefined off a hole's last edge and throws in the middle of a drag.
  if (!ref || !edgeDragOrigVerts || !edgeDragOrigVerts[ref.ring]) return;
  const orig = edgeDragOrigVerts[ref.ring];
  const n = orig.length;
  const a = orig[ref.i];
  const b = orig[(ref.i + 1) % n];
  const edx = b.x - a.x, edy = b.y - a.y;
  const len = Math.hypot(edx, edy);
  if (len > 0) {
    const nx = -edy / len, ny = edx / len;
    const proj = (pos.x - edgeDragStartMapX) * nx + (pos.y - edgeDragStartMapY) * ny;
    const p0 = { x: a.x + nx * proj, y: a.y + ny * proj };
    const p1 = { x: b.x + nx * proj, y: b.y + ny * proj };
    pushDragUndo();
    delete poly.preset;
    if (ref.ring === 0) {
      poly.vertices[ref.i] = p0;
      poly.vertices[(ref.i + 1) % n] = p1;
    } else {
      editHoles(poly, hs => {
        hs[ref.ring - 1][ref.i] = p0;
        hs[ref.ring - 1][(ref.i + 1) % n] = p1;
      });
    }
  }
  shapeGeometryChanged();
  drawCursor(screenX, screenY);
  fogDirty = true;
  scheduleRender();
}

// True when an edit drag owns this move, whether or not it wrote anything.
function editMouseMove(pos, screenX, screenY, e) {
  if (selectedPolygonId == null) return false;
  if (isBendingEdge) bendMove(pos, screenX, screenY);
  else if (isDraggingHandle) handleMove(pos, screenX, screenY);
  else if (isDraggingVertex) vertexMove(pos, screenX, screenY, !!(e && e.shiftKey));
  else if (isDraggingEdge) edgeMove(pos, screenX, screenY);
  else return false;
  return true;
}

function editDragging() {
  return isDraggingVertex || isDraggingEdge || isBendingEdge || isDraggingHandle;
}

// ⚠ RUN BEFORE shapeSelect.js READS _dragUndoPushed: the Ctrl+click straighten pushes the step
// that marks this release as one that wrote. Returns whether an edit drag was live.
function endEditDrag() {
  // Ctrl+CLICK, with no drag behind it, straightens the wall instead of bending it.
  if (isBendingEdge && !bendMoved) {
    const poly = findActiveShape();
    if (poly) { pushDragUndo(); straightenBentEdge(poly); shapeGeometryChanged(); fogDirty = true; }
  }
  const live = editDragging();
  isBendingEdge = isDraggingHandle = false;
  bendOrigCubic = null;
  isDraggingVertex = isDraggingEdge = false;
  edgeDragOrigVerts = vertexDragFrom = null;
  return live;
}

// A double-click on a wall in edit mode gains a vertex there.
function addCornerAt(poly, raw) {
  const ei = findEdgeAt(poly, raw.x, raw.y);
  if (ei < 0) return;
  const ref = flatVertexRef(poly, ei);
  if (!ref) return;
  pushUndo();
  delete poly.preset;
  const ring = polyRings(poly)[ref.ring];
  const a = ring[ref.i], b = ring[(ref.i + 1) % ring.length];
  const fb = edgeEndFlat(ring, ref.i, ei);
  const curved = edgeIsCurved(poly.handles, ei, fb);
  const near = closestOnEdge(poly, ring, ref.i, ei, raw.x, raw.y);
  const splitT = near.t;
  // A curved wall SPLITS EXACTLY: de Casteljau gives two cubics tracing the same curve, so a new
  // point never flattens the bend it landed on. A straight wall just takes the point.
  const cut = curved
    ? splitCubic(...edgeCubic(a, b, handleAt(poly.handles, ei), handleAt(poly.handles, fb)), splitT)
    : null;
  const pt = cut ? { ...cut.mid } : near.pt;
  if (ref.ring === 0) poly.vertices.splice(ref.i + 1, 0, pt);
  else editHoles(poly, hs => { hs[ref.ring - 1].splice(ref.i + 1, 0, pt); });
  // Both are keyed by the FLAT index, so a point added to a hole shifts every one after it.
  if (poly.cornerRadii) editCornerRadii(poly, r => r.splice(ei + 1, 0, null));
  if (poly.handles || cut) {
    editHandles(poly, hs => {
      hs.splice(ei + 1, 0, null);
      if (!cut) return;
      const fbAfter = fb > ei ? fb + 1 : fb;
      const set = (k, part, p, anchor) => {
        const h = hs[k] ? { ...hs[k] } : { ix: 0, iy: 0, ox: 0, oy: 0 };
        if (part === 'out') { h.ox = p.x - anchor.x; h.oy = p.y - anchor.y; }
        else { h.ix = p.x - anchor.x; h.iy = p.y - anchor.y; }
        hs[k] = (h.ix || h.iy || h.ox || h.oy) ? h : null;
      };
      set(ei, 'out', cut.left[1], a);
      set(ei + 1, 'in', cut.left[2], pt);
      set(ei + 1, 'out', cut.right[1], pt);
      set(fbAfter, 'in', cut.right[2], b);
    });
  }
  if (poly.doors) poly.doors = remapDoorsForVertexChange(poly.doors, ei, 1, splitT);
  selectedVertexIndex = ei + 1;
  selectedHoleIndex = -1;
  shapeGeometryChanged();
  persistShapeEdit();
  fogDirty = true;
  scheduleRender();
  drawCursor(lastScreenX, lastScreenY);
}

function deleteSelectedPart() {
  if (selectedPolygonId == null) return false;
  const poly = findActiveShape();
  if (shapeEditMode && poly) {
    // ⚠ A DELETE CAN TAKE THE WHOLE RING, and the hole indices after it shift up one. A level left
    // open on that index then edits the hole next door without saying so.
    const holesBefore = polyHoleRings(poly).length;
    if (selectedVertexIndex >= 0) {
      if (!deleteShapeVertex(poly, selectedVertexIndex)) return true;
      selectedVertexIndex = -1;
      if (holeEditMode && polyHoleRings(poly).length !== holesBefore) {
        holeEditMode = false;
        selectedHoleIndex = -1;
      }
    } else if (selectedHoleIndex >= 0) {
      if (!deleteShapeHole(poly, selectedHoleIndex)) return true;
      selectedHoleIndex = -1;
      holeEditMode = false;
    } else {
      deleteSelectedPolygon();
      return true;
    }
    shapeGeometryChanged();
    persistShapeEdit();
    fogDirty = true;
    scheduleRender();
    drawCursor(lastScreenX, lastScreenY);
    return true;
  }
  deleteSelectedPolygon();
  return true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    deleteShapeVertex, deleteShapeHole,
    editCornerRadii, editHandles, editHoles, computeBendStart,
  };
}
