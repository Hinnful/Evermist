'use strict';

// world-map-first-evening.js — THE FIRST EVENING ON THE WORLD MAP.
//
// THE GOAL OF THIS FEATURE: a DM who opens Evermist for the first time lands on a map that says what to press, adds
// four maps and finds them framed with the first one ready to open, with nothing opened and the TV untouched.
//
// THE CRITERIA ARE THIS HEADER, one per line of the spec's Definition of Done
// (.claude/private/specs/world-map-first-evening.md).
//
//   1. With no maps the app opens on the world map. With maps it opens on the last map.
//   2. Deleting the last map lands on the empty world map.
//   3. An empty world map shows a callout over Add. The bar holds Select and Add only; the Notes tab is disabled.
//   4. Four loose maps are framed as prints (never below the scenes level), inside the part of the window the dock
//      leaves clear, and no closer than 2.6x.
//   5. After adding, the first map is the one picked, nothing opens, and the open scene is unchanged.
//   6. One picked map has a bar above it: Open (an arrow, solid blue, no glow) and More, whose menu hangs from the button. The
//      bar hides while dragging, zoomed out to places, and while searching.
//   7. Opening a map from the bar closes the world map.
//   8. Searching never shows a diamond over a print, nor a print at the places level.
//
// ⚠ THE LIBRARY STARTS EMPTY, which is what 1 needs, and 1's second half RESTARTS THE APP, so the restart comes before
// the delete in 2.
// ⚠ THE FILE PICKER CANNOT BE DRIVEN (the rig skill): the picker's own handler is fed a real FileList.
// ⚠ BY EYE: the callout's look and the Open bar's look.

const lib = require('../../lib');
const MAP_W = 900, MAP_H = 600;
const NAMES = ['Cellar', 'Attic', 'Bridge', 'Cave'];
// The prints fade and glide for 0.3s after every camera move; only finite animations count.
const SETTLED = 'document.getAnimations().every(a => a.effect.getComputedTiming().iterations === Infinity)';

const PAGE = `
globalThis.__feVis = el => !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0;
globalThis.__feBar = () => [...document.getElementById('toolbar-bottom').children].filter(__feVis).map(el => el.id);
globalThis.__feCard = name => [...document.querySelectorAll('.wm-card')].find(c => c.querySelector('.wm-nm').textContent === name);
globalThis.__feEv = (type, el, p) => (el || window).dispatchEvent(new MouseEvent(type, { clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, button: 0 }));
`;

