'use strict';

// ⚠ THE TWO LEVELS ARE NEVER ON SCREEN TOGETHER - doors, labels and the room card already ride the
// map, and a vertex set under a bounding box buries both. The selection lives in state.js, read by
// a dozen modules; docs/ARCHITECTURE.md has the shape of the levels.

// ─── Drag state ───────────────────────────────────────────────────────────────
// Transient, private to a gesture, so it stays out of state.js.
let isDraggingPolygon = false;
let dragStartMapX = 0, dragStartMapY = 0;
let dragOrigVerts = null;   // snapshot of every ring at drag start
let isDraggingVertex = false;
let isDraggingEdge = false;
let edgeDragIndex = -1;         // flat index of the dragged edge's first vertex
let edgeDragOrigVerts = null;
let edgeDragStartMapX = 0, edgeDragStartMapY = 0;
let isDraggingHole = false;
let holeDragOrigRing = null;
let holeDragStartMapX = 0, holeDragStartMapY = 0;
// ⚠ A hole whose centre ALREADY sits off its room fails the stop test on every frame, so without
// this it could never be dragged home. Read once at mousedown; that drag runs free.
let holeDragWasStuck = false;

// ⚠ PUSHED ON THE FIRST MOVEMENT, never on mousedown: selecting moves nothing, so a push there
// spends a Ctrl+Z and a fog-canvas clone per selection. ⚠ ALSO THE "DID THIS DRAG WRITE ANYTHING"
// flag on release - committing a press that only PICKED rebuilds the fog and re-sends the scene.
// Ctrl+drag bends a wall; the two control points of the SELECTED vertex can then be dragged alone.
let isBendingEdge = false;
let bendEdgeIndex = -1, bendEndFlat = -1;
let bendT = 0.5;
let bendOrigCubic = null;
let bendStartMapX = 0, bendStartMapY = 0;
let bendMoved = false;
let isDraggingHandle = false;
let handleDragFlat = -1, handleDragPart = 'out';

let _dragUndoPushed = false;
function armDragUndo()  { _dragUndoPushed = false; }
function pushDragUndo() { if (!_dragUndoPushed) { _dragUndoPushed = true; pushUndo(); } }

// ⚠ EVERY DROP CLEARS THE LEVEL BELOW, or a stale index outlives its drawing.
function enterShapeEditMode(id) {
  selectedPolygonId = id;
  shapeEditMode = true;
  selectedVertexIndex = -1;
  selectedHoleIndex = -1;
}

function leaveShapeEditMode() {
  shapeEditMode = false;
  selectedVertexIndex = -1;
  selectedHoleIndex = -1;
}

function clearShapeSelection() {
  selectedPolygonId = null;
  leaveShapeEditMode();
}

function pointInPolygon(px, py, verts) {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i].x, yi = verts[i].y;
    const xj = verts[j].x, yj = verts[j].y;
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ⚠ ONE CROSSING TEST PER RING, XORed. Concatenating the rings and testing once wraps j past the
// end of each ring: the closing edges vanish, two bridge edges appear, and the room grows dead
// patches where a click selects nothing.
function pointInShape(px, py, poly) {
  const verts = poly && poly.vertices;
  if (!verts || verts.length < 3) return false;
  const holes = polyHoleRings(poly);
  // A BENT WALL bows away from the straight line between its anchors, so a click in the bulge has
  // to be tested against the curve or the room has a dead strip along it.
  const h = poly.handles;
  const flat = (ring, off) => (h ? flattenRing(ring, h, off) : ring);
  if (!holes.length) return pointInPolygon(px, py, flat(verts, 0));
  let inside = pointInPolygon(px, py, flat(verts, 0));
  let off = verts.length;
  for (const ring of holes) {
    if (pointInPolygon(px, py, flat(ring, off))) inside = !inside;
    off += ring.length;
  }
  return inside;
}

