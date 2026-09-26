'use strict';

// fight-table.js — THE FIGHT TABLE ON THE DM'S SCREEN, AND THE LIST OF FIGHTS.
//
// THE GOAL OF THIS FEATURE: the DM prepares fights ahead and runs each one from a table beside the
// map - initiative, name, HP typed as a running sum, AC, conditions, attacks - with a stat block per
// creature, and never alt-tabs to a notes app for it. Nothing in it reaches the TV.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its
// letter.
//
//   A. The Combat button opens and closes the table, and is lit while it is open.
//   B. "+ Add creature" adds an enemy with the caret in its name; the right-click menu's Add ally
//      adds an ally, and the menu closes on the pick.
//   C. The HP cell shows "= N" for what the line adds up to. Below half the total is yellow, at
//      exactly half it is not, and at zero or below it is red. No row dims.
//   D. The Conditions cell opens a list of checkboxes that set several conditions, every picked
//      chip shows, and the list closes on a click anywhere, on a second click of its cell, and on
//      Escape.
//   E. The Init header sorts highest first. A row has no grip: a press that travels moves it to
//      where it is dropped, and a press that does not travel moves nothing.
//   F. The stat block icon shows the row's own stat block: an ability's modifier follows its score,
//      the Enemy | Ally switch moves the row to that side, and an edit changes that row alone. The
//      row's AC is the stat block's and cannot be typed in the row once set, and a row typed by
//      hand hands its first HP number to the stat block.
//   K. Save to Bestiary lights on an edit, adds the row's stat block to the bestiary as a new
//      entry, and goes dark; the entry and the row then change apart.
//   L. An empty Init field shows the stat block's DEX bonus as a hint; a player's shows none.
//   M. The Attacks cell shows each damaging action as a pill: name, to-hit, a glyph and the damage,
//      no type word, and its full text on hover. Two damage types sit in one pill, a clear
//      Multiattack counts its attacks, and one with a choice is a Multiattack pill with no counts.
//      A double-click writes the DM's own
//      line: Enter keeps it, Escape drops it, Save to Bestiary lights, and the stat block's Table
//      line shows it. Nothing typed there reaches the page as markup.
//   N. A row's hover icons duplicate it, switch its side and delete it. Ctrl+D duplicates the row
//      being typed in. A copy takes the highest number plus one, at full HP with no conditions.
//      The right-click menu on a row lists its actions and closes on a pick.
//   O. The fight picker lists every fight: New fight, rename, switch, duplicate and delete work,
//      each fight keeps its own rows through a switch, a pick closes the picker, the open fight
//      is marked, and Delete asks first.
//   G. A letter typed into the stat block stays in the stat block; the map's tool does not change.
//   H. The fights and the open one come back after a restart, and a save from before the list of
//      fights comes back as one fight named "Fight".
//   I. The Player window has no fight table and no Combat or Bestiary button.
//   J. A backup carries every fight. A restore adds the fights the DM lacks and replaces none, an
//      entry the DM already has keeps theirs, and a backup from before the list adds one fight.
//   Q. The table resizes from its right edge, bottom edge and corner: width goes to the Attacks
//      column, which stops at its minimum, height goes to the rows, and the size is remembered.
//   P. Scenes, Two maps, Combat, Bestiary, Music and the Fog/Grid/Player tabs share one top edge
//      and one height; Bestiary sits on the window's centre line.
//
// ⚠ THE ZIP ITSELF IS NOT DRIVEN. Its save dialog is native, so J hands cbBackupPayload and
// cbMergePayload the JSON a backup carries; backup.js's own scenario covers the zip path around it.

const lib = require('../../lib');

const OWN_HELPERS = `
globalThis.__cbRows = () => [...document.querySelectorAll('#cb-list .cb-row')].map(r => ({
  name: r.querySelector('[data-f=name]').value,
  sum: r.querySelector('.sum').textContent,
  side: r.classList.contains('side-ally') ? 'ally' : 'enemy',
  low: r.classList.contains('low'),
  dead: r.classList.contains('dead'),
  sumColour: getComputedStyle(r.querySelector('.sum')).color,
  sumBefore: getComputedStyle(r.querySelector('.sum'), '::before').content,
  opacity: getComputedStyle(r.querySelector('.cb-cell.name')).opacity,
}));
globalThis.__cbRow = (name) => [...document.querySelectorAll('#cb-list .cb-row')]
  .find(r => r.querySelector('[data-f=name]').value === name);
globalThis.__cbData = (name) => cbState.rows.find(r => r.name === name);
// Typed the way a field is typed: an input event per value, then the field is left.
globalThis.__cbType = (name, f, v) => {
  const row = name === null ? [...document.querySelectorAll('#cb-list .cb-row')].pop() : __cbRow(name);
  const inp = row.querySelector('[data-f=' + f + ']');
  inp.focus(); inp.value = v;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  return 0;
};
globalThis.__cbAdd = (side, init, name, hp, ac) => {
  if (side === 'enemy') document.querySelector('#cb-list [data-add]').click();
  else { __cbContext(document.querySelector('#cb-list [data-add]')); __cbPick('Add ally'); }
  const focused = document.activeElement && document.activeElement.dataset.f;
  __cbType(null, 'init', init); __cbType(null, 'name', name); __cbType(null, 'hp', hp); __cbType(null, 'ac', ac);
  return focused;
};
// A missing row or item answers empty rather than throwing, so a broken build fails on the check that names it.
globalThis.__cbContext = (el) => {
  if (!el) return [];
  const b = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 5, clientY: b.top + 5 }));
  return [...document.querySelectorAll('#cb-menu [data-i]')].map(d => d.firstChild.textContent);
};
globalThis.__cbPick = (label) => {
  const it = [...document.querySelectorAll('#cb-menu [data-i]')].find(d => d.textContent.replace('Ctrl+D', '').trim() === label);
  if (it) it.click();
  return !!it;
};
globalThis.__cbIcon = (name, b) => { const r = __cbRow(name); if (r) r.querySelector('[data-b="' + b + '"]').click(); return 0; };
globalThis.__cbEdit = (path, v) => {
  const el = document.querySelector('#cb-stat [data-p="' + path + '"]');
  el.focus(); el.textContent = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 0;
};
globalThis.__cfOpenList = () => { if (!document.getElementById('cf-menu')) document.getElementById('cb-fightpick').click(); return 0; };
globalThis.__cfItem = (name) => [...document.querySelectorAll('#cf-menu .cf-item')].find(e => e.querySelector('.nm').textContent === name);
globalThis.__cfNames = () => cbState.fights.map(f => f.name);
0`;

