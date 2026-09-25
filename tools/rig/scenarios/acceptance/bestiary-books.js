'use strict';

// bestiary-books.js — EVERY STAT BLOCK IN A BOOK OR A MODULE, INTO THE BESTIARY.
//
// THE GOAL OF THIS FEATURE: the DM fills the bestiary from a PDF book in one go, and a module
// import brings its monsters in beside its rooms. Each monster is sourced to its file, a second
// import of that file adds nothing whichever import ran first, and a monster that does not read
// clean is left out and named, never imported half-read.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its
// letter.
//
//   A. The Import menu offers From a PDF book, ready to pick.
//   B. A book read from its path adds every stat block in it under the book's name without its
//      extension, marked NEW, and leaves out and names the one it could only partly read.
//   C. The same book again adds nothing.
//   D. A PDF with no stat blocks adds nothing.
//   E. A module import brings in its rooms and its monsters, and says how many monsters.
//   F. A module imported first, then the same file as a book, adds nothing the second time.
//   G. A book that does not fit in storage adds nothing and says so; the entries already there stay.
//   H. Import anyway, in the message that names what was left out, adds those monsters too.
//
// ⚠ THE BOOK PICKER IS NOT DRIVEN. It reads the file's path with getPathForFile, which answers null
// for a File built in the page, so B-D call the path extraction the picker calls, on a fixture
// written to disk here. The module import sends bytes, so E drives the real Choose file handler.
// ⚠ THE FIXTURES ARE ASCII, ENGLISH. The PDF builder counts bytes by String.length.

const fs = require('fs');
const path = require('path');
const lib = require('../../lib');

function pdfBytes(lines) {
  let content = 'BT /F1 11 Tf 72 740 Td 13 TL\n';
  for (const l of lines) content += '(' + l.replace(/[()\\]/g, m => '\\' + m) + ') Tj T*\n';
  content += 'ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(body.length); body += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = body.length;
  body += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
  for (const off of offsets) body += String(off).padStart(10, '0') + ' 00000 n \n';
  body += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  return Buffer.from(body, 'latin1');
}

const MONSTERS = [
  'Tunnel Gnawer', 'Small Beast, Unaligned', 'AC 13', 'HP 9 (2d6 + 2)', 'Speed 30 ft., Burrow 10 ft.',
  'STR 8 (-1) DEX 14 (+2) CON 12 (+1) INT 2 (-4) WIS 10 (+0) CHA 4 (-3)', 'CR 1/4 (XP 50; PB +2)', 'Actions',
  'Bite. Melee Attack Roll: +4, reach 5 ft. Hit: 4 (1d4 + 2) Piercing damage.',
  'Cave Moss', 'Medium Plant, Unaligned', 'AC 5', 'HP 13 (3d8)',
  'Reactions', 'Shriek. The moss shrieks when light touches it.',
  'Gnawer Lairs',
  'Gnawers dig their warrens under old roads and leave the spoil in heaps by the entrance.',
];
const ROOMS = ['1. Gatehouse', 'A heavy door blocks the way in.', '2. Barracks', 'Bunks line the walls.',
  '3. Cellar', 'Casks sit in the dark.', 'Appendix', ...MONSTERS];

