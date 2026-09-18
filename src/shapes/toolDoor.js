'use strict';
// toolDoor.js — the Door tool: where a click lands on a wall, the notch it leaves, and the rebuild
// a grid change forces on every door.

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
