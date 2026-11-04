'use strict';

// claude-in-play.js — THE AI ASSISTANT NEVER LOSES OR DELETES WHAT IS IN PLAY.
//
// THE GOAL OF THIS FEATURE: every change the assistant says it made is there, even when it sends
// several at once, and its undo never deletes a map the DM is playing on.
//
// Drives src/mcp/mcpShared.js, src/mcp/mcpMapEdit.js and src/mcp/mcpScenes.js.
//
// THE CRITERIA ARE THIS HEADER. Each check sits under its letter.
//
//   A. Three rooms drawn on one closed map at once are all on it.
//   B. Undoing the assistant's new map is refused while the DM has it open on the TV, and the map
//      and its room survive; the step stays for later.

const fs = require('fs'), path = require('path');
const lib = require('../../lib');

module.exports = async function claudeInPlay(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: 1600, h: 1000, kind: 'still', name: 'in-play-a.png' });
  const aId = await dm.evaluate('currentScene.id'), aName = await dm.evaluate('currentScene.name');
  const mapB = await rig.fixtures.stillMap(dm, rig.fixtureDir, { w: 1200, h: 800, name: 'in-play-b.png' });
  await dm.evaluate('createNewScene(' + (await rig.fixtures.asFileExpr(dm, mapB)) + ', { quiet: true })', 120000);
  await lib.settle(dm, 'currentScene && currentScene.id !== ' + JSON.stringify(aId), 60000);
  const call = await lib.mcpClient(rig);
  rig.check(!!call, 'setup: the AI assistant bridge did not come up');
  if (!call) return;

  // ── A. Parallel rooms ─────────────────────────────────────────────────────
  // RED ON: mcpInTurn() removed from mcpEditMap (mcpMapEdit.js) — 2026-11-04
  const outlines = [[[5, 5], [25, 5], [25, 25], [5, 25]], [[35, 5], [55, 5], [55, 25], [35, 25]], [[65, 5], [85, 5], [85, 25], [65, 25]]];
  const replies = await Promise.all(outlines.map((o, i) => call('create_room', { name: aName, room: 'Room ' + (i + 1), outline: o })));
  rig.check(replies.every(r => !r.isError), 'setup: a create_room call was refused: ' + JSON.stringify(replies).slice(0, 200));
  const rooms = JSON.parse(await dm.evaluate('sceneStore.loadScene(' + JSON.stringify(aId) + ').then(r => JSON.stringify((r.polygons || []).map(p => p.name)))'));
  rig.check(rooms.length === 3, 'three rooms drawn at once on a closed map left ' + JSON.stringify(rooms));

  // ── B. Undo never deletes a map in play ───────────────────────────────────
  // RED ON: mcpRefuseRemovingOpen() removed from create_scene's undo (mcpScenes.js) — 2026-11-04
  const still = await rig.fixtures.stillMap(dm, rig.fixtureDir, { w: 900, h: 600, name: 'in-play-crypt.png' });
  const mapDir = path.join(rig.fixtureDir, 'in-play-maps');
  fs.mkdirSync(mapDir, { recursive: true });
  fs.copyFileSync(still.path, path.join(mapDir, 'in-play-crypt.png'));
  await call('create_scene', { path: path.join(mapDir, 'in-play-crypt.png'), name: 'Crypt In Play' });
  const cId = await dm.evaluate('(allScenes.find(s => s.name === "Crypt In Play") || {}).id');
  rig.check(!!cId, 'setup: the assistant\'s map is not in the library');
  if (!cId) return;
  await dm.evaluate('switchScene(' + JSON.stringify(cId) + ')', 60000);
  const player = await rig.player();
  await lib.settle(player, 'mapOffscreen && mapOffscreen.width === 900 && fogCoverT === 0', 30000);
  await dm.evaluate('polygons = [{ id: 1, vertices: [{ x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 400 },' +
    ' { x: 100, y: 400 }], mode: "reveal", cornerRadius: 0, name: "Altar" }]; nextPolygonId = 2; ' + lib.SETTLE);
  await dm.evaluate('doAutoSave()');
  const undone = await call('undo_last_change');
  const stored = await dm.evaluate('sceneStore.loadScene(' + JSON.stringify(cId) + ').then(r => ({ there: !!r, rooms: r ? (r.polygons || []).length : 0 }))');
  rig.check(stored.there && stored.rooms === 1, 'the assistant\'s undo deleted the map the DM is playing on the TV: ' + JSON.stringify({ stored, undone }).slice(0, 300));
  rig.check(!!undone.isError && /open/.test(undone.text || ''), 'the undo of a map in play did not say why it was refused: ' + JSON.stringify(undone).slice(0, 200));
  rig.check(await dm.evaluate('currentScene && currentScene.id === ' + JSON.stringify(cId)), 'the DM was moved off the map in play');
  const kept = await dm.evaluate('_mcpSteps.length > 0 && /created/.test(_mcpSteps[_mcpSteps.length - 1].label)');
  rig.check(kept, 'the refused undo dropped its step, so the map can never be undone later');
};
