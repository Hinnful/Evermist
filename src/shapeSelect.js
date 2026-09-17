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
  if (!holes.length) return pointInPolygon(px, py, verts);
  let inside = pointInPolygon(px, py, verts);
  for (const ring of holes) if (pointInPolygon(px, py, ring)) inside = !inside;
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

function findEdgeAt(poly, mapX, mapY) {
  const hitR = 10 / zoom;
  let flat = 0;
  for (const verts of polyRings(poly)) {
    for (let i = 0; i < verts.length; i++, flat++) {
      const a = verts[i], b = verts[(i + 1) % verts.length];
      if (distPointToSegment(mapX, mapY, a.x, a.y, b.x, b.y) < hitR) return flat;
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
  return pointInPolygon(c.x, c.y, poly.vertices);
}

// ─── Mouse ────────────────────────────────────────────────────────────────────
function selectMouseDown(raw) {
  const selPoly = findActiveShape();

  if (selPoly && shapeEditMode) {
    // Priority inside edit mode: vertex, then edge, then a hole's empty middle.
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
    if (findVertexAt(selPoly, pos.x, pos.y) >= 0) return 'pointer';
    if (findEdgeAt(selPoly, pos.x, pos.y) >= 0) return 'grab';
    if (findHoleAt(selPoly, pos.x, pos.y) >= 0) return 'move';
  }
  return findPolygonAt(pos.x, pos.y) ? 'move' : 'default';
}

function selectMouseMove(pos, screenX, screenY) {
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
  return isDraggingPolygon || isDraggingVertex || isDraggingEdge || isDraggingHole;
}

function selectMouseUp() {
  if (!selectDragging()) return false;
  const wrote = _dragUndoPushed;
  const reshaped = isDraggingVertex || isDraggingEdge || isDraggingHole;
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
  const pt = closestPointOnSegment(raw.x, raw.y, a.x, a.y, b.x, b.y);
  const span = Math.hypot(b.x - a.x, b.y - a.y);
  const splitT = span ? Math.hypot(pt.x - a.x, pt.y - a.y) / span : 0.5;
  if (ref.ring === 0) poly.vertices.splice(ref.i + 1, 0, pt);
  else editHoles(poly, hs => { hs[ref.ring - 1].splice(ref.i + 1, 0, pt); });
  // Both are keyed by the FLAT index, so a point added to a hole shifts every one after it.
  if (poly.cornerRadii) editCornerRadii(poly, r => r.splice(ei + 1, 0, null));
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
  buildRoundedPolyPath(cursorCtx, sv, cr, pvR, svHoles);
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
