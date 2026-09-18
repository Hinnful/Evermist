'use strict';
// shapeCommit.js — what a drawn shape becomes: a room, an effect, or a repair of one that is
// already there. Join, Trim and Cut all land here, and so does every refusal.

// A ROOM AND AN EFFECT ARE THE SAME OBJECT, carrying a fog `mode` or a `material`. Two arrays
// only because polygons order IS fog compositing precedence. The placement mode picks the array,
// and setPlaceMode() clears the selection, so an id here always resolves in one list.
function activeShapeList() { return placeMode === 'effects' ? effects : polygons; }

function findActiveShape() {
  return selectedPolygonId == null ? null
       : activeShapeList().find(s => s.id === selectedPolygonId) || null;
}

// Live feedback mid-drag. A room's geometry IS the fog stencil, so it rebuilds; an effect only
// has to tell its own render path, and must never touch the fog.
function shapeGeometryChanged() {
  if (placeMode === 'effects') { effectsChanged(); return; }
  rebuildFogFromPolygons();
}

// THE ONE RELEASE PATH for a room or effect drag. It does NOT stop a running crossfade:
// startFogTransition() leaves the live fade going and rebuildFogEffect() re-targets it.
function commitShapeDrag() {
  if (placeMode === 'effects') {
    effectsChanged();
    scheduleAutoSync();   // rides the Auto/Manual gate exactly as a fog reveal does
    scheduleAutoSave();
    scheduleRender();
    return;
  }
  startFogTransition(findActiveShape()?.mode === 'shroud');
  rebuildFogEffect();
  fogDirty = true;
  scheduleRender();
  scheduleAutoSync();
}

// After an edit that changed geometry but NOT a fog mode. No crossfade: there is no mode to fade
// towards, and one would make a corner edit flash the whole map.
function persistShapeEdit() {
  if (placeMode === 'effects') {
    scheduleAutoSync();   // rides the Auto/Manual gate exactly as a fog reveal does
    scheduleAutoSave();
    return;
  }
  rebuildFogEffect();
  scheduleAutoSync();
}

// A freshly drawn rectangle, circle or polygon, landed in whichever list the mode names. One set
// of editing paths serves both: the records differ only in a fog `mode` against a `material`.
function commitDrawnShape(verts) {
  let shape;
  if (placeMode === 'effects') {
    shape = addEffect(verts);
  } else {
    pushUndo();
    fogModifiedThisStroke = true;
    const pid = nextPolygonId++;
    shape = { id: pid, vertices: verts, mode: tool, cornerRadius: 0, name: 'Room ' + pid };
    polygons.push(shape);
  }
  // Deliberately NOT selected: drawing leaves the card closed so it cannot cover the map, and
  // naming is a second pass with the Select tool.
  clearShapeSelection();
  return shape;
}

// Geometry is roomOps.js; all three land here so one set of rules covers ids, order, undo and fog.

// ⚠ THE KERNEL'S REFUSALS NAME A ROOM and the same gesture repairs an effect, so the noun is
// swapped here; roomOps.js stays pure and a new reason naming a room inherits it for free.
function refuseShapeOp(reason) {
  const msg = placeMode === 'effects' ? reason.split('room').join('effect') : reason;
  messageDialog({ title: 'Nothing changed', message: msg });
  return false;
}

// A piece with no shape of its own: the parent's fields, a fresh id, a plain name, no notes.
function newShapeFromPiece(base, piece) {
  const id = placeMode === 'effects' ? nextEffectId++ : nextPolygonId++;
  const s = { ...base, id };
  s.name = (base.material ? base.material.charAt(0).toUpperCase() + base.material.slice(1)
                          : 'Room') + ' ' + id;
  applyPieceToShape(s, piece);
  delete s.desc;
  return s;
}

// ⚠ ABSENT, never empty: a record with no hole stays byte-for-byte today's record.
function setShapeHoles(shape, holes) {
  if (holes && holes.length) shape.holes = holes;
  else delete shape.holes;
}

