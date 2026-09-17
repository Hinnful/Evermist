'use strict';

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

// ─── Which shapes the tools act on ────────────────────────────────────────────
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

// ─── Join, Trim and Cut ───────────────────────────────────────────────────────
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

// Held in activePolygon so Escape, the tool switch and the preview all work on it unchanged.
function cutMouseDown(mapX, mapY) {
  const pos = snapVertex(mapX, mapY);
  if (!activePolygon || !activePolygon.cut) activePolygon = { vertices: [pos], mode: tool, cut: true };
  else activePolygon.vertices.push(pos);
}

// ⚠ EVERY SHAPE THE PATH TOUCHES IS IN OR THE WHOLE CUT IS REFUSED. One crossed four times has
// no two-piece answer, and cutting its neighbours while skipping it is a silent refusal.
function commitCutPath() {
  const path = activePolygon && activePolygon.cut ? activePolygon.vertices : null;
  activePolygon = null;
  drawCursor(lastScreenX, lastScreenY);
  if (!path || path.length < 2) return;
  const minArea = roomOpMinArea(gridSize);
  const plan = [];
  for (const poly of activeShapeList()) {
    if (!poly.vertices || poly.vertices.length < 3) continue;
    if (!ringPathCrossings(poly.vertices, path).length) continue;
    const out = cutRing(poly, path, minArea);
    if (out.reason) { refuseShapeOp(out.reason); return; }
    plan.push({ shapes: [poly], pieces: out.pieces });
  }
  if (!plan.length) { refuseShapeOp(REASON_CUT); return; }
  pushUndo();
  applyShapePlan(plan, null);
  commitShapeOpFog(null);
  drawCursor(lastScreenX, lastScreenY);
}

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

// ─── Doors ────────────────────────────────────────────────────────────────────
// One click toggles one grid cell of one wall, so a revealed room shows where its exits are.
// Nothing to size and nothing to edit: every door is one cell, and a second click closes it.

const DOOR_HIT_PX = 8;

function doorCellSize() { return gridSize > 0 ? gridSize : 0; }

// Click-to-toggle: removing is tested before placing, or a click on a door stacks a second one.
// ⚠ Toggling is decided by CELL, never by whether the click hit a door's rectangle: a boundary
// click belongs to two rectangles and to neither, and the tool ticks those boundaries.
// ⚠ EVERY room whose wall is under the click is a candidate, not just the nearest — two rooms
// share a doorway's wall. A revealed room wins, because a door on a shrouded one draws nothing.
function doorMouseDown(mapX, mapY) {
  const cell = doorCellSize();
  if (!(cell > 0)) return;
  const slack = DOOR_HIT_PX / zoom;
  const size = doorSizeForCell(cell, doorWidthPct, doorDepthPct);

  const cands = [];
  for (const poly of activeShapeList()) {
    if (poly.vertices.length < 3) continue;
    const near = nearestOutlinePoint(poly, mapX, mapY, slack * 2);
    if (!near) continue;
    const door = doorCellSnap(poly, near.edge, mapX, mapY, cell,
                              gridOffsetX, gridOffsetY, gridMode === 'square');
    if (door) cands.push({ poly, door, dist: near.dist });
  }
  if (!cands.length) return;

  for (const c of cands) {
    const doors = c.poly.doors;
    if (!doors || !doors.length) continue;
    const centre = doorPoint(c.poly, c.door);
    let hit = doors.findIndex(d => {
      if (d.edge !== c.door.edge || !centre) return false;
      const p = doorPoint(c.poly, d);
      return p && Math.hypot(p.x - centre.x, p.y - centre.y) < cell * 0.25;
    });
    // A door placed before the grid changed no longer sits on a cell centre, so pointing straight
    // at it is the only way left to take it away.
    if (hit < 0) hit = doors.findIndex(d =>
      pointInDoorNotch(c.poly, d, size.width, size.depth, mapX, mapY, slack));
    if (hit < 0) continue;
    pushUndo();
    // Replaced, never spliced: pushUndo copies a room shallowly, so its snapshot holds THIS array
    // and an in-place edit would rewrite the undo state too.
    c.poly.doors = doors.filter((_, k) => k !== hit);
    commitDoorChange();
    return;
  }

  cands.sort((a, b) => (a.poly.mode === 'shroud') - (b.poly.mode === 'shroud') || a.dist - b.dist);
  const pick = cands[0];
  pushUndo();
  pick.poly.doors = (pick.poly.doors || []).concat([pick.door]);
  commitDoorChange();
}