function findPolygonAt(mapX, mapY) {
  const list = activeShapeList();
  for (let i = list.length - 1; i >= 0; i--) {
    if (pointInShape(mapX, mapY, list[i])) return list[i];
  }
  return null;
}

// A hole's empty middle is its only grab target: pointInShape XORs it out. Reversed, so the newer
// of two overlapping holes takes the click.
function findHoleAt(poly, mapX, mapY) {
  const holes = polyHoleRings(poly);
  for (let i = holes.length - 1; i >= 0; i--) {
    if (pointInPolygon(mapX, mapY, holes[i])) return i;
  }
  return -1;
}

function distPointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: ax, y: ay };
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return { x: ax + t * dx, y: ay + t * dy };
}

function findVertexAt(poly, mapX, mapY) {
  const hitR = Math.min(10 / zoom, 30); // clamp: the grab shrinks when zoomed far out
  let flat = 0;
  for (const ring of polyRings(poly)) {
    for (let i = 0; i < ring.length; i++, flat++) {
      if (Math.hypot(mapX - ring[i].x, mapY - ring[i].y) < hitR) return flat;
    }
  }
  return -1;
}

// The flat index of the wall's far anchor. A ring wraps, so the last wall ends back at its first.
function edgeEndFlat(ring, i, flat) {
  return flat - i + ((i + 1) % ring.length);
}

// What a wall is hit-tested against: itself when straight, its sampled curve when bent.
function edgePolyline(poly, ring, i, flat) {
  const a = ring[i], b = ring[(i + 1) % ring.length];
  const fb = edgeEndFlat(ring, i, flat);
  if (!edgeIsCurved(poly.handles, flat, fb)) return [a, b];
  const c = edgeCubic(a, b, handleAt(poly.handles, flat), handleAt(poly.handles, fb));
  return [a].concat(sampleCubic(c[0], c[1], c[2], c[3], CURVE_SAMPLE_STEPS));
}

function distToEdge(poly, ring, i, flat, mapX, mapY) {
  const pts = edgePolyline(poly, ring, i, flat);
  let best = Infinity;
  for (let k = 0; k + 1 < pts.length; k++) {
    const d = distPointToSegment(mapX, mapY, pts[k].x, pts[k].y, pts[k + 1].x, pts[k + 1].y);
    if (d < best) best = d;
  }
  return best;
}

// The point on a wall nearest the cursor, with `t` the fraction of the wall's own LENGTH — what a
// door and a vertex insert both key off.
function closestOnEdge(poly, ring, i, flat, mapX, mapY) {
  const pts = edgePolyline(poly, ring, i, flat);
  let best = Infinity, bestPt = pts[0], bestRun = 0, run = 0, total = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const seg = Math.hypot(pts[k + 1].x - pts[k].x, pts[k + 1].y - pts[k].y);
    const q = closestPointOnSegment(mapX, mapY, pts[k].x, pts[k].y, pts[k + 1].x, pts[k + 1].y);
    const d = Math.hypot(mapX - q.x, mapY - q.y);
    if (d < best) { best = d; bestPt = q; bestRun = total + Math.hypot(q.x - pts[k].x, q.y - pts[k].y); }
    total += seg;
  }
  run = total > 0 ? bestRun / total : 0.5;
  return { pt: bestPt, t: Math.max(0, Math.min(1, run)) };
}

function findEdgeAt(poly, mapX, mapY) {
  const hitR = 10 / zoom;
  let flat = 0;
  for (const verts of polyRings(poly)) {
    for (let i = 0; i < verts.length; i++, flat++) {
      if (distToEdge(poly, verts, i, flat, mapX, mapY) < hitR) return flat;
    }
  }
  return -1;
}

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

