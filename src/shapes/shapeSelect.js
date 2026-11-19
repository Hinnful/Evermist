'use strict';

// ⚠ THE TWO LEVELS ARE NEVER ON SCREEN TOGETHER - doors, labels and the room card already ride the
// map, and a vertex set under a bounding box buries both. The selection lives in state.js, read by
// a dozen modules; docs/ARCHITECTURE.md has the shape of the levels.

// ─── Drag state ───────────────────────────────────────────────────────────────
// Transient, private to a gesture, so it stays out of state.js.
let isDraggingPolygon = false;
let dragStartMapX = 0, dragStartMapY = 0;
let dragOrigVerts = null;   // snapshot of every ring at drag start
let isDraggingHole = false;
let holeDragOrigRing = null;
let holeDragStartMapX = 0, holeDragStartMapY = 0;
// ⚠ A hole whose centre ALREADY sits off its room fails the stop test on every frame, so without
// this it could never be dragged home. Read once at mousedown; that drag runs free.
let holeDragWasStuck = false;

// Alt+drag moves a copy. It is made on the first movement, so an Alt+click leaves nothing behind; a room copy is placed on the drop.
// A still click, then another on its spot, picks the next larger room there (roomAfter).
let copyOnDrag = false, dragCopyId = null, lastClickAt = null, cycleOnUp = false;
// With several picked, a drag moves every one: each extra's rings at the press. A press that never moves
// narrows the pick to the shape it landed on (dragPickId), as Figma does.
let dragOrigExtras = null, dragPickId = null;

// ⚠ PUSHED ON THE FIRST MOVEMENT, never on mousedown: selecting moves nothing, so a push there
// spends a Ctrl+Z and a fog-canvas clone per selection. ⚠ ALSO THE "DID THIS DRAG WRITE ANYTHING"
// flag on release - committing a press that only PICKED rebuilds the fog and re-sends the scene.
let _dragUndoPushed = false;
function armDragUndo()  { _dragUndoPushed = false; }
function pushDragUndo() { if (!_dragUndoPushed) { _dragUndoPushed = true; pushUndo(); } }

// ⚠ EVERY DROP CLEARS THE LEVEL BELOW, or a stale index outlives its drawing.
// Edit is one shape's alone, so opening it drops the extra picks.
function enterShapeEditMode(id) {
  extraPickedIds = []; pickSetReset();
  selectedPolygonId = id;
  shapeEditMode = true;
  selectedVertexIndex = -1;
  selectedHoleIndex = -1;
  holeEditMode = false;
}

function leaveShapeEditMode() {
  shapeEditMode = false;
  selectedVertexIndex = -1;
  selectedHoleIndex = -1;
  holeEditMode = false;
}

function clearShapeSelection() {
  selectedPolygonId = null; notesLevelPick = null; extraPickedIds = []; pickSetReset();
  leaveShapeEditMode();
}

// The extra picks that still resolve in the list in hand. None on the Campaign or in a column.
function pickedExtras() {
  if (!extraPickedIds.length || selectedPolygonId == null || worldMapOpen || isPane) return [];
  const list = activeShapeList();
  return extraPickedIds.map(id => id !== selectedPolygonId && list.find(s => s.id === id)).filter(Boolean);
}

function pickedIds() {
  return selectedPolygonId == null ? [] : [selectedPolygonId, ...pickedExtras().map(s => s.id)];
}

// Picked shapes are all gold, so the first extra closes the main's edit; this says whether it was open,
// and the main gets it back when the extras go (dropPickedExtras).
let editBeforeExtras = false;

// ⚠ EVERY CHANGE OF THE PICK SET BUT A SHIFT+CLICK FORGETS BOTH FLAGS, or a later click reopens an edit or the
// several-picked row that belonged to a pick long gone.
function pickSetReset() { editBeforeExtras = false; editRowForgetPicks(); }

// Shift+click on another shape: in the pick or out of it. The edit row shows while several are picked.
function togglePickedExtra(id) {
  const ids = pickedExtras().map(s => s.id);
  if (!ids.length) { editBeforeExtras = shapeEditMode; leaveShapeEditMode(); }
  const next = ids.indexOf(id) >= 0 ? ids.filter(x => x !== id) : ids.concat(id);
  if (next.length) { extraPickedIds = next; editRowShowPicks(); } else dropPickedExtras();
  drawCursor(lastScreenX, lastScreenY);
  scheduleRender();
}

