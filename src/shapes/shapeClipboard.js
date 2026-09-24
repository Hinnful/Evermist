'use strict';

// Copy, paste and duplicate for rooms, effects and holes. Figma's keys, and its rule that a paste
// lands under the pointer.
// ⚠ THE CLIPBOARD OUTLIVES A SCENE SWITCH - copying a guard post between floors is the case that
// asked for this, so it is a module variable and never anything a scene carries.
// ⚠ IT REMEMBERS WHICH LIST IT CAME FROM. A paste goes back to that list even from the other
// placement mode, so an effect pasted in Rooms mode lands among the effects and is drawn faint.

let shapeClip = null;

function _clipList(name) { return name === 'effects' ? effects : polygons; }

function _clipStep() { return gridSize > 0 ? gridSize : 70; }

// A paste the mouse never moved over falls back to the middle of the view.
function _clipDropPoint() {
  const sx = lastScreenX != null ? lastScreenX : container.clientWidth / 2;
  const sy = lastScreenY != null ? lastScreenY : container.clientHeight / 2;
  return { x: (sx - panX) / zoom, y: (sy - panY) / zoom };
}

// ⚠ THE FLATTENED OUTLINE: a centre off the anchors sits away from the shape the DM sees.
function _clipCentre(poly, hole) {
  const b = boxFromPoints(boxOutlinePoints(poly, hole));
  return b ? boxCentre(b) : null;
}

// A hole's slice of the flat-indexed arrays, rebased to zero for laying down in another shape.
// ⚠ EVERY ENTRY COPIED: a handle object shared with the clipboard lets one edit reach both.
function _clipSlice(arr, from, count) {
  if (!arr) return null;
  const out = [];
  let held = false;
  for (let k = 0; k < count; k++) {
    const v = arr[from + k];
    if (v) held = true;
    out.push(v ? { ...v } : null);
  }
  return held ? out : null;
}

// ⚠ copyShapeRings SPREADS THE RECORD, so the rings are its own and the flat arrays are not: one
// clip pasted twice would put the same cornerRadii array in two live shapes.
function _clipDetach(out) {
  if (out.cornerRadii) out.cornerRadii = out.cornerRadii.slice();
  if (out.handles) out.handles = out.handles.map(h => h ? { ...h } : null);
  if (out.doors) out.doors = out.doors.map(d => ({ ...d }));
  return out;
}

// The commit paths in tools.js read placeMode, and a paste may land in the OTHER list.
function _clipCommit(listName, toShroud) {
  if (listName === 'effects') {
    effectsChanged();
    scheduleAutoSync();
    scheduleAutoSave();
    scheduleRender();
    return;
  }
  rebuildFogFromPolygons();
  startFogTransition(toShroud);
  rebuildFogEffect();
  fogDirty = true;
  scheduleRender();
  scheduleAutoSync();
}

// ⚠ THE OUTER RING ALONE, never pointInShape: that XORs the holes out, so a pillar dropped beside
// an existing pillar would find no room under the pointer and paste nothing.
function _clipShapeUnder(listName, x, y) {
  const list = _clipList(listName);
  for (let i = list.length - 1; i >= 0; i--) {
    const poly = list[i];
    const verts = poly.vertices;
    if (!verts || verts.length < 3) continue;
    const ring = poly.handles ? flattenRing(verts, poly.handles, 0) : verts;
    if (pointInPolygon(x, y, ring)) return poly;
  }
  return null;
}

// Handles are OFFSETS, radii lengths and a door a fraction along its wall: all three ride a move.
function _clipMoved(shape, dx, dy) {
  const out = _clipDetach(copyShapeRings(shape));
  out.vertices = out.vertices.map(v => ({ ...v, x: v.x + dx, y: v.y + dy }));
  if (out.holes) out.holes = out.holes.map(h => h.map(v => ({ ...v, x: v.x + dx, y: v.y + dy })));
  return out;
}

function _clipRingMoved(ring, dx, dy) {
  return ring.map(v => ({ ...v, x: v.x + dx, y: v.y + dy }));
}

// ─── Copy ─────────────────────────────────────────────────────────────────────

// A hole is read whenever one is picked, at either of its two levels; otherwise the whole shape.
function _clipRead() {
  const poly = findActiveShape();
  if (!poly) return null;
  const listName = placeMode === 'effects' ? 'effects' : 'rooms';
  const holes = polyHoleRings(poly);
  if (shapeEditMode && selectedHoleIndex >= 0 && holes[selectedHoleIndex]) {
    const hi = selectedHoleIndex;
    const { from, count } = boxFlatRange(poly, hi);
    return {
      list: listName,
      kind: 'hole',
      centre: _clipCentre(poly, hi),
      ring: holes[hi].map(v => ({ ...v })),
      cornerRadii: _clipSlice(poly.cornerRadii, from, count),
      handles: _clipSlice(poly.handles, from, count),
      doors: (poly.doors || []).filter(d => d.edge >= from && d.edge < from + count)
                               .map(d => ({ ...d, edge: d.edge - from })),
    };
  }
  const shape = _clipDetach(copyShapeRings(poly));
  delete shape.id;
  return { list: listName, kind: 'shape', centre: _clipCentre(poly, -1), shape };
}

function copySelectedShape() {
  const clip = _clipRead();
  if (!clip || !clip.centre) return false;
  shapeClip = clip;
  return true;
}

// ─── Paste ────────────────────────────────────────────────────────────────────