function commitDoorChange() {
  rebuildFogFromPolygons();
  rebuildFogEffect();
  fogDirty = true;
  scheduleRender();
  scheduleAutoSync();
}

// Every room's doors resize with the grid, so a scene whose grid was never calibrated is corrected
// by fixing the grid rather than by redrawing. Skipped when no room has a door, because the cell
// slider fires this on every input event.
function rebuildFogForGridChange() {
  if (typeof polygons === 'undefined') return;
  if (!polygons.some(p => p.doors && p.doors.length)) return;
  rebuildFogFromPolygons();
  rebuildFogEffect();
  fogDirty = true;
}

// ─── Brush flush ──────────────────────────────────────────────────────────────

function flushBrushOps() {
  if (!pendingBrushOps.length || !fogDataCtx) return;
  const ops = pendingBrushOps;
  pendingBrushOps = [];

  const mapRadius = (brushSize / 2) / zoom;
  const r         = mapRadius / FOG_SCALE;
  const mode      = ops[0].mode;

  const applyBrushToCtx = (ctx) => {
    ctx.save();
    ctx.beginPath();
    let minFX = Infinity, minFY = Infinity, maxFX = -Infinity, maxFY = -Infinity;
    for (const op of ops) {
      const dist  = Math.hypot(op.x2 - op.x1, op.y2 - op.y1);
      const steps = Math.max(1, Math.floor(dist / (mapRadius / 4)));
      for (let i = 0; i <= steps; i++) {
        const t  = i / steps;
        const fx = (op.x1 + (op.x2 - op.x1) * t) / FOG_SCALE;
        const fy = (op.y1 + (op.y2 - op.y1) * t) / FOG_SCALE;
        ctx.moveTo(fx + r, fy);
        ctx.arc(fx, fy, r, 0, Math.PI * 2);
        if (mode === 'reveal') {
          if (fx - r < minFX) minFX = fx - r;
          if (fy - r < minFY) minFY = fy - r;
          if (fx + r > maxFX) maxFX = fx + r;
          if (fy + r > maxFY) maxFY = fy + r;
        }
      }
    }
    if (mode === 'reveal') {
      ctx.clip();
      ctx.clearRect(minFX, minFY, maxFX - minFX, maxFY - minFY);
    } else {
      ctx.fillStyle = '#1a1a2e';
      ctx.fill();
    }
    ctx.restore();
  };

  applyBrushToCtx(fogDataCtx);
  if (baseFogCtx) applyBrushToCtx(baseFogCtx);
  fogDirty = true;
}

// ─── Cursor / outline drawing ─────────────────────────────────────────────────

