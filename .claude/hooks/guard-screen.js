#!/usr/bin/env node
'use strict';

/*
 * Screen guard - refuses any command that would put an Evermist window on the DM's screen.
 *
 * WHY A HOOK AND NOT A RULE: the DM works on this machine while the app is being built, and a
 * window appearing in front takes their focus away from whatever they were doing. A line in
 * CLAUDE.md saying "don't run npm start" is exactly the shape of rule this repo has already
 * watched fail - the one with a hook held for months, the one without it did not.
 *
 * WHAT IS ALLOWED: `npm run rig`, which parks every window it opens off-screen before it can
 * appear (offscreen.ps1). That is the only sanctioned way to launch the app.
 *
 * WHAT IS REFUSED: `npm start`, `npm run stress`, `npm run memprobe`, a bare `electron .`, a
 * built .exe, and `npm run rig -- --visible`. Each of them takes the screen. They are the DM's
 * to run, and the DM runs them by hand.
 *
 * PreToolUse on Bash and PowerShell, so it stops the launch rather than reporting it afterwards.
 * Exit 2 is the only channel that reaches the model. Fail-open by design: any internal error
 * exits 0, because a broken guard must never wedge the session.
 */

// Every pattern is ANCHORED, because it is matched against one shell segment whose leading
// env assignments have already been stripped. An unanchored pattern refuses `echo "npm start"`
// and every doc edit that quotes one of these commands.
const REFUSE = [
  {
    // `npm start`, `npm run start`, and the same through yarn/pnpm.
    re: /^(?:npm|yarn|pnpm)\s+(?:run\s+)?start\b/,
    what: 'npm start',
    why: 'it opens the DM window in front of whatever the DM is doing',
  },
  {
    re: /^(?:npm|yarn|pnpm)\s+run\s+stress(?::[a-z-]+)?\b/,
    what: 'the stress run',
    why: 'it opens the app in front and then holds it there for the length of the run',
  },
  {
    re: /^(?:npm|yarn|pnpm)\s+run\s+memprobe(?::[a-z-]+)?\b/,
    what: 'the memprobe run',
    why: 'it opens the app in front and then holds it there for the length of the probe',
  },
  {
    re: /^(?:(?:npm|yarn|pnpm)\s+run\s+lab(?::[a-z-]+)?|node\s+tools[\\/]lab\.js)\b/,
    what: 'the lab',
    why: 'it opens the DM window in front, on the lab library',
  },
  {
    // A bare electron launch, however it is spelled. The rig's own `node run.js` is allowed
    // by RIG_RUN below, which is checked first.
    re: /^(?:npx\s+)?electron(?:\.exe)?\s+\./,
    what: 'a direct electron launch',
    why: 'nothing parks its window, so it lands in front',
  },
  {
    // Any built Evermist executable, including "Evermist Setup 2.4.0.exe" with its spaces.
    re: /^["'.\\/\w:-]*Evermist[^\n"']*\.exe\b/i,
    what: 'a built Evermist .exe',
    why: 'it opens in front, and the portable build writes into the real map library',
  },
];

// The rig with --visible is refused BEFORE the allow below, because that flag turns the
// parking off and is the DM's to use.
const RIG_VISIBLE = /^(?:(?:npm|yarn|pnpm)\s+run\s+rig|node\s+tools[\\/]rig[\\/]run\.js)\b[^\n]*--visible\b/;

// A rig run is the sanctioned launch and is allowed whatever else is on the line. It has to be
// checked before the refusals: `npm run rig -- --exe "…/Evermist.exe"` is a PARKED run of the
// built app, and the .exe rule above would otherwise refuse the one safe way to drive it.
const RIG_RUN = /^(?:(?:npm|yarn|pnpm)\s+run\s+rig|node\s+tools[\\/]rig[\\/]run\.js)\b/;

function readStdin() {
  try {
    const fs = require('fs');
    return JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (_) {
    return null;
  }
}

const { commandsIn } = require('./guard-lib');

function main() {
  const payload = readStdin();
  const cmd = payload && payload.tool_input && payload.tool_input.command;
  if (!cmd || typeof cmd !== 'string') process.exit(0);

  let hit = null;
  for (const seg of commandsIn(cmd)) {
    if (!seg) continue;
    if (RIG_VISIBLE.test(seg)) {
      hit = {
        what: 'the rig with its visible flag',
        why: 'that flag turns the off-screen parking off, which is the whole protection',
      };
      break;
    }
    if (RIG_RUN.test(seg)) continue; // the sanctioned launch; it parks itself
    const m = REFUSE.find((r) => r.re.test(seg));
    if (m) { hit = m; break; }
  }
  if (!hit) process.exit(0);

  process.stderr.write(
    'SCREEN GUARD - this command is refused, and the refusal is the point.\n\n' +
      'It runs ' + hit.what + ', which puts an Evermist window on the DM\'s screen: ' +
      hit.why + '.\nThe DM works on this machine while the app is being built, so a window ' +
      'appearing in front takes their focus away from what they were doing. They asked for ' +
      'this to stop happening.\n\n' +
      'WHAT TO DO INSTEAD:\n' +
      '  - to check behaviour, run the rig: `npm run rig` (smoke) or `npm run rig -- <name>`.\n' +
      '    It parks every window off-screen before it can appear.\n' +
      '  - to check a packaging bug, `npm run rig -- --exe "dist/win-unpacked/Evermist.exe"`,\n' +
      '    which is parked too. NEVER the portable dist/Evermist.exe - it writes into the real\n' +
      '    map library.\n' +
      '  - for anything the rig genuinely cannot answer, ASK THE DM to run it themselves and\n' +
      '    report back. Do not run it for them.\n\n' +
      'This guard is not a suggestion and there is no flag that turns it off. If a task really ' +
      'needs a visible window, say so and let the DM decide.\n'
  );
  process.exit(2);
}

try {
  main();
} catch {
  process.exit(0); // fail-open
}
