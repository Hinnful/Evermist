'use strict';

// room-switcher-shows.js — THE SELECTED ROOM'S SWITCHER APPEARS AT ONCE.
//
// THE GOAL: the clouds and door button over a selected room show the moment the room is picked,
// by click or by keyboard-style selection, with no mouse move afterwards. Covers
// src/rooms/roomSwitcher.js and its caller in src/render/render.js.
//
//   A. A click on a room (no mouse move after it) shows #room-fog.
//   B. A selection change that schedules only a render, no cursor paint, shows it too.
//   C. Switching from a hiding tool back to Select shows it, and deselecting hides it.

const lib = require('../../lib');

const MAP_W = 2400, MAP_H = 1500;

module.exports = async function roomSwitcherShows(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');

  await dm.evaluate('polygons = [{ id: 1, vertices: [{ x: 300, y: 300 }, { x: 900, y: 300 },' +
    ' { x: 900, y: 800 }, { x: 300, y: 800 }], mode: "shroud", cornerRadius: 0, name: "Hall" }];' +
    ' nextPolygonId = 2; selectedPolygonId = null; placeMode = "rooms"; setShape("select");' +
    ' rebuildFogFromPolygons(); scheduleRender(); 0');
  const SHOWN = '(getComputedStyle(document.getElementById("room-fog")).display !== "none")';
  await lib.settle(dm, '!' + SHOWN + ' && !viewportDirty && !cursorDirty', 8000);
  rig.check(!(await dm.evaluate(SHOWN)), 'the switcher shows with no room selected, so the checks below prove nothing');

  // A. RED ON: selectMouseUp's scheduleRender() gated off with 0 && (shapeSelect.js) - 2026-10-18
  // ⚠ The click must ask for the repaint itself. Waiting for the switcher alone passes on any
  // other repaint inside the wait, and shipped 4.6.1 with the bug still in it.
  rig.check(await dm.evaluate('renderScheduled = false; __rigClick(600, 550); renderScheduled'),
            'a click on a room scheduled no repaint, so its switcher waits for a mouse move');
  await lib.settle(dm, SHOWN, 8000);
  rig.check(await dm.evaluate('selectedPolygonId') === 1 && await dm.evaluate(SHOWN),
            'a click selected the room but the switcher did not show until the mouse moved');

  // B. RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('selectedPolygonId = null; scheduleRender(); 0');
  await lib.settle(dm, '!' + SHOWN, 8000);
  rig.check(!(await dm.evaluate(SHOWN)), 'the switcher stayed up after the room was deselected');
  await dm.evaluate('selectedPolygonId = 1; scheduleRender(); 0');
  await lib.settle(dm, SHOWN, 8000);
  rig.check(await dm.evaluate(SHOWN), 'selecting a room without a mouse move did not show its switcher');

  // C. RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('setShape("brush"); 0');
  await lib.settle(dm, '!' + SHOWN, 8000);
  rig.check(await dm.evaluate('shape') === 'brush' && !(await dm.evaluate(SHOWN)),
            'a drawing tool in hand did not hide the switcher');
  await dm.evaluate('setShape("select"); 0');
  await lib.settle(dm, SHOWN, 8000);
  rig.check(await dm.evaluate(SHOWN), 'returning to Select did not show the switcher without a mouse move');
};
