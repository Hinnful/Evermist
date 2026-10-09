'use strict';

// claude-prep.js — CLAUDE WRITES SESSION PREP INTO EVERMIST.
//
// THE GOAL OF THIS FEATURE: the DM brainstorms in the Claude desktop app and says "write that down in
// Evermist". Claude creates places, adds notes and builds fights while the app is open. It only adds.
//
// THE CRITERIA ARE THIS HEADER. The calls go where the shim sends them: the bridge's port and key in
// the profile's mcp.json.
//
//   A. Only a caller with this launch's key reaches the app; a web page's Origin is refused too.
//   B. Claude adds to campaign notes below the DM's text.
//   C. Claude adds to the open scene's notes, and the scene's own autosave keeps them.
//   D. Claude reads back a scene's notes with its rooms', and the campaign's places and scenes.
//   E. Claude creates a place in an empty spot on the world map, with notes. One world-map undo
//      takes the place and its notes away.
//   F. Claude creates a fight from bestiary monsters, leaves out one the bestiary lacks and names it,
//      and the DM's open fight stays open.
//   G. In two-map mode a note for a column's scene lands in that column and in the store.

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
  // RED ON: the open scene written to the store instead of currentScene (_mcpAddSceneNotes, mcpTools.js) — 2026-10-10
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
  rig.check(missing.isError && /cannot create scenes/.test(missing.text), 'a note for a scene that does not exist was not refused: ' + JSON.stringify(missing));

  // ── E. A new place, and undo ──────────────────────────────────────────────
  // RED ON: worldUndoPush() removed from _mcpCreatePlace (mcpTools.js) — 2026-10-10
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
  await dm.evaluate('worldUndo(); 0');
  rig.check(await dm.evaluate('!worldPlaceByName("Amber Temple") && notesPlaceGet("Amber Temple") === ""'),
            'one world-map undo did not take the new place and its notes away');

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
