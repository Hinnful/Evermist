#!/usr/bin/env node
'use strict';

/*
 * Comment guard - a ratchet on the CODEBASE-WIDE comment share of shipped JavaScript.
 *
 * WHY: comment density is a total nobody owns. Every individual comment reads as
 * justified at the moment it is written, so the share climbs on its own; a deliberate
 * trim set it at 19.3% and it was back past that inside three weeks. A rule alone had
 * already failed twice in this repo, and both times the hook was what held.
 *
 * CODEBASE-WIDE, never per file. A per-file target is REJECTED in
 * docs/decisions/docs-and-guards.md: `state.js` is short declarations whose comments are
 * almost all warnings about specific traps, so a per-file rule fires loudest on the file
 * that most deserves them.
 *
 * The share is a RATIO, so deleting code raises it with no comment written. That case is
 * real and legitimate, and the only answer is a deliberate edit of the baseline - the
 * message says so.
 *
 * Fail-open by design - any internal error exits 0.
 */

const path = require('path');
const lib = require('./guard-lib.js');

const BASELINE = path.join(__dirname, 'comments-baseline.json');

const NOTE =
  'Max comment share (percent of non-blank lines) across shipped JavaScript: ' +
  'src/**/*.js plus main.js and preload.js. Auto-ratchets DOWN. Raise only when code ' +
  'was deliberately deleted, which lifts the ratio without a comment being written.';

// Rounded to hundredths so the baseline file does not churn on float noise.
function round(n) {
  return Math.round(n * 100) / 100;
}

function isShippedJs(rel) {
  if (!rel) return false;
  return rel === 'main.js' || rel === 'preload.js' || /^src\/.*\.js$/.test(rel);
}

function main() {
  const payload = lib.readStdin();
  const fp = payload && payload.tool_input && payload.tool_input.file_path;
  if (!isShippedJs(lib.toRel(fp))) process.exit(0);

  const stats = lib.commentStats();
  if (stats.comments + stats.code === 0) process.exit(0);
  const pct = round(stats.pct);

  const prior = lib.readJson(BASELINE, null);
  const baseline = prior && typeof prior.maxPct === 'number' ? prior.maxPct : null;

  if (baseline == null) {
    lib.writeJson(BASELINE, { maxPct: pct, note: NOTE });
    process.exit(0);
  }
  if (pct <= baseline) {
    if (pct < baseline) lib.writeJson(BASELINE, { maxPct: pct, note: NOTE });
    process.exit(0);
  }

  // Ranked by comment COUNT, not by share: the guarded figure is codebase-wide, so those
  // are the files where a cut moves it. Ranking by share would name the short trap-warning
  // files first, which is the per-file instrument this guard exists to avoid.
  const worst = stats.perFile
    .slice()
    .sort((a, b) => b.comments - a.comments)
    .slice(0, 5)
    .map((f) => '  - ' + f.file + ': ' + f.comments + ' comment lines (' + f.pct.toFixed(1) + '%)')
    .join('\n');

  process.stderr.write(
    'COMMENT GUARD: the comment share of shipped JavaScript rose from ' +
      baseline.toFixed(2) + '% to ' + pct.toFixed(2) + '%.\n' +
      'That is ' + lib.fmt(stats.comments) + ' comment lines against ' + lib.fmt(stats.code) +
      ' lines of code.\n\n' +
      'Cut by the rule in CLAUDE.md Conventions: keep the rule, one clause of why, and any ' +
      'warning about a specific trap. Drop restatements of the code, named examples that ' +
      'disambiguate nothing, "an earlier version was tried", and measurement dates or counts.\n' +
      'Reasoning belongs in docs/DECISIONS.md; how a thing works belongs in ' +
      'docs/ARCHITECTURE.md.\n\n' +
      'A comment that warns about a real trap EARNS its line - do not delete one to get under ' +
      'the number. Pay for a new warning by tightening comments elsewhere.\n\n' +
      'Most comment lines right now:\n' + worst + '\n\n' +
      'If code was deliberately DELETED, the ratio rose with nothing written: raise "maxPct" ' +
      'to ' + pct.toFixed(2) + ' in .claude/hooks/comments-baseline.json and say in the ' +
      'handover that you did.\n'
  );
  process.exit(2);
}

try {
  main();
} catch {
  process.exit(0);
}