function drawActivePolyPreview(screenX, screenY) {
  const verts = activePolygon.vertices;
  if (verts.length === 0) return;
  const mode = activePolygon.mode || tool;
  // A cut path is gold, the colour of a selected room, because it edits rooms already there
  // rather than making one in a fog state.
  const cut = !!activePolygon.cut;
  // Same colours drawPolyOutline reads, so closing the polygon changes only the line's WEIGHT
  // (2px solid in progress → 1.5px dashed once saved), never its colour.
  const edgeColor = cut ? POLY_EDGE_SELECTED
    : (placeMode === 'effects'
        ? EFFECT_EDGE_COLOR
        : (POLY_EDGE_COLORS[mode] || POLY_EDGE_COLORS.shroud));
  cursorCtx.save();

  // Placed edges (solid, glowing)
  if (verts.length >= 2) {
    cursorCtx.strokeStyle = edgeColor;
    cursorCtx.lineWidth   = 2;
    cursorCtx.setLineDash([]);
    cursorCtx.shadowColor = edgeColor;
    cursorCtx.shadowBlur  = 8;
    cursorCtx.beginPath();
    for (let i = 0; i < verts.length; i++) {
      const { sx, sy } = toScreen(verts[i].x, verts[i].y);
      if (i === 0) cursorCtx.moveTo(sx, sy); else cursorCtx.lineTo(sx, sy);
    }
    cursorCtx.stroke();
  }

  // Dashed preview edge to cursor
  if (screenX != null) {
    const last = toScreen(verts[verts.length - 1].x, verts[verts.length - 1].y);
    let tipX = screenX, tipY = screenY;
    // With axis-lock on, preview where the click will land so the wall does not jump on release.
    // Gated on axisLock, so grid-snap-only drawing keeps its free-cursor preview.
    if (axisLock) {
      const m = axisLockDraw(snapVertex((screenX - panX) / zoom, (screenY - panY) / zoom));
      const s = toScreen(m.x, m.y);
      tipX = s.sx; tipY = s.sy;
    }
    // Mode colour, faded, so an un-placed segment reads as provisional. globalAlpha rather than a
    // second colour string, so it cannot drift from the table.
    cursorCtx.strokeStyle = edgeColor;
    cursorCtx.globalAlpha = 0.6;
    cursorCtx.lineWidth   = 1.5;
    cursorCtx.setLineDash([6, 5]);
    cursorCtx.shadowBlur  = 0;
    cursorCtx.beginPath();
    cursorCtx.moveTo(last.sx, last.sy);
    cursorCtx.lineTo(tipX, tipY);
    cursorCtx.stroke();
    cursorCtx.globalAlpha = 1;
  }

  // Close-target halo (first vertex, gold glow when >=3 verts). A cut path never closes.
  if (!cut && verts.length >= 3) {
    const { sx, sy } = toScreen(verts[0].x, verts[0].y);
    cursorCtx.setLineDash([4, 3]);
    cursorCtx.strokeStyle = POLY_EDGE_SELECTED;
    cursorCtx.lineWidth   = 2;
    cursorCtx.shadowColor = POLY_EDGE_SELECTED;
    cursorCtx.shadowBlur  = 14;
    cursorCtx.beginPath();
    cursorCtx.arc(sx, sy, POLY_CLOSE_RADIUS, 0, Math.PI * 2);
    cursorCtx.stroke();
  }

  cursorCtx.setLineDash([]);
  for (let i = 0; i < verts.length; i++) {
    const { sx, sy } = toScreen(verts[i].x, verts[i].y);
    const isFirst = i === 0;
    const r = isFirst ? 6 : 4;
    cursorCtx.shadowColor = isFirst ? '#ffd028' : edgeColor;
    cursorCtx.shadowBlur  = isFirst ? 12 : 6;
    cursorCtx.beginPath();
    cursorCtx.arc(sx, sy, r, 0, Math.PI * 2);
    cursorCtx.fillStyle = isFirst ? '#ffd060' : 'rgba(255,255,255,0.92)';
    cursorCtx.fill();
    cursorCtx.shadowBlur  = 0;
    cursorCtx.strokeStyle = isFirst ? 'rgba(255,255,255,0.6)' : edgeColor;
    cursorCtx.lineWidth   = 1.5;
    cursorCtx.stroke();
  }

  cursorCtx.restore();
}

// The selected room's card — markup, wiring, positioning and the map labels — lives in
// roomPanel.js (refreshRoomPanel), called from drawCursor().

// ─── Tool mouse handlers ──────────────────────────────────────────────────────
// Called from index.html with pre-converted MAP coordinates; panning and conversion are its job.

