#!/usr/bin/env node
'use strict';

/*
 * Ship guard - publishing goes through /commit and nowhere else. Refuses a push, a merge of the
 * pull request, a new tag and a release edit typed into a shell.
 *
 * WHY A HOOK: ship.js pushes from inside node, which no hook sees, so every `git push` a model types
 * is by definition a way around the yes-check, the backlog check and the branch rules. The same
 * goes for tags and releases, which the release workflow alone creates.
 * /rollback runs through tools/rollback.js for the same reason.
 *
 * PreToolUse; exit 2 is the only channel that reaches the model. Fail-open on any internal error.
 */

const { readStdin, commandsIn } = require('./guard-lib');

const GH = /^gh\s+(?:(?:-R|--repo)\s+\S+\s+)?/;
// `git -C dir push` and `git -c k=v push` are still a push.
const GIT = /^git\s+(?:(?:-C|-c|--git-dir|--work-tree)\s+\S+\s+)*/;

const LIST_FLAGS = /^(?:-l|--list|-d|--delete|-v|--verify|--contains|--no-contains|--points-at|--merged|--no-merged|-n\d*|--sort(?:=.*)?|--format(?:=.*)?)$/;

// `git tag` lists, deletes and verifies freely; a name, or -a/-s/-f/-m/-u, makes a tag.
function makesTag(argv) {
  if (argv.some((a) => LIST_FLAGS.test(a))) return false;
  return argv.some((a) => !a.startsWith('-') || /^-[asfmu]/.test(a) || /^--(?:annotate|sign|force|message|local-user)/.test(a));
}

// What a single shell segment is refused for, or null.
function refusal(seg) {
  const git = seg.match(GIT);
  if (git) {
    const rest = seg.slice(git[0].length);
    if (/^push\b/.test(rest)) return 'a git push';
    const tag = rest.match(/^tag\b\s*(.*)$/);
    if (tag && makesTag(tag[1].split(/\s+/).filter(Boolean))) return 'a new tag';
  }
  const gh = seg.match(GH);
  if (gh) {
    const rest = seg.slice(gh[0].length);
    if (/^pr\s+merge\b/.test(rest)) return 'a pull request merge';
    if (/^release\s+(?:create|edit|upload)\b/.test(rest)) return 'a release edit';
  }
  return null;
}

function verdict(p) {
  const command = p && p.tool_input && p.tool_input.command;
  if (typeof command !== 'string') return null;
  for (const seg of commandsIn(command)) {
    const what = seg && refusal(seg);
    if (what) return what;
  }
  return null;
}

function main() {
  const what = verdict(readStdin());
  if (!what) process.exit(0);
  process.stderr.write(
    'SHIP GUARD - refused: ' + what + '.\n\n' +
      'Nothing is pushed, merged, tagged or released by hand. /commit does it: `node .claude/commit/ship.js`\n' +
      'pushes a release/** or change/** branch and opens the pull request, and the release workflow lands\n' +
      'main, tags and publishes once the gate is green. To pull a release back use /rollback, which runs\n' +
      'tools/rollback.js. If a push is truly needed outside both, say so and let the DM decide.\n'
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

module.exports = { verdict, makesTag };
