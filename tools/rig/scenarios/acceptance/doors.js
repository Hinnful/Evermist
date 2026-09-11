'use strict';

// doors.js — MARKING AN EXIT BY HAND.
//
// THE GOAL OF THIS FEATURE: the DM clicks a room's wall and one grid cell of it opens, so the
// players see where the exits are without the room behind being given away. Clicking the mark
// again takes it back. Every check below serves that sentence.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks directly beneath it, in order.
//
//   A. A click opens the cell the DM aimed at, on a room whose corners sit off the grid lines.
//      The cells come from the WORLD grid, so a room drawn anywhere keeps its doors on the
//      squares the map is played on.
//   B. A second click on the same cell closes the door; a click on the cell beside it opens a
//      second one, and the two together are a doorway two cells wide.
//   C. A half-shrouded room shows its doors at half density. A door beside a shrouded neighbour
//      is still half, never a clear hole into the dark.
//   D. Two shrouded rooms show no door at all, so a marked exit never gives away a room the
//      players have not reached.
//   E. A door stays on its wall when a vertex is added to the room or taken away.
//
// ⚠ THE DOORS ARE PLACED BY HAND HERE, AND THAT IS THE WHOLE POINT OF THE FILE. floor-plan.js
// criterion K covers a DERIVED door - one the import placed from a .dd2vtt - and the two paths
// share only the geometry. Everything the DM does with the Door tool is here.
//
// ⚠ THE ROOM IS DRAWN OFF THE GRID LINES ON PURPOSE. `doorCellBounds` projects the world grid
// onto the wall, so a wall starting at 450 still breaks at 500, 600, 700. Measuring cells from
// the room's own corner instead would put this file's first door at 600 rather than 650, and
// every check below is written so those two answers cannot both pass.
//
// ⚠ THE CORNERS COME FROM THE DRAG, SO THEY ARE READ BACK, NEVER ASSUMED. `mouseAt` builds each
// event on a whole client pixel, so a wall aimed at x=800 arrives within a pixel of it in map
// units. The door's position ALONG the wall is world-grid arithmetic and exact; its position
// ACROSS the wall is the drag's, so that half is held against the vertex the app recorded.
//
// ⚠ THE NOTCH IS DEEPENED BEFORE ANY FOG IS SAMPLED. At the default 10% it is 2.5px on the fog
// canvas, which is thinner than the feather, so a sample either side of the wall would be reading
// the blur rather than the door.
//
// ⚠ THE MAP IS ANIMATED, AND EVERY ACCEPTANCE FILE'S IS. Animated is the only kind the DM
// ever uses, so a suite running on still PNGs proved the app worked in a case that never
// happens. `tableMap` (tools/rig/fixtures.js) records the clip once per run and caches it by
// size. Do not swap it back to `stillMap`; smoke.js is the one file that wants both.

const MAP_W = 2400, MAP_H = 1500;
const CELL = 100;

// The two rooms, aimed at. Every corner but the shared wall sits off a grid line.
const LEFT  = { x1: 250, y1: 450, x2: 800, y2: 950 };
const RIGHT = { x1: 800, y1: 450, x2: 1350, y2: 950 };

// Where the clicks land, and what the world grid says they must open.
const FIRST_CLICK_Y  = 630, FIRST_DOOR_Y  = 650;   // cell 600..700
const SECOND_CLICK_Y = 730, SECOND_DOOR_Y = 750;   // cell 700..800
// What a cell measured from the room's own corner at 450 would have answered instead.
const CORNER_RELATIVE_Y = 600;

