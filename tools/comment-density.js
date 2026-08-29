#!/usr/bin/env node
'use strict';

/*
 * Comment density report, and the safety check for a comment-only pass.
 *
 *   node tools/comment-density.js            report the codebase figure and per file
 *   node tools/comment-density.js --verify   diff pure code against HEAD, per file
 *
 * --verify strips comments and blank lines from both sides and compares what is left.
 * It exists because the test suite cannot see the failure mode: retyping a line while
 * regrouping comments once turned a literal non-breaking space inside a character class
 * into an ordinary space, and 375 green tests passed it.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const lib = require('../.claude/hooks/guard-lib.js');

function report() {
  const stats = lib.commentStats();
  const rows = stats.perFile.slice().sort((a, b) => b.comments - a.comments);
  for (const r of rows) {
    console.log(
      r.pct.toFixed(1).padStart(5) + '%  ' +
        String(r.comments).padStart(4) + ' comment  ' +
        String(r.code).padStart(4) + ' code   ' + r.file
    );
  }
  console.log(
    '\n' + lib.fmt(stats.comments) + ' comment lines / ' + lib.fmt(stats.comments + stats.code) +
      ' non-blank = ' + stats.pct.toFixed(2) + '%'
  );
  const base = lib.readJson(path.join(lib.ROOT, '.claude/hooks/comments-baseline.json'), null);
  if (base) console.log('guard ceiling: ' + base.maxPct + '%');
}

function verify() {
  let changed = 0;
  let differ = 0;

  for (const rel of lib.shippedJs()) {
    let head;
    try {
      head = execFileSync('git', ['show', 'HEAD:' + rel], {
        cwd: lib.ROOT,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch {
      console.log('NEW    ' + rel + ' (not in HEAD)');
      continue;
    }
    // Normalised: core.autocrlf hands the working tree CRLF while `git show` gives LF,
    // so a raw compare would report every file as changed.
    const now = fs.readFileSync(path.join(lib.ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
    if (head.replace(/\r\n/g, '\n') === now) continue;
    changed++;

    if (lib.pureCode(head) !== lib.pureCode(now)) {
      differ++;
      console.log('CODE   ' + rel + ' - the code itself changed, not only comments');
    }
  }

  console.log('\n' + changed + ' file(s) changed, ' + differ + ' with code differences');
  if (differ > 0) process.exitCode = 1;
}

if (process.argv.includes('--verify')) verify();
else report();
