'use strict';

// claude-prep.js — CLAUDE WRITES SESSION PREP INTO EVERMIST.
//
// THE GOAL OF THIS FEATURE: the DM brainstorms in the Claude desktop app and says "write that down in
// Evermist". Claude does the DM's prep while the app is open: scenes, places, roads, notes, fights, the
// bestiary and the gallery. It never plays: nothing it does reaches the TV, and every call is one undo step.
//
// It drives src/mcp/: mcpTools.js, mcpShared.js, mcpHistory.js, mcpMeta.js, mcpGuideText.js, mcpNotes.js,
// mcpScenes.js, mcpWorld.js, mcpWorldMap.js, mcpFights.js, mcpBestiary.js and mcpGallery.js.
//
// THE CRITERIA ARE THIS HEADER. The calls go where the shim sends them: the bridge's port and key in
// the profile's mcp.json.
//
//   A. Only a caller with this launch's key reaches the app; a web page's Origin is refused too.
//   B. Claude adds to campaign notes below the DM's text.
//   C. Claude adds to the open scene's notes, and the scene's own autosave keeps them.
//   D. Claude reads back a scene's notes with its rooms', and the campaign's places and scenes.
//   E. Claude creates a place in an empty spot on the world map, with notes. undo_last_change
//      takes the place and its notes away.
//   F. Claude creates a fight from bestiary monsters, leaves out one the bestiary lacks and names it,
//      and the DM's open fight stays open.
//   G. In two-map mode a note for a column's scene lands in that column and in the store.
//   H. set_notes replaces and undo_last_change brings the old text back; the guide answers; a change to
//      the scene the DM has open or the TV shows is refused.
//   I. Claude makes a scene from a map file inside a place without opening it, renames it, changes its
//      fog colour and grid, moves it out of the place, deletes it and undo brings it back whole.
//   J. Claude renames a place with its notes, reshapes it, draws a road to a second place, deletes it
//      and undo brings it back; list_campaign reports its bounds.
//   K. Claude edits a fight's monsters and deletes it, and undo restores it; the open fight is refused.
//   L. Claude adds a monster from stat block text and refuses text that is not one.
//   M. Claude adds, renames and deletes a gallery picture, and undo brings the picture back.

const fs = require('fs');
const path = require('path');
const lib = require('../../lib');

const MAP = { w: 1600, h: 1000 };
const TALL = { w: 1200, h: 1500 };

