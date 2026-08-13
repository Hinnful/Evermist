#!/usr/bin/env node
'use strict';

/*
 * ARCHITECTURE.md drift guard.
 *
 * WHY: this doc has no other upkeep mechanism and it silently rots - it once went
 * seven modules stale because nothing ever said "update this". A pointer from
 * CLAUDE.md is not a trigger: a link only fires if someone is already reading that
 * section. The only thing that catches drift is a check at write time.
 *
 * It deliberately does NOT fire on an edit to ARCHITECTURE.md. Drift happens when a
 * MODULE is added, renamed or deleted and the doc is left alone, so the trigger is a
 * write to src/*.js.
 *
 * Two module lists exist on purpose. CLAUDE.md's map is terse and always in context,
 * because the rule "extend the module that owns the concern" is unusable without it.
 * ARCHITECTURE.md's table is the plain-language version, read on demand. Both drift,
 * so both are checked.
 *
 * Three rules, each fired once per subject:
 *
 *  1. UNDOCUMENTED MODULE - a src/*.js missing from one or both lists.
 *  2. STALE ROW - a name in a list with no file behind it, which is what a rename
 *     leaves behind.
 *  3. PERSON REFERENCES - ARCHITECTURE.md is public prose and drifts into "the map
 *     he's looking at" without anyone noticing.
 *
 * All three are meant to be fixed in the turn that trips them: they are one line of
 * writing each, and the cost of deferring is that the doc is wrong in the meantime.
 *
 * Exit 2 is the only channel that reaches the model. Fail-open by design: any
 * internal error exits 0.
 */

const fs = require('fs');
const path = require('path');
const lib = require('./guard-lib.js');

const STATE = path.join(__dirname, 'architecture-baseline.json');
const ARCH = path.join(lib.ROOT, 'docs', 'ARCHITECTURE.md');
const RULES = path.join(lib.ROOT, 'CLAUDE.md');
const SRC = path.join(lib.ROOT, 'src');

// Not modules: the vendored library, and anything under a subfolder.
const IGNORE = new Set(['pixi.min.js']);

const NOTE =
  'Per-subject state for the ARCHITECTURE.md drift guard, so each notice fires once ' +
  'and never nags. Clear "reported" to hear about everything again.';

function moduleFiles() {
  try {
    return fs
      .readdirSync(SRC)
      .filter((f) => f.toLowerCase().endsWith('.js') && !IGNORE.has(f.toLowerCase()));
  } catch {
    return [];
  }
}

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

// Every `backticked.js` name a doc mentions. Both lists are markdown tables using
// code spans, so this is the whole vocabulary either doc claims to cover.
function namesIn(text) {
  const found = new Set();
  const re = /`([A-Za-z0-9_.-]+\.js)`/g;
  let m;
  while ((m = re.exec(text)) !== null) found.add(m[1].toLowerCase());
  return found;
}

function main() {
  const payload = lib.readStdin();
  const fp = payload && payload.tool_input && payload.tool_input.file_path;
  if (!fp) process.exit(0);

  const rel = lib.toRel(fp);
  if (!rel) process.exit(0);

  // Only a module write can cause drift. An edit to either doc is the fix, not the
  // cause, and firing there would nag mid-repair.
  if (!/^src\/[^/]+\.js$/i.test(rel)) process.exit(0);

  const state = lib.readJson(STATE, {});
  const reported = Array.isArray(state.reported) ? state.reported : [];
  const notices = [];
  const mark = (subject) => {
    if (reported.indexOf(subject) !== -1) return false;
    reported.push(subject);
    return true;
  };

  const archText = read(ARCH);
  const rulesText = read(RULES);
  if (!archText || !rulesText) process.exit(0);

  const archNames = namesIn(archText);
  const ruleNames = namesIn(rulesText);
  const files = moduleFiles();
  if (files.length === 0) process.exit(0);

  // Rule 1 - a module neither list documents.
  const missing = [];
  for (const f of files) {
    const key = f.toLowerCase();
    const gaps = [];
    if (!archNames.has(key)) gaps.push('docs/ARCHITECTURE.md');
    if (!ruleNames.has(key)) gaps.push("CLAUDE.md's module map");
    if (gaps.length && mark('missing:' + key)) missing.push({ file: f, gaps });
  }
  if (missing.length > 0) {
    notices.push(
      'ARCHITECTURE GUARD - fix this in the current turn.\n\n' +
        missing.length +
        (missing.length === 1 ? ' module is undocumented:\n' : ' modules are undocumented:\n') +
        missing.map((m) => '  - src/' + m.file + ' missing from ' + m.gaps.join(' and ')).join('\n') +
        '\n\nAdd a row to each. ARCHITECTURE.md gets one plain-language sentence saying ' +
        'what the file does, present tense. CLAUDE.md\'s map gets the terse "Owns" ' +
        'phrase, and that file may not grow, so pay for it by tightening a neighbour.\n' +
        'A module nothing documents is a module the next session will duplicate ' +
        'instead of extending.\n'
    );
  }

  // Rule 2 - a documented name with no file behind it.
  const onDisk = new Set(files.map((f) => f.toLowerCase()));
  // Names that legitimately are not modules under src/.
  const NOT_MODULES = new Set(['main.js', 'preload.js', 'index.js']);
  const stale = [];
  for (const name of archNames) {
    if (onDisk.has(name) || NOT_MODULES.has(name) || name.indexOf('guard-') === 0) continue;
    if (mark('stale:' + name)) stale.push(name);
  }
  if (stale.length > 0) {
    notices.push(
      'ARCHITECTURE GUARD - fix this in the current turn.\n\n' +
        'docs/ARCHITECTURE.md names ' +
        stale.length +
        (stale.length === 1 ? ' file that does not exist:\n' : ' files that do not exist:\n') +
        stale.map((s) => '  - ' + s).join('\n') +
        '\n\nA rename leaves the old row behind and the doc then describes a file ' +
        'nobody can open. Update or delete the row. Check whether the same name still ' +
        "appears in CLAUDE.md's module map and in .claude/hooks/guard-skill-hint.js.\n"
    );
  }

  // Rule 3 - person references in public prose.
  const persons = lib
    .findPersonRefsInText(archText)
    .filter((h) => mark('person:' + h.text.slice(0, 60)));
  if (persons.length > 0) {
    notices.push(
      'ARCHITECTURE GUARD - fix this in the current turn.\n\n' +
        'docs/ARCHITECTURE.md is PUBLIC and ' +
        persons.length +
        (persons.length === 1 ? ' line names a person:\n' : ' lines name a person:\n') +
        persons
          .slice(0, 6)
          .map((h) => '  - line ' + h.line + ': ' + h.text.slice(0, 90))
          .join('\n') +
        '\n\nWrite about the app, not about whoever uses it. "the map the DM is looking ' +
        'at", not "the map he\'s looking at".\n'
    );
  }

  lib.writeJson(STATE, { note: NOTE, reported: reported });

  if (notices.length === 0) process.exit(0);

  process.stderr.write(notices.join('\n'));
  process.exit(2);
}

try {
  main();
} catch {
  process.exit(0);
}
