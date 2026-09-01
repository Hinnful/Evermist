#!/usr/bin/env node
'use strict';

/*
 * Module size guard - a per-file ratchet on every .js at the top level of src/.
 *
 * WHY: guard-blob.js watches the inline script in index.html, and nothing watched a
 * module. The concern is a god-module, not a line count: a file that absorbs a second
 * and third concern gets edited by every task and reviewed by none. CLAUDE.md's
 * migrate-on-touch rule is the fix, and this is what makes someone reach for it.
 *
 * Existing size is out of scope. First sight of a file adopts whatever it measures as
 * that file's ceiling, silently, so seeding happens one file at a time as each is edited
 * and no module is ever shrunk to satisfy the guard.
 *
 * REPORTS, never blocks. PostToolUse runs after the edit has landed, so exit 2 is a
 * notice, not a veto.
 *
 * Fail-open by design - any internal error exits 0.
 */

const fs = require('fs');
const path = require('path');
const lib = require('./guard-lib.js');

const BASELINE = path.join(__dirname, 'module-size-baseline.json');

const NOTE =
  'Max bytes per module, keyed by repo-relative path. src/*.js only; src/css/ has its ' +
  'own rules. Auto-ratchets DOWN as a file shrinks, and a file absent here adopts its ' +
  'current size on first edit. Raise a number only when the growth is a deliberate ' +
  'choice against extracting the concern into its own module.';

// Top level of src/ only. src/css/ is the sole subdirectory and carries no JavaScript.
function isModule(rel) {
  return !!rel && /^src\/[^/]+\.js$/.test(rel);
}

function main() {
  const payload = lib.readStdin();
  const fp = payload && payload.tool_input && payload.tool_input.file_path;
  const rel = lib.toRel(fp);
  if (!isModule(rel)) process.exit(0);

  let text;
  try {
    text = fs.readFileSync(path.join(lib.ROOT, rel), 'utf8');
  } catch {
    process.exit(0); // deleted or renamed under us -> nothing to measure
  }
  // Line endings NORMALISED, for the reason spelled out in guard-claudemd.js: core.autocrlf
  // is on, so a fresh checkout adds one byte per line and every baseline recorded under LF
  // would fire on files nobody touched.
  const size = Buffer.byteLength(text.replace(/\r\n/g, '\n'));

  const prior = lib.readJson(BASELINE, null);
  // A baseline that EXISTS but will not parse is left alone. This map holds every module's
  // ceiling, so treating a bad file as absent would write one entry over all of them and
  // silently re-seed the rest. Raising a number by hand is the sanctioned escape hatch, and a
  // trailing comma is all it takes.
  if (prior == null && fs.existsSync(BASELINE)) process.exit(0);
  const files = prior && prior.files && typeof prior.files === 'object' ? prior.files : {};
  const baseline = typeof files[rel] === 'number' ? files[rel] : null;

  const save = (n) => {
    files[rel] = n;
    lib.writeJson(BASELINE, { note: NOTE, files });
  };

  if (baseline == null) {
    save(size); // first sight: adopt current as the ceiling
    process.exit(0);
  }
  if (size <= baseline) {
    if (size < baseline) save(size); // ratchet down
    process.exit(0);
  }

  process.stderr.write(
    'MODULE SIZE GUARD: ' + rel + ' grew from ' + lib.fmt(baseline) + ' to ' +
      lib.fmt(size) + ' bytes.\n' +
      'A module that keeps growing is on its way to owning several concerns at once, and ' +
      'then every task edits it and nobody reviews it.\n' +
      'Per CLAUDE.md migrate-on-touch: extract the concern you just touched into its own ' +
      '.js file under src/, register it in the module map and the load order, then build ' +
      'there.\n' +
      'GROWTH IS ALLOWED where the concern genuinely belongs in this file - do not contort ' +
      'code or delete a warning comment to get under the number. If extraction is wrong ' +
      'here, raise "' + rel + '" to ' + size + ' in ' +
      '.claude/hooks/module-size-baseline.json and say in the handover that you did.\n'
  );
  process.exit(2);
}

try {
  main();
} catch {
  process.exit(0);
}
