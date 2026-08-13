#!/usr/bin/env node
'use strict';

/*
 * Ledger guard - a NOTICE on size, a FIX request on shape.
 *
 * Covers every past-tense ledger: docs/DECISIONS.md, docs/PRODUCT.md, any
 * docs/decisions/<topic>.md a split produces, and the private command ledger in the
 * memory dir. One guard rather than three near-copies, because they are the same
 * kind of file with different subjects.
 *
 * WHY IT NEVER BLOCKS SIZE: these files are SUPPOSED to grow. The alternative to a
 * growing ledger is making the same decision twice, which is the expensive mistake
 * they exist to prevent.
 *
 * What size watches is the point where a ledger stops working. Its value is that a
 * reader checking one decision also sees the neighbouring one it didn't know to ask
 * about. That survives while the file is read whole; past a certain size the reader
 * greps instead, finds exactly what it searched for, and the neighbour is lost.
 *
 * Five rules, each fired ONCE per subject so none can nag:
 *
 *  1. SIZE - total bytes past a soft ceiling. Re-warns only after another
 *     reWarnEveryBytes of growth. Action is a split, and NOT in the same turn.
 *  2. DISTRIBUTION - one "##" section past maxSectionShare of the file. This is the
 *     rule that actually fixed CLAUDE.md, where one section had grown to 80.7% and
 *     rebalancing worked where trimming the total had not. Skipped until the file is
 *     large enough for distribution to matter.
 *  3. ENTRY LENGTH - one "###" entry past a line budget. The real size control:
 *     ledgers bloat by entries growing into stories, not by accumulating decisions.
 *  4. MISSING STATUS TAG - an entry with no `SETTLED`/`REJECTED`/etc. The tag is what
 *     makes the file a lookup table instead of an essay.
 *  5. PERSON REFERENCES - "he", "his", "I recommended". These files are public, and
 *     the attribution carries no information a future reader needs.
 *
 * Rules 3, 4 and 5 are meant to be fixed in the turn that trips them. 1 and 2 are
 * scheduled work.
 *
 * Exit 2 is used because it is the only channel that reaches the model, so every
 * message opens by saying the edit was correct. Fail-open by design: any internal
 * error exits 0. A broken guard must never wedge editing.
 */

const fs = require('fs');
const path = require('path');
const lib = require('./guard-lib.js');

const STATE = path.join(__dirname, 'ledger-baseline.json');

const DEFAULTS = {
  softMaxBytes: 90000,
  reWarnEveryBytes: 20000,
  maxSectionShare: 0.4,
  sectionRuleMinBytes: 40000,
  maxEntryLines: 14,
};

const TAGS = ['SETTLED', 'REJECTED', 'REVERTED', 'PARKED', "WON'T FIX", 'SHIPPED', 'REOPENED'];

// Public ledgers get the person-reference rule. The private one is not published,
// so naming a person there costs nothing and the check would only be noise.
const PUBLIC = /^docs\/(decisions\.md|product\.md|decisions\/[^/]+\.md)$/;

const NOTE =
  'Thresholds for the ledger guards (docs/DECISIONS.md, docs/PRODUCT.md, ' +
  'docs/decisions/*.md, and the private command ledger). These files are MEANT to ' +
  'grow, so nothing here blocks an addition. Per-file "warned" state records what ' +
  'has already been reported so a notice fires once and never nags; clear an entry ' +
  'to hear about that subject again.';

function readState() {
  const s = lib.readJson(STATE, {});
  return {
    config: Object.assign({}, DEFAULTS, s.config || {}),
    files: s.files && typeof s.files === 'object' ? s.files : {},
  };
}

function writeState(state) {
  lib.writeJson(STATE, { config: state.config, note: NOTE, files: state.files });
}

// Returns the key to store state under, or null if this file is not a ledger.
// In-repo files are keyed by repo-relative path; the private ledger lives outside
// the repo and is keyed by basename.
function ledgerKey(fp) {
  const rel = lib.toRel(fp);
  if (rel) {
    const p = rel.toLowerCase();
    if (p === 'docs/decisions.md' || p === 'docs/product.md') return p;
    if (/^docs\/decisions\/[^/]+\.md$/.test(p)) return p;
    return null;
  }
  const base = path.basename(String(fp)).toLowerCase();
  return base === 'project-process.md' ? base : null;
}

