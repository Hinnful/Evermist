'use strict';

// first-use-launch.js — SCREENS.LOG: what the main process read of the screens in its first seconds.
// Covers electron/screenLog.js (and its registration in main.js). Item 214 of the first-use-cues spec.
//
//   A. screens.log sits in the logs folder after launch, and under --offscreen it still logs.
//   B. Its first line carries a timestamp, the screen count, the screen the DM window is on, which
//      screen the app would take as the TV, and for each screen its id, bounds, scale factor and
//      internal flag.
//   C. A line after the first is a change: no two neighbouring lines say the same thing.
//   D. Nothing on screen changes: no hint came up because of it.
//
// ⚠ THE RIG'S MACHINE HAS WHATEVER SCREENS IT HAS, so the checks read the file's shape, never a count.

const fs = require('fs');
const path = require('path');

const lib = require('../../lib');

module.exports = async function firstUseLaunch(rig) {
  const dm = rig.dm;
  const file = path.join(rig.profileDir, 'logs', 'screens.log');

  // A. RED BY DESIGN: written against the feature, never re-proved
  const got = await lib.poll(() => (fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim() ? { text: fs.readFileSync(file, 'utf8') } : null), 15000);
  rig.check(!!got, 'no screens.log with a line in it came up in the logs folder at launch');
  const lines = got ? got.text.trim().split('\n') : [];

  // B. RED BY DESIGN: written against the feature, never re-proved
  const first = lines[0] || '';
  rig.check(/^\d{4}-\d\d-\d\dT[\d:.]+Z screens=\d+ \| dm=-?\d+ \| tv=(\d+|ask\([\d,]+\)|none)/.test(first),
            'the first line does not give a timestamp, the screen count, the DM screen and the TV: ' + first);
  rig.check(/ \| id=-?\d+ bounds=-?\d+,-?\d+,\d+x\d+ scale=[\d.]+ internal=(true|false)/.test(first),
            'the first line does not give each screen\'s id, bounds, scale factor and internal flag: ' + first);

  // C. RED BY DESIGN: written against the feature, never re-proved
  const body = l => l.replace(/^\S+ /, '');
  rig.check(lines.every((l, i) => !i || body(l) !== body(lines[i - 1])),
            'two neighbouring lines of screens.log say the same thing, so an unchanged read was written: ' + JSON.stringify(lines));

  // D. RED BY DESIGN: written against the feature, never re-proved
  rig.check(await dm.evaluate('!document.querySelector(".hintcall")'),
            'launching with the screen log put a hint on screen');
  rig.byEye('screens.log on a machine with a TV plugged in names the TV\'s screen and its scale factor');
};
