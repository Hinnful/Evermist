'use strict';

// The repo's house rules, checked the way CI sees them. Every limit is fixed. A file already past
// one sits in houseRules.allow.json and may shrink, never grow; once it is back under the limit
// its entry must go.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const lib = require('../.claude/hooks/guard-lib.js');
const { OWNERS } = require('../.claude/hooks/guard-skill-hint.js');
const ALLOW = require('./houseRules.allow.json');

const ROOT = lib.ROOT;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const MAX_COMMENT_PCT = 20;
const MAX_COMMENT_BLOCK = 8;
const MAX_FILE_LINES = 600;
const MAX_BACKLOG_BYTES = 30000;
const MAX_LEDGER_ENTRY_LINES = 14;
const LEDGER_TAGS = ['SETTLED', 'REJECTED', 'REVERTED', 'PARKED', "WON'T FIX", 'SHIPPED', 'REOPENED'];

// History belongs in git and the decisions ledger. These markers have no present-tense use.
const HISTORY = /\b\d{4}-\d{2}-\d{2}\b|\ban earlier version\b|\b(?:was|were) (?:tried|rejected|reverted)\b|\b(?:in|since|until|before) v?\d+\.\d+\.\d+\b/i;

const shipped = lib.shippedJs().filter((rel) => rel !== 'src/ui/changelogData.js');

function measure() {
  const out = [];
  for (const rel of shipped) {
    const text = read(rel);
    const lines = text.split('\n');
    const kinds = lib.classifyLines(text);
    let run = 0;
    let longest = 0;
    const history = [];
    kinds.forEach((k, i) => {
      if (k === 'comment') {
        run++;
        longest = Math.max(longest, run);
        if (HISTORY.test(lines[i])) history.push(i + 1);
      } else {
        run = 0;
      }
    });
    out.push({ rel, lines: lines.length, longest, history });
  }
  return out;
}

// A figure per file, held against a fixed limit and the frozen exceptions.
function overLimit(figures, limit, allowed) {
  const faults = [];
  for (const [rel, n] of figures) {
    const cap = allowed[rel];
    if (n > limit && cap === undefined) faults.push(rel + ' is ' + n + ', over the limit of ' + limit);
    else if (cap !== undefined && n > cap) faults.push(rel + ' grew to ' + n + ' past its allowance of ' + cap);
    else if (cap !== undefined && n <= limit) faults.push(rel + ' is back under the limit: delete its entry in test/houseRules.allow.json');
  }
  for (const rel of Object.keys(allowed)) {
    if (!figures.some(([r]) => r === rel)) faults.push(rel + ' no longer exists: delete its entry in test/houseRules.allow.json');
  }
  return faults;
}

describe('house rules: shipped code', () => {
  const files = measure();

  it('keeps comments to at most ' + MAX_COMMENT_PCT + '% of shipped JavaScript', () => {
    const pct = lib.commentStats(shipped).pct;
    assert.ok(pct <= MAX_COMMENT_PCT,
      'comments are ' + pct.toFixed(1) + '% of shipped JavaScript. Keep the rule, one clause of why, ' +
      'and any warning about a real trap; cut restatements of the code.');
  });

  it('keeps change history out of comments', () => {
    const faults = overLimit(files.map((f) => [f.rel, f.history.length]), 0, ALLOW.historyComments);
    assert.deepEqual(faults, [], 'a comment tells the story of a change; that belongs in git or docs/DECISIONS.md');
  });

  it('keeps comment blocks to ' + MAX_COMMENT_BLOCK + ' lines', () => {
    const faults = overLimit(files.map((f) => [f.rel, f.longest]), MAX_COMMENT_BLOCK, ALLOW.commentBlocks);
    assert.deepEqual(faults, [], 'a long explanation belongs in docs/ARCHITECTURE.md, with a pointer here');
  });

  it('keeps every file to ' + MAX_FILE_LINES + ' lines', () => {
    const faults = overLimit(files.map((f) => [f.rel, f.lines]), MAX_FILE_LINES, ALLOW.fileLines);
    assert.deepEqual(faults, [], 'a file this long holds more than one concern; split one out into its own module');
  });
});

