// inspect-statblocks.js — every stat block the book import would find in a PDF or a text file, and
// what the parser made of each. Read-only, prints and exits. Not shipped: `tools/` is outside the
// build glob. Book text is never written anywhere.
//
//   node tools/inspect-statblocks.js <book.pdf|module.txt|page.html|bestiary.json> [--list] [--show <name>] [--rooms] [--multi] [--record] [--spells]
//
// --spells reads every spellcasting entry into rows (spellcasting.js): the share read whole, then every entry with a
// spell list that stays a paragraph, and with --list every reading. A .json is an export or the stored `combat` key.
// --multi prints how the fight table reads every Multiattack, one line each, so two runs diff.
// --record prints every block's whole reading, pills included, one line each. Keep the output in
// the gitignored .claude/private/fixtures/readings/ and diff it after a change to any reader.
// A count can stay right while names go wrong, so names that look like a size line are flagged.

'use strict';

const fs = require('fs');
const path = require('path');
const src = p => path.join(__dirname, '..', 'src', p);
const { extractPdfText } = require(src('content/pdfExtract.js'));
const { statBlocksInText, statBlockUnclean } = require(src('combat/statBlockBook.js'));
const { SB_SIZE } = require(src('combat/statBlockParse.js'));

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--show');
const show = args.includes('--show') ? args[args.indexOf('--show') + 1] : null;
if (!file) { console.error('usage: node tools/inspect-statblocks.js <book.pdf|module.txt> [--list] [--show <name>] [--rooms]'); process.exit(1); }

// An entry counts as spellcasting when its name says so and its text holds a level or frequency label with a colon.
const SPELL_LIST = /(неограниченно|заговоры|at\s*w\s*i\s*l\s*l|cantrips|[\dlI]\s*[/fjJlI]\s*d\s*a\s*y|в день|\/день|ячейк[а-я]*\)|slots?\))[^:\n]{0,20}:/i;
function spells(blocks, list) {
  const { spellcastingRead } = require(src('combat/spellcasting.js'));
  const seen = [], miss = [];
  for (const b of blocks) for (const e of Object.values(b.secs || {}).flat()) {
    if (!/spell|заклин|колдов/i.test(e.n) || !SPELL_LIST.test(e.t)) continue;
    const r = spellcastingRead(e.n, e.t);
    (r ? seen : miss).push({ b, e, r });
  }
  const all = seen.length + miss.length;
  console.log(`${path.basename(file)}: ${all} spellcasting entries, ${seen.length} read (${all ? (100 * seen.length / all).toFixed(1) : '-'}%), ${miss.length} stay a paragraph`);
  for (const { b, e } of miss) console.log(`MISS ${b.name} | ${e.n} | ${e.t.replace(/\s+/g, ' ').slice(0, 160)}`);
  if (!list) return;
  const sp = s => s.name + (s.note ? ' ' + s.note : '');
  for (const { b, r } of seen) console.log(`${b.name} :: ${r.groups.map(g => `[${g.label} = ${g.kind} ${g.n}] ${g.spells.map(sp).join('; ')}`).join('  ')}${r.tail ? '  TAIL ' + r.tail.replace(/\s+/g, ' ') : ''}`);
}

(async () => {
  const buf = fs.readFileSync(file);
  let text = null, blockText = null, given = null;
  if (/\.json$/i.test(file)) {
    const d = JSON.parse(buf.toString('utf8'));
    given = Object.values(d.blocks || d.monsters || d);
  } else if (/\.html?$/i.test(file)) {
    given = [require(src('combat/statBlockParse.js')).statBlockFromPage(buf.toString('utf8'))];
  } else if (buf.slice(0, 5).toString() === '%PDF-') {
    const res = await extractPdfText(new Uint8Array(buf).buffer, path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build'));
    if (!res.ok) { console.error(res.error); process.exit(1); }
    ({ text, blockText } = res);
  } else {
    text = buf.toString('utf8');
  }
  if (args.includes('--rooms')) {
    const M = require(src('content/moduleText.js'));
    for (const e of M.parseModuleText(text).entries) console.log(`${e.key}\t${e.name}`);
    return;
  }
  const blocks = given || statBlocksInText(blockText || text);
  if (args.includes('--spells')) { spells(blocks, args.includes('--list')); return; }
  const bad = blocks.filter(statBlockUnclean);
  const oddName = blocks.filter(b => SB_SIZE.test(b.name) || b.name.length < 2);
  console.log(`${path.basename(file)}: ${blocks.length} stat blocks, ${bad.length} would be skipped, ${oddName.length} odd names, ${JSON.stringify(blocks).length} chars as JSON`);
  const { combatAttacks } = require(src('combat/attackLine.js'));
  const record = args.includes('--record');
  const one = a => `${a.ba ? 'Bonus ' : ''}${a.x ? a.x + '× ' : ''}${a.n}${!record ? '' : `${a.rc ? ` {${a.rc}}` : ''} ${a.hit} ${a.parts.map(p => `${p.dmg} ${p.type || '?'}`).join(' + ')}${a.grab ? ` grab ${a.grab}` : ''}`}`;
  const grp = a => a.alts ? `[${a.alts.map(alt => alt.map(one).join(' + ')).join(' OR ')}]`
    : `[${a.x ? a.x + '× ' : ''}${a.opts.map(one).join(a.or ? ' | ' : ' + ')}${a.swap ? ` ⇄ ${a.swap.k} ${a.swap.to.join(' or ')}` : ''}]`;
  const attacks = b => combatAttacks(b).map(a => a.fallback ? (record ? `DASHED ${a.n}` : 'DASHED') : a.group ? grp(a) : one(a)).join('  ');
  if (record) {
    const secs = b => Object.entries(b.secs).map(([k, v]) => `${k}:${v.map(e => e.n).join('/')}`).join(' ');
    for (const b of blocks) {
      const bad = statBlockUnclean(b);
      console.log(`${bad ? `! [${bad}] ` : ''}${b.name} | ${b.ac} | ${b.hp} | ${b.abil.join(' ')} | ${secs(b)}${bad ? '' : ` :: ${attacks(b)}`}`);
    }
    return;
  }
  if (args.includes('--multi')) {
    for (const b of blocks.filter(x => !statBlockUnclean(x))) {
      if (!(b.secs.Actions || []).some(e => /^(multiattack|мультиатака)/i.test(e.n))) continue;
      console.log(`${b.name} :: ${attacks(b)}`);
    }
    return;
  }
  if (show) {
    for (const b of blocks.filter(x => x.name.toLowerCase().includes(show.toLowerCase()))) console.log(JSON.stringify(b, null, 1));
    return;
  }
  const row = b => {
    const secs = Object.entries(b.secs).map(([k, v]) => `${k}:${v.length}`).join(' ');
    const lastSec = Object.values(b.secs).pop() || [];
    const last = lastSec.length ? lastSec[lastSec.length - 1].t.replace(/\s+/g, ' ') : '';
    return `${statBlockUnclean(b) ? "! [" + statBlockUnclean(b) + "]" : " "} ${b.name} | ${b.ac} | ${b.hp} | ${b.abil.join(' ')} (${b.abilRead}) | ${secs} | …${last.slice(-80)}`;
  };
  for (const b of oddName) console.log('ODD NAME ' + row(b));
  for (const b of (args.includes('--list') ? blocks : bad)) console.log(row(b));
})();
