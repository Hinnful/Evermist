#!/usr/bin/env node
'use strict';

/*
 * CLAUDE.md guard - a ratchet on SIZE, a fix request on SHAPE.
 *
 * WHY: CLAUDE.md is the only doc guaranteed in every session's context, so its
 * size is a running tax on every task. It carried a "no narrative history here"
 * rule for months and grew to 38KB anyway, because appending a section is always
 * locally cheap and nobody owned the total. The blob guard held for the same
 * months on the same kind of rule. The difference was the hook.
 *
 * TWO RULES, and the second exists because the first cannot see it:
 *
 *  1. SIZE - bytes may ratchet down, never up. Measured in BYTES, not lines: the
 *     old file was 162 lines of giant paragraphs, so a line count would have
 *     called it small. Growth is ALLOWED but must be deliberate - raise maxBytes
 *     by hand, which the failure message says how to do.
 *  2. SHAPE - past-tense narrative in a file that is imperative present tense.
 *     The failure CLAUDE.md is famous for is history creeping in as a rule's
 *     justification, and the size ratchet passes that silently as long as some
 *     other section shrank by more. Every other guarded doc has both checks.
 *
 * Fail-open by design - any internal error exits 0.
 */

const fs = require('fs');
const path = require('path');
const lib = require('./guard-lib.js');

const TARGET = path.join(__dirname, '..', '..', 'CLAUDE.md');
const BASELINE = path.join(__dirname, 'claudemd-baseline.json');

// The one section that quotes the banned phrases in order to ban them. Without this
// the guard fires on the rule that created it. The doc-pointer preamble above the
// first "##" needs the same exemption and gets it inside findNarrative.
const SKIP_SECTIONS = ['Conventions'];

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

  let text;
  try {
    text = fs.readFileSync(TARGET, 'utf8');
  } catch {
    process.exit(0); // no CLAUDE.md reachable -> nothing to guard
  }
  // Measured with line endings NORMALISED, or the ratchet is unusable on this repo:
  // core.autocrlf is on, so a checkout hands the working tree CRLF and adds one byte per
  // line - 228 on a file whose whole ceiling is 12,585. A baseline recorded under LF would
  // then fire on every edit after a fresh clone, for a file nobody had touched.
  const size = Buffer.byteLength(text.replace(/\r\n/g, '\n'));

  const notices = [];

  // Rule 1 - size. Ratchets down on its own; growing it is a deliberate act.
  const baseline = readBaseline();
  if (baseline == null) {
    writeBaseline(size); // first run: adopt current as the ceiling
  } else if (size <= baseline) {
    if (size < baseline) writeBaseline(size); // ratchet down
  } else {
    notices.push(
      'CLAUDE.md SIZE GUARD: the file grew from ' + baseline + ' to ' + size + ' bytes.\n' +
        'CLAUDE.md is rules only, and it is in every session\'s context, so every byte ' +
        'is charged to every task. Move what you just added:\n' +
        '  - explanation of how something works -> docs/ARCHITECTURE.md\n' +
        '  - why a thing is shaped this way, what was tried, what was rejected -> docs/DECISIONS.md\n' +
        '  - dated fix logs and debugging narrative -> nowhere (the commit message has it)\n' +
        '  - a rule that binds to named files -> a skill in .claude/skills/\n' +
        'GROWTH IS ALLOWED, and a system that genuinely gained a rule is the case it is ' +
        'allowed for - do NOT contort a real rule into a worse sentence, and do NOT drop ' +
        'one, to get under the number. First try to fit it by tightening an existing rule ' +
        'or relocating one. If it still does not fit, raise "maxBytes" to ' + size +
        ' in .claude/hooks/claudemd-baseline.json and say in the handover that you did.\n'
    );
  }

  // Rule 2 - shape. Fixable in the turn that trips it, so it asks rather than schedules.
  const narrative = lib.findNarrative(text, SKIP_SECTIONS);
  if (narrative.length > 0) {
    notices.push(
      'CLAUDE.md SHAPE GUARD - fix this in the current turn.\n\n' +
        (narrative.length === 1 ? 'One line reads as history' : narrative.length + ' lines read as history') +
        ' rather than as a rule:\n' +
        narrative
          .slice(0, 6)
          .map((h) => '  - line ' + h.line + ' ("' + h.marker + '"): ' + h.text.slice(0, 90))
          .join('\n') +
        '\n\nThis file answers ONE question - what must I never do? - and it is written in ' +
        'imperative present tense, which is what proves it. A date stamp, "originally", ' +
        '"an earlier version", "was tried" or "was rejected" means the sentence is ' +
        'justifying a rule with its history, and that is the exact failure this file is ' +
        'famous for. The size ratchet cannot see it: narrative passes silently as long as ' +
        'some other section shrank by more.\n' +
        'Keep the rule and at most one clause of why. The story goes to docs/DECISIONS.md, ' +
        'and dated fix logs go nowhere - the commit message already has them.\n'
    );
  }

  if (notices.length === 0) process.exit(0);

  process.stderr.write(notices.join('\n'));
  process.exit(2);
}

main();