// The main alone again, in the edit it had before the first extra.
function dropPickedExtras() {
  const had = extraPickedIds.length > 0;
  extraPickedIds = [];
  if (had && editBeforeExtras && selectedPolygonId != null) enterShapeEditMode(selectedPolygonId);
  editBeforeExtras = false;
}

function findPolygonAt(mapX, mapY) {
  const list = activeShapeList();
  if (worldMapOpen) return worldShapeAt(list, mapX, mapY);   // the Campaign picks the smallest group
  if (placeMode === 'rooms') return roomsAt(list, mapX, mapY)[0] || null;
  for (let i = list.length - 1; i >= 0; i--) {
    if (pointInShape(mapX, mapY, list[i])) return list[i];
  }
  return null;
}

// ⚠ ONE LEVEL ANSWERS AT A TIME, or the map offers a grab it draws nothing for. A BOXED hole
// answers through its box alone, so no ring does; a hole OPENED for editing answers on its own
// ring, so its room's corners and walls stop.
function ringIsLive(r) {
  if (!shapeEditMode || selectedHoleIndex < 0) return true;
  return holeEditMode && r === selectedHoleIndex + 1;
}

function findVertexAt(poly, mapX, mapY) {
  const hitR = Math.min(10 / zoom, 30); // clamp: the grab shrinks when zoomed far out
  let flat = 0;
  const rings = polyRings(poly);
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    for (let i = 0; i < ring.length; i++, flat++) {
      if (!ringIsLive(r)) continue;
      if (Math.hypot(mapX - ring[i].x, mapY - ring[i].y) < hitR) return flat;
    }
  }
  return -1;
}

