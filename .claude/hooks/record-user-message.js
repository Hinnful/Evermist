#!/usr/bin/env node
'use strict';

/*
 * Records when the DM last wrote, for ship.js's yes-check: notes shown to the DM only count as
 * approved by a message that arrives after they passed check-notes.js.
 *
 * UserPromptSubmit; fail-open on any internal error.
 */

const fs = require('fs');
const path = require('path');
const { readStdin, ROOT } = require('./guard-lib');
const { runDir, sessionIds, isFromDm } = require('../commit/shipRules');

function main() {
  const p = readStdin();
  if (!isFromDm(p.prompt)) return;
  const now = new Date().toISOString();
  for (const id of sessionIds(p, process.env)) {
    fs.mkdirSync(runDir(ROOT, id), { recursive: true });
    fs.writeFileSync(path.join(runDir(ROOT, id), 'last-user-message'), now + '\n');
  }
}

try {
  main();
} catch {
  process.exit(0);
}
