'use strict';

// bestiary.js — THE BESTIARY, AND WHAT A FIGHT TAKES FROM IT.
//
// THE GOAL OF THIS FEATURE: the DM keeps every monster's stat block in one window over the map,
// a table they search, filter and manage in bulk, fed from links or typed by hand, and a monster
// picked into the fight is a copy the fight can change freely. Nothing from the fight reaches the
// bestiary except through Save to Bestiary (fight-table.js criterion K).
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its
// letter.
//
//   A. The Bestiary button opens and closes the window and is lit while it is open.
//   B. New monster adds an entry and opens its page in the editor, name ready to type over; a
//      name typed there renames its row in the table.
//   C. The name search and a Type tick narrow the table and say how many of how many; Clear all
//      brings every monster back. Types in two languages fall under one name.
//   D. A row's click opens its page to read; Edit swaps in the editor and Done swaps it back.
//   E. Picked rows (tick, Ctrl+click) put up the selection bar; Duplicate, Ctrl+D, and Ctrl+C then
//      Ctrl+V each add copies under names that do not clash; Delete asks first, then removes them.
//   F. A name typed in the fight offers the entries it matches; a pick fills the row with the
//      entry's name, AC and max HP, a second pick is numbered, and a later edit to the entry leaves
//      those rows as they were.
//   G. Pasted links are read one at a time: a monster page becomes an entry marked NEW with its
//      page open and every action whole, even one the page draws late, and a line that is not a
//      link stays as a failed row with its reason.
//   H. A key pressed while the window is open never reaches the map.
//
// ⚠ G SERVES A PAGE WRITTEN HERE, for an invented monster, from this process. No live site is
// reached, so a site changing its markup cannot fail this file; the parser's unit tests carry the sites.
// ⚠ EXPORT IS NOT DRIVEN. It hands the file to the browser's save dialog, which is native.

const http = require('http');
const lib = require('../../lib');

// The actions arrive a moment after the header, as they do on ttg.club.
const PAGE = `<!DOCTYPE html><html><body><nav>Bestiary</nav><main><article>
  <h1>Tunnel Gnawer</h1><p>Small beast, unaligned</p>
  <p>Armor Class 13 (natural armor)</p><p>Hit Points 9 (2d6 + 2)</p><p>Speed 30 ft., burrow 10 ft.</p>
  <div id="late"></div></article></main>
  <script>setTimeout(() => { document.getElementById('late').innerHTML = '<h3>Actions</h3>'
    + '<p>Bite. Melee Weapon Attack: +3 to hit, reach 5 ft. Hit: 4 (1d6 + 1) piercing damage.</p>'; }, 700);</script>
  <footer>Comments</footer></body></html>`;

const OWN_HELPERS = `
globalThis.__bsNames = () => Object.values(cbState.blocks).map(b => b.name).sort();
globalThis.__bsRows = () => [...document.querySelectorAll('#bs-table tbody tr')].map(r => r.querySelector('td.nm').firstChild.textContent);
globalThis.__bsRow = (name) => [...document.querySelectorAll('#bs-table tbody tr')].find(r => r.querySelector('td.nm').firstChild.textContent === name);
globalThis.__bsClick = (el, mods) => el.dispatchEvent(new MouseEvent('click', Object.assign({ bubbles: true }, mods || {})));
globalThis.__bsKey = (code, mods) => document.getElementById('bs-panel').dispatchEvent(new KeyboardEvent('keydown', Object.assign({ code, key: code, bubbles: true, cancelable: true }, mods || {})));
globalThis.__bsAct = (a) => { const el = document.querySelector('#bs-panel [data-a="' + a + '"]'); if (!el) throw new Error('no "' + a + '" button on screen'); __bsClick(el); };
globalThis.__sbEdit = (p, v) => {
  const el = document.querySelector('#bs-page [data-p="' + p + '"]');
  el.focus(); el.textContent = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 0;
};
// A name typed into a new fight row, then the suggestion list answered with Enter.
globalThis.__cbPickTyped = (typed) => {
  document.querySelector('.cb-add[data-add="enemy"]').click();
  const inp = [...document.querySelectorAll('#cb-list .cb-row')].pop().querySelector('[data-f=name]');
  inp.focus(); inp.value = typed;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  const offered = [...document.querySelectorAll('#cb-suggest [data-i]')].map(d => d.firstChild.textContent);
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  return offered;
};
0`;

