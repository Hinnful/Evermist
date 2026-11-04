'use strict';

// fog-shape-leaks.js — A REVEALED ROOM CLEARS NOTHING OUTSIDE ITS OWN OUTLINE ON THE TV.
//
// THE GOAL OF THIS FEATURE: whatever shape a room has, revealing it shows the players that room
// and no ground around it.
//
// Drives src/fog/fog.js, src/rooms/vttPlan.js, src/rooms/vttHoles.js and src/rooms/floorPlan.js.
//
// THE CRITERIA ARE THIS HEADER. Each check sits under its letter.
//
//   A. A room with rounded corners, revealed, leaves the fog just outside each corner on the TV.
//   B. A room with an arm thinner than the fog's soft edge, revealed, leaves the fog beside the arm.
//   C. On a floor plan, a room standing inside a bigger room stays hidden when the bigger one is revealed.

const lib = require('../../lib');

const MAP = 2000;
const PLAN = JSON.stringify({
  resolution: { pixels_per_grid: 100, map_origin: { x: 0, y: 0 }, map_size: { x: 20, y: 20 } },
  line_of_sight: [
    [{ x: 0, y: 0 }, { x: 8, y: 0 }], [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }, { x: 0, y: 0 }],
    [{ x: 8, y: 8 }, { x: 9.5, y: 8 }], [{ x: 10.5, y: 8 }, { x: 12, y: 8 }, { x: 12, y: 12 }, { x: 8, y: 12 }, { x: 8, y: 8 }],
  ],
  portals: [{ bounds: [{ x: 8, y: 0 }, { x: 10, y: 0 }] }, { bounds: [{ x: 9.5, y: 8 }, { x: 10.5, y: 8 }] }],
});

module.exports = async function fogShapeLeaks(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: MAP, h: MAP, kind: 'still', name: 'fog-shape-leaks.png' });
  await lib.settle(dm, 'fogCoverT === 0', 30000);
  const player = await rig.player();
  await lib.settle(player, 'mapOffscreen && mapOffscreen.width === ' + MAP + ' && fogCoverT === 0', 30000);
  const tvAt = (x, y) => lib.poll(() => player.evaluate('(a => ({ a }))((' + lib.TV_FOG + ')(' + x + ',' + y + '))'), 5000).then(r => r && r.a);
  const show = async (polys) => {
    await dm.evaluate('polygons = ' + polys + '; nextPolygonId = polygons.length + 1; ' + lib.SETTLE);
    await lib.settle(player, '!fogTransRafId', 15000);
  };
  // The widest soft edge the slider allows, so every leak below is several fog pixels wide.
  await dm.evaluate('fogFeatherRadius = 24; 0');
  // The soft edge's depth in map pixels, read live: the leaks below are sized by it.
  const edge = await dm.evaluate('getScaledFeatherRadius() * FOG_SCALE');

  // ── A. Rounded corners ────────────────────────────────────────────────────
  // RED ON: the inset clear passed null per-corner radii and no room clip (fog.js) — 2026-11-04
  const R = Math.max(300, Math.ceil(edge * 6));
  await show('[{ id: 1, vertices: [{ x: 500, y: 500 }, { x: 1500, y: 500 }, { x: 1500, y: 1500 }, { x: 500, y: 1500 }],' +
    ' mode: "reveal", cornerRadius: 0, cornerRadii: [' + R + ',' + R + ',' + R + ',' + R + '], name: "Round" }]');
  // Halfway along the diagonal between where the sharp inset corner sat and the arc: outside the room.
  const arc = 500 + R - R / Math.SQRT2, inset = 500 + edge;
  const outside = Math.round((arc + inset) / 2);
  rig.check(await tvAt(1000, 1000) < 60, 'setup: the rounded room is not clear on the TV');
  const corner = await tvAt(outside, outside);
  rig.check(corner > 200, 'the TV is clear just outside a rounded corner of a revealed room: fog ' + corner + ' at ' + outside + ',' + outside);

  // ── B. An arm thinner than the soft edge ──────────────────────────────────
  // RED ON: the room clip removed from the inset clear (fog.js) — 2026-11-04
  const w = Math.max(4, Math.round(edge * 0.4));
  await show('[{ id: 1, vertices: [{ x: 400, y: 400 }, { x: 1600, y: 400 }, { x: 1600, y: ' + (400 + w) + ' },' +
    ' { x: 800, y: ' + (400 + w) + ' }, { x: 800, y: 800 }, { x: 400, y: 800 }], mode: "reveal", cornerRadius: 0, name: "Arm" }]');
  rig.check(await tvAt(600, 600) < 60, 'setup: the room with an arm is not clear on the TV');
  const below = Math.round(400 + w + (edge - w) / 2);
  const beside = await tvAt(1200, below);
  rig.check(beside > 200, 'the TV is clear beside a thin arm of a revealed room, outside the room: fog ' + beside + ' at 1200,' + below);

  // ── C. A room inside a room, from a floor plan ────────────────────────────
  // RED ON: vttRoomHoles() assigning nothing (vttPlan.js) — 2026-11-04
  const rooms = JSON.parse(await dm.evaluate('(() => { const d = vttDerivePlan(' + PLAN + ');' +
    ' polygons = planPolygons(d, mapWidth, captureGridConfig()); nextPolygonId = polygons.length + 1;' +
    ' return JSON.stringify(polygons.map(p => ({ id: p.id, x0: Math.min(...p.vertices.map(v => v.x)), x1: Math.max(...p.vertices.map(v => v.x)) }))); })()'));
  const hall = rooms.find(r => r.x0 === 0 && r.x1 === MAP), vault = rooms.find(r => r.x0 === 800 && r.x1 === 1200);
  rig.check(!!(hall && vault), 'setup: the plan did not give a hall and a vault: ' + JSON.stringify(rooms));
  if (!hall || !vault) return;
  await dm.evaluate('polygons.find(p => p.id === ' + hall.id + ').mode = "reveal"; ' + lib.SETTLE);
  await lib.settle(player, '!fogTransRafId', 15000);
  rig.check(await tvAt(300, 1500) < 60, 'setup: the revealed hall is not clear on the TV');
  const inner = await tvAt(1000, 1050);
  rig.check(inner > 200, 'a hidden room standing inside a revealed floor-plan room is clear on the TV: fog ' + inner);
};
