'use strict';

// world-map-toolbar.js — THE WORLD MAP'S TOOLBAR AND ITS SEARCH.
//
// THE GOAL OF THIS FEATURE: the bar says what to press with no words - Add is the one solid blue button, the tool in hand
// wears the blue tint - and Find opens a large search over a dimmed map.
//
// THE CRITERIA ARE THIS HEADER, one per line of the spec's Definition of Done
// (.claude/private/specs/world-map-toolbar-look.md).
//
//   10. The bar reads Select, Add, Place, a divider, Find. No words.
//   11. Add is solid blue with no glow. The tool in hand on this bar wears the blue tint.
//   12. Place's list holds Rectangle (R), Circle (O), Polygon (P), then Road (L). The button wears the last pick.
//       Places take no repairs: the options row holds Straight walls alone.
//   13. L takes Road on the world map only; R, O, P and V put it down.
//   14. Find, or Ctrl+F, opens a large search in the middle of the window: every map as a picture when nothing is typed,
//       cards when typing. Arrow keys, Enter and Esc work.
//
// ⚠ THE LIBRARY STARTS EMPTY and opens on the world map; the picker's own handler is fed a real FileList (the rig skill).
// ⚠ BY EYE: the bar, Add, the search and its fade.

const lib = require('../../lib');
const NAMES = ['Cellar', 'Attic', 'Bridge'];

const PAGE = `
globalThis.__tbVis = el => !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0;
globalThis.__tbBar = () => [...document.getElementById('toolbar-bottom').children].filter(__tbVis)
  .map((el, i) => ({ id: el.id, i, o: parseInt(getComputedStyle(el).order, 10) || 0 })).sort((a, b) => a.o - b.o || a.i - b.i).map(x => x.id);
// ⚠ ON THE BODY, NOT THE WINDOW: the world map catches its keys at the document, which never sees an event aimed at the window.
globalThis.__tbKey = (c, mods) => document.body.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ code: c, key: c, bubbles: true, cancelable: true }, mods || {})));
globalThis.__tbList = () => {
  const c = document.querySelector('#tb-grp-shape .tb-chev'); c.click();
  const rows = [...document.querySelectorAll('#tb-dd .dd-it')].map(e => ({ id: e.dataset.dd, key: e.querySelector('.ky').textContent, name: e.querySelector('.nm').textContent }));
  const sections = document.querySelectorAll('#tb-dd .dd-lbl').length;
  c.click();
  return { rows, sections };
};
`;

