'use strict';

// one-inch.js — 1 inch on the minimap and TV size in TV setup (BACKLOG 284).
//
//   1. Lock is gone, and 1 inch and Sync are absent before the TV is live.
//   2. Live, 1 inch then Sync sit at the minimap's top left, each with its icon and word; only ··· is top right.
//   3. 1 inch with no size for this TV opens TV setup with the TV size row marked, and the TV does not move.
//   4. Picking 55 and pressing Done gives the Player the zoom tvInch computes for 55 inches and the scene's
//      cell size, about the TV's centre, on the screen the Player itself reports being on.
//   5. After it the minimap wheel, Sync and the Player's own wheel each change the TV's zoom, and a press of
//      1 inch after each restores it.
//   6. On Manual, 1 inch waits for Send.
//   7. Other opens a field; 58 typed there is kept per TV and both survive a restart.
//   8. With two maps, 1 inch scales the selected half's Player only.

const lib = require('../lib');

const near = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
const EXPECT = n => `tvInchZoom(${n}, tvInchDisplay(), tvInchCellPx(paneScope().gridConfig))`;
const PRESS = 'document.querySelector("#tv-ui [data-tv-inch]").click(); 0';
const WHEEL_MM = `(() => { const c = document.getElementById('minimap-canvas'), r = c.getBoundingClientRect();
  c.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
  return 0; })()`;
const TYPE = v => `(() => { const f = document.getElementById('tv-size-other'); f.value = ${JSON.stringify(v)};
  f.dispatchEvent(new Event('input', { bubbles: true })); return 0; })()`;

