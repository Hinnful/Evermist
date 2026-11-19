'use strict';
// shapeCommit.js — what a drawn shape becomes: a room, an effect, or a repair of one that is
// already there. Join, Trim and Cut all land here, and so does every refusal.

// A ROOM, AN EFFECT AND A LIGHT ARE THE SAME OBJECT, carrying a fog `mode`, a `material` or a
// `light` flag. Separate arrays because polygons order IS fog compositing precedence. The
// placement mode picks the list, and setPlaceMode() clears the selection, so an id here always
// resolves in one list. Only a room's change touches the fog. Effects mode holds two arrays as one
// list, the lights under the fires so a click lands on a fire first, and a lit area is often large:
// ids come from one counter, and a write routes each shape home by its `light` flag. ⚠ THE EFFECTS LIST IS A NEW ARRAY EACH CALL, so a write goes through
// setShapeListNamed or pushShapeTo, never into what shapeListNamed returned.
function shapeListNamed(name) { return name === 'effects' ? lightShapes.concat(effects) : polygons; }
function activeShapeList() { return worldMapOpen ? worldPlaceRecords().concat(worldRoadRecords()) : shapeListNamed(placeMode); }
function setShapeListNamed(name, list) {
  if (name === 'effects') { effects = list.filter(s => !s.light); lightShapes = list.filter(s => s.light); } else polygons = list;
}
// A room is placed by what it contains (layerInsertIndex); an Alt-drag copy appends, and is placed on its drop.
function appendShapeTo(name, shape) {
  if (name === 'effects') (shape.light ? lightShapes : effects).push(shape); else polygons.push(shape);
}
function pushShapeTo(name, shape) {
  if (name === 'effects') appendShapeTo(name, shape); else polygons.splice(layerInsertIndex(polygons, shape, gridSize), 0, shape);
}
function takeShapeId(name) { return name === 'effects' ? nextEffectId++ : nextPolygonId++; }
function shapeListChanged(name) { if (name === 'effects') { effectsChanged(); lightsChanged(); } }

function findActiveShape() {
  return selectedPolygonId == null ? null
       : activeShapeList().find(s => s.id === selectedPolygonId) || null;
}

// ⚠ WHILE THE WORLD MAP IS UP the three below act on its places, never on the room or the fog.
// Live feedback mid-drag. A room's geometry IS the fog stencil, so it rebuilds; an effect only
// has to tell its own render path, and must never touch the fog.
function shapeGeometryChanged() {
  if (worldMapOpen) { worldMapDrawOverlay(); return; }
  if (placeMode !== 'rooms') { shapeListChanged(placeMode); return; }
  rebuildFogFromPolygons();
}