// Writes one control point as an offset from its anchor, and ⚠ CLEARS THAT ANCHOR'S RADIUS —
// an anchor carries a corner radius or handles, never both.
function setShapeHandle(poly, flat, part, dx, dy) {
  editHandles(poly, hs => {
    const h = hs[flat] ? { ...hs[flat] } : { ix: 0, iy: 0, ox: 0, oy: 0 };
    if (part === 'out') { h.ox = dx; h.oy = dy; } else { h.ix = dx; h.iy = dy; }
    hs[flat] = (h.ix || h.iy || h.ox || h.oy) ? h : null;
  });
  if (poly.handles && poly.handles[flat] && poly.cornerRadii) {
    editCornerRadii(poly, r => { r[flat] = 0; });
  }
}

// Copied, edited, reassigned, never spliced in place. A ring left under three points is dropped.
function editHoles(poly, edit) {
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
  if (ref.ring === 0 && ring.length <= 3) return false;
  const dropRing = ref.ring > 0 && ring.length <= 3;
  // A dropped ring takes every index from its first; a single delete takes only its own.
  const at = dropRing ? flat - ref.i : flat;
  const gone = dropRing ? ring.length : 1;
  pushUndo();
  if (ref.ring === 0) poly.vertices.splice(ref.i, 1);
  else editHoles(poly, hs => { hs[ref.ring - 1].splice(ref.i, 1); });
  if (poly.cornerRadii) editCornerRadii(poly, r => r.splice(at, gone));
  if (poly.handles) editHandles(poly, h => h.splice(at, gone));
  if (poly.doors) {
    poly.doors = dropRing
      ? poly.doors.filter(d => d.edge < at || d.edge >= at + gone)
                  .map(d => ({ ...d, edge: d.edge >= at + gone ? d.edge - gone : d.edge }))
      : remapDoorsForVertexChange(poly.doors, flat, -1);
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
  editHoles(poly, hs => { hs.splice(holeIdx, 1); });
  if (poly.cornerRadii) editCornerRadii(poly, r => r.splice(at, gone));
  if (poly.handles) editHandles(poly, h => h.splice(at, gone));
  if (poly.doors) {
    poly.doors = poly.doors.filter(d => d.edge < at || d.edge >= at + gone)
                           .map(d => ({ ...d, edge: d.edge >= at + gone ? d.edge - gone : d.edge }));
  }
  return true;
}

// A dragged hole STOPS DEAD where it would leave its room: one off its room cuts nothing and reads
// as vanished. The test is the ring's average point; docs/decisions/ui-and-control-panel.md says why.
function ringCentre(ring) {
  let x = 0, y = 0;
  for (const v of ring) { x += v.x; y += v.y; }
  return { x: x / ring.length, y: y / ring.length };
}

function holeStaysOnRoom(poly, movedRing) {
  const c = ringCentre(movedRing);
  return pointInPolygon(c.x, c.y,
    poly.handles ? flattenRing(poly.vertices, poly.handles, 0) : poly.vertices);
}

// ─── Mouse ────────────────────────────────────────────────────────────────────
// The SELECTED vertex's two control points, in map space. Nothing else shows handles, or the map
// carries two per corner of every room.
function selectedHandlePoints(poly) {
  if (!shapeEditMode || selectedVertexIndex < 0) return [];
  const h = handleAt(poly.handles, selectedVertexIndex);
  const ref = h ? flatVertexRef(poly, selectedVertexIndex) : null;
  if (!ref) return [];
  const v = polyRings(poly)[ref.ring][ref.i];
  const out = [];
  if (h.ox || h.oy) out.push({ part: 'out', x: v.x + h.ox, y: v.y + h.oy, anchor: v });
  if (h.ix || h.iy) out.push({ part: 'in',  x: v.x + h.ix, y: v.y + h.iy, anchor: v });
  return out;
}

function findHandleAt(poly, mapX, mapY) {
  const hitR = Math.min(9 / zoom, 28);
  for (const p of selectedHandlePoints(poly)) {
    if (Math.hypot(mapX - p.x, mapY - p.y) < hitR) return p;
  }
  return null;
}

// Ctrl+drag a wall bends it, Figma's gesture. THE GRAB POINT DECIDES THE SHAPE: the drag is
// shared between the wall's two control points by their weight at t, so the curve leans where it
// was grabbed. A single bow number would arc symmetrically, which is why it was refused.
function startBend(poly, ei, raw) {
  const ref = flatVertexRef(poly, ei);
  if (!ref) return false;
  const ring = polyRings(poly)[ref.ring];
  const fb = edgeEndFlat(ring, ref.i, ei);
  const near = closestOnEdge(poly, ring, ref.i, ei, raw.x, raw.y);
  armDragUndo();
  isBendingEdge = true;
  bendEdgeIndex = ei;
  bendEndFlat = fb;
  // Clamped off the ends, where one control point's weight reaches zero and the share divides by it.
  bendT = Math.max(0.05, Math.min(0.95, near.t));
  bendOrigCubic = edgeCubic(ring[ref.i], ring[(ref.i + 1) % ring.length],
                            handleAt(poly.handles, ei), handleAt(poly.handles, fb));
  bendStartMapX = raw.x;
  bendStartMapY = raw.y;
  bendMoved = false;
  return true;
}

function straightenBentEdge(poly) {
  setShapeHandle(poly, bendEdgeIndex, 'out', 0, 0);
  setShapeHandle(poly, bendEndFlat, 'in', 0, 0);
}

function selectMouseDown(raw, e) {
  const selPoly = findActiveShape();

  if (selPoly && shapeEditMode) {
    // Priority inside edit mode: a curve handle, then vertex, then edge, then a hole's middle.
    const hp = findHandleAt(selPoly, raw.x, raw.y);
    if (hp) {
      armDragUndo();
      isDraggingHandle = true;
      handleDragFlat = selectedVertexIndex;
      handleDragPart = hp.part;
      return;
    }
    const vi = findVertexAt(selPoly, raw.x, raw.y);
    if (vi >= 0) {
      armDragUndo();
      selectedVertexIndex = vi;
      selectedHoleIndex = -1;
      isDraggingVertex = true;
      return;
    }
    const ei = findEdgeAt(selPoly, raw.x, raw.y);
    if (ei >= 0) {
      if (e && e.ctrlKey && startBend(selPoly, ei, raw)) return;
      armDragUndo();
      isDraggingEdge = true;
      edgeDragIndex = ei;
      edgeDragStartMapX = raw.x;
      edgeDragStartMapY = raw.y;
      // Every ring, so a hole's wall drags like any other. edgeDragIndex is flat.
      edgeDragOrigVerts = polyRings(selPoly).map(r => r.map(v => ({ x: v.x, y: v.y })));
      return;
    }
    const hi = findHoleAt(selPoly, raw.x, raw.y);
    if (hi >= 0) {
      armDragUndo();
      selectedHoleIndex = hi;
      selectedVertexIndex = -1;
      isDraggingHole = true;
      holeDragStartMapX = raw.x;
      holeDragStartMapY = raw.y;
      holeDragOrigRing = polyHoleRings(selPoly)[hi].map(v => ({ x: v.x, y: v.y }));
      holeDragWasStuck = !holeStaysOnRoom(selPoly, holeDragOrigRing);
      return;
    }
  }

  const hit = findPolygonAt(raw.x, raw.y);
  if (hit) {
    if (hit.id !== selectedPolygonId) { selectedPolygonId = hit.id; leaveShapeEditMode(); }
    else if (shapeEditMode) { selectedVertexIndex = -1; selectedHoleIndex = -1; }
    armDragUndo();
    isDraggingPolygon = true;
    dragStartMapX = raw.x;
    dragStartMapY = raw.y;
    dragOrigVerts = polyRings(hit).map(r => r.map(v => ({ x: v.x, y: v.y })));
  } else {
    clearShapeSelection();
  }
}

function selectHoverCursor(pos) {
  const selPoly = findActiveShape();
  if (selPoly && shapeEditMode) {
    if (findHandleAt(selPoly, pos.x, pos.y)) return 'pointer';
    if (findVertexAt(selPoly, pos.x, pos.y) >= 0) return 'pointer';
    if (findEdgeAt(selPoly, pos.x, pos.y) >= 0) return 'grab';
    if (findHoleAt(selPoly, pos.x, pos.y) >= 0) return 'move';
  }
  return findPolygonAt(pos.x, pos.y) ? 'move' : 'default';
}

function selectMouseMove(pos, screenX, screenY) {
  if (isBendingEdge && selectedPolygonId != null) {
    const poly = findActiveShape();
    if (poly && bendOrigCubic) {
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
    return true;
  }

  if (isDraggingHandle && selectedPolygonId != null) {
    const poly = findActiveShape();
    const ref = poly ? flatVertexRef(poly, handleDragFlat) : null;
    if (ref) {
      const v = polyRings(poly)[ref.ring][ref.i];
      pushDragUndo();
      setShapeHandle(poly, handleDragFlat, handleDragPart, pos.x - v.x, pos.y - v.y);
      shapeGeometryChanged();
      fogDirty = true;
      scheduleRender();
      drawCursor(screenX, screenY);
    }
    return true;
  }

  if (isDraggingVertex && selectedPolygonId != null) {
    const poly = findActiveShape();
    const ref = poly ? flatVertexRef(poly, selectedVertexIndex) : null;
    if (ref) {
      const ring = polyRings(poly)[ref.ring];
      const n    = ring.length;
      const prev = ring[(ref.i - 1 + n) % n];
      const next = ring[(ref.i + 1) % n];
      // Straighten against BOTH ring neighbours, so either adjoining wall can go square.
      const p = axisLock ? snapToAxis(pos, [prev, next], AXIS_LOCK_PX / zoom) : pos;
      const VERT_EPSILON = 0.5; // map units — prevents coincident/zero-length edges
      if (Math.hypot(p.x - prev.x, p.y - prev.y) >= VERT_EPSILON &&
          Math.hypot(p.x - next.x, p.y - next.y) >= VERT_EPSILON) {
        pushDragUndo();
        if (ref.ring === 0) poly.vertices[ref.i] = { x: p.x, y: p.y };
        else editHoles(poly, hs => { hs[ref.ring - 1][ref.i] = { x: p.x, y: p.y }; });
        shapeGeometryChanged();
        fogDirty = true;
        scheduleRender();
      }
      drawCursor(screenX, screenY);
    }
    return true;
  }

  if (isDraggingEdge && selectedPolygonId != null) {
    const poly = findActiveShape();
    const ref = poly ? flatVertexRef(poly, edgeDragIndex) : null;
    // ⚠ THE EDGE WRAPS INSIDE ITS OWN RING. Wrapping against the outer ring's length reads
    // undefined off a hole's last edge and throws in the middle of a drag.
    if (ref && edgeDragOrigVerts && edgeDragOrigVerts[ref.ring]) {
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
    return true;
  }

  if (isDraggingHole && selectedPolygonId != null) {
    const poly = findActiveShape();
    if (poly && holeDragOrigRing) {
      const dx = pos.x - holeDragStartMapX;
      const dy = pos.y - holeDragStartMapY;
      const moved = holeDragOrigRing.map(v => ({ x: v.x + dx, y: v.y + dy }));
      // A refused frame writes nothing: the hole holds its last good spot and resumes.
      if (holeDragWasStuck || holeStaysOnRoom(poly, moved)) {
        pushDragUndo();
        editHoles(poly, hs => { hs[selectedHoleIndex] = moved; });
        shapeGeometryChanged();
        fogDirty = true;
        scheduleRender();
      }
      drawCursor(screenX, screenY);
    }
    return true;
  }

  if (isDraggingPolygon && selectedPolygonId != null) {
    const dx = pos.x - dragStartMapX;
    const dy = pos.y - dragStartMapY;
    const poly = findActiveShape();
    if (poly && dragOrigVerts) {
      pushDragUndo();
      const moved = dragOrigVerts.map(r => r.map(v => ({ x: v.x + dx, y: v.y + dy })));
      poly.vertices = moved[0];
      setShapeHoles(poly, moved.slice(1));
      shapeGeometryChanged();
      fogDirty = true;
      scheduleRender();
    }
    return true;
  }

  return false;
}

function selectDragging() {
  return isDraggingPolygon || isDraggingVertex || isDraggingEdge || isDraggingHole ||
         isBendingEdge || isDraggingHandle;
}

function selectMouseUp() {
  if (!selectDragging()) return false;
  // Ctrl+CLICK, with no drag behind it, straightens the wall instead of bending it.
  if (isBendingEdge && !bendMoved) {
    const poly = findActiveShape();
    if (poly) { pushDragUndo(); straightenBentEdge(poly); shapeGeometryChanged(); fogDirty = true; }
  }
  const wrote = _dragUndoPushed;
  const reshaped = isDraggingVertex || isDraggingEdge || isDraggingHole ||
                   isBendingEdge || isDraggingHandle;
  isBendingEdge = isDraggingHandle = false;
  bendOrigCubic = null;
  isDraggingVertex = isDraggingEdge = isDraggingHole = isDraggingPolygon = false;
  edgeDragOrigVerts = null;
  holeDragOrigRing = null;
  dragOrigVerts = null;
  if (wrote) commitShapeDrag();
  if (reshaped) drawCursor(lastScreenX, lastScreenY);   // re-place the card against the new shape
  return true;
}

// A double-click is the way IN to edit mode, and once inside it is the way a wall gains a vertex.
function selectDblClick(raw) {
  if (!shapeEditMode) {
    const hit = findPolygonAt(raw.x, raw.y);
    if (!hit) return;
    enterShapeEditMode(hit.id);
    drawCursor(lastScreenX, lastScreenY);
    scheduleRender();
    return;
  }
  const poly = findActiveShape();
  if (!poly) return;
  if (findVertexAt(poly, raw.x, raw.y) >= 0) return; // don't insert on existing vertex
  const ei = findEdgeAt(poly, raw.x, raw.y);
  if (ei < 0) return;
  const ref = flatVertexRef(poly, ei);
  if (!ref) return;
  pushUndo();
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
    if (selectedVertexIndex >= 0) {
      if (!deleteShapeVertex(poly, selectedVertexIndex)) return true;
      selectedVertexIndex = -1;
    } else if (selectedHoleIndex >= 0) {
      if (!deleteShapeHole(poly, selectedHoleIndex)) return true;
      selectedHoleIndex = -1;
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

// Escape climbs one level per press: the part, edit mode, then the shape.
function escapeShapeSelection() {
  if (selectedPolygonId == null) return false;
  if (shapeEditMode && (selectedVertexIndex >= 0 || selectedHoleIndex >= 0)) {
    selectedVertexIndex = -1;
    selectedHoleIndex = -1;
    drawCursor(lastScreenX, lastScreenY);
    return true;
  }
  if (shapeEditMode) {
    leaveShapeEditMode();
    drawCursor(lastScreenX, lastScreenY);
    scheduleRender();
    return true;
  }
  clearShapeSelection();
  drawCursor(null, null);
  return true;
}

// ⚠ VERTICES ONLY IN EDIT MODE - an object-level pick is the outline alone, leaving the room a
// bounding box will need.
function drawPolyOutline(poly, isSelected, selectedVertIdx, dimmed) {
  const verts = poly.vertices;
  if (verts.length < 2) return;
  const holeRings = polyHoleRings(poly);
  const editing = isSelected && shapeEditMode;
  const holeSel = editing && selectedHoleIndex >= 0 && selectedHoleIndex < holeRings.length
                ? selectedHoleIndex : -1;
  cursorCtx.save();
  // 0.3 was tried and disappeared entirely over the darker half of a map — "faint" has to stay
  // above "gone" on ground the DM did not choose.
  if (dimmed) cursorCtx.globalAlpha = 0.45;

  // One POLY_EDGE_COLORS table, so a room being drawn and the saved room match. Selected is
  // always gold; `material` tells an effect from a room and never reads as a fourth fog state.
  const edgeColor = isSelected
    ? POLY_EDGE_SELECTED
    : (poly.material ? EFFECT_EDGE_COLOR
                     : (POLY_EDGE_COLORS[poly.mode] || POLY_EDGE_COLORS.shroud));

  // Screen space, in flat index order: the outer ring, then each hole.
  const toSv = ring => ring.map(v => { const s = toScreen(v.x, v.y); return { x: s.sx, y: s.sy }; });
  const sv = toSv(verts);
  const svHoles = holeRings.map(toSv);
  const svAll = svHoles.length ? sv.concat(...svHoles) : sv;

  // A picked hole takes the outline down, so its own ring is what Delete visibly points at.
  if (holeSel >= 0) cursorCtx.globalAlpha *= 0.5;
  cursorCtx.strokeStyle = edgeColor;
  cursorCtx.lineWidth   = isSelected ? 2.5 : 1.5;
  cursorCtx.setLineDash(isSelected ? [] : [7, 4]);
  cursorCtx.shadowColor = edgeColor;
  cursorCtx.shadowBlur  = isSelected ? 10 : 6;
  cursorCtx.beginPath();
  const cr = (poly.cornerRadius || 0) * zoom;
  const pvR = poly.cornerRadii ? poly.cornerRadii.map(rv => (rv != null ? rv : (poly.cornerRadius || 0)) * zoom) : null;
  buildRoundedPolyPath(cursorCtx, sv, cr, pvR, svHoles, scaleHandles(poly.handles, zoom));
  cursorCtx.stroke();

  if (dimmed) { cursorCtx.restore(); return; }

  // The picked hole's ring, back at full strength in the blue a picked vertex already wears.
  if (holeSel >= 0) {
    const ring = svHoles[holeSel];
    cursorCtx.globalAlpha = 1;
    cursorCtx.strokeStyle = SHAPE_PART_SELECTED;
    cursorCtx.lineWidth   = 2.5;
    cursorCtx.setLineDash([]);
    cursorCtx.shadowColor = SHAPE_PART_SELECTED;
    cursorCtx.shadowBlur  = 12;
    cursorCtx.beginPath();
    cursorCtx.moveTo(ring[0].x, ring[0].y);
    for (let i = 1; i < ring.length; i++) cursorCtx.lineTo(ring[i].x, ring[i].y);
    cursorCtx.closePath();
    cursorCtx.stroke();
  }

  if (!editing) { cursorCtx.restore(); return; }

  // Vertex dots — at the real vertex, not the fillet, on every ring.
  cursorCtx.globalAlpha = 1;
  cursorCtx.setLineDash([]);
  for (let i = 0; i < svAll.length; i++) {
    const { x, y } = svAll[i];
    const isSelVert = i === selectedVertIdx;
    const r = isSelVert ? 7 : 5;
    cursorCtx.shadowColor = isSelVert ? SHAPE_PART_SELECTED : edgeColor;
    cursorCtx.shadowBlur  = isSelVert ? 14 : 6;
    cursorCtx.beginPath();
    cursorCtx.arc(x, y, r, 0, Math.PI * 2);
    cursorCtx.fillStyle = isSelVert ? '#ffffff' : POLY_EDGE_SELECTED;
    cursorCtx.fill();
    cursorCtx.shadowBlur  = 0;
    cursorCtx.strokeStyle = isSelVert ? SHAPE_PART_SELECTED_EDGE : 'rgba(255,255,255,0.5)';
    cursorCtx.lineWidth   = isSelVert ? 2 : 1.5;
    cursorCtx.stroke();
  }

  // Curve handles, for the SELECTED vertex alone. Drawn last so a handle sitting over a wall or a
  // neighbouring dot stays grabbable, and small enough to read as secondary to the corner itself.
  for (const h of selectedHandlePoints(poly)) {
    const a = toScreen(h.anchor.x, h.anchor.y);
    const c = toScreen(h.x, h.y);
    cursorCtx.globalAlpha = 1;
    cursorCtx.shadowBlur = 0;
    cursorCtx.strokeStyle = 'rgba(255,255,255,0.55)';
    cursorCtx.lineWidth = 1;
    cursorCtx.beginPath();
    cursorCtx.moveTo(a.sx, a.sy);
    cursorCtx.lineTo(c.sx, c.sy);
    cursorCtx.stroke();
    cursorCtx.beginPath();
    cursorCtx.arc(c.sx, c.sy, 4.5, 0, Math.PI * 2);
    cursorCtx.fillStyle = SHAPE_PART_SELECTED;
    cursorCtx.fill();
    cursorCtx.strokeStyle = '#ffffff';
    cursorCtx.lineWidth = 1.5;
    cursorCtx.stroke();
  }

  cursorCtx.restore();
}

// startFogTransition() takes no argument: the polygon is gone, so no mode survives to fade to.
function deletePolygonById(id) {
  if (id == null) return;
  pushUndo();
  if (placeMode === 'effects') {
    effects = effects.filter(e => e.id !== id);
    if (selectedPolygonId === id) clearShapeSelection();
    effectsChanged();
    drawCursor(null, null);
    scheduleAutoSync();   // rides the Auto/Manual gate exactly as a fog edit does
    scheduleAutoSave();
    scheduleRender();
    return;
  }
  polygons = polygons.filter(p => p.id !== id);
  if (selectedPolygonId === id) clearShapeSelection();
  rebuildFogFromPolygons();
  drawCursor(null, null);
  startFogTransition();
  rebuildFogEffect();
  fogDirty = true;
  scheduleRender();
  scheduleAutoSync();
}

function deleteSelectedPolygon() {
  deletePolygonById(selectedPolygonId);
}

// By id, because the room card's fog pill names the room it acts on. ⚠ Never refresh the whole
// card here: a rebuild steals focus from the name and description fields mid-edit.
// ⚠ Fog states belong to rooms, so this and the T-key cycle refuse in Effects mode.
function setPolygonMode(id, mode) {
  if (placeMode === 'effects') return;
  const poly = polygons.find(p => p.id === id);
  if (!poly || poly.mode === mode) return;
  pushUndo();
  poly.mode = mode;
  rebuildFogFromPolygons();
  drawCursor(null, null);
  startFogTransition(mode === 'shroud');
  rebuildFogEffect();
  fogDirty = true;
  scheduleRender();
  scheduleAutoSync();
}

function toggleSelectedPolygon() {
  if (placeMode === 'effects') return;
  const poly = polygons.find(p => p.id === selectedPolygonId);
  if (!poly) return;
  pushUndo();
  // ⚠ Three-way cycle, never a toggle: T on a half room would go to shroud with no keyboard route
  // back. Order matches the pill: reveal → shroud → half → reveal.
  poly.mode = poly.mode === 'reveal' ? 'shroud' : poly.mode === 'shroud' ? 'half' : 'reveal';
  rebuildFogFromPolygons();
  drawCursor(null, null);
  startFogTransition(poly.mode === 'shroud');
  rebuildFogEffect();
  fogDirty = true;
  scheduleRender();
  scheduleAutoSync();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pointInPolygon, pointInShape, findHoleAt, ringCentre, holeStaysOnRoom,
                     deleteShapeVertex, deleteShapeHole, distPointToSegment };
}
