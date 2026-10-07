#!/usr/bin/env node
'use strict';

/*
 * Runs the ratchet guards over the whole tree, the way CI sees it.
 *
 * The hooks in .claude/hooks/ only fire when a Claude session edits a file through its editor, so
 * an edit made any other way never meets them. This feeds each ratchet the file it watches and
 * fails if any of them blocks. Every other house rule is a test in test/houseRules.test.js.
 *
 *   node tools/check-guards.js
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const lib = require('../.claude/hooks/guard-lib.js');

const HOOKS = path.join(lib.ROOT, '.claude', 'hooks');

const CHECKS = [
  { hook: 'guard-blob.js', what: 'the inline script in index.html', files: ['index.html'] },
  { hook: 'guard-claudemd.js', what: 'the size and shape of CLAUDE.md', files: ['CLAUDE.md'] },
];

let failed = 0;
for (const c of CHECKS) {
  const blocked = [];
  for (const rel of c.files) {
    if (!fs.existsSync(path.join(lib.ROOT, rel))) continue;
    const run = spawnSync(process.execPath, [path.join(HOOKS, c.hook)], {
      cwd: lib.ROOT,
      input: JSON.stringify({ tool_input: { file_path: path.join(lib.ROOT, rel) } }),
      encoding: 'utf8',
    });
    if (run.status === 2) blocked.push(run.stderr.trim());
  }
  if (blocked.length === 0) {
    console.log('PASS  ' + c.what);
  } else {
    failed++;
    console.log('FAIL  ' + c.what + '\n\n' + blocked.join('\n\n') + '\n');
  }
}

if (failed) {
  console.log('\n' + failed + ' of ' + CHECKS.length + ' guards blocked. Each message above says how to fix it.');
  process.exit(1);
}
console.log('\nAll ' + CHECKS.length + ' guards pass.');
