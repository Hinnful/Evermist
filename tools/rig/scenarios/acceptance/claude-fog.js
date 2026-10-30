'use strict';

// claude-fog.js — CLAUDE CHANGES A MAP'S FOG, AND THE TV NEVER HEARS OF IT.
//
// THE GOAL: Claude's fog tools (src/mcp/mcpFog.js and src/mcp/mcpFogPlan.js: set_room_fog, set_fog_area, set_fog_all, set_fog_look) change a
// room's fog, a rectangle of painted fog, the whole map and the fog's look the way the DM's own controls would. A map the
// DM has open changes on their screen, a closed map in the store, each call is one step undo_last_change takes back,
// and the Player window receives nothing.
//
// Two maps are driven the same way: one OPEN on the DM window but not on the TV (the TV is held on its waiting screen,
// as delete-open-scene.js holds it), one CLOSED in the library. The state is read from the live window for the first and
// from the stored scene for the second.
//
//   A. set_room_fog turns a room to revealed, on the open map and on the closed one, and undo puts it back to hidden.
//   B. set_fog_area reveals a rectangle: the painted fog there turns clear, the fog outside it stays, undo repaints it.
//   C. set_fog_all reveals the whole map, every room included, and undo takes the whole change back.
//   D. set_fog_look sets the drift and the tint, and undo puts the old look back.
//   E. The Player window received no message about any of it.

const lib = require('../../lib');

const ROOM = [[10, 10], [30, 10], [30, 30], [10, 30]];