module.exports = async function oneInch(rig) {
  let dm = rig.dm;
  const idA = await lib.importWithPlan(rig, 'Inch A');
  const idB = await lib.importWithPlan(rig, 'Inch B');
  dm = rig.dm;
  await dm.evaluate(`switchScene(${JSON.stringify(idA)})`, 60000);
  await lib.settle(dm, 'fogCoverT === 0', 30000);

  // ── 1 ──
  const before = await dm.evaluate(`({ lock: !!document.getElementById('btn-minimap-lock'),
    inch: !!document.querySelector('#tv-ui [data-tv-inch]'), tl: document.querySelectorAll('#tv-ui .tv-row.tl button').length })`);
  rig.check(!before.lock, '1: the legacy Lock button is still in the page');
  rig.check(!before.inch && before.tl === 0, '1: buttons sit at the top left before the TV is live: ' + JSON.stringify(before));

  // ── 2 ──
  const player = await rig.player();
  await lib.settle(dm, '!!document.querySelector("#tv-ui [data-tv-inch]")', 10000);
  const row = await dm.evaluate(`({ tl: [...document.querySelectorAll('#tv-ui .tv-row.tl button')].map(b => ({ inch: b.hasAttribute('data-tv-inch'),
      text: b.textContent.trim(), icon: !!b.querySelector('.tv-ic svg') })),
    tr: [...document.querySelectorAll('#tv-ui .tv-row.tr button')].map(b => b.hasAttribute('data-tv-more')) })`);
  rig.note('top row: ' + JSON.stringify(row));
  rig.check(row.tl.length === 2 && row.tl[0].inch && row.tl[0].text === '1 inch' && row.tl[1].text === 'Sync' && row.tl.every(b => b.icon),
    '2: the top left is not 1 inch then Sync, each with icon and word: ' + JSON.stringify(row.tl));
  rig.check(row.tr.length === 1 && row.tr[0], '2: the top right holds more than ···: ' + JSON.stringify(row.tr));
  rig.byEye('2: 1 inch and Sync look like the approved prototype, and drop their words together on a narrow minimap');

  // ── 3 ──
  const reported = await dm.evaluate('electronAPI.tvReportedSize(tvInchDisplay().id)', 15000);
  rig.check(reported === null, '3: precondition: the rig\'s screen reports a size (' + JSON.stringify(reported) + '), so the no-size path is unreachable');
  // ⚠ Both views are still taking their first framing here, so the claim is "not at the 1-inch zoom",
  // never "unchanged".
  await lib.settle(player, 'mapOffscreen && !viewLerpActive', 15000);
  await dm.evaluate(PRESS);
  await lib.settle(dm, '!!document.querySelector("#tv-setup .tvs-size")', 5000);
  const marked = await dm.evaluate(`(() => { const r = document.querySelector('#tv-setup .tvs-size');
    if (!r) return null; const blue = getComputedStyle(document.documentElement).getPropertyValue('--b-icon').trim();
    const probe = document.createElement('i'); probe.style.color = blue; document.body.append(probe);
    const want = getComputedStyle(probe).color; probe.remove();
    return { need: r.classList.contains('need'), label: getComputedStyle(r.querySelector('.sm-sub')).color, want,
             ring: getComputedStyle(r.querySelector('.cp-tabs')).boxShadow }; })()`);
  rig.note('marked row: ' + JSON.stringify(marked));
  rig.check(!!marked && marked.need && marked.label === marked.want && marked.ring.includes(marked.want),
    '3: 1 inch with no size did not open TV setup with the TV size row marked blue: ' + JSON.stringify(marked));
  await lib.settle(dm, '!!document.querySelector("#tv-setup .tvs-size > .sm-dim")', 15000);
  rig.check(/doesn't say/.test(await dm.evaluate('(document.querySelector("#tv-setup .tvs-size > .sm-dim") || {}).textContent || ""')),
    '3: TV setup does not say the TV gave no size');
  await lib.hold(1000, 'long enough for a zoom to have reached the Player');
  const still = { mm: await dm.evaluate('minimapView.zoom'), player: await player.evaluate('zoom'), want: await dm.evaluate(EXPECT(55)) };
  rig.check(!near(still.mm, still.want) && !near(still.player, still.want), '3: the TV zoomed although no size was set: ' + JSON.stringify(still));

  // ── 4 ──
  await dm.evaluate('document.querySelector("#tv-setup [data-tv-size=\\"55\\"]").click(); 0');
  const unmarked = await dm.evaluate('!document.querySelector("#tv-setup .tvs-size.need") && !!document.querySelector("#tv-setup [data-tv-size=\\"55\\"].active")');
  rig.check(unmarked, '4: picking 55 did not light it and clear the mark');
  const cBefore = await dm.evaluate('({ x: minimapView.mapCX, y: minimapView.mapCY })');
  await dm.evaluate('document.querySelector("#tv-setup .sm-wfoot .primary").click(); 0');
  await lib.settle(dm, '!document.getElementById("tv-setup")', 5000);
  const want55 = await dm.evaluate(EXPECT(55));
  await lib.settle(player, `Math.abs(zoom - ${want55}) < 1e-6 && !viewLerpActive`, 8000);
  const after = await dm.evaluate('({ z: minimapView.zoom, x: minimapView.mapCX, y: minimapView.mapCY, cell: paneScope().gridConfig.cellSize })');
  const pz = await player.evaluate('zoom');
  rig.note('55 inches, cell ' + after.cell + ': want ' + want55 + ', minimap ' + after.z + ', Player ' + pz);
  const seen = await dm.evaluate(`(() => { const r = paneScope().playerScreenInfo, m = tvInchMatchScreen(_tvDisplays, r);
    return { r, m: m && m.id, used: tvInchDisplay() && tvInchDisplay().id }; })()`);
  rig.note('Player screen report: ' + JSON.stringify(seen));
  rig.check(seen.r && seen.m != null && seen.m === seen.used, '4: 1 inch did not use the screen the Player reports being on: ' + JSON.stringify(seen));
  rig.check(near(pz, want55) && near(after.z, want55), '4: Done did not give the Player the 55-inch zoom: Player ' + pz + ', want ' + want55);
  rig.check(near(after.x, cBefore.x) && near(after.y, cBefore.y), '4: 1 inch moved the TV\'s centre: ' + JSON.stringify([cBefore, after]));

  // ── 5 ──
  const restores = async (what, change) => {
    await change();
    const moved = await lib.poll(async () => {
      const z = await player.evaluate('viewLerpActive ? null : zoom');
      return typeof z === 'number' && !near(z, want55) ? { z } : null;
    }, 8000);
    rig.check(!!moved, '5: ' + what + ' did not change the TV\'s zoom after 1 inch');
    await dm.evaluate(PRESS);
    const back = await lib.settle(player, `Math.abs(zoom - ${want55}) < 1e-6 && !viewLerpActive`, 8000);
    rig.check(back, '5: 1 inch after ' + what + ' did not restore the squares: ' + await player.evaluate('zoom'));
  };
  await restores('the minimap wheel', () => dm.evaluate(WHEEL_MM));
  await restores('Sync', () => dm.evaluate('document.querySelectorAll("#tv-ui .tv-row.tl button")[1].click(); 0'));
  await restores('the Player\'s own wheel', async () => {
    await player.evaluate(`container.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: innerWidth / 2, clientY: innerHeight / 2, bubbles: true, cancelable: true })); 0`);
    await lib.settle(dm, `Math.abs(minimapView.zoom - ${want55}) > 1e-6`, 5000);
  });

  // ── 6 ──
  await dm.evaluate(WHEEL_MM);
  await lib.settle(player, `Math.abs(zoom - ${want55}) > 1e-6 && !viewLerpActive`, 8000);
  const zHeld = await player.evaluate('zoom');
  await dm.evaluate('document.getElementById("btn-auto-sync").click(); 0');
  rig.check(await dm.evaluate('autoSync === false'), '6: precondition: Updates did not go to Manual');
  await dm.evaluate(PRESS);
  await lib.hold(1500, 'long enough for an unheld zoom to have reached the Player');
  const held = await player.evaluate('zoom');
  rig.check(near(held, zHeld) && !near(held, want55), '6: on Manual 1 inch reached the TV before Send: ' + held);
  await dm.evaluate('document.getElementById("btn-send").click(); 0');
  rig.check(await lib.settle(player, `Math.abs(zoom - ${want55}) < 1e-6 && !viewLerpActive`, 8000),
    '6: Send did not deliver 1 inch: ' + await player.evaluate('zoom'));
  await dm.evaluate('document.getElementById("btn-auto-sync").click(); 0');

  // ── 7 ──
  await dm.evaluate('document.querySelector("#tv-ui [data-tv-more]").click(); 0');
  await lib.settle(dm, '!!document.querySelector("#tv-setup [data-tv-size=\\"other\\"]")', 5000);
  await dm.evaluate('document.querySelector("#tv-setup [data-tv-size=\\"other\\"]").click(); 0');
  const field = await dm.evaluate('(f => f && { empty: f.classList.contains("empty"), w: f.getBoundingClientRect().width })(document.getElementById("tv-size-other"))');
  rig.check(!!field && field.empty, '7: Other did not open an empty field: ' + JSON.stringify(field));
  await dm.evaluate(TYPE('58'));
  const key = await dm.evaluate('tvSizeKey(tvInchDisplay())');
  const kept = await dm.evaluate('JSON.parse(localStorage.getItem("evermist.tvSizes") || "{}")');
  rig.check(kept[key] === 58, '7: 58 was not kept for this TV: ' + JSON.stringify(kept) + ' under ' + key);
  const other = await dm.evaluate('tvSizeStored({ label: "Another TV", size: { width: 3840, height: 2160 } })');
  rig.check(other === null, '7: another TV took this one\'s size: ' + other);
  await dm.evaluate('document.querySelector("#tv-setup .sm-wfoot .primary").click(); 0');
  await lib.settle(dm, '!document.getElementById("tv-setup")', 5000);

  dm = await rig.restart();
  await lib.installHelpers(dm);
  await lib.settle(dm, '!!document.querySelector("#tv-ui [data-tv-more]") && _tvDisplays.length > 0', 30000);
  await dm.evaluate('document.querySelector("#tv-ui [data-tv-more]").click(); 0');
  await lib.settle(dm, '!!document.getElementById("tv-size-other")', 5000);
  const back = await dm.evaluate(`({ other: !!document.querySelector('#tv-setup [data-tv-size="other"].active'),
    value: (document.getElementById('tv-size-other') || {}).value, stored: tvSizeStored(tvInchDisplay()) })`);
  rig.check(back.other && back.value === '58' && back.stored === 58, '7: Other and 58 did not survive a restart: ' + JSON.stringify(back));
  await dm.evaluate('document.querySelector("#tv-setup .sm-wfoot .sm-hbtn").click(); 0');
  await lib.settle(dm, '!document.getElementById("tv-setup")', 5000);

  // ── 8 ──
  await dm.evaluate(`enterPanes(${JSON.stringify(idA)}, ${JSON.stringify(idB)})`, 60000);
  await lib.settle(dm, 'panesActive && livePanes().length === 2 && livePanes().every(id => panes[id].ready)', 60000);
  const halfA = await rig.player('A');
  const halfB = await rig.player('B');
  await lib.settle(dm, '!!document.querySelector("#tv-ui [data-tv-inch]")', 10000);
  const sel = await dm.evaluate('panesSelected');
  const [mine, theirs] = sel === 'A' ? [halfA, halfB] : [halfB, halfA];
  await lib.settle(mine, 'mapOffscreen && !viewLerpActive', 30000);
  await lib.settle(theirs, 'mapOffscreen && !viewLerpActive', 30000);
  const want58 = await dm.evaluate(EXPECT(58));
  const zOther = await theirs.evaluate('zoom');
  rig.check(!near(await mine.evaluate('zoom'), want58), '8: precondition: the selected half already sat at the 58-inch zoom');
  await dm.evaluate(PRESS);
  const got = await lib.settle(mine, `Math.abs(zoom - ${want58}) < 1e-6 && !viewLerpActive`, 8000);
  rig.check(got, '8: the selected half (' + sel + ') did not take the 58-inch zoom: ' + await mine.evaluate('zoom') + ', want ' + want58);
  await lib.hold(1000, 'long enough for the other half to have moved');
  // The other half may still be settling its own first framing, so the claim is that it never took the
  // 58-inch zoom, not that it never moved.
  rig.check(!near(zOther, want58) && !near(await theirs.evaluate('zoom'), want58),
    '8: the other half took the 58-inch zoom too: ' + await theirs.evaluate('zoom'));
  rig.byEye('8: a ruler on the DM\'s TV measures 1.1 inches across a square');
};