module.exports = async function worldMapToolbar(rig) {
  const dm = rig.dm;
  await lib.settle(dm, 'worldMapOpen && !_wmAnim', 30000);
  await dm.evaluate(PAGE);

  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: 900, h: 600 });
  await dm.evaluate('globalThis.__fx = ' + await rig.fixtures.asFileExpr(dm, map) + '; 0');
  const files = NAMES.map(n => 'dt.items.add(new File([__fx], ' + JSON.stringify(n + '.mp4') + ', { type: __fx.type }));').join(' ');
  await dm.evaluate('(() => { const inp = document.getElementById("wm-file-input"); const dt = new DataTransfer(); ' + files +
                    ' inp.files = dt.files; inp.dispatchEvent(new Event("change", { bubbles: true })); return 0; })()', 180000);
  await dm.waitFor('allScenes.length === ' + NAMES.length, 180000, 'the maps to reach the library');
  await lib.settle(dm, '!_wmAnim', 30000);

  // ── 10 and 11. The bar, and Add's colour ──────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const bar = await dm.evaluate('__tbBar()');
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(JSON.stringify(bar) === JSON.stringify(['btn-select', 'wm-add', 'tb-grp-shape', 'wm-div', 'wm-find']),
            'the bar does not read Select, Add, Place, a divider, Find: ' + JSON.stringify(bar));
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(await dm.evaluate('[...document.querySelectorAll("#toolbar-bottom > *")].filter(__tbVis).every(el => !el.textContent.trim())'),
            'the bar carries words');
  const add = await dm.evaluate(`(() => {
    const probe = document.createElement('i'); probe.style.background = 'var(--b-solid)'; document.body.appendChild(probe);
    const solid = getComputedStyle(probe).backgroundColor; probe.remove();
    const s = getComputedStyle(document.getElementById('wm-add'));
    return { bg: s.backgroundColor, solid, shadow: s.boxShadow };
  })()`);
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(add.bg === add.solid && add.shadow === 'none', 'Add is not solid blue with no glow: ' + JSON.stringify(add));
  rig.byEye('the bar, Add and the blue tint');

  // ── 12. The Place list, and what the button wears ─────────────────────────
  const list = await dm.evaluate('__tbList()');
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(list.rows.map(r => r.id + ':' + r.key).join() === 'btn-rect:R,btn-circle:O,btn-poly:P,wm-road:L' && list.sections === 0,
            'the Place list is not Rectangle, Circle, Polygon, then Road, with no repairs: ' + JSON.stringify(list));
  await dm.evaluate('setShape("rect"); 0');
  // A tool button fades its colour; read it once the fade is over.
  await lib.settle(dm, 'document.getAnimations().every(a => a.playState !== "running")', 4000);
  const tint = await dm.evaluate(`(() => { const probe = document.createElement('i'); probe.style.background = 'var(--b-tint)'; document.body.appendChild(probe);
    const t = getComputedStyle(probe).backgroundColor; probe.remove();
    return { tint: t, bg: getComputedStyle(document.getElementById('btn-shape')).backgroundColor, repairs: __tbVis(document.getElementById('op-sw')), walls: __tbVis(document.getElementById('btn-axislock')) }; })()`);
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(tint.bg === tint.tint, 'the tool in hand does not wear the blue tint: ' + JSON.stringify(tint));
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(!tint.repairs && tint.walls, 'the options row over a place tool shows the repair icon, or lacks Straight walls: ' + JSON.stringify(tint));

  // ── 13. L takes Road; R, O, P and V put it down ───────────────────────────
  await dm.evaluate('__tbKey("KeyL"); 0');
  const road = await dm.evaluate(`({ tool: _wmTool, worn: document.getElementById('btn-shape').classList.contains('active') && document.querySelector('#btn-shape .tb-shape-glyph').innerHTML === document.querySelector('#wm-road svg').outerHTML,
    select: document.getElementById('btn-select').classList.contains('active') })`);
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(road.tool === 'road' && road.worn && !road.select, 'L did not take Road, or the Place button does not wear it: ' + JSON.stringify(road));
  for (const [code, tool] of [['KeyR', 'rect'], ['KeyL', 'road'], ['KeyO', 'circle'], ['KeyL', 'road'], ['KeyP', 'poly'], ['KeyL', 'road'], ['KeyV', 'select']]) {
    await dm.evaluate('__tbKey(' + JSON.stringify(code) + '); 0');
    // RED BY DESIGN: written against the feature, never re-proved
    rig.check(await dm.evaluate('_wmTool === ' + JSON.stringify(tool)), code + ' did not put the tool at ' + tool);
  }
  // The button wears the last pick: Road stays on it with Select in hand, and a click takes Road back.
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(await dm.evaluate('document.querySelector("#btn-shape .tb-shape-glyph").innerHTML === document.querySelector("#wm-road svg").outerHTML'),
            'the Place button does not wear the last pick');
  await dm.evaluate('document.getElementById("btn-shape").click(); 0');
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(await dm.evaluate('_wmTool === "road"'), 'a click on the Place button did not take the last pick');
  await dm.evaluate('setShape("select"); 0');

  // ── 14. Find ──────────────────────────────────────────────────────────────
  await dm.evaluate('document.getElementById("wm-find").click(); 0');
  await lib.settle(dm, 'document.body.classList.contains("searching")', 4000);
  const grid = await dm.evaluate(`(() => { const f = document.querySelector('#wm-finder .sm-win').getBoundingClientRect(), v = innerWidth;
    return { cards: document.querySelectorAll('#wm-find-list .wf-row').length, centred: Math.abs((f.left + f.right) / 2 - v / 2) < 3,
      focus: document.activeElement === document.getElementById('wm-search') }; })()`);
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(grid.cards === NAMES.length && grid.centred && grid.focus, 'the empty search is not one card per map in the middle of the window: ' + JSON.stringify(grid));
  rig.byEye('the search and its fade');
  await dm.evaluate('document.getElementById("wm-search").dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape", bubbles: true, cancelable: true })); 0');
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(await dm.evaluate('!document.body.classList.contains("searching")'), 'Esc did not close the search');
  await dm.evaluate('__tbKey("KeyF", { ctrlKey: true }); 0');
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(await dm.evaluate('document.body.classList.contains("searching")'), 'Ctrl+F did not open the search');
  await dm.evaluate('(() => { const i = document.getElementById("wm-search"); i.value = "att"; i.dispatchEvent(new Event("input", { bubbles: true })); })(); 0');
  const typed = await dm.evaluate('[...document.querySelectorAll("#wm-find-list .wf-row .wf-nm")].map(e => e.textContent)');
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(typed.length === 1 && typed[0] === 'Attic', 'typing did not narrow the cards to the match: ' + JSON.stringify(typed));
  await dm.evaluate('document.getElementById("wm-search").dispatchEvent(new KeyboardEvent("keydown", { code: "Enter", key: "Enter", bubbles: true, cancelable: true })); 0');
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(await dm.evaluate('!document.body.classList.contains("searching") && worldMapPicked().length === 1 && allScenes.find(s => s.id === worldMapPicked()[0]).name === "Attic"'),
            'Enter on a result did not pick it and close the search');
};
