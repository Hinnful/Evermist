'use strict';

// tv-rescan.js — THE TV IS FOUND WITHOUT A PLUG EVENT, AND SHOW ON TV IS GREY UNTIL IT IS.
//
// A Mac whose HDMI was in before launch read the screen list once, too early, and never again until
// a plug event. While the Player is not live the DM window now reads the list on its 1 s tick.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its check under a marker carrying its letter.
//
//   A. With one screen the caption says "No TV found" and the Show on TV button is the grey `none`
//      style, not solid blue, and still clickable (it opens the help box).
//   B. When the list changes to a second, external screen with NO displays-changed event, the caption
//      becomes that screen's name within a few seconds, and the button is solid blue.
//
// ⚠ window.electronAPI cannot be stubbed (contextBridge), so the list main would report is replaced
// at its one reader, _tvLoadDisplays, with a function reading a global the scenario changes. The tick
// calling that reader is exactly what is under test.

const lib = require('../../lib');

const q = sel => 'document.querySelector(' + JSON.stringify(sel) + ')';

module.exports = async function tvRescan(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: 900, h: 600 });
  await lib.settle(dm, '!minimapDirty', 10000);
  const LAPTOP = '{ id: 1, label: "Laptop", internal: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 } }';
  const TV = '{ id: 2, label: "Rescan TV", internal: false, bounds: { x: 1920, y: 0, width: 3840, height: 2160 }, size: { width: 3840, height: 2160 } }';
  await dm.evaluate(`(() => {
    globalThis.__screens = [${LAPTOP}];
    _tvLoadDisplays = async () => { _tvDmId = 1; _tvDisplays = globalThis.__screens; };
    localStorage.removeItem(TV_SCREEN_KEY);
    _tvKey = ''; _tvTick(); return 0;
  })()`);
  const read = () => dm.evaluate(`(() => { const g = ${q('#tv-ui .tv-go')}; return g ? {
    caption: ${q('#tv-ui .tv-sub .nm')}.textContent, none: g.classList.contains('none'), bg: getComputedStyle(g).backgroundColor } : null; })()`);

  // ── A ──
  // RED ON: the `none` modifier dropped from the tv-go class in _tvCta (tvControl.js) - 2026-10-22
  const one = await lib.poll(async () => { const r = await read(); return r && r.caption === 'No TV found' ? r : null; }, 8000);
  rig.check(!!one && one.none && one.bg !== 'rgb(12, 140, 233)', 'A: with no TV found Show on TV is solid blue or lacks the grey style: ' + JSON.stringify(one));

  // ── B ──
  // RED ON: the screen list read removed from _tvTick (tvControl.js), leaving only the wait branch - 2026-10-22
  await dm.evaluate(`globalThis.__screens = [${LAPTOP}, ${TV}]; 0`);
  const two = await lib.poll(async () => { const r = await read(); return r && r.caption === 'Rescan TV' ? r : null; }, 6000);
  rig.check(!!two, 'B: the screen list changed with no plug event and the caption never found the TV: ' + JSON.stringify(await read()));
  rig.check(!!two && !two.none && two.bg === 'rgb(12, 140, 233)', 'B: with a TV found Show on TV is not solid blue: ' + JSON.stringify(two));
};
