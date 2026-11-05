#!/usr/bin/env node
'use strict';

/*
 * Rig guard - while building on the DM's machine, the rig takes a LOOK: one scenario, or one
 * `--shot` screenshot. A set (a bare `npm run rig`, `blockers`, `launch`, or several names) is
 * refused, because a set on every small change turned a button-colour edit into an hour.
 *
 * Allowed: `blockers` or `launch` at `--low-priority` (the DM may ask for the blocker set), and any
 * run in a cloud session, where no screen or hour belongs to the DM. `regression` and `smoke` no
 * longer exist, so they are refused whatever else is on the line.
 *
 * PreToolUse on Bash and PowerShell; exit 2 is the only channel that reaches the model.
 * Fail-open on any internal error.
 */

const { readStdin, commandsIn, launchForm } = require('./guard-lib');

const RIG_RUN = /^(?:(?:npm|yarn|pnpm)\s+run\s+rig|node\s+tools[\\/]rig[\\/]run\.js)\b(.*)$/s;
const TAKES_VALUE = new Set(['--exe', '--out', '--shot', '--shot-setup', '--dm-size', '--player-size']);
const SETS = new Set(['blockers', 'launch']);
const GONE = new Set(['regression', 'smoke']);

function tokens(text) {
  return (text.match(/"[^"]*"|'[^']*'|\S+/g) || []).filter((t) => t !== '--');
}

// Null when the run is a look; otherwise what makes it a set.
function setIn(rest) {
  const toks = tokens(rest);
  const names = [];
  for (let i = 0; i < toks.length; i++) {
    // A redirection is not a name: `2>&1`, `>out.txt`, or a bare `>` before its file.
    if (/^\d*[<>]/.test(toks[i])) { if (/^\d*[<>]+&?$/.test(toks[i])) i++; continue; }
    if (TAKES_VALUE.has(toks[i])) i++;
    else if (!toks[i].startsWith('--')) names.push(toks[i]);
  }
  if (names.some((n) => GONE.has(n))) return names.join(' ') + ' (retired sets)';
  if (toks.includes('--low-priority') && names.length === 1 && SETS.has(names[0])) return null;
  if (names.some((n) => SETS.has(n))) return names.join(' ') + ' (a set; add --low-priority)';
  if (names.length > 1) return names.length + ' scenarios';
  if (!names.length && !toks.includes('--shot')) return 'the blocker set (a bare run)';
  return null;
}

function verdict(p) {
  const cmd = p && p.tool_input && p.tool_input.command;
  if (typeof cmd !== 'string') return null;
  for (const seg of commandsIn(cmd)) {
    const m = seg && launchForm(seg).match(RIG_RUN);
    const what = m && setIn(m[1]);
    if (what) return what;
  }
  return null;
}

function main() {
  if (process.env.CLAUDE_CODE_REMOTE === 'true') process.exit(0);
  const what = verdict(readStdin());
  if (!what) process.exit(0);
  process.stderr.write(
    'RIG GUARD - refused: ' + what + '.\n\n' +
      'While building, the rig takes a look, never a set: one scenario (`npm run rig -- <name>`) or\n' +
      'one screenshot (`npm run rig -- --shot "<selector>"`), and only when code cannot answer.\n' +
      'A set on every change turns a small edit into an hour. CI runs the blocker set on every release;\n' +
      'the DM can ask for it here with `npm run rig -- blockers --low-priority --exe "<exe>"`.\n'
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