// ⚠ APPENDED, never spliced in: a hole added at the end takes flat indices past every one the
// shape already holds, so no corner radius, curve or door moves onto another wall.
function clipAddHole(poly, ring, clip) {
  editHoles(poly, hs => { hs.push(ring); });
  const hi = polyHoleRings(poly).length - 1;
  const { from, count } = boxFlatRange(poly, hi);
  const total = flatVertexCount(poly);
  if (clip.cornerRadii || poly.cornerRadii) {
    editCornerRadii(poly, r => {
      while (r.length < total) r.push(null);
      for (let k = 0; k < count; k++) r[from + k] = clip.cornerRadii ? clip.cornerRadii[k] : null;
    });
  }
  if (clip.handles || poly.handles) {
    editHandles(poly, hs => {
      while (hs.length < total) hs.push(null);
      for (let k = 0; k < count; k++) hs[from + k] = clip.handles ? clip.handles[k] : null;
    });
  }
  if (clip.doors && clip.doors.length) {
    poly.doors = (poly.doors || []).concat(clip.doors.map(d => ({ ...d, edge: d.edge + from })));
  }
  return hi;
}

// The one path a clipped record takes to a live one. `into` names the shape a hole must land in;
// a paste leaves it out and takes whatever sits under the pointer.
function _clipDrop(clip, dx, dy, into) {
  if (clip.kind === 'hole') {
    const ring = _clipRingMoved(clip.ring, dx, dy);
    // ⚠ AIMED BY THE FLATTENED CENTRE, which is what the DM points at, then held to the rule a
    // DRAG obeys: a hole placed where a drag would refuse to leave it is the state to avoid.
    const poly = into || _clipShapeUnder(clip.list, clip.centre.x + dx, clip.centre.y + dy);
    if (!poly || !holeStaysOnRoom(poly, ring)) return false;
    pushUndo();
    const hi = clipAddHole(poly, ring, clip);
    if (clip.list === (placeMode === 'effects' ? 'effects' : 'rooms')) {
      selectedPolygonId = poly.id;
      shapeEditMode = true;
      holeEditMode = false;
      selectedVertexIndex = -1;
      selectedHoleIndex = hi;
    }
    _clipCommit(clip.list, poly.mode === 'shroud');
    drawCursor(lastScreenX, lastScreenY);
    return true;
  }
  const shape = _clipMoved(clip.shape, dx, dy);
  pushUndo();
  if (clip.list === 'effects') {
    shape.id = nextEffectId++;
    effects.push(shape);
  } else {
    shape.id = nextPolygonId++;
    polygons.push(shape);
  }
  // Figma leaves a paste selected and ready to drag. Only the live list can hold the selection,
  // so an effect pasted from Rooms mode arrives unselected.
  if (clip.list === (placeMode === 'effects' ? 'effects' : 'rooms')) {
    selectedPolygonId = shape.id;
    leaveShapeEditMode();
  }
  _clipCommit(clip.list, shape.mode === 'shroud');
  drawCursor(lastScreenX, lastScreenY);
  return true;
}

function pasteShapeAtCursor() {
  if (!shapeClip || !shapeClip.centre) return false;
  const p = _clipDropPoint();
  return _clipDrop(shapeClip, p.x - shapeClip.centre.x, p.y - shapeClip.centre.y);
}

// ─── Cut ──────────────────────────────────────────────────────────────────────

// Delete pushes the one undo step; the copy pushes none.
function cutSelectedShape() {
  if (!copySelectedShape()) return false;
  // ⚠ OR DELETE TAKES THE PICKED CORNER, which the clip never held.
  selectedVertexIndex = -1;
  return deleteSelectedPart();
}

// ─── Alt+drag ─────────────────────────────────────────────────────────────────

// A copy laid over the selection, which then becomes the selection the drag moves.
// ⚠ NO UNDO OF ITS OWN: the drag pushed one, so one Ctrl+Z takes the copy and its move together.
function dragCopyOfSelection() {
  const clip = _clipRead();
  if (!clip) return false;
  if (clip.kind === 'hole') {
    selectedHoleIndex = clipAddHole(findActiveShape(), clip.ring, clip);
    return true;
  }
  const shape = _clipMoved(clip.shape, 0, 0);
  if (clip.list === 'effects') {
    shape.id = nextEffectId++;
    effects.push(shape);
  } else {
    shape.id = nextPolygonId++;
    polygons.push(shape);
  }
  selectedPolygonId = shape.id;
  leaveShapeEditMode();
  return true;
}

// ─── Duplicate ────────────────────────────────────────────────────────────────

// ⚠ THE CLIPBOARD IS NOT TOUCHED, as in Figma: Ctrl+D must not throw away what Ctrl+C put there.
// ⚠ A HOLE IS DUPLICATED INTO ITS OWN ROOM, or the hit test hands an overlapping neighbour the
// copy. It stops at that room's wall like any hole move, so the offset is tried the other way,
// and ⚠ NEVER IN PLACE - a ring over the original reads as nothing having happened.
function duplicateSelectedShape() {
  const clip = _clipRead();
  if (!clip || !clip.centre) return false;
  const step = _clipStep();
  if (clip.kind !== 'hole') return _clipDrop(clip, step, step);
  const room = findActiveShape();
  if (_clipDrop(clip, step, step, room) || _clipDrop(clip, -step, -step, room)) return true;
  noticeToast('The hole has no room left to be duplicated into.');
  return false;
}

// clipAddHole mutates only the `poly` it is given - no DOM, no globals beyond the room-editing
// helpers it calls. Exported for that reason; every other _clip* helper here reads live app
// state (the selection, the pointer, the map) and stays private.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { clipAddHole };
}
