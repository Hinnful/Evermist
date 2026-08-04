#!/usr/bin/env node
'use strict';

/*
 * DECISIONS.md growth guard — a NOTICE, not a ratchet.
 *
 * WHY: this is the one guarded file that is SUPPOSED to grow. The alternative to
 * a growing ledger is making the same decision twice, which is the expensive
 * mistake it exists to prevent. So it must never block an addition.
 *
 * What it watches is the point where the ledger stops working. Its value is that
 * a reader checking one decision also sees the neighbouring one it didn't know to
 * ask about. That survives while the file is read whole; past a certain size the
 * reader greps instead, finds exactly what it searched for, and the neighbour is
 * lost silently.
 *
 * Three rules, each fired ONCE per subject so it can never nag:
 *
 *  1. SIZE — total bytes past a soft ceiling. Re-warns only after another
 *     reWarnEveryBytes of growth. Action is a split, and NOT in the same turn.
 *  2. DISTRIBUTION — one "##" section past maxSectionShare of the file. This is
 *     the rule that actually fixed CLAUDE.md, where one section had grown to
 *     80.7% of the file and rebalancing worked where trimming the total had not.
 *     Skipped until the file is large enough for distribution to matter, so a
 *     small topic file with one dominant section stays quiet.
 *  3. ENTRY LENGTH — one "###" entry past a line budget. Enforces the file's own
 *     written rule, and is the real size control: ledgers bloat by entries
 *     growing into stories, not by accumulating decisions. Unlike the other two,
 *     this one IS meant to be fixed in the turn that trips it.
 *
 * Also guards docs/decisions/*.md so the same discipline survives a split.
 *
 * Exit 2 is used because it is the only channel that reaches the model, so every
 * message opens by saying the edit was correct. Fail-open by design: any internal
 * error exits 0. A broken guard must never wedge editing.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const STATE = path.join(__dirname, 'decisions-baseline.json');
const MAIN = 'docs/DECISIONS.md';

const DEFAULTS = {
  softMaxBytes: 90000,
  reWarnEveryBytes: 20000,
  maxSectionShare: 0.4,
  sectionRuleMinBytes: 40000,
  maxEntryLines: 14,
};

const NOTE =
  'Thresholds for the DECISIONS.md growth notice. This file is a ledger and is ' +
  'MEANT to grow, so nothing here blocks an addition. "warned" records what has ' +
  'already been reported so a notice fires once and never nags; clear an entry ' +
  'from it to hear about that subject again.';

function readStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw && raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    return {
      config: Object.assign({}, DEFAULTS, s.config || {}),
      files: s.files && typeof s.files === 'object' ? s.files : {},
    };
  } catch {
    return { config: Object.assign({}, DEFAULTS), files: {} };
  }
}

function writeState(state) {
  try {
    fs.writeFileSync(
      STATE,
      JSON.stringify({ config: state.config, note: NOTE, files: state.files }, null, 2) + '\n'
    );
  } catch {
    /* fail-open */
  }
}

// Repo-relative, forward-slashed. Null if it escapes the repo.
function toRel(fp) {
  try {
    const rel = path.relative(ROOT, path.resolve(String(fp)));
    if (!rel || rel.startsWith('..')) return null;
    return rel.replace(/\\/g, '/');
  } catch {
    return null;
  }
}

function isGuarded(rel) {
  const p = rel.toLowerCase();
  return p === 'docs/decisions.md' || /^docs\/decisions\/[^/]+\.md$/.test(p);
}

/*
 * Attribute every line to its "##" section and "###" entry. Content before the
 * first "##" is the file's preamble, not a topic, so it is excluded from the
 * distribution rule — otherwise the header skews the share of every real section.
 * The denominator stays the whole file, because that is the real reading cost.
 */
