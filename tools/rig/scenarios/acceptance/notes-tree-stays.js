'use strict';

// notes-tree-stays.js — THE NOTES TREE KEEPS WHAT IT SHOWS, AND A PICK IN IT ACTS ON WHAT IT NAMES.
//
// THE GOAL OF THIS FEATURE: a map's rooms stay in the Notes tree after the DM leaves the map; a room
// picked or deleted from the tree is that room, in any mode; a new group never takes over another.
//
// Drives src/search/searchIndex.js, src/notes/notesTree.js and src/scenes/sceneGroups.js.
//
// THE CRITERIA ARE THIS HEADER. Each check sits under its letter.
//
//   A. After the DM leaves a map, the Notes tree still lists that map's rooms.
//   B. In Effects mode, a room picked from the tree is selected, and deleting it from the tree removes
//      the room and leaves the effect that shares its number.
//   C. A new group never takes the name of a group that came in from a backup.

const lib = require('../../lib');

const box = (id, x, name) => '{ id: ' + id + ', vertices: [{ x: ' + x + ', y: 200 }, { x: ' + (x + 300) + ', y: 200 },' +
  ' { x: ' + (x + 300) + ', y: 500 }, { x: ' + x + ', y: 500 }], mode: "shroud", cornerRadius: 0, name: "' + name + '" }';

module.exports = async function notesTreeStays(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: 1600, h: 1000, kind: 'still', name: 'tree-a.png' });
  const aId = JSON.stringify(await dm.evaluate('currentScene.id'));
  await dm.evaluate('polygons = [' + box(1, 200, 'Throne room') + ']; nextPolygonId = 2; doAutoSave()');
  await dm.evaluate('document.getElementById("dock-tab-notes").click(); 0');
  await lib.settle(dm, 'nwIsOpen() && !searchReading()', 6000);

  // ── A. A left map keeps its rooms in the tree ─────────────────────────────
  // RED ON: searchStale() dropping the read instead of reading again (searchIndex.js) — 2026-11-04
  const mapB = await rig.fixtures.stillMap(dm, rig.fixtureDir, { w: 1200, h: 800, name: 'tree-b.png' });
  await dm.evaluate('createNewScene(' + (await rig.fixtures.asFileExpr(dm, mapB)) + ', { quiet: true })', 120000);
  await lib.settle(dm, 'currentScene && currentScene.id !== ' + aId, 60000);
  const bId = JSON.stringify(await dm.evaluate('currentScene.id'));
  const rooms = await lib.poll(() => dm.evaluate('(r => r && r.length ? r.map(x => x.name) : null)(searchRoomsOf(' + aId + '))'), 5000);
  rig.check(!!rooms && rooms.includes('Throne room'), 'the Notes tree lost the rooms of the map the DM just left: ' + JSON.stringify(rooms));

  // ── B. A tree pick in Effects mode is the room ────────────────────────────
  // RED ON: setPlaceMode("rooms") removed from the tree's room pick and delete (notesTree.js) — 2026-11-04
  await dm.evaluate('polygons = [' + box(1, 200, 'Kitchen') + ']; nextPolygonId = 2;' +
    ' setEffects([{ id: 1, vertices: [{ x: 700, y: 200 }, { x: 900, y: 200 }, { x: 900, y: 400 }, { x: 700, y: 400 }], material: "fire", cornerRadius: 0 }]);' +
    ' nextEffectId = 2; setPlaceMode("effects"); 0');
  await dm.evaluate('_ntSig = ""; ntSync(null); 0');
  const node = '_ntNode("room:" + ' + bId + ' + ":1")';
  rig.check(await dm.evaluate('!!' + node), 'setup: the tree holds no node for the room on the open map');
  await dm.evaluate('_ntGoRoom(' + node + '); 0');
  const picked = await dm.evaluate('({ mode: placeMode, sel: selectedPolygonId })');
  rig.check(picked.mode === 'rooms' && picked.sel === 1, 'a room picked from the tree in Effects mode was not selected as the room: ' + JSON.stringify(picked));
  await dm.evaluate('setPlaceMode("effects"); _ntDoDelete(' + node + '); 0');
  const left = await dm.evaluate('({ rooms: polygons.map(p => p.name), effects: effects.length })');
  rig.check(left.rooms.length === 0 && left.effects === 1, 'deleting a room from the tree in Effects mode took the wrong shape: ' + JSON.stringify(left));

  // ── C. A new group never takes a restored group's name ────────────────────
  // RED ON: addGroup() checking the saved order alone (sceneGroups.js) — 2026-11-04
  const fresh = await dm.evaluate('!knownGroupNames().includes("New group")');
  rig.check(fresh, 'setup: "New group" is already in the saved order');
  await dm.evaluate('worldPlaceSet("New group", { vertices: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }] }); 0');
  const made = await dm.evaluate('worldPlaceCreate([{ x: 1000, y: 1000 }, { x: 1400, y: 1000 }, { x: 1400, y: 1400 }, { x: 1000, y: 1400 }])');
  const old = await dm.evaluate('(r => r ? r.vertices[1].x : null)(worldPlaceByName("New group"))');
  rig.check(made !== 'New group' && old === 400, 'a new group took the name of a restored one and replaced its outline: ' + JSON.stringify({ made, old }));
};