function toolMouseDown(raw, e) {
  if (shape === 'poly') {
    let pos = snapVertex(raw.x, raw.y);
    if (!activePolygon) {
      // Start new polygon — Polygon tool never selects/drags existing polygons
      activePolygon = { vertices: [pos], mode: tool };
      clearShapeSelection();
    } else {
      // Grid snap first, then straighten — if the grid already landed the point on an
      // aligned coordinate, the axis snap is a no-op.
      pos = axisLockDraw(pos);
      // Close by first-vertex proximity (12 screen px hit area)
      if (activePolygon.vertices.length >= 3) {
        const first = activePolygon.vertices[0];
        if (Math.hypot(raw.x - first.x, raw.y - first.y) < POLY_CLOSE_RADIUS / zoom) {
          closeActivePolygon(); return;
        }
        // Close by self-intersection — keep only the loop, drop the tail
        const verts = activePolygon.vertices;
        const newSeg = [verts[verts.length - 1], pos];
        for (let i = 0; i < verts.length - 2; i++) {
          const pt = segmentsIntersect(newSeg[0], newSeg[1], verts[i], verts[i + 1]);
          if (pt) {
            activePolygon.vertices = verts.slice(i + 1);
            activePolygon.vertices.push(pt);
            closeActivePolygon(); return;
          }
        }
      }
      activePolygon.vertices.push(pos);
    }
    drawCursor(e.clientX - container.getBoundingClientRect().left,
               e.clientY - container.getBoundingClientRect().top);
    return;
  }

  if (shape === 'door') {
    const r = container.getBoundingClientRect();
    doorMouseDown(raw.x, raw.y);
    drawCursor(e.clientX - r.left, e.clientY - r.top);
    return;
  }

  if (shape === 'cut') {
    const r = container.getBoundingClientRect();
    cutMouseDown(raw.x, raw.y);
    drawCursor(e.clientX - r.left, e.clientY - r.top);
    return;
  }

  if (shape === 'select') {
    const r = container.getBoundingClientRect();
    selectMouseDown(raw, e);
    drawCursor(e.clientX - r.left, e.clientY - r.top);
    return;
  }

  const pos = raw;
  isDrawing = true;
  if (!isPlayer) pixiSetFogBrushing(true);

  if (shape === 'brush') {
    pushUndo();
    fogModifiedThisStroke = true;
    const mapRadius = (brushSize / 2) / zoom;
    if (tool === 'reveal') revealCircle(pos.x, pos.y, mapRadius);
    else                   shroudCircle(pos.x, pos.y, mapRadius);
    lastMapX = pos.x; lastMapY = pos.y;
    fogDirty = true;
    scheduleRender();
  } else if (shape === 'circle') {
    fogModifiedThisStroke = false;
    circleCenter = { x: pos.x, y: pos.y };
  } else if (shape === 'cone') {
    fogModifiedThisStroke = false;
    // The APEX is what snaps to the grid — it is the spell's point of origin, and the far end
    // is wherever the length lands. Snapping both would fight the fixed spread.
    coneApex = { x: pos.x, y: pos.y };
  } else {
    fogModifiedThisStroke = false;
    rectStartX = pos.x; rectStartY = pos.y;
  }
}

function toolMouseMove(pos, e, screenX, screenY) {
  if (shape === 'select' && !selectDragging()) container.style.cursor = selectHoverCursor(pos);
  if (selectMouseMove(pos, screenX, screenY)) return;

  if (!isDrawing) return;

  if (shape === 'brush') {
    pendingBrushOps.push({ x1: lastMapX, y1: lastMapY, x2: pos.x, y2: pos.y, mode: tool });
    lastMapX = pos.x; lastMapY = pos.y;
    scheduleRender();
  } else {
    scheduleRender();
  }
}

