#!/usr/bin/env node
'use strict';

/*
 * Stash guard - refuses a stash, which hides edits where neither the DM nor session-status.js
 * can see them. Branches and worktrees are allowed: session-status.js names every one that holds
 * unlanded work at session start.
 *
 * PreToolUse; exit 2 is the only channel that reaches the model. Fail-open on any internal error.
 */

const { readStdin, commandsIn } = require('./guard-lib');

// Anchored at the start of one shell segment, so text ABOUT a stash in a heredoc or an echo passes.
const GIT = /^git\s+(?:(?:-C|-c|--git-dir|--work-tree)\s+(?:"[^"]*"|'[^']*'|\S+)\s+)*/;
// A bare stash, or push/save, hides changes; list, show, pop, apply and drop do not.
const STASH = /^stash(?:\s*$|\s+(?:push|save|-[-\w]*)\b)/;

function verdict(p) {
  const command = p.tool_input && p.tool_input.command;
  if (typeof command !== 'string') return null;
  for (const seg of commandsIn(command)) {
    const git = seg && seg.match(GIT);
    if (git && STASH.test(seg.slice(git[0].length))) return 'a stash';
  }
  return null;
}

function main() {
  if (!verdict(readStdin())) process.exit(0);
  process.stderr.write(
    'STASH GUARD - refused: a stash.\n\n' +
      'A stash hides edits where nobody finds them again. Commit them, or put the work on a branch;\n' +
      'session-status.js names every branch and worktree that holds unlanded work.\n'
  );
  process.exit(2);
}

if (require.main === module) {
  try {
    main();
  } catch {
    process.exit(0);
  }
}

module.exports = { verdict };
