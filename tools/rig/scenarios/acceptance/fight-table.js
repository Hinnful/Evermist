'use strict';

// fight-table.js — THE FIGHT TABLE ON THE DM'S SCREEN.
//
// THE GOAL OF THIS FEATURE: the DM runs a fight from one table beside the map - initiative, name,
// HP typed as a running sum, AC, conditions - with a stat block per creature, and never alt-tabs
// to a notes app for it. Nothing in it reaches the TV.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its
// letter.
//
//   A. The Fight button opens and closes the table, and is lit while it is open.
//   B. "+ Add enemy" and "+ Add ally" each add a row on that side, with the caret in its name.
//   C. The HP cell shows what the typed line adds up to; at half or below the row is bloodied, and
//      at zero or below it is down.
//   D. The Conditions cell opens a list that ticks several conditions on and off, and closes on a
//      click anywhere, on a second click of its cell, and on Escape.
//   E. The Init header sorts highest first, and a row dragged by its grip lands where it is dropped.
//   F. OPEN shows the creature's stat block: an ability's modifier follows its score, the Enemy |
//      Ally switch moves the row to that side, and numbered copies share one block.
//   G. A letter typed into the stat block stays in the stat block; the map's tool does not change.
//   H. The fight and its stat blocks come back after a restart.
//   I. The Player window has no fight table and no Fight button.
//   J. A backup's fight joins the one on screen: a block the DM already has keeps theirs, a new one
//      is added, and the backup's rows land only on an empty table.
//
// ⚠ THE ZIP ITSELF IS NOT DRIVEN. Its save dialog is native, so J hands cbMergePayload the JSON a
// backup carries; backup.js's own scenario covers the zip path around it.

const lib = require('../../lib');