function analyze(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  const entries = [];
  let sec = null;
  let ent = null;

  for (const line of lines) {
    const bytes = Buffer.byteLength(line) + 1;

    if (/^##\s+/.test(line)) {
      sec = { name: line.replace(/^##\s+/, '').trim(), bytes: 0 };
      sections.push(sec);
      ent = null;
      continue;
    }
    if (/^###\s+/.test(line)) {
      ent = { name: line.replace(/^###\s+/, '').trim(), lines: 0 };
      entries.push(ent);
      if (sec) sec.bytes += bytes;
      continue;
    }

    if (sec) sec.bytes += bytes;
    if (ent && line.trim() !== '') ent.lines += 1;
  }

  return { bytes: Buffer.byteLength(text), sections, entries };
}

function fmt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function main() {
  const payload = readStdin();
  const fp = payload && payload.tool_input && payload.tool_input.file_path;
  const rel = fp ? toRel(fp) : MAIN;
  if (!rel || !isGuarded(rel)) process.exit(0);

  let text;
  try {
    text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    process.exit(0); // unreadable -> nothing to guard
  }

  const state = readState();
  const cfg = state.config;
  const seen = state.files[rel] || { warnedBytes: 0, sections: [], entries: [] };
  const notices = [];

  const { bytes, sections, entries } = analyze(text);

  // Rule 1 — total size.
  const sizeTrigger = seen.warnedBytes
    ? seen.warnedBytes + cfg.reWarnEveryBytes
    : cfg.softMaxBytes;
  if (bytes > sizeTrigger) {
    seen.warnedBytes = bytes;
    notices.push(
      'DECISIONS NOTICE — your edit is correct. Do NOT revert it, and do NOT ' +
        'restructure the file in this turn.\n\n' +
        rel +
        ' has reached ' +
        fmt(bytes) +
        ' bytes (soft ceiling ' +
        fmt(cfg.softMaxBytes) +
        ').\nPast roughly this size a reader greps the ledger instead of reading it, ' +
        'finds only what it searched for, and misses the adjacent decision it did ' +
        'not know to look for — which is the whole value of the file.\n\n' +
        'The agreed fix is NOT to delete entries. It is to move the largest "##" ' +
        'section into docs/decisions/<topic>.md and leave a one-line pointer ' +
        'behind.\n' +
        'That is deliberate work, not something to slip into an unrelated turn. ' +
        'Report it to the user and let them schedule it. To move the ceiling, edit ' +
        'config.softMaxBytes in .claude/hooks/decisions-baseline.json.\n'
    );
  }

  // Rule 2 — one section dominating. Only meaningful once the file is sizeable.
  if (bytes >= cfg.sectionRuleMinBytes) {
    for (const s of sections) {
      const share = s.bytes / bytes;
      if (share <= cfg.maxSectionShare || seen.sections.indexOf(s.name) !== -1) continue;
      seen.sections.push(s.name);
      notices.push(
        'DECISIONS NOTICE — your edit is correct. Do NOT revert it.\n\n' +
          'Section "' +
          s.name +
          '" is now ' +
          (share * 100).toFixed(0) +
          '% of ' +
          rel +
          ' (threshold ' +
          (cfg.maxSectionShare * 100).toFixed(0) +
          '%).\nDistribution is what actually broke CLAUDE.md: one section had grown ' +
          'to 80.7% of that file, and rebalancing fixed it where trimming the total ' +
          'had not.\n\n' +
          'Move this section into docs/decisions/<topic>.md and leave a one-line ' +
          'pointer in ' +
          rel +
          '. Report it to the user rather than doing it mid-turn.\n'
      );
    }
  }

  // Rule 3 — an entry growing into a story. This one is fixable right now.
  for (const e of entries) {
    if (e.lines <= cfg.maxEntryLines || seen.entries.indexOf(e.name) !== -1) continue;
    seen.entries.push(e.name);
    notices.push(
      'DECISIONS NOTICE — fix this one in the current turn.\n\n' +
        'Entry "' +
        e.name +
        '" runs ' +
        e.lines +
        ' non-blank lines (budget ' +
        cfg.maxEntryLines +
        ').\n' +
        "The file's own rule: one heading, a status, and at most a short " +
        'paragraph. If an entry needs more than that, the excess belongs in the ' +
        'commit message.\n' +
        'Ledgers bloat by entries growing into stories, not by accumulating ' +
        'decisions, so this budget is the real size control. Trim it to the ' +
        'decision and why it held; narrative, dated fix logs and measurement ' +
        'counts go in the commit message.\n'
    );
  }

  state.files[rel] = seen;
  writeState(state);

  if (notices.length === 0) process.exit(0);

  process.stderr.write(notices.join('\n'));
  process.exit(2);
}

main();
