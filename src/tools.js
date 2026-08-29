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

// ─── Select tool state ────────────────────────────────────────────────────────
let selectedPolygonId = null;
let isDraggingPolygon = false;
let dragStartMapX = 0, dragStartMapY = 0;
let dragOrigVerts = null;   // snapshot of vertices at drag start
let snapToGrid = false;
// Straighten-walls toggle. Runtime-only, like snapToGrid — never per scene, never in a backup.
let axisLock = false;
const AXIS_LOCK_PX = 12;   // screen px of slack before the snap lets go

// ─── Vertex / edge editing state ──────────────────────────────────────────────
// -1 = no vertex selected. Also the room card's radius target: roomPanel.js derives "this corner
// vs all corners" straight from this, so there is no separate mode flag to keep in step.
let selectedVertexIndex = -1;
let isDraggingVertex = false;
let vertexDragOrigVerts = null;
let isDraggingEdge = false;
let edgeDragIndex = -1;         // index of first vertex of dragged edge
let edgeDragOrigVerts = null;
let edgeDragStartMapX = 0, edgeDragStartMapY = 0;
let polygonActuallyMoved = false;

// ─── Undo for a drag ──────────────────────────────────────────────────────────
// ⚠ PUSHED ON THE FIRST MOVEMENT, never on mousedown. Selecting a room moves nothing, so pushing
// at mousedown spends one Ctrl+Z and one full fog-canvas clone on every selection.
//
// The snapshot is still pre-drag: mousedown records dragOrigVerts and writes no geometry, so the
// first mousemove is the last moment the old shape is live.
let _dragUndoPushed = false;
function armDragUndo()  { _dragUndoPushed = false; }
function pushDragUndo() { if (!_dragUndoPushed) { _dragUndoPushed = true; pushUndo(); } }

// ─── Which shapes the tools act on ────────────────────────────────────────────
// A ROOM AND AN EFFECT ARE THE SAME OBJECT, carrying a fog `mode` or a `material`. They live in
// two arrays only because polygons order IS fog compositing precedence, so an effect in that list
// would change how fog resolves around it.
//
// The placement mode decides which array every tool reads and writes, which is what makes a click
// over a fire drawn inside a room unambiguous. setPlaceMode() clears the selection, so an id here
// always resolves in one list.
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

// THE ONE RELEASE PATH for a room or effect drag. toolMouseUp and toolWindowMouseUp both call it,
// rather than each carrying a copy.
//
// This does NOT stop a running crossfade: startFogTransition() leaves the live fade going and
// rebuildFogEffect() re-targets it.
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

// A freshly drawn rectangle, circle or polygon, landed in whichever list the mode names. The two
// records differ only in a fog `mode` against a `material`, which is what lets ONE set of editing
// paths serve both.
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
  selectedPolygonId = null;
  selectedVertexIndex = -1;
  return shape;
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

// Straighten the point being placed against the vertex just placed. The threshold is SCREEN px
// divided by zoom, so the slack feels identical at every zoom level.
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

function findPolygonAt(mapX, mapY) {
  const list = activeShapeList();
  for (let i = list.length - 1; i >= 0; i--) {
    if (pointInPolygon(mapX, mapY, list[i].vertices)) return list[i];
  }
  return null;
}

function distPointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Only returns a polygon when clicking a vertex dot or edge, never the interior, so a new polygon
// can start inside an existing one.
function findPolygonHandleAt(mapX, mapY) {
  const hitRadius = Math.min(10 / zoom, 30); // clamp: ≤30 map-units so grab shrinks when very zoomed out
  const list = activeShapeList();
  for (let i = list.length - 1; i >= 0; i--) {
    const poly = list[i];
    const verts = poly.vertices;
    for (const v of verts) {
      if (Math.hypot(mapX - v.x, mapY - v.y) < hitRadius) return poly;
    }
    for (let j = 0; j < verts.length; j++) {
      const a = verts[j], b = verts[(j + 1) % verts.length];
      if (distPointToSegment(mapX, mapY, a.x, a.y, b.x, b.y) < hitRadius) return poly;
    }
  }
  return null;
}

function findVertexAt(poly, mapX, mapY) {
  const hitR = Math.min(10 / zoom, 30); // clamp: matches findPolygonHandleAt
  for (let i = 0; i < poly.vertices.length; i++) {
    if (Math.hypot(mapX - poly.vertices[i].x, mapY - poly.vertices[i].y) < hitR) return i;
  }
  return -1;
}

