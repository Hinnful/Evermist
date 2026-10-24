'use strict';

// hints-library-state.js — HINTS FOLLOW WHAT THE LIBRARY HOLDS (item 210).
// Covers src/ui/hintsFirstMap.js (hintsScanBrush, hintsFirstSync), hintsCues.js (hintsCuesSync, hintsShowOnTvShow), hints.js
// (_hintQuiet) and hintsPlan.js.
//
//   A. A map whose rooms are all in shroud opens on "Show a room" beside the room nearest the view's centre (the first room
//      is off screen), never "Reveal part of the map". Revealing a room closes it, and "Put it on the TV" follows at once:
//      only Got it starts the quiet gap, and it holds the next screen-read hint. (DoD 3, 4, 6, 7)
//   B. A map with nothing revealed shows "Reveal part of the map"; a map whose brush layer holds a cleared area does not,
//      and shows "Put it on the TV" instead, which closes when the TV goes live. (DoD 1, 2)
//   C. A map that holds an effect gets no Effects hint; the same map without one does. (DoD 5)
//
// ⚠ The brush layer is read at map open, so B clears it and calls hintsScanBrush() as a map open would.
// ⚠ _hintQuietMs is shortened so the gap is observable inside a run.

const lib = require('../../lib');

const MAP_W = 2400, MAP_H = 1500;
const up = id => '!!document.querySelector(".hintcall-' + id + '")';
const seenJs = list => 'localStorage.setItem("evermist.hintsSeen", ' + JSON.stringify(JSON.stringify(list)) + ');';
const RESET = list => 'hintClose(); _hintClosedAt = 0; ' + seenJs(list) + ' localStorage.removeItem("evermist.hintsOff"); 0';
const BASE_SEEN = ['rooms', 'room-edit', 'repair-keys', 'seat', 'open-map', 'groups', 'effects', 'next-map'];
const EFFECT = '[{ id: 1, vertices: [{ x: 900, y: 900 }, { x: 1200, y: 900 }, { x: 1200, y: 1150 }, { x: 900, y: 1150 }],' +
  ' material: "fire", cornerRadius: 0, name: "Burning pews" }]';

