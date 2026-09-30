#!/usr/bin/env node
'use strict';

/*
 * Runs the ratchet guards over the whole tree, the way CI sees it.
 *
 * The hooks in .claude/hooks/ only fire when a Claude session edits a file through its editor, so
 * an edit made any other way never meets them. This feeds each ratchet the file it watches and
 * fails if any of them blocks. The notice-only guards (skill hint, architecture, ledger, backlog,
 * scenario) are hints for a live session and stay out of this.
 *
 *   node tools/check-guards.js
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const lib = require('../.claude/hooks/guard-lib.js');

const HOOKS = path.join(lib.ROOT, '.claude', 'hooks');

function modules() {
  const out = lib.shippedJs().filter((rel) => /^(src\/(?:[^/]+\/)?[^/]+|electron\/[^/]+|main|preload)\.js$/.test(rel));
  return out.filter((rel) => !rel.startsWith('src/css/'));
}

const CHECKS = [
  { hook: 'guard-blob.js', what: 'the inline script in index.html', files: ['index.html'] },
  { hook: 'guard-claudemd.js', what: 'the size and shape of CLAUDE.md', files: ['CLAUDE.md'] },
  { hook: 'guard-process.js', what: 'the shape of docs/PROCESS.md', files: ['docs/PROCESS.md'] },
  { hook: 'guard-comments.js', what: 'the comment share of shipped JavaScript', files: ['main.js'] },
  { hook: 'guard-comment-echo.js', what: 'sentences repeated between files', files: ['main.js'] },
  { hook: 'guard-module-size.js', what: 'the size of each module', files: modules() },
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
