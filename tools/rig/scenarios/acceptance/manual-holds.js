'use strict';

// manual-holds.js — MANUAL HOLDS EVERYTHING ABOUT THE MAP UNTIL SEND.
//
// THE GOAL: in Manual (autoSync off) nothing about the map reaches the TV until the DM presses Send,
// and Send then delivers it all together. Auto is unchanged. A ping and a gallery picture are live.
//
//   A. In Manual, opening another map leaves the TV on the old map, uncovered, with its fog and
//      framing as they were. Send then delivers the new map.
//   B. In Auto, opening a map still reaches the TV.
//   C. In Manual, a drag on the minimap reaches the TV only on Send.
//   D. In Manual, a Turn reaches the TV only on Send.
//   E. A ping does nothing while the TV shows a different map from the open one, and works again
//      after Send.
//   F. Fog animation settings change on the DM and reach the TV only on Send.
//   G. Manual to Auto with a change waiting sends it at once.
//
// ⚠ THE TV IS READ ON THE PLAYER'S OWN GLOBALS (mapWidth, panX, zoom, seatTurn, fogCoverT). The two
// maps differ in width so which one the TV shows is never in doubt.

const lib = require('../../lib');

const A_MAP = { w: 1200, h: 800 };
const B_MAP = { w: 1000, h: 700 };

