'use strict';

// soak-summary.js — which scenarios failed across several runs of the same build.
// `node tools/rig/soak-summary.js run-1.txt run-2.txt …`, each file one rig run's console output.
// A scenario that fails in some runs and passes in others is flaky; one that fails in all is broken.

const fs = require('fs');

const files = process.argv.slice(2);
const seen = new Map();

for (const file of files) {
  let scenario = '(before the first scenario)';
  const failedHere = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const head = line.match(/── (\S+)/);
    if (head) { scenario = head[1]; continue; }
    const fail = line.match(/^\s+(FAILED|CONSOLE ERROR): (.*)/);
    if (fail && !failedHere.has(scenario)) failedHere.set(scenario, fail[2].slice(0, 200));
  }
  for (const [name, why] of failedHere) {
    if (!seen.has(name)) seen.set(name, []);
    seen.get(name).push(file + ': ' + why);
  }
}

console.log(files.length + ' runs of one build.');
if (!seen.size) { console.log('Every scenario passed in every run.'); process.exit(0); }
for (const [name, whys] of [...seen].sort((a, b) => b[1].length - a[1].length)) {
  const kind = whys.length === files.length ? 'BROKEN' : 'FLAKY';
  console.log('\n' + kind + ' ' + name + ' failed ' + whys.length + ' of ' + files.length);
  for (const w of whys) console.log('  ' + w);
}
