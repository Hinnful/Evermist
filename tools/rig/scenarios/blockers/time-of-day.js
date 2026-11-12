'use strict';

// time-of-day.js — TIME OF DAY ON A MAP, ON BOTH SCREENS.
//
// THE CRITERIA ARE THIS HEADER. Each step has its checks beneath it, in the same order. Pixels are read off real
// screenshots of each window (the DM's animated map is a video under the canvas, and only a screenshot sees both),
// as the mean of a small block, in 8-bit sRGB.
//
//   1. Map settings shows Time of day first in Weather and Fog: four icons, None, Day, Dusk, Night, their names as
//      tooltips. Each icon sets the map's time of day and lights alone.
//   2. On a picture map with one room, at Night the TV's ground outside the room is darker and bluer than at None,
//      and a dark interior stays within a small tolerance of None.
//   3. The DM screen moves about a third as far as the TV; holding H shows the full way.
//   4. A change made in Manual reaches the TV without Send, is still mid-way at about 4 s, and settled by 9 s.
//   5. Weather draws on top: Rain over Night changes the TV's pixel again.
//   6. Day lifts a dark pixel on the TV, inside the room and out.
//   7. The pick saves with the map and survives reopening it; None writes no field.
//   8. An animated map shows it on the TV. The DM's imitation is measured against a third of the TV's change at
//      Night, Dusk and Day, and both windows are screenshotted for the eye (step 3 of the spec).
//   9. In two-map mode each column keeps its own time of day, and the control shows the selected column's.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const lib = require('../../lib');

const PIC = 'Ночная площадь', ANIM = 'Ночной склеп';
const PIC_W = 2000, PIC_H = 1400;
const A = { x: 500, y: 700 };     // mid grey ground, far from the room
const B = { x: 1500, y: 700 };    // dark, inside the room
const C = { x: 1100, y: 150 };    // dark ground outside the room
// One room, 12..18 by 4..10 squares of 100px, inside the dark half, with a door (a doorless one is refused as solid).
const _seg = (a, b, c, d) => [{ x: a, y: b }, { x: c, y: d }];
const ROOM_PLAN = JSON.stringify({
  format: 0.3,
  resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 20, y: 14 }, pixels_per_grid: 100 },
  line_of_sight: [_seg(12, 4, 14, 4), _seg(15, 4, 18, 4), _seg(18, 4, 18, 10), _seg(18, 10, 12, 10), _seg(12, 10, 12, 4)],
  portals: [{ bounds: _seg(14, 4, 15, 4) }],
});
const ANIM_OUT = { x: 100, y: 600 };     // left of every hall
const ANIM_IN = { x: 600, y: 600 };      // inside the first hall, clear of the moving ball

// ─── Reading a screenshot ───────────────────────────────────────────────────

function decodePng(buf) {
  let p = 8, w = 0, h = 0, ct = 6;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      let v = raw[y * (stride + 1) + 1 + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, bpp, data: out };
}

let shotN = 0;
// The mean colour a window shows over a block `r` CSS px across, centred on a map point.
async function pixel(rig, session, pt, r) {
  const at = await session.evaluate(`(() => { const b = container.getBoundingClientRect();
    return { x: b.left + ${pt.x} * zoom + panX, y: b.top + ${pt.y} * zoom + panY, w: innerWidth, h: innerHeight }; })()`);
  const s = r || 6;
  if (at.x < s || at.y < s || at.x > at.w - s || at.y > at.h - s) throw new Error('map point ' + JSON.stringify(pt) + ' is off the window at ' + JSON.stringify(at));
  const dest = path.join(rig.outDir, 'tod-px-' + (++shotN) + '.png');
  await session.screenshot(dest, { x: Math.round(at.x - s / 2), y: Math.round(at.y - s / 2), width: s, height: s });
  const img = decodePng(fs.readFileSync(dest));
  const sum = [0, 0, 0];
  for (let i = 0; i < img.w * img.h; i++) for (let c = 0; c < 3; c++) sum[c] += img.data[i * img.bpp + c];
  return sum.map(v => v / (img.w * img.h));
}
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const fmt = c => '(' + c.map(v => v.toFixed(1)).join(', ') + ')';