module.exports = async function manualHolds(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, A_MAP);
  const aId = await dm.evaluate('currentScene.id');
  await lib.openMap(rig, B_MAP);
  const bId = await dm.evaluate('currentScene.id');
  rig.check(await dm.evaluate('autoSync === true'), 'auto-sync is off at the start, so nothing below proves a hold');

  const player = await rig.player();
  await player.waitFor('!!mapOffscreen && mapWidth === ' + B_MAP.w, 45000, 'the second map to reach the Player');
  await player.waitFor('fogCoverT === 0', 45000, 'the scene cover to lift on the Player');
  const open = (id, w) => dm.evaluate('switchScene(' + JSON.stringify(id) + '); 0')
    .then(() => dm.waitFor('currentScene && currentScene.id === ' + JSON.stringify(id) + ' && mapWidth === ' + w, 60000, 'the DM to open the map'));
  const toggleAuto = () => dm.evaluate('document.getElementById("btn-auto-sync").click(); 0');
  const view = () => player.evaluate('({ x: panX, y: panY, z: zoom })');
  const same = (a, b) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.z - b.z) < 1e-6;

  // ── A ──
  // RED BY DESIGN: written against item 217, never re-proved
  await toggleAuto();
  rig.check(await dm.evaluate('autoSync === false'), 'A: Manual did not switch on');
  const before = await view();
  await open(aId, A_MAP.w);
  await lib.hold(3500, 'longer than the scene cover takes to close, so a wrongly posted cover or map would have landed');
  const held = await player.evaluate('({ w: mapWidth, cover: fogCoverT, dark: document.getElementById("scene-fade").classList.contains("dark") })');
  rig.check(held.w === B_MAP.w && held.cover === 0 && !held.dark,
            'A: in Manual, opening another map reached the TV (it closed its fog or changed map): ' + JSON.stringify(held));
  rig.check(same(before, await view()), 'A: in Manual, opening another map moved the TV\'s framing');
  rig.check(await dm.evaluate('playerUnsent === true && tvWait.scene === true'), 'A: the held map change did not mark Send as waiting');
  await dm.evaluate('document.getElementById("btn-send").click(); 0');
  const landed = await lib.settle(player, 'mapWidth === ' + A_MAP.w + ' && fogCoverT === 0', 45000);
  rig.check(landed, 'A: Send did not deliver the new map to the TV');
  rig.check(await dm.evaluate('playerUnsent === false && tvWait.scene === false'), 'A: Send left the map change marked as waiting');

  // ── E ──
  // RED BY DESIGN: written against item 217, never re-proved
  const pings = () => player.evaluate('!!document.getElementById("ping-canvas")');
  await open(bId, B_MAP.w);
  await dm.evaluate('pingAt(100, 100); 0');
  await lib.hold(1000, 'long enough for a ping that wrongly went out to reach the Player');
  rig.check(!(await pings()), 'E: a ping reached the TV while it showed a different map');
  await dm.evaluate('document.getElementById("btn-send").click(); 0');
  await lib.settle(player, 'mapWidth === ' + B_MAP.w + ' && fogCoverT === 0', 45000);
  await dm.evaluate('pingAt(100, 100); 0');
  rig.check(await lib.settle(player, '!!document.getElementById("ping-canvas")', 8000), 'E: a ping did not reach the TV after Send put the map there');

  // ── C ──
  // RED BY DESIGN: written against item 217, never re-proved
  await lib.settle(player, '!viewLerpActive', 8000);
  const v0 = await view();
  await dm.evaluate(`(() => {
    const c = document.getElementById('minimap-canvas'), r = c.getBoundingClientRect();
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    const orig = c.setPointerCapture; c.setPointerCapture = () => {};
    const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { pointerId: 9, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    ev('pointerdown', x0, y0); ev('pointermove', x0 + 30, y0 + 20); ev('pointerup', x0 + 30, y0 + 20);
    c.setPointerCapture = orig; return 0;
  })()`);
  await lib.hold(1200, 'long enough for a view-snap that wrongly went out at once to land and finish its lerp');
  rig.check(same(v0, await view()), 'C: in Manual a drag on the minimap moved the TV before Send');
  rig.check(await dm.evaluate('playerUnsent === true && tvWait.view === true'), 'C: the held drag did not mark Send as waiting');
  await dm.evaluate('document.getElementById("btn-send").click(); 0');
  const moved = await lib.poll(async () => { const v = await view(); return same(v0, v) ? null : { v }; }, 15000);
  rig.check(!!moved, 'C: Send did not carry the minimap\'s framing to the TV');

  // ── D ──
  // RED BY DESIGN: written against item 217, never re-proved
  await dm.evaluate('setSceneFit(1); 0');
  await lib.hold(1200, 'long enough for a tv-fit that wrongly went out at once to turn the Player');
  rig.check(await player.evaluate('seatTurn') === 0, 'D: in Manual a Turn turned the TV before Send');
  rig.check(await dm.evaluate('tvFit.turn === 270 && playerUnsent === true && tvWait.turn === true'), 'D: the held Turn did not mark Send as waiting');
  await dm.evaluate('document.getElementById("btn-send").click(); 0');
  rig.check(await lib.settle(player, 'seatTurn === 270', 15000), 'D: Send did not carry the Turn to the TV');
  await dm.evaluate('setSceneFit(0); document.getElementById("btn-send").click(); 0');
  await lib.settle(player, 'seatTurn === 0', 15000);

  // ── F ──
  // RED BY DESIGN: written against item 217, never re-proved
  const speed = await player.evaluate('fogAnimSpeed');
  await dm.evaluate('fogAnimSpeed = ' + (speed + 0.37) + '; syncAnimToPlayer(); 0');
  await lib.hold(800, 'long enough for an anim-params that wrongly went out at once to land');
  rig.check(await player.evaluate('fogAnimSpeed') === speed, 'F: in Manual a fog animation change reached the TV before Send');
  rig.check(await dm.evaluate('tvWait.anim === true && playerUnsent === true'), 'F: the held animation change did not mark Send as waiting');
  await dm.evaluate('document.getElementById("btn-send").click(); 0');
  rig.check(await lib.settle(player, 'Math.abs(fogAnimSpeed - ' + (speed + 0.37) + ') < 1e-9', 8000), 'F: Send did not carry the animation settings');
  await dm.evaluate('fogAnimSpeed = ' + speed + '; syncAnimToPlayer(); document.getElementById("btn-send").click(); 0');

  // ── G ──
  // RED BY DESIGN: written against item 217, never re-proved
  await open(aId, A_MAP.w);
  await lib.hold(1000, 'the switch is held; nothing is waited for');
  rig.check(await player.evaluate('mapWidth') === B_MAP.w, 'G: the held map change reached the TV before Auto came back');
  await toggleAuto();
  rig.check(await dm.evaluate('autoSync === true'), 'G: Auto did not switch back on');
  rig.check(await lib.settle(player, 'mapWidth === ' + A_MAP.w + ' && fogCoverT === 0', 45000), 'G: Manual to Auto did not send the waiting map change');

  // ── B ──
  // RED BY DESIGN: written against item 217, never re-proved
  await open(bId, B_MAP.w);
  rig.check(await lib.settle(player, 'mapWidth === ' + B_MAP.w + ' && fogCoverT === 0', 45000), 'B: in Auto, opening a map did not reach the TV');
  rig.check(await dm.evaluate('tvWait.scene === false && playerUnsent === false'), 'B: Auto left a map change marked as waiting');
};
