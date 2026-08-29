#!/usr/bin/env node
'use strict';

/*
 * ARCHITECTURE.md guard - drift on a module write, size and mood on a doc write.
 *
 * WHY: this doc has no other upkeep mechanism and it silently rots - it once went
 * seven modules stale because nothing ever said "update this". A pointer from
 * CLAUDE.md is not a trigger: a link only fires if someone is already reading that
 * section. The only thing that catches drift is a check at write time.
 *
 * TWO TRIGGERS, because the two failures have opposite causes. A write to src/*.js
 * runs the DRIFT rules; an edit to the doc is the fix for those, not the cause, and
 * firing there would nag mid-repair. A write to docs/ARCHITECTURE.md runs the SIZE
 * and MOOD rules, which only that write can cause.
 *
 * Two module lists exist on purpose. CLAUDE.md's map is terse and always in context,
 * because the rule "extend the module that owns the concern" is unusable without it.
 * ARCHITECTURE.md's table is the plain-language version, read on demand. Both drift,
 * so both are checked.
 *
 * Drift rules, on a module write:
 *
 *  1. UNDOCUMENTED MODULE - a src/*.js missing from one or both lists.
 *  2. STALE ROW - a name in a list with no file behind it, which is what a rename
 *     leaves behind.
 *  3. PERSON REFERENCES - ARCHITECTURE.md is public prose and drifts into "the map
 *     he's looking at" without anyone noticing.
 *
 * Size and mood rules, on a doc write:
 *
 *  4. SIZE - total bytes past a soft ceiling. NEVER blocks: this doc must grow when
 *     the app does. The action is a subject split into docs/architecture/<topic>.md
 *     behind a pointer, the same move the ledger guard asks for. Scheduled work.
 *  5. DISTRIBUTION - one "##" section past maxSectionShare of the file. This is what
 *     actually broke CLAUDE.md, where one section reached 80.7%. Scheduled work.
 *  6. MOOD - past-tense narrative in a present-tense doc. Fix it in the turn. This is
 *     the real size control: the file pads by explaining what was tried instead of
 *     how the app works, and that belongs in the decisions ledger. A byte count
 *     cannot see it, because narrative passes as long as some section shrank.
 *
 * Every rule fires once per subject, so none can nag.
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

// ARCHITECTURE.md is READ ON DEMAND, not loaded into every session, so it is not
// rationed the way CLAUDE.md is. It must grow when the app grows. The ceiling only
// marks where a reader stops reading it whole and starts searching it.
const DEFAULTS = {
  softMaxBytes: 45000,
  reWarnEveryBytes: 10000,
  maxSectionShare: 0.4,
};

const NOTE =
  'Per-subject state for the ARCHITECTURE.md guard, so each notice fires once and ' +
  'never nags. Clear "reported" to hear about everything again, and "warnedBytes" ' +
  'to hear about size again. "config" holds the size thresholds; this doc is MEANT ' +
  'to grow, so nothing here blocks an edit.';

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

// Rules 1-3. Returns the warnedBytes it was given: a module write never touches it.
function checkModuleWrite(ctx) {
  const { notices, mark } = ctx;

  const archText = read(ARCH);
  const rulesText = read(RULES);
  if (!archText || !rulesText) return ctx.warnedBytes;

  const archNames = namesIn(archText);
  const ruleNames = namesIn(rulesText);
  const files = moduleFiles();
  if (files.length === 0) return ctx.warnedBytes;

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
        'phrase; that file grows only by a deliberate raise of its ceiling, so pay for ' +
        'the row by tightening a neighbour first.\n' +
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

  return ctx.warnedBytes;
}

// Rules 4-6. Returns the new warnedBytes so a size notice cannot repeat.
function checkDocWrite(ctx) {
  const { notices, mark, config } = ctx;

  const text = read(ARCH);
  if (!text) return ctx.warnedBytes;

  const { bytes, sections } = lib.analyze(text);

  // Rule 4 - total size. A notice, never a block.
  //
  // ⚠ A SPLIT RE-ARMS THE NOTICE. Without this, warning at 48k then splitting back to 35k would
  // leave the trigger at 48k + reWarn, so the doc could climb to 58k in silence — the guard
  // would go quiet exactly because someone did the thing it asked for.
  let warnedBytes = bytes <= config.softMaxBytes ? 0 : ctx.warnedBytes;
  const trigger = warnedBytes ? warnedBytes + config.reWarnEveryBytes : config.softMaxBytes;
  if (bytes > trigger) {
    warnedBytes = bytes;
    notices.push(
      'ARCHITECTURE NOTICE - your edit is correct. Do NOT revert it, and do NOT ' +
        'restructure the file in this turn.\n\n' +
        'docs/ARCHITECTURE.md has reached ' +
        lib.fmt(bytes) +
        ' bytes (soft ceiling ' +
        lib.fmt(config.softMaxBytes) +
        ').\nThis doc is SUPPOSED to grow when the app does, so nothing here blocks an ' +
        'addition. What size watches is the point where a reader stops reading it whole ' +
        'and starts searching it, which loses the neighbouring section they did not know ' +
        'to look for.\n\n' +
        'The fix is NOT deleting explanation. Move one subject into ' +
        'docs/architecture/<topic>.md and leave a pointer behind, the same split the ' +
        'ledger uses. That is a topic split inside one question, so it keeps the ' +
        'one-question-per-doc rule.\nReport it to the user and let them schedule it. To ' +
        'move the ceiling instead, edit config.softMaxBytes in ' +
        '.claude/hooks/architecture-baseline.json.\n'
    );
  }

  // Rule 5 - one section dominating.
  for (const s of sections) {
    const share = s.bytes / bytes;
    if (share <= config.maxSectionShare) continue;
    if (!mark('section:' + s.name.toLowerCase())) continue;
    notices.push(
      'ARCHITECTURE NOTICE - your edit is correct. Do NOT revert it.\n\n' +
        'Section "' +
        s.name +
        '" is now ' +
        (share * 100).toFixed(0) +
        '% of docs/ARCHITECTURE.md (threshold ' +
        (config.maxSectionShare * 100).toFixed(0) +
        '%).\nDistribution is what actually broke CLAUDE.md: one section had grown to ' +
        '80.7% of that file, and rebalancing fixed it where trimming the total had ' +
        'not.\n\nMove this section into docs/architecture/<topic>.md and leave a ' +
        'pointer. Report it rather than doing it mid-turn.\n'
    );
  }

  // Rule 6 - mood. Fixable right now, so it asks rather than schedules.
  const narrative = lib
    .findNarrative(text, [])
    .filter((h) => mark('mood:' + h.text.slice(0, 60)));
  if (narrative.length > 0) {
    notices.push(
      'ARCHITECTURE GUARD - fix this in the current turn.\n\n' +
        (narrative.length === 1
          ? 'One line reads as history'
          : narrative.length + ' lines read as history') +
        ' rather than as how the app works:\n' +
        narrative
          .slice(0, 6)
          .map((h) => '  - line ' + h.line + ' ("' + h.marker + '"): ' + h.text.slice(0, 90))
          .join('\n') +
        '\n\nThis file answers ONE question - how does it work? - in the present ' +
        'indicative, which is what proves it. A date stamp, "originally", "an earlier ' +
        'version", "was tried" or "was rejected" means the sentence explains the past ' +
        'instead of the present, and that belongs in docs/DECISIONS.md or one of its ' +
        'topic files.\nThe size rules cannot see this: narrative passes silently as long ' +
        'as some other section shrank by more. Rewrite the line in the present tense, ' +
        'and move the history if it is worth keeping.\n'
    );
  }

  return warnedBytes;
}

function main() {
  const payload = lib.readStdin();
  const fp = payload && payload.tool_input && payload.tool_input.file_path;
  if (!fp) process.exit(0);

  const rel = lib.toRel(fp);
  if (!rel) process.exit(0);

  const isModule = /^src\/[^/]+\.js$/i.test(rel);
  const isDoc = rel.toLowerCase() === 'docs/architecture.md';
  if (!isModule && !isDoc) process.exit(0);

  const state = lib.readJson(STATE, {});
  const reported = Array.isArray(state.reported) ? state.reported : [];
  const config = Object.assign({}, DEFAULTS, state.config || {});
  const notices = [];
  const mark = (subject) => {
    if (reported.indexOf(subject) !== -1) return false;
    reported.push(subject);
    return true;
  };

  const ctx = { notices, mark, config, warnedBytes: Number(state.warnedBytes) || 0 };
  const warnedBytes = isModule ? checkModuleWrite(ctx) : checkDocWrite(ctx);

  lib.writeJson(STATE, {
    config: config,
    note: NOTE,
    reported: reported,
    warnedBytes: warnedBytes,
  });

  if (notices.length === 0) process.exit(0);

  process.stderr.write(notices.join('\n'));
  process.exit(2);
}

try {
  main();
} catch {
  process.exit(0);
}
