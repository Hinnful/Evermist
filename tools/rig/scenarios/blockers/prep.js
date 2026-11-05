'use strict';

// prep.js — PREPARING A MAP: A DUNGEON ALCHEMIST MAP IS IMPORTED AND ITS ROOMS ARE DRAWN FROM THE FLOOR PLAN.
//
// Runs in Russian on a Russian-named map, because the DM's library is Russian. The map is an animated
// 3110x2160, the size of theirs. Rooms in prep come from the plan, almost never by hand.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   A. The app comes up in Russian.
//   B. A map with a floor plan imports, and offers Draw Rooms.
//   C. Draw Rooms draws the plan's three rooms on the map, each one shrouded.
//
// ⚠ THE DISK LOOKUP FOR THE .dd2vtt IS STUBBED, AND NOTHING ELSE IS (lib.importWithPlan): a File built in
// the page has no path on disk, so the app can never find a plan beside it.

const lib = require('../../lib');

const NAME = 'Склеп вампира';

module.exports = async function prep(rig) {
  // ── A. Russian ────────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const dm = await lib.inRussian(rig);
  rig.check(await dm.evaluate('document.documentElement.lang') === 'ru', 'A: the app did not come up in Russian');

  // ── B. A map with a floor plan ────────────────────────────────────────────
  await lib.step(rig, 'B: the import', () => lib.importWithPlan(rig, NAME));
  const imported = await dm.evaluate(`({ name: currentScene && currentScene.name, type: currentScene && currentScene.mapType,
    w: mapWidth, h: mapHeight, planBtn: !document.getElementById('btn-floorplan').disabled })`);
  rig.note('the map: ' + imported.w + 'x' + imported.h + ' ' + imported.type);
  rig.check(imported.name === NAME && imported.type === 'video', 'B: the animated map did not import under its Russian name: ' + JSON.stringify(imported));
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(imported.planBtn, 'B: Draw Rooms is not offered for a map that came with a floor plan');

  // ── C. Draw Rooms ─────────────────────────────────────────────────────────
  // RED ON: btn-floorplan replaced by a copy with no listeners, so Draw Rooms does nothing — 2026-11-05
  const rooms = await lib.drawRooms(rig, 3);
  rig.note('rooms drawn: ' + rooms.length);
  rig.check(rooms.length === 3, "C: Draw Rooms did not draw the plan's three rooms: " + rooms.length);
  rig.check(rooms.length > 0 && rooms.every(r => r.mode === 'shroud'), 'C: a room from the plan did not arrive shrouded');
  rig.check(rooms.length > 0 && rooms.every(r => r.cx > 0 && r.cx < lib.DM_MAP.w && r.cy > 0 && r.cy < lib.DM_MAP.h),
            'C: a room landed outside the map: ' + JSON.stringify(rooms));
  await lib.settle(rig.dm, '!viewportDirty', 15000);
  for (const r of rooms) {
    rig.check(await rig.dm.evaluate('__rigFog(' + Math.round(r.cx) + ',' + Math.round(r.cy) + ')') > 200,
              'C: the ground inside "' + r.name + '" is not fogged after its rooms were drawn');
  }
};