module.exports = async function worldMapFirstEvening(rig) {
  let dm = rig.dm;

  // ── 1. An empty library opens on the world map ────────────────────────────
  await lib.settle(dm, 'worldMapOpen && !_wmAnim', 30000);
  await dm.evaluate(PAGE);
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(await dm.evaluate('worldMapOpen && document.body.classList.contains("world") && !currentScene'),
            'an empty library did not open the app on the world map');

  // ── 3. The empty map says where to begin ──────────────────────────────────
  await lib.settle(dm, SETTLED, 8000);
  const empty = await dm.evaluate(`(() => {
    const call = document.getElementById('wm-empty'), layer = document.getElementById('wm');
    const c = call.getBoundingClientRect(), a = layer.getBoundingClientRect(), np = document.getElementById('dock-tab-notes');
    return { shown: __feVis(call), text: call.textContent, dx: Math.abs((c.left + c.width / 2) - (a.left + a.width / 2)), button: !!call.querySelector('#wm-empty-add'),
      bar: __feBar(), panel: !np.disabled };
  })()`);
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(empty.shown && /Add your maps/.test(empty.text) && /Dungeon Alchemist/.test(empty.text) && empty.button,
            'the empty map shows no Add a map call to action: ' + JSON.stringify(empty));
  rig.check(empty.dx < 3, 'the call to action is not centred on the layer: ' + JSON.stringify(empty));
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(JSON.stringify(empty.bar) === JSON.stringify(['btn-select', 'wm-add']),
            'the empty map\'s bar is not Select and Add alone: ' + JSON.stringify(empty.bar));
  rig.check(!empty.panel, 'the Notes tab is enabled over an empty world map');

  // ── 4 and 5. Four loose maps are added: framed, the first picked, nothing opened ──
  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H });
  await dm.evaluate('globalThis.__fx = ' + await rig.fixtures.asFileExpr(dm, map) + '; 0');
  const files = NAMES.map(n => 'dt.items.add(new File([__fx], ' + JSON.stringify(n + '.mp4') + ', { type: __fx.type }));').join(' ');
  // ⚠ THE PICKER'S OWN HANDLER, on a real FileList: setFileInputFiles reports success and fills nothing.
  await dm.evaluate('(() => { const inp = document.getElementById("wm-file-input"); const dt = new DataTransfer(); ' + files +
                    ' inp.files = dt.files; inp.dispatchEvent(new Event("change", { bubbles: true })); return 0; })()', 180000);
  await dm.waitFor('allScenes.length === ' + NAMES.length, 180000, 'the four maps to reach the library');
  await lib.settle(dm, '!_wmAnim && worldMapPicked().length === 1', 30000);
  await lib.settle(dm, SETTLED, 8000);
  const added = await dm.evaluate(`(() => {
    const first = allScenes.find(s => s.name === ${JSON.stringify(NAMES[0])}) || {};
    const dk = document.getElementById('dock');
    const left = 0, right = dk.getBoundingClientRect().left;
    const cards = [...document.querySelectorAll('.wm-card')].map(c => c.getBoundingClientRect());
    return { picked: worldMapPicked(), first: first.id, cur: currentScene === null, z: _wmCam.z, split: WM_SPLIT, scenes: document.getElementById('wm').classList.contains('scenes'),
      open: worldMapOpen, n: cards.length, left, right,
      inside: cards.every(r => r.left >= left - 1 && r.right <= right + 1 && r.top >= -1 && r.bottom <= innerHeight + 1), callout: __feVis(document.getElementById('wm-empty')) };
  })()`);
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(added.picked.length === 1 && added.picked[0] === added.first,
            'after adding, the first map is not the one picked: ' + JSON.stringify(added));
  rig.check(added.cur && added.open, 'adding maps opened one, or closed the world map, so the open scene changed: ' + JSON.stringify(added));
  rig.check(added.n === NAMES.length && added.inside,
            'the added maps are not all inside the clear part of the window: ' + JSON.stringify(added));
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(added.scenes && added.z >= added.split - 1e-9 && added.z <= 2.6 + 1e-9,
            'the loose maps are not framed as prints between the scenes level and 2.6x: ' + JSON.stringify(added));
  rig.check(!added.callout, 'the callout stays over a map that has maps');

  // ── 6. The Open bar ────────────────────────────────────────────────────────
  // ⚠ THE BAR IS PLACED ON THE NEXT FRAME after the camera stops, and a parked window's frames come late on a slow runner.
  await lib.settle(dm, '__feVis(document.getElementById("wm-bar"))', 8000);
  const bar = await dm.evaluate(`(() => {
    const b = document.getElementById('wm-bar'), card = document.querySelector('.wm-card.sel'), open = b.querySelector('.wm-bar-open');
    const r = b.getBoundingClientRect(), c = card.getBoundingClientRect(), o = getComputedStyle(open);
    const probe = document.createElement('i'); probe.style.background = 'var(--b-solid)'; document.body.appendChild(probe);
    const solid = getComputedStyle(probe).backgroundColor; probe.remove();
    return { on: __feVis(b), above: r.bottom <= c.top + 1, dx: Math.abs((r.left + r.width / 2) - (c.left + c.width / 2)), bg: o.backgroundColor, solid, shadow: o.boxShadow,
      buttons: [...b.querySelectorAll('button')].map(x => x.className) };
  })()`);
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(bar.on && bar.above && bar.dx < 3, 'the Open bar is not above the one picked map: ' + JSON.stringify(bar));
  rig.check(bar.bg === bar.solid && bar.shadow === 'none',
            'Open is not solid blue with no glow: ' + JSON.stringify(bar));
  rig.byEye('the callout\'s look and the Open bar\'s look');

  // Hidden while the map is dragged: past the 4px a click allows, before the button is let go.
  const drag = await dm.evaluate(`(() => {
    const card = document.querySelector('.wm-card.sel'), r = card.getBoundingClientRect(), p = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    __feEv('mousedown', card, p);
    __feEv('mousemove', window, { x: p.x + 30, y: p.y + 20 });
    __feEv('mousemove', window, { x: p.x + 60, y: p.y + 40 });
    return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => { const on = document.getElementById('wm-bar').classList.contains('on'); __feEv('mouseup', window, { x: p.x + 60, y: p.y + 40 }); res(on); })));
  })()`);
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(drag === false, 'the Open bar stays over a map while it is being dragged');
  await lib.settle(dm, SETTLED, 8000);
  rig.check(await dm.evaluate('document.getElementById("wm-bar").classList.contains("on")'), 'the Open bar did not come back when the drag ended');

  // Hidden zoomed out to places, and while searching.
  await dm.evaluate('searchOpen(); 0');
  await lib.settle(dm, 'document.body.classList.contains("searching") && !document.getElementById("wm-bar").classList.contains("on")', 4000);
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(await dm.evaluate('document.body.classList.contains("searching") && !document.getElementById("wm-bar").classList.contains("on")'),
            'the Open bar stays up while the map is searching');
  await dm.evaluate('searchClose(); 0');
  await dm.evaluate('_wmCam = { cx: _wmCam.cx, cy: _wmCam.cy, z: 0.5 }; _wmApplyCam(); 0');
  await lib.settle(dm, '!_wmAnim && document.getElementById("wm").classList.contains("places") && !document.getElementById("wm-bar").classList.contains("on")', 4000);
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(await dm.evaluate('document.getElementById("wm").classList.contains("places") && !document.getElementById("wm-bar").classList.contains("on")'),
            'the Open bar stays up zoomed out to places');

  // ── 8. Searching never shows the level that is hidden ─────────────────────
  const search = async () => {
    await dm.evaluate('searchOpen(); (() => { const i = document.getElementById("sr-input"); i.value = "cel"; i.dispatchEvent(new Event("input", { bubbles: true })); })(); 0');
    await lib.settle(dm, SETTLED, 8000);
    return dm.evaluate(`({ level: document.getElementById('wm').className,
      marks: [...document.querySelectorAll('.wm-lm')].map(e => getComputedStyle(e).opacity),
      cards: [...document.querySelectorAll('.wm-card')].map(e => getComputedStyle(e).opacity),
      dimmed: document.querySelectorAll('.wm-card.dim, .wm-lm.dim').length })`);
  };
  const far = await search();
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(/\bplaces\b/.test(far.level) && far.dimmed > 0 && far.cards.every(o => o === '0'),
            'at the places level a search shows a map card: ' + JSON.stringify(far));
  await dm.evaluate('searchClose(); _wmCam = { cx: _wmCam.cx, cy: _wmCam.cy, z: 1 }; _wmApplyCam(); 0');
  await lib.settle(dm, SETTLED, 8000);
  const near = await search();
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(/\bscenes\b/.test(near.level) && near.dimmed > 0 && near.marks.every(o => o === '0'),
            'at the scenes level a search shows a diamond over a map card: ' + JSON.stringify(near));
  await dm.evaluate('searchClose(); 0');
  await lib.settle(dm, '!document.body.classList.contains("searching")', 4000);

  // ── 6 and 7. More hangs the menu from its button; Open opens the map and closes the world map ──
  const second = await dm.evaluate('allScenes.find(s => s.name === "Attic").id');
  await dm.evaluate('worldMapSelect({ sceneId: ' + JSON.stringify(second) + ', place: "" }); 0');
  await lib.settle(dm, 'document.getElementById("wm-bar").classList.contains("on")', 8000);
  const more = await dm.evaluate(`(() => {
    const btn = document.querySelector('#wm-bar .wm-bar-more'), r = btn.getBoundingClientRect();
    btn.click();
    const menu = document.querySelector('.wm-menu'), m = menu && menu.getBoundingClientRect();
    return { rows: menu ? [...menu.querySelectorAll('.sm-mi')].map(b => b.textContent) : null,
      dx: m ? Math.abs(m.left - r.left) : null, dy: m ? Math.abs(m.top - (r.bottom + 6)) : null };
  })()`);
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(more.rows && more.rows[0] === 'Open' && more.dx < 2 && more.dy < 2,
            'More did not open the map\'s menu hanging from the button: ' + JSON.stringify(more));
  await dm.evaluate('worldMapMenuClose(); 0');

  await dm.evaluate('document.querySelector("#wm-bar .wm-bar-open").click(); 0');
  await lib.settle(dm, 'currentScene && currentScene.id === ' + JSON.stringify(second) + ' && !worldMapOpen', 90000);
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(await dm.evaluate('!!currentScene && currentScene.id === ' + JSON.stringify(second) + ' && !worldMapOpen && !document.body.classList.contains("world")'),
            'Open on the bar did not open the picked map and close the world map');

  // ── 1. With maps, the app opens on the last map ───────────────────────────
  await lib.settle(dm, 'localStorage.getItem("evermist-current-scene-id") === ' + JSON.stringify(second), 15000);
  dm = await rig.restart();
  await lib.installHelpers(dm);
  await dm.evaluate(PAGE);
  await dm.waitFor('currentScene && currentScene.id === ' + JSON.stringify(second), 120000, 'the last map to reopen after the restart');
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(await dm.evaluate('!worldMapOpen'), 'a library with maps opened on the world map and not on its last map');

  // ── 2. Deleting the last map lands on the empty world map ─────────────────
  await dm.evaluate('deleteScenesWithUndo(allScenes.filter(s => s.id !== currentScene.id).map(s => s.id)); 0');
  rig.check(await dm.evaluate('!worldMapOpen && !!currentScene'), 'deleting the maps that are not open changed what is open');
  await dm.evaluate('deleteScenesWithUndo([currentScene.id]); 0');
  await lib.settle(dm, 'worldMapOpen && !currentScene', 15000);
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(await dm.evaluate('worldMapOpen && !currentScene && allScenes.length === 0 && document.body.classList.contains("wm-empty")'),
            'deleting the last map did not land on the empty world map');
};