function findEdgeAt(poly, mapX, mapY) {
  const hitR = 10 / zoom;
  let flat = 0;
  const rings = polyRings(poly);
  for (let r = 0; r < rings.length; r++) {
    const verts = rings[r];
    for (let i = 0; i < verts.length; i++, flat++) {
      if (!ringIsLive(r)) continue;
      if (distToEdge(poly, verts, i, flat, mapX, mapY) < hitR) return flat;
    }
  }
  return -1;
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

// Several picked with edit closed show no box and no circles for the main alone, so none answers.
function boxedShape() {
  const p = findActiveShape();
  return p && (shapeEditMode || !pickedExtras().length) ? p : null;
}

function selectMouseDown(raw, e) {
  const selPoly = findActiveShape(), boxed = boxedShape();
  copyOnDrag = false;

  // ⚠ FIRST, because a box handle sits OUTSIDE the shape and every test below starts from a hit
  // on the shape itself.
  if (boxed && !boxed.open) {
    const bh = findBoxHandleAt(boxed, raw.x, raw.y);
    if (bh) { startBoxDrag(boxed, bh, raw); return; }
  }
  if (cornerRoundDown(boxed, raw, e)) return;

  if (selPoly && shapeEditMode) {
    // A curve handle, vertex or wall first (shapeEdit.js), then a hole's middle.
    if (editMouseDown(selPoly, raw, e)) return;
    const hi = holeEditMode ? -1 : findHoleAt(selPoly, raw.x, raw.y);
    if (hi >= 0) {
      armDragUndo();
      selectedHoleIndex = hi;
      selectedVertexIndex = -1;
      isDraggingHole = true;
      copyOnDrag = !!(e && e.altKey);
      holeDragStartMapX = raw.x;
      holeDragStartMapY = raw.y;
      holeDragOrigRing = polyHoleRings(selPoly)[hi].map(v => ({ x: v.x, y: v.y }));
      holeDragWasStuck = !holeStaysOnRoom(selPoly, holeDragOrigRing);
      return;
    }
  }

  const shiftPick = !!(e && e.shiftKey) && !worldMapOpen && !isPane && selectedPolygonId != null;
  // With several picked a still click narrows the pick (selectMouseUp) and never cycles.
  const sel = !shiftPick && !shapeEditMode && !pickedExtras().length && lastClickAt && Math.hypot(raw.x - lastClickAt.x, raw.y - lastClickAt.y) * zoom < 4 ? findActiveShape() : null;
  cycleOnUp = placeMode === 'rooms' && !worldMapOpen && !!sel && pointInShape(raw.x, raw.y, sel);
  const hit = cycleOnUp ? sel : findPolygonAt(raw.x, raw.y);
  if (hit && shiftPick && hit.id !== selectedPolygonId) { togglePickedExtra(hit.id); return; }
  // Ctrl+click opens a shape's corners in one press, as Figma's Cmd+click reaches past a group.
  // Inside the open shape Ctrl keeps its own job, bending and straightening a wall.
  if (hit && e && (e.ctrlKey || e.metaKey) && !(shapeEditMode && hit.id === selectedPolygonId)) {
    enterShapeEditMode(hit.id);
    drawCursor(lastScreenX, lastScreenY);
    scheduleRender();
    return;
  }
  if (hit) {
    const extras = pickedExtras();
    const inPick = hit.id === selectedPolygonId || extras.indexOf(hit) >= 0;
    if (!inPick) { selectedPolygonId = hit.id; extraPickedIds = []; pickSetReset(); leaveShapeEditMode(); }
    else if (shapeEditMode) { selectedVertexIndex = -1; selectedHoleIndex = -1; }
    const many = inPick && extras.length > 0;
    const copyRings = s => polyRings(s).map(r => r.map(v => ({ x: v.x, y: v.y })));
    armDragUndo();
    isDraggingPolygon = true;
    copyOnDrag = !!(e && e.altKey) && !many;
    dragStartMapX = raw.x;
    dragStartMapY = raw.y;
    dragOrigVerts = copyRings(findActiveShape());
    dragOrigExtras = many ? extras.map(s => ({ s, rings: copyRings(s) })) : null;
    dragPickId = many ? hit.id : null;
  } else {
    clearShapeSelection();
  }
}

// True when a press at pos lands on the open shape's own handles: a curve handle, corner, wall or corner circle.
function selectHandleHit(pos) {
  const selPoly = findActiveShape();
  if (!selPoly) return false;
  if (boxedShape() && _cornerHitAt(selPoly, pos)) return true;
  return shapeEditMode && (!!findHandleAt(selPoly, pos.x, pos.y) || findVertexAt(selPoly, pos.x, pos.y) >= 0 ||
    findEdgeAt(selPoly, pos.x, pos.y) >= 0);
}

function selectHoverCursor(pos, e) {
  const selPoly = findActiveShape(), boxed = boxedShape();
  const cc = cornerRoundHover(boxed, pos, e);
  if (boxed && !boxed.open) {
    const bc = boxHoverCursor(boxed, pos);
    if (bc) return bc;
  }
  if (cc) return cc;
  if (selPoly && shapeEditMode) {
    if (findHandleAt(selPoly, pos.x, pos.y)) return 'pointer';
    if (findVertexAt(selPoly, pos.x, pos.y) >= 0) return 'pointer';
    if (findEdgeAt(selPoly, pos.x, pos.y) >= 0) return 'grab';
    if (!holeEditMode && findHoleAt(selPoly, pos.x, pos.y) >= 0) return 'move';
  }
  return findPolygonAt(pos.x, pos.y) ? 'move' : 'arrow';
}

function selectMouseMove(pos, screenX, screenY, e) {
  if (cornerRoundMove(findActiveShape(), pos)) return true;
  if (boxDragging() && selectedPolygonId != null) {
    const poly = findActiveShape();
    if (poly) {
      boxDragMove(poly, pos, !!(e && e.shiftKey));
      drawCursor(screenX, screenY);
    }
    return true;
  }

  if (editMouseMove(pos, screenX, screenY, e)) return true;

  if (isDraggingHole && selectedPolygonId != null) {
    const poly = findActiveShape();
    if (poly && holeDragOrigRing) {
      const dx = pos.x - holeDragStartMapX;
      const dy = pos.y - holeDragStartMapY;
      const moved = holeDragOrigRing.map(v => ({ x: v.x + dx, y: v.y + dy }));
      // A refused frame writes nothing: the hole holds its last good spot and resumes.
      if (holeDragWasStuck || holeStaysOnRoom(poly, moved)) {
        pushDragUndo();
        if (copyOnDrag) { copyOnDrag = false; dragCopyOfSelection(); }
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
    let poly = findActiveShape();
    if (poly && dragOrigVerts) {
      pushDragUndo();
      if (copyOnDrag) { copyOnDrag = false; dragCopyOfSelection(); poly = findActiveShape(); dragCopyId = poly && poly.id; }
      const shift = rings => rings.map(r => r.map(v => ({ x: v.x + dx, y: v.y + dy })));
      const moved = shift(dragOrigVerts);
      poly.vertices = moved[0];
      setShapeHoles(poly, moved.slice(1));
      for (const o of dragOrigExtras || []) { const m = shift(o.rings); o.s.vertices = m[0]; setShapeHoles(o.s, m.slice(1)); }
      shapeGeometryChanged();
      fogDirty = true;
      scheduleRender();
    }
    return true;
  }

  return false;
}

// What an Alt+press would grab on the map. Anything else, Alt+drag pans as it always has.
function selectGrabsAt(raw) {
  if (findPolygonAt(raw.x, raw.y)) return true;
  const selPoly = findActiveShape();
  return !!selPoly && shapeEditMode && !holeEditMode && findHoleAt(selPoly, raw.x, raw.y) >= 0;
}

function selectDragging() {
  return isDraggingPolygon || isDraggingHole || editDragging() || boxDragging() || cornerRoundDragging();
}

function selectMouseUp() {
  if (cornerRoundUp()) return true;
  if (!selectDragging()) return false;
  scheduleRender();   // brings back the room switcher the press hid; a click with no drag schedules nothing else
  if (boxDragging()) {
    endBoxDrag();
    if (_dragUndoPushed) commitShapeDrag();
    drawCursor(lastScreenX, lastScreenY);   // re-place the card against the new shape
    return true;
  }
  const editLive = endEditDrag();
  const wrote = _dragUndoPushed, clicked = isDraggingPolygon && !wrote;
  const reshaped = editLive || isDraggingHole;
  isDraggingHole = isDraggingPolygon = false;
  copyOnDrag = false;
  const copyId = dragCopyId; dragCopyId = null;
  holeDragOrigRing = null;
  dragOrigVerts = dragOrigExtras = null;
  if (wrote) commitShapeDrag(copyId);
  const narrowTo = clicked ? dragPickId : null; dragPickId = null;
  if (narrowTo != null) {
    selectedPolygonId = narrowTo; leaveShapeEditMode(); extraPickedIds = []; pickSetReset();
    drawCursor(lastScreenX, lastScreenY);
  }
  const next = clicked && cycleOnUp && narrowTo == null ? roomAfter(polygons, dragStartMapX, dragStartMapY, selectedPolygonId) : null;
  if (next && next.id !== selectedPolygonId) { selectedPolygonId = next.id; leaveShapeEditMode(); drawCursor(lastScreenX, lastScreenY); }
  lastClickAt = clicked ? { x: dragStartMapX, y: dragStartMapY } : null;
  if (reshaped) drawCursor(lastScreenX, lastScreenY);   // re-place the card against the new shape
  return true;
}

// A double-click is the way IN to edit mode, and once inside it is the way a wall gains a vertex.
function selectDblClick(raw) {
  if (cornerRoundDblClick(findActiveShape(), raw)) return;
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
  // A boxed hole opens the same way its room did: one more double-click, one level down.
  if (selectedHoleIndex >= 0 && !holeEditMode &&
      findHoleAt(poly, raw.x, raw.y) === selectedHoleIndex) {
    holeEditMode = true;
    selectedVertexIndex = -1;
    drawCursor(lastScreenX, lastScreenY);
    scheduleRender();
    return;
  }
  if (findVertexAt(poly, raw.x, raw.y) >= 0) return; // don't insert on existing vertex
  addCornerAt(poly, raw);
}

// Escape climbs one level per press: the part, edit mode, then the shape.
function escapeShapeSelection() {
  if (selectedPolygonId == null) return false;
  if (holeEditMode && selectedVertexIndex >= 0) {
    selectedVertexIndex = -1;
    drawCursor(lastScreenX, lastScreenY);
    return true;
  }
  if (holeEditMode) {
    holeEditMode = false;
    drawCursor(lastScreenX, lastScreenY);
    scheduleRender();
    return true;
  }
  if (shapeEditMode && (selectedVertexIndex >= 0 || selectedHoleIndex >= 0)) {
    selectedVertexIndex = -1;
    selectedHoleIndex = -1;
    drawCursor(lastScreenX, lastScreenY);
    return true;
  }
  if (pickedExtras().length && editRowOpen()) { editRowClose(); return true; }
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
// bounding box will need. drawCorner/drawHoleHatch live in shapeMarkers.js, read by this file,
// shapeBox.js and toolPreview.js alike.
// `extra`: one of several picked, outlined as held but never opened.
function drawPolyOutline(poly, isSelected, selectedVertIdx, dimmed, extra) {
  const verts = poly.vertices;
  if (verts.length < 2) return;
  // A material draws its own area, so it carries no chrome until picked: a wash or an edge over it
  // would make the DM's fire or acid a different colour from the TV's.
  const held = isSelected || !!extra;
  if (poly.material && !held) return;
  if (poly.open) { drawOpenLineChrome(poly, isSelected, selectedVertIdx); return; }
  const holeRings = polyHoleRings(poly);
  const editing = isSelected && shapeEditMode;
  const holeSel = editing && selectedHoleIndex >= 0 && selectedHoleIndex < holeRings.length
                ? selectedHoleIndex : -1;

  // The wash is always the fog state's own colour; once held, a room's edge and line go gold and an effect's or
  // light's take its own colour. `material` tells an effect from a room and never reads as a fourth fog state.
  const isEffect = !!poly.material || !!poly.light;
  const baseRgb = poly.light ? LIGHT_OUTLINE_RGB : isEffect ? EFFECT_RGB : (POLY_STATE_RGB[poly.mode] || POLY_STATE_RGB.shroud);
  const look = isEffect ? EFFECT_LOOK : (POLY_LOOK[poly.mode] || POLY_LOOK.shroud);
  let fillA = poly.material ? 0 : look.fillA;
  let lineRgb = baseRgb, lineA = look.lineA, lineW = look.lineW;
  let softRgb = baseRgb, softA = look.edgeA, softW = look.edgeW;
  if (dimmed) { fillA *= POLY_LOOK_DIM.fillMul; lineA = POLY_LOOK_DIM.lineA; softA = 0; }
  if (held) {
    lineRgb = softRgb = poly.light ? LIGHT_OUTLINE_RGB : poly.material ? effectEdgeRgb(poly.material) : HELD_RGB;
    lineA = 1; lineW = HELD_LOOK.lineW;
    softA = HELD_LOOK.edgeA; softW = HELD_LOOK.edgeW;
    if (isSelected && pickedExtras().length) lineW = HELD_LOOK.mainLineW;   // the first pick, thicker
  }
  // Editing goes one step further than held: Figma's own signal for "you are inside this one
  // now" is the outline turning white, so editing takes the line past held rather than beside it.
  if (editing) lineRgb = softRgb = EDIT_RGB;
  // A picked hole takes the outline down, so its own ring and hatch are what Delete visibly
  // points at, not the room the hole sits inside.
  if (holeSel >= 0) { fillA *= 0.5; lineA *= 0.5; softA *= 0.5; }

  // Screen space, in flat index order: the outer ring, then each hole.
  const toSv = ring => ring.map(v => { const s = toScreen(v.x, v.y); return { x: s.sx, y: s.sy }; });
  const sv = toSv(verts);
  const svHoles = holeRings.map(toSv);
  const svAll = svHoles.length ? sv.concat(...svHoles) : sv;
  const cr = (poly.cornerRadius || 0) * zoom;
  const pvR = poly.cornerRadii ? poly.cornerRadii.map(rv => (rv != null ? rv : (poly.cornerRadius || 0)) * zoom) : null;
  const hs = scaleHandles(poly.handles, zoom);
  const tracePath = () => buildRoundedPolyPath(cursorCtx, sv, cr, pvR, svHoles, hs);

  cursorCtx.save();

  // The wash: an evenodd fill, so every hole is cut from it and reads only as a gap.
  if (fillA > 0) {
    cursorCtx.beginPath();
    tracePath();
    cursorCtx.fillStyle = `rgba(${baseRgb},${fillA})`;
    cursorCtx.fill('evenodd');
  }

  // The soft inner edge: a blurred stroke, clipped to the same evenodd path so the blur can only
  // ever fall inside the room, never bleed onto the map or into a hole.
  if (softA > 0) {
    cursorCtx.save();
    cursorCtx.beginPath();
    tracePath();
    cursorCtx.clip('evenodd');
    cursorCtx.filter = 'blur(1.5px)';
    cursorCtx.strokeStyle = `rgba(${softRgb},${softA})`;
    cursorCtx.lineWidth = softW;
    // clip() left the traced path live - stroking it here spends no second walk of the geometry.
    cursorCtx.stroke();
    cursorCtx.restore();
  }

  // The crisp line. Never dashed: a dash means "not committed yet", and a saved room always is.
  cursorCtx.beginPath();
  tracePath();
  cursorCtx.strokeStyle = `rgba(${lineRgb},${lineA})`;
  cursorCtx.lineWidth = lineW;
  cursorCtx.stroke();

  if (dimmed) { cursorCtx.restore(); return; }

  // The picked hole: a hatch fills the gap and its ring goes blue, so Delete's target is unmissable.
  if (holeSel >= 0) {
    const ring = svHoles[holeSel];
    drawHoleHatch(ring);
    cursorCtx.beginPath();
    cursorCtx.moveTo(ring[0].x, ring[0].y);
    for (let i = 1; i < ring.length; i++) cursorCtx.lineTo(ring[i].x, ring[i].y);
    cursorCtx.closePath();
    cursorCtx.strokeStyle = `rgba(${SHAPE_PART_SELECTED_RGB},1)`;
    cursorCtx.lineWidth = 1.5;
    cursorCtx.stroke();
  }

  // A boxed hole shows NO corners at all: shapeBox.js has the box, and the two never share the
  // map. Its ring, drawn just above, is what says which hole is picked.
  if (!editing || (holeSel >= 0 && !holeEditMode)) { cursorCtx.restore(); return; }

  // The hole's own level narrows the corners to its ring, so the room's own stop competing.
  let dotFrom = 0, dotTo = svAll.length;
  if (holeEditMode && holeSel >= 0) {
    dotFrom = verts.length;
    for (let k = 0; k < holeSel; k++) dotFrom += holeRings[k].length;
    dotTo = dotFrom + holeRings[holeSel].length;
  }

  // Corners — at the real vertex, not the fillet, on every live ring. Edit mode is where a
  // corner goes round; the ring on top of that is what says THIS one is picked.
  for (let i = dotFrom; i < dotTo; i++) {
    const { x, y } = svAll[i];
    const isSelVert = i === selectedVertIdx;
    drawCorner(x, y, true, isSelVert, isSelVert ? SHAPE_PART_SELECTED : '#ffffff');
  }

  drawHandleMarkers(poly);
  cursorCtx.restore();
}

function deletePolygonById(id) { deleteShapesById([id]); }

// Every id in one undo step. startFogTransition() takes no argument: no mode survives to fade to.
function deleteShapesById(ids) {
  const id = ids[0];
  if (id == null || worldMapOpen) { if (id != null) worldPlaceUngroup(id); return; }   // a place goes by the world map's delete
  const gone = new Set(ids);
  pushUndo();
  if (placeMode !== 'rooms') {
    setShapeListNamed(placeMode, activeShapeList().filter(e => !gone.has(e.id)));
    if (gone.has(selectedPolygonId)) clearShapeSelection();
    shapeListChanged(placeMode);
    drawCursor(null, null);
    scheduleAutoSync();   // rides the Auto/Manual gate exactly as a fog edit does
    scheduleAutoSave();
    scheduleRender();
    return;
  }
  polygons = polygons.filter(p => !gone.has(p.id));
  if (gone.has(selectedPolygonId)) clearShapeSelection();
  rebuildFogFromPolygons();
  drawCursor(null, null);
  startFogTransition();
  rebuildFogEffect();
  fogDirty = true;
  scheduleRender();
  scheduleAutoSync();
}

function deleteSelectedPolygon() { deleteShapesById(pickedIds()); }

// By id, because the room card's fog pill names the room it acts on. ⚠ Never refresh the whole
// card here: a rebuild steals focus from the name and description fields mid-edit.
// ⚠ Fog states belong to rooms, so this and the T-key cycle refuse in Effects mode.
function setPolygonMode(id, mode) { setPolygonsMode([id], mode); }

// Several picked rooms take one fog in one undo step.
function setPolygonsMode(ids, mode) {
  if (placeMode !== 'rooms') return;
  const change = polygons.filter(p => ids.indexOf(p.id) >= 0 && p.mode !== mode);
  if (!change.length) return;
  pushUndo();
  for (const p of change) p.mode = mode;
  rebuildFogFromPolygons();
  drawCursor(null, null);
  startFogTransition(mode === 'shroud');
  rebuildFogEffect();
  fogDirty = true;
  scheduleRender();
  scheduleAutoSync(true);
}

// Every picked room takes the main's next fog, in one undo step.
function toggleSelectedPolygon() {
  if (placeMode !== 'rooms') return;
  const poly = polygons.find(p => p.id === selectedPolygonId);
  if (!poly) return;
  // ⚠ Three-way cycle, never a toggle: T on a half room would go to shroud with no keyboard route
  // back. Order matches the pill: reveal → shroud → half → reveal.
  setPolygonsMode(pickedIds(), poly.mode === 'reveal' ? 'shroud' : poly.mode === 'shroud' ? 'half' : 'reveal');
}
