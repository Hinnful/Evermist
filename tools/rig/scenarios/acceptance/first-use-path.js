'use strict';

// first-use-path.js — THE CUES ON A FIRST DM'S PATH: open a map, put it on the TV.
// Covers src/world/worldMapOpenBar.js, src/ui/hintsCues.js (hintsCuesSync, hintsShowOnTvAsk), hints.js (_hintNear),
// hintsFirstMap.js (the reveal text), src/player/tvControl.js (#tv-go) and the Help sheet. Items 2 to 6 of the first-use-cues spec.
//
//   A. The blue Open button over a picked map shows its icon and the word "Open"; its tooltip stays.
//   B. With the Campaign up and a map in it, none opened this run, the open-map hint sits beside the first map card,
//      recorded as seen. Opening a map closes it.
//   C. The reveal hint reads "Pick the Brush and paint over the map to reveal that part to the players."
//   D. The first brush stroke while the TV is not live shows the show-on-tv hint above the Show on TV button, which
//      blinks, and the Rooms hint stays away. The TV going live closes it. The next stroke shows the Rooms hint.
//   E. The Help sheet's Map section has a "Pan with a mouse" row with Middle-drag and Alt+Drag.
//
// ⚠ THE LIBRARY STARTS EMPTY, so the app opens on the Campaign. The picker's own handler is fed a real FileList.

const lib = require('../../lib');

const MAP_W = 900, MAP_H = 600;
const NAMES = ['Cellar', 'Attic'];
const up = id => '!!document.querySelector(".hintcall-' + id + '")';

module.exports = async function firstUsePath(rig) {
  const dm = rig.dm;
  await lib.settle(dm, 'worldMapOpen && !_wmAnim', 30000);

  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H });
  await dm.evaluate('globalThis.__fx = ' + await rig.fixtures.asFileExpr(dm, map) + '; 0');
  const files = NAMES.map(n => 'dt.items.add(new File([__fx], ' + JSON.stringify(n + '.mp4') + ', { type: __fx.type }));').join(' ');
  await dm.evaluate('(() => { const inp = document.getElementById("wm-file-input"); const dt = new DataTransfer(); ' + files +
                    ' inp.files = dt.files; inp.dispatchEvent(new Event("change", { bubbles: true })); return 0; })()', 180000);
  await dm.waitFor('allScenes.length === ' + NAMES.length, 180000, 'the maps to reach the library');
  await lib.settle(dm, '!_wmAnim && worldMapPicked().length === 1', 30000);

  // A. RED BY DESIGN: written against the fix, never re-proved
  await lib.settle(dm, 'document.getElementById("wm-bar").classList.contains("on")', 8000);
  const open = await dm.evaluate(`(() => { const b = document.querySelector('#wm-bar .wm-bar-open');
    return b ? { text: b.textContent.trim(), icon: !!b.querySelector('svg'), title: b.title } : null; })()`);
  rig.check(open && open.text === 'Open' && open.icon && open.title === 'Open', 'the Open button does not show its icon and the word Open, with its tooltip: ' + JSON.stringify(open));

  // B. RED BY DESIGN: written against the fix, never re-proved
  await lib.settle(dm, up('open-map'), 8000);
  const hint = await dm.evaluate(`(() => { const h = document.querySelector('.hintcall-open-map'), c = _wmEls.get('c' + allScenes[0].id);
    if (!h || !c) return null; const r = h.getBoundingClientRect(), a = c.getBoundingClientRect();
    return { text: h.textContent, beside: r.left >= a.right - 1 || r.right <= a.left + 1, apart: !(r.left < a.right && r.right > a.left && r.top < a.bottom && r.bottom > a.top),
      seen: localStorage.getItem('evermist.hintsSeen') }; })()`);
  rig.check(hint && /Open a map/.test(hint.text) && /Double-click a map, or pick it and press Open\./.test(hint.text),
            'the Campaign shows no open-map hint with its words: ' + JSON.stringify(hint));
  rig.check(hint && hint.beside && hint.apart && /open-map/.test(hint.seen), 'the open-map hint is not beside the first map card, or was not recorded: ' + JSON.stringify(hint));
  // RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('document.querySelector("#wm-bar .wm-bar-open").click(); 0');
  await lib.settle(dm, 'currentScene && !worldMapOpen && fogCoverT === 0', 60000);
  rig.check(!(await dm.evaluate(up('open-map'))), 'opening a map left the open-map hint up');

  // C. RED BY DESIGN: written against the fix, never re-proved
  await lib.settle(dm, up('reveal'), 8000);
  const reveal = await dm.evaluate('(() => { const h = document.querySelector(".hintcall-reveal"); return h ? h.textContent : null; })()');
  rig.check(reveal && /Pick the Brush and paint over the map to reveal that part to the players\./.test(reveal), 'the reveal hint does not carry its new words: ' + reveal);
  await lib.installHelpers(dm);

  // D. RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('setShape("brush"); 0');
  await lib.settle(dm, '!' + up('reveal'), 8000);
  await dm.evaluate('__rigDrag(200, 200, 300, 260); 0');
  await lib.settle(dm, up('show-on-tv'), 8000);
  const tv = await dm.evaluate(`(() => { const h = document.querySelector('.hintcall-show-on-tv'), b = document.getElementById('tv-go');
    if (!h || !b) return null; const r = h.getBoundingClientRect(), a = b.getBoundingClientRect();
    return { text: h.textContent, above: r.bottom <= a.top + 1, blink: b.classList.contains('hintcall-blink'), rooms: !!document.querySelector('.hintcall-rooms') }; })()`);
  rig.check(tv && /Put it on the TV/.test(tv.text) && /Press Show on TV\. The players see only what you reveal\./.test(tv.text),
            'the first brush stroke showed no show-on-tv hint with its words: ' + JSON.stringify(tv));
  rig.check(tv && tv.above && tv.blink, 'the show-on-tv hint is not above the Show on TV button, or the button does not blink: ' + JSON.stringify(tv));
  rig.check(tv && !tv.rooms, 'the Rooms hint showed on the same stroke as the show-on-tv hint');
  await rig.player();
  await lib.settle(dm, '_tvLive() && !' + up('show-on-tv'), 15000);
  rig.check(!(await dm.evaluate(up('show-on-tv'))), 'the TV going live left the show-on-tv hint up');
  await dm.evaluate('__rigDrag(400, 300, 480, 340); 0');
  await lib.settle(dm, up('rooms'), 8000);
  rig.check(await dm.evaluate(up('rooms')), 'the next stroke did not show the Rooms hint');

  // E. RED BY DESIGN: written against the fix, never re-proved
  const row = await dm.evaluate(`(() => { const r = [...document.querySelectorAll('#shortcut-legend .lg-row')].find(x => x.firstChild.textContent.trim() === 'Pan with a mouse');
    return r ? [...r.querySelectorAll('kbd')].map(k => k.textContent.trim()) : null; })()`);
  rig.check(row && row.join('|') === 'Middle-drag|Alt+Drag', 'the Help sheet has no "Pan with a mouse" row with Middle-drag and Alt+Drag: ' + JSON.stringify(row));
  rig.byEye('the Open button reads well beside More, and the hints sit clear of what they point at');
};
