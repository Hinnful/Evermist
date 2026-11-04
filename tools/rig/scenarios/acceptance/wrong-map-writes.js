'use strict';

// wrong-map-writes.js — NOTHING WRITTEN FOR ONE MAP LANDS ON ANOTHER.
//
// THE GOAL OF THIS FEATURE: a map keeps its rooms, fog and notes whatever happens on another map,
// so a failed import, a map switch with a room selected, or a note read earlier never overwrites
// one map with another's state.
//
// Drives src/scenes/mapImport.js, src/scenes/sceneSwitch.js, src/rooms/roomCard.js,
// src/notes/notesPanel.js and src/search/searchIndex.js.
//
// THE CRITERIA ARE THIS HEADER. Each check sits under its letter.
//
//   A. An import whose save fails leaves the open map as it was: its rooms survive the next save,
//      it is open again, and no card is left for the map that failed.
//   B. Opening another map with a room selected leaves the new map's room with the same number
//      untouched, name and notes.
//   C. A map's notes read from the Notes window while it was closed show the newer text after the
//      map was opened and edited, and an edit from the window keeps it.

const lib = require('../../lib');

const room = (name, desc) => '[{ id: 1, vertices: [{ x: 200, y: 200 }, { x: 700, y: 200 }, { x: 700, y: 600 },' +
  ' { x: 200, y: 600 }], mode: "shroud", cornerRadius: 0, name: "' + name + '", desc: "' + desc + '" }]';

