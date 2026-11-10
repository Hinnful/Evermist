'use strict';

// door-glow.js — A DOOR GLOWS ON THE TV ONLY FROM A REVEALED ROOM INTO HIDDEN FOG.
//
// THE CRITERIA ARE THIS HEADER. Each has its check beneath it, in the same order. The glow is read off the
// Player's own fog mesh: the brightest painted pixel just past each notch, on both sides of the wall, less the
// brightest at the same distance from the same wall three squares along it, where no door is.
//
//   1. Draw Rooms on a plan of eight rooms in a row gives four doors, one between each pair.
//   2. Revealed|hidden glows on the TV.
//   3. Revealed|half does not glow.
//   4. Half|half does not glow.
//   5. Half|hidden does not glow.
//   6. The TV around the revealed|hidden door is screenshotted for the eye.
//   7. Revealed|hidden still cuts its notch: the hidden side of the doorway is cleared on the TV's fog.
//   8. Revealed|half cuts no notch: on both sides of the doorway the TV's fog matches the same room two
//      squares along the wall.
//   9. Half|half cuts no notch, read the same way.
//  10. Half|hidden cuts no notch, read the same way.
//  11. The TV around each half door is screenshotted for the eye.

const path = require('path');
const lib = require('../lib');

const _seg = (a, b, c, d) => [{ x: a, y: b }, { x: c, y: d }];
// Eight rooms three squares wide between x 2 and 26, with a portal in the walls at 5, 11, 17 and 23 only.
const WALLS = [5, 8, 11, 14, 17, 20, 23];
const DOORS = [5, 11, 17, 23];
const PLAN = JSON.stringify({
  format: 0.3,
  resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 31, y: 21 }, pixels_per_grid: 100 },
  line_of_sight: [_seg(2, 2, 26, 2), _seg(26, 2, 26, 19), _seg(26, 19, 2, 19), _seg(2, 19, 2, 2)]
    .concat(WALLS.flatMap(x => DOORS.includes(x) ? [_seg(x, 2, x, 9), _seg(x, 10, x, 19)] : [_seg(x, 2, x, 19)])),
  portals: DOORS.map(x => ({ bounds: _seg(x, 9, x, 10) })),
});
const MODES = ['reveal', 'shroud', 'reveal', 'half', 'half', 'half', 'half', 'shroud'];
const CASES = ['revealed|hidden', 'revealed|half', 'half|half', 'half|hidden'];
const LIT = 20;   // painted luma, 0..255, above the brightest fog at the same distance from the wall
const NOTCH = 15; // fog alpha, 0..255, a doorway may differ from the same room two squares along the wall

const GLOW = `globalThis.__rigGlow = (doors, depth) => {
  const c = pixiApp.renderer.extract.canvas(pixiPFogMesh), W = c.width, H = c.height;
  const px = c.getContext('2d').getImageData(0, 0, W, H).data;
  const lum = (mx, my) => {
    const sx = Math.round(mx * zoom + panX), sy = Math.round(my * zoom + panY);
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) return 0;
    const i = (sy * W + sx) * 4;
    return (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) * px[i + 3] / 255;
  };
  return doors.map(d => [-1, 1].map(s => {
    let hot = 0, ref = 0;
    for (let k = depth + 2; k <= depth * 2.4; k += 2) {
      for (const dy of [-8, 0, 8]) hot = Math.max(hot, lum(d.x + s * k, d.y + dy));
      for (const dy of [-300, -250, 250, 300]) ref = Math.max(ref, lum(d.x + s * k, d.y + dy));
    }
    return { hot: Math.round(hot), ref: Math.round(ref), glow: Math.round(hot - ref) };
  }));
}; 0`;