function main() {
  const payload = lib.readStdin();
  const fp = payload && payload.tool_input && payload.tool_input.file_path;
  if (!fp) process.exit(0);

  const key = ledgerKey(fp);
  if (!key) process.exit(0);

  let text;
  try {
    text = fs.readFileSync(String(fp), 'utf8');
  } catch {
    process.exit(0); // unreadable -> nothing to guard
  }

  const state = readState();
  const cfg = state.config;
  const seen = state.files[key] || { warnedBytes: 0, sections: [], entries: [], untagged: [], persons: [] };
  for (const f of ['sections', 'entries', 'untagged', 'persons']) {
    if (!Array.isArray(seen[f])) seen[f] = [];
  }
  const notices = [];

  const { bytes, sections, entries } = lib.analyze(text);

  // Rule 1 - total size.
  const sizeTrigger = seen.warnedBytes ? seen.warnedBytes + cfg.reWarnEveryBytes : cfg.softMaxBytes;
  if (bytes > sizeTrigger) {
    seen.warnedBytes = bytes;
    notices.push(
      'LEDGER NOTICE - your edit is correct. Do NOT revert it, and do NOT ' +
        'restructure the file in this turn.\n\n' +
        key +
        ' has reached ' +
        lib.fmt(bytes) +
        ' bytes (soft ceiling ' +
        lib.fmt(cfg.softMaxBytes) +
        ').\nPast roughly this size a reader greps the ledger instead of reading it, ' +
        'finds only what it searched for, and misses the adjacent decision it did not ' +
        'know to look for - which is the whole value of the file.\n\n' +
        'The agreed fix is NOT to delete entries. It is to move the largest "##" ' +
        'section into docs/decisions/<topic>.md and leave a one-line pointer behind. ' +
        'That is a topic split INSIDE one question, which does not change the docs ' +
        'criterion.\nReport it to the user and let them schedule it. To move the ' +
        'ceiling, edit config.softMaxBytes in .claude/hooks/ledger-baseline.json.\n'
    );
  }

  // Rule 2 - one section dominating. Only meaningful once the file is sizeable.
  if (bytes >= cfg.sectionRuleMinBytes) {
    for (const s of sections) {
      const share = s.bytes / bytes;
      if (share <= cfg.maxSectionShare || seen.sections.indexOf(s.name) !== -1) continue;
      seen.sections.push(s.name);
      notices.push(
        'LEDGER NOTICE - your edit is correct. Do NOT revert it.\n\n' +
          'Section "' +
          s.name +
          '" is now ' +
          (share * 100).toFixed(0) +
          '% of ' +
          key +
          ' (threshold ' +
          (cfg.maxSectionShare * 100).toFixed(0) +
          '%).\nDistribution is what actually broke CLAUDE.md: one section had grown to ' +
          '80.7% of that file, and rebalancing fixed it where trimming the total had ' +
          'not.\n\nMove this section into docs/decisions/<topic>.md and leave a one-line ' +
          'pointer behind. Report it rather than doing it mid-turn.\n'
      );
    }
  }

  // Rule 3 - an entry growing into a story. Fixable right now.
  for (const e of entries) {
    if (e.lines <= cfg.maxEntryLines || seen.entries.indexOf(e.name) !== -1) continue;
    seen.entries.push(e.name);
    notices.push(
      'LEDGER GUARD - fix this one in the current turn.\n\n' +
        'Entry "' +
        e.name +
        '" runs ' +
        e.lines +
        ' non-blank lines (budget ' +
        cfg.maxEntryLines +
        ').\n' +
        "The file's own rule: one heading, a status, and at most a short paragraph. If " +
        'an entry needs more than that, the excess belongs in the commit message.\n' +
        'Ledgers bloat by entries growing into stories, not by accumulating decisions, ' +
        'so this budget is the real size control. Trim it to the decision and why it ' +
        'held; narrative, dated fix logs and measurement counts go in the commit.\n'
    );
  }

  // Rule 4 - an entry with no status tag.
  const untagged = lib.findUntagged(entries, TAGS).filter((e) => seen.untagged.indexOf(e.name) === -1);
  if (untagged.length > 0) {
    for (const e of untagged) seen.untagged.push(e.name);
    notices.push(
      'LEDGER GUARD - fix this in the current turn.\n\n' +
        untagged.length +
        (untagged.length === 1 ? ' entry has no status tag:\n' : ' entries have no status tag:\n') +
        untagged.map((e) => '  - line ' + e.line + ': "' + e.name + '"').join('\n') +
        '\n\nAdd one of ' +
        TAGS.map((t) => '`' + t + '`').join(' · ') +
        ' to the heading. The tag is what makes this a lookup table rather than an ' +
        'essay: it tells a reader whether they are looking at the current shape or at ' +
        'something already killed. An untagged entry gets skimmed past.\n'
    );
  }

  // Rule 5 - person references, public ledgers only.
  if (PUBLIC.test(key)) {
    const persons = lib.findPersonRefs(entries).filter((h) => seen.persons.indexOf(h.entry + '#' + h.line) === -1);
    if (persons.length > 0) {
      for (const h of persons) seen.persons.push(h.entry + '#' + h.line);
      notices.push(
        'LEDGER GUARD - fix this in the current turn.\n\n' +
          'This file is PUBLIC and ' +
          persons.length +
          (persons.length === 1 ? ' line names a person:\n' : ' lines name a person:\n') +
          persons
            .slice(0, 6)
            .map((h) => '  - line ' + h.line + ': ' + h.text.slice(0, 90))
            .join('\n') +
          '\n\nWrite about the decision, never about the people. "he", "his", "I ' +
          'recommended" and quoted chat remarks read as leaked internal notes about a ' +
          'named person, and the attribution carries no information a future reader ' +
          'needs.\nRender a judgement call impersonally: "judged not worth the cost", ' +
          '"rejected on product grounds". If this is a false positive on ordinary ' +
          'prose, reword it anyway - the phrasing is what a reader will copy.\n'
      );
    }
  }

  state.files[key] = seen;
  writeState(state);

  if (notices.length === 0) process.exit(0);

  process.stderr.write(notices.join('\n'));
  process.exit(2);
}

try {
  main();
} catch {
  process.exit(0);
}