module.exports = async function bestiaryFeature(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: 1200, h: 800 });
  await dm.evaluate(OWN_HELPERS);

  // ── A. The Bestiary button ────────────────────────────────────────────────
  // RED ON: the active toggle gated off in bestiarySetOpen (bestiary.js) — 2026-09-25
  await dm.evaluate('document.getElementById("btn-bestiary").click(); 0');
  const opened = await dm.evaluate(`({ open: bsIsOpen(), lit: document.getElementById('btn-bestiary').classList.contains('active'),
    label: document.getElementById('btn-bestiary').textContent })`);
  rig.check(opened.open && opened.lit, 'the Bestiary button did not open the window, lit: ' + JSON.stringify(opened));
  rig.check(opened.label === 'Bestiary', 'the button does not say Bestiary: ' + opened.label);
  await dm.evaluate('__bsAct("close"); 0');
  rig.check(await dm.evaluate('!bsIsOpen() && !document.getElementById("btn-bestiary").classList.contains("active")'),
            'the close button left the bestiary open or lit');
  await dm.evaluate('document.getElementById("btn-bestiary").click(); 0');

  // ── B. New monster ────────────────────────────────────────────────────────
  // RED ON: _bsNew opening the page to read (bestiary.js) — 2026-09-25
  await dm.evaluate('__bsAct("new"); 0');
  const blank = await dm.evaluate(`({ names: __bsNames(), editing: !!document.querySelector('#bs-page .cb-sb'),
    focused: document.activeElement && document.activeElement.dataset.p })`);
  rig.check(JSON.stringify(blank.names) === '["New monster"]' && blank.editing && blank.focused === 'name',
            'New monster did not add one entry and open it in the editor, name focused: ' + JSON.stringify(blank));
  await dm.evaluate('__sbEdit("name", "Goblin"); __sbEdit("meta", "Small humanoid (goblinoid), neutral evil"); __sbEdit("ac", "15 (leather armor, shield)"); __sbEdit("hp", "7 (2d6)"); __sbEdit("abil.1", "14"); 0');
  rig.check(JSON.stringify(await dm.evaluate('__bsRows()')) === '["Goblin"]', 'a name typed on the page did not rename its row');
  await dm.evaluate(`(() => { const b = combatAddEntry(cbState.blocks, Object.assign(combatBlankBlock('', 'Лич'), { meta: 'Средняя нежить, нейтральная злая', cr: '21', source: 'dnd.su' }));
    combatAddEntry(cbState.blocks, Object.assign(combatBlankBlock('', 'Wolf'), { meta: 'Medium beast, unaligned', cr: '1/4' })); bestiaryRender(); return b.id; })()`);

  // ── C. Search and filters ─────────────────────────────────────────────────
  // RED ON: the name search gated off in bsMatches (bestiaryPlan.js) — 2026-09-25
  const searched = await dm.evaluate(`(() => { const s = document.getElementById('bs-search'); s.value = 'gob'; s.dispatchEvent(new Event('input', { bubbles: true }));
    return { rows: __bsRows(), shown: document.querySelector('.bs-shown').textContent }; })()`);
  await dm.evaluate(`(() => { const s = document.getElementById('bs-search'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); return 0; })()`);
  const typed = await dm.evaluate(`(() => {
    __bsClick(document.querySelector('[data-filter="type"]'));
    const opts = [...document.querySelectorAll('.bs-pop .o')].map(o => o.dataset.v);
    __bsClick(document.querySelector('.bs-pop .o[data-v="Undead"]'));
    return { opts, rows: __bsRows() };
  })()`);
  await dm.evaluate('document.getElementById("bs-panel").dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); __bsAct("clear"); 0');
  const cleared = await dm.evaluate('__bsRows().length');
  rig.check(JSON.stringify(searched.rows) === '["Goblin"]' && searched.shown === '1 of 3',
            'the name search did not narrow the table to the Goblin: ' + JSON.stringify(searched));
  rig.check(JSON.stringify(typed.opts) === '["Beast","Humanoid","Undead"]' && JSON.stringify(typed.rows) === '["Лич"]',
            'the Type filter did not offer one name per type, or did not narrow to the undead: ' + JSON.stringify(typed));
  rig.check(cleared === 3, 'Clear all did not bring every monster back: ' + cleared);

  // ── D. The page ───────────────────────────────────────────────────────────
  // RED ON: bpHtml forced into the editor in _bsPageHtml (bestiary.js) — 2026-09-25
  // A click on the open row closes its page, and B left the Goblin open in the editor.
  await dm.evaluate('bs.open = null; bs.editing = false; _bsRenderPage(); __bsClick(__bsRow("Goblin")); 0');
  const read = await dm.evaluate(`({ read: !!document.querySelector('#bs-page .bp-read'), editor: !!document.querySelector('#bs-page .cb-sb'),
    dex: (c => c && ['.k', '.m', '.sc'].map(s => c.querySelector(s).textContent.trim()).join(' '))(document.querySelectorAll('#bs-page .bp-ab-c')[1]) })`);
  await dm.evaluate('__bsAct("edit"); 0');
  const edit = await dm.evaluate('!!document.querySelector("#bs-page .cb-sb [contenteditable]")');
  await dm.evaluate('__bsAct("edit"); 0');
  rig.check(read.read && !read.editor && read.dex === 'DEX +2 14', 'a row click did not open the Goblin page to read: ' + JSON.stringify(read));
  rig.check(edit && await dm.evaluate('!!document.querySelector("#bs-page .bp-read")'), 'Edit did not swap in the editor, or Done did not swap it back');

  // ── E. Picking, copies, delete ────────────────────────────────────────────
  // RED ON: the Ctrl+D branch gated off in _bsKey (bestiary.js) — 2026-09-25
  await dm.evaluate('__bsClick(__bsRow("Goblin").querySelector("[data-tick]")); 0');
  const bar = await dm.evaluate('document.getElementById("bs-panel").classList.contains("selecting")');
  await dm.evaluate('__bsAct("dup"); 0');
  const afterDup = await dm.evaluate('__bsNames()');
  await dm.evaluate('__bsClick(__bsRow("Goblin")); __bsKey("KeyD", { ctrlKey: true }); 0');
  const afterCtrlD = await dm.evaluate('__bsNames()');
  await dm.evaluate('__bsClick(__bsRow("Goblin")); __bsKey("KeyC", { ctrlKey: true }); __bsKey("KeyV", { ctrlKey: true }); 0');
  const afterPaste = await dm.evaluate('__bsNames()');
  rig.check(bar, 'a ticked row did not put up the selection bar');
  rig.check(afterDup.includes('Goblin (1)'), 'Duplicate did not add "Goblin (1)": ' + JSON.stringify(afterDup));
  rig.check(afterCtrlD.includes('Goblin (2)'), 'Ctrl+D did not add "Goblin (2)": ' + JSON.stringify(afterCtrlD));
  rig.check(afterPaste.includes('Goblin (3)'), 'Ctrl+C then Ctrl+V did not add "Goblin (3)": ' + JSON.stringify(afterPaste));
  // The delete picks whichever copies exist, so a missing copy fails its own check above and not this one.
  await dm.evaluate(`(() => { for (const n of ['Goblin (1)', 'Goblin (2)', 'Goblin (3)']) if (__bsRow(n)) __bsClick(__bsRow(n), { ctrlKey: true }); __bsAct('del'); return 0; })()`);
  const asked = await dm.evaluate('({ up: getComputedStyle(document.getElementById("cd-anchor")).display !== "none", n: __bsNames().length })');
  await dm.evaluate('document.getElementById("cd-ok").click(); 0');
  const afterDel = await dm.evaluate('__bsNames()');
  rig.check(asked.up && asked.n === 6, 'Delete removed entries without asking first: ' + JSON.stringify(asked));
  rig.check(JSON.stringify(afterDel) === '["Goblin","Wolf","Лич"]', 'Delete did not remove the three picked copies: ' + JSON.stringify(afterDel));

  // ── F. A pick from the fight's Name field ─────────────────────────────────
  // RED ON: combatRowFromEntry handing the row the entry itself (combatPlan.js) — 2026-09-25
  await dm.evaluate('bestiarySetOpen(false); document.getElementById("btn-combat").click(); 0');
  const offered = await dm.evaluate('__cbPickTyped("gob")');
  await dm.evaluate('__cbPickTyped("Gob"); 0');
  const picked = await dm.evaluate('cbState.rows.map(r => ({ name: r.name, ac: r.ac, hp: r.hp, max: r.sb.hp, dex: r.sb.abil[1] }))');
  await dm.evaluate(`(() => { const g = Object.values(cbState.blocks).find(b => b.name === 'Goblin'); g.ac = '17'; g.abil[1] = '18'; return 0; })()`);
  const apart = await dm.evaluate('cbState.rows.map(r => r.ac + "|" + r.sb.ac + "|" + r.sb.abil[1])');
  rig.check(JSON.stringify(offered) === '["Goblin"]', 'typing "gob" did not offer the Goblin entry: ' + JSON.stringify(offered));
  rig.check(picked.length === 2 && picked[0].name === 'Goblin' && picked[1].name === 'Goblin 2' &&
            picked.every(r => r.ac === '15' && r.max === '7 (2d6)' && r.hp === '' && r.dex === '14'),
            'two picks did not make "Goblin" and "Goblin 2" at full HP with the entry’s numbers: ' + JSON.stringify(picked));
  rig.check(apart.every(r => r === '15|15 (leather armor, shield)|14'), 'an edit to the entry reached the rows in the fight: ' + JSON.stringify(apart));
  await dm.evaluate('cbSetOpen(false); document.getElementById("btn-bestiary").click(); 0');

  // ── G. Pasted links ───────────────────────────────────────────────────────
  // RED ON: bs.fresh.add gated off in _bsImported (bestiary.js) — 2026-09-25
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(PAGE); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const url = 'http://127.0.0.1:' + server.address().port + '/bestiary/tunnel-gnawer/';
    await dm.evaluate(`(() => {
      __bsAct('import');
      document.querySelector('.bs-menu [data-m="links"]').click();
      document.getElementById('bs-links').value = ${JSON.stringify(url)} + '\\nnot a link';
      __bsAct('go');
      return 0;
    })()`);
    const done = await lib.poll(() => dm.evaluate(`cbImportQueue.some(q => q.state !== 'failed') ? null
      : { entry: (Object.values(cbState.blocks).find(b => b.source === '127.0.0.1') || {}).name || null,
          bite: (((Object.values(cbState.blocks).find(b => b.source === '127.0.0.1') || { secs: {} }).secs.Actions || [])[0] || {}).t || '',
          page: (document.querySelector('.bs-page-head h2') || {}).textContent || '',
          fresh: [...document.querySelectorAll('.bs-new')].map(e => e.parentElement.firstChild.textContent),
          failed: [...document.querySelectorAll('.bs-q.err')].map(q => q.textContent.replace(/\\s+/g, ' ').trim()) }`), 45000);
    rig.note('import: ' + JSON.stringify(done));
    rig.check(!!done && done.entry === 'Tunnel Gnawer' && done.page.startsWith('Tunnel Gnawer') && done.fresh.includes('Tunnel Gnawer'),
              'a pasted monster link did not become an entry marked NEW with its page open: ' + JSON.stringify(done));
    // RED ON: the held-still wait gated off in readPage (statBlockFetch.js) — 2026-09-25
    rig.check(!!done && done.bite.includes('Hit: 4 (1d6 + 1)'),
              'the import took the page before its actions were drawn, so the attack has no damage: ' + JSON.stringify(done && done.bite));
    rig.check(!!done && done.failed.length === 1 && /not a link.*not a web link/.test(done.failed[0]),
              'a line that is not a link did not stay as one failed row with its reason: ' + JSON.stringify(done && done.failed));
  } finally {
    server.close();
  }

  // ── H. Keys stay in the window ────────────────────────────────────────────
  // RED ON: stopPropagation gated off in the bestiary capture keydown (bestiary.js) — 2026-09-25
  // The control second: with the window shut the same R does reach the map, so the check can fail.
  const keys = await dm.evaluate(`(() => {
    const r = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', key: 'r', bubbles: true, cancelable: true }));
    document.activeElement && document.activeElement.blur();
    setShape('select'); bestiarySetOpen(true); document.activeElement && document.activeElement.blur();
    r(); const open = shape;
    bestiarySetOpen(false); r(); const shut = shape;
    return { open, shut };
  })()`);
  rig.check(keys.shut === 'rect', 'R with the bestiary shut did not pick the rectangle, so this check cannot tell anything: ' + keys.shut);
  rig.check(keys.open === 'select', 'an R pressed with the bestiary open reached the map and picked "' + keys.open + '"');
};
