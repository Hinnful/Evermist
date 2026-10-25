#!/usr/bin/env node
'use strict';

/*
 * Rig guard - while building on the DM's machine, the rig takes a LOOK: one scenario, or one
 * `--shot` screenshot. A set (bare `npm run rig` is smoke, `regression`, or several names) is
 * refused, because a set on every small change turned a button-colour edit into an hour.
 *
 * Allowed in full: the run `/commit` prints (`rig-ci.js pick`, marked by `--low-priority`), and any
 * run in a cloud session, where no screen or hour belongs to the DM.
 *
 * PreToolUse on Bash and PowerShell; exit 2 is the only channel that reaches the model.
 * Fail-open on any internal error.
 */

const { readStdin, commandsIn } = require('./guard-lib');

const RIG_RUN = /^(?:(?:npm|yarn|pnpm)\s+run\s+rig|node\s+tools[\\/]rig[\\/]run\.js)\b(.*)$/s;
const TAKES_VALUE = new Set(['--exe', '--out', '--shot', '--shot-setup', '--dm-size', '--player-size', '--report']);

function tokens(text) {
  return (text.match(/"[^"]*"|'[^']*'|\S+/g) || []).filter((t) => t !== '--');
}

// Null when the run is a look; otherwise what makes it a set.
function setIn(rest) {
  const toks = tokens(rest);
  if (toks.includes('--low-priority')) return null;
  const names = [];
  for (let i = 0; i < toks.length; i++) {
    // A redirection is not a name: `2>&1`, `>out.txt`, or a bare `>` before its file.
    if (/^\d*[<>]/.test(toks[i])) { if (/^\d*[<>]+&?$/.test(toks[i])) i++; continue; }
    if (TAKES_VALUE.has(toks[i])) i++;
    else if (!toks[i].startsWith('--')) names.push(toks[i]);
  }
  if (names.some((n) => n === 'regression' || n === 'smoke')) return names.join(' ');
  if (names.length > 1) return names.length + ' scenarios';
  if (!names.length && !toks.includes('--shot')) return 'smoke (a bare run)';
  return null;
}

function main() {
  if (process.env.CLAUDE_CODE_REMOTE === 'true') process.exit(0);
  const p = readStdin();
  const cmd = p && p.tool_input && p.tool_input.command;
  if (typeof cmd !== 'string') process.exit(0);
  let what = null;
  for (const seg of commandsIn(cmd)) {
    const m = seg && seg.match(RIG_RUN);
    if (m && (what = setIn(m[1]))) break;
  }
  if (!what) process.exit(0);
  process.stderr.write(
    'RIG GUARD - refused: ' + what + '.\n\n' +
      'While building, the rig takes a look, never a set: one scenario (`npm run rig -- <name>`) or\n' +
      'one screenshot (`npm run rig -- --shot "<selector>"`), and only when code cannot answer.\n' +
      'A set on every change turns a small edit into an hour. /commit runs the set the map picks, and\n' +
      'CI runs the rest. A scenario that breaks while building waits for /commit.\n'
  );
  process.exit(2);
}

try {
  main();
} catch {
  process.exit(0);
}