function findEdgeAt(poly, mapX, mapY) {
  const hitR = 10 / zoom;
  const verts = poly.vertices;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    if (distPointToSegment(mapX, mapY, a.x, a.y, b.x, b.y) < hitR) return i;
  }
  return -1;
}

function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: ax, y: ay };
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return { x: ax + t * dx, y: ay + t * dy };
}

// ─── Doors ────────────────────────────────────────────────────────────────────
// One click toggles one grid cell of one wall, so a revealed room shows where its exits are.
// Nothing to size and nothing to edit: every door is one cell, and a second click closes it.

const DOOR_HIT_PX = 8;

function doorCellSize() { return gridSize > 0 ? gridSize : 0; }

// Click-to-toggle, so removing has to be tested before placing or a click on a door would stack a
// second one on top of it.
// ⚠ Toggling is decided by CELL, never by whether the click hit a door's rectangle: a boundary
// click belongs to two rectangles and to neither, and the tool ticks those boundaries.
// ⚠ EVERY room whose wall is under the click is a candidate, not just the nearest — two rooms
// share a doorway's wall, so one spot could otherwise hold two doors stacked exactly. A revealed
// room is preferred, because a door on a shrouded one draws nothing and reads as a dead click.
function doorMouseDown(mapX, mapY) {
  const cell = doorCellSize();
  if (!(cell > 0)) return;
  const slack = DOOR_HIT_PX / zoom;
  const size = doorSizeForCell(cell, doorWidthPct, doorDepthPct);

  const cands = [];
  for (const poly of polygons) {
    if (poly.vertices.length < 3) continue;
    const near = nearestOutlinePoint(poly.vertices, mapX, mapY, slack * 2);
    if (!near) continue;
    const door = doorCellSnap(poly.vertices, near.edge, mapX, mapY, cell,
                              gridOffsetX, gridOffsetY, gridMode === 'square');
    if (door) cands.push({ poly, door, dist: near.dist });
  }
  if (!cands.length) return;

  for (const c of cands) {
    const doors = c.poly.doors;
    if (!doors || !doors.length) continue;
    const centre = doorPoint(c.poly.vertices, c.door);
    let hit = doors.findIndex(d => {
      if (d.edge !== c.door.edge || !centre) return false;
      const p = doorPoint(c.poly.vertices, d);
      return p && Math.hypot(p.x - centre.x, p.y - centre.y) < cell * 0.25;
    });
    // A door placed before the grid changed no longer sits on a cell centre, so pointing straight
    // at it is the only way left to take it away.
    if (hit < 0) hit = doors.findIndex(d =>
      pointInDoorNotch(c.poly.vertices, d, size.width, size.depth, mapX, mapY, slack));
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

// `dimmed` is the list the placement mode does NOT name. It keeps a faint outline and loses its
// vertex dots, because a handle you cannot grab is chrome that lies.
function drawPolyOutline(poly, isSelected, selectedVertIdx, dimmed) {
  const verts = poly.vertices;
  if (verts.length < 2) return;
  cursorCtx.save();
  // 0.3 was tried and disappeared entirely over the darker half of a map — "faint" has to stay
  // above "gone" on ground the DM did not choose.
  if (dimmed) cursorCtx.globalAlpha = 0.45;

  // Three fog states, three colours, from the shared POLY_EDGE_COLORS table, so a room being drawn
  // and the saved room match. A selected room is always gold.
  // `material` tells an effect from a room, and an effect's colour family can never read as a
  // fourth fog state.
  const edgeColor = isSelected
    ? POLY_EDGE_SELECTED
    : (poly.material ? EFFECT_EDGE_COLOR
                     : (POLY_EDGE_COLORS[poly.mode] || POLY_EDGE_COLORS.shroud));

  // Build screen-space vertex array
  const sv = verts.map(v => { const s = toScreen(v.x, v.y); return { x: s.sx, y: s.sy }; });

  // Outline (rounded when cornerRadius > 0)
  cursorCtx.strokeStyle = edgeColor;
  cursorCtx.lineWidth   = isSelected ? 2.5 : 1.5;
  cursorCtx.setLineDash(isSelected ? [] : [7, 4]);
  cursorCtx.shadowColor = edgeColor;
  cursorCtx.shadowBlur  = isSelected ? 10 : 6;
  cursorCtx.beginPath();
  const cr = (poly.cornerRadius || 0) * zoom;
  const pvR = poly.cornerRadii ? poly.cornerRadii.map(rv => (rv != null ? rv : (poly.cornerRadius || 0)) * zoom) : null;
  buildRoundedPolyPath(cursorCtx, sv, cr, pvR);
  cursorCtx.stroke();

  if (dimmed) { cursorCtx.restore(); return; }

  // Vertex dots — always at actual vertex positions regardless of corner rounding
  cursorCtx.setLineDash([]);
  for (let i = 0; i < sv.length; i++) {
    const { x, y } = sv[i];
    const isSelVert = isSelected && i === selectedVertIdx;
    const r = isSelVert ? 7 : (isSelected ? 5 : 4);
    cursorCtx.shadowColor = isSelVert ? '#60a0ff' : edgeColor;
    cursorCtx.shadowBlur  = isSelVert ? 14 : 6;
    cursorCtx.beginPath();
    cursorCtx.arc(x, y, r, 0, Math.PI * 2);
    cursorCtx.fillStyle = isSelVert ? '#ffffff' : (isSelected ? POLY_EDGE_SELECTED : 'rgba(255,255,255,0.9)');
    cursorCtx.fill();
    cursorCtx.shadowBlur  = 0;
    cursorCtx.strokeStyle = isSelVert ? '#4080ff' : (isSelected ? 'rgba(255,255,255,0.5)' : edgeColor);
    cursorCtx.lineWidth   = isSelVert ? 2 : 1.5;
    cursorCtx.stroke();
  }

  cursorCtx.restore();
}

function drawActivePolyPreview(screenX, screenY) {
  const verts = activePolygon.vertices;
  if (verts.length === 0) return;
  const mode = activePolygon.mode || tool;
  // Same colours drawPolyOutline reads, so closing the polygon changes only the line's WEIGHT
  // (2px solid in progress → 1.5px dashed once saved), never its colour.
  const edgeColor = placeMode === 'effects'
    ? EFFECT_EDGE_COLOR
    : (POLY_EDGE_COLORS[mode] || POLY_EDGE_COLORS.shroud);
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

  // Close-target halo (first vertex, gold glow when >=3 verts)
  if (verts.length >= 3) {
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

  // Vertex dots
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
      selectedPolygonId = null;
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

  if (shape === 'select') {
    // Priority: vertex on selected poly → edge on selected poly → any poly interior → deselect
    const r = container.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;

    if (selectedPolygonId != null) {
      const selPoly = findActiveShape();
      if (selPoly) {
        // 1. Vertex hit
        const vi = findVertexAt(selPoly, raw.x, raw.y);
        if (vi >= 0) {
          armDragUndo();
          selectedVertexIndex = vi;
          isDraggingVertex = true;
          vertexDragOrigVerts = selPoly.vertices.map(v => ({ x: v.x, y: v.y }));
          drawCursor(sx, sy);
          return;
        }
        // 2. Edge hit
        const ei = findEdgeAt(selPoly, raw.x, raw.y);
        if (ei >= 0) {
          armDragUndo();
          isDraggingEdge = true;
          edgeDragIndex = ei;
          edgeDragStartMapX = raw.x;
          edgeDragStartMapY = raw.y;
          edgeDragOrigVerts = selPoly.vertices.map(v => ({ x: v.x, y: v.y }));
          drawCursor(sx, sy);
          return;
        }
      }
    }

    // 3. Interior hit — select polygon and start whole-poly drag
    const hit = findPolygonAt(raw.x, raw.y);
    if (hit) {
      if (hit.id !== selectedPolygonId) { selectedVertexIndex = -1; }
      armDragUndo();
      selectedPolygonId = hit.id;
      isDraggingPolygon = true;
      polygonActuallyMoved = false;
      dragStartMapX = raw.x;
      dragStartMapY = raw.y;
      dragOrigVerts = hit.vertices.map(v => ({ x: v.x, y: v.y }));
    } else {
      selectedPolygonId = null;
      selectedVertexIndex = -1;
    }
    drawCursor(sx, sy);
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
  if (shape === 'select' && !isDraggingPolygon && !isDraggingVertex && !isDraggingEdge) {
    const selPoly = findActiveShape();
    if (selPoly) {
      if (findVertexAt(selPoly, pos.x, pos.y) >= 0) container.style.cursor = 'pointer';
      else if (findEdgeAt(selPoly, pos.x, pos.y) >= 0) container.style.cursor = 'grab';
      else container.style.cursor = findPolygonAt(pos.x, pos.y) ? 'move' : 'default';
    } else {
      container.style.cursor = findPolygonAt(pos.x, pos.y) ? 'move' : 'default';
    }
  }

  if (isDraggingVertex && selectedPolygonId != null) {
    const poly = findActiveShape();
    if (poly && selectedVertexIndex >= 0 && selectedVertexIndex < poly.vertices.length) {
      const n    = poly.vertices.length;
      const prev = poly.vertices[(selectedVertexIndex - 1 + n) % n];
      const next = poly.vertices[(selectedVertexIndex + 1) % n];
      // Straighten against BOTH ring neighbours, so either adjoining wall can go square.
      const p = axisLock ? snapToAxis(pos, [prev, next], AXIS_LOCK_PX / zoom) : pos;
      const VERT_EPSILON = 0.5; // map units — prevents coincident/zero-length edges
      if (Math.hypot(p.x - prev.x, p.y - prev.y) >= VERT_EPSILON &&
          Math.hypot(p.x - next.x, p.y - next.y) >= VERT_EPSILON) {
        pushDragUndo();
        poly.vertices[selectedVertexIndex] = { x: p.x, y: p.y };
        shapeGeometryChanged();
        fogDirty = true;
        scheduleRender();
      }
      drawCursor(screenX, screenY);
    }
    return;
  }

  if (isDraggingEdge && selectedPolygonId != null) {
    const poly = findActiveShape();
    if (poly && edgeDragOrigVerts) {
      const n = poly.vertices.length;
      const a = edgeDragOrigVerts[edgeDragIndex];
      const b = edgeDragOrigVerts[(edgeDragIndex + 1) % n];
      const edx = b.x - a.x, edy = b.y - a.y;
      const len = Math.hypot(edx, edy);
      if (len > 0) {
        const nx = -edy / len, ny = edx / len;
        const proj = (pos.x - edgeDragStartMapX) * nx + (pos.y - edgeDragStartMapY) * ny;
        pushDragUndo();
        poly.vertices[edgeDragIndex]           = { x: a.x + nx * proj, y: a.y + ny * proj };
        poly.vertices[(edgeDragIndex + 1) % n] = { x: b.x + nx * proj, y: b.y + ny * proj };
      }
      shapeGeometryChanged();
      drawCursor(screenX, screenY);
      fogDirty = true;
      scheduleRender();
    }
    return;
  }

  if (isDraggingPolygon && selectedPolygonId != null) {
    const dx = pos.x - dragStartMapX;
    const dy = pos.y - dragStartMapY;
    const poly = findActiveShape();
    if (poly) {
      pushDragUndo();
      poly.vertices = dragOrigVerts.map(v => ({ x: v.x + dx, y: v.y + dy }));
      polygonActuallyMoved = true;
      shapeGeometryChanged();
      fogDirty = true;
      scheduleRender();
    }
    return;
  }

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
  if (isDraggingVertex) {
    isDraggingVertex = false;
    vertexDragOrigVerts = null;
    commitShapeDrag();
    drawCursor(lastScreenX, lastScreenY);   // re-place the card against the reshaped shape
    return;
  }

  if (isDraggingEdge) {
    isDraggingEdge = false;
    edgeDragOrigVerts = null;
    commitShapeDrag();
    drawCursor(lastScreenX, lastScreenY);   // re-place the card against the reshaped shape
    return;
  }

  if (isDraggingPolygon) {
    isDraggingPolygon = false;
    dragOrigVerts = null;
    if (polygonActuallyMoved) commitShapeDrag();
    return;
  }

  if (shape === 'poly' || shape === 'select') return;

  if (!isDrawing) return;
  isDrawing = false;
  if (!isPlayer) pixiSetFogBrushing(false);
  lastMapX = lastMapY = null;
  if (shape === 'rect') {
    const rw = Math.abs(pos.x - rectStartX), rh = Math.abs(pos.y - rectStartY);
    if (rw > 2 && rh > 2) {
      const x1 = Math.min(rectStartX, pos.x), y1 = Math.min(rectStartY, pos.y);
      const x2 = Math.max(rectStartX, pos.x), y2 = Math.max(rectStartY, pos.y);
      commitDrawnShape([{x:x1,y:y1},{x:x2,y:y1},{x:x2,y:y2},{x:x1,y:y2}]);
    }
    drawCursor(null, null);
  }
  if (shape === 'cone' && coneApex) {
    const verts = coneVertices(coneApex, pos, axisLock ? CONE_SNAP_DEG : 0);
    // The same 2px floor the other shapes use, so a click that was meant as a deselect does
    // not leave a sliver of a cone behind.
    if (verts && Math.hypot(pos.x - coneApex.x, pos.y - coneApex.y) > 2) commitDrawnShape(verts);
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
      commitDrawnShape(verts);
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
  if (isDraggingVertex) {
    isDraggingVertex = false;
    vertexDragOrigVerts = null;
    commitShapeDrag();
    drawCursor(lastScreenX, lastScreenY);   // re-place the card against the reshaped shape
  }
  if (isDraggingEdge) {
    isDraggingEdge = false;
    edgeDragOrigVerts = null;
    commitShapeDrag();
    drawCursor(lastScreenX, lastScreenY);   // re-place the card against the reshaped shape
  }
  if (isDraggingPolygon) {
    isDraggingPolygon = false;
    dragOrigVerts = null;
    if (polygonActuallyMoved) commitShapeDrag();
  }
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

function toolDblClick(raw, e) {
  const poly = findActiveShape();
  if (!poly) return;
  if (findVertexAt(poly, raw.x, raw.y) >= 0) return; // don't insert on existing vertex
  const ei = findEdgeAt(poly, raw.x, raw.y);
  if (ei < 0) return;
  pushUndo();
  const a = poly.vertices[ei], b = poly.vertices[(ei + 1) % poly.vertices.length];
  const pt = closestPointOnSegment(raw.x, raw.y, a.x, a.y, b.x, b.y);
  poly.vertices.splice(ei + 1, 0, pt);
  if (poly.cornerRadii) poly.cornerRadii.splice(ei + 1, 0, null);
  if (poly.doors) poly.doors = remapDoorsForVertexChange(poly.doors, ei, 1);
  selectedVertexIndex = ei + 1;
  shapeGeometryChanged();
  persistShapeEdit();
  fogDirty = true;
  scheduleRender();
  drawCursor(lastScreenX, lastScreenY);
}

// ─── Polygon lifecycle ────────────────────────────────────────────────────────

function closeActivePolygon() {
  if (!activePolygon || activePolygon.vertices.length < 3) { activePolygon = null; drawCursor(null, null); return; }
  const verts = activePolygon.vertices;
  const mode  = activePolygon.mode;
  activePolygon = null;
  const shape = commitDrawnShape(verts);
  drawCursor(null, null);
  // The polygon tool paints its own fog below rather than going through toolMouseUp's block,
  // so the flag that block reads must not be left set for the next release to act on.
  fogModifiedThisStroke = false;
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

// startFogTransition() takes no argument here — the polygon is already gone, so there's
// no surviving mode to crossfade towards.
function deletePolygonById(id) {
  if (id == null) return;
  pushUndo();
  if (placeMode === 'effects') {
    effects = effects.filter(e => e.id !== id);
    if (selectedPolygonId === id) { selectedPolygonId = null; selectedVertexIndex = -1; }
    effectsChanged();
    drawCursor(null, null);
    scheduleAutoSync();   // rides the Auto/Manual gate exactly as a fog edit does
    scheduleAutoSave();
    scheduleRender();
    return;
  }
  polygons = polygons.filter(p => p.id !== id);
  if (selectedPolygonId === id) { selectedPolygonId = null; selectedVertexIndex = -1; }
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

// Set one polygon's fog mode by id — the room card's fog pill names the room it acts on, so it
// does not use the selection-keyed toggle below. scheduleAutoSync() is what reaches the TV, and it
// persists too. ⚠ Never refresh the whole card here: a rebuild steals focus from the name and
// description fields mid-edit, so the pill updates in place.
// ⚠ Fog states belong to rooms, so this and the T-key cycle refuse in Effects mode rather than
// resolving an effect's id against `polygons`.
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
  module.exports = { pointInPolygon, distPointToSegment, segmentsIntersect };
}
