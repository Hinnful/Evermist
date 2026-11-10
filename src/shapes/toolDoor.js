'use strict';
// toolDoor.js — the Door tool: where a click lands on a wall, the notch it leaves, and the rebuild
// a grid change forces on every door.

// One click toggles one grid cell of one wall, so a revealed room shows where its exits are.
// Nothing to size and nothing to edit: every door is one cell, and a second click closes it.

const DOOR_HIT_PX = 8;

function doorCellSize() { return gridSize > 0 ? doorCellForGrid(gridSize, gridMode) : 0; }

// The one decision both the click and the hover ghost read; see doorClickPlan.
function doorPlanAt(mapX, mapY) {
  const cell = doorCellSize();
  if (!(cell > 0)) return null;
  return doorClickPlan(activeShapeList(), mapX, mapY, {
    cell, slack: DOOR_HIT_PX / zoom, size: doorSizeForCell(cell, doorWidthPct, doorDepthPct),
    offsetX: gridOffsetX, offsetY: gridOffsetY, square: gridMode === 'square',
  });
}

function doorMouseDown(mapX, mapY) {
  const plan = doorPlanAt(mapX, mapY);
  if (!plan) return;
  pushUndo();
  if (plan.action === 'remove') {
    // Replaced, never spliced: pushUndo copies a room shallowly, so its snapshot holds THIS array
    // and an in-place edit would rewrite the undo state too.
    plan.poly.doors = plan.poly.doors.filter((_, k) => k !== plan.index);
  } else {
    plan.poly.doors = (plan.poly.doors || []).concat([plan.door]);
  }
  commitDoorChange(plan.action === 'remove');
}

// Hover ghost: the door a click here would place, half-strength, in the outline style of a placed
// one. Nothing where a click would remove a door or hit no wall. DM-only: it paints the cursor canvas.
function drawDoorGhost(screenX, screenY) {
  if (screenX == null || isPlayer || shape !== 'door' || placeMode !== 'rooms') return;
  const plan = doorPlanAt((screenX - panX) / zoom, (screenY - panY) / zoom);
  if (!plan || plan.action !== 'add') return;
  const size = doorSizeForCell(doorCellSize(), doorWidthPct, doorDepthPct);
  const c = doorNotchCorners(plan.poly, plan.door, size.width, size.depth, size.depth);
  if (!c) return;
  cursorCtx.save();
  cursorCtx.globalAlpha = 0.5;
  cursorCtx.lineWidth = 1.5;
  cursorCtx.strokeStyle = 'rgba(255,255,255,0.95)';
  cursorCtx.fillStyle = 'rgba(255,255,255,0.25)';
  cursorCtx.beginPath();
  for (const [i, k] of ['innerL', 'outerL', 'outerR', 'innerR'].entries()) {
    const x = c[k].x * zoom + panX, y = c[k].y * zoom + panY;
    if (i === 0) cursorCtx.moveTo(x, y); else cursorCtx.lineTo(x, y);
  }
  cursorCtx.closePath();
  cursorCtx.fill();
  cursorCtx.stroke();
  cursorCtx.restore();
}

// Every door the fog carves, for the TV's light: its notch's four corners in map px and its width.
// Rooms never reach the Player, so the notches go instead. Only a door doorGlows passes is sent.
function doorLightQuads() {
  const size = doorSizeForCell(doorCellSize(), doorWidthPct, doorDepthPct);
  if (!(size.width > 0) || !(size.depth > 0)) return [];
  const tol = gridSize * DOOR_SHARED_WALL_TOL, r = v => Math.round(v * 10) / 10;
  const out = [];
  for (const poly of polygons) {
    if (!poly.doors || poly.vertices.length < 3) continue;
    for (const d of poly.doors) {
      if (!doorGlows(doorPoint(poly, d), polygons, tol)) continue;
      const c = doorNotchCorners(poly, d, size.width, size.depth, size.depth);
      if (!c) continue;
      const pts = [c.innerL, c.outerL, c.outerR, c.innerR];
      out.push({ w: r(Math.hypot(c.outerR.x - c.outerL.x, c.outerR.y - c.outerL.y)),
                 pts: pts.flatMap(p => [r(p.x), r(p.y)]) });
    }
  }
  return out;
}

// The fade snapshots the old fog, so it starts before the rebuild. Removing a door closes fog.
function commitDoorChange(closes) {
  startFogTransition(closes);
  rebuildFogFromPolygons();
  rebuildFogEffect();
  fogDirty = true;
  scheduleRender();
  scheduleAutoSync(true);
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