const HELPERS = `
globalThis.__rigMouse = (type, mx, my) => {
  const r = container.getBoundingClientRect();
  container.dispatchEvent(new MouseEvent(type, {
    clientX: mx * zoom + panX + r.left, clientY: my * zoom + panY + r.top,
    bubbles: true, cancelable: true, button: 0,
  }));
};
globalThis.__rigDrag = (x1, y1, x2, y2) => {
  __rigMouse('mousedown', x1, y1); __rigMouse('mousemove', (x1+x2)/2, (y1+y2)/2);
  __rigMouse('mousemove', x2, y2); __rigMouse('mouseup', x2, y2);
};
globalThis.__rigClick = (mx, my) => { __rigMouse('mousedown', mx, my); __rigMouse('mouseup', mx, my); };
globalThis.__rigDbl = (mx, my) => {
  const r = container.getBoundingClientRect();
  container.dispatchEvent(new MouseEvent('dblclick', {
    clientX: mx * zoom + panX + r.left, clientY: my * zoom + panY + r.top,
    bubbles: true, cancelable: true, button: 0,
  }));
};
globalThis.__rigKey = (k) => document.dispatchEvent(
  new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
// Alpha of the DM's own fog over one map point. 255 hidden, 0 clear.
globalThis.__rigFog = (mx, my) => fogDataCtx.getImageData(
  Math.round(mx / FOG_SCALE), Math.round(my / FOG_SCALE), 1, 1).data[3];
// A room drawn with the rectangle tool in one fog mode, returned by id — drawing leaves nothing
// selected, so the id is read off the end of the list.
globalThis.__rigRoom = (mode, x1, y1, x2, y2) => {
  setShapeOp('new');
  setShape('rect');
  document.getElementById('btn-' + mode).click();
  __rigDrag(x1, y1, x2, y2);
  setShape('select');
  return polygons[polygons.length - 1].id;
};
globalThis.__rigById = (id) => polygons.find(p => p.id === id);
// Every door on the map in map pixels, whichever room stores it, with the wall it sits on.
globalThis.__rigDoors = () => polygons.flatMap(p => (p.doors || []).map(d => {
  const c = doorPoint(p.vertices, d);
  return { room: p.id, edge: d.edge, x: c ? +c.x.toFixed(1) : null, y: c ? +c.y.toFixed(1) : null };
}));
globalThis.__rigSetMode = (id, mode) => {
  __rigById(id).mode = mode;
  rebuildFogFromPolygons(); rebuildFogEffect();
  fogDirty = true; scheduleRender(); scheduleAutoSync();
  return 0;
};
0`;

// The same fog reading on the Player. Its fogDataCanvas is the map it was sent.
const TV_FOG = `((mx, my) => fogDataCtx.getImageData(
  Math.round(mx / FOG_SCALE), Math.round(my / FOG_SCALE), 1, 1).data[3])`;