// The drag releases below go through commitShapeDrag(), which is shared with
// toolWindowMouseUp() — see the note on it about why it is one function.
function toolMouseUp(pos, e) {
  if (selectMouseUp()) return;

  if (shape === 'poly' || shape === 'select' || shape === 'cut') return;

  if (!isDrawing) return;
  isDrawing = false;
  if (!isPlayer) pixiSetFogBrushing(false);
  lastMapX = lastMapY = null;
  if (shape === 'rect') {
    const rw = Math.abs(pos.x - rectStartX), rh = Math.abs(pos.y - rectStartY);
    if (rw > 2 && rh > 2) {
      const x1 = Math.min(rectStartX, pos.x), y1 = Math.min(rectStartY, pos.y);
      const x2 = Math.max(rectStartX, pos.x), y2 = Math.max(rectStartY, pos.y);
      commitClosedShape([{x:x1,y:y1},{x:x2,y:y1},{x:x2,y:y2},{x:x1,y:y2}]);
    }
    drawCursor(null, null);
  }
  if (shape === 'cone' && coneApex) {
    const verts = coneVertices(coneApex, pos, axisLock ? CONE_SNAP_DEG : 0);
    // The same 2px floor the other shapes use, so a click that was meant as a deselect does
    // not leave a sliver of a cone behind.
    if (verts && Math.hypot(pos.x - coneApex.x, pos.y - coneApex.y) > 2) commitClosedShape(verts);
    coneApex = null;
    drawCursor(null, null);
  }
  if (shape === 'circle' && circleCenter) {
    const radius = Math.hypot(pos.x - circleCenter.x, pos.y - circleCenter.y);
    if (radius > 2) {
      const SEGS = 32;
      const verts = [];
      for (let i = 0; i < SEGS; i++) {
        const angle = (i / SEGS) * Math.PI * 2;
        verts.push({
          x: circleCenter.x + Math.cos(angle) * radius,
          y: circleCenter.y + Math.sin(angle) * radius,
        });
      }
      commitClosedShape(verts);
    }
    circleCenter = null;
    drawCursor(null, null);
  }
  // Gated on the stroke having touched fog, so drawing an effect never rebuilds the stencil.
  if (fogModifiedThisStroke && polygons.length > 0) {
    rebuildFogFromPolygons();
  }
  if (fogModifiedThisStroke) {
    startFogTransition(tool === 'shroud');
    rebuildFogEffect();
    scheduleAutoSync();
  }
  fogModifiedThisStroke = false;
  fogDirty = true;
  scheduleRender();
}

// Catches a drag released outside the canvas. Same three releases as toolMouseUp, through the
// same commitShapeDrag().
function toolWindowMouseUp() {
  selectMouseUp();
  if (isDrawing) {
    isDrawing = false; lastMapX = lastMapY = null;
    if (!isPlayer) pixiSetFogBrushing(false);
    circleCenter = null;
    coneApex = null;
    if (fogModifiedThisStroke && polygons.length > 0) { rebuildFogFromPolygons(); }
    if (fogModifiedThisStroke) {
      startFogTransition(tool === 'shroud');
      rebuildFogEffect();
      scheduleAutoSync();
    }
    fogModifiedThisStroke = false;
    fogDirty = true;
    scheduleRender();
  }
}

// ─── Polygon lifecycle ────────────────────────────────────────────────────────

function closeActivePolygon() {
  if (!activePolygon || activePolygon.vertices.length < 3) { activePolygon = null; drawCursor(null, null); return; }
  const verts = activePolygon.vertices;
  const mode  = activePolygon.mode;
  activePolygon = null;
  const shape = commitClosedShape(verts);
  drawCursor(null, null);
  // The polygon tool paints its own fog below rather than going through toolMouseUp's block,
  // so the flag that block reads must not be left set for the next release to act on.
  fogModifiedThisStroke = false;
  // ⚠ NOTHING BELOW RUNS FOR JOIN, TRIM OR A REFUSAL. applyPolygonToFog paints the drawn shape
  // rather than rebuilding the stencil, and a refusal leaves no shape to dereference at all.
  // Each of those settled its own fog inside commitShapeOp.
  if (!shape) return;
  if (placeMode === 'effects') { fogDirty = true; scheduleRender(); return; }
  // applyPolygonToFog paints just this room rather than rebuilding the whole stencil, which is
  // why the polygon tool does not share the rectangle path's rebuild.
  applyPolygonToFog(shape);
  startFogTransition(mode === 'shroud');
  rebuildFogEffect();
  fogDirty = true;
  scheduleRender();
  scheduleAutoSync();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { segmentsIntersect };
}
