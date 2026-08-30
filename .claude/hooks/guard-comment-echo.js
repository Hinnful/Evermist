#!/usr/bin/env node
'use strict';

/*
 * Echo guard - a ratchet on comment text REPEATED between files.
 *
 * WHY: comments here are almost all why-not-what, so the density guard beside this one cannot
 * see the real bloat: the same rule written in the file, in the module beside it, and in the
 * docs again. Three correct copies cost three times the lines and drift apart on the first
 * edit. Density stays flat while it happens, because deleting one copy and writing a new
 * warning leaves the ratio unchanged.
 *
 * WHAT: normalises every comment line of shipped JS and every line of the governing docs to
 * lowercase words, then counts runs of MIN_WORDS consecutive words appearing in two files.
 * The count ratchets DOWN, like the other five.
 *
 * MIN_WORDS IS 12 because shorter runs catch real coincidence - two files naming the same
 * function and its argument reach eight words without repeating an idea. A twelve-word match
 * is a sentence someone wrote twice.
 *
 * DOCS COUNT AS A FILE. A trap explained at the line where someone hits it, and again in
 * docs/DECISIONS.md, is the most common shape of this and the one worth catching.
 *
 * ⚠ IT RATCHETS A TOTAL, never a per-file figure, so a file may legitimately hold a phrase
 * that appears elsewhere as long as the codebase's count did not rise.
 *
 * ⚠ NEVER ADD permissionDecision, HERE OR IN ANY OTHER HOOK. The only accepted values are
 * allow/deny/ask; anything else parks the tool call unrun and ends the turn mid-edit.
 *
 * Fail-open by design - any internal error exits 0.
 */

const fs = require('fs');
const path = require('path');
const lib = require('./guard-lib.js');

const BASELINE = path.join(__dirname, 'comment-echo-baseline.json');
const MIN_WORDS = 12;

const NOTE =
  'Max number of ' + MIN_WORDS + '-word-or-longer text runs repeated between two files, ' +
  'across shipped JavaScript comments and the governing docs. Auto-ratchets DOWN. Raise ' +
  'only when a repeat is deliberate and unavoidable, and say why in the handover.';

/* The docs a comment is most likely to echo. A file not here simply is not compared. */
function docFiles() {
  const out = ['CLAUDE.md', 'src/css/CLAUDE.md'];
  const push = (dir) => {
    let items;
    try {
      items = fs.readdirSync(path.join(lib.ROOT, dir));
    } catch {
      return;
    }
    for (const f of items) if (f.endsWith('.md')) out.push(dir + '/' + f);
  };
  push('docs');
  push('docs/decisions');
  let skills;
  try {
    skills = fs.readdirSync(path.join(lib.ROOT, '.claude/skills'));
  } catch {
    skills = [];
  }
  for (const s of skills) out.push('.claude/skills/' + s + '/SKILL.md');
  return out.filter((f) => fs.existsSync(path.join(lib.ROOT, f)));
}

/* Punctuation, case and markdown emphasis all drop out: a copy edited for tone is still a copy. */
function normalize(s) {
  return s
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* One word stream per file, each word remembering the line it came from. */
function streamOf(rel) {
  let text;
  try {
    text = fs.readFileSync(path.join(lib.ROOT, rel), 'utf8');
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/);
  const isDoc = rel.endsWith('.md');
  const kinds = isDoc ? null : lib.classifyLines(text);
  const words = [];
  const lineOf = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isDoc && kinds[i] !== 'comment') continue;
    const t = normalize(lines[i]);
    if (!t) continue;
    for (const w of t.split(' ')) {
      words.push(w);
      lineOf.push(i + 1);
    }
  }
  return { rel, words, lineOf };
}

/*
 * Every run of >= MIN_WORDS words shared by two files, merged so one repeated sentence
 * reports once rather than as every shingle inside it.
 */
