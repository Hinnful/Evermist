#!/usr/bin/env node
'use strict';

/*
 * Boot check for the shared global scope.
 *
 * The app loads every module as a classic <script>, so they share one script scope: a
 * top-level `let` declared in two files is a SyntaxError that blanks the whole app, and
 * nothing in `npm test` sees it because the modules are DOM-coupled.
 *
 * Concatenating the files in index.html's order and compiling the result reproduces that
 * scope exactly, so the browser's own error surfaces here instead of on the DM's screen.
 * Compile only - nothing runs, so no DOM is needed.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

// The load order that ships, read from the page rather than restated here.
function scriptsOf(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    const src = /\bsrc=["']([^"']+)["']/.exec(m[1]);
    if (src) out.push({ file: src[1], code: null });
    else out.push({ file: '<inline>', code: m[2] });
  }
  return out;
}

function check(entry) {
  const html = fs.readFileSync(path.join(root, entry), 'utf8');
  const parts = [];
  let line = 1;
  for (const s of scriptsOf(html)) {
    // Third-party bundles are minified and not ours to police.
    if (s.file.startsWith('lib/')) continue;
    const code = s.code !== null ? s.code : fs.readFileSync(path.join(root, s.file), 'utf8');
    parts.push({ file: s.file, start: line, code });
    line += code.split('\n').length;
  }

  // One file at a time, each compiled on top of the ones before it. V8 reports a duplicate
  // declaration with no usable line number, so the first prefix that fails names the file -
  // and it names the second declaration, which is the one someone just moved.
  let ok = '';
  for (const p of parts) {
    const next = ok + '\n' + p.code;
    try {
      new vm.Script(next, { filename: entry });
    } catch (err) {
      return `${entry}: ${err.message}\n  introduced by ${p.file}`;
    }
    ok = next;
  }
  return null;
}

const failures = ['index.html'].map(check).filter(Boolean);
if (failures.length) {
  console.error(failures.join('\n\n'));
  process.exit(1);
}
