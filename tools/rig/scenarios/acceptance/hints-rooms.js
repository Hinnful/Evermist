'use strict';

// hints-rooms.js — THE ROOMS HINT: a callout toast over the Shape button says rooms reveal one at a time.
// Covers src/ui/hints.js and its callers (toolbar.js revealAllMap, toolBrush.js, shapeCommit.js).
//
//   A. With Auto sync off, Reveal all on an open map shows the toast over the Shape button, records it as
//      seen, and the Shape button carries the blink class.
//   B. Got it closes it, and the blink stops.
//   C. A second trigger in the same run shows nothing, even with the seen record cleared.
//   D. With Hints off and the run's state reset, nothing shows.

const lib = require('../../lib');

const MAP_W = 2400, MAP_H = 1500;
const SHOWN = '!!document.querySelector(".hintcall-rooms")';

module.exports = async function hintsRooms(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');

  await dm.evaluate('autoSync = false; placeMode = "rooms"; setShape("select");' +
    ' localStorage.removeItem("evermist.hintsSeen"); localStorage.removeItem("evermist.hintsOff"); 0');
  await lib.settle(dm, '!viewportDirty && !cursorDirty', 8000);
  rig.check(!(await dm.evaluate(SHOWN)), 'a hint is up before Reveal all, so the checks below prove nothing');

  // A. RED ON: _hintPlaceRooms anchored to btn-rect, which is never shown (hints.js) - 2026-10-18
  await dm.evaluate('document.getElementById("tb-reveal-all").click(); 0');
  await lib.settle(dm, SHOWN, 8000);
  const shown = await dm.evaluate('(() => { const h = document.querySelector(".hintcall-rooms"), b = document.getElementById("btn-shape");' +
    ' if (!h) return null; const r = h.getBoundingClientRect(), a = b.getBoundingClientRect();' +
    ' return { text: h.textContent, above: r.bottom <= a.top, dx: Math.abs((r.left + r.width / 2) - (a.left + a.width / 2)),' +
    ' seen: localStorage.getItem("evermist.hintsSeen"), blink: b.classList.contains("hintcall-blink") }; })()');
  rig.check(shown && /Show one room at a time/.test(shown.text), 'Reveal all showed no rooms toast: ' + JSON.stringify(shown));
  rig.check(shown && shown.above && shown.dx < 3, 'the rooms toast is not just above the Shape button, centred on it: ' + JSON.stringify(shown));
  rig.check(shown && shown.seen === '["rooms"]', 'the rooms toast was not recorded as seen when it showed: ' + JSON.stringify(shown));
  rig.check(shown && shown.blink, 'the Shape button does not blink while the rooms toast is up: ' + JSON.stringify(shown));

  // B. RED ON: Got it's onclick emptied (hints.js) - 2026-10-18
  await dm.evaluate('document.querySelector(".hintcall-ok").click(); 0');
  await lib.settle(dm, '!' + SHOWN, 8000);
  rig.check(!(await dm.evaluate(SHOWN)), 'Got it did not close the rooms toast');
  rig.check(!(await dm.evaluate('document.getElementById("btn-shape").classList.contains("hintcall-blink")')),
    'the Shape button kept blinking after Got it');

  // C. RED ON: _hintShow setting _hintRun = false (hints.js) - 2026-10-18
  await dm.evaluate('localStorage.removeItem("evermist.hintsSeen");' +
    ' document.getElementById("tb-hide-all").click(); document.getElementById("tb-reveal-all").click(); 0');
  await lib.hold(1000, 'a second toast, if one were going to show, would be up by now');
  rig.check(!(await dm.evaluate(SHOWN)), 'a second trigger in the same run showed the toast again');

  // D. RED ON: _hintsMayShow ignoring _hintsOff() (hints.js) - 2026-10-18
  await dm.evaluate('_hintRun = false; localStorage.removeItem("evermist.hintsSeen"); localStorage.setItem("evermist.hintsOff", "1");' +
    ' document.getElementById("tb-hide-all").click(); document.getElementById("tb-reveal-all").click(); 0');
  await lib.hold(1000, 'a toast, if Hints off let one show, would be up by now');
  rig.check(!(await dm.evaluate(SHOWN)), 'Reveal all showed the toast with Hints switched off');
  await dm.evaluate('localStorage.removeItem("evermist.hintsOff"); 0');
};