// One plan entry: a group of shapes and the pieces replacing them.
// ⚠ ARRAY ORDER IS FOG COMPOSITING PRECEDENCE, so a group's first piece takes the slot its
// earliest member already holds; only a second piece is appended. `mode` is handed in because a
// join takes the most hidden of its contributors, not the earliest one's.
function applyShapePlan(plan, mode) {
  const drop = new Set();
  const extras = [];
  let lostDoors = 0;
  for (const g of plan) {
    const base = g.shapes[0];
    for (let i = 1; i < g.shapes.length; i++) drop.add(g.shapes[i].id);
    if (!g.pieces.length) { drop.add(base.id); continue; }
    // Curves, corner radii and doors are CARRIED, not dropped: shapeDetail.js matches the
    // library's answer back onto the walls it came from, and counts the doors left with no wall.
    const kept = restoreGroupDetail(g.shapes, g.pieces);
    lostDoors += kept.droppedDoors;
    const parts = kept.pieces.length ? kept.pieces : g.pieces.map(p => ({ vertices: p.verts, holes: p.holes }));
    applyPieceToShape(base, parts[0]);
    if (mode) base.mode = mode;
    for (let i = 1; i < parts.length; i++) extras.push(newShapeFromPiece(base, parts[i]));
  }
  const kept = activeShapeList().filter(s => !drop.has(s.id)).concat(extras);
  if (placeMode === 'effects') effects = kept; else polygons = kept;
  if (drop.has(selectedPolygonId)) clearShapeSelection();
  if (lostDoors) reportLostDoors(lostDoors);
}

// A door on a wall the repair removed has nothing left to sit on. Reported because the DM placed
// it by hand and cannot see it go, unlike a corner radius whose corner visibly went with the cut.
function reportLostDoors(n) {
  noticeToast(n === 1 ? 'One door was removed with the wall it was on.'
                      : n + ' doors were removed with the walls they were on.');
}

// ⚠ EVERY PER-VERTEX FIELD IS REPLACED OR DELETED, never left behind: one array still holding
// the old outline's length puts every curve and every door on the wrong wall.
function applyPieceToShape(shape, piece) {
  shape.vertices = piece.vertices;
  setShapeHoles(shape, piece.holes);
  if (piece.cornerRadii) shape.cornerRadii = piece.cornerRadii; else delete shape.cornerRadii;
  if (piece.handles)     shape.handles     = piece.handles;     else delete shape.handles;
  if (piece.doors)       shape.doors       = piece.doors;       else delete shape.doors;
}

// ⚠ THE CROSSFADE DIRECTION IS PASSED IN, never read off findActiveShape() the way
// commitShapeDrag() does: every drawing path nulls the selection first, so that read always
// answers "reveal" and a Trim adding shroud fades at the wrong speed. null asks for no crossfade,
// which a Cut wants: its pieces paint exactly the fog their parent did.
function commitShapeOpFog(toShroud) {
  if (placeMode === 'effects') {
    effectsChanged();
    scheduleAutoSync();
    scheduleAutoSave();
    scheduleRender();
    return;
  }
  rebuildFogFromPolygons();
  if (toShroud !== null) startFogTransition(toShroud);
  rebuildFogEffect();
  fogDirty = true;
  scheduleRender();
  scheduleAutoSync();
}

// The drawn shape combines with every shape it lands on, and makes none of its own.
function commitShapeOp(verts) {
  const hits = activeShapeList().filter(s => s.vertices && s.vertices.length >= 3 &&
                                             shapesOverlap(s, verts));
  if (!hits.length) return false;
  const minArea = roomOpMinArea(gridSize);
  const rooms = placeMode !== 'effects';
  let plan, mode = null, toShroud;

  if (shapeOp === 'join') {
    const out = joinShapes(hits, verts, minArea);
    if (out.reason) return refuseShapeOp(out.reason);
    plan = [{ shapes: hits, pieces: out.pieces }];
    if (rooms) mode = mostHiddenMode(hits.map(s => s.mode));
    toShroud = mode === 'shroud';
  } else {
    const out = trimShapes(hits, verts, minArea);
    if (out.reason) return refuseShapeOp(out.reason);
    plan = hits.map((s, i) => ({ shapes: [s], pieces: out.groups[i] }));
    // Shrinking a shroud room hands ground back; shrinking any other adds fog.
    toShroud = hits.some(s => s.mode !== 'shroud');
  }

  pushUndo();
  applyShapePlan(plan, mode);
  commitShapeOpFog(toShroud);
  return true;
}

// THE ONE PLACE A FINISHED CLOSED SHAPE GOES. `new` makes a record; Join and Trim make none and
// stay armed for the next shape.
// ⚠ RETURNS NULL FOR EVERY MODE BUT 'new', a refusal included, so no caller may reach into it.
function commitClosedShape(verts) {
  if (shapeOp === 'new') return commitDrawnShape(verts);
  clearShapeSelection();
  commitShapeOp(verts);
  return null;
}
