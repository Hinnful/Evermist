'use strict';

// claude-rooms.js — CLAUDE DRAWS ROOMS AND DOORS ON A MAP NOBODY HAS OPEN.
//
// THE GOAL: Claude's room tools (src/mcp/mcpRooms.js and src/mcp/mcpRoomsPlan.js) change a closed map's stored rooms the way the DM's own
// tools would, read_scene reports the result at once, and each call is one step undo_last_change takes back.
//
//   A. create_room twice puts two rooms in the closed map's stored scene, and leaves the open map alone.
//   B. merge_rooms joins the two side by side into one room that keeps the first one's name.
//   C. add_door puts one door on the merged room's wall.
//   D. undo_last_change takes the door away and leaves the merged room.
//   E. read_scene reports the stored rooms as they are now.

const fs = require('fs');
const path = require('path');
const lib = require('../../lib');

const ONE_W = 1200, ONE_H = 800;
const TWO_W = 1000, TWO_H = 700;

module.exports = async function claudeRooms(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: ONE_W, h: ONE_H });
  const one = await dm.evaluate('currentScene.id');
  const name = await dm.evaluate('currentScene.name');
  await lib.openMap(rig, { w: TWO_W, h: TWO_H });
  rig.check(await dm.evaluate('currentScene.id !== "' + one + '"'), 'the first map is still open, so nothing below tests a closed map');

  const address = await lib.poll(async () => {
    try { return JSON.parse(fs.readFileSync(path.join(rig.profileDir, 'mcp.json'), 'utf8')); } catch { return null; }
  }, 15000);
  rig.check(!!(address && address.port && address.token), 'the app wrote no mcp.json with a port and a key into its profile');
  if (!address) return;
  const call = async (tool, args) => (await fetch('http://127.0.0.1:' + address.port + '/call', {
    method: 'POST', body: JSON.stringify({ tool, args: args || {} }),
    headers: { 'content-type': 'application/json', 'x-evermist-token': address.token },
  })).json();
  const stored = () => dm.evaluate('sceneStore.loadScene(' + JSON.stringify(one) + ').then(r => (r.polygons || []).map(p => ({ name: p.name, doors: (p.doors || []).length })))');

  // ── A ──
  // RED BY DESIGN: written against the feature, never re-proved
  const hall = await call('create_room', { name, room: 'Hall', outline: [[10, 10], [30, 10], [30, 30], [10, 30]] });
  const vault = await call('create_room', { name, room: 'Vault', outline: [[30, 10], [50, 10], [50, 30], [30, 30]], fog: 'revealed' });
  const made = await stored();
  rig.check(!hall.isError && !vault.isError && made.length === 2 && made[0].name === 'Hall' && made[1].name === 'Vault',
            'A: the closed map did not store the two rooms Claude drew: ' + JSON.stringify({ hall, vault, made }));
  rig.check(await dm.evaluate('polygons.length === 0'), 'A: Claude\'s rooms landed on the open map instead of the closed one');

  // ── B ──
  // RED BY DESIGN: written against the feature, never re-proved
  const merged = await call('merge_rooms', { name, rooms: ['Hall', 'Vault'] });
  const one2 = await stored();
  rig.check(!merged.isError && one2.length === 1 && one2[0].name === 'Hall',
            'B: merge_rooms did not leave one room called Hall: ' + JSON.stringify({ merged, one2 }));

  // ── C ──
  // RED BY DESIGN: written against the feature, never re-proved
  const door = await call('add_door', { name, at: [20, 10] });
  const withDoor = await stored();
  rig.check(!door.isError && withDoor.length === 1 && withDoor[0].doors === 1,
            'C: add_door did not put one door on the merged room: ' + JSON.stringify({ door, withDoor }));

  // ── D ──
  // RED BY DESIGN: written against the feature, never re-proved
  const undone = await call('undo_last_change');
  const after = await stored();
  rig.check(!undone.isError && after.length === 1 && after[0].name === 'Hall' && after[0].doors === 0,
            'D: undo_last_change did not take only the door away: ' + JSON.stringify({ undone, after }));

  // ── E ──
  // RED BY DESIGN: written against the feature, never re-proved
  const read = await call('read_scene', { name });
  let rooms = null;
  try { rooms = JSON.parse(read.text).rooms; } catch { rooms = null; }
  rig.check(!!rooms && rooms.length === 1 && rooms[0].name === 'Hall' && rooms[0].doors.length === 0 && rooms[0].fog === 'hidden',
            'E: read_scene did not report the one hidden room Hall with no door: ' + JSON.stringify(read));
};
