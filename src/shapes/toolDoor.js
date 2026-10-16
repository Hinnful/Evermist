'use strict';
// toolDoor.js — the Door tool: where a click lands on a wall, the notch it leaves, and the rebuild
// a grid change forces on every door.

// One click toggles one grid cell of one wall, so a revealed room shows where its exits are.
// Nothing to size and nothing to edit: every door is one cell, and a second click closes it.

const DOOR_HIT_PX = 8;

function doorCellSize() { return gridSize > 0 ? gridSize : 0; }

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
  commitDoorChange();
}

// Hover ghost: the door a click here would place, half-strength, in the outline style of a placed
// one. Nothing where a click would remove a door or hit no wall. DM-only: it paints the cursor canvas.
function drawDoorGhost(screenX, screenY) {
  if (screenX == null || isPlayer || shape !== 'door' || placeMode !== 'rooms') return;
  const plan = doorPlanAt((screenX - panX) / zoom, (screenY - panY) / zoom);
  if (!plan || plan.action !== 'add') return;
  const size = doorSizeForCell(gridSize, doorWidthPct, doorDepthPct);
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
