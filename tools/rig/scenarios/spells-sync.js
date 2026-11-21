'use strict';

// spells-sync.js - A FIGHT COPY'S SPENT CRYSTALS TRAVEL BY SYNC, AN ENTRY'S NEVER DO (spec spells-304, DoD 5).
//
// Two apps on one fake Drive. A Mage (SRD 5.1 text) is an entry and a fight row on A. Crystals are spent with real
// mouse events.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   5a. A spends two 1st-level crystals on the fight copy and one on the entry. B gets the fight with the copy's two
//       spent, and B's entry page shows every crystal full; nothing reaches B's `evermist.entrySpent`.
//   5b. B edits the entry's AC to 15 and syncs; A then spends another crystal on the entry and saves before it pulls,
//       as seconds at the table would. A still gets AC 15 and keeps its own entry crystals, and after A syncs B still
//       holds AC 15: a crystal click is never an edit that outranks B's.

const lib = require('../lib');

const q = JSON.stringify;
const KEY = 'cast|slots:1';
const MAGE = 'The mage is a 9th-level spellcaster. Its spellcasting ability is Intelligence (spell save DC 14, +6 to hit with spell attacks). The mage has the following wizard spells prepared:\n'
  + 'Cantrips (at will): fire bolt, light, mage hand, prestidigitation\n1st level (4 slots): detect magic, mage armor, magic missile, shield\n'
  + '2nd level (3 slots): misty step, suggestion\n3rd level (3 slots): counterspell, fireball, fly\n4th level (3 slots): greater invisibility, ice storm\n5th level (1 slot): cone of cold';
const ROW = `cbState.rows.find(r => r.name === 'Mage')`;
const ENTRY = `Object.values(cbState.blocks).find(b => b.name === 'Mage')`;
const FIRST = `(g => g ? g.querySelectorAll('.sp-lv .sp-pp > i.off').length + '/' + g.querySelectorAll('.sp-lv .sp-pp > i').length : 'none')(document.querySelectorAll('#bs-page .sp-grp')[1])`;
// The rig's 1008px screen puts the fight table over the Bestiary's page; moved aside as the DM would drag it.
const ASIDE = `(p => { if (p) p.style.left = '1400px'; return 0; })(document.getElementById('cb-fight'))`;
const entryPage = dm => dm.evaluate(`(() => { bestiarySetOpen(true); _bsShow(${ENTRY}.id); ${ASIDE}; return ${FIRST}; })()`);
const copyPage = dm => dm.evaluate(`(() => { cbSetOpen(true); bcOpen(${ROW}); ${ASIDE}; return ${FIRST}; })()`);
// A real click through the DevTools protocol on a FULL 1st-level crystal: the spent ones are the rightmost, so the
// click picks by state, never by place.
async function spend(dm, times) {
  for (let i = 0; i < times; i++) {
    const r = await dm.evaluate(`(el => { if (!el) return null; el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width }; })(document.querySelectorAll('#bs-page .sp-grp')[1].querySelector('.sp-lv .sp-pp > i:not(.off)'))`);
    if (!r || !r.w) throw new Error('no full 1st-level crystal to click');
    await dm.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
    await dm.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 });
    await dm.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', buttons: 0, clickCount: 1 });
  }
  return dm.evaluate(FIRST);
}
const rowSpent = `(r => r ? (r.spent || {})[${q(KEY)}] || 0 : 'no row')((JSON.parse(localStorage.getItem('evermist.combat') || '{}').rows || []).find(x => x.name === 'Mage'))`;
const entrySpent = `(e => e ? (JSON.parse(localStorage.getItem('evermist.entrySpent') || '{}')[e.uid] || {})[${q(KEY)}] || 0 : 'no entry')(${ENTRY})`;