function findEchoes() {
  const files = [];
  for (const rel of lib.shippedJs().concat(docFiles())) {
    const s = streamOf(rel);
    if (s && s.words.length >= MIN_WORDS) files.push(s);
  }

  const index = new Map();
  for (const f of files) {
    for (let i = 0; i + MIN_WORDS <= f.words.length; i++) {
      const key = f.words.slice(i, i + MIN_WORDS).join(' ');
      let seen = index.get(key);
      if (!seen) index.set(key, (seen = []));
      // First hit per file only: a phrase twice inside one file is that file's business.
      if (!seen.some((o) => o.f === f)) seen.push({ f, i });
    }
  }

  const chains = new Map();
  for (const occ of index.values()) {
    if (occ.length < 2) continue;
    for (let a = 0; a < occ.length; a++) {
      for (let b = a + 1; b < occ.length; b++) {
        const [x, y] = [occ[a], occ[b]];
        const pair = x.f.rel + '|' + y.f.rel;
        let list = chains.get(pair);
        if (!list) chains.set(pair, (list = []));
        list.push({ ia: x.i, ib: y.i, x, y });
      }
    }
  }

  const echoes = [];
  for (const list of chains.values()) {
    list.sort((p, q) => p.ia - q.ia);
    let run = null;
    const flush = () => {
      if (run) echoes.push(run);
      run = null;
    };
    for (const it of list) {
      // Adjacent shingles overlap by one word, so a longer sentence arrives as a chain.
      if (run && it.ia === run.lastIa + 1 && it.ib === run.lastIb + 1) {
        run.lastIa = it.ia;
        run.lastIb = it.ib;
        run.words++;
        continue;
      }
      flush();
      run = {
        a: it.x.f.rel,
        b: it.y.f.rel,
        lineA: it.x.f.lineOf[it.ia],
        lineB: it.y.f.lineOf[it.ib],
        text: it.x.f.words.slice(it.ia, it.ia + MIN_WORDS).join(' '),
        words: MIN_WORDS,
        lastIa: it.ia,
        lastIb: it.ib,
      };
    }
    flush();
  }
  return echoes;
}

function isGuarded(rel) {
  if (!rel) return false;
  if (rel === 'main.js' || rel === 'preload.js') return true;
  if (/^src\/.*\.js$/.test(rel)) return true;
  return rel.endsWith('.md') && docFiles().includes(rel);
}

function main() {
  const payload = lib.readStdin();
  const rel = lib.toRel(payload && payload.tool_input && payload.tool_input.file_path);
  if (!isGuarded(rel)) process.exit(0);

  const echoes = findEchoes();
  const count = echoes.length;

  const prior = lib.readJson(BASELINE, null);
  const baseline = prior && typeof prior.maxRuns === 'number' ? prior.maxRuns : null;

  if (baseline == null) {
    lib.writeJson(BASELINE, { maxRuns: count, note: NOTE });
    process.exit(0);
  }
  if (count <= baseline) {
    if (count < baseline) lib.writeJson(BASELINE, { maxRuns: count, note: NOTE });
    process.exit(0);
  }

  // The file just edited is the one the fix belongs in, so its own echoes lead the report.
  const mine = echoes.filter((e) => e.a === rel || e.b === rel);
  const shown = (mine.length ? mine : echoes)
    .sort((p, q) => q.words - p.words)
    .slice(0, 5)
    .map((e) => '  - ' + e.a + ':' + e.lineA + '  <->  ' + e.b + ':' + e.lineB +
      '\n      "' + e.text + '…" (' + e.words + ' words)')
    .join('\n');

  process.stderr.write(
    'ECHO GUARD: repeated text runs between files rose from ' + baseline + ' to ' + count + '.\n' +
      'Some sentence in this edit already exists in another file.\n\n' +
      'Explain a trap ONCE, at the line where someone hits it. A module\'s purpose and its ' +
      'rejected shapes live in the docs and are not restated in the file; a rule in ' +
      'CLAUDE.md or a skill is not repeated in the comment that obeys it.\n\n' +
      'Delete the weaker copy. If the two need to stay connected, leave a pointer - the ' +
      'filename alone - not the sentence again.\n\n' +
      'Longest repeats involving this file:\n' + shown + '\n\n' +
      'If a repeat is genuinely unavoidable, raise "maxRuns" to ' + count + ' in ' +
      '.claude/hooks/comment-echo-baseline.json and say in the handover that you did.\n'
  );
  process.exit(2);
}

try {
  main();
} catch {
  process.exit(0);
}