module.exports = async function hintsLibraryState(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');
  await dm.evaluate('autoSync = false; placeMode = "rooms"; setShape("select"); _hintQuietMs = 1500; _hcOpens = 5; 0');
  await lib.settle(dm, '!viewportDirty && !cursorDirty', 8000);

  // A. RED BY DESIGN: written against the fix, never re-proved
  // Two rooms; the view is panned so the SECOND is at the centre and the first is off screen.
  const ids = await dm.evaluate('[__rigDrawShroud(300, 300, 800, 700), __rigDrawShroud(1200, 300, 1700, 700)]');
  await dm.evaluate('(() => { const c = container.getBoundingClientRect(); zoom = 1; panX = c.width / 2 - 1450; panY = c.height / 2 - 500;' +
    ' viewportDirty = true; cursorDirty = true; scheduleRender(); return 0; })()');
  await lib.settle(dm, '!viewportDirty && !cursorDirty', 8000);
  await dm.evaluate('hintsScanBrush(); ' + RESET(BASE_SEEN));
  await dm.evaluate('refreshRoomPanel(); 0');
  await lib.settle(dm, up('room-reveal'), 8000);
  const rr = await dm.evaluate('(() => { const h = document.querySelector(".hintcall-room-reveal"); return h ? h.textContent : null; })()');
  rig.check(rr && /Show a room/.test(rr) && /Click a room, then its clouds to show it to the players\./.test(rr),
    'a map of shrouded rooms showed no "Show a room" hint with its words: ' + rr);
  rig.check(!(await dm.evaluate(up('reveal'))), 'the reveal hint showed on a map that has rooms to show');
  const near = await dm.evaluate('(() => { const h = document.querySelector(".hintcall-room-reveal").getBoundingClientRect(), id = ' + JSON.stringify(ids[1]) + ';' +
    ' const p = polygons.find(q => q.id === id), v = p.vertices.map(q => { const s = toScreen(q.x, q.y); return viewToClient(s.sx, s.sy); });' +
    ' const l = Math.min(...v.map(q => q.x)), r = Math.max(...v.map(q => q.x)), t = Math.min(...v.map(q => q.y)), b = Math.max(...v.map(q => q.y));' +
    ' return Math.abs(h.top - b) < 40 || Math.abs(t - h.bottom) < 40 || Math.abs(h.left - r) < 40 || Math.abs(l - h.right) < 40; })()');
  rig.check(near, 'the "Show a room" hint is not beside the room nearest the centre of the view (the first room is off screen)');

  // A closed by the DM's action starts no gap: the next screen-read hint shows at once, with a long gap set.
  await dm.evaluate('_hintQuietMs = 600000; ' + seenJs(BASE_SEEN.concat('room-reveal', 'reveal')) + ' 0');
  await dm.evaluate('setPolygonMode(' + JSON.stringify(ids[1]) + ', "reveal"); 0');
  await lib.settle(dm, '!' + up('room-reveal'), 8000);
  rig.check(!(await dm.evaluate(up('room-reveal'))), 'revealing a room left "Show a room" up');
  await lib.settle(dm, up('show-on-tv'), 8000);
  rig.check(await dm.evaluate(up('show-on-tv')), 'a hint closed by an action held the next screen-read hint for the gap');

  // Got it starts the gap: the next screen-read hint (reveal) waits for it.
  await dm.evaluate('_hintQuietMs = 3000; document.querySelector(".hintcall-ok").click(); ' +
    'hintClose(); polygons.slice().forEach(p => deletePolygonById(p.id));' +
    ' baseFogCtx.fillStyle = "#1a1a2e"; baseFogCtx.fillRect(0, 0, baseFogCanvas.width, baseFogCanvas.height); hintsScanBrush();' +
    ' setShape("select"); ' + seenJs(BASE_SEEN.concat('show-on-tv')) + ' refreshRoomPanel(); 0');
  rig.check(!(await dm.evaluate(up('reveal'))), 'pressing Got it did not hold the next screen-read hint for the quiet gap');
  await lib.settle(dm, up('reveal'), 8000);
  rig.check(await dm.evaluate(up('reveal')), 'control: an unrevealed map with no rooms showed no reveal hint after the gap');

  // B. RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('_hintQuietMs = 0; ' + RESET(BASE_SEEN.concat('show-on-tv')));
  await dm.evaluate('baseFogCtx.clearRect(200, 200, baseFogCanvas.width / 2, baseFogCanvas.height / 2); hintsScanBrush(); refreshRoomPanel(); 0');
  await lib.hold(1200, 'a reveal hint, if a revealed map let one show, would be up by now');
  rig.check(!(await dm.evaluate(up('reveal'))), 'a map with a brushed revealed area showed "Reveal part of the map"');

  // RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate(seenJs(BASE_SEEN.concat('reveal')) + ' refreshRoomPanel(); 0');
  await lib.settle(dm, up('show-on-tv'), 8000);
  rig.check(await dm.evaluate(up('show-on-tv')), 'a map showing a revealed area did not bring "Put it on the TV"');
  await rig.player();
  await lib.settle(dm, '_tvLive() && !' + up('show-on-tv'), 15000);
  rig.check(!(await dm.evaluate(up('show-on-tv'))), 'the TV going live left "Put it on the TV" up');

  // C. RED BY DESIGN: written against the fix, never re-proved
  const SEEN_C = ['reveal', 'room-reveal', 'show-on-tv', 'rooms', 'room-edit', 'repair-keys', 'seat', 'open-map', 'groups', 'next-map'];
  await dm.evaluate(RESET(SEEN_C));
  await dm.evaluate('refreshRoomPanel(); 0');
  await lib.settle(dm, up('effects'), 8000);
  rig.check(await dm.evaluate(up('effects')), 'control: a map with no effect showed no Effects hint, so the next check proves nothing');
  await dm.evaluate(RESET(SEEN_C));
  await dm.evaluate('setEffects(' + EFFECT + '); nextEffectId = 2; refreshRoomPanel(); scheduleRender(); 0');
  await lib.hold(1200, 'an Effects hint, if a map with an effect let one show, would be up by now');
  rig.check(!(await dm.evaluate(up('effects'))), 'a map that holds an effect showed the Effects hint');
};
