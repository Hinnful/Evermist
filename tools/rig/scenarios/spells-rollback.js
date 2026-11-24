'use strict';

// spells-rollback.js - SPENT SPELL CRYSTALS SURVIVE A RESTART AND A TRIP TO THE PREVIOUS RELEASE (spec spells-304,
// DoD 5).
//
// One profile, in English. The previous release, 5.18.1, sits under ~/.cache/evermist-rig/prev-5.18.1/: `evermist`
// there runs the source of commit 4874037 (`git archive`, node_modules linked) on the dev Electron. A run against any
// other version fails on its version line. Console errors fail it.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   0.  The previous release under the cache is 5.18.1.
//   Every crystal is clicked with real mouse events, a full one to spend and an empty one to return; the spent ones
//   are the rightmost, so a click picks a crystal by its state, never its place.
//
//   1.  Here a Mage (SRD 5.1 text) is an entry and a fight row. One 1st-level crystal is spent on the entry's page;
//       three are spent on the fight copy's and one returned: the entry's land in `evermist.entrySpent`, the copy's
//       two on the row's `spent`, and the copy is not marked changed.
//   1b. A Lich entry (SRD 5.2 text) reads "2/Day Each": both crystals of Animate Dead spent grey that spell (`done`)
//       and leave Dimension Door full.
//   2.  After a restart both Mage pages show the same crystals spent, and Animate Dead is still spent and grey.
//   3.  On 5.18.1 the Bestiary and the fight table open with no error, and an HP typed on the row saves with the
//       row's `spent` riding along.
//   4.  Back on this build the copy still shows two spent and the entry one.
//   4b. Edit mode: the pencil opens the editor with no rows, the 2nd level's slots typed from 3 to 4 in the entry's
//       text, Done, and the rows are read again with four cells at 2nd level and the entry's one spent kept.

const fs = require('fs');
const path = require('path');
const os = require('os');
const lib = require('../lib');

const PREV = path.join(os.homedir(), '.cache', 'evermist-rig', 'prev-5.18.1', 'evermist');
const q = JSON.stringify;
const KEY = 'cast|slots:1';
const EACH = 'cast|day:2:animate dead';
const MAGE = 'The mage is a 9th-level spellcaster. Its spellcasting ability is Intelligence (spell save DC 14, +6 to hit with spell attacks). The mage has the following wizard spells prepared:\n'
  + 'Cantrips (at will): fire bolt, light, mage hand, prestidigitation\n1st level (4 slots): detect magic, mage armor, magic missile, shield\n'
  + '2nd level (3 slots): misty step, suggestion\n3rd level (3 slots): counterspell, fireball, fly\n4th level (3 slots): greater invisibility, ice storm\n5th level (1 slot): cone of cold';
const LICH = 'The lich casts one of the following spells, using Intelligence as the spellcasting ability (spell save DC 20):\n'
  + 'At Will: Detect Magic, Detect Thoughts, Dispel Magic, Fireball (level 5 version), Invisibility, Lightning Bolt (level 5 version), Mage Hand, Prestidigitation\n'
  + '2/Day Each: Animate Dead, Dimension Door, Plane Shift\n1/Day Each: Chain Lightning, Finger of Death, Power Word Kill, Scrying';
const DIALOG = '(typeof _cdOpen !== "undefined" && _cdOpen ? (document.getElementById("cd-msg") || {}).textContent || "a dialog" : "")';

const ROW = `cbState.rows.find(r => r.name === 'Mage')`;
const ENTRY = n => `Object.values(cbState.blocks).find(b => b.name === ${q(n)})`;
// The open page's spent crystals per group, as "spent/cells".
const CELLS = `[...document.querySelectorAll('#bs-page .sp-grp')].map(g => { const c = g.querySelectorAll('.sp-lv .sp-pp > i');
  return c.length ? g.querySelectorAll('.sp-lv .sp-pp > i.off').length + '/' + c.length : '-'; })`;
// The "each" spells of the open page's second group, as "name spent/cells" and " done" when greyed.
const EACHES = `[...document.querySelectorAll('#bs-page .sp-grp')[1].querySelectorAll('.sp-sp')].map(s => s.querySelector('.tx').textContent.trim()
  + ' ' + s.querySelectorAll('.sp-pp > i.off').length + '/' + s.querySelectorAll('.sp-pp > i').length + (s.classList.contains('done') ? ' done' : ''))`;
const SHOWN = '["-","0/4","0/3","0/3","0/3","0/1"]';
const LICH_SPENT = q(['Animate Dead 2/2 done', 'Dimension Door 0/2', 'Plane Shift 0/2']);
// The rig's 1008px screen puts the fight table over the Bestiary's header and page; moved aside as the DM would drag it.
const ASIDE = `(p => { if (p) p.style.left = '1400px'; return 0; })(document.getElementById('cb-fight'))`;
const entryPage = (dm, n = 'Mage') => dm.evaluate(`(() => { bestiarySetOpen(true); _bsShow(${ENTRY(n)}.id); ${ASIDE}; return ${CELLS}; })()`);
const copyPage = dm => dm.evaluate(`(() => { cbSetOpen(true); bcOpen(${ROW}); ${ASIDE}; return ${CELLS}; })()`);

