'use strict';

// hints-seat.js — THE SEAT ALIGNMENT HINT: the first time Settings opens, a callout toast beside the dock points at
// Seat alignment. Covers src/ui/hints.js (_hintSeat, _hintPlaceSeat, initHints).
//
//   A. Opening Settings shows the toast left of the dock, level with the Seat alignment section, recorded as seen.
//   B. Leaving Settings closes it.
//   C. Opening Settings again in the same run shows nothing.
//   D. A click on a chair closes it.

const lib = require('../../lib');

const SHOWN = '!!document.querySelector(".hintcall-seat")';

module.exports = async function hintsSeat(rig) {
  const dm = rig.dm;
  const tab = name => dm.evaluate('document.getElementById("dock-tab-' + name + '").click(); 0');
  await lib.openMap(rig, { w: 2400, h: 1500 });
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');
  await dm.evaluate('if (dockActivePane() === "settings") dockOpen("scene");' +
    ' localStorage.removeItem("evermist.hintsSeen"); localStorage.removeItem("evermist.hintsOff"); _hintRun = false; 0');
  rig.check(!(await dm.evaluate(SHOWN)), 'a hint is up before Settings opened, so the checks below prove nothing');

  // A. RED ON: _hintSeat returning at once (hints.js) - 2026-10-18
  await tab('settings');
  await lib.settle(dm, SHOWN, 8000);
  const shown = await dm.evaluate('(() => { const h = document.querySelector(".hintcall-seat");' +
    ' if (!h) return null; const r = h.getBoundingClientRect(), d = document.getElementById("dock").getBoundingClientRect(),' +
    ' s = document.getElementById("cp-sec-seat-align").getBoundingClientRect(), mid = r.top + r.height / 2;' +
    ' return { text: h.textContent, left: r.right <= d.left, level: mid >= s.top && mid <= s.bottom,' +
    ' seen: localStorage.getItem("evermist.hintsSeen") }; })()');
  rig.check(shown && /Sitting at the side of the TV/.test(shown.text), 'opening Settings showed no Seat alignment toast: ' + JSON.stringify(shown));
  rig.check(shown && shown.left && shown.level, 'the toast is not left of the dock, level with Seat alignment: ' + JSON.stringify(shown));
  rig.check(shown && shown.seen === '["seat"]', 'the toast was not recorded as seen when it showed: ' + JSON.stringify(shown));

  // B. RED ON: the dockpane listener's else hintClose('seat') removed (hints.js) - 2026-10-18
  await tab('scene');
  await lib.settle(dm, '!' + SHOWN, 8000);
  rig.check(!(await dm.evaluate(SHOWN)), 'leaving Settings did not close the Seat alignment toast');

  // C. RED BY DESIGN: written against the fix, never re-proved
  await tab('settings');
  await lib.hold(1000, 'a second toast, if one were going to show, would be up by now');
  rig.check(!(await dm.evaluate(SHOWN)), 'opening Settings again in the same run showed the toast again');

  // D. RED ON: the .sa-hit click listener gated off (hints.js) - 2026-10-18
  await tab('scene');
  await dm.evaluate('_hintRun = false; localStorage.removeItem("evermist.hintsSeen"); 0');
  await tab('settings');
  await lib.settle(dm, SHOWN, 8000);
  await dm.evaluate('document.querySelector("#cp-sec-seat-align .sa-hit").dispatchEvent(new MouseEvent("click", { bubbles: true })); 0');
  await lib.settle(dm, '!' + SHOWN, 8000);
  rig.check(!(await dm.evaluate(SHOWN)), 'picking a chair did not close the Seat alignment toast');
  await tab('scene');
};
