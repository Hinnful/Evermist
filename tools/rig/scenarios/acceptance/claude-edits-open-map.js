'use strict';

// claude-edits-open-map.js — CLAUDE CHANGES THE MAP THE DM HAS OPEN, AND THE TV NEVER HEARS OF IT.
//
// THE GOAL: a map open on the DM's screen but not on the TV is prep. Claude changes it live, the DM sees
// it at once, Claude's undo takes it back, and nothing of it reaches the Player window.
// It drives src/mcp/mcpMapEdit.js and src/mcp/mcpMapPlan.js through set_scene (mcpScenes.js).
//
// The TV is held off the open map the way the app holds it: the open map is deleted, the DM lands on the
// first map, and the TV shows its waiting screen (delete-open-scene.js).
//
//   A. set_scene changes the fog colour of the open map that the TV does not show, and the DM window shows it.
//   B. undo_last_change puts the old colour back on the DM window.
//   C. The Player window never received the new colour.

const fs = require('fs');
const path = require('path');
const lib = require('../../lib');

const ONE_W = 1200, ONE_H = 800;
const TWO_W = 1000, TWO_H = 700;
const HEX = '#c0ffee';

module.exports = async function claudeEditsOpenMap(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: ONE_W, h: ONE_H });
  const one = await dm.evaluate('currentScene.id');
  const name = await dm.evaluate('currentScene.name');
  await lib.openMap(rig, { w: TWO_W, h: TWO_H });
  const two = await dm.evaluate('currentScene.id');

  const player = await rig.player();
  await player.waitFor('!!mapOffscreen && mapWidth === ' + TWO_W, 45000, 'the second map to reach the Player');
  await player.evaluate('window.__claudeHeard = []; window.addEventListener("message", e => __claudeHeard.push(JSON.stringify(e.data || null))); 0');

  await dm.evaluate('worldMapShow(); 0');
  await lib.settle(dm, 'worldMapOpen && !_wmAnim', 10000);
  await dm.evaluate('_wmDeletePicked(["' + two + '"]); 0');
  await lib.settle(dm, 'currentScene && currentScene.id === "' + one + '" && mapWidth === ' + ONE_W + ' && tvHeld', 60000);
  await dm.evaluate('worldMapHide(); 0');
  rig.check(await dm.evaluate('tvHeld && currentScene.id === "' + one + '"'), 'the TV was not held off the open map, so nothing below tests a map open but not on the TV');

  const address = await lib.poll(async () => {
    try { return JSON.parse(fs.readFileSync(path.join(rig.profileDir, 'mcp.json'), 'utf8')); } catch { return null; }
  }, 15000);
  rig.check(!!(address && address.port && address.token), 'the app wrote no mcp.json with a port and a key into its profile');
  if (!address) return;
  const call = async (tool, args) => (await fetch('http://127.0.0.1:' + address.port + '/call', {
    method: 'POST', body: JSON.stringify({ tool, args: args || {} }),
    headers: { 'content-type': 'application/json', 'x-evermist-token': address.token },
  })).json();

  // ── A ──
  // RED BY DESIGN: written against the feature, never re-proved
  const before = await dm.evaluate('fogPickedHex');
  const set = await call('set_scene', { name, fogColor: HEX });
  const shown = await dm.evaluate('({ hex: fogPickedHex, field: document.getElementById("fog-color").value })');
  rig.check(!set.isError && shown.hex === HEX && shown.field === HEX,
            'A: the open map\'s fog colour did not change on the DM window: ' + JSON.stringify({ set, shown }));

  // ── B ──
  // RED BY DESIGN: written against the feature, never re-proved
  const undone = await call('undo_last_change');
  rig.check(!undone.isError && await dm.evaluate('fogPickedHex') === before,
            'B: undo_last_change did not put the old fog colour back: ' + JSON.stringify(undone));

  // ── C ──
  // RED BY DESIGN: written against the feature, never re-proved
  await lib.hold(3000, 'long enough for a push of the colour to have reached the Player');
  const heard = await player.evaluate('__claudeHeard.filter(m => m.toLowerCase().includes("' + HEX + '"))');
  rig.check(heard.length === 0 && await player.evaluate('fogPickedHex') !== HEX,
            'C: the Player window received Claude\'s fog colour: ' + JSON.stringify(heard));
};
