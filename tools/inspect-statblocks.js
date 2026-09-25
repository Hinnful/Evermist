// inspect-statblocks.js — every stat block the book import would find in a PDF or a text file, and
// what the parser made of each. Read-only, prints and exits. Not shipped: `tools/` is outside the
// build glob. Book text is never written anywhere.
//
//   node tools/inspect-statblocks.js <book.pdf|module.txt> [--list] [--show <name>] [--rooms]
//
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

(async () => {
  const buf = fs.readFileSync(file);
  let text = null, blockText = null;
  if (buf.slice(0, 5).toString() === '%PDF-') {
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
  const blocks = statBlocksInText(blockText || text);
  const bad = blocks.filter(statBlockUnclean);
  const oddName = blocks.filter(b => SB_SIZE.test(b.name) || b.name.length < 2);
  console.log(`${path.basename(file)}: ${blocks.length} stat blocks, ${bad.length} would be skipped, ${oddName.length} odd names, ${JSON.stringify(blocks).length} chars as JSON`);
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