// THE ONE RELEASE PATH for a room or effect drag. It does NOT stop a running crossfade:
// startFogTransition() leaves the live fade going and rebuildFogEffect() re-targets it.
function commitShapeDrag(copyId) {
  if (worldMapOpen) { worldPlaceCommit(); return; }
  const copy = placeMode === 'rooms' && copyId != null && polygons.find(p => p.id === copyId);
  if (copy) {
    const room = piecesOf(polygons, copy);
    polygons = polygons.filter(p => !room.includes(p));
    for (const p of room) polygons.splice(layerInsertIndex(polygons, p, gridSize), 0, p);
    rebuildFogFromPolygons();
  }
  if (placeMode !== 'rooms') {
    shapeListChanged(placeMode);
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
  if (worldMapOpen) { worldPlaceCommit(); return; }
  if (placeMode !== 'rooms') {
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
    shape = currentMaterial === 'light' ? addLightShape(verts) : addEffect(verts);
  } else {
    pushUndo();
    fogModifiedThisStroke = true;
    const touches = polygons.some(s => s.vertices && s.vertices.length >= 3 && shapesOverlap(s, verts));
    const pid = nextPolygonId++;
    shape = { id: pid, vertices: verts, mode: tool, cornerRadius: 0, name: t('Room {n}', { n: pid }) };
    polygons.splice(layerInsertIndex(polygons, verts, gridSize), 0, shape);
    hintsRoomsDone();
    hintsRoomDrawn(shape, touches);
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
  const msg = placeMode === 'rooms' ? reason : reason.split('room').join(currentMaterial === 'light' ? 'light' : 'effect');
  messageDialog({ title: 'Nothing changed', message: msg });
  return false;
}

// A record's plain name: a room's "Room N", an effect's from its material's label, as addEffect names one; a light has none.
function plainShapeName(base, id) {
  if (base.light) return undefined;
  if (base.material) return (EFFECT_MATERIALS[base.material] ? EFFECT_MATERIALS[base.material].label : base.material) + ' ' + id;
  return t('Room {n}', { n: id });
}

// A piece with no shape of its own: the parent's fields, a fresh id, a plain name, no notes, no uid and no link.
function newShapeFromPiece(base, piece, id) {
  const s = { ...base, id };
  const name = plainShapeName(base, id);
  if (name === undefined) delete s.name; else s.name = name;
  applyPieceToShape(s, piece);
  delete s.desc;
  delete s.uid;
  delete s.pieceOf;
  return s;
}

// ⚠ ABSENT, never empty: a record with no hole stays byte-for-byte today's record.
function setShapeHoles(shape, holes) {
  if (holes && holes.length) shape.holes = holes;
  else delete shape.holes;
}

// One plan entry: a group of shapes and the pieces replacing them, and `detail`, the shapes the pieces' walls came
// from when that is not `shapes` itself (Merge's welded copies, roomOps.js).
// ⚠ ARRAY ORDER IS FOG COMPOSITING PRECEDENCE, so a group's first piece takes the slot its
// earliest member already holds and every other piece goes right after it, at its parent's layer:
// appended, half a split room would sit under whatever it was above. `mode` is handed in because a
// join takes the most hidden of its contributors, not the earliest one's, and it goes to every piece of the room.
// `list` is left as it was apart from the plan's own shapes, which change in place; `newId` numbers
// each extra piece. Claude's room tools (mcpRooms.js) run it on a map that is not open.
function shapePlanApplied(list, plan, mode, newId) {
  const drop = new Set();
  const extras = new Map();
  const rooms = [];
  let lostDoors = 0;
  // `kind` makes a group room-aware (roomPieces.js): 'link' makes every extra a piece of the base's room, or of `joinTo`'s,
  // which the base joins; 'split' makes every record of the room a room of its own. Without it the extras are rooms of
  // their own, as for a light. The head is never dropped while its room survives; a head that goes hands the room on.
  for (const g of plan) {
    const kind = g.kind && !g.shapes[0].light ? g.kind : null;
    let shapes = g.shapes;
    const h0 = kind ? roomHeadOf(list, shapes[0]) : shapes[0];
    if (h0 !== shapes[0] && shapes.includes(h0)) shapes = [h0, ...shapes.filter(s => s !== h0)];
    const base = shapes[0], head = kind ? roomHeadOf(list, base) : base;
    for (let i = 1; i < shapes.length; i++) drop.add(shapes[i].id);
    if (kind) rooms.push({ g, kind, head, base, mine: [] });
    if (!g.pieces.length) { drop.add(base.id); continue; }
    // Curves, corner radii and doors are CARRIED, not dropped: shapeDetail.js matches the
    // library's answer back onto the walls it came from, and counts the doors left with no wall.
    const kept = restoreGroupDetail(g.detail || g.shapes, g.pieces);
    lostDoors += kept.droppedDoors;
    let parts = kept.pieces.length ? kept.pieces : g.pieces.map(p => ({ vertices: p.verts, holes: p.holes }));
    // A split's largest part keeps the record, so its id stays with the room's name.
    if (kind === 'split') { const big = largestPiece(parts); parts = [big, ...parts.filter(p => p !== big)]; }
    applyPieceToShape(base, parts[0]);
    if (mode) base.mode = mode;
    const holder = kind ? g.joinTo || head : base;
    if (kind) _planNotesTo(holder, shapes, list);
    else if (shapes.length > 1) {
      // A merged-away room hands its notes to the one that stays, below its own, as a place does.
      const notes = shapes.map(s => typeof s.desc === 'string' ? s.desc.trim() : '').filter(Boolean).join('\n\n');
      if (notes) base.desc = notes;
    }
    const mine = [];
    for (let i = 1; i < parts.length; i++) mine.push(newShapeFromPiece(base, parts[i], newId()));
    if (kind === 'link') { const uid = ensureRoomUid(holder); for (const m of mine) m.pieceOf = uid; }
    if (kind) rooms[rooms.length - 1].mine = mine;
    extras.set(base, mine);
  }
  const out = [];
  for (const s of list) if (!drop.has(s.id)) out.push(s, ...(extras.get(s) || []));
  _planRooms(list, out, rooms, mode);
  return { list: out, drop, lostDoors };
}

// Notes of a group's others go below the holder's own: the room's head, or the room the group joins.
// A head whose room keeps pieces outside the group keeps its notes: they go on with its name (succeedRoomHead).
function _planNotesTo(holder, shapes, list) {
  const from = shapes.filter(s => s !== holder && !(!isPiece(s) && piecesOf(list, s).some(p => !shapes.includes(p))));
  const more = from.map(s => typeof s.desc === 'string' ? s.desc.trim() : '').filter(Boolean);
  if (!more.length) return;
  holder.desc = [typeof holder.desc === 'string' ? holder.desc.trim() : '', ...more].filter(Boolean).join('\n\n');
  for (const s of from) delete s.desc;
}

// The room-aware groups once the list is rebuilt: a base joins its room, heads that went hand over, a split room falls
// into rooms, and the plan's fog reaches every piece.
function _planRooms(list, out, rooms, mode) {
  for (const r of rooms) r.uid = (r.g.joinTo || r.head).uid;
  for (const r of rooms) {
    if (!r.g.joinTo || !out.includes(r.base)) continue;
    const to = r.g.joinTo, uid = ensureRoomUid(to), was = r.base.uid;
    if (r.base === to) continue;
    r.base.pieceOf = uid;
    if (to.mode !== undefined) r.base.mode = to.mode;
    if (to.material !== undefined) r.base.material = to.material;   // an effect is one material
    for (const m of r.mine) { m.mode = r.base.mode; if (r.base.material !== undefined) m.material = r.base.material; }
    if (was) for (const x of out) if (x.pieceOf === was) x.pieceOf = uid;
  }
  const kept = new Set(out);
  for (const s of list) if (!kept.has(s)) succeedRoomHead(out, s);
  const byUid = uid => uid && out.find(x => x.uid === uid && !isPiece(x));
  const split = new Map();
  for (const r of rooms) {
    if (r.kind !== 'split') continue;
    const head = kept.has(r.head) ? r.head : byUid(r.uid) || r.base;
    if (!split.has(head)) split.set(head, new Set(piecesOf(out, head)));
    for (const x of [r.base, ...r.mine]) if (kept.has(x)) split.get(head).add(x);
  }
  for (const [head, recs] of split) dissolveRoom([...recs], head, x => plainShapeName(x, x.id));
  if (!mode) return;
  for (const r of rooms) {
    const h = r.g.joinTo || r.head, head = kept.has(h) ? h : byUid(r.uid);
    if (head) for (const x of piecesOf(out, head)) x.mode = mode;
  }
}

// The Campaign's places are not rooms: no group of theirs is room-aware.
function applyShapePlan(plan, mode) {
  const groups = worldMapOpen ? plan.map(g => ({ ...g, kind: undefined, joinTo: undefined })) : plan;
  const out = shapePlanApplied(activeShapeList(), groups, mode, () => takeShapeId(placeMode));
  setShapeListNamed(placeMode, out.list);
  if (out.drop.has(selectedPolygonId)) clearShapeSelection();
  if (out.lostDoors) reportLostDoors(out.lostDoors);
}

// A door on a wall the repair removed has nothing left to sit on. Reported because the DM placed
// it by hand and cannot see it go, unlike a corner radius whose corner visibly went with the cut.
function reportLostDoors(n) {
  noticeToast(t.plural(n, 'One door was removed with the wall it was on.', '{n} doors were removed with the walls they were on.'));
}

// ⚠ EVERY PER-VERTEX FIELD IS REPLACED OR DELETED, never left behind: one array still holding
// the old outline's length puts every curve and every door on the wrong wall.
function applyPieceToShape(shape, piece) {
  shape.vertices = piece.vertices;
  delete shape.preset;   // a repair or boolean reshapes it: an effect's placed size no longer holds
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
  if (placeMode !== 'rooms') {
    shapeListChanged(placeMode);
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

// The drawn shape combines with every shape it lands on, and makes none of its own. `op` is 'join'
// (Merge), 'trim' (Cut out) or 'split' (the shape's edge divides each room it crosses in two).
// Effects mode holds fires and lights: a repair, the Split line included, acts on the kind being drawn.
function isDrawnKind(s) { return placeMode === 'rooms' || !!s.light === (currentMaterial === 'light'); }

function commitShapeOp(verts, op) {
  const hits = activeShapeList().filter(s => s.vertices && s.vertices.length >= 3 && isDrawnKind(s) &&
                                             shapesOverlap(s, verts));
  if (!hits.length) return false;
  const minArea = roomOpMinArea(gridSize);
  const rooms = placeMode === 'rooms';
  let plan, mode = null, toShroud;

  if (op === 'join') {
    const out = joinShapes(hits, verts, minArea);
    if (out.reason) return refuseShapeOp(out.reason);
    plan = [{ shapes: hits, pieces: out.pieces, kind: 'link' }];
    if (rooms) mode = mostHiddenMode(hits.map(s => s.mode));
    toShroud = mode === 'shroud';
  } else if (op === 'split') {
    const out = splitShapes(hits, verts, minArea);
    if (out.reason) return refuseShapeOp(out.reason);
    // A room the shape does not divide stays as it is, and a shape that divides none changes nothing.
    plan = hits.map((s, i) => out.groups[i] && { shapes: [s], pieces: out.groups[i], kind: 'split' }).filter(Boolean);
    if (!plan.length) return false;
    toShroud = null;   // each piece paints exactly the fog its parent did
  } else {
    const out = trimShapes(hits, verts, minArea);
    if (out.reason) return refuseShapeOp(out.reason);
    plan = hits.map((s, i) => ({ shapes: [s], pieces: out.groups[i], kind: 'link' }));
    // Shrinking a shroud room hands ground back; shrinking any other adds fog.
    toShroud = hits.some(s => s.mode !== 'shroud');
  }

  pushUndo();
  applyShapePlan(plan, mode);
  commitShapeOpFog(toShroud);
  return true;
}

// ─── Booleans on the picked shapes ───────────────────────────────────────────
// The first pick is the main: it keeps its id, name and own fog, the others go and their notes follow
// its own (shapePlanApplied). Effects combine fire with fire and light with light. One undo step each.
// A picked room brings every piece it has: `rooms` holds each picked room's records, the main's first, `recs` all of them.
const PICKED_OPS = {
  union:      (rooms, recs, minArea) => mergeShapes(recs[0], recs.slice(1), minArea, weldTolerance(gridSize)),
  difference: (rooms, recs, minArea) => cutOutShapes(rooms[0], recs.slice(rooms[0].length), minArea),
  intersect:  (rooms, recs, minArea) => intersectShapes(rooms, minArea),
  xor:        (rooms, recs, minArea) => excludeShapes(rooms, minArea),
};
const REASON_PICKED_APART = 'Those rooms do not overlap, so nothing is left. Nothing changed.';
const REASON_PICKED_EMPTY = 'Nothing of the first room is left. Nothing changed.';
const REASON_LIGHTS_APART = 'Those rooms do not touch. Nothing changed.';   // the noun becomes "lights" (refuseShapeOp)
const REASON_PEN_APART = 'The piece does not touch the room. Nothing changed.';
const REASON_PICKED_MIXED = 'An effect and a light cannot be combined. Nothing changed.';

// The pick after a change that may have taken the clicked record into another: the room's head, by its uid.
function _pickRoomAgain(id, uid) {
  const list = activeShapeList();
  if (list.some(s => s.id === id)) return id;
  const h = uid && list.find(s => s.uid === uid && !isPiece(s));
  return h ? h.id : null;
}

// `op` is 'union' (Merge), 'difference' (Cut out), 'intersect' or 'xor' (Exclude). Step 3's buttons call it.
// A Merge whose result falls apart makes one room of pieces (pickedBooleanPlan, roomPieces.js).
function booleanOnPicked(op) {
  const main = findActiveShape(), rest = pickedExtras();
  // ⚠ NEVER MID-DRAG: the next mousemove would write the main's pre-merge rings back over the merged outline.
  if (!main || !rest.length || !PICKED_OPS[op] || selectDragging()) return false;
  const list = activeShapeList();
  const rooms = [main, ...rest].map(s => s.light ? [s] : roomPickRecords(list, [s.id]));
  const recs = [].concat(...rooms);
  if (recs.some(s => !!s.light !== !!main.light)) return refuseShapeOp(REASON_PICKED_MIXED);
  const out = PICKED_OPS[op](rooms, recs, roomOpMinArea(gridSize));
  if (out.reason) return refuseShapeOp(out.reason);
  // ⚠ REFUSED BEFORE THE PLAN: a group with no pieces drops every shape in it, the main included.
  if (!out.pieces.length) return refuseShapeOp(op === 'intersect' ? REASON_PICKED_APART : REASON_PICKED_EMPTY);
  // Lights have no pieces: a Merge that falls apart would only rename them.
  if (main.light && op === 'union' && out.pieces.length > 1) return refuseShapeOp(REASON_LIGHTS_APART);
  const plan = main.light ? [{ shapes: recs, pieces: out.pieces, detail: out.shapes }]
    : pickedBooleanPlan(list, recs, rooms[0].length, out);
  pushUndo();
  const uid = main.light ? null : ensureRoomUid(roomHeadOf(list, main));
  applyShapePlan(plan, null);
  selectedPolygonId = _pickRoomAgain(main.id, uid);
  dropPickedExtras();
  pickSetReset();
  commitShapeOpFog(placeMode === 'rooms' ? main.mode === 'shroud' : null);
  drawCursor(lastScreenX, lastScreenY);
  return true;
}

// A piece drawn in an open edit, by the Pen (editRow.js) or a Room tool on the bar. 'join' unions it, through Merge's
// weld, into every record of the edited room it touches; touching none, it becomes a new piece of the room. 'trim'
// cuts it out of the edited record alone, and a part that falls away stays a piece of the room. One undo step; edit
// stays open, on the record that kept the edited one.
function joinPieceToPicked(verts, op) {
  const main = findActiveShape();
  if (!main || verts.length < 3) return false;
  const minArea = roomOpMinArea(gridSize), list = activeShapeList(), tol = weldTolerance(gridSize);
  let plan;
  if (op === 'trim') {
    if (!shapesOverlap(main, verts)) return refuseShapeOp(REASON_PEN_APART);
    const out = trimShapes([main], verts, minArea);
    if (out.reason) return refuseShapeOp(out.reason);
    if (!out.groups[0].length) return refuseShapeOp(REASON_PICKED_EMPTY);
    plan = [{ shapes: [main], pieces: out.groups[0], kind: 'link' }];
  } else {
    const room = main.light ? [main] : piecesOf(list, main);
    const touch = room.filter(r => { const o = mergeShapes(r, [verts], minArea, tol); return !o.reason && o.pieces.length === 1; });
    if (!touch.length) return main.light ? refuseShapeOp(REASON_PEN_APART) : _newPieceOfEdited(main, verts);
    const head = roomHeadOf(list, main);
    const first = touch.includes(main) ? main : touch.includes(head) ? head : touch[0];
    const shapes = [first, ...touch.filter(r => r !== first)];
    const out = mergeShapes(shapes[0], [...shapes.slice(1), verts], minArea, tol);
    if (out.reason) return refuseShapeOp(out.reason);
    // the welded records; the drawn piece has no detail of its own
    plan = [{ shapes, pieces: out.pieces, detail: out.shapes.slice(0, shapes.length), kind: 'link' }];
  }
  pushUndo();
  const uid = main.light ? null : ensureRoomUid(roomHeadOf(list, main));
  const keep = plan[0].shapes.includes(roomHeadOf(list, main)) ? roomHeadOf(list, main) : plan[0].shapes[0];
  applyShapePlan(plan, null);
  const at = activeShapeList().some(s => s === main) ? main.id : _pickRoomAgain(keep.id, uid);
  if (at != null) { selectedPolygonId = at; shapeEditMode = true; }
  selectedVertexIndex = -1;   // every flat index moved with the new outline
  selectedHoleIndex = -1;
  commitShapeOpFog(placeMode !== 'rooms' ? null : op === 'trim' ? main.mode !== 'shroud' : main.mode === 'shroud');
  drawCursor(lastScreenX, lastScreenY);
  return true;
}

// A piece drawn apart from the edited room: a record of its own linked to the room (a light stays a light of its own),
// placed by what it contains as a new room is. The edit stays where it was.
function _newPieceOfEdited(main, verts) {
  pushUndo();
  const rec = newShapeFromPiece(main, { vertices: verts }, takeShapeId(placeMode));
  if (!main.light) rec.pieceOf = ensureRoomUid(roomHeadOf(activeShapeList(), main));
  pushShapeTo(placeMode, rec);
  commitShapeOpFog(placeMode !== 'rooms' ? null : main.mode === 'shroud');
  drawCursor(lastScreenX, lastScreenY);
  return true;
}

// The room whose edit is open: a shape the bar's Room tools draw joins it instead of making a room.
function editedRoom() {
  if (!shapeEditMode || placeMode !== 'rooms' || worldMapOpen) return null;
  const p = findActiveShape();
  return p && !p.open && p.vertices && p.vertices.length >= 3 ? p : null;
}

// THE ONE PLACE A FINISHED CLOSED SHAPE GOES. `op` is what the shape was drawn as (repairNow, in
// repairKeys.js): 'new' makes a record; the three repairs make none, and an armed one stays armed.
// ⚠ RETURNS NULL FOR EVERY OP BUT 'new', a refusal included, so no caller may reach into it.
// A repair also takes a { vertices, holes } record (a Ring size); 'new' takes a point list only.
function commitClosedShape(verts, op) {
  const as = op || shapeOp;
  if (as !== 'split' && Array.isArray(verts) && editedRoom()) { joinPieceToPicked(verts, as === 'trim' ? 'trim' : 'join'); return null; }
  if (as === 'new') return commitDrawnShape(verts);
  clearShapeSelection();
  commitShapeOp(verts, as);
  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { shapePlanApplied, newShapeFromPiece };
}
