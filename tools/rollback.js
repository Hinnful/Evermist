#!/usr/bin/env node
'use strict';

/*
 * /rollback's three deletions, in the order that cannot strand anyone: the release, its remote tag,
 * then the local tag. It runs here and not in the shell so guard-ship.js can refuse every hand-typed
 * push and tag while this one path stays open.
 *
 *   node tools/rollback.js v<X.Y.Z>
 */

const { execFileSync } = require('child_process');

const tag = process.argv[2] || '';
if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
  console.error('usage: node tools/rollback.js v<X.Y.Z>');
  process.exit(2);
}
const run = (cmd, args) => { console.log('> ' + cmd + ' ' + args.join(' ')); execFileSync(cmd, args, { stdio: 'inherit' }); };

run('gh', ['release', 'delete', tag, '--yes']);
run('git', ['push', 'origin', ':refs/tags/' + tag]);
try { run('git', ['tag', '-d', tag]); } catch { console.log('no local tag ' + tag + ' to delete'); }