module.exports = async function fightTableFeature(rig) {
  let dm = rig.dm;
  await lib.openMap(rig, { w: 1200, h: 800 });
  await dm.evaluate(OWN_HELPERS);

  // ── A. The button opens and closes the table ──────────────────────────────
  // RED ON: the active toggle gated off in cbSetOpen (combatTracker.js) — 2026-09-24
  await dm.evaluate('document.getElementById("btn-combat").click(); 0');
  const opened = await dm.evaluate(`({ shown: document.getElementById('cb-fight').style.display,
    lit: document.getElementById('btn-combat').classList.contains('active') })`);
  rig.check(opened.shown === 'block', 'the Combat button did not open the table: ' + JSON.stringify(opened));
  rig.check(opened.lit, 'the Combat button is not lit while the table is open');
  await dm.evaluate('document.getElementById("btn-combat").click(); 0');
  rig.check(await dm.evaluate('document.getElementById("cb-fight").style.display === "none"'),
            'a second press of the Combat button left the table open');
  await dm.evaluate('document.getElementById("btn-combat").click(); 0');

  // ── B. Add creature, and Add ally from the right-click menu ───────────────
  // RED ON: Add ally's pick forced to 'enemy' (combatTracker.js) — 2026-09-26
  const caret = await dm.evaluate('__cbAdd("enemy", "16", "Wight", "45 - 9 - 12", "14")');
  await dm.evaluate('__cbAdd("ally", "18", "Alister", "", "")');
  const menuGone = await dm.evaluate('!document.getElementById("cb-menu")');
  await dm.evaluate('__cbAdd("enemy", "14", "Skeleton 1", "13 - 6 - 7", "13")');
  await dm.evaluate('__cbAdd("enemy", "11", "Skeleton 2", "13 - 7", "13")');
  await dm.evaluate('__cbAdd("enemy", "10", "Zombie", "20 - 10", "8")');
  const rows = await dm.evaluate('__cbRows()');
  rig.note('rows: ' + JSON.stringify(rows.map(r => r.name + ' ' + r.sum)));
  rig.check(caret === 'name', 'a new row did not put the caret in its name field, it went to: ' + caret);
  rig.check(rows.length === 5, 'five adds left ' + rows.length + ' rows');
  rig.check(rows[0].side === 'enemy' && rows[1].side === 'ally',
            '"+ Add creature" and the menu\'s Add ally did not put their rows on their own sides: ' + JSON.stringify(rows.map(r => r.side)));
  rig.check(menuGone, 'the right-click menu stayed open after Add ally was picked');

  // ── C. The HP total and its colours ───────────────────────────────────────
  // RED ON: the low class gated off in _cbHpClass (combatTracker.js) — 2026-09-26
  const hp = n => rows.find(r => r.name === n);
  rig.check(hp('Wight').sum === '24' && hp('Wight').sumBefore.includes('='),
            'the HP cell does not read "= 24" for "45 - 9 - 12": ' + JSON.stringify(hp('Wight')));
  rig.check(!hp('Wight').low && !hp('Wight').dead, 'the Wight at 24 of 45 is coloured, above half');
  rig.check(hp('Skeleton 2').low && !hp('Skeleton 2').dead,
            'the skeleton at 6 of 13 is not yellow, or reads as dead: ' + JSON.stringify(hp('Skeleton 2')));
  rig.check(!hp('Zombie').low, 'the zombie at exactly half (10 of 20) turned yellow');
  rig.check(hp('Skeleton 1').dead, 'the skeleton at 0 HP is not red');
  rig.check(hp('Skeleton 1').sumColour !== hp('Skeleton 2').sumColour && hp('Skeleton 2').sumColour !== hp('Wight').sumColour,
            'yellow, red and plain totals share a colour: ' + [hp('Wight'), hp('Skeleton 2'), hp('Skeleton 1')].map(r => r.sumColour).join(' / '));
  rig.check(hp('Skeleton 1').opacity === '1', 'a dead row is dimmed: opacity ' + hp('Skeleton 1').opacity);
  rig.check(hp('Alister').sum === '', 'a player with no HP typed shows a total: "' + hp('Alister').sum + '"');
  await dm.evaluate('_cbRemoveRow(__cbData("Zombie")); 0');

  // ── D. Conditions ─────────────────────────────────────────────────────────
  // RED ON: _cbMenuOutside moved off the capture phase (combatTracker.js); the Escape check is unproved — 2026-09-24
  await dm.evaluate('__cbRow("Wight").querySelector("[data-cond]").click(); new Promise(r => setTimeout(r, 30))');
  const boxes = await dm.evaluate('document.querySelectorAll("#cb-menu .box").length');
  const picked = await dm.evaluate('[__cbPick("Poisoned"), __cbPick("Prone"), __cbPick("Frightened")]');
  const stillOpen = await dm.evaluate('!!document.getElementById("cb-menu")');
  const ticked = await dm.evaluate('document.querySelectorAll("#cb-menu .box.on").length');
  await dm.evaluate('__cbPick("Poisoned"); document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); 0');
  const conds = await dm.evaluate('({ data: __cbData("Wight").conds, chips: __cbRow("Wight").querySelectorAll(".cb-chip").length })');
  rig.check(boxes === 15, 'the Conditions list does not show a checkbox per condition: ' + boxes);
  rig.check(picked.every(Boolean), 'the Conditions list is missing Poisoned, Prone or Frightened');
  rig.check(stillOpen && ticked === 3, 'the Conditions list closed after a pick, or did not tick three boxes: ' + ticked);
  rig.check(JSON.stringify(conds.data) === '["Prone","Frightened"]' && conds.chips === 2,
            'ticking three and unticking Poisoned left: ' + JSON.stringify(conds));
  rig.check(await dm.evaluate('!document.getElementById("cb-menu")'), 'a click elsewhere did not close the Conditions list');
  // The table stops mousedown from bubbling, so a click INSIDE it is the case that used to be missed.
  // The list starts listening one tick after it opens, so each step waits a tick first.
  const closes = await dm.evaluate(`(async () => {
    const tick = () => new Promise(r => setTimeout(r, 30));
    const cell = __cbRow('Wight').querySelector('[data-cond]');
    const out = {};
    cell.click(); await tick();
    __cbRow('Alister').querySelector('[data-f=name]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    out.insideTable = !document.getElementById('cb-menu');
    cell.click(); await tick();
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    cell.click(); await tick();
    out.secondClick = !document.getElementById('cb-menu');
    cell.click(); await tick();
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    out.escape = !document.getElementById('cb-menu');
    return out;
  })()`);
  rig.check(closes.insideTable, 'a click on another cell of the table left the Conditions list open');
  rig.check(closes.secondClick, 'a second click on the Conditions cell reopened the list instead of closing it');
  rig.check(closes.escape, 'Escape did not close the Conditions list');

  // ── E. Sort, then drag with no grip ───────────────────────────────────────
  // RED ON: combatSortByInit gated off on the #cb-sort click (combatTracker.js) — 2026-09-24
  await dm.evaluate('document.getElementById("cb-sort").click(); 0');
  const sorted = (await dm.evaluate('__cbRows()')).map(r => r.name);
  rig.check(JSON.stringify(sorted) === JSON.stringify(['Alister', 'Wight', 'Skeleton 1', 'Skeleton 2']),
            'the Init header did not sort highest first: ' + JSON.stringify(sorted));
  // RED ON: _cbPressRow gated off in the list mousedown (combatTracker.js) — 2026-09-26
  const drag = await dm.evaluate(`(() => {
    const out = { grips: document.querySelectorAll('#cb-fight .cb-rowgrip, #cb-fight .rp-grip').length };
    const from = __cbRow('Skeleton 2').querySelector('[data-f=name]'), f = from.getBoundingClientRect();
    from.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: f.left + 5, clientY: f.top + 5 }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: f.left + 7, clientY: f.top + 6 }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: f.left + 7, clientY: f.top + 6 }));
    out.still = [...document.querySelectorAll('#cb-list .cb-row')].map(r => r.querySelector('[data-f=name]').value);
    const el = __cbRow('Skeleton 2').querySelector('[data-f=name]'), b = el.getBoundingClientRect();
    const top = __cbRow('Alister').getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: b.left + 5, clientY: b.top + 5 }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: b.left + 5, clientY: b.top - 20 }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: top.left + 5, clientY: top.top + 3 }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: top.left + 5, clientY: top.top + 3 }));
    return out;
  })()`);
  const dragged = (await dm.evaluate('__cbRows()')).map(r => r.name);
  rig.check(drag.grips === 0, 'the fight table still draws a grip: ' + drag.grips);
  rig.check(JSON.stringify(drag.still) === JSON.stringify(sorted), 'a press that travelled 2px moved a row: ' + JSON.stringify(drag.still));
  rig.check(dragged[0] === 'Skeleton 2' && dragged.length === 4,
            'a row dragged onto the top half of the first row did not land first: ' + JSON.stringify(dragged));

  // ── F. The stat block ─────────────────────────────────────────────────────
  // RED ON: the row.side write gated off in the side switch (combatStatBlock.js) — 2026-09-24
  await dm.evaluate('__cbIcon("Skeleton 1", "stat")');
  rig.check(await dm.evaluate('document.getElementById("cb-stat").style.display === "block"'),
            'the stat block icon did not show the stat block');
  await dm.evaluate('__cbEdit("abil.1", "14"); __cbEdit("ac", "15 (armor scraps)")');
  const mod = await dm.evaluate('document.querySelector("#cb-stat [data-mod=\\"1\\"]").textContent');
  rig.check(mod === '(+2)', 'a DEX of 14 shows the modifier ' + mod + ', not (+2)');
  // RED ON: the ac line gated off in _cbCopyEdited (combatStatBlock.js) — 2026-09-25
  const own = await dm.evaluate(`(() => {
    return { one: __cbData('Skeleton 1').sb.abil[1], two: __cbData('Skeleton 2').sb.abil[1], ac: __cbData('Skeleton 1').ac,
      cellAc: __cbRow('Skeleton 1').querySelector('[data-f=ac]').value, bestiary: Object.keys(cbState.blocks).length,
      max: __cbData('Wight').sb.hp, line: __cbData('Wight').hp, shownMax: (__cbRow('Wight').querySelector('.max') || {}).textContent || '' };
  })()`);
  rig.check(own.one === '14' && own.two === '10',
            "an edit to Skeleton 1's stat block reached Skeleton 2, or did not land: " + JSON.stringify(own));
  rig.check(own.ac === '15' && own.cellAc === '15', "the row's AC does not follow its stat block's AC: " + JSON.stringify(own));
  rig.check(own.bestiary === 0, 'an edit in the fight wrote to the bestiary: ' + own.bestiary + ' entries');
  rig.check(own.max === '45' && own.line === '- 9 - 12' && own.shownMax === '45',
            "the Wight's typed 45 did not become its stat block's max HP: " + JSON.stringify(own));
  // RED ON: the readonly attribute gated off in cbRender (combatTracker.js) — 2026-09-26
  const fixed = await dm.evaluate(`({ ac: __cbRow('Skeleton 1').querySelector('[data-f=ac]').readOnly,
    acWeight: getComputedStyle(__cbRow('Skeleton 1').querySelector('[data-f=ac]')).fontWeight,
    maxWeight: getComputedStyle(__cbRow('Wight').querySelector('.max')).fontWeight,
    initWeight: getComputedStyle(__cbRow('Wight').querySelector('[data-f=init]')).fontWeight,
    player: __cbRow('Alister').querySelector('[data-f=ac]').readOnly })`);
  rig.check(fixed.ac && !fixed.player, 'the AC field is typable once the stat block holds an AC, or locked on a player: ' + JSON.stringify(fixed));
  rig.check(+fixed.acWeight >= 700 && +fixed.maxWeight >= 700 && +fixed.initWeight <= 400,
            'AC and max HP are not bold, or another number is: ' + JSON.stringify(fixed));
  await dm.evaluate('document.querySelector("#cb-stat [data-side=\\"ally\\"]").click(); 0');
  rig.check((await dm.evaluate('__cbData("Skeleton 1").side')) === 'ally',
            'the Ally switch in the stat block did not move the row to the allies');

  // ── K. Save to Bestiary ───────────────────────────────────────────────────
  // RED ON: combatAddEntry gated off in _cbSaveToBestiary (combatStatBlock.js) — 2026-09-25
  // The icon toggles, and F left this row's stat block open.
  await dm.evaluate('cbStatRowId() === __cbData("Skeleton 1").id || __cbIcon("Skeleton 1", "stat"); 0');
  const saveBefore = await dm.evaluate('!document.querySelector("#cb-stat [data-save]").disabled');
  await dm.evaluate('document.querySelector("#cb-stat [data-save]").click(); 0');
  const saved = await dm.evaluate(`(() => {
    const e = Object.values(cbState.blocks);
    const btn = document.querySelector('#cb-stat [data-save]');
    const out = { n: e.length, name: e[0] && e[0].name, dex: e[0] && e[0].abil[1], dark: btn.disabled, label: btn.textContent };
    __cbEdit('abil.1', '16');
    out.rowDex = __cbData('Skeleton 1').sb.abil[1];
    out.entryDex = e[0] && e[0].abil[1];
    out.lit = !btn.disabled;
    return out;
  })()`);
  rig.note('saved: ' + JSON.stringify(saved));
  rig.check(saveBefore, 'Save to Bestiary was dark after an edit to the stat block');
  rig.check(saved.n === 1 && saved.name === 'Skeleton' && saved.dex === '14',
            'Save to Bestiary did not add the row stat block as one "Skeleton" entry: ' + JSON.stringify(saved));
  rig.check(saved.dark && saved.label === 'Saved', 'Save to Bestiary did not go dark after saving: ' + JSON.stringify(saved));
  rig.check(saved.rowDex === '16' && saved.entryDex === '14' && saved.lit,
            'after saving, an edit to the row reached the bestiary entry, or did not light the button again: ' + JSON.stringify(saved));
  await dm.evaluate('__cbEdit("abil.1", "14"); 0');

  // ── L. The initiative hint ────────────────────────────────────────────────
  // RED ON: the placeholder hint gated off in cbRender (combatTracker.js) — 2026-09-26
  const hint = await dm.evaluate(`(() => {
    __cbType('Skeleton 1', 'init', '');
    cbRender();
    return { skel: __cbRow('Skeleton 1').querySelector('[data-f=init]').placeholder,
      player: __cbRow('Alister').querySelector('[data-f=init]').placeholder, value: __cbData('Skeleton 1').init };
  })()`);
  rig.check(hint.skel === '+2' && hint.value === '', "an empty Init field does not hint the stat block's DEX bonus: " + JSON.stringify(hint));
  rig.check(hint.player === '', 'a player with no stat block shows an initiative hint: ' + hint.player);
  await dm.evaluate('__cbType("Skeleton 1", "init", "14"); 0');

  // ── M. The Attacks line ───────────────────────────────────────────────────
  // RED ON: the DM's line gated off in _cbEditAttacks (combatTracker.js) — 2026-09-26
  const atk = await dm.evaluate(`(async () => {
    const tick = () => new Promise(r => setTimeout(r, 30));
    const r = __cbData('Wight');
    const pills = () => [...__cbRow('Wight').querySelectorAll('.cb-atk .cb-pill')].map(p => ({
      text: p.textContent, title: p.title, fb: p.classList.contains('fb'),
      dmg: [...p.querySelectorAll('.pd')].map(d => ({ n: d.textContent, glyph: !!d.querySelector('svg') })) }));
    const bite = { n: 'Bite', t: 'Melee Weapon Attack: +10 to hit. Hit: 17 (2d10 + 6) piercing damage plus 3 (1d6) fire damage.' };
    const claw = { n: 'Claw', t: 'Melee Weapon Attack: +10 to hit. Hit: 13 (2d6 + 6) slashing damage.' };
    r.sb.secs = { Actions: [{ n: 'Multiattack', t: 'It makes three attacks: one with its bite and two with its claws.' }, bite, claw] };
    cbRender();
    const out = { counted: pills() };
    r.sb.secs = { Actions: [{ n: 'Multiattack', t: 'It makes two claw attacks or one bite attack.' }, bite, claw] };
    cbRender();
    out.choice = pills();
    r.sb.secs = { Actions: [{ n: 'Longsword', t: 'Melee Weapon Attack: +4 to hit, reach 5 ft. Hit: 6 (1d8 + 2) slashing damage.' }] };
    r.sbChanged = false;
    cbRender();
    out.single = pills();
    const cell = () => __cbRow('Wight').querySelector('.cb-cell.atk');
    cell().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    let span = cell().querySelector('.cb-atk');
    out.editing = span.classList.contains('editing');
    span.textContent = 'Nothing kept';
    span.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    out.afterEscape = r.sb.quick;
    cell().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    span = cell().querySelector('.cb-atk');
    span.textContent = 'Drain <b>life</b> DC 13';
    span.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();
    out.quick = r.sb.quick;
    out.shown = __cbRow('Wight').querySelector('.cb-atk').textContent;
    out.markup = !!__cbRow('Wight').querySelector('.cb-atk b');
    out.changed = r.sbChanged;
    __cbIcon('Wight', 'stat');
    out.tableLine = (document.querySelector('#cb-stat [data-p="quick"]') || {}).textContent;
    out.saveLit = !document.querySelector('#cb-stat [data-save]').disabled;
    cbCloseStat(); cbRender();
    return out;
  })()`);
  rig.note('attacks: ' + JSON.stringify(atk));
  // RED ON: _cbDamageSeg's glyph, the pill's title, combatAttacks' counts and _cbMultiCounts' choice
  // test each gated off in turn (attackPills.js, attackLine.js) — 2026-09-26
  const one = atk.single[0] || { dmg: [] };
  rig.check(atk.single.length === 1 && one.text.includes('Longsword') && one.text.includes('+4') && !/slashing/i.test(one.text)
            && one.dmg.length === 1 && one.dmg[0].n === '6' && one.dmg[0].glyph,
            "the Attacks cell did not show the stat block's attack as a pill with a glyph: " + JSON.stringify(atk.single));
  rig.check(one.title && one.title.includes('Hit: 6 (1d8 + 2) slashing damage'), "a pill's hover does not carry the action's full text: " + one.title);
  const [cBite, cClaw] = atk.counted.concat({ dmg: [], text: '' }, { dmg: [], text: '' });
  rig.check(atk.counted.length === 2 && cBite.dmg.map(d => d.n).join() === '17,3' && !/2×/.test(cBite.text) && /2×/.test(cClaw.text),
            'a two-type attack is not one pill with two damage parts, or a clear Multiattack did not count: ' + JSON.stringify(atk.counted));
  rig.check(atk.choice.length === 3 && atk.choice[0].fb && !atk.choice.some(p => /×/.test(p.text)),
            'a Multiattack with a choice did not show as its own pill with no counts: ' + JSON.stringify(atk.choice));
  rig.check(atk.editing && atk.afterEscape === undefined, 'a double-click did not edit the line, or Escape kept what was typed: ' + JSON.stringify(atk));
  rig.check(atk.quick === 'Drain <b>life</b> DC 13' && atk.shown === atk.quick && !atk.markup,
            "the DM's own line was not kept as plain text: " + JSON.stringify(atk));
  rig.check(atk.changed && atk.saveLit, 'writing the line did not light Save to Bestiary');
  rig.check(atk.tableLine === atk.quick, "the stat block's Table line does not show the DM's line: " + atk.tableLine);

  // ── N. Hover icons, Ctrl+D and the row's right-click menu ─────────────────
  // RED ON: the Ctrl+D branch gated off in the list keydown (combatTracker.js) — 2026-09-26
  const acts = await dm.evaluate(`(() => {
    const out = { icons: [...__cbRow('Skeleton 1').querySelectorAll('.cb-cell.atk [data-b]')].map(b => b.dataset.b).join() };
    __cbData('Skeleton 1').conds = ['Prone'];
    __cbIcon('Skeleton 1', 'dup');
    out.afterIcon = cbState.rows.map(r => r.name);
    const inp = __cbRow('Skeleton 1').querySelector('[data-f=hp]');
    inp.focus();
    inp.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', key: 'd', ctrlKey: true, bubbles: true, cancelable: true }));
    out.afterKey = cbState.rows.map(r => r.name);
    const copy = __cbData('Skeleton 4') || {};
    out.copy = { hp: copy.hp, conds: (copy.conds || []).length, focus: document.activeElement && document.activeElement.dataset.f };
    __cbIcon('Skeleton 4', 'side');
    out.side = (__cbData('Skeleton 4') || {}).side;
    out.menu = __cbContext(__cbRow('Skeleton 4')?.querySelector('.cb-cell.atk'));
    __cbPick('Delete');
    out.menuGone = !document.getElementById('cb-menu');
    __cbIcon('Skeleton 3', 'del');
    out.afterDelete = cbState.rows.map(r => r.name);
    return out;
  })()`);
  rig.note('row actions: ' + JSON.stringify(acts));
  rig.check(acts.icons === 'stat,dup,side,del', "the Attacks cell does not hold the row's four icons: " + acts.icons);
  rig.check(acts.afterIcon.includes('Skeleton 3') && acts.afterKey.includes('Skeleton 4'),
            'the icon and Ctrl+D did not each add a copy under the next number: ' + JSON.stringify(acts.afterKey));
  rig.check(acts.copy.hp === '' && acts.copy.conds === 0 && acts.copy.focus === 'hp',
            'a copy did not start at full HP with no conditions and the caret in the same field: ' + JSON.stringify(acts.copy));
  // Skeleton 1 went over to the allies in F, so its copy starts there and the icon brings it back.
  rig.check(acts.side === 'enemy', 'the switch icon did not move the copy back to the enemies');
  rig.check(JSON.stringify(acts.menu) === JSON.stringify(['Open stat block', 'Duplicate', 'Make ally', 'Add enemy', 'Add ally', 'Delete']),
            "the row's right-click menu lists: " + JSON.stringify(acts.menu));
  rig.check(acts.menuGone && !acts.afterDelete.includes('Skeleton 4') && !acts.afterDelete.includes('Skeleton 3'),
            'Delete from the menu or the icon left a row, or the menu stayed open: ' + JSON.stringify(acts));

  // ── O. The list of fights ─────────────────────────────────────────────────
  // RED ON: the rename after New fight gated off (combatFights.js) — 2026-09-26
  const list = await dm.evaluate(`(async () => {
    const tick = () => new Promise(r => setTimeout(r, 30));
    const out = { title: document.querySelector('#cb-fightpick .nm').textContent };
    __cfOpenList(); await tick();
    document.querySelector('#cf-menu [data-new]').click();
    const ed = document.querySelector('#cf-menu .nm.editing');
    out.renaming = !!ed;
    if (ed) { ed.textContent = 'Strahd'; ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
    else combatRenameFight(cbState, cbState.openId, 'Strahd');
    out.newTitle = document.querySelector('#cb-fightpick .nm').textContent;
    out.newRows = cbState.rows.length;
    __cbAdd('enemy', '20', 'Strahd', '', '');
    __cfOpenList(); await tick();
    out.marked = !!__cfItem('Strahd')?.classList.contains('on');
    __cfItem('Fight')?.click(); await tick();
    out.closed = !document.getElementById('cf-menu');
    out.back = cbState.rows.map(r => r.name);
    __cfOpenList(); await tick();
    __cbContext(__cfItem('Strahd'));
    __cbPick('Duplicate');
    out.afterDup = __cfNames();
    __cbContext(__cfItem('Strahd copy'));
    __cbPick('Delete'); await tick();
    out.asked = !!document.getElementById('cd-modal') && getComputedStyle(document.getElementById('cd-modal')).display !== 'none';
    document.getElementById('cd-ok').click(); await tick();
    out.afterDelete = __cfNames();
    return out;
  })()`);
  rig.note('fights: ' + JSON.stringify(list));
  rig.check(list.title === 'Fight', 'the fight picker does not name the first fight "Fight": ' + list.title);
  rig.check(list.renaming && list.newTitle === 'Strahd' && list.newRows === 0,
            'New fight did not open an empty fight under the name typed: ' + JSON.stringify(list));
  rig.check(list.marked, 'the open fight is not marked in the list');
  rig.check(list.closed && list.back.includes('Wight') && !list.back.includes('Strahd'),
            'picking a fight left the list open, or the first fight lost its rows: ' + JSON.stringify(list.back));
  rig.check(JSON.stringify(list.afterDup) === JSON.stringify(['Fight', 'Strahd', 'Strahd copy']), 'Duplicate made: ' + JSON.stringify(list.afterDup));
  rig.check(list.asked && JSON.stringify(list.afterDelete) === JSON.stringify(['Fight', 'Strahd']),
            'Delete did not ask first, or did not remove the fight: ' + JSON.stringify(list));

  // ── G. Typing in the stat block stays there ───────────────────────────────
  // RED ON: the panels' keydown stopPropagation gated off (combatTracker.js) — 2026-09-24
  // The control first: a bare R on the map does change the tool, so the check below can fail.
  await dm.evaluate('__cbIcon("Wight", "stat"); document.activeElement && document.activeElement.blur(); __rigKey("KeyR"); 0');
  const control = await dm.evaluate('shape');
  await dm.evaluate('__rigKey("KeyV"); 0');
  await dm.evaluate(`(() => {
    const el = document.querySelector('#cb-stat [data-p="speed"]');
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', key: 'r', bubbles: true, cancelable: true }));
    return 0;
  })()`);
  const afterTyping = await dm.evaluate('shape');
  rig.check(control === 'rect', 'R on the map did not pick the rectangle, so this check cannot tell anything: ' + control);
  rig.check(afterTyping === 'select', 'an R typed into the stat block reached the map and picked "' + afterTyping + '"');

  // ── J. A backup carries every fight ───────────────────────────────────────
  // RED ON: combatMerge adding no fights (fightPlan.js) — 2026-09-26
  const merged = await dm.evaluate(`(() => {
    const payload = JSON.parse(cbBackupPayload());
    const out = { carried: (payload.fights || []).map(f => f.name), top: Object.keys(payload).slice(0, 3).join() };
    const again = cbMergePayload(JSON.stringify(payload)).ok;
    out.again = again && __cfNames().length === 2;
    const incoming = JSON.stringify({
      rows: [{ id: 1, init: '9', name: 'Ghoul 1', hp: '', ac: '12', conds: [], side: 'enemy', sbChanged: false,
               sb: { name: 'Ghoul', source: '', hp: '22', abil: ['13','15','10','7','10','6'], secs: {} } }],
      blocks: { b1: { id: 'b1', name: 'Skeleton', source: '', abil: ['1','1','1','1','1','1'], secs: {} },
                b2: { id: 'b2', name: 'Ghoul', source: '', abil: ['13','15','10','7','10','6'], secs: {} } },
    });
    cbMergePayload(incoming);
    const named = n => Object.values(cbState.blocks).filter(b => b.name === n);
    out.dex = named('Skeleton').map(b => b.abil[1]).join();
    out.ghoul = named('Ghoul').length;
    out.fights = __cfNames();
    out.openRows = cbState.rows.map(r => r.name);
    const restored = cbState.fights.find(f => f.name === 'Restored fight');
    out.restoredRows = restored ? combatFightRows(cbState, restored).map(r => r.name) : [];
    return out;
  })()`);
  rig.note('merge: ' + JSON.stringify(merged));
  rig.check(JSON.stringify(merged.carried) === JSON.stringify(['Fight', 'Strahd']) && merged.top === 'rows,blocks,nextId',
            'the backup did not carry every fight beside the old shape: ' + JSON.stringify(merged));
  rig.check(merged.again, 'restoring a backup of the fights already here added them twice');
  // RED ON: cbMergePayload overwriting blocks the DM has (combatTracker.js) — 2026-09-24
  rig.check(merged.dex === '14', 'the backup overwrote the Skeleton entry the DM already had: ' + merged.dex);
  rig.check(merged.ghoul === 1, "the backup's Ghoul block was not added once");
  rig.check(JSON.stringify(merged.fights) === JSON.stringify(['Fight', 'Strahd', 'Restored fight']) && merged.openRows.includes('Wight'),
            'a backup from before the list did not arrive as one more fight beside the open one: ' + JSON.stringify(merged));
  rig.check(JSON.stringify(merged.restoredRows) === '["Ghoul 1"]', 'the restored fight does not hold the backup\'s rows: ' + JSON.stringify(merged.restoredRows));

  // ── Q. Resizing the table ─────────────────────────────────────────────────
  // RED ON: the Attacks width gated off in _cbResizePanel (combatTracker.js) — 2026-09-26
  const size = await dm.evaluate(`(() => {
    const f = document.getElementById('cb-fight'), l = document.getElementById('cb-list');
    const drag = (rs, dx, dy) => { const h = f.querySelector('[data-rs="' + rs + '"]'), b = h.getBoundingClientRect();
      h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: b.left + 2, clientY: b.top + 2 }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: b.left + 2 + dx, clientY: b.top + 2 + dy }));
      window.dispatchEvent(new MouseEvent('mouseup', {})); };
    const atk = () => f.querySelector('.cb-colhdr > span:last-child').getBoundingClientRect().width;
    const out = { w0: f.getBoundingClientRect().width, a0: atk(), h0: l.getBoundingClientRect().height };
    drag('br', 60, 60);
    out.w1 = f.getBoundingClientRect().width; out.a1 = atk(); out.h1 = l.getBoundingClientRect().height;
    drag('r', -2000, 0);
    out.min = atk() / cbZoom();
    out.saved = JSON.parse(localStorage.getItem('evermist.combatCols') || '{}');
    return out;
  })()`);
  rig.note('resize: ' + JSON.stringify(size));
  rig.check(size.w1 - size.w0 > 30 && Math.abs((size.a1 - size.a0) - (size.w1 - size.w0)) <= 2,
            'widening the table did not give the width to the Attacks column: ' + JSON.stringify(size));
  rig.check(size.h1 - size.h0 > 30, 'the bottom corner did not make the rows taller: ' + JSON.stringify(size));
  rig.check(Math.abs(size.min - 110) <= 1 && size.saved.atk === 110 && size.saved.listH > 0,
            'the Attacks column shrank past its minimum, or the size was not remembered: ' + JSON.stringify(size));

  // ── P. The top bar ────────────────────────────────────────────────────────
  // RED ON: #scene-dd's top put back to 16px (sceneManager.css) — 2026-09-26
  const bar = await dm.evaluate(`(() => {
    const ids = ['scene-dd-toggle', 'btn-two-maps', 'btn-combat', 'btn-bestiary', 'mu-pill', 'cp-tabbar'];
    const boxes = ids.map(id => { const b = document.getElementById(id).getBoundingClientRect(); return { id, top: b.top, h: b.height, mid: b.left + b.width / 2, w: b.width }; });
    return { boxes, width: innerWidth, inScenes: !!document.querySelector('#scene-dd #btn-combat, #scene-dd #btn-bestiary') };
  })()`);
  rig.note('top bar: ' + JSON.stringify(bar.boxes.map(b => b.id + ' ' + Math.round(b.top) + '/' + Math.round(b.h))));
  const tops = bar.boxes.map(b => b.top), heights = bar.boxes.map(b => b.h);
  rig.check(bar.boxes.every(b => b.w > 0) && Math.max(...tops) - Math.min(...tops) <= 1 && Math.max(...heights) - Math.min(...heights) <= 1,
            'the top bar does not share one top edge and one height: ' + JSON.stringify(bar.boxes));
  const best = bar.boxes.find(b => b.id === 'btn-bestiary');
  rig.check(Math.abs(best.mid - bar.width / 2) <= 2, 'Bestiary is not on the window\'s centre line: ' + best.mid + ' of ' + bar.width);
  rig.check(!bar.inScenes, 'Combat or Bestiary still sits in the Scenes group');
  rig.byEye('the top bar reads as three groups, with Combat, Bestiary and Music joined into one');

  // ── H. A restart, then a save from before the list ────────────────────────
  // RED ON: _cbLoad returning before it reads the store (combatTracker.js) — 2026-09-24
  await dm.evaluate('cbSave(); 0');
  dm = await rig.restart();
  await lib.settle(dm, 'typeof cbState !== "undefined" && cbState.fights.length > 1', 60000);
  const back = await dm.evaluate(`({ fights: cbState.fights.map(f => f.name), rows: cbState.rows.map(r => r.name + '|' + r.hp + '|' + r.side),
    dex: (cbState.rows.find(r => r.name === 'Skeleton 1') || { sb: { abil: [] } }).sb.abil[1],
    strahd: combatFightRows(cbState, cbState.fights.find(f => f.name === 'Strahd') || { rows: [] }).map(r => r.name) })`);
  rig.note('after the restart: ' + JSON.stringify(back));
  // RED ON: _cbTakeMax returning early (combatTracker.js) — 2026-09-25
  rig.check(back.rows.includes('Wight|- 9 - 12|enemy'), 'the open fight did not come back after a restart: ' + JSON.stringify(back.rows));
  rig.check(back.dex === '14', 'the stat block did not come back after a restart: DEX is ' + back.dex);
  // RED ON: the evermist.combatFights read gated off in _cbLoad (combatTracker.js) — 2026-09-26
  rig.check(JSON.stringify(back.fights) === JSON.stringify(['Fight', 'Strahd', 'Restored fight']) && JSON.stringify(back.strahd) === '["Strahd"]',
            'the list of fights did not come back whole after a restart: ' + JSON.stringify(back));
  await dm.evaluate(`(() => {
    localStorage.setItem('evermist.combat', JSON.stringify({ rows: [{ id: 1, init: '12', name: 'Old goblin', hp: '- 2', ac: '15',
      conds: [], side: 'enemy', sbChanged: false }], blocks: {}, nextId: 2 }));
    localStorage.removeItem('evermist.combatFights');
    return 0;
  })()`);
  // RED BY DESIGN: written against the fix, never re-proved
  dm = await rig.restart();
  await lib.settle(dm, 'typeof cbState !== "undefined" && cbState.rows.length > 0', 60000);
  const old = await dm.evaluate('({ fights: cbState.fights.map(f => f.name), rows: cbState.rows.map(r => r.name + "|" + r.hp) })');
  rig.check(JSON.stringify(old.fights) === '["Fight"]' && JSON.stringify(old.rows) === '["Old goblin|- 2"]',
            'a save from before the list did not come back as one fight named "Fight": ' + JSON.stringify(old));

  // ── I. Nothing reaches the Player ─────────────────────────────────────────
  // RED ON: initCombatTracker forced to run in the Player (index.html); the button check is unproved — 2026-09-24
  const player = await rig.player();
  const onTv = await player.evaluate(`({ table: !!document.getElementById('cb-fight'),
    buttons: ['btn-combat', 'btn-bestiary'].filter(id => { const b = document.getElementById(id); return !!b && b.getClientRects().length > 0; }) })`);
  rig.check(!onTv.table, 'the Player window built a fight table');
  rig.check(!onTv.buttons.length, 'the Player window shows: ' + onTv.buttons.join(', '));
};