module.exports = async function wrongMapWrites(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: 1600, h: 1000 });
  await lib.settle(dm, 'fogCoverT === 0', 30000);
  const aId = await dm.evaluate('currentScene.id');
  const A = JSON.stringify(aId);
  const storedA = () => dm.evaluate('sceneStore.loadScene(' + A + ').then(r => JSON.stringify({ rooms: (r.polygons || []).map(p => p.name), w: r.mapWidth, notes: r.notes || "" }))').then(JSON.parse);
  await dm.evaluate('polygons = ' + room('Throne room', 'throne notes') + '; nextPolygonId = 2; doAutoSave()');
  rig.check((await storedA()).rooms.length === 1, 'setup: map A did not save its room');

  // ── A. A failed import leaves the open map alone ─────────────────────────
  // RED ON: currentScene detach and the reopen on failure removed from createNewScene (mapImport.js) — 2026-11-04
  const cards = await dm.evaluate('allScenes.length');
  await dm.evaluate('(() => { const orig = sceneStore.saveScene; sceneStore.saveScene = async (s, o) => {' +
    ' if (s && s.id === ' + A + ') return orig(s, o);' +
    ' sceneStore.saveScene = orig; throw new Error("rig: disk full"); }; return 0; })()');
  const failB = await rig.fixtures.stillMap(dm, rig.fixtureDir, { w: 1200, h: 800, name: 'wrong-map-fail.png' });
  const failed = await dm.evaluate('createNewScene(' + (await rig.fixtures.asFileExpr(dm, failB)) + ', { quiet: true })', 120000);
  rig.check(failed && failed.ok === false, 'setup: the stubbed import did not fail: ' + JSON.stringify(failed));
  // The app logs the failure it was handed. That one line is this check's own doing, so it leaves
  // the run's console tally; any other error still fails the run.
  const disk = /rig: disk full/;
  await lib.poll(() => (dm.errors || []).some(e => disk.test(e)) || null, 5000);
  dm.errors = (dm.errors || []).filter(e => !disk.test(e));
  await dm.evaluate('doAutoSave()');
  const afterFail = await storedA();
  rig.check(afterFail.rooms.length === 1 && afterFail.w === 1600,
            'a failed import wrote the new map over the open one at the next save: ' + JSON.stringify(afterFail));
  const open = await dm.evaluate('JSON.stringify({ current: currentScene && currentScene.id, rooms: polygons.length, mapWidth, cards: allScenes.length })').then(JSON.parse);
  rig.check(open.current === aId && open.rooms === 1 && open.mapWidth === 1600,
            'after a failed import the map that was open is not open again as it was: ' + JSON.stringify(open));
  rig.check(open.cards === cards, 'a failed import left a card for a map that was never saved: ' + JSON.stringify({ before: cards, after: open.cards }));

  // ── B. A switch with a room selected leaves the next map's room alone ────
  // RED ON: roomCardLeaveScene() call removed from switchScene (sceneSwitch.js) — 2026-11-04
  const mapB = await rig.fixtures.stillMap(dm, rig.fixtureDir, { w: 1000, h: 700, name: 'wrong-map-b.png' });
  await dm.evaluate('createNewScene(' + (await rig.fixtures.asFileExpr(dm, mapB)) + ', { quiet: true })', 120000);
  await lib.settle(dm, 'currentScene && currentScene.id !== ' + A + ' && mapWidth === 1000', 60000);
  const bId = await dm.evaluate('currentScene.id');
  await dm.evaluate('polygons = ' + room('Kitchen', 'kitchen notes') + '; nextPolygonId = 2; doAutoSave()');
  await dm.evaluate('switchScene(' + A + ')', 60000);
  await lib.settle(dm, 'currentScene && currentScene.id === ' + A + ' && polygons.length === 1', 30000);
  await dm.evaluate('placeMode = "rooms"; setShape("select"); selectedPolygonId = 1; refreshRoomPanel(); 0');
  rig.check(await dm.evaluate('_rpFieldPid') === 1, 'setup: the selected room did not fill the room fields');
  // Search's pick goes straight to switchScene.
  await dm.evaluate('switchScene(' + JSON.stringify(bId) + ')', 60000);
  await lib.settle(dm, 'currentScene && currentScene.id === ' + JSON.stringify(bId), 30000);
  await dm.evaluate('doAutoSave()');
  const b = await dm.evaluate('sceneStore.loadScene(' + JSON.stringify(bId) + ').then(r => JSON.stringify(r.polygons.map(p => ({ name: p.name, desc: p.desc }))))');
  rig.check(/Kitchen/.test(b) && /kitchen notes/.test(b) && !/Throne|throne/.test(b),
            'opening map B with a room selected on map A rewrote B\'s room: ' + b);

  // ── C. The Notes window never writes a map's old notes back ──────────────
  // RED ON: notesMapStale() call removed from searchStale (searchIndex.js) — 2026-11-04
  await dm.evaluate('_npCommitMap(' + A + ', "OLD"); 0');
  await lib.poll(async () => (await storedA()).notes === 'OLD' || null, 10000);
  await dm.evaluate('_npMapNotes(' + A + '); 0');
  await lib.poll(() => dm.evaluate('_npMapNotes(' + A + ')'), 10000);
  await dm.evaluate('switchScene(' + A + ')', 60000);
  await dm.evaluate('_npCommitMap(' + A + ', "NEW TEXT"); doAutoSave()');
  await dm.evaluate('switchScene(' + JSON.stringify(bId) + ')', 60000);
  const shown = await lib.poll(() => dm.evaluate('(n => n === "NEW TEXT" ? n : null)(_npMapNotes(' + A + '))'), 10000);
  rig.check(shown === 'NEW TEXT', 'the Notes window still shows map A\'s old notes after A was edited: ' +
            JSON.stringify(await dm.evaluate('_npMapNotes(' + A + ')')));
  await dm.evaluate('_npCommitMap(' + A + ', (_npMapNotes(' + A + ') || "") + " + one more line"); 0');
  const final = await lib.poll(async () => { const s = (await storedA()).notes; return s.includes('one more line') ? s : null; }, 10000);
  rig.check(final && final.includes('NEW TEXT'), 'an edit from the Notes window wrote the old notes over the newer ones: ' + JSON.stringify(final));
};
