'use strict';

// Every pointer comes from the pack (src/cursor/cursorPack.js). A system keyword left in a rule shows the plain
// OS cursor wherever it applies.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function jsFiles(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) { if (rel !== 'src/cursor') jsFiles(rel, out); } else if (e.name.endsWith('.js') && rel !== 'src/ui/changelogData.js') out.push(rel);
  }
  return out;
}

// The values an assignment can take: each branch of a top-level `?:`, never its condition.
function branches(rhs) {
  let depth = 0, q = -1, c = -1;
  for (let i = 0; i < rhs.length; i++) {
    const ch = rhs[i];
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === "'" || ch === '"' || ch === '`') i = rhs.indexOf(ch, i + 1);
    else if (depth === 0 && ch === '?' && q < 0) q = i;
    else if (depth === 0 && ch === ':' && q >= 0 && c < 0) c = i;
  }
  if (q < 0 || c < 0) return [rhs.trim()];
  return [rhs.slice(q + 1, c).trim()].concat(branches(rhs.slice(c + 1)));
}
const VALUE = /^(?:cursorFor\(.*\)|''|'none'|""|"none")$/;

describe('cursors come from the pack', () => {
  it('sets every CSS cursor to a var(--cur-*) or none', () => {
    const sheets = fs.readdirSync(path.join(ROOT, 'src/css')).filter((f) => f.endsWith('.css')).map((f) => 'src/css/' + f);
    const faults = [];
    for (const rel of sheets.concat(['splash.html', 'stage.html', 'index.html'])) {
      const text = rel.endsWith('.html') ? (read(rel).match(/<style>[\s\S]*?<\/style>/g) || []).join('\n') : read(rel);
      for (const m of text.matchAll(/(?<![\w-])cursor\s*:\s*([^;}]+)/g)) {
        const v = m[1].replace(/!important/, '').trim();
        if (!/^var\(--cur-[a-z]+\)$/.test(v) && v !== 'none') faults.push(rel + ': cursor: ' + v);
      }
    }
    assert.deepEqual(faults, [], 'write cursor: var(--cur-<kind>) with a kind from cursorPack.js, or none');
  });

  it('sets every .style.cursor through cursorFor, or to \'\' or \'none\'', () => {
    const faults = [];
    for (const rel of jsFiles('src')) {
      read(rel).split('\n').forEach((line, i) => {
        const m = line.match(/\.style\.cursor\s*=(?!=)\s*(.*?);?\s*(?:\/\/.*)?$/);
        if (!m) return;
        if (!branches(m[1]).every((v) => VALUE.test(v))) faults.push(rel + ':' + (i + 1) + ': ' + line.trim());
      });
    }
    assert.deepEqual(faults, [], 'write el.style.cursor = cursorFor(kind), with a kind from cursorPack.js, or \'\' or \'none\'');
  });
});