// A real click through the DevTools protocol at the centre of what `expr` finds, after moving there.
async function click(dm, expr) {
  const r = await dm.evaluate(`(el => { if (!el) return null; el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width }; })(${expr})`);
  if (!r || !r.w) throw new Error('nothing to click at ' + expr);
  await dm.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
  await dm.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 });
  await dm.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', buttons: 0, clickCount: 1 });
}
const grp = i => `document.querySelectorAll('#bs-page .sp-grp')[${i}]`;
const full = i => `${grp(i)}.querySelector('.sp-lv .sp-pp > i:not(.off)')`;
const empty = i => `${grp(i)}.querySelector('.sp-lv .sp-pp > i.off')`;
const spellFull = (i, si) => `${grp(i)}.querySelectorAll('.sp-sp')[${si}].querySelector('.sp-pp > i:not(.off)')`;
async function spend(dm, times) {
  for (let i = 0; i < times; i++) await click(dm, full(1));
  return dm.evaluate(CELLS);
}
const with1 = n => SHOWN.replace('"0/4"', `"${n}/4"`);
const faults = async dm => {
  const dialog = await dm.evaluate(DIALOG);
  return (dm.errors || []).slice().concat(dialog ? ['dialog: ' + dialog] : []);
};

module.exports = async function spellsRollback(rig) {
  if (!rig.check(fs.existsSync(PREV), '0: no previous release is set up at ' + PREV)) return;
  let dm = rig.dm;
  await dm.evaluate('localStorage.setItem("evermist-lang", "en"); 0');
  dm = await rig.restart();
  await lib.installHelpers(dm);

  await lib.step(rig, '1 here', async () => {
    await dm.evaluate(`(() => {
      const b = combatAddEntry(cbState.blocks, Object.assign(combatBlankBlock('', 'Mage'), { hp: '40', ac: '12', secs: { Traits: [{ n: 'Spellcasting', t: ${q(MAGE)} }] } }));
      combatAddEntry(cbState.blocks, Object.assign(combatBlankBlock('', 'Lich'), { hp: '315', ac: '20', secs: { Actions: [{ n: 'Spellcasting', t: ${q(LICH)} }] } }));
      const r = { id: cbState.nextId++, init: '', name: '', hp: '', ac: '', conds: [], side: 'enemy', sbChanged: false };
      combatPickInto(r, b, cbState.rows);
      cbState.rows.splice(combatAddIndex(cbState.rows), 0, r);
      cbSave(); return 0; })()`);
    rig.check(q(await entryPage(dm)) === SHOWN, '1: the entry should show its five slot levels full, shows ' + q(await dm.evaluate(CELLS)));
    rig.check(q(await spend(dm, 1)) === with1(1), '1: a click on a full 1st-level crystal should spend one on the entry, shows ' + q(await dm.evaluate(CELLS)));
    rig.check(q(await copyPage(dm)) === SHOWN, '1: the fight copy should start full, shows ' + q(await dm.evaluate(CELLS)));
    rig.check(q(await spend(dm, 3)) === with1(3), '1: three clicks should spend three on the copy, shows ' + q(await dm.evaluate(CELLS)));
    await click(dm, empty(1));
    rig.check(q(await dm.evaluate(CELLS)) === with1(2), '1: a click on an empty crystal should return one, shows ' + q(await dm.evaluate(CELLS)));
    const st = await dm.evaluate(`(() => { const e = ${ENTRY('Mage')}, c = JSON.parse(localStorage.getItem('evermist.combat'));
      const r = c.rows.find(x => x.name === 'Mage');
      return { entry: (JSON.parse(localStorage.getItem('evermist.entrySpent') || '{}')[e.uid] || {})[${q(KEY)}], row: (r.spent || {})[${q(KEY)}], changed: r.sbChanged }; })()`);
    rig.check(st.entry === 1, '1: evermist.entrySpent should hold the entry\'s one, holds ' + q(st));
    rig.check(st.row === 2 && st.changed === false, '1: the saved row should hold two spent and stay unchanged, holds ' + q(st));
    await dm.evaluate('bestiarySetOpen(false); cbSetOpen(false); 0');
  });

  await lib.step(rig, '1b each', async () => {
    await entryPage(dm, 'Lich');
    rig.check(q(await dm.evaluate(EACHES)) === q(['Animate Dead 0/2', 'Dimension Door 0/2', 'Plane Shift 0/2']), '1b: "2/Day Each" should put two full crystals on each spell, shows ' + q(await dm.evaluate(EACHES)));
    await click(dm, spellFull(1, 0)); await click(dm, spellFull(1, 0));
    rig.check(q(await dm.evaluate(EACHES)) === LICH_SPENT, '1b: both of Animate Dead\'s crystals spent should grey it alone, shows ' + q(await dm.evaluate(EACHES)));
    const held = await dm.evaluate(`(JSON.parse(localStorage.getItem('evermist.entrySpent') || '{}')[${ENTRY('Lich')}.uid] || {})[${q(EACH)}]`);
    rig.check(held === 2, '1b: evermist.entrySpent should hold Animate Dead\'s two under ' + EACH + ', holds ' + q(held));
    await dm.evaluate('bestiarySetOpen(false); 0');
  });

  dm = await rig.restart();
  await lib.installHelpers(dm);
  await lib.step(rig, '2 after a restart', async () => {
    rig.check(q(await entryPage(dm)) === with1(1), '2: the entry should still show one spent, shows ' + q(await dm.evaluate(CELLS)));
    rig.check(q(await copyPage(dm)) === with1(2), '2: the copy should still show two spent, shows ' + q(await dm.evaluate(CELLS)));
    await entryPage(dm, 'Lich');
    rig.check(q(await dm.evaluate(EACHES)) === LICH_SPENT, '2: Animate Dead should still be spent and grey, shows ' + q(await dm.evaluate(EACHES)));
    await dm.evaluate('bestiarySetOpen(false); cbSetOpen(false); 0');
  });

  dm = await rig.restart({ exe: PREV });
  const ver = await dm.evaluate('window.electronAPI.getAppVersion()');
  if (!rig.check(ver === '5.18.1', '0: the previous release under ' + PREV + ' is ' + ver + ', not 5.18.1; set it up again')) return;
  await lib.installHelpers(dm);
  await lib.step(rig, '3 on 5.18.1', async () => {
    await dm.evaluate(`(() => { bestiarySetOpen(true); _bsShow(${ENTRY('Mage')}.id); cbSetOpen(true); bcOpen(${ROW}); return 0; })()`);
    await lib.settle(dm, 'document.getElementById("cb-fight").style.display === "block"', 15000);
    const bad = await faults(dm);
    rig.check(!bad.length, '3: on 5.18.1 the Bestiary and the table should open without error, got ' + q(bad));
    await dm.evaluate(`(() => { const row = [...document.querySelectorAll('#cb-list .cb-row')].find(e => e.querySelector('[data-f=name]').value === 'Mage');
      const i = row.querySelector('[data-f=hp]'); i.focus(); i.value = '- 5';
      i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      cbSave(); bestiarySetOpen(false); cbSetOpen(false); return 0; })()`);
    const saved = await dm.evaluate(`(r => r.hp + ':' + JSON.stringify(r.spent))((JSON.parse(localStorage.getItem('evermist.combat')).rows || []).find(x => x.name === 'Mage'))`);
    rig.check(saved === '- 5:' + q({ [KEY]: 2 }), '3: on 5.18.1 the HP should save with the crystals riding along, holds ' + saved);
  });

  dm = await rig.restart({ exe: null });
  await lib.installHelpers(dm);
  await lib.step(rig, '4 back here', async () => {
    rig.check(q(await copyPage(dm)) === with1(2), '4: the copy should show two spent after 5.18.1, shows ' + q(await dm.evaluate(CELLS)));
    rig.check(q(await entryPage(dm)) === with1(1), '4: the entry should show one spent after 5.18.1, shows ' + q(await dm.evaluate(CELLS)));
    const bad = await faults(dm);
    rig.check(!bad.length, '4: back on this build the pages should open without error, got ' + q(bad));
  });

  await lib.step(rig, '4b edit mode', async () => {
    await entryPage(dm);
    await click(dm, `document.querySelector('#bs-page [data-a="edit"]')`);
    await lib.settle(dm, 'bs.editing === true', 5000);
    rig.check(await dm.evaluate('bs.editing === true && !!document.querySelector("#bs-page .bp-ed")'), '4b: the pencil should open the editor');
    rig.check(await dm.evaluate('document.querySelectorAll("#bs-page .sp-grp").length') === 0, '4b: the editor should show no rows');
    const typed = await dm.evaluate(`(el => { if (!el) return false; el.textContent = el.textContent.replace('2nd level (3 slots)', '2nd level (4 slots)');
      el.dispatchEvent(new Event('input', { bubbles: true })); return /2nd level \\(4 slots\\)/.test(${ENTRY('Mage')}.secs.Traits[0].t); })(document.querySelector('#bs-page [data-p="secs.Traits.0.t"]'))`);
    rig.check(typed, '4b: the edit typed into the entry\'s text should reach the entry');
    await click(dm, `document.querySelector('#bs-page .bs-done[data-a="edit"]')`);
    await lib.settle(dm, 'bs.editing === false', 5000);
    rig.check(!(await dm.evaluate('bs.editing')), '4b: Done should leave the editor');
    const want = with1(1).replace('"0/3"', '"0/4"');
    rig.check(q(await dm.evaluate(CELLS)) === want, '4b: the rows should read again with four cells at 2nd level and the one spent kept, want ' + want + ', shows ' + q(await dm.evaluate(CELLS)));
  });
};
