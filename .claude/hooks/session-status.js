#!/usr/bin/env node
'use strict';

/*
 * Session-start status - names any work that sits outside main's history, so nothing is
 * forgotten between sessions: uncommitted edits, local branches, worktrees, stashes, and
 * commits on main that origin has not landed. Silent when everything is clean.
 *
 * SessionStart; stdout reaches the model as context. Fail-open on any internal error.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./guard-lib');

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const lines = (s) => s.split('\n').filter(Boolean);

function main() {
  // Tracked from before it was ignored; every npm test rewrites it, so it would read dirty forever.
  git(['update-index', '--skip-worktree', 'src/ui/changelogData.js']);

  const found = [];
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') found.push('This checkout is on ' + branch + ', not main.');

  const dirty = lines(git(['status', '--porcelain']));
  if (dirty.length) found.push('Uncommitted: ' + dirty.map((l) => l.replace(/^\s*\S+\s+/, '')).join(', '));

  for (const b of lines(git(['branch', '--format=%(refname:short)'])).filter((b) => b !== 'main')) {
    const ahead = git(['rev-list', '--count', 'main..' + b]);
    found.push('Local branch ' + b + ' holds ' + ahead + ' commit(s) main lacks.');
  }

  const trees = lines(git(['worktree', 'list', '--porcelain'])).filter((l) => l.startsWith('worktree '));
  if (trees.length > 1) found.push('Extra worktrees: ' + trees.slice(1).map((l) => l.slice(9)).join(', '));

  const stashes = lines(git(['stash', 'list']));
  if (stashes.length) found.push(stashes.length + ' stash(es): ' + stashes.join('; '));

  let unlanded = '0';
  try { unlanded = git(['rev-list', '--count', 'origin/main..main']); } catch { /* no origin yet */ }
  if (unlanded !== '0') found.push('main holds ' + unlanded + ' commit(s) origin/main has not landed.');

  // A run folder still holding notes.txt is a release that stopped before its push finished.
  const runs = path.join(ROOT, '.claude', 'commit', 'runs');
  for (const id of fs.existsSync(runs) ? fs.readdirSync(runs) : []) {
    if (fs.existsSync(path.join(runs, id, 'notes.txt'))) found.push('A /commit run stopped with its notes unpushed (runs/' + id + '/notes.txt). Run /commit to resume; a yes never carries across sessions.');
    try {
      const text = fs.readFileSync(path.join(runs, id, 'disclosure.txt'), 'utf8').trim();
      if (text) found.push('A test was edited to turn a run green (runs/' + id + '/disclosure.txt); tell the DM in the release report: ' + text.split(/\r?\n/).join(' / '));
    } catch { /* none */ }
  }

  if (!found.length) return;
  process.stdout.write(
    'WORK OUTSIDE MAIN - all work lives on main and goes out through /commit. Tell the DM about each\n' +
      'item below in your first reply, one line each, and ask what to do with it:\n- ' +
      found.join('\n- ') + '\n'
  );
}

try {
  main();
} catch {
  process.exit(0);
}