module.exports = async function claudeFog(rig) {
  const dm = rig.dm;
  const { player, open, closed } = await lib.openMapsOffTv(rig);
  rig.check(await dm.evaluate('tvHeld && currentScene.id === "' + open.id + '"') && !!closed,
            'the TV was not held off an open map with a closed one beside it, so nothing below tests both');
  const call = await lib.mcpClient(rig);
  rig.check(!!call, 'the app wrote no mcp.json with a port and a key into its profile');
  if (!call) return;

  await dm.evaluate(`(() => {
    globalThis.__cf = {
      alpha: async (id, px, py) => {
        let c;
        if (currentScene && currentScene.id === id) c = baseFogCanvas;
        else {
          const rec = await sceneStore.loadScene(id);
          const src = rec.baseFogBlob || (rec.baseFogPNG ? await (await fetch(rec.baseFogPNG)).blob() : null);
          c = document.createElement('canvas');
          c.width = Math.ceil(rec.mapWidth / FOG_SCALE); c.height = Math.ceil(rec.mapHeight / FOG_SCALE);
          const ctx = c.getContext('2d');
          if (src) ctx.drawImage(await createImageBitmap(src), 0, 0, c.width, c.height);
          else { ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0, 0, c.width, c.height); }
        }
        return c.getContext('2d').getImageData(Math.floor(px / 100 * c.width), Math.floor(py / 100 * c.height), 1, 1).data[3];
      },
      state: async id => {
        if (currentScene && currentScene.id === id) {
          return { rooms: polygons.map(p => ({ name: p.name, mode: p.modeWithHoles || p.mode })), hex: fogPickedHex, speed: fogAnimSpeed };
        }
        const rec = await sceneStore.loadScene(id);
        const f = rec.fogSettings || {};
        return { rooms: (rec.polygons || []).map(p => ({ name: p.name, mode: p.modeWithHoles || p.mode })),
                 hex: f.pickedHex || null, speed: f.anim ? f.anim.speed : null };
      },
    };
    return 0;
  })()`);
  const alpha = (id, x, y) => dm.evaluate('__cf.alpha(' + JSON.stringify(id) + ', ' + x + ', ' + y + ')');
  const state = id => dm.evaluate('__cf.state(' + JSON.stringify(id) + ')');

  for (const [where, map] of [['open map', open], ['closed map', closed]]) {
    const at = { name: map.name };
    const made = await call('create_room', { ...at, room: 'Hall', outline: ROOM });
    rig.check(!made.isError && (await state(map.id)).rooms.length === 1 && (await state(map.id)).rooms[0].mode === 'shroud',
              where + ': the hidden room the fog tests start from was not drawn: ' + JSON.stringify(made));

    // ── A ──
    // RED BY DESIGN: written against the feature, never re-proved
    const set = await call('set_room_fog', { ...at, rooms: ['Hall'], fog: 'revealed' });
    const revealed = (await state(map.id)).rooms[0].mode;
    rig.check(!set.isError && revealed === 'reveal', 'A: ' + where + ': set_room_fog did not reveal the room: ' + JSON.stringify({ set, revealed }));
    const undoneRoom = await call('undo_last_change');
    rig.check(!undoneRoom.isError && (await state(map.id)).rooms[0].mode === 'shroud',
              'A: ' + where + ': undo_last_change did not put the room back to hidden: ' + JSON.stringify(undoneRoom));

    // ── B ──
    // RED BY DESIGN: written against the feature, never re-proved
    const startMid = await alpha(map.id, 60, 60), startCorner = await alpha(map.id, 90, 90);
    rig.check(startMid >= 200 && startCorner >= 200, 'B: ' + where + ': the map did not start fully fogged (' + startMid + ', ' + startCorner + '), so a reveal proves nothing');
    const area = await call('set_fog_area', { ...at, action: 'reveal', rect: { x: 50, y: 50, w: 20, h: 20 } });
    const midNow = await alpha(map.id, 60, 60), cornerNow = await alpha(map.id, 90, 90);
    rig.check(!area.isError && midNow < 40 && cornerNow >= 200,
              'B: ' + where + ': set_fog_area did not clear the rectangle and leave the rest: ' + JSON.stringify({ area, midNow, cornerNow }));
    const undoneArea = await call('undo_last_change');
    rig.check(!undoneArea.isError && await alpha(map.id, 60, 60) >= 200,
              'B: ' + where + ': undo_last_change did not repaint the rectangle: ' + JSON.stringify(undoneArea));

    // ── C ──
    // RED BY DESIGN: written against the feature, never re-proved
    const all = await call('set_fog_all', { ...at, action: 'reveal' });
    const afterAll = { corner: await alpha(map.id, 90, 90), room: (await state(map.id)).rooms[0].mode };
    rig.check(!all.isError && afterAll.corner < 40 && afterAll.room === 'reveal',
              'C: ' + where + ': set_fog_all did not clear the map and reveal its room: ' + JSON.stringify({ all, afterAll }));
    const undoneAll = await call('undo_last_change');
    const backAll = { corner: await alpha(map.id, 90, 90), room: (await state(map.id)).rooms[0].mode };
    rig.check(!undoneAll.isError && backAll.corner >= 200 && backAll.room === 'shroud',
              'C: ' + where + ': undo_last_change did not put the fog and the room back: ' + JSON.stringify({ undoneAll, backAll }));

    // ── D ──
    // RED BY DESIGN: written against the feature, never re-proved
    const before = await state(map.id);
    const look = await call('set_fog_look', { ...at, preset: 'fast', tint: '#336699' });
    const now = await state(map.id);
    rig.check(!look.isError && now.hex === '#336699' && Math.abs(now.speed - 1) < 0.01,
              'D: ' + where + ': set_fog_look did not set the tint and the fast drift: ' + JSON.stringify({ look, now }));
    const undoneLook = await call('undo_last_change');
    const back = await state(map.id);
    // a map saved before it had a look reads back as the default look, so only a stored one is compared to the digit
    // fast's speed is the default's, so the tint alone tells the undone look from the set one
    rig.check(!undoneLook.isError && back.hex !== '#336699' && (before.hex === null || (back.hex === before.hex && back.speed === before.speed)),
              'D: ' + where + ': undo_last_change did not put the old fog look back: ' + JSON.stringify({ before, back, undoneLook }));
  }

  // ── E ──
  // RED BY DESIGN: written against the feature, never re-proved
  await lib.hold(3000, 'long enough for a push of any of these changes to have reached the Player');
  const heard = await lib.claudeHeard(dm, player);
  rig.check(heard.length === 0 && await player.evaluate('fogPickedHex') !== '#336699',
            'E: the Player window received something of Claude\'s fog changes: ' + JSON.stringify(heard.slice(0, 5)));
};
