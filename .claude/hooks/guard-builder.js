#!/usr/bin/env node
'use strict';

/*
 * Builder guard - a `builder` starts only from a brief with three written fields, and on Opus.
 *
 *   Cause:       for a fix, the confirmed cause and its evidence; for a feature, what the DM agreed.
 *   Change:      what to change.
 *   Done-check:  the test or scenario that proves it, failing before and passing after.
 *
 * Diagnosis stays in the main session: a builder handed a failing check to "fix" spent 80 minutes
 * on the wrong cause. A Sonnet builder is allowed only with a `Mechanical:` field saying why the
 * change needs no judgment.
 *
 * PreToolUse on Agent and Task; exit 2 is the only channel that reaches the model. Fail-open.
 */

const { readStdin } = require('./guard-lib');

const FIELDS = ['Cause', 'Change', 'Done-check'];
const LABELS = [...FIELDS, 'Mechanical'];
const MIN_CHARS = 20;

// The text after `Name:` up to the next field label. A label may carry markdown around it.
function field(prompt, name) {
  const label = (n) => new RegExp('^[\\s>#*-]*\\**' + n + '\\**\\s*:\\**', 'im');
  const m = prompt.match(label(name));
  if (!m) return '';
  const rest = prompt.slice(m.index + m[0].length);
  const ends = LABELS.filter((n) => n !== name)
    .map((n) => rest.search(label(n)))
    .filter((i) => i >= 0);
  return rest.slice(0, ends.length ? Math.min(...ends) : undefined).trim();
}

function verdict(p) {
  const name = p.tool_name || '';
  const input = p.tool_input || {};
  if ((name !== 'Agent' && name !== 'Task') || input.subagent_type !== 'builder') return null;
  const prompt = String(input.prompt || '');
  const missing = FIELDS.filter((f) => field(prompt, f).length < MIN_CHARS);
  if (missing.length) return 'a brief without ' + missing.map((f) => f + ':').join(', ');
  const model = input.model;
  if (!model || model === 'opus') return null;
  if (model === 'sonnet' && field(prompt, 'Mechanical').length >= MIN_CHARS) return null;
  return model === 'sonnet' ? 'a Sonnet builder without a Mechanical: field' : 'a builder on ' + model;
}

function main() {
  const what = verdict(readStdin());
  if (!what) process.exit(0);
  process.stderr.write(
    'BUILDER GUARD - refused: ' + what + '.\n\n' +
      'A builder brief carries three fields, each a sentence or more:\n' +
      '  Cause:      for a fix, the confirmed cause and its evidence; for a feature, what the DM agreed\n' +
      '  Change:     what to change\n' +
      '  Done-check: the test or scenario that fails before the change and passes after it\n' +
      'If the cause is not known yet, diagnose it here first; a builder does not diagnose.\n' +
      'The builder runs on Opus. Sonnet only with a Mechanical: field saying why the change needs no judgment.\n'
  );
  process.exit(2);
}

if (require.main === module) {
  try {
    main();
  } catch {
    process.exit(0);
  }
}

module.exports = { verdict, field };
