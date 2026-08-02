#!/usr/bin/env node
'use strict';

/*
 * CLAUDE.md size guard - the file may shrink, it may not grow.
 *
 * WHY: CLAUDE.md is the only doc guaranteed in every session's context, so its
 * size is a running tax on every task. It carried a "no narrative history here"
 * rule for months and grew to 38KB anyway, because appending a section is always
 * locally cheap and nobody owned the total. The blob guard held for the same
 * months on the same kind of rule. The difference was the hook.
 *
 * Measured in BYTES, not lines: the old file was 162 lines of giant paragraphs,
 * so a line count would have called it small.
 *
 * Fail-open by design - any internal error exits 0.
 */

const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, '..', '..', 'CLAUDE.md');
const BASELINE = path.join(__dirname, 'claudemd-baseline.json');

const NOTE =
  'Max bytes for CLAUDE.md. Auto-ratchets DOWN as the file shrinks. Raise only ' +
  'for a genuinely new RULE that cannot be stated in the space freed by ' +
  'tightening an existing one - explanation belongs in docs/ARCHITECTURE.md, ' +
  'reasoning in docs/DECISIONS.md.';

function readStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw && raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function readBaseline() {
  try {
    return JSON.parse(fs.readFileSync(BASELINE, 'utf8')).maxBytes;
  } catch {
    return null;
  }
}

function writeBaseline(n) {
  try {
    fs.writeFileSync(BASELINE, JSON.stringify({ maxBytes: n, note: NOTE }, null, 2) + '\n');
  } catch {
    /* fail-open */
  }
}

function main() {
  const payload = readStdin();
  const fp = payload && payload.tool_input && payload.tool_input.file_path;
  if (fp && path.basename(String(fp).replace(/\\/g, '/')) !== 'CLAUDE.md') {
    process.exit(0);
  }

  let size;
  try {
    size = fs.statSync(TARGET).size;
  } catch {
    process.exit(0); // no CLAUDE.md reachable -> nothing to guard
  }

  const baseline = readBaseline();

  if (baseline == null) {
    writeBaseline(size); // first run: adopt current as the ceiling
    process.exit(0);
  }
  if (size <= baseline) {
    if (size < baseline) writeBaseline(size); // ratchet down
    process.exit(0);
  }

  process.stderr.write(
    'CLAUDE.md GUARD: the file grew from ' + baseline + ' to ' + size + ' bytes.\n' +
      'CLAUDE.md is rules only, and it is in every session\'s context, so it may ' +
      'shrink but never grow. Move what you just added:\n' +
      '  - explanation of how something works -> docs/ARCHITECTURE.md\n' +
      '  - why a thing is shaped this way, what was tried, what was rejected -> docs/DECISIONS.md\n' +
      '  - dated fix logs and debugging narrative -> nowhere (the commit message has it)\n' +
      'If this genuinely is a NEW RULE, first try to fit it by tightening an ' +
      'existing one. Only if that fails, raise "maxBytes" to ' + size +
      ' in .claude/hooks/claudemd-baseline.json.\n'
  );
  process.exit(2);
}

main();