module.exports = async function spellsSync(rig) {
  const drive = await rig.fakeDrive();
  const b = await rig.second('b');
  rig.writeSyncConfig(rig.profileDir, drive);
  rig.writeSyncConfig(b.profileDir, drive);
  await rig.dm.evaluate('localStorage.setItem("evermist-lang", "en"); 0');
  await b.dm.evaluate('localStorage.setItem("evermist-lang", "en"); 0');
  const dmA = await rig.restart();
  const dmB = await b.restart();
  await lib.installHelpers(dmA);
  await lib.installHelpers(dmB);
  for (const d of [dmA, dmB]) await lib.settle(d, 'typeof syncEngine !== "undefined" && syncEngine.status().state !== "off"', 60000);
  const pulled = (d, expr, want) => lib.poll(async () => {
    await d.evaluate('syncEngine.now()', 60000);
    const v = await d.evaluate(expr);
    return q(v) === q(want) ? { v } : null;
  }, 120000, 500);

  await lib.step(rig, '5a: the copy\'s crystals travel, the entry\'s stay', async () => {
    await dmA.evaluate(`(() => {
      const b = combatAddEntry(cbState.blocks, Object.assign(combatBlankBlock('', 'Mage'), { hp: '40', ac: '12', secs: { Traits: [{ n: 'Spellcasting', t: ${q(MAGE)} }] } }));
      const r = { id: cbState.nextId++, init: '', name: '', hp: '', ac: '', conds: [], side: 'enemy', sbChanged: false };
      combatPickInto(r, b, cbState.rows);
      cbState.rows.splice(combatAddIndex(cbState.rows), 0, r);
      cbSave(); return 0; })()`);
    await copyPage(dmA);
    rig.check(await spend(dmA, 2) === '2/4', '5a setup: two crystals should be spent on A\'s copy, shows ' + await dmA.evaluate(FIRST));
    await entryPage(dmA);
    rig.check(await spend(dmA, 1) === '1/4', '5a setup: one crystal should be spent on A\'s entry, shows ' + await dmA.evaluate(FIRST));
    await dmA.evaluate('bestiarySetOpen(false); cbSetOpen(false); syncEngine.now()', 60000);
    rig.check(!!(await pulled(dmB, rowSpent, 2)), '5a: B should get the fight copy with two spent, holds ' + q(await dmB.evaluate(rowSpent)));
    rig.check(await dmB.evaluate(entrySpent) === 0, '5a: B\'s entry crystals should stay untouched, holds ' + q(await dmB.evaluate(entrySpent)));
    rig.check(await entryPage(dmB) === '0/4', '5a: B\'s entry page should show every crystal full, shows ' + await dmB.evaluate(FIRST));
    rig.check(await copyPage(dmB) === '2/4', '5a: B\'s copy page should show two spent, shows ' + await dmB.evaluate(FIRST));
    await dmB.evaluate('bestiarySetOpen(false); cbSetOpen(false); 0');
  });

  await lib.step(rig, '5b: an entry edit survives a crystal click elsewhere', async () => {
    await dmB.evaluate(`(() => { ${ENTRY}.ac = '15'; cbSave(); return 0; })()`);
    await dmB.evaluate('syncEngine.now()', 60000);
    await entryPage(dmA);
    rig.check(await spend(dmA, 1) === '2/4', '5b setup: A should spend a second crystal on the entry, shows ' + await dmA.evaluate(FIRST));
    // A crystal click is no edit: flushing any pending save here must stamp nothing that outranks B's AC.
    await dmA.evaluate('bestiarySetOpen(false); cbSave(); 0');
    rig.check(!!(await pulled(dmA, `${ENTRY}.ac`, '15')), '5b: A should get B\'s AC 15, holds ' + q(await dmA.evaluate(`${ENTRY}.ac`)));
    rig.check(await dmA.evaluate(entrySpent) === 2, '5b: A should keep its two entry crystals, holds ' + q(await dmA.evaluate(entrySpent)));
    rig.check(await dmB.evaluate(entrySpent) === 0, '5b: B\'s entry crystals should still be untouched, holds ' + q(await dmB.evaluate(entrySpent)));
    await dmA.evaluate('syncEngine.now()', 60000);
    rig.check(!!(await pulled(dmB, `${ENTRY}.ac`, '15')), '5b: B should still hold its AC 15 after A syncs, holds ' + q(await dmB.evaluate(`${ENTRY}.ac`)));
  });
};