module.exports = async function bestiaryBooks(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: 1200, h: 800 });
  const book = path.join(rig.outDir, 'Book of Gnawers.pdf');
  const plain = path.join(rig.outDir, 'Plain Notes.pdf');
  fs.writeFileSync(book, pdfBytes(MONSTERS));
  // Prose that wraps onto an AC is not a stat block; a stat block has AC and HP together.
  fs.writeFileSync(plain, pdfBytes(['Old Chest', 'The chest is iron, with', 'AC 15, 25 hit points and a rusted lock.', 'Nothing here fights back.']));
  const readBook = (p, name) => dm.evaluate(`(async () => {
    const res = await window.electronAPI.extractPdfTextPath(${JSON.stringify(p)});
    if (!res.ok) return { error: res.error };
    const done = cbImportBookText(res.blockText, ${JSON.stringify(name)});
    return { found: done.found, skipped: done.skipped, failed: done.failed, unread: done.unread,
      added: done.added.map(e => ({ name: e.name, source: e.source, fresh: bs.fresh.has(e.id) })),
      problems: cbImportProblems(done) };
  })()`, 60000);

  // ── A. The Import menu offers the book ────────────────────────────────────
  // RED ON: the book item forced off in _bsImportMenu (bestiary.js) — 2026-09-25
  await dm.evaluate('document.getElementById("btn-bestiary").click(); document.querySelector(\'#bs-panel [data-a="import"]\').click(); 0');
  const item = await dm.evaluate(`(() => { const it = document.querySelector('.bs-menu [data-m="book"]');
    return it ? { off: it.classList.contains('off'), text: it.firstChild.textContent } : null; })()`);
  rig.check(item && !item.off, 'the Import menu has no From a PDF book item ready to pick: ' + JSON.stringify(item));
  await dm.evaluate('document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); 0');

  // ── B. A book adds every stat block ───────────────────────────────────────
  // RED ON: the source kept its file extension in cbImportBookText (statBlockImport.js) — 2026-09-25
  const first = await readBook(book, 'Book of Gnawers.pdf');
  rig.note('the book import: ' + JSON.stringify(first));
  rig.check(!first.error, 'the path extraction failed: ' + first.error);
  rig.check(first.found === 2 && first.added.length === 1,
    'the book should have found 2 stat blocks and added the clean one: ' + JSON.stringify(first));
  rig.check((first.added || []).every(a => a.source === 'Book of Gnawers' && a.fresh),
    'the monsters are not sourced to the book without its extension, or not marked NEW: ' + JSON.stringify(first.added));
  const gnawer = await dm.evaluate(`(() => { const b = Object.values(cbState.blocks).find(x => x.name === 'Tunnel Gnawer');
    return b && { ac: b.ac, hp: b.hp, abil: b.abil, act: (b.secs.Actions || []).map(e => e.n + '|' + e.t) }; })()`);
  rig.check(gnawer && gnawer.ac === '13' && gnawer.abil.join(' ') === '8 14 12 2 10 4' && gnawer.act.length === 1 &&
    /Piercing damage\.$/.test(gnawer.act[0]), 'the Tunnel Gnawer was not read whole: ' + JSON.stringify(gnawer));
  rig.check(!/Gnawers dig/.test(JSON.stringify(gnawer)), 'the lore after the last block landed in its action');
  rig.check(JSON.stringify(first.unread) === '["Cave Moss"]' && /Cave Moss/.test(first.problems) &&
    !(first.added || []).some(a => a.name === 'Cave Moss'),
    'the partly read Cave Moss was imported, or not named as left out: ' + JSON.stringify(first));

  // ── C. The same book again adds nothing ───────────────────────────────────
  // RED ON: combatNewBlocks bypassed in cbAddBlocks (statBlockImport.js) — 2026-09-25
  const again = await readBook(book, 'Book of Gnawers.pdf');
  rig.check(again.added.length === 0 && again.skipped === 1, 'a second import of the book added monsters: ' + JSON.stringify(again));

  // ── D. A PDF with no stat blocks adds nothing ─────────────────────────────
  // RED ON: the AC-and-HP pairing gated off in _bkAnchor (statBlockBook.js) — 2026-09-25
  const none = await readBook(plain, 'Plain Notes.pdf');
  rig.check(none.found === 0 && none.added.length === 0, 'a PDF with no stat blocks added something: ' + JSON.stringify(none));

  // ── E. A module brings rooms and monsters ─────────────────────────────────
  // RED ON: the module's text withheld from cbImportBookText in _mtImport (moduleTextPanel.js) — 2026-09-25
  const before = await dm.evaluate('Object.keys(cbState.blocks).length');
  await dm.evaluate('openModuleTextModal(); 0');
  await dm.evaluate(`(() => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(pdfBytes(ROOMS).toString('base64'))}), c => c.charCodeAt(0));
    const inp = document.getElementById('mt-file-input');
    inp.files = (() => { const dt = new DataTransfer(); dt.items.add(new File([bytes], 'Keep of Gnawers.pdf', { type: 'application/pdf' })); return dt.files; })();
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return 0;
  })()`);
  await lib.settle(dm, 'mtEntries && mtEntries.length > 0', 60000);
  const mod = await dm.evaluate(`({ rooms: mtEntries.map(e => e.name), status: document.getElementById('mt-status').textContent,
    monsters: Object.values(cbState.blocks).filter(b => b.source === 'Keep of Gnawers').map(b => b.name).sort() })`);
  rig.note('the module import: ' + JSON.stringify(mod));
  rig.check(mod.rooms.length === 3, 'the module did not bring its 3 rooms: ' + JSON.stringify(mod.rooms));
  rig.check(JSON.stringify(mod.monsters) === '["Tunnel Gnawer"]',
    'the module did not bring its monsters under its own name: ' + JSON.stringify(mod.monsters));
  rig.check(/1 monster added to the bestiary/.test(mod.status), 'the panel did not say how many monsters came in: ' + mod.status);
  // The module's Cave Moss is partly read, so the import leaves it out and names it.
  await lib.settle(dm, 'document.getElementById("cd-anchor") && getComputedStyle(document.getElementById("cd-anchor")).display !== "none"', 5000);
  const told = await dm.evaluate('(document.getElementById("cd-msg") || {}).textContent || ""');
  rig.check(/Cave Moss/.test(told), 'the module import did not name the monster it left out: ' + JSON.stringify(told));
  // Leave out: the message's own way of keeping the import clean.
  await dm.evaluate('document.getElementById("cd-cancel").click(); 0');

  // ── F. Module first, then the same file as a book ─────────────────────────
  // RED ON: the module import given a different source name in _mtImport (moduleTextPanel.js) — 2026-09-25
  const keep = path.join(rig.outDir, 'Keep of Gnawers.pdf');
  fs.writeFileSync(keep, pdfBytes(ROOMS));
  const after = await readBook(keep, 'Keep of Gnawers.pdf');
  rig.check(after.added.length === 0, 'the book import doubled monsters the module import already added: ' + JSON.stringify(after));
  rig.check(await dm.evaluate('Object.keys(cbState.blocks).length') === before + 1, 'the bestiary count moved after F');

  // ── G. A book that does not fit adds nothing ──────────────────────────────
  // RED ON: the failed-save rollback gated off in cbAddBlocks (statBlockImport.js) — 2026-09-25
  const filled = await dm.evaluate(`(() => {
    // Down to the last few bytes, or the small entry still fits in what a coarse fill leaves.
    let n = 0;
    for (let size = 1 << 20; size >= 16; size >>= 2) {
      const chunk = 'x'.repeat(size);
      try { for (;; n++) localStorage.setItem('__rigFill' + n, chunk); } catch (_) {}
    }
    return n;
  })()`);
  const count = await dm.evaluate('Object.keys(cbState.blocks).length');
  const full = await readBook(book, 'Second Book of Gnawers.pdf');
  await dm.evaluate('Object.keys(localStorage).filter(k => k.startsWith("__rigFill")).forEach(k => localStorage.removeItem(k)); 0');
  rig.note('storage filled with ' + filled + ' chunks; the import: ' + JSON.stringify(full));
  rig.check(full.failed && full.added.length === 0 && /none were added/.test(full.problems),
    'a book that does not fit was not refused whole: ' + JSON.stringify(full));
  rig.check(await dm.evaluate('Object.keys(cbState.blocks).length') === count, 'a refused book left entries behind');

  // ── H. Import anyway ──────────────────────────────────────────────────────
  // RED ON: Import anyway handed no blocks in cbReportImport (statBlockImport.js) — 2026-09-25
  const moss = path.join(rig.outDir, 'Moss Book.pdf');
  fs.writeFileSync(moss, pdfBytes(MONSTERS));
  await dm.evaluate(`(async () => {
    const res = await window.electronAPI.extractPdfTextPath(${JSON.stringify(moss)});
    cbReportImport(cbImportBookText(res.blockText, 'Moss Book.pdf'));
    return 0;
  })()`, 60000);
  await lib.settle(dm, 'document.getElementById("cd-anchor") && getComputedStyle(document.getElementById("cd-anchor")).display !== "none"', 5000);
  const offer = await dm.evaluate('document.getElementById("cd-ok").textContent');
  await dm.evaluate('document.getElementById("cd-ok").click(); 0');
  const both = await dm.evaluate("Object.values(cbState.blocks).filter(b => b.source === 'Moss Book').map(b => b.name).sort()");
  rig.check(offer === 'Import anyway', 'the left-out message offers no Import anyway: ' + JSON.stringify(offer));
  rig.check(JSON.stringify(both) === '["Cave Moss","Tunnel Gnawer"]', 'Import anyway did not add the left-out monster: ' + JSON.stringify(both));

  rig.byEye('From a PDF book through the real picker, its Reading row, and its messages. The picker reads ' +
    'the path with getPathForFile, which a File built in the page cannot give');
};