module.exports = async function timeOfDay(rig) {
  const dm = rig.dm;
  let player = null;
  const ids = {};
  const pick = id => dm.evaluate(`document.querySelector('#cp-tod-row [data-tod="${id}"]').click(); 0`);
  const since = t0 => lib.poll(async () => (Date.now() >= t0 ? { t: Date.now() } : null), 30000, 50);
  // The DM's own Reveal all, which asks first; the grid off and the dock shut so nothing sits over the samples.
  const revealAll = async () => {
    await dm.evaluate('if (gridEnabled) document.getElementById("btn-grid").click(); dockOpen(null); document.getElementById("btn-clear-fog").click(); 0');
    await lib.settle(dm, "!!document.getElementById('cd-ok') && document.getElementById('cd-ok').offsetParent !== null", 8000);
    await dm.evaluate('document.getElementById("cd-ok").click(); 0');
    await lib.settle(dm, "!document.getElementById('cd-ok') || document.getElementById('cd-ok').offsetParent === null", 8000);
  };

  // ── The picture map: grey ground, a dark half, one room in the dark ──
  await lib.step(rig, 'setup: the picture map with one room', async () => {
    await dm.evaluate(`globalThis.__todFile = () => new Promise(r => {
      const c = document.createElement('canvas'); c.width = ${PIC_W}; c.height = ${PIC_H};
      const g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, ${PIC_W}, ${PIC_H});
      g.fillStyle = '#282828'; g.fillRect(${PIC_W / 2}, 0, ${PIC_W / 2}, ${PIC_H});
      c.toBlob(b => r(new File([b], ${JSON.stringify(PIC + '.png')}, { type: 'image/png' })), 'image/png');
    }); 0`);
    await dm.evaluate('globalThis.__rigPlan = ' + JSON.stringify({ name: PIC + '.dd2vtt', text: ROOM_PLAN }) +
      '; window.findPlanForFile = async () => globalThis.__rigPlan; findPlanForFile = window.findPlanForFile; 0');
    await dm.evaluate('__todFile().then(f => createNewScene(f))', 120000);
    await dm.waitFor('currentScene && currentScene.name === ' + JSON.stringify(PIC) + ' && mapWidth === ' + PIC_W, 120000, 'the picture import');
    await lib.installHelpers(dm);
    await lib.settle(dm, 'fogCoverT === 0', 60000);
    ids.pic = await dm.evaluate('currentScene.id');
    await lib.drawRooms(rig, 1);
    await revealAll();
    player = await rig.player();
    await lib.installHelpers(player);
    await lib.settle(player, '!!mapOffscreen && fogCoverT === 0 && !viewLerpActive', 120000);
    const clear = await lib.poll(async () => { const a = await lib.tvFog(player, A.x, A.y), b = await lib.tvFog(player, B.x, B.y); return a < 20 && b < 20 ? { a, b } : null; }, 30000);
    rig.check(!!clear, 'setup: Reveal all did not clear the TV\'s fog');
    await lib.settle(player, '!fogTransRafId', 15000);
  });
  rig.check(!!player && await dm.evaluate('polygons.length') === 1, 'setup: the picture map, its room or the TV is not there, so what follows means nothing');
  if (!player) return;

  // ── 1. The control ────────────────────────────────────────────────────────
  await lib.step(rig, '1: the control', async () => {
    const ui = await dm.evaluate(`(() => {
      const first = document.querySelector('#cp-sec-fog .dk-secbody .dk-blk');
      return { sub: first.querySelector('.dk-sub').textContent, row: !!first.querySelector('#cp-tod-row'),
        titles: [...document.querySelectorAll('#cp-tod-row [data-tod]')].map(b => b.dataset.tod + ':' + b.title) }; })()`);
    rig.check(ui.sub === 'Time of day' && ui.row, '1: Time of day is not the first group of Weather and Fog: ' + JSON.stringify(ui));
    rig.check(ui.titles.join(',') === 'none:None,day:Day,dusk:Dusk,night:Night', '1: the four icons or their tooltips are wrong: ' + ui.titles);
    for (const id of ['day', 'dusk', 'night', 'none']) {
      await pick(id);
      const got = await dm.evaluate(`({ id: timeOfDayId, lit: [...document.querySelectorAll('#cp-tod-row .active')].map(b => b.dataset.tod) })`);
      rig.check(got.id === id && got.lit.join() === id, '1: the ' + id + ' icon did not set the time of day and light alone: ' + JSON.stringify(got));
    }
  });
  await lib.settle(player, '!_todFading', 15000);

  // ── 2-4. Night, in Manual: the TV without Send, the fade, a third on the DM ─
  const tv = {}, dmv = {};
  await lib.step(rig, '2-4: Night on the picture map', async () => {
    tv.A0 = await pixel(rig, player, A); tv.B0 = await pixel(rig, player, B); tv.C0 = await pixel(rig, player, C);
    dmv.A0 = await pixel(rig, dm, A);
    await dm.evaluate('if (autoSync) document.getElementById("btn-auto-sync").click(); 0');
    rig.check(await dm.evaluate('autoSync === false'), '4: precondition: Updates did not go to Manual');
    const t0 = Date.now();
    await pick('night');
    await since(t0 + 4000);
    // ⚠ THE PICTURE IS TAKEN SOMEWHERE BETWEEN THESE TWO TIMES, and a screenshot takes seconds on a slow runner: judged
    // against the time it returned, a TV exactly on the curve read as late.
    const tA = Date.now() - t0;
    const mid = await pixel(rig, player, A);
    const tB = Date.now() - t0;
    await since(t0 + 9000);
    tv.A1 = await pixel(rig, player, A); tv.B1 = await pixel(rig, player, B);
    const fNow = (lum(tv.A0) - lum(mid)) / Math.max(1, lum(tv.A0) - lum(tv.A1));
    const curve = ms => { const k = Math.min(1, ms / 8000); return k * k * (3 - 2 * k); };
    const lo = curve(tA), hi = curve(tB);
    rig.note('4: between ' + tA + ' and ' + tB + ' ms the TV was ' + (fNow * 100).toFixed(0) + '% of the way (the curve says ' + (lo * 100).toFixed(0) + '-' + (hi * 100).toFixed(0) + '%)');
    rig.check(tA < 6500 && fNow > 0.1 && fNow < 0.9 && fNow > lo - 0.3 && fNow < hi + 0.3, '4: the TV was not mid-way at about 4 s: ' + (fNow * 100).toFixed(0) + '% between ' + tA + ' and ' + tB + ' ms');
    const later = await pixel(rig, player, A);
    rig.check(Math.abs(lum(later) - lum(tv.A1)) < 2, '4: the TV was still moving after 9 s: ' + fmt(tv.A1) + ' then ' + fmt(later));
    rig.note('2: TV outside the room ' + fmt(tv.A0) + ' → ' + fmt(tv.A1) + '; inside the dark room ' + fmt(tv.B0) + ' → ' + fmt(tv.B1));
    rig.check(lum(tv.A1) < lum(tv.A0) - 30 && tv.A1[2] - tv.A1[0] > tv.A0[2] - tv.A0[0] + 5,
      '2: at Night the TV\'s ground outside the room is not darker and bluer: ' + fmt(tv.A0) + ' → ' + fmt(tv.A1));
    rig.check(Math.abs(tv.B1[0] - tv.B0[0]) <= 3 && Math.abs(lum(tv.B1) - lum(tv.B0)) <= 6 && Math.abs(tv.B1[2] - tv.B0[2]) <= 10,
      '2: the dark room\'s inside moved at Night: ' + fmt(tv.B0) + ' → ' + fmt(tv.B1));
    dmv.A1 = await pixel(rig, dm, A);
    const third = (lum(dmv.A0) - lum(dmv.A1)) / (lum(tv.A0) - lum(tv.A1));
    rig.note('3: the DM moved ' + (third * 100).toFixed(0) + '% as far as the TV: ' + fmt(dmv.A0) + ' → ' + fmt(dmv.A1));
    rig.check(third > 0.22 && third < 0.45, '3: the DM screen did not move about a third as far as the TV: ' + (third * 100).toFixed(0) + '%');
    await dm.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH', key: 'h', bubbles: true })); 0");
    await lib.settle(dm, 'playersViewOn && !viewportDirty', 8000);
    const held = await pixel(rig, dm, A);
    await dm.evaluate("document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyH', key: 'h', bubbles: true })); 0");
    const full = (lum(dmv.A0) - lum(held)) / (lum(tv.A0) - lum(tv.A1));
    rig.check(full > 0.8 && full < 1.2, '3: holding H did not show the full strength: ' + (full * 100).toFixed(0) + '% (' + fmt(held) + ')');
  });

  // ── 5. Rain over Night ────────────────────────────────────────────────────
  await lib.step(rig, '5: weather on top', async () => {
    const t0 = Date.now();
    await dm.evaluate(`document.querySelector('#cp-wx-row [data-wx="rain"]').click(); 0`);
    await since(t0 + 1000);
    await lib.settle(player, "weatherId === 'rain' && !_wxPrev", 15000);
    const rain = await pixel(rig, player, A, 30);
    const night = tv.A1;
    rig.note('5: Night ' + fmt(night) + ', Rain over it ' + fmt(rain));
    rig.check(Math.abs(lum(rain) - lum(night)) > 2.5, '5: Rain over Night left the TV\'s pixel as it was: ' + fmt(night) + ' vs ' + fmt(rain));
  });

  // ── 6. Day lifts the dark ─────────────────────────────────────────────────
  await lib.step(rig, '6: Day', async () => {
    const t0 = Date.now();
    await dm.evaluate(`document.querySelector('#cp-wx-row [data-wx="none"]').click(); 0`);
    await pick('day');
    await since(t0 + 1000);
    await lib.settle(player, "timeOfDayId === 'day' && !_todFading && !_wxPrev", 15000);
    const c = await pixel(rig, player, C), b = await pixel(rig, player, B);
    rig.note('6: dark ground ' + fmt(tv.C0) + ' → ' + fmt(c) + '; dark room ' + fmt(tv.B0) + ' → ' + fmt(b));
    rig.check(lum(c) > lum(tv.C0) + 8, '6: Day did not lift the dark ground on the TV: ' + fmt(tv.C0) + ' → ' + fmt(c));
    rig.check(lum(b) > lum(tv.B0) + 8, '6: Day did not lift the dark room on the TV: ' + fmt(tv.B0) + ' → ' + fmt(b));
    await dm.evaluate('if (!autoSync) document.getElementById("btn-auto-sync").click(); 0');
  });

  // ── 7. Saved with the map ─────────────────────────────────────────────────
  await lib.step(rig, '7: saved and reopened', async () => {
    await pick('night');
    await dm.evaluate('doAutoSave()', 120000);
    rig.check(await dm.evaluate(`sceneStore.loadScene(${JSON.stringify(ids.pic)}).then(r => r.timeOfDay)`, 20000) === 'night', '7: the saved map does not carry Night');
    ids.anim = await lib.importWithPlan(rig, ANIM);
    await dm.evaluate(`switchScene(${JSON.stringify(ids.pic)})`, 120000);
    await lib.settle(dm, `currentScene && currentScene.id === ${JSON.stringify(ids.pic)} && fogCoverT === 0`, 60000);
    const back = await dm.evaluate(`({ id: timeOfDayId, lit: [...document.querySelectorAll('#cp-tod-row .active')].map(b => b.dataset.tod) })`);
    rig.check(back.id === 'night' && back.lit.join() === 'night', '7: reopening the map lost its Night: ' + JSON.stringify(back));
    await pick('none');
    await dm.evaluate('doAutoSave()', 120000);
    rig.check(await dm.evaluate(`sceneStore.loadScene(${JSON.stringify(ids.pic)}).then(r => 'timeOfDay' in r)`, 20000) === false, '7: None left a field on the saved map');
  });

  // ── 8. The animated map ───────────────────────────────────────────────────
  await lib.step(rig, '8: the animated map', async () => {
    await dm.evaluate(`switchScene(${JSON.stringify(ids.anim)})`, 120000);
    await lib.settle(dm, `currentScene && currentScene.id === ${JSON.stringify(ids.anim)} && fogCoverT === 0`, 60000);
    await lib.installHelpers(dm);
    await lib.drawRooms(rig, 3);
    await revealAll();
    await lib.settle(player, '!!mapVideo && fogCoverT === 0 && !viewLerpActive', 120000);
    const clear = await lib.poll(async () => { const a = await lib.tvFog(player, ANIM_OUT.x, ANIM_OUT.y), b = await lib.tvFog(player, ANIM_IN.x, ANIM_IN.y); return a < 20 && b < 20 ? { a, b } : null; }, 30000);
    rig.check(!!clear, '8: Reveal all did not clear the TV\'s fog on the animated map');
    await lib.settle(player, '!fogTransRafId', 15000);
    const read = async () => ({ tvO: await pixel(rig, player, ANIM_OUT), tvI: await pixel(rig, player, ANIM_IN),
      dmO: await pixel(rig, dm, ANIM_OUT), dmI: await pixel(rig, dm, ANIM_IN) });
    const shots = async name => {
      const d = path.join(rig.outDir, 'tod-' + name + '-dm.png'), p = path.join(rig.outDir, 'tod-' + name + '-tv.png');
      await dm.screenshot(d); await player.screenshot(p);
      rig.note('8: screenshots at ' + name + ': ' + d + ' and ' + p);
    };
    const none = await read();
    await shots('none');
    for (const id of ['night', 'dusk', 'day']) {
      const t0 = Date.now();
      await pick(id);
      await since(t0 + 1000);
      await lib.settle(player, `timeOfDayId === '${id}' && !_todFading`, 15000);
      await lib.settle(dm, '!_todFading', 15000);
      const v = await read();
      await shots(id);
      const off = (base, tvNow, dmNow) => dmNow.map((d, c) => d - (base.tv[c] + (tvNow[c] - base.tv[c]) / 3) - (base.dm[c] - base.tv[c]));
      const eO = off({ tv: none.tvO, dm: none.dmO }, v.tvO, v.dmO), eI = off({ tv: none.tvI, dm: none.dmI }, v.tvI, v.dmI);
      rig.note('8: ' + id + ' outside: TV ' + fmt(none.tvO) + ' → ' + fmt(v.tvO) + ', DM ' + fmt(none.dmO) + ' → ' + fmt(v.dmO) +
        ', DM off a third of the TV by ' + fmt(eO) + '; inside a hall: TV ' + fmt(none.tvI) + ' → ' + fmt(v.tvI) + ', DM ' + fmt(none.dmI) + ' → ' + fmt(v.dmI) + ', off by ' + fmt(eI));
      if (id === 'night') {
        rig.check(lum(v.tvO) < lum(none.tvO) - 15 && v.tvO[2] - v.tvO[0] > none.tvO[2] - none.tvO[0],
          '8: Night did not show on the TV\'s animated map: ' + fmt(none.tvO) + ' → ' + fmt(v.tvO));
        rig.check(lum(v.dmO) < lum(none.dmO) - 3, '8: Night did not show on the DM\'s animated map: ' + fmt(none.dmO) + ' → ' + fmt(v.dmO));
      }
      if (id === 'day') rig.check(lum(v.dmO) > lum(none.dmO), '8: Day did not show on the DM\'s animated map: ' + fmt(none.dmO) + ' → ' + fmt(v.dmO));
    }
    rig.byEye('8: the DM\'s animated map at Night, Dusk and Day looks like a third of the TV\'s (the screenshots above), and plays smoothly');
    await pick('none');
  });

  // ── 9. Two maps ───────────────────────────────────────────────────────────
  await lib.step(rig, '9: two maps', async () => {
    await dm.evaluate('doAutoSave()', 120000);
    await dm.evaluate(`enterPanes(${JSON.stringify(ids.pic)}, ${JSON.stringify(ids.anim)})`, 60000);
    await lib.settle(dm, 'panesActive && livePanes().length === 2 && livePanes().every(id => panes[id].ready)', 60000);
    // Each column opens its map after it is ready; a pick made before that would be replaced by the saved one.
    await lib.settle(dm, "livePanes().every(id => panes[id].frame.contentWindow.eval('!!currentScene && mapWidth > 0 && fogCoverT === 0'))", 60000);
    const [a, b] = await dm.evaluate('livePanes()');
    await dm.evaluate(`selectPane(${JSON.stringify(a)}); 0`);
    await pick('dusk');
    await dm.evaluate(`selectPane(${JSON.stringify(b)}); 0`);
    await pick('day');
    const own = () => dm.evaluate(`({ a: paneScopeOf(${JSON.stringify(a)}).timeOfDay, b: paneScopeOf(${JSON.stringify(b)}).timeOfDay,
      lit: [...document.querySelectorAll('#cp-tod-row .active')].map(x => x.dataset.tod).join() })`);
    const got = await lib.poll(async () => { const o = await own(); return o.a === 'dusk' && o.b === 'day' ? o : null; }, 10000) || await own();
    rig.check(got.a === 'dusk' && got.b === 'day' && got.lit === 'day', '9: the columns do not keep their own time of day: ' + JSON.stringify(got));
    await dm.evaluate(`selectPane(${JSON.stringify(a)}); 0`);
    const lit = await dm.evaluate(`[...document.querySelectorAll('#cp-tod-row .active')].map(x => x.dataset.tod).join()`);
    rig.check(lit === 'dusk', '9: the control does not show the selected column\'s own time of day: ' + lit);
    await dm.evaluate('exitPanes()', 60000);
  });
};