const OWN_HELPERS = `
globalThis.__cbRows = () => [...document.querySelectorAll('#cb-list .cb-row')].map(r => ({
  name: r.querySelector('[data-f=name]').value,
  sum: r.querySelector('.sum').textContent,
  side: r.classList.contains('side-ally') ? 'ally' : 'enemy',
  down: r.classList.contains('down'),
  bloodied: r.classList.contains('bloodied'),
}));
globalThis.__cbRow = (name) => [...document.querySelectorAll('#cb-list .cb-row')]
  .find(r => r.querySelector('[data-f=name]').value === name);
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
  document.querySelector('.cb-add[data-add="' + side + '"]').click();
  const focused = document.activeElement && document.activeElement.dataset.f;
  __cbType(null, 'init', init); __cbType(null, 'name', name); __cbType(null, 'hp', hp); __cbType(null, 'ac', ac);
  return focused;
};
globalThis.__cbPick = (label) => {
  const it = [...document.querySelectorAll('#cb-menu [data-i]')].find(d => d.textContent.replace('✓', '').trim() === label);
  if (it) it.click();
  return !!it;
};
globalThis.__cbEdit = (path, v) => {
  const el = document.querySelector('#cb-stat [data-p="' + path + '"]');
  el.focus(); el.textContent = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 0;
};
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
  rig.check(opened.shown === 'block', 'the Fight button did not open the table: ' + JSON.stringify(opened));
  rig.check(opened.lit, 'the Fight button is not lit while the table is open');
  await dm.evaluate('document.getElementById("btn-combat").click(); 0');
  rig.check(await dm.evaluate('document.getElementById("cb-fight").style.display === "none"'),
            'a second press of the Fight button left the table open');
  await dm.evaluate('document.getElementById("btn-combat").click(); 0');

  // ── B. Add enemy and Add ally ─────────────────────────────────────────────
  // RED ON: the foot's click handler forced to add 'enemy' (combatTracker.js) — 2026-09-24
  const caret = await dm.evaluate('__cbAdd("enemy", "16", "Wight", "45 - 9 - 12", "14")');
  await dm.evaluate('__cbAdd("ally", "18", "Alister", "", "")');
  await dm.evaluate('__cbAdd("enemy", "14", "Skeleton 1", "13 - 6 - 7", "13")');
  await dm.evaluate('__cbAdd("enemy", "11", "Skeleton 2", "13 - 7", "13")');
  const rows = await dm.evaluate('__cbRows()');
  rig.note('rows: ' + JSON.stringify(rows));
  rig.check(caret === 'name', 'a new row did not put the caret in its name field, it went to: ' + caret);
  rig.check(rows.length === 4, 'four adds left ' + rows.length + ' rows');
  rig.check(rows[0].side === 'enemy' && rows[1].side === 'ally',
            '"+ Add enemy" and "+ Add ally" did not put their rows on their own sides: ' + JSON.stringify(rows));

  // ── C. The HP sum, bloodied and down ──────────────────────────────────────
  // RED ON: bloodied gated off in combatHpState (combatPlan.js) — 2026-09-24
  const hp = n => rows.find(r => r.name === n);
  rig.check(hp('Wight').sum === '24', 'the HP cell shows "' + hp('Wight').sum + '" for "45 - 9 - 12", not 24');
  rig.check(!hp('Wight').bloodied, 'the Wight at 24 of 45 reads as bloodied, above half');
  rig.check(hp('Skeleton 2').bloodied && !hp('Skeleton 2').down,
            'the skeleton at 6 of 13 is not bloodied, or reads as down: ' + JSON.stringify(hp('Skeleton 2')));
  rig.check(hp('Skeleton 1').down, 'the skeleton at 0 HP is not greyed out as down');
  rig.check(hp('Alister').sum === '', 'a player with no HP typed shows a total: "' + hp('Alister').sum + '"');

  // ── D. Conditions ─────────────────────────────────────────────────────────
  // RED ON: _cbMenuOutside moved off the capture phase (combatTracker.js); the Escape check is unproved — 2026-09-24
  await dm.evaluate('__cbRow("Wight").querySelector("[data-cond]").click(); new Promise(r => setTimeout(r, 30))');
  const picked = await dm.evaluate('[__cbPick("Poisoned"), __cbPick("Prone")]');
  const stillOpen = await dm.evaluate('!!document.getElementById("cb-menu")');
  await dm.evaluate('__cbPick("Poisoned"); document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); 0');
  const conds = await dm.evaluate('cbState.rows.find(r => r.name === "Wight").conds');
  rig.check(picked[0] && picked[1], 'the Conditions list is missing Poisoned or Prone');
  rig.check(stillOpen, 'the Conditions list closed after one pick, so a second condition means opening it again');
  rig.check(JSON.stringify(conds) === '["Prone"]',
            'ticking Poisoned and Prone, then unticking Poisoned, left: ' + JSON.stringify(conds));
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

  // ── E. Sort, then drag ────────────────────────────────────────────────────
  // RED ON: combatSortByInit gated off on the #cb-sort click (combatTracker.js) — 2026-09-24
  await dm.evaluate('document.getElementById("cb-sort").click(); 0');
  const sorted = (await dm.evaluate('__cbRows()')).map(r => r.name);
  rig.check(JSON.stringify(sorted) === JSON.stringify(['Alister', 'Wight', 'Skeleton 1', 'Skeleton 2']),
            'the Init header did not sort highest first: ' + JSON.stringify(sorted));
  await dm.evaluate(`(() => {
    const grip = __cbRow('Skeleton 2').querySelector('.cb-rowgrip');
    const top = __cbRow('Alister').getBoundingClientRect();
    grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: top.left + 4, clientY: top.bottom + 40 }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: top.left + 4, clientY: top.top + 3 }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: top.left + 4, clientY: top.top + 3 }));
    return 0;
  })()`);
  const dragged = (await dm.evaluate('__cbRows()')).map(r => r.name);
  rig.check(dragged[0] === 'Skeleton 2' && dragged.length === 4,
            'a row dragged onto the top half of the first row did not land first: ' + JSON.stringify(dragged));

  // ── F. The stat block ─────────────────────────────────────────────────────
  // RED ON: the row.side write gated off in the side switch (combatStatBlock.js) — 2026-09-24
  await dm.evaluate('__cbRow("Skeleton 1").querySelector("[data-open]").click(); 0');
  rig.check(await dm.evaluate('document.getElementById("cb-stat").style.display === "block"'),
            'OPEN did not show the stat block');
  await dm.evaluate('__cbEdit("abil.1", "14"); __cbEdit("ac", "13 (armor scraps)")');
  const mod = await dm.evaluate('document.querySelector("#cb-stat [data-mod=\\"1\\"]").textContent');
  rig.check(mod === '(+2)', 'a DEX of 14 shows the modifier ' + mod + ', not (+2)');
  const shared = await dm.evaluate(`({ blocks: Object.keys(cbState.blocks),
    note: (document.querySelector('#cb-stat .cb-sb-shared') || {}).textContent || '' })`);
  rig.check(JSON.stringify(shared.blocks) === '["Skeleton"]',
            'the stat block is not filed under "Skeleton" alone, so the copies do not share it: ' + JSON.stringify(shared.blocks));
  rig.check(/^2 rows/.test(shared.note), 'the shared block does not say two rows share it: "' + shared.note + '"');
  await dm.evaluate('document.querySelector("#cb-stat [data-side=\\"ally\\"]").click(); 0');
  rig.check((await dm.evaluate('cbState.rows.find(r => r.name === "Skeleton 1").side')) === 'ally',
            'the Ally switch in the stat block did not move the row to the allies');

  // ── G. Typing in the stat block stays there ───────────────────────────────
  // RED ON: the panels' keydown stopPropagation gated off (combatTracker.js) — 2026-09-24
  // The control first: a bare R on the map does change the tool, so the check below can fail.
  await dm.evaluate('document.activeElement && document.activeElement.blur(); __rigKey("KeyR"); 0');
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

  // ── H. A restart ──────────────────────────────────────────────────────────
  // RED ON: _cbLoad returning before it reads the store (combatTracker.js) — 2026-09-24
  await dm.evaluate('cbSave(); 0');
  dm = await rig.restart();
  await lib.settle(dm, 'typeof cbState !== "undefined" && cbState.rows.length > 0', 60000);
  const back = await dm.evaluate(`({ rows: cbState.rows.map(r => r.name + '|' + r.hp + '|' + r.side),
    dex: cbState.blocks.Skeleton && cbState.blocks.Skeleton.abil[1] })`);
  rig.note('after the restart: ' + JSON.stringify(back));
  rig.check(back.rows.length === 4 && back.rows.includes('Wight|45 - 9 - 12|enemy'),
            'the fight did not come back after a restart: ' + JSON.stringify(back.rows));
  rig.check(back.dex === '14', 'the stat block did not come back after a restart: DEX is ' + back.dex);

  // ── I. Nothing reaches the Player ─────────────────────────────────────────
  // RED ON: initCombatTracker forced to run in the Player (index.html); the button check is unproved, #scene-dd hides it first — 2026-09-24
  const player = await rig.player();
  const onTv = await player.evaluate(`({ table: !!document.getElementById('cb-fight'),
    button: (() => { const b = document.getElementById('btn-combat'); return !!b && b.getClientRects().length > 0; })() })`);
  rig.check(!onTv.table, 'the Player window built a fight table');
  rig.check(!onTv.button, 'the Player window shows the Fight button');

  // ── J. A backup's fight joins the one on screen ───────────────────────────
  // RED ON: cbMergePayload overwriting blocks the DM has (combatTracker.js) — 2026-09-24
  const merged = await dm.evaluate(`(() => {
    const incoming = JSON.stringify({
      rows: [{ id: 1, init: '9', name: 'Ghoul 1', hp: '22', ac: '12', conds: [], side: 'enemy' }],
      blocks: { Skeleton: { name: 'Skeleton', abil: ['1','1','1','1','1','1'], secs: {} },
                Ghoul: { name: 'Ghoul', abil: ['13','15','10','7','10','6'], secs: {} } },
    });
    const kept = cbMergePayload(incoming).ok;
    const onFull = { rows: cbState.rows.length, dex: cbState.blocks.Skeleton.abil[1], ghoul: !!cbState.blocks.Ghoul };
    cbState.rows = [];
    cbMergePayload(incoming);
    return { kept, onFull, onEmpty: cbState.rows.map(r => r.name) };
  })()`);
  rig.note('merge: ' + JSON.stringify(merged));
  rig.check(merged.kept, 'cbMergePayload refused a backup it wrote itself');
  rig.check(merged.onFull.dex === '14', 'the backup overwrote the Skeleton block the DM already had');
  rig.check(merged.onFull.ghoul, "the backup's Ghoul block was not added");
  rig.check(merged.onFull.rows === 4, "the backup's rows landed on a table that already had a fight");
  rig.check(JSON.stringify(merged.onEmpty) === '["Ghoul 1"]',
            "the backup's rows did not land on an empty table: " + JSON.stringify(merged.onEmpty));
};