module.exports = async function doorGlow(rig) {
  await lib.importWithPlan(rig, 'Door glow', PLAN);
  const dm = rig.dm;
  const rooms = await lib.drawRooms(rig, 8);

  // ── 1 ──
  const doors = await dm.evaluate(`polygons.flatMap(p => (p.doors || []).map(d => doorPoint(p, d)))
    .filter(Boolean).map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })).sort((a, b) => a.x - b.x)`);
  rig.note('doors: ' + JSON.stringify(doors));
  if (!rig.check(rooms.length === 8 && doors.length === 4, '1: Draw Rooms did not give 8 rooms and 4 doors: ' +
    rooms.length + ' rooms, ' + doors.length + ' doors')) return;

  for (const [i, r] of rooms.entries()) await dm.evaluate('setPolygonMode(' + JSON.stringify(r.id) + ', ' + JSON.stringify(MODES[i]) + '); 0');
  const depth = await dm.evaluate('doorSizeForCell(doorCellSize(), doorWidthPct, doorDepthPct).depth');
  rig.note('door depth ' + depth + ', doors sent to the TV: ' + await dm.evaluate('doorLightQuads().length'));

  const player = await rig.player();
  await lib.installHelpers(player);
  await lib.settle(player, '!!mapOffscreen && fogCoverT === 0 && !viewLerpActive', 60000);
  const landed = await lib.poll(async () => {
    const a = await Promise.all([0, 1, 3].map(i => lib.tvFog(player, rooms[i].cx, rooms[i].cy)));
    return a[0] < 30 && a[1] > 220 && a[2] > 100 && a[2] < 160 ? { a } : null;
  }, 30000);
  rig.check(!!landed, 'setup: the TV fog never showed revealed, hidden and half rooms');
  await player.evaluate(GLOW);

  // The glow rides the fog's own reveal clock, so the verdict is two readings in a row that agree.
  const read = async () => (await player.evaluate('__rigGlow(' + JSON.stringify(doors) + ', ' + depth + ')'))
    .map(sides => Math.max(sides[0].glow, sides[1].glow));
  const want = g => g[0] > LIT && g.slice(1).every(v => v <= LIT);
  let last = null;
  await lib.poll(async () => {
    const g = await read();
    const ok = last && want(last) && want(g);
    last = g;
    return ok ? { g } : null;
  }, 20000, 500);
  rig.note('glow per door (' + CASES.join(', ') + '): ' + JSON.stringify(last) +
    '; both sides: ' + JSON.stringify(await player.evaluate('__rigGlow(' + JSON.stringify(doors) + ', ' + depth + ')')));

  // ── 2..5 ──
  rig.check(last[0] > LIT, '2: the revealed|hidden door does not glow on the TV: ' + last[0]);
  for (let i = 1; i < 4; i++) rig.check(last[i] <= LIT, (i + 2) + ': the ' + CASES[i] + ' door glows on the TV: ' + last[i]);

  // ── 6 ──
  const at = await player.evaluate(`(() => { const r = container.getBoundingClientRect();
    return { x: ${doors[0].x} * zoom + panX + r.left, y: ${doors[0].y} * zoom + panY + r.top, z: zoom }; })()`);
  const s = Math.round(400 * at.z);
  const crop = path.join(rig.outDir, 'door-glow-tv-crop.png'), full = path.join(rig.outDir, 'door-glow-tv.png');
  await player.screenshot(crop, { x: Math.round(at.x - s / 2), y: Math.round(at.y - s / 2), width: s, height: s });
  await player.screenshot(full);
  rig.note('6: TV screenshots: ' + full + ' and ' + crop);
  rig.byEye('6: the revealed|hidden door glows as it did before the rule');

  // Half way into the notch on each side, against the same room two squares along the wall.
  const notch = async () => Promise.all(doors.map(async d => Promise.all([-1, 1].map(async sd => {
    const x = d.x + sd * depth / 2, at = [], ref = [];
    for (const dy of [-10, 0, 10]) {
      at.push(await lib.tvFog(player, x, d.y + dy));
      ref.push(await lib.tvFog(player, x, d.y - 200 + dy), await lib.tvFog(player, x, d.y + 200 + dy));
    }
    const refMean = ref.reduce((a, b) => a + b, 0) / ref.length;
    return { at, ref: Math.round(refMean), off: Math.max(...at.map(v => Math.abs(v - refMean))) };
  }))));
  const clear = n => n[0][1].at.every(v => v < n[0][1].ref / 2);
  const flat = n => n.slice(1).every(sides => sides.every(sd => sd.off <= NOTCH));
  let fog = null;
  await lib.poll(async () => { fog = await notch(); return clear(fog) && flat(fog) ? { fog } : null; }, 10000, 500);
  rig.note('fog in each doorway, [left, right] (' + CASES.join(', ') + '): ' + JSON.stringify(fog));

  // ── 7 ──
  rig.check(clear(fog), '7: the revealed|hidden door no longer clears its notch on the hidden side: ' + JSON.stringify(fog[0][1]));
  // ── 8..10 ──
  for (let i = 1; i < 4; i++) {
    const worst = Math.max(fog[i][0].off, fog[i][1].off);
    rig.check(worst <= NOTCH, (i + 7) + ': the ' + CASES[i] + ' door cuts a notch in the TV fog: ' + worst.toFixed(0) +
      ' off the room two squares along, ' + JSON.stringify(fog[i]));
  }

  // ── 11 ──
  for (let i = 1; i < 4; i++) {
    const p = await player.evaluate(`(() => { const r = container.getBoundingClientRect();
      return { x: ${doors[i].x} * zoom + panX + r.left, y: ${doors[i].y} * zoom + panY + r.top }; })()`);
    const shot = path.join(rig.outDir, 'door-notch-' + CASES[i].replace('|', '-') + '.png');
    await player.screenshot(shot, { x: Math.round(p.x - s / 2), y: Math.round(p.y - s / 2), width: s, height: s });
    rig.note('11: ' + CASES[i] + ' screenshot: ' + shot);
  }
  rig.byEye('11: no half door shows a notch cut into its fog');
};
