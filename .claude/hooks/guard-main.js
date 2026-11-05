#!/usr/bin/env node
'use strict';

/*
 * Main guard - all work happens in this checkout, on main. Refuses whatever would put work
 * somewhere the DM cannot see it from the desktop app: a worktree, a local branch, a stash,
 * a session in another checkout.
 *
 * WHY A HOOK AND NOT A RULE: work parked on a side branch or in a worktree was forgotten and
 * lost, and a line asking agents to stay on main is the shape of rule this repo has watched fail.
 *
 * A push to `release/**` or `change/**` by refspec is not a local branch and stays allowed;
 * `ship.js` makes it.
 *
 * PreToolUse; exit 2 is the only channel that reaches the model. Fail-open on any internal error.
 */

const { readStdin, commandsIn } = require('./guard-lib');

// Anchored at the start of one shell segment, like the screen guard, so text ABOUT these
// commands in a heredoc or an echo is not refused. Matched after the `git -C dir` prefix.
const GIT = /^git\s+(?:(?:-C|-c|--git-dir|--work-tree)\s+(?:"[^"]*"|'[^']*'|\S+)\s+)*/;
const REFUSE = [
  { re: /^(?:checkout|switch)\s+(?:[^\n]*\s)?(?:-b|-B|-c|-C|--create|--orphan)\b/, what: 'a new local branch' },
  { re: /^switch\s+(?!main\b|-\s*$)[^-\s]/, what: 'a switch away from main' },
  { re: /^branch\s+(?:--?(?:t|track|f|force|c|copy|C|m|move|M)\s+)*[^-\s]/, what: 'a new local branch' },
  { re: /^worktree\s+add\b/, what: 'a worktree' },
  // A bare stash, or push/save, hides changes; list, show, pop, apply and drop do not.
  { re: /^stash(?:\s*$|\s+(?:push|save|-[-\w]*)\b)/, what: 'a stash' },
];

// `git checkout <name>` cannot tell a branch from a file, so only `main` or paths after `--` pass.
function checksOutAway(rest) {
  const m = rest.match(/^checkout\b(.*)$/s);
  if (!m) return false;
  const argv = m[1].split(/\s+/).filter((a) => a && !/^\d*[<>]/.test(a));
  if (argv.includes('--')) return false;
  return argv.includes('--detach') || argv.some((a) => (a === '-' || !a.startsWith('-')) && a !== 'main');
}

function refusal(seg) {
  const git = seg.match(GIT);
  if (!git) return null;
  const rest = seg.slice(git[0].length);
  const m = REFUSE.find((r) => r.re.test(rest));
  if (m) return m.what;
  return checksOutAway(rest) ? 'a switch away from main (to restore files, name them after --)' : null;
}

function verdict(p) {
  const name = p.tool_name || '';
  const input = p.tool_input || {};
  if (name === 'EnterWorktree') return 'a worktree';
  if ((name === 'Agent' || name === 'Task') && input.isolation) return 'an agent in its own ' + input.isolation + ' copy';
  if (/start_session$/.test(name)) {
    if (input.target === 'cloud') return 'a cloud session, which works on its own branch';
    if (input.use_worktree !== false && !input.cwd && !input.host) return 'a session in its own worktree (pass use_worktree: false)';
  }
  if (typeof input.command === 'string') {
    for (const seg of commandsIn(input.command)) {
      const what = seg && refusal(seg);
      if (what) return what;
    }
  }
  return null;
}

function main() {
  const what = verdict(readStdin());
  if (!what) process.exit(0);
  process.stderr.write(
    'MAIN GUARD - refused: ' + what + '.\n\n' +
      'All work in this repo happens in this checkout, on main, and every change goes out through\n' +
      '/commit. Work on a side branch, in a worktree or in a stash is invisible to the DM and gets\n' +
      'lost. Do the work here; an agent edits this checkout directly, one writer at a time.\n' +
      'If the task truly needs a separate copy, say so and let the DM decide.\n'
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