module.exports = async function doorsFeature(rig) {
  const dm = rig.dm;

  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H });
  await dm.evaluate('createNewScene(' + (await rig.fixtures.asFileExpr(dm, map)) + ')', 120000);
  await dm.waitFor('currentScene && currentScene.mapType === "video" && mapWidth === ' + MAP_W,
                   120000, 'the map to load on the DM');
  await dm.evaluate(HELPERS);

  // The grid the doors are cut from. Set BEFORE anything is placed: every door resizes with the
  // cell, so changing it afterwards would move what the checks below measure.
  await dm.evaluate('(() => { const s = document.getElementById("grid-size"); s.value = ' + CELL +
    '; s.dispatchEvent(new Event("input", { bubbles: true })); return 0; })()');
  const gridState = await dm.evaluate('({ cell: gridSize, mode: gridMode, ox: gridOffsetX, oy: gridOffsetY, snap: snapToGrid })');
  rig.check(gridState.cell === CELL && gridState.mode === 'square' &&
            gridState.ox === 0 && gridState.oy === 0,
            'the grid is not the square ' + CELL + 'px one every door position below is derived ' +
            'from: ' + JSON.stringify(gridState));
  // ⚠ Snap would pull the room's corners onto the grid lines and criterion A would then pass
  // whichever way the cells are measured.
  rig.check(gridState.snap === false,
            'snap-to-grid is on, so the room cannot be drawn off the grid lines and A proves nothing');

  await dm.evaluate('setPlaceMode("rooms"); 0');
  const leftId  = await dm.evaluate('__rigRoom("reveal", ' + [LEFT.x1, LEFT.y1, LEFT.x2, LEFT.y2].join(',') + ')');
  const rightId = await dm.evaluate('__rigRoom("shroud", ' + [RIGHT.x1, RIGHT.y1, RIGHT.x2, RIGHT.y2].join(',') + ')');

  // The wall the doors go on, as the app recorded it. Its x is the drag's and its y-span decides
  // whether the cell centres below are clamped, so both are read rather than assumed.
  const wall = await dm.evaluate(`(() => {
    const v = __rigById(${JSON.stringify(leftId)}).vertices;
    const xs = v.map(p => p.x), ys = v.map(p => p.y);
    return { right: Math.max(...xs), left: Math.min(...xs),
             top: Math.min(...ys), bottom: Math.max(...ys), n: v.length };
  })()`);
  rig.note('the left room: x ' + wall.left.toFixed(1) + '..' + wall.right.toFixed(1) +
           ', y ' + wall.top.toFixed(1) + '..' + wall.bottom.toFixed(1));
  rig.check(wall.n === 4, 'the left room is not a rectangle, so its walls are not where the ' +
                          'clicks below aim: ' + wall.n + ' vertices');
  // The corner has to be off a grid line for A to mean anything, and the wall has to be long
  // enough that neither cell centre is clamped in from its end.
  rig.check(Math.abs(wall.top % CELL) > 4 && Math.abs(wall.left % CELL) > 4,
            'the room landed on the grid lines after all (top ' + wall.top + ', left ' + wall.left +
            '), so a door measured from its own corner would land in the same place as one ' +
            'measured from the world grid');

  // ── A. The click opens the cell the world grid says it did ────────────────
  await dm.evaluate('setShape("door"); 0');
  rig.check(await dm.evaluate('shape') === 'door', 'the Door tool did not take');
  await dm.evaluate('__rigClick(' + wall.right + ', ' + FIRST_CLICK_Y + ')');

  const first = await dm.evaluate('__rigDoors()');
  rig.note('after one click: ' + JSON.stringify(first));
  rig.check(first.length === 1,
            'clicking a room wall with the Door tool did not open exactly one door: ' +
            JSON.stringify(first));
  rig.check(first.length === 1 && first[0].room === leftId,
            'the door went to the shrouded room rather than the revealed one under the click, ' +
            'where it draws nothing and the click reads as dead: ' + JSON.stringify(first));
  rig.check(first.length === 1 && Math.abs(first[0].y - FIRST_DOOR_Y) <= 2,
            'the door did not land in the cell that was clicked — it is at y ' +
            (first.length ? first[0].y : 'nowhere') + ' and the world grid puts that cell at ' +
            FIRST_DOOR_Y + (first.length && Math.abs(first[0].y - CORNER_RELATIVE_Y) <= 2
              ? ', which is the cell counted from the room\'s own corner instead' : ''));
  // Across the wall it is the drag's number, so it is held against the vertex the app recorded.
  rig.check(first.length === 1 && Math.abs(first[0].x - wall.right) <= 1,
            'the door is not on the wall it was clicked on: x ' + (first.length ? first[0].x : '?') +
            ' against a wall at ' + wall.right.toFixed(1));

  // ── B. Click it again to close, click beside it to widen ──────────────────
  // A different point in the SAME cell, so what closes the door is the cell and not the pixel.
  await dm.evaluate('__rigClick(' + wall.right + ', ' + (FIRST_CLICK_Y + 40) + ')');
  const closed = await dm.evaluate('__rigDoors()');
  rig.check(closed.length === 0,
            'a second click in the same cell did not close the door, so the DM cannot take one ' +
            'back: ' + JSON.stringify(closed));

  await dm.evaluate('__rigClick(' + wall.right + ', ' + FIRST_CLICK_Y + ')');
  await dm.evaluate('__rigClick(' + wall.right + ', ' + SECOND_CLICK_Y + ')');
  const widened = await dm.evaluate('__rigDoors()');
  rig.note('after the cell beside it: ' + JSON.stringify(widened));
  rig.check(widened.length === 2,
            'clicking the cell beside a door did not open a second one, so a doorway cannot be ' +
            'made wider than one cell: ' + JSON.stringify(widened));
  const ys = widened.map(d => d.y).sort((a, b) => a - b);
  rig.check(widened.length === 2 &&
            Math.abs(ys[0] - FIRST_DOOR_Y) <= 2 && Math.abs(ys[1] - SECOND_DOOR_Y) <= 2,
            'the two doors are not in the two cells that were clicked: ' + JSON.stringify(ys));
  rig.check(widened.length === 2 && widened[0].edge === widened[1].edge,
            'the two doors ended up on different walls, so they do not make one opening: ' +
            JSON.stringify(widened));

  // Back to one door for the fog readings, so every sample below has one place to look.
  await dm.evaluate('__rigClick(' + wall.right + ', ' + SECOND_CLICK_Y + ')');
  rig.check((await dm.evaluate('__rigDoors()')).length === 1,
            'the map did not come back to one door, so the fog samples below read the wrong thing');

  // ⚠ DEEPENED FIRST. 10% of a cell is 2.5px on the fog canvas and thinner than the feather.
  await dm.evaluate('doorDepthPct = 60; rebuildFogFromPolygons(); rebuildFogEffect();' +
    ' fogDirty = true; scheduleRender(); scheduleAutoSync(); 0');

  // Two points, both inside the SHROUDED right room: at the doorway and well away from it. The
  // second is what says that room is dark at all, so a clear reading at the door is a hole rather
  // than a room nothing ever shrouded.
  const atDoorX = wall.right + 42;
  // Derived from the wall the app recorded, like every other coordinate here. A fixed number
  // would fall outside the room the day the map or the drag changes, read clear, and blame the
  // app for a point this file picked.
  const AWAY_Y = Math.round(wall.bottom - CELL * 0.7);

  const player = await rig.player();
  await player.waitFor('!!fogDataCanvas', 45000, 'the Player to receive the map');
  // ⚠ A fresh map arrives under a full-fog cover that punches nothing, so every sample reads
  // opaque until it lifts however much was carved.
  await player.waitFor('fogCoverT === 0', 45000, 'the scene cover to lift on the Player');

  const tvAt = async (x, y) => player.evaluate(TV_FOG + '(' + x + ', ' + y + ')');
  const settleTv = async (expr) => { try { await player.waitFor(expr, 20000, 'the fog to reach the Player'); } catch (_) {} };

  // The revealed neighbour first: this is the "clear hole" the other two are held against.
  await settleTv(TV_FOG + '(' + atDoorX + ', ' + FIRST_DOOR_Y + ') < 60');
  const openAtDoor = await tvAt(atDoorX, FIRST_DOOR_Y);
  const openAway   = await tvAt(atDoorX, AWAY_Y);
  rig.note('revealed neighbour — at the door ' + openAtDoor + ', away from it ' + openAway);
  rig.check(openAway > 200,
            'the shrouded room reads clear away from the door, so no sample at the door can ' +
            'prove anything: alpha ' + openAway);
  rig.check(openAtDoor < 60,
            'a door beside a revealed room carved nothing on the Player, so the TV shows an ' +
            'unbroken wall where the DM marked an exit: alpha ' + openAtDoor);

  // ── C. Half-shrouded shows the door at half density ───────────────────────
  // The neighbour stays SHROUDED. A door resolves to the most revealed room whose wall runs
  // through it, so half beside dark must still be half and never a hole.
  await dm.evaluate('__rigSetMode(' + JSON.stringify(leftId) + ', "half")');
  await settleTv(TV_FOG + '(' + atDoorX + ', ' + FIRST_DOOR_Y + ') > 60');
  const halfAtDoor = await tvAt(atDoorX, FIRST_DOOR_Y);
  const halfExpected = await dm.evaluate('Math.round(fogHalfAlpha * 255)');
  rig.note('half-shrouded — at the door ' + halfAtDoor + ', half density is about ' + halfExpected);
  rig.check(halfAtDoor > 40,
            'a half-shrouded room cut a clear hole at its door instead of a dimmed one, so the ' +
            'players see straight through it: alpha ' + halfAtDoor);
  rig.check(halfAtDoor < 210,
            'the door of a half-shrouded room is as dark as the wall around it, so the exit is ' +
            'not marked at all: alpha ' + halfAtDoor);

  // ── D. Two shrouded rooms show nothing ────────────────────────────────────
  await dm.evaluate('__rigSetMode(' + JSON.stringify(leftId) + ', "shroud")');
  await settleTv(TV_FOG + '(' + atDoorX + ', ' + FIRST_DOOR_Y + ') > 210');
  const darkAtDoor = await tvAt(atDoorX, FIRST_DOOR_Y);
  const darkAway   = await tvAt(atDoorX, AWAY_Y);
  rig.note('both rooms shrouded — at the door ' + darkAtDoor + ', away from it ' + darkAway);
  // ⚠ THE PLAIN WALL IS CHECKED TOO, for the reason the revealed case gives. "Opaque at the door"
  // is true of any canvas that stopped updating, so on its own it cannot tell a door that is
  // correctly not carved from a Player that never heard about the change.
  rig.check(darkAway > 210,
            'the fog is not opaque away from the door either, so the reading at the door says ' +
            'nothing about the door: alpha ' + darkAway);
  rig.check(darkAtDoor >= darkAway - 5,
            'a door between two shrouded rooms is still carved, which shows the players a way ' +
            'into a room they have not reached: alpha ' + darkAtDoor + ' against ' + darkAway +
            ' on the plain wall beside it');
  rig.check(await dm.evaluate('__rigDoors()').then(d => d.length === 1),
            'the door itself was lost when the rooms went dark, so it will not come back when ' +
            'the room is revealed');

  // ── E. The door stays on its wall when the room gains or loses a vertex ───
  await dm.evaluate('__rigSetMode(' + JSON.stringify(leftId) + ', "reveal")');
  const before = (await dm.evaluate('__rigDoors()'))[0];

  // Selected the way the DM does it, then a double-click on a DIFFERENT wall — the TOP one.
  // ⚠ IT HAS TO BE A WALL EARLIER IN THE RING THAN THE DOOR'S. A rectangle is traced top, right,
  // bottom, left, the door is on the right, and `remapDoorsForVertexChange` only shifts an edge
  // index ABOVE the insert. Going in at the left wall changes no index at all, so the check
  // passed with the remap deleted — it read a door nothing had asked to move.
  await dm.evaluate('setShape("select"); __rigClick(' + ((wall.left + wall.right) / 2) + ', ' +
                    ((wall.top + wall.bottom) / 2) + ')');
  rig.check(await dm.evaluate('selectedPolygonId') === leftId,
            'clicking inside the room did not select it, so no vertex can be inserted and E ' +
            'measures nothing');
  await dm.evaluate('__rigDbl(' + ((wall.left + wall.right) / 2) + ', ' + wall.top + ')');
  rig.check((await dm.evaluate('__rigDoors()'))[0].edge > before.edge,
            "the vertex went in on a wall the door's own edge index does not sit above, so the " +
            'remap has nothing to do and the two checks below cannot fail');

  const grown = await dm.evaluate('({ n: __rigById(' + JSON.stringify(leftId) + ').vertices.length,' +
                                  ' doors: __rigDoors(), sel: selectedVertexIndex })');
  rig.check(grown.n === 5,
            'the double-click did not insert a vertex, so nothing was done to the room and E ' +
            'proves nothing: ' + grown.n + ' vertices');
  rig.check(grown.doors.length === 1 && Math.abs(grown.doors[0].x - before.x) <= 1 &&
            Math.abs(grown.doors[0].y - before.y) <= 1,
            'the door moved when a vertex was added elsewhere on the room — it was at ' +
            before.x + ',' + before.y + ' and is now ' + JSON.stringify(grown.doors));

  // And back out again. Delete takes the vertex the insert left selected.
  rig.check(grown.sel >= 0,
            'the insert left no vertex selected, so Delete below removes nothing and the second ' +
            'half of E measures nothing');
  await dm.evaluate('__rigKey("Delete")');
  const shrunk = await dm.evaluate('({ n: __rigById(' + JSON.stringify(leftId) + ').vertices.length,' +
                                   ' doors: __rigDoors() })');
  rig.check(shrunk.n === 4,
            'Delete did not take the vertex away, so the second half of E measures nothing: ' +
            shrunk.n + ' vertices');
  rig.check(shrunk.doors.length === 1 && Math.abs(shrunk.doors[0].x - before.x) <= 1 &&
            Math.abs(shrunk.doors[0].y - before.y) <= 1,
            'the door moved when a vertex was taken off the room — it was at ' + before.x + ',' +
            before.y + ' and is now ' + JSON.stringify(shrunk.doors));

  // ⚠ THE ROUND TRIP ABOVE CANNOT FAIL ON THE DELETE ALONE. Break the remap and the insert puts
  // the door on the wrong wall, then the delete puts it back on the right one — two wrong answers
  // that read as one right one. So the delete is run again from a room that already has the extra
  // vertex, with the door placed AFTER it: the remap then runs once, on the way out.
  await dm.evaluate('setShape("select"); __rigClick(' + ((wall.left + wall.right) / 2) + ', ' +
                    ((wall.top + wall.bottom) / 2) + ')');
  await dm.evaluate('__rigDbl(' + ((wall.left + wall.right) / 2) + ', ' + wall.top + ')');
  const sel = await dm.evaluate('selectedVertexIndex');
  // ⚠ CLEARED OUTRIGHT, never by clicking the door off. A door the section above left on the
  // wrong wall is not under this click, so the toggle would leave it there and this section would
  // then measure the earlier failure a second time instead of the delete.
  await dm.evaluate('polygons.forEach(p => { p.doors = []; });' +
                    ' rebuildFogFromPolygons(); rebuildFogEffect(); fogDirty = true; 0');
  // The door goes on with the extra vertex already in place, so its edge index is whatever the
  // five-vertex ring says — and the delete is the only thing that has to fix it.
  await dm.evaluate('setShape("door"); __rigClick(' + wall.right + ', ' + FIRST_CLICK_Y + '); 0');
  const placedLate = await dm.evaluate('__rigDoors()');
  // ⚠ WHICH ROOM HOLDS IT IS CHECKED, not only where it is. Both rooms' walls are under this
  // click and their two x values are within a pixel, so a door that landed on the RIGHT room sits
  // at the same place — and the delete below takes a vertex off the LEFT one, which could not
  // move it. The position check alone would then pass with nothing having been tested.
  rig.check(placedLate.length === 1 && placedLate[0].room === leftId &&
            Math.abs(placedLate[0].y - FIRST_DOOR_Y) <= 2,
            'the door could not be re-placed on the five-vertex left room, so the delete below ' +
            'has nothing to move: ' + JSON.stringify(placedLate));

  await dm.evaluate('setShape("select"); selectedPolygonId = ' + JSON.stringify(leftId) +
                    '; selectedVertexIndex = ' + sel + '; __rigKey("Delete")');
  const late = await dm.evaluate('({ n: __rigById(' + JSON.stringify(leftId) + ').vertices.length,' +
                                 ' doors: __rigDoors() })');
  rig.check(late.n === 4,
            'the extra vertex did not come off, so the delete-only half of E measures nothing: ' +
            late.n + ' vertices');
  rig.check(late.doors.length === 1 && Math.abs(late.doors[0].x - before.x) <= 1 &&
            Math.abs(late.doors[0].y - before.y) <= 1,
            'the door moved when a vertex was taken off the room ahead of it — it was at ' +
            before.x + ',' + before.y + ' and is now ' + JSON.stringify(late.doors));

  // ⚠ A VERTEX INSERTED ON THE DOOR'S OWN WALL IS A DIFFERENT CASE, and it is measured rather
  // than asserted. `remapDoorsForVertexChange` keeps a door on the edge it names, but that edge
  // is now half the wall it was, so the door's position along it means something else. Nothing
  // has ever said where it should end up, so this reports and does not judge.
  await dm.evaluate('setShape("select"); __rigClick(' + ((wall.left + wall.right) / 2) + ', ' +
                    ((wall.top + wall.bottom) / 2) + ')');
  await dm.evaluate('__rigDbl(' + wall.right + ', ' + (wall.top + 40) + ')');
  const split = await dm.evaluate('__rigDoors()');
  const moved = split.length === 1 ? Math.round(Math.hypot(split[0].x - before.x, split[0].y - before.y)) : null;
  rig.note('a vertex inserted on the door\'s own wall moved it ' +
           (moved == null ? 'off the map entirely' : moved + 'px') + ': ' + JSON.stringify(split));
  rig.byEye('where a door should sit after a vertex is inserted into the wall it is ON, which ' +
            'splits that wall in two. The note above says what the app does today; nothing has ' +
            'decided what it ought to do');
};