describe('house rules: docs and maps', () => {
  it('lists every module in both module maps, and nothing that is gone', () => {
    const namesIn = (text) => new Set([...text.matchAll(/`([A-Za-z0-9_./-]+\.js)`/g)].map((m) => m[1].split('/').pop().toLowerCase()));
    const modules = new Set();
    const take = (dir) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        if (e.isFile() && e.name.endsWith('.js')) modules.add(e.name.toLowerCase());
        if (e.isDirectory() && dir === 'src' && e.name !== 'css') take('src/' + e.name);
      }
    };
    take('src');
    take('electron');
    const everyJs = new Set();
    const walkAll = (dir) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.git')) continue;
        if (e.isDirectory()) walkAll(dir + '/' + e.name);
        else if (e.name.endsWith('.js')) everyJs.add(e.name.toLowerCase());
      }
    };
    walkAll('.');
    const faults = [];
    for (const doc of ['docs/architecture/module-map.md', '.claude/rules/modules.md']) {
      const named = namesIn(read(doc));
      for (const m of modules) if (!named.has(m)) faults.push(doc + ' has no row for ' + m);
      for (const n of named) if (!everyJs.has(n)) faults.push(doc + ' names ' + n + ', which no longer exists');
    }
    assert.deepEqual(faults, []);
  });

  it('maps every file a skill claims to that skill, and only files that exist', () => {
    const faults = [];
    const present = new Set();
    for (const dir of ['', 'src', 'electron', ...fs.readdirSync(path.join(ROOT, 'src')).map((d) => 'src/' + d)]) {
      try {
        for (const f of fs.readdirSync(path.join(ROOT, dir))) present.add(f.toLowerCase());
      } catch { /* not a folder */ }
    }
    for (const [base, slug] of Object.entries(OWNERS)) {
      if (!present.has(base)) faults.push('guard-skill-hint.js maps ' + base + ', which no longer exists');
      if (!fs.existsSync(path.join(ROOT, '.claude/skills', slug, 'SKILL.md'))) faults.push(base + ' maps to a missing skill ' + slug);
    }
    for (const slug of fs.readdirSync(path.join(ROOT, '.claude/skills'))) {
      const head = read('.claude/skills/' + slug + '/SKILL.md').split('\n').find((l) => l.startsWith('description:')) || '';
      const claimed = head.split(/Also load/)[0].match(/(?:src|electron)\/[\w/.-]+\.(?:js|css)/g) || [];
      for (const rel of claimed) {
        const base = rel.split('/').pop().toLowerCase();
        if (OWNERS[base] !== slug) faults.push(slug + ' claims ' + rel + ', but guard-skill-hint.js does not map it there');
      }
    }
    assert.deepEqual(faults, []);
  });

  it('keeps the backlog under ' + MAX_BACKLOG_BYTES / 1000 + ' KB', () => {
    const bytes = Buffer.byteLength(read('docs/BACKLOG.md'));
    assert.ok(bytes <= MAX_BACKLOG_BYTES,
      'docs/BACKLOG.md is ' + bytes + ' bytes. It holds open items only; closed work goes to the decisions ledger or nowhere.');
  });

  it('keeps every ledger entry tagged and short', () => {
    const ledgers = ['docs/DECISIONS.md', 'docs/PRODUCT.md',
      ...fs.readdirSync(path.join(ROOT, 'docs/decisions')).map((f) => 'docs/decisions/' + f)];
    const faults = [];
    for (const rel of ledgers) {
      const { entries } = lib.analyze(read(rel));
      for (const e of lib.findUntagged(entries, LEDGER_TAGS)) faults.push(rel + ':' + e.line + ' has no status tag');
      for (const e of entries) {
        if (e.lines > MAX_LEDGER_ENTRY_LINES && !ALLOW.longLedgerEntries.includes(e.name)) {
          faults.push(rel + ':' + e.line + ' runs ' + e.lines + ' lines, over ' + MAX_LEDGER_ENTRY_LINES);
        }
      }
    }
    assert.deepEqual(faults, []);
  });

  it('names nobody in the public docs', () => {
    const prose = ['CLAUDE.md', 'README.md', 'docs/ARCHITECTURE.md', 'docs/PROCESS.md', 'docs/BACKLOG.md',
      ...fs.readdirSync(path.join(ROOT, 'docs/architecture')).map((f) => 'docs/architecture/' + f)];
    // A ledger's preamble quotes the banned phrasing to rule it out, so only its entries are read.
    const ledgers = ['docs/DECISIONS.md', 'docs/PRODUCT.md',
      ...fs.readdirSync(path.join(ROOT, 'docs/decisions')).map((f) => 'docs/decisions/' + f)];
    const faults = [];
    for (const rel of prose) {
      for (const h of lib.findPersonRefsInText(read(rel))) faults.push(rel + ':' + h.line + ' ' + h.text);
    }
    for (const rel of ledgers) {
      for (const h of lib.findPersonRefs(lib.analyze(read(rel)).entries)) faults.push(rel + ':' + h.line + ' ' + h.text);
    }
    for (const h of lib.findNarrative(read('docs/PROCESS.md'), [])) faults.push('docs/PROCESS.md:' + h.line + ' tells a story: ' + h.text);
    assert.deepEqual(faults, [], 'these files are public. Call the person "the DM" and state the step, not who said it');
  });
});
