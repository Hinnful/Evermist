// The interface audit: every entry of tools/rig/inventory.js opened in every state it lists, and checked.
// Kept, unlike a build's scenario, by the DM's call: a change to the interface is done only when this is clean.
// Run with --dm-size 1280x1500 so the dock's panes fit unscrolled. DS_SHOTS=<folder> also writes a 2x close-up
// of each entry in each state, the faults to faults.txt and what could not be checked to unchecked.txt.
//
// Criteria:
// - Every entry opens; one that does not is named and fails the run.
// - Everything in a row stands on one centre line, within 0.5px: a text by its capitals, a glyph by its ink, a box by its middle.
// - A plate inside anything the pointer lights never merges with what it lies on, and stands off it under the
//   pointer at least as well as at rest.
// - No control is the browser's own, and text in a filled control keeps 6px from its sides.
// - Nothing but the toggled box moves when an entry's state changes.
// - Every right-click menu has the same row height on screen, and none is narrower than the skin.
const lib = require('../lib');
const path = require('path');
const fs = require('fs');
const { SETUP, INVENTORY, CLOSE_ALL } = require('../inventory');

module.exports = async function (rig) {
  await lib.inRussian(rig);
  await lib.importWithPlan(rig, 'Склеп');
  const dm = rig.dm;
  const shots = process.env.DS_SHOTS;
  if (shots) {
    fs.mkdirSync(shots, { recursive: true });
    const [w, h] = await dm.evaluate('[innerWidth, innerHeight]');
    await dm.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
  }
  await dm.evaluate('(async () => { ' + SETUP + ' })()');
  const all = new Map(), unchecked = [], menus = {};
  const fault = (where, f) => { if (!all.has(f)) all.set(f, where); };
  const run = js => dm.evaluate('(async () => { ' + js + ' })()');
  const visible = sel => dm.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false;
    const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; })()`);

  for (const e of INVENTORY) {
    try {
      await run(e.open);
      await lib.settle(dm, `!!document.querySelector(${JSON.stringify(e.root)})`, 3000);
      if (!(await visible(e.root))) { unchecked.push(e.id + ': did not open'); await run(e.close || '').catch(() => {}); continue; }
      for (const st of e.states || [{ name: 'rest', set: '' }]) {
        const where = e.id + (st.name === 'rest' ? '' : ' (' + st.name + ')');
        await run(st.set);
        await lib.settle(dm, 'false', 250);
        const { rows, faults } = await lib.alignSweep(dm, e.root);
        const hover = await lib.hoverSweep(dm, e.root);
        const surface = await lib.surfaceSweep(dm, e.root);
        rig.note(where + ': ' + rows + ' rows, ' + faults.length + ' off; ' + hover.hosts + ' lit, ' + hover.faults.length +
          ' swallowed; ' + surface.length + ' controls off');
        faults.concat(hover.faults, surface).forEach(f => fault(where, f));
        if (shots) {
          const r = await dm.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(e.root)}).getBoundingClientRect();
            return { x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8), width: Math.min(innerWidth, b.width + 16), height: Math.min(innerHeight - Math.max(0, b.y - 8), b.height + 16 + ${e.below || 0}) }; })()`);
          await dm.screenshot(path.join(shots, where.replace(/[^\w-]+/g, '_') + '.png'), r);
        }
      }
      for (const sh of e.shifts || []) (await lib.shiftSweep(dm, sh.root || e.root, sh.run, sh.except)).forEach(f => fault(e.id + ' (' + sh.name + ')', f));
      if (e.menu) menus[e.id] = await dm.evaluate(`(() => { const m = document.querySelector(${JSON.stringify(e.root)}), r = m.getBoundingClientRect(),
        i = m.querySelector('.sm-mi, [data-i]').getBoundingClientRect(); return { w: Math.round(r.width), row: +i.height.toFixed(1) }; })()`);
      await run(e.close || '');
      await run(CLOSE_ALL);
      await lib.settle(dm, 'false', 150);
    } catch (err) {
      unchecked.push(e.id + ': ' + err.message.split('\n')[0]);
      await run((e.close || '') + CLOSE_ALL).catch(() => {});
    }
  }

  const list = [...all].map(([f, where]) => where + ' — ' + f);
  if (shots) {
    fs.writeFileSync(path.join(shots, 'faults.txt'), list.join('\n') + '\n');
    fs.writeFileSync(path.join(shots, 'unchecked.txt'), unchecked.join('\n') + '\n');
  }
  rig.note('not checked: ' + unchecked.length + (unchecked.length ? '\n    ' + unchecked.join('\n    ') : ''));
  rig.check(unchecked.length === 0, unchecked.length + ' inventory entries could not be checked; the note above names each');
  const sizes = Object.values(menus);
  rig.note('menus ' + JSON.stringify(menus));
  // One row height, and no menu narrower than the skin's 200px at the UI's zoom.
  rig.check(sizes.length > 1 && sizes.every(m => Math.abs(m.row - sizes[0].row) < 0.5 && m.w >= 239), 'the right-click menus differ in size: ' + JSON.stringify(menus));
  rig.note('faults: ' + list.length + (list.length ? '\n    ' + list.join('\n    ') : ''));
  rig.check(list.length === 0, list.length + ' faults on the inventory; the notes above name each');
};