module.exports = async function claudePrep(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, MAP);
  await lib.settle(dm, 'fogCoverT === 0', 30000);

  const address = await lib.poll(async () => {
    try { return JSON.parse(fs.readFileSync(path.join(rig.profileDir, 'mcp.json'), 'utf8')); } catch { return null; }
  }, 15000);
  rig.check(!!(address && address.port && address.token), 'the app wrote no mcp.json with a port and a key into its profile');
  if (!address) return;
  const post = (tool, args, headers) => fetch('http://127.0.0.1:' + address.port + '/call', {
    method: 'POST', body: JSON.stringify({ tool, args: args || {} }),
    headers: Object.assign({ 'content-type': 'application/json', 'x-evermist-token': address.token }, headers || {}),
  });
  const call = async (tool, args) => (await post(tool, args)).json();

  // ── A. The key ────────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const noKey = await post('list_campaign', {}, { 'x-evermist-token': 'wrong' });
  const page = await post('list_campaign', {}, { origin: 'https://example.com' });
  rig.check(noKey.status === 403 && page.status === 403,
            'a call without the key, or from a web page, was not refused: ' + noKey.status + ' / ' + page.status);
  const first = await call('list_campaign');
  rig.check(!first.isError && /places/.test(first.text), 'a call with the key got no campaign back: ' + JSON.stringify(first));

  // ── B. Campaign notes ─────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('notesCampaignSet("The DM wrote this."); refreshRoomPanel(); 0');
  const addCampaign = await call('add_notes', { level: 'campaign', text: 'Claude wrote this.' });
  rig.check(!addCampaign.isError && await dm.evaluate('notesCampaignGet()') === 'The DM wrote this.\n\nClaude wrote this.',
            'campaign notes did not keep the DM\'s text with Claude\'s below it: ' + JSON.stringify(await dm.evaluate('notesCampaignGet()')));

  // ── C. The open scene, through its autosave ───────────────────────────────
  // RED ON: the open scene written to the store instead of currentScene (_mcpPutSceneNotes, mcpNotes.js) — 2026-10-10
  const scene = await dm.evaluate('({ id: currentScene.id, name: currentScene.name })');
  await dm.evaluate('currentScene.notes = "Mine."; polygons = [{ id: 1, vertices: [{x:100,y:100},{x:400,y:100},{x:400,y:300},{x:100,y:300}],' +
    ' mode: "shroud", cornerRadius: 0, name: "Vestry", desc: "Two acolytes." }]; nextPolygonId = 2; rebuildFogFromPolygons();' +
    // A real edit goes through the panel, so the panel shows what the scene holds.
    ' refreshRoomPanel(); doAutoSave()');
  const addScene = await call('add_notes', { level: 'scene', name: scene.name, text: 'The bell tolls at dusk.' });
  rig.check(!addScene.isError && await dm.evaluate('currentScene.notes') === 'Mine.\n\nThe bell tolls at dusk.',
            'the open scene did not get Claude\'s note below the DM\'s: ' + JSON.stringify(addScene));
  await dm.evaluate('doAutoSave()');
  const stored = await dm.evaluate('sceneStore.loadScene(' + JSON.stringify(scene.id) + ').then(r => r.notes)');
  rig.check(stored === 'Mine.\n\nThe bell tolls at dusk.', 'the open scene\'s autosave wrote over Claude\'s note: ' + JSON.stringify(stored));

  // ── D. Reading back ───────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const read = JSON.parse((await call('read_notes', { level: 'scene', name: scene.name })).text);
  rig.check(read.notes === 'Mine.\n\nThe bell tolls at dusk.' && read.rooms.length === 1 && read.rooms[0].notes === 'Two acolytes.',
            'reading the scene back did not give its notes and its room\'s: ' + JSON.stringify(read));
  const missing = await call('add_notes', { level: 'scene', name: 'No Such Scene', text: 'x' });
  rig.check(missing.isError && /create_scene/.test(missing.text), 'a note for a scene that does not exist was not refused: ' + JSON.stringify(missing));

  // ── E. A new place, and undo ──────────────────────────────────────────────
  // RED ON: the undo step removed from _mcpCreatePlace (mcpWorld.js) — 2026-10-19
  const made = await call('create_place', { name: 'Amber Temple', notes: 'Vampires, amber, dark gifts.' });
  const place = await dm.evaluate(`(() => {
    const r = worldPlaceByName('Amber Temple');
    if (!r) return null;
    const b = wmPolyBounds(r.vertices);
    const others = worldPlaceRecords().filter(x => x !== r).map(x => wmPolyBounds(wmOutline(x)))
      .concat(allScenes.filter(s => wmCleanPos(s.worldPos)).map(s => wmCardRect(s.worldPos)));
    const clear = others.every(o => b.x >= o.x + o.w || o.x >= b.x + b.w || b.y >= o.y + o.h || o.y >= b.y + b.h);
    return { clear, notes: notesPlaceGet('Amber Temple') };
  })()`);
  rig.check(!made.isError && place && place.clear && place.notes === 'Vampires, amber, dark gifts.',
            'the new place is missing, overlaps something, or lacks its notes: ' + JSON.stringify({ made, place }));
  const again = await call('create_place', { name: 'amber temple' });
  rig.check(again.isError, 'a second place with the same name was created');
  const undone = await call('undo_last_change');
  rig.check(!undone.isError && await dm.evaluate('!worldPlaceByName("Amber Temple") && notesPlaceGet("Amber Temple") === ""'),
            'undo_last_change did not take the new place and its notes away: ' + JSON.stringify(undone));

  // ── F. A fight from the bestiary ──────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('cbState.blocks.b900 = Object.assign(combatBlankBlock("b900", "Goblin"), { ac: "15" }); cbSave(); 0');
  const openBefore = await dm.evaluate('cbState.openId');
  const fight = await call('create_fight', { name: 'Ambush at the gate', monsters: [{ name: 'goblin', count: 2 }, { name: 'Beholder' }] });
  const saved = await dm.evaluate(`(() => {
    const f = cbState.fights.find(x => x.name === 'Ambush at the gate');
    return f && { rows: (f.rows || []).map(r => r.name), openId: cbState.openId,
      stored: JSON.parse(localStorage.getItem('evermist.combatFights')).fights.some(x => x.name === 'Ambush at the gate') };
  })()`);
  rig.check(!fight.isError && /Beholder/.test(fight.text) && saved && saved.rows.join() === 'Goblin,Goblin 2' && saved.stored,
            'the fight is missing, wrong, unsaved, or the missing monster went unnamed: ' + JSON.stringify({ fight, saved }));
  rig.check(saved && saved.openId === openBefore, 'creating a fight switched the DM\'s open fight');


  // ── H. Replace, guide, and the scene the DM has open ──────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const guide = await call('guide', { topic: 'scenes' });
  rig.check(!guide.isError && /one map/.test(guide.text), 'the guide gave no text for scenes: ' + JSON.stringify(guide));
  const kept = await dm.evaluate('notesCampaignGet()');
  const replaced = await call('set_notes', { level: 'campaign', text: 'Fresh start.' });
  rig.check(!replaced.isError && await dm.evaluate('notesCampaignGet()') === 'Fresh start.', 'set_notes did not replace the campaign notes: ' + JSON.stringify(replaced));
  await call('undo_last_change');
  rig.check(await dm.evaluate('notesCampaignGet()') === kept, 'undo_last_change did not bring the old campaign notes back');
  const pinned = await call('set_scene', { name: scene.name, fogColor: '#336699' });
  rig.check(pinned.isError && /open|TV/.test(pinned.text), 'a fog colour change to the scene the DM has open was not refused: ' + JSON.stringify(pinned));

  // ── I. Scenes ─────────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const still = await rig.fixtures.stillMap(dm, rig.fixtureDir, { w: 800, h: 500, name: 'claude-scene.png' });
  const mapDir = path.join(rig.fixtureDir, 'claude-maps');
  fs.mkdirSync(mapDir, { recursive: true });
  fs.copyFileSync(still.path, path.join(mapDir, 'claude-scene.png'));
  await call('create_place', { name: 'Marsh', notes: 'Fog and frogs.' });
  const found = await call('find_map_files', { query: 'claude-scene' });
  rig.check(!found.isError, 'find_map_files failed: ' + JSON.stringify(found));
  const open = await dm.evaluate('currentScene.id');
  const made2 = await call('create_scene', { path: path.join(mapDir, 'claude-scene.png'), name: 'Sunken Crypt', place: 'Marsh' });
  const crypt = await dm.evaluate(`(() => {
    const s = allScenes.find(x => x.name === 'Sunken Crypt');
    if (!s) return null;
    return { id: s.id, group: s.group, inside: wmRectInPoly(wmCardRect(s.worldPos), wmOutline(worldPlaceByName('Marsh'))), open: currentScene.id };
  })()`);
  rig.check(!made2.isError && crypt && crypt.group === 'Marsh' && crypt.inside && crypt.open === open,
            'the scene was not made inside its place, or it was opened: ' + JSON.stringify({ made2, crypt }));
  await call('rename_scene', { name: 'Sunken Crypt', newName: 'Drowned Crypt' });
  const tuned = await call('set_scene', { name: 'Drowned Crypt', fogColor: '#336699', gridCellSize: 55 });
  const rec = await dm.evaluate('sceneStore.loadScene(' + JSON.stringify(crypt && crypt.id) + ').then(r => ({ name: r.name, hex: r.fogSettings && r.fogSettings.pickedHex, cell: r.gridConfig && r.gridConfig.cellSize }))');
  rig.check(!tuned.isError && rec.name === 'Drowned Crypt' && rec.hex === '#336699' && rec.cell === 55,
            'the scene was not renamed, or its fog colour and grid were not kept: ' + JSON.stringify({ tuned, rec }));
  await call('move_scene', { name: 'Drowned Crypt', toPlace: '' });
  rig.check(await dm.evaluate('allScenes.find(x => x.name === "Drowned Crypt").group === ""'), 'move_scene did not take the scene out of its place');
  await call('delete_scene', { name: 'Drowned Crypt' });
  rig.check(await dm.evaluate('!allScenes.some(x => x.name === "Drowned Crypt")') && await dm.evaluate('sceneStore.loadScene(' + JSON.stringify(crypt && crypt.id) + ').then(r => !r)'),
            'delete_scene left the scene in the list or the store');
  await call('undo_last_change');
  const back = await dm.evaluate('sceneStore.loadScene(' + JSON.stringify(crypt && crypt.id) + ').then(r => r && r.fogSettings && r.fogSettings.pickedHex)');
  rig.check(back === '#336699' && await dm.evaluate('allScenes.some(x => x.name === "Drowned Crypt")'), 'undo_last_change did not bring the deleted scene back whole');

  // ── J. Places ─────────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await call('rename_place', { name: 'Marsh', newName: 'Fen' });
  rig.check(await dm.evaluate('!!worldPlaceByName("Fen") && !worldPlaceByName("Marsh") && notesPlaceGet("Fen") === "Fog and frogs."'), 'rename_place did not move the place and its notes');
  const listed = JSON.parse((await call('list_campaign')).text);
  const fen = listed.places.find(p => p.name === 'Fen');
  rig.check(fen && fen.bounds && fen.bounds.w > 0, 'list_campaign gave no bounds for the place: ' + JSON.stringify(fen));
  await call('reshape_place', { name: 'Fen', x: 5000, y: 5000, w: 400, h: 300 });
  const shaped = await dm.evaluate('wmPolyBounds(wmOutline(worldPlaceByName("Fen")))');
  rig.check(shaped.x === 5000 && shaped.y === 5000 && shaped.w === 400 && shaped.h === 300, 'reshape_place did not make the rectangle: ' + JSON.stringify(shaped));
  await call('create_place', { name: 'Moor' });
  const roads = await dm.evaluate('worldRoadRecords().length');
  const road = await call('create_road', { from: 'Fen', to: 'Moor' });
  rig.check(!road.isError && await dm.evaluate('worldRoadRecords().length') === roads + 1, 'create_road drew no road: ' + JSON.stringify(road));
  await call('undo_last_change');
  rig.check(await dm.evaluate('worldRoadRecords().length') === roads, 'undo_last_change did not take the road away');
  await call('delete_place', { name: 'Fen' });
  rig.check(await dm.evaluate('!worldPlaceByName("Fen") && notesPlaceGet("Fen") === ""'), 'delete_place left the place or its notes');
  await call('undo_last_change');
  rig.check(await dm.evaluate('!!worldPlaceByName("Fen") && notesPlaceGet("Fen") === "Fog and frogs."'), 'undo_last_change did not bring the place and its notes back');

  // ── K. Fights ─────────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const grown = await call('edit_fight', { name: 'Ambush at the gate', counts: [{ name: 'Goblin', count: 3 }] });
  const rows = () => dm.evaluate('cbState.fights.find(x => x.name === "Ambush at the gate").rows.map(r => r.name).join()');
  rig.check(!grown.isError && await rows() === 'Goblin,Goblin 2,Goblin 3', 'edit_fight did not make three goblins: ' + JSON.stringify({ grown, rows: await rows() }));
  const openName = await dm.evaluate('cbState.fights.find(f => f.id === cbState.openId).name');
  const refused = await call('delete_fight', { name: openName });
  rig.check(refused.isError && /open at the table/.test(refused.text), 'the fight open at the table was not refused: ' + JSON.stringify(refused));
  await call('delete_fight', { name: 'Ambush at the gate' });
  rig.check(await dm.evaluate('!cbState.fights.some(x => x.name === "Ambush at the gate")'), 'delete_fight left the fight');
  await call('undo_last_change');
  rig.check(await rows() === 'Goblin,Goblin 2,Goblin 3', 'undo_last_change did not bring the fight back with its rows');

  // ── L. A monster from text ────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const refusedText = await call('add_monster', { text: 'Comments\nGreat monster, used it last week.' });
  rig.check(refusedText.isError, 'text that is no stat block was added to the bestiary');
  const goblin = ['Bog Goblin', 'Small humanoid (goblinoid), neutral evil', 'Armor Class 15 (leather armor, shield)', 'Hit Points 7 (2d6)', 'Speed 30 ft.',
    'STR', '8 (-1)', 'DEX', '14 (+2)', 'CON', '10 (+0)', 'INT', '10 (+0)', 'WIS', '8 (-1)', 'CHA', '8 (-1)',
    'Skills Stealth +6', 'Senses darkvision 60 ft., passive Perception 9', 'Languages Common, Goblin', 'Challenge 1/4 (50 XP)',
    'Nimble Escape. The goblin can take the Disengage or Hide action as a bonus action on each of its turns.', 'Actions',
    'Scimitar. Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.'].join('\n');
  const addedMonster = await call('add_monster', { text: goblin, source: 'rig' });
  rig.check(!addedMonster.isError && await dm.evaluate('Object.values(cbState.blocks).some(b => b.name === "Bog Goblin")'), 'add_monster did not add a clean stat block: ' + JSON.stringify(addedMonster));
  await call('undo_last_change');
  rig.check(await dm.evaluate('!Object.values(cbState.blocks).some(b => b.name === "Bog Goblin")'), 'undo_last_change left the monster in the bestiary');

  // ── M. The gallery ────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const pic = await call('add_picture', { path: path.join(mapDir, 'claude-scene.png'), name: 'Old map' });
  rig.check(!pic.isError && await dm.evaluate('galleryList().some(p => p.name === "Old map")'), 'add_picture did not add the picture: ' + JSON.stringify(pic));
  await call('rename_picture', { name: 'Old map', newName: 'Torn map' });
  rig.check(await dm.evaluate('galleryList().some(p => p.name === "Torn map")'), 'rename_picture did not rename the picture');
  await call('delete_picture', { name: 'Torn map' });
  rig.check(await dm.evaluate('!galleryList().some(p => p.name === "Torn map")'), 'delete_picture left the picture');
  await call('undo_last_change');
  rig.check(await dm.evaluate('galleryList().some(p => p.name === "Torn map")'), 'undo_last_change did not bring the picture back');

  // ── G. Two maps: a column's scene ─────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const second = await rig.fixtures.tableMap(dm, rig.fixtureDir, TALL);
  await dm.evaluate('createNewScene(' + await rig.fixtures.asFileExpr(dm, second) + ')', 180000);
  await dm.waitFor('currentScene && mapWidth === ' + TALL.w + ' && fogCoverT === 0', 180000, 'the second map');
  const other = await dm.evaluate('({ id: currentScene.id, name: currentScene.name })');
  // Back to the first map, so it fills column A and the new one goes to B, as notes-panel.js does.
  await dm.evaluate('switchScene(' + JSON.stringify(scene.id) + '); 0');
  await dm.waitFor('currentScene && currentScene.id === ' + JSON.stringify(scene.id) + ' && fogCoverT === 0', 60000, 'the first map again');
  await dm.evaluate('document.getElementById("btn-two-maps").click(); 0');
  await dm.waitFor('panesActive && panes.A.ready && panes.B.ready', 180000, 'both columns to come up');
  const paneB = await rig.pane('B');
  await dm.evaluate('worldMapColumnFill(' + JSON.stringify(other.id) + '); 0');
  await dm.waitFor('panes.B.sceneId === ' + JSON.stringify(other.id), 60000, 'the second map in column B');
  await paneB.waitFor('typeof currentScene !== "undefined" && currentScene && !!mapOffscreen', 60000, 'column B to hold a map');
  await paneB.evaluate('currentScene.notes = "Column note."; doAutoSave()');
  const addColumn = await call('add_notes', { level: 'scene', name: other.name, text: 'Claude, in the column.' });
  const want = 'Column note.\n\nClaude, in the column.';
  await lib.poll(async () => (await paneB.evaluate('currentScene.notes')) === want ? { ok: 1 } : null, 8000);
  await paneB.evaluate('doAutoSave()');
  const columnStored = await dm.evaluate('sceneStore.loadScene(' + JSON.stringify(other.id) + ').then(r => r.notes)');
  rig.check(!addColumn.isError && await paneB.evaluate('currentScene.notes') === want && columnStored === want,
            'a note for column B\'s scene did not land in the column and the store: ' + JSON.stringify({ addColumn, columnStored }));
};
