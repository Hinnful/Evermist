#!/usr/bin/env node
'use strict';

/*
 * Session-start status - names any work that has not landed on origin/main, so nothing is
 * forgotten between sessions: uncommitted edits, branches and worktrees holding commits
 * origin/main lacks, stashes, and unpushed run folders. Silent when everything is clean.
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
  // CI's land job moves origin's main after /commit pushes, so the local origin/main is stale until a fetch.
  let fetched = true;
  try {
    execFileSync('git', ['fetch', '--quiet', 'origin', 'main'], {
      cwd: ROOT, stdio: 'ignore', timeout: 10000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  } catch { fetched = false; }
  const stale = fetched ? '' : ' (could not fetch origin; the count may be stale)';

  const dirty = lines(git(['status', '--porcelain']));
  if (dirty.length) found.push('Uncommitted: ' + dirty.map((l) => l.replace(/^\s*\S+\s+/, '')).join(', '));

  // A branch whose commits all landed is spent, not work; main with one unlanded commit is a release in CI.
  for (const b of lines(git(['branch', '--format=%(refname:short)']))) {
    let ahead = '0';
    try { ahead = git(['rev-list', '--count', 'origin/main..' + b]); } catch { /* no origin yet */ }
    if (ahead !== '0') found.push('Branch ' + b + ' holds ' + ahead + ' commit(s) origin/main lacks' + stale + '.');
  }

  const trees = lines(git(['worktree', 'list', '--porcelain'])).filter((l) => l.startsWith('worktree '));
  for (const t of trees.slice(1).map((l) => l.slice(9))) {
    let dirty = [];
    try { dirty = lines(execFileSync('git', ['-C', t, 'status', '--porcelain'], { encoding: 'utf8' })); } catch { /* gone */ }
    if (dirty.length) found.push('Worktree ' + t + ' has ' + dirty.length + ' uncommitted edit(s).');
  }

  const stashes = lines(git(['stash', 'list']));
  if (stashes.length) found.push(stashes.length + ' stash(es): ' + stashes.join('; '));


  // A run folder still holding notes.txt is a release that stopped before its push finished.
  const runs = path.join(require('../commit/runRoot').runRoot(ROOT) || ROOT, '.claude', 'commit', 'runs');
  for (const id of fs.existsSync(runs) ? fs.readdirSync(runs) : []) {
    // A locked notes.txt can outlive a finished push; pushed.json newer than it says the release went out.
    const mtime = (f) => { try { return fs.statSync(path.join(runs, id, f)).mtimeMs; } catch { return 0; } };
    if (mtime('notes.txt') && mtime('pushed.json') <= mtime('notes.txt')) found.push('A /commit run stopped with its notes unpushed (runs/' + id + '/notes.txt). Run /commit to resume; a yes never carries across sessions.');
    try {
      const text = fs.readFileSync(path.join(runs, id, 'disclosure.txt'), 'utf8').trim();
      if (text) found.push('A test was edited to turn a run green (runs/' + id + '/disclosure.txt); tell the DM in the release report: ' + text.split(/\r?\n/).join(' / '));
    } catch { /* none */ }
  }

  if (!found.length) return;
  process.stdout.write(
    'UNLANDED WORK - every edit goes out through /commit, from main or a branch. Tell the DM about\n' +
      'each item below in your first reply, one line each, and ask what to do with any no session is working on:\n- ' +
      found.join('\n- ') + '\n'
  );
}

try {
  main();
} catch {
  process.exit(0);
}
