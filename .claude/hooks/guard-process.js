#!/usr/bin/env node
'use strict';

/*
 * docs/PROCESS.md guard - a fix request on shape.
 *
 * The file is public and describes the process in the present tense. A pronoun for a person or a
 * dated story means a chat log or a history is leaking in; the DM is "the DM", and history goes
 * to the process ledger. Blocks with exit 2 so the fix lands in the same turn. Fail-open.
 */

const fs = require('fs');
const path = require('path');
const lib = require('./guard-lib.js');

const TARGET = path.join(lib.ROOT, 'docs', 'PROCESS.md');

function main() {
  const payload = lib.readStdin();
  const fp = payload && payload.tool_input && payload.tool_input.file_path;
  if (fp && lib.toRel(fp) !== 'docs/PROCESS.md') process.exit(0);

  let text;
  try {
    text = fs.readFileSync(TARGET, 'utf8');
  } catch {
    process.exit(0);
  }

  const hits = lib.findPersonRefsInText(text).map((h) => '  - line ' + h.line + ' (a person): ' + h.text)
    .concat(lib.findNarrative(text, []).map((h) => '  - line ' + h.line + ' ("' + h.marker + '"): ' + h.text));
  if (!hits.length) process.exit(0);

  process.stderr.write(
    'PROCESS.md SHAPE GUARD - fix this in the current turn.\n\n' + hits.join('\n') + '\n\n' +
    'This file is public and says how the process runs now. Call the person "the DM" and state ' +
    'the step, not who said it. A dated story or a "was tried" belongs in ' +
    '.claude/private/project-process.md.\n'
  );
  process.exit(2);
}

try {
  main();
} catch {
  process.exit(0);
}
