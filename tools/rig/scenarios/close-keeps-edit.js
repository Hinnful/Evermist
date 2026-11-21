'use strict';

// close-keeps-edit.js — A CHANGE MADE JUST BEFORE CLOSING IS KEPT (BACKLOG 306).
//
// A map with its three floor-plan rooms, all fogged and saved. The app is closed the DM's way, from outside
// (rig.restart({ quit: 'os' })), well inside the 5 s autosave delay.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   A. A room revealed and the app closed at once comes back revealed after a restart, in the stored record and
//      in the fog on screen.
//   B. With the store never answering, closing still ends the app within the 5 s cap (plus the exit itself).

const lib = require('../lib');

const NAME = 'Склеп';
const CAP_MS = 5000;

module.exports = async function closeKeepsEdit(rig) {
  let dm = rig.dm;
  const sceneId = await lib.importWithPlan(rig, NAME);
  const rooms = await lib.drawRooms(rig, 3);
  rig.check(rooms.length === 3, 'setup: the plan did not give three rooms: ' + rooms.length);
  const room = rooms[0];

  const storedModes = () => dm.evaluate(`(async () => {
    const s = await sceneStore.loadScene(${JSON.stringify(sceneId)});
    return s && s.baseFogBlob ? (s.polygons || []).map(p => ({ id: p.id, mode: p.mode })) : null;
  })()`, 30000);
  // The fogged rooms on disk first, so the restart below asks only about the reveal.
  await dm.evaluate('scheduleAutoSave(); 0');
  const base = await lib.poll(async () => { const m = await storedModes(); return m && m.length === 3 ? { m } : null; }, 60000, 500);
  rig.check(!!base && base.m.every(p => p.mode !== 'reveal'), 'setup: the three fogged rooms never reached the disk: ' + JSON.stringify(base));

  // ── Control: the same edit closed by the page itself, which main's hold never sees ─
  // A noted reading, not a check: it shows what a close did before the hold, beforeunload alone.
  const ctl = rooms[2];
  await dm.evaluate('setPolygonMode(' + ctl.id + ', "reveal"); scheduleAutoSave(); 0');
  dm = await rig.restart();
  await lib.settle(dm, 'currentScene && mapWidth > 0', 120000);
  const ctlModes = await storedModes();
  const ctlGot = ctlModes && ctlModes.find(p => p.id === ctl.id);
  rig.note('control: a page close (beforeunload only) ' + (ctlGot && ctlGot.mode === 'reveal' ? 'KEPT' : 'LOST') + ' the reveal');
  await dm.evaluate('setPolygonMode(' + ctl.id + ', "shroud"); 0');
  await lib.installHelpers(dm);

  // ── A. Revealed, closed at once, kept ─────────────────────────────────────
  // RED ON: main.js's 'close' hold removed — the reveal never reaches the disk.
  await dm.evaluate('setPolygonMode(' + room.id + ', "reveal"); scheduleAutoSave(); 0');
  dm = await rig.restart({ quit: 'os' });
  rig.note('A: the close took ' + rig.quitMs + ' ms');
  rig.check(rig.quitMs !== null, 'A: the app did not exit within 15 s of being closed');
  await lib.installHelpers(dm);
  await lib.settle(dm, 'currentScene && fogCoverT === 0 && mapWidth > 0', 120000);
  const after = await storedModes();
  const got = after && after.find(p => p.id === room.id);
  rig.check(!!got && got.mode === 'reveal', 'A: the room revealed just before closing is not revealed on disk: ' + JSON.stringify(after));
  const clear = await lib.poll(async () => {
    const a = await dm.evaluate('__rigFog(' + Math.round(room.cx) + ',' + Math.round(room.cy) + ')');
    return a < 128 ? { a } : null;
  }, 30000);
  rig.check(!!clear, 'A: the room revealed just before closing is fogged again after the restart');

  // ── B. A store that never answers cannot hold the close ───────────────────
  // RED ON: the cap's timer in main.js removed — the close waits forever and the rig kills the app at 15 s.
  const other = rooms[1];
  await dm.evaluate('sceneStore.saveScene = () => new Promise(() => {}); setPolygonMode(' + other.id + ', "reveal"); 0');
  dm = await rig.restart({ quit: 'os' });
  rig.note('B: the close with a hung store took ' + rig.quitMs + ' ms');
  rig.check(rig.quitMs !== null && rig.quitMs < CAP_MS + 4000,
            'B: with the store hung, closing took ' + rig.quitMs + ' ms, past the ' + CAP_MS + ' ms cap');
  await lib.settle(dm, 'currentScene && mapWidth > 0', 120000);
  rig.check(await dm.evaluate('!!currentScene && currentScene.id === ' + JSON.stringify(sceneId)),
            'B: the app did not come back on the same map after the capped close');
};
