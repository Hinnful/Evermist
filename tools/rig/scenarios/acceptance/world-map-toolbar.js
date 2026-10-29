'use strict';

// world-map-toolbar.js — THE WORLD MAP'S TOOLBAR AND ITS SEARCH.
//
// THE GOAL OF THIS FEATURE: the bar names what it adds - Map, Group, Road and Marker carry their words, the tool in hand
// wears the blue tint - and Find opens a large search over a dimmed map.
//
// THE CRITERIA ARE THIS HEADER, one per line of the spec's Definition of Done
// (.claude/private/specs/world-map-toolbar-look.md).
//
//   10. The bar reads Select, Map, Group, Road, Marker, a divider, Find, each word on its own button (campaign toolbar, DoD 1).
//   11. Add is grey, not solid blue, with no glow. The tool in hand on this bar wears the blue tint.
//   12. Group's list holds Rectangle (R), Circle (O), Polygon (P) and nothing else; Group always says Group, whatever was
//       picked (DoD 2). The Campaign shows no options row, so no Straight walls (DoD 5).
//   13. Road is its own labelled button; L takes it, R, O, P and V put it down (DoD 3). Marker is a tool beside it:
//       a click arms it, Esc and V put it down (DoD 4).
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
  // RED BY DESIGN: written against the fix, never re-proved
  rig.check(JSON.stringify(bar) === JSON.stringify(['btn-select', 'wm-add', 'tb-grp-shape', 'wm-road', 'wm-marker', 'wm-div', 'wm-find']),
            'the bar does not read Select, Map, Group, Road, Marker, a divider, Find: ' + JSON.stringify(bar));
  // RED BY DESIGN: written against the fix, never re-proved
  const words = await dm.evaluate('__tbBar().map(id => id + ":" + document.getElementById(id).textContent.trim()).join()');
  rig.check(words === 'btn-select:,wm-add:Map,tb-grp-shape:Group,wm-road:Road,wm-marker:Marker,wm-div:,wm-find:', 'the bar does not read Map, Group, Road and Marker, with no other words: ' + words);
  // RED BY DESIGN: written against the fix, never re-proved
  rig.check(await dm.evaluate('document.getElementById("wm-marker").title') === 'Party marker - where the party is now', 'Marker has the wrong tooltip');
  const add = await dm.evaluate(`(() => {
    const probe = document.createElement('i'); probe.style.background = 'var(--b-solid)'; document.body.appendChild(probe);
    const solid = getComputedStyle(probe).backgroundColor; probe.remove();
    const s = getComputedStyle(document.getElementById('wm-add'));
    return { bg: s.backgroundColor, solid, shadow: s.boxShadow };
  })()`);
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(add.bg !== add.solid && add.shadow === 'none', 'Add is solid blue, or glows: ' + JSON.stringify(add));
  rig.byEye('the bar, Add and the blue tint');

  // ── 12. The Group list, and what the button wears ─────────────────────────
  const list = await dm.evaluate('__tbList()');
  // RED BY DESIGN: written against the fix, never re-proved
  rig.check(list.rows.map(r => r.id + ':' + r.key).join() === 'btn-rect:R,btn-circle:O,btn-poly:P' && list.sections === 0,
            'the Group list is not Rectangle, Circle, Polygon alone: ' + JSON.stringify(list));
  await dm.evaluate('setShape("rect"); 0');
  // A tool button fades its colour; read it once the fade is over.
  await lib.settle(dm, 'document.getAnimations().every(a => a.playState !== "running")', 4000);
  const tint = await dm.evaluate(`(() => { const probe = document.createElement('i'); probe.style.background = 'var(--b-tint)'; document.body.appendChild(probe);
    const t = getComputedStyle(probe).backgroundColor; probe.remove();
    return { tint: t, bg: getComputedStyle(document.getElementById('btn-shape')).backgroundColor, repairs: __tbVis(document.getElementById('op-sw')), walls: __tbVis(document.getElementById('btn-axislock')) }; })()`);
  // RED ON: `.tool-btn.active` back to `background: var(--b-solid)` (toolbar.css) - 2026-10-16
  rig.check(tint.bg === tint.tint, 'the tool in hand does not wear the blue tint: ' + JSON.stringify(tint));
  // RED BY DESIGN: written against the fix, never re-proved
  rig.check(!tint.repairs && !tint.walls && !(await dm.evaluate('__tbVis(document.getElementById("context-row"))')),
            'the Campaign shows an options row, the repair icon or Straight walls over a Group tool: ' + JSON.stringify(tint));

  // ── 13. L takes Road; R, O, P and V put it down ───────────────────────────
  await dm.evaluate('__tbKey("KeyL"); 0');
  const road = await dm.evaluate(`({ tool: _wmTool, lit: document.getElementById('wm-road').classList.contains('active'), group: document.getElementById('btn-shape').classList.contains('active'),
    word: document.querySelector('#btn-shape .tb-shape-label').textContent, shapeGlyph: document.querySelector('#btn-shape .tb-shape-glyph').innerHTML !== document.querySelector('#wm-road svg').outerHTML,
    select: document.getElementById('btn-select').classList.contains('active') })`);
  // RED BY DESIGN: written against the fix, never re-proved
  rig.check(road.tool === 'road' && road.lit && !road.group && !road.select && road.word === 'Group' && road.shapeGlyph,
            'L did not light Road on its own button, or Group lost its word or wears Road: ' + JSON.stringify(road));
  for (const [code, tool] of [['KeyR', 'rect'], ['KeyL', 'road'], ['KeyO', 'circle'], ['KeyL', 'road'], ['KeyP', 'poly'], ['KeyL', 'road'], ['KeyV', 'select']]) {
    await dm.evaluate('__tbKey(' + JSON.stringify(code) + '); 0');
    // RED BY DESIGN: written against the feature, never re-proved
    rig.check(await dm.evaluate('_wmTool === ' + JSON.stringify(tool)), code + ' did not put the tool at ' + tool);
  }
  // Group keeps the last shape and its word with Select in hand, and a click on it takes that shape, never Road.
  // RED BY DESIGN: written against the fix, never re-proved
  rig.check(await dm.evaluate('document.querySelector("#btn-shape .tb-shape-label").textContent === "Group"'), 'Group lost its word with Select in hand');
  await dm.evaluate('document.getElementById("btn-shape").click(); 0');
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(await dm.evaluate('["rect", "circle", "poly"].includes(_wmTool)'), 'a click on Group did not take its shape');
  await dm.evaluate('setShape("select"); 0');

  // ── 13b. Marker is a tool: a click arms it, Esc and V put it down ─────────
  await dm.evaluate('document.getElementById("wm-marker").click(); 0');
  // RED BY DESIGN: written against the fix, never re-proved
  rig.check(await dm.evaluate('_wmTool === "marker" && document.getElementById("wm-marker").classList.contains("active") && !document.getElementById("btn-select").classList.contains("active")'),
            'a click on Marker did not arm it and light it');
  await dm.evaluate('__tbKey("Escape"); 0');
  // RED BY DESIGN: written against the fix, never re-proved
  rig.check(await dm.evaluate('_wmTool === "select" && !document.getElementById("wm-marker").classList.contains("active") && document.getElementById("btn-select").classList.contains("active")'),
            'Esc did not put the Marker tool down');
  await dm.evaluate('document.getElementById("wm-marker").click(); __tbKey("KeyV"); 0');
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(await dm.evaluate('_wmTool === "select" && !document.getElementById("wm-marker").classList.contains("active")'), 'V did not put the Marker tool down');

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
