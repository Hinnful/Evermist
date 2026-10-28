'use strict';

// hints-next-map.js — THE NEXT-MAP HINT: after one map has been on the TV for ten minutes with other maps in the
// library and the world map unopened, a toast beside the dock points at the world map button. Covers
// src/ui/hintsFirstMap.js (_hnmTick, hintsScreenChanged) and hints.js (_hintPlaceBeside). The ten minutes are the bare
// global _hintNextMapMs, shortened here.
//
//   A. With the TV live and two maps in the library, the toast shows after the timer, left of the rail button with its
//      arrow on the world map button, which blinks.
//   A2. It stays inside the window, though the world map button sits at its very top.
//   B. It does not show with only one map in the library.
//   C. Opening the world map restarts the count, so nothing shows at the old deadline.
//   D. Opening the world map closes a toast that is up.

const lib = require('../../lib');

const UP = '!!document.querySelector(".hintcall-next-map")';
const SEEN = JSON.stringify(JSON.stringify(['reveal', 'rooms', 'room-edit', 'repair-keys', 'seat']));

module.exports = async function hintsNextMap(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: 1800, h: 1200 });
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');
  await dm.evaluate('localStorage.setItem("evermist.hintsSeen", ' + SEEN + '); hintClose(); _hintNextMapMs = 3000; 0');
  await rig.player();
  await lib.settle(dm, '_tvLive()', 15000);

  // B. RED ON: _hnmTick's allScenes.length < 2 guard removed (hintsFirstMap.js)
  await lib.hold(5500, 'the timer, if one map were enough, would have run out by now');
  rig.check(!(await dm.evaluate(UP)), 'the next-map toast showed with only one map in the library');

  // A. RED ON: _hnmTick's _hintShow removed (hintsFirstMap.js)
  // The button blinks for about 2s after the toast shows, so the toast must not fall due while the cover is still lifting:
  // park the deadline, and start the count only once the scene is up.
  await dm.evaluate('_hintNextMapMs = 1e9; 0');
  await lib.openMap(rig, { w: 1800, h: 1200 });
  await dm.waitFor('fogCoverT === 0', 30000, 'the second scene cover to lift');
  await dm.evaluate('_hnmHeld = 0; _hintNextMapMs = 3000; 0');
  await lib.settle(dm, UP, 15000);
  const shown = await dm.evaluate('(() => { const h = document.querySelector(".hintcall-next-map"), b = document.getElementById("btn-world");' +
    ' if (!h) return null; const r = h.getBoundingClientRect(), a = b.getBoundingClientRect();' +
    ' const tip = { x: r.right + 6, y: r.top + parseFloat(h.style.getPropertyValue("--a")) * r.height / h.offsetHeight };' +
    ' return { text: h.textContent, left: r.right <= a.left, inWindow: r.top >= 0 && r.bottom <= innerHeight, tipAway: Math.hypot(Math.max(a.left - tip.x, 0, tip.x - a.right), Math.max(a.top - tip.y, 0, tip.y - a.bottom)),' +
    ' blink: b.classList.contains("hintcall-blink"), seen: localStorage.getItem("evermist.hintsSeen") }; })()');
  rig.check(shown && /Ready for the next map\?/.test(shown.text) && /Press M or click here/.test(shown.text), 'no next-map toast after the timer: ' + JSON.stringify(shown));
  rig.check(shown && shown.left && shown.tipAway <= 24, 'the next-map toast is not left of the world map button with its arrow on the world map button: ' + JSON.stringify(shown));
  // A2. RED ON: _hintPlaceBeside centring on the button with no clamp to the window (hints.js)
  rig.check(shown && shown.inWindow, 'the next-map toast runs off the top or bottom of the window: ' + JSON.stringify(shown));
  rig.check(shown && shown.blink && /next-map/.test(shown.seen), 'the world map button does not blink, or the toast was not recorded: ' + JSON.stringify(shown));

  // D. RED ON: _hnmTick's hintClose('next-map') removed from its reset branch (hintsFirstMap.js)
  await dm.evaluate('worldMapShow(); 0');
  await lib.settle(dm, '!' + UP, 8000);
  rig.check(!(await dm.evaluate(UP)), 'opening the world map left the next-map toast up');
  await dm.evaluate('worldMapHide(); 0');

  // C. RED ON: _hnmTick's reset of _hnmHeld removed from its reset branch (hintsFirstMap.js)
  await dm.evaluate('localStorage.setItem("evermist.hintsSeen", ' + SEEN + '); _hintNextMapMs = 6000; 0');
  await dm.evaluate('worldMapShow(); 0');
  await lib.hold(1500, 'a tick has seen the world map open, so the count starts from zero');
  await dm.evaluate('worldMapHide(); 0');
  await lib.hold(4000, 'the count runs towards its deadline');
  await dm.evaluate('worldMapShow(); 0');
  await lib.hold(1500, 'a tick has seen the world map open');
  await dm.evaluate('localStorage.setItem("evermist.hintsSeen", ' + SEEN + '); worldMapHide(); 0');   // an earlier show must not hide a wrong one now
  await lib.hold(3500, 'the old deadline has passed; a restarted count has not reached its own');
  rig.check(!(await dm.evaluate(UP)), 'opening the world map did not restart the count: the toast showed at the old deadline');
};
