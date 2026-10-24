'use strict';

// fog-toolbar.js — A FIRST-TIME DM LIFTS THE FOG, REVEALS A PART, AND CHANGES ONE ROOM.
//
// THE GOAL OF THIS FEATURE: a new DM who cannot get the fog off the TV finds, in front of them, the
// three first fog steps - lift all the fog, reveal or hide a part, change one room's fog - and the
// advanced tools (the repairs, the sizes, the materials) sit one step away. Every control below is
// driven through the page the way the DM drives it.
//
// THE CRITERIA ARE THIS HEADER, numbered as the definition of done they came from. Each has its
// checks under a marker carrying its number, wherever in the file that state is cheapest to reach.
//
//   1.  Reveal all and Hide all are two bare eyes on the bar after a divider, right after Select,
//       Brush and Shape. One click acts on the whole map, rooms included; undo restores it. Scene
//       control no longer shows them. Effects mode keeps them.
//   2.  The picked tool's row starts with the fog mode: three clouds in a well. The lit one sets what
//       the Brush and the next shape draw. Half is absent under the Brush. Select shows no row.
//   3.  A picked room's popup: the same three clouds (a click sets that room's fog), a divider, then
//       the door as a bare button.
//   4.  The first-map toast is gone. The players' view stays (hold H); the minimap
//       carries no button for it.
//   5.  The Shape list holds shapes only, and the Shape button always wears the shape drawn with.
//   6.  Shift merges a drawn shape into every room it touches, Alt cuts it out, Ctrl splits along its
//       edge (Rectangle, Circle) or along an open line (Polygon). Bare, it draws a room. A shape that
//       touches nothing changes nothing. The hidden Split button arms Ctrl with the Polygon.
//   8.  The row ends with one repair icon whose list arms Merge, Cut out or Split, greyed "Needs a
//       room" on a map with none. An armed repair stays armed until its lit icon is clicked, and
//       while one is lit the clouds grey out.
//   9.  The shortcut legend lists Merge Shift, Cut out Alt, Split Ctrl, "while drawing".
//   10. Alt+drag with a shape tool no longer pans the map. Alt+drag under Select still copies.
//   11. Snap to grid and Straight walls are icons with no words, their names in tooltips.
//   12. Effects' row: one material button, then the size field, then Snap, Straight walls and the
//       repair icon. The material buttons are not shown.
//   14. The size field steps one grid square (5 ft) and stops at both ends; its list runs largest
//       first and ends with By hand for the shapes that have it.
//   15. Effects' Shape list: Square, Circle, Cone, Line, Wall, Ring, Polygon; Line and Wall and
//       Ring take a length alone.
//   16. The Effects tool sits right after Room, labelled, blue while the mode is on and its flame in the fire colour
//       while off; the old tab is gone.
//   17. Every well is 30px tall, every divider runs the full height of its strip.
//   20. Every old toolbar button id still exists and still works when clicked.
//
// Look lines (the cloud icons and their colours, the tag by the pointer, the thumb) are marked
// rig.byEye. Column forwarding of a held key (10a) is two windows deep and is marked rig.byEye too.

const lib = require('../../lib');

const MAP_W = 2400, MAP_H = 1500;
const ROOM_A = { x1: 300, y1: 300, x2: 900, y2: 700 };
const ROOM_B = { x1: 1100, y1: 300, x2: 1700, y2: 700 };
const CELL = 100;

const OWN_HELPERS = `
globalThis.__rigBar = () => {
  const bs = [...document.querySelectorAll('#toolbar-bottom button:not(.tb-chev)')]
    .filter(b => !b.closest('#shape-menu') && b.getClientRects().length > 0);
  const r = document.getElementById('toolbar-bottom').getBoundingClientRect();
  return { shown: bs.map(b => b.id || 'dir-' + b.dataset.dir), width: Math.round(r.width * 10) / 10 };
};
globalThis.__rigRow = () => [...document.getElementById('context-row').children].filter(e => e.getClientRects().length > 0).map(e => e.id || e.className);
globalThis.__rigLit = (sel) => [...document.querySelectorAll(sel)].map(b => b.dataset.dir).join();
globalThis.__rigList = (chev) => {
  document.querySelector('[data-chev=' + chev + ']').click();
  const rows = [...document.querySelectorAll('#tb-dd > *')].map(e => ({ cls: e.className, id: e.dataset.dd || null, off: !!e.disabled,
    text: e.textContent.trim().replace(/\\s+/g, ' ') }));
  document.querySelector('[data-chev=' + chev + ']').click();
  return rows;
};
globalThis.__rigPick = (chev, id) => {
  document.querySelector('[data-chev=' + chev + ']').click();
  document.querySelector('#tb-dd [data-dd=' + id + ']').click();
  return 0;
};
globalThis.__rigOpList = () => {
  const ic = document.querySelector('#op-sw .op-chev');
  ic.click();
  const rows = [...document.querySelectorAll('#tb-dd > *')].map(e => ({ cls: e.className, id: e.dataset.dd || null, off: !!e.disabled,
    text: e.textContent.trim().replace(/\\s+/g, ' ') }));
  return rows;
};
globalThis.__rigHoldKey = (key, down, flags) => document.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup',
  Object.assign({ key, bubbles: true, cancelable: true }, flags || {})));
globalThis.__rigRoomTopClient = (id) => {
  const p = polygons.find(q => q.id === id);
  const top = Math.min(...p.vertices.map(v => v.y));
  const s = toScreen(p.vertices[0].x, top);
  return viewToClient(s.sx, s.sy).y;
};
globalThis.__rigDoorCount = () => polygons.reduce((n, p) => n + (p.doors || []).length, 0);
globalThis.__rigAreas = () => polygons.map(p => Math.round(ringArea(p.vertices)));
0`;

module.exports = async function fogToolbarFeature(rig) {
  const dm = rig.dm;

  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await dm.evaluate(OWN_HELPERS);
  await dm.evaluate('setPlaceMode("rooms"); setShapeOp("new"); setShape("select"); 0');
  await lib.settle(dm, '!fogDirty && !viewportDirty', 15000);

  // ── 4. The toast is gone; the players' view stays and wears a TV ──────────
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(await dm.evaluate('!document.getElementById("hidden-map-toast") && typeof firstMapToastCheck === "undefined"'),
            'the first-map toast is still in the page');
  const working = await dm.evaluate('({ alpha: pixiFogLayer.alpha, cursor: getComputedStyle(document.getElementById("cursor-canvas")).visibility })');
  await dm.evaluate('__rigHoldKey("h", true); document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyH", key: "h", bubbles: true })); 0');
  await lib.settle(dm, 'playersViewOn', 3000);
  const held = await dm.evaluate('({ on: playersViewOn, alpha: pixiFogLayer.alpha, cursor: getComputedStyle(document.getElementById("cursor-canvas")).visibility })');
  rig.check(held.on && held.alpha === 1 && working.alpha < 1 && held.cursor === 'hidden',
            'holding H did not put the fog at full strength and hide the room outlines: ' + JSON.stringify([working, held]));
  await dm.evaluate('document.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyH", key: "h", bubbles: true })); 0');
  await lib.settle(dm, '!playersViewOn', 3000);
  // RED BY DESIGN: written against item 217, never re-proved
  // The minimap has no players' view button any more: its right row holds the ··· button, and Sync while live.
  const tvBtns = await dm.evaluate('[...document.querySelectorAll("#tv-ui .tv-row.tr .tv-ov")].map(b => b.title)');
  rig.check(!tvBtns.some(t => /Players/.test(t)), 'the minimap still carries a players view button: ' + JSON.stringify(tvBtns));
  await dm.evaluate('(() => { const i = document.getElementById("door-width-num"); i.focus();' +
                    ' i.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyH", key: "h", bubbles: true })); return 0; })()');
  rig.check(await dm.evaluate('!playersViewOn'), 'H typed in a field turned the players\' view on');
  await dm.evaluate('document.activeElement.blur(); 0');

  // ── 1. The bar: Select, Brush, Shape, a divider, two eyes ─────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const bar0 = await dm.evaluate('__rigBar()');
  rig.check(bar0.shown.join() === 'btn-select,btn-brush,btn-shape,btn-effects,tb-reveal-all,tb-hide-all',
            'the Fog bar is not Select, Brush, Room, Effects, then Reveal all and Hide all: ' + bar0.shown.join(' '));
  const order = await dm.evaluate(`(() => [...document.getElementById('toolbar-bottom').children]
    .filter(e => e.getClientRects().length).map(e => e.id || e.className).join())()`);
  rig.check(/tb-grp-shape,tb-grp-fx,div-whole,tb-whole/.test(order), 'the eyes do not follow Room and Effects after a divider: ' + order);
  const scene = await dm.evaluate(`(() => { const b = document.getElementById('btn-clear-fog');
    return { hidden: b.getClientRects().length === 0, ids: !!document.getElementById('btn-fill-fog') }; })()`);
  rig.check(scene.hidden && scene.ids, 'Scene control still shows the Whole map row, or its ids went: ' + JSON.stringify(scene));
  const widths = [bar0.width];
  for (const pick of ['document.getElementById("btn-brush").click()', 'document.getElementById("btn-select").click()',
                      'document.getElementById("btn-shape").click()', 'document.getElementById("btn-select").click()']) {
    widths.push((await dm.evaluate(pick + '; __rigBar()')).width);
  }
  rig.check(widths.every(w => w === widths[0]), 'the bar changed width while tools were picked: ' + widths.join(' '));

  // ── 2. The clouds set what the next shape draws ───────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check((await dm.evaluate('__rigRow()')).length === 0 || await dm.evaluate('getComputedStyle(document.getElementById("context-row")).visibility') === 'hidden',
            'Select shows an options row');
  await dm.evaluate('setShape("rect"); 0');
  const rowRect = await dm.evaluate('__rigRow()');
  rig.check(rowRect[0] === 'wa-mode' && rowRect.join() === 'wa-mode,div-aids,fx-aids,div-op,op-sw',
            'a shape\'s row is not the clouds, a divider, Snap and Straight walls, a divider and the repair icon: ' + rowRect.join(' '));
  rig.check(await dm.evaluate('__rigLit("#wa-mode .fx-dir.active")') === 'reveal', 'Reveal is not the lit cloud at the start');
  await dm.evaluate('document.querySelector("#wa-mode .fx-dir[data-dir=reveal]").click(); 0');
  await dm.evaluate('__rigDrag(' + [ROOM_A.x1, ROOM_A.y1, ROOM_A.x2, ROOM_A.y2].join(',') + ')');
  await dm.evaluate('document.querySelector("#wa-mode .fx-dir[data-dir=shroud]").click(); 0');
  await dm.evaluate('__rigDrag(' + [ROOM_B.x1, ROOM_B.y1, ROOM_B.x2, ROOM_B.y2].join(',') + ')');
  await dm.evaluate('document.querySelector("#wa-mode .fx-dir[data-dir=half]").click(); __rigDrag(300, 900, 900, 1200); 0');
  const modes = await dm.evaluate('polygons.map(p => p.mode).join()');
  rig.check(modes === 'reveal,shroud,half', 'the lit cloud did not set what each shape drew: ' + modes + ' (wanted reveal,shroud,half)');
  rig.byEye('2: the clouds are a struck-out, a striped and a solid cloud in one soft well; the lit one wears green, teal or purple');
  await dm.evaluate('document.getElementById("btn-select").click(); __rigClick(600, 500); 0');
  const before = await dm.evaluate('({ sel: selectedPolygonId, modes: polygons.map(p => p.mode).join() })');
  await dm.evaluate('document.getElementById("btn-shape").click(); document.querySelector("#wa-mode .fx-dir[data-dir=shroud]").click(); document.getElementById("btn-select").click(); 0');
  const afterClick = await dm.evaluate('({ shape, tool, sel: selectedPolygonId, modes: polygons.map(p => p.mode).join() })');
  rig.check(afterClick.tool === 'shroud' && afterClick.modes === before.modes,
            'a click on a row cloud changed a room, not just the direction: ' + JSON.stringify([before, afterClick]));
  await dm.evaluate('document.getElementById("btn-brush").click(); 0');
  const brush = await dm.evaluate(`({ half: getComputedStyle(document.querySelector('#wa-mode .fx-dir[data-dir=half]')).display,
    row: __rigRow().join(), tool })`);
  rig.check(brush.half === 'none' && brush.tool !== 'half' && brush.row === 'wa-mode,div-brush,panel-brush-bottom',
            'Half is not absent under the Brush, or the Brush row is not the clouds, a divider and the size: ' + JSON.stringify(brush));

  // ── 5. The Shape list holds shapes only ───────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const list = await dm.evaluate('__rigList("shape")');
  rig.check(list.map(r => r.id).filter(Boolean).join() === 'btn-poly,btn-rect,btn-circle,btn-cone,btn-line,btn-wall,btn-ring' &&
            !list.some(r => r.cls === 'dd-sep' || r.cls === 'dd-lbl'),
            'the scene bar\'s Shape list is not the shapes alone: ' + JSON.stringify(list.map(r => r.id || r.cls)));
  await dm.evaluate('__rigPick("shape", "btn-circle"); 0');
  rig.check(await dm.evaluate('shape === "circle" && document.querySelector("#btn-shape .tb-shape-glyph svg").outerHTML === document.querySelector("#btn-circle svg").outerHTML'),
            'the Shape button does not wear the shape drawn with');

  // ── 6. The keys ───────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const undo = async () => { await dm.evaluate('__rigKey("KeyZ", { ctrlKey: true }); 0'); await lib.settle(dm, '!fogTransRafId', 10000); };
  const draw = (x1, y1, x2, y2, mods) => dm.evaluate('setShapeOp("new"); setShape("rect"); __rigDrag(' + [x1, y1, x2, y2].join(',') +
                                                   (mods ? ', { mods: ' + JSON.stringify(mods) + ' }' : '') + '); setShape("select"); polygons.length');
  const n0 = await dm.evaluate('polygons.length');
  rig.check(await draw(500, 400, 1300, 600) === n0 + 1, 'a bare drag over rooms did not draw a room of its own');
  await undo();
  const merged = await draw(500, 400, 1300, 600, { shiftKey: true });
  rig.check(merged === n0 - 1, 'Shift did not merge the shape into the two rooms it touched: ' + merged + ' rooms, was ' + n0);
  await undo();
  await draw(500, 400, 800, 600, { altKey: true });
  rig.check(await dm.evaluate('polygons.filter(p => (p.holes || []).length).length') === 1 && await dm.evaluate('polygons.length') === n0,
            'Alt did not cut the shape out of the room it touched, leaving a hole in it');
  await undo();
  const split = await draw(500, 400, 800, 600, { ctrlKey: true });
  rig.check(split === n0 + 1, 'Ctrl did not split the room along the shape\'s edge into two: ' + split + ' rooms, was ' + n0);
  await undo();
  const nothing = await draw(1900, 900, 2100, 1100, { ctrlKey: true });
  rig.check(nothing === n0, 'a repair that touched nothing changed something: ' + nothing);
  // Ctrl with the Polygon is an open line that splits every room it crosses, finished by a double-click.
  await dm.evaluate('setShape("poly"); __rigClick(600, 250, { mods: { ctrlKey: true } }); __rigClick(600, 750); __rigDbl(600, 750); 0');
  rig.check(await dm.evaluate('polygons.length') === n0 + 1 && await dm.evaluate('!activePolygon'),
            'Ctrl with the Polygon did not draw an open line that split the room it crossed');
  await undo();
  await dm.evaluate('setShape("select"); document.getElementById("btn-cut").click(); 0');
  rig.check(await dm.evaluate('shape === "poly" && shapeOp === "split"'), 'the hidden Split button did not arm Ctrl with the Polygon');
  await dm.evaluate('setShapeOp("new"); setShape("select"); 0');
  rig.byEye('7: a held key shows the repair on the drawn outline and in a tag by the pointer: Merge green, Cut out red, Split yellow');

  // ── 8. The repair icon ────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('setShape("rect"); 0');
  const rows = await dm.evaluate('__rigOpList()');
  rig.check(rows.map(r => r.id).filter(Boolean).join() === 'join,trim,split' && rows[0].text === 'Change the rooms it touches',
            'the repair list is not headed "Change the rooms it touches" over Merge, Cut out and Split: ' + JSON.stringify(rows));
  rig.check(rows.filter(r => r.id).every(r => !r.off), 'with rooms the repairs are greyed');
  await dm.evaluate('document.querySelector("#tb-dd [data-dd=trim]").click(); 0');
  const armed = await dm.evaluate(`({ op: shapeOp, cls: document.querySelector('#op-sw .op-wrap').className,
    clouds: [...document.querySelectorAll('#wa-mode .fx-dir')].map(b => b.disabled).join() })`);
  rig.check(armed.op === 'trim' && /op-trim/.test(armed.cls) && armed.clouds === 'true,true,true',
            'arming Cut out did not light the icon red and grey the clouds: ' + JSON.stringify(armed));
  await dm.evaluate('setShape("circle"); setShape("rect"); 0');
  rig.check(await dm.evaluate('shapeOp') === 'trim', 'an armed repair did not stay armed across a shape pick');
  // The chevron opens the list over an armed repair, ticks it and leaves it armed; the icon puts it down.
  const open = await dm.evaluate(`(() => { document.querySelector('#op-sw .op-chev').click();
    const rows = [...document.querySelectorAll('#tb-dd .dd-it')].map(r => ({ id: r.dataset.dd, tick: r.querySelector('.ck').textContent }));
    const o = { rows, op: shapeOp, nock: document.getElementById('tb-dd').classList.contains('nock') };
    document.querySelector('#op-sw .op-chev').click(); return o; })()`);
  rig.check(open.op === 'trim' && open.rows.filter(r => r.tick === '✓').map(r => r.id).join() === 'trim' && !open.nock,
            'the chevron did not open the list over the armed Cut out with its tick, leaving it armed: ' + JSON.stringify(open));
  const rest = await dm.evaluate(`(() => { document.querySelector('#op-sw .op-ic').click(); const o = { op: shapeOp };
    document.querySelector('#op-sw .op-chev').click(); o.nock = document.getElementById('tb-dd').classList.contains('nock');
    o.hidden = getComputedStyle(document.querySelector('#tb-dd .ck')).display === 'none'; document.querySelector('#op-sw .op-chev').click(); return o; })()`);
  rig.check(rest.op === 'new', 'clicking the lit icon did not disarm the repair');
  rig.check(rest.nock && rest.hidden, 'a list with nothing picked still reserves an empty column for the tick: ' + JSON.stringify(rest));
  await dm.evaluate('__rigHoldKey("Shift", true, { shiftKey: true }); 0');
  rig.check(await dm.evaluate('/op-join/.test(document.querySelector("#op-sw .op-wrap").className)'), 'a held Shift did not light the icon green');
  await dm.evaluate('__rigHoldKey("Shift", false); 0');
  await dm.evaluate('setRemoteRepairKey("split"); 0');
  rig.check(await dm.evaluate('/op-split/.test(document.querySelector("#op-sw .op-wrap").className)'),
            'a key reported by a column did not light the shell\'s icon');
  await dm.evaluate('setRemoteRepairKey(null); setShape("select"); 0');
  rig.byEye('10a: with two maps on, a key held while drawing in a column lights the bar\'s icon the same way');

  // ── 3. The room's popup ───────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('setShape("select"); __rigClick(600, 500); 0');
  await lib.settle(dm, 'getComputedStyle(document.getElementById("room-fog")).display !== "none"', 5000);
  const sw = await dm.evaluate(`(() => {
    const el = document.getElementById('room-fog'), b = el.getBoundingClientRect();
    return { eyes: [...el.querySelectorAll('.fx-dir')].map(x => x.dataset.dir).join(), sep: !!el.querySelector('.tb-mdiv'),
             door: !!el.querySelector('.rf-door'), bare: el.querySelector('.rf-door').classList.contains('tool-btn'),
             lit: __rigLit('#room-fog .fx-dir.active'), mode: polygons.find(p => p.id === selectedPolygonId).mode,
             well: Math.round(el.querySelector('.fx-track').getBoundingClientRect().height), bottom: b.bottom,
             top: __rigRoomTopClient(selectedPolygonId) };
  })()`);
  rig.check(sw.eyes === 'reveal,half,shroud' && sw.sep && sw.door && sw.bare && sw.lit === sw.mode,
            'the popup is not three clouds, a divider and a bare door, with the room\'s own fog lit: ' + JSON.stringify(sw));
  rig.check(sw.bottom <= sw.top + 1, 'the room\'s popup is not just above the room: ' + JSON.stringify(sw));
  const tool0 = await dm.evaluate('tool');
  await dm.evaluate('document.querySelector("#room-fog .fx-dir[data-dir=half]").click(); 0');
  const after = await dm.evaluate('({ mode: polygons.find(p => p.id === selectedPolygonId).mode, tool, lit: __rigLit("#room-fog .fx-dir.active") })');
  rig.check(after.mode === 'half' && after.lit === 'half' && after.tool === tool0,
            'the popup\'s cloud did not set that room\'s fog alone: ' + JSON.stringify(after));
  await dm.evaluate('__rigKey("KeyT"); 0');
  rig.check(await dm.evaluate('polygons.find(p => p.id === selectedPolygonId).mode') === 'reveal', 'T did not cycle the selected room\'s fog');
  await dm.evaluate('__rigMouse("mousedown", 600, 500); __rigMouse("mousemove", 640, 530); 0');
  const dragging = await dm.evaluate('getComputedStyle(document.getElementById("room-fog")).display');
  await dm.evaluate('__rigMouse("mouseup", 640, 530, { onWindow: true }); 0');
  await lib.settle(dm, 'getComputedStyle(document.getElementById("room-fog")).display !== "none"', 5000);
  rig.check(dragging === 'none', 'the popup stayed up while the room was dragged');
  await dm.evaluate('(() => { const s = document.getElementById("grid-size"); s.value = ' + CELL +
                    '; s.dispatchEvent(new Event("input", { bubbles: true })); return 0; })()');
  await dm.evaluate('document.querySelector("#room-fog .rf-door").click(); 0');
  rig.check(await dm.evaluate('shape') === 'door' && await dm.evaluate('document.querySelector("#room-fog .rf-door").classList.contains("active")'),
            'the popup\'s door button did not arm the Door tool and light');
  const wall = await dm.evaluate('Math.max(...polygons.find(p => p.id === selectedPolygonId).vertices.map(v => v.x))');
  await dm.evaluate('__rigClick(' + wall + ', 450); 0');
  rig.check(await dm.evaluate('__rigDoorCount()') === 1, 'a click on the wall did not place a door');
  await dm.evaluate('__rigClick(' + wall + ', 450); 0');
  rig.check(await dm.evaluate('__rigDoorCount()') === 0, 'a second click on the door did not remove it');
  await dm.evaluate('__rigKey("Escape"); 0');
  rig.check(await dm.evaluate('shape === "select" && selectedPolygonId != null'), 'Esc did not end the Door tool and keep the room');
  rig.byEye('3: the popup is the row\'s surface: clouds in the well, a full-height divider, the door as a bare tool');

  // ── 1 (again). Whole map ──────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const keep = await dm.evaluate('polygons.map(p => p.mode).join()');
  await dm.evaluate('document.getElementById("tb-hide-all").click(); 0');
  await lib.settle(dm, '!fogTransRafId', 10000);
  const hidden = await dm.evaluate('({ modes: polygons.map(p => p.mode).join(), fog: __rigFog(600, 500) })');
  rig.check(/^(shroud,?)+$/.test(hidden.modes) && hidden.fog > 200,
            'Hide all did not hide every room and the ground under them: ' + JSON.stringify(hidden));
  await undo();
  rig.check(await dm.evaluate('polygons.map(p => p.mode).join()') === keep, 'undo did not put the rooms back after Hide all');
  // RED ON: revealAllMap's confirmDialog removed (toolbar.js) - 2026-10-16
  const asked = await dm.evaluate('(() => { document.getElementById("tb-reveal-all").click();' +
    ' return { up: !!_cdRoot && _cdRoot.style.display === "flex", kept: polygons.map(p => p.mode).join() }; })()');
  rig.check(asked.up && asked.kept === keep, 'Reveal all in Auto sync acted without asking: ' + JSON.stringify(asked));
  await dm.evaluate('document.getElementById("cd-cancel").click(); 0');
  rig.check(await dm.evaluate('polygons.map(p => p.mode).join()') === keep, 'Cancel on the Reveal all question revealed anyway');
  // RED ON: `if (!autoSync)` dropped from revealAllMap (toolbar.js) - 2026-10-16
  const manual = await dm.evaluate('(() => { autoSync = false; document.getElementById("tb-reveal-all").click();' +
    ' const r = { up: _cdRoot.style.display === "flex", modes: polygons.map(p => p.mode).join() };' +
    ' if (r.up) document.getElementById("cd-cancel").click(); undo(); autoSync = true; return r; })()');
  rig.check(!manual.up && /^(reveal,?)+$/.test(manual.modes), 'Reveal all in Manual sync asked, or did not reveal: ' + JSON.stringify(manual));
  await lib.settle(dm, '!fogTransRafId', 10000);
  rig.check(await dm.evaluate('polygons.map(p => p.mode).join()') === keep, 'undo did not put the rooms back after the Manual Reveal all');
  await dm.evaluate('document.getElementById("tb-reveal-all").click(); document.getElementById("cd-ok").click(); 0');
  await lib.settle(dm, '!fogTransRafId', 10000);
  const shown = await dm.evaluate('({ modes: polygons.map(p => p.mode).join(), fog: __rigFog(1400, 500) })');
  rig.check(/^(reveal,?)+$/.test(shown.modes) && shown.fog < 60, 'Reveal all did not reveal every room: ' + JSON.stringify(shown));

  // ── 9. The legend ─────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const legend = await dm.evaluate(`(() => { const b = document.getElementById('legend-win');
    const subs = [...b.querySelectorAll('.sm-sub')].map(e => e.textContent);
    const rows = [...b.querySelectorAll('.lg-row')].map(r => r.textContent.replace(/\\s+/g, ' ').trim());
    return { subs, rows }; })()`);
  rig.check(legend.subs.includes('While drawing') && ['MergeShift', 'CutoutAlt', 'SplitCtrl'].every(r => legend.rows.map(x => x.replace(/\s+/g, '')).includes(r)),
            'the legend lacks Merge Shift, Cut out Alt, Split Ctrl under "While drawing": ' + JSON.stringify(legend));

  // ── 10. Alt no longer pans under a shape tool ─────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('setShape("rect"); 0');
  const pan0 = await dm.evaluate('[panX, panY]');
  await dm.evaluate('__rigMouse("mousedown", 1800, 1100, { mods: { altKey: true } }); __rigMouse("mousemove", 1700, 1000, { mods: { altKey: true } }); __rigMouse("mouseup", 1700, 1000, { mods: { altKey: true }, onWindow: true }); 0');
  rig.check(JSON.stringify(await dm.evaluate('[panX, panY]')) === JSON.stringify(pan0), 'Alt+drag with a shape tool still panned the map');
  await dm.evaluate('setShape("select"); 0');

  // ── 11 and 17. Icons, wells and dividers ──────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('setShape("rect"); 0');
  const look = await dm.evaluate(`(() => {
    const t = id => document.getElementById(id);
    const row = t('context-row').getBoundingClientRect();
    const divs = [...document.querySelectorAll('#context-row .tb-mdiv')].filter(d => d.getClientRects().length).map(d => d.getBoundingClientRect());
    const well = document.querySelector('#wa-mode .fx-track').getBoundingClientRect();
    const z = row.width / t('context-row').offsetWidth || 1;
    return { words: t('btn-snap').textContent.trim() + t('btn-axislock').textContent.trim(), tips: [t('btn-snap').title, t('btn-axislock').title],
             wellH: Math.round(well.height / z), divFull: divs.length > 0 && divs.every(d => Math.abs(d.height - (row.height - 2 * z)) <= 2 * z),
           };
  })()`);
  rig.check(look.words === '' && look.tips.every(Boolean), 'Snap and Straight walls carry words, or lost their tooltips: ' + JSON.stringify(look));
  rig.check(look.wellH === 30, 'a well is not 30px tall: ' + JSON.stringify(look));
  rig.check(look.divFull, 'a divider in the row does not run the full height of the row');
  rig.byEye('11, 17: the snap and straight-wall icons read as a grid with a point and a right angle; wells and dividers share one rhythm');
  await dm.evaluate('setShape("select"); 0');

  // ── 12, 14, 15. Effects' row ──────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('document.getElementById("btn-place-effects").click(); 0');
  rig.check(await dm.evaluate('__rigBar().shown.join()') === 'btn-select,btn-brush,btn-shape,btn-effects,tb-reveal-all,tb-hide-all',
            'Effects changed the set of tools on the bar: ' + await dm.evaluate('__rigBar().shown.join()'));
  // Room's arrow is greyed and inert in Effects; the shapes are the row's well, and Effects has no arrow.
  rig.check(await dm.evaluate('document.querySelector("[data-chev=shape]").click(); !document.getElementById("tb-dd")'),
            'Room\'s arrow opened a list in Effects mode, where it is greyed');
  const fxWell = await dm.evaluate('[...document.querySelectorAll("#fx-shapes .fx-shape")].map(b => b.title.replace(/ \\(.\\)$/, "")).join()');
  rig.check(fxWell === 'Square,Circle,Cone,Line,Wall,Ring,Polygon' && await dm.evaluate('!document.querySelector("#tb-grp-fx .tb-chev")'),
            'the Effects row well is not Square, Circle, Cone, Line, Wall, Ring, Polygon, or Effects kept an arrow: ' + fxWell);
  await dm.evaluate('setShape("circle"); 0');
  rig.check((await dm.evaluate('__rigRow()')).join() === 'fx-shapes,div-fx-shapes,ctx-effects,ctx-presets,div-aids,fx-aids,div-op,op-sw',
            'Effects\' row is not the shape well, a divider, the material, the size, a divider, Snap, Straight walls, a divider and the repair icon: ' + (await dm.evaluate('__rigRow()')).join(' '));
  rig.check(await dm.evaluate('document.querySelector("#material-row").getClientRects().length === 0 && document.querySelectorAll("#mat-pick button").length === 2'),
            'the material buttons are still in the row, or the one button and its chevron are not');
  await dm.evaluate('document.querySelector("#mat-pick .mt-btn").click(); 0');
  const pal = await dm.evaluate('({ names: [...document.querySelectorAll("#mat-grid .mt-tile")].map(b => b.textContent.trim()).join(), find: !!document.getElementById("mat-find") })');
  rig.check(pal.names === 'Fire,Acid,Light' && pal.find, 'the palette is not a find field over Fire, Acid and Light: ' + JSON.stringify(pal));
  await dm.evaluate('document.querySelector("#mat-grid [data-material=acid]").click(); 0');
  rig.check(await dm.evaluate('currentMaterial') === 'acid', 'picking Acid in the palette did not set the material');
  await dm.evaluate('setMaterial("fire"); 0');
  const sizes = await dm.evaluate(`(() => {
    setShape('circle'); setPreset(null);
    const out = {};
    stepPreset(1); out.up = presetArmed && presetArmed.s;
    stepPreset(-1); out.hand = presetArmed;
    stepPreset(-1); out.stay = presetArmed;
    for (let i = 0; i < 40; i++) stepPreset(1); out.max = presetArmed.s;
    stepPreset(1); out.stayMax = presetArmed.s;
    const field = document.querySelector('#ctx-presets .sz-in'); field.value = '23'; field.dispatchEvent(new Event('change'));
    out.typed = presetArmed.s;
    document.querySelector('#ctx-presets .sz-chev').click();
    out.list = [...document.querySelectorAll('#tb-dd .dd-it')].map(r => r.textContent.trim().replace(/\\s+/g, ' '));
    document.querySelector('#ctx-presets .sz-chev').click();
    return out;
  })()`);
  rig.check(sizes.up === 5 && sizes.hand === null && sizes.stay === null && sizes.max === 60 && sizes.stayMax === 60 && sizes.typed === 25,
            'the size field does not step one square at a time, stop at both ends and snap a typed size: ' + JSON.stringify(sizes));
  rig.check(sizes.list[0] === '60 ft · 12 squares' && sizes.list[sizes.list.length - 1] === 'By hand' && sizes.list[sizes.list.length - 2] === '5 ft · 1 square',
            'the size list is not largest first, ending in By hand: ' + JSON.stringify(sizes.list));
  const noHand = await dm.evaluate(`(() => { const out = {};
    for (const k of ['line', 'wall', 'ring']) { setShape(k); out[k] = presetArmed && presetArmed.w; document.querySelector('#ctx-presets .sz-chev').click();
      out[k + 'List'] = [...document.querySelectorAll('#tb-dd .dd-it')].pop().textContent.trim(); document.querySelector('#ctx-presets .sz-chev').click(); }
    return out; })()`);
  rig.check(noHand.line === 5 && noHand.wall === 1 && noHand.ring === 1 && !/By hand/.test(noHand.lineList + noHand.wallList + noHand.ringList),
            'Line is not one square wide, Wall and Ring one foot thick, taking a length alone: ' + JSON.stringify(noHand));
  const wallDrawn = await dm.evaluate(`(() => { setShape('wall'); setPreset({ kind: 'wall', s: 30, w: 1 }); const n = effects.length;
    __rigDrag(600, 600, 900, 600); const e = effects[effects.length - 1];
    const ys = e.vertices.map(v => v.y), xs = e.vertices.map(v => v.x);
    return { added: effects.length - n, h: Math.max(...ys) - Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), cell: gridSize }; })()`);
  rig.check(wallDrawn.added === 1 && Math.abs(wallDrawn.h - wallDrawn.cell / 5) < 0.01 && Math.abs(wallDrawn.w - 30 * wallDrawn.cell / 5) < 0.01,
            'a placed Wall is not 1 ft thick and its length long: ' + JSON.stringify(wallDrawn));
  await dm.evaluate('document.getElementById("btn-select").click(); 0');

  // ── 16. The Effects tool ──────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const tab = await dm.evaluate(`(() => {
    const seg = document.querySelector('.tb-seg'), fx = document.getElementById('btn-effects'), room = document.getElementById('btn-shape');
    const f = fx.getBoundingClientRect(), r = room.getBoundingClientRect(), bar = document.getElementById('toolbar-bottom').getBoundingClientRect();
    return { seg: seg.getClientRects().length, word: fx.querySelector('.tb-shape-label').textContent.trim(), labeled: fx.classList.contains('tb-labeled'),
             after: f.left > r.right && f.left - r.right < 40, inside: f.left >= bar.left && f.right <= bar.right,
             flame: getComputedStyle(fx.querySelector('.tb-shape-glyph')).color, ids: !!document.getElementById('btn-place-rooms') && !!document.getElementById('btn-place-effects'),
             barC: (bar.left + bar.right) / 2, win: innerWidth };
  })()`);
  rig.check(tab.seg === 0 && tab.word === 'Effects' && tab.labeled && tab.after && tab.inside && tab.ids,
            'the Effects tool is not a labelled flame button right after Room, with the old switch gone: ' + JSON.stringify(tab));
  rig.check(Math.abs(tab.barC - tab.win / 2) < 2, 'the bar is off the window\'s centre: ' + JSON.stringify(tab));
  await dm.evaluate('document.getElementById("btn-place-rooms").click(); 0');
  rig.check(await dm.evaluate('!document.body.classList.contains("mode-fx") && placeMode === "rooms"'), 'the hidden Fog back end did not return to Fog');
  rig.check(await dm.evaluate('getComputedStyle(document.querySelector("#btn-effects .tb-shape-glyph")).color') === 'rgb(255, 138, 61)',
            'the Effects flame does not wear the fire colour with the mode off');
  rig.byEye('16: Effects wears a flame in the fire colour and the word; while the mode is on the bar burns, and Brush and Room are grey in place');

  // ── 20. Every old id still exists and still works ─────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const old = await dm.evaluate(`(() => {
    const ids = ['btn-select', 'btn-brush', 'btn-shape', 'btn-poly', 'btn-rect', 'btn-circle', 'btn-cone', 'btn-line', 'btn-ring',
      'btn-reveal', 'btn-half', 'btn-shroud', 'btn-door', 'btn-cut', 'btn-op-join', 'btn-op-trim', 'btn-snap', 'btn-axislock',
      'btn-effects', 'btn-place-rooms', 'btn-place-effects', 'btn-clear-fog', 'btn-fill-fog', 'brush-size'];
    return { missing: ids.filter(id => !document.getElementById(id)) };
  })()`);
  rig.check(old.missing.length === 0, 'toolbar ids that went missing: ' + old.missing.join(', '));
  const clicks = await dm.evaluate(`(() => {
    const out = {};
    document.getElementById('btn-door').click();  out.door = shape;
    document.getElementById('btn-cut').click();   out.cut = shape + '/' + shapeOp;
    setShapeOp('new');
    document.getElementById('btn-brush').click(); out.brush = shape;
    document.getElementById('btn-op-join').click(); out.join = shapeOp;
    document.getElementById('btn-op-join').click(); out.joinOff = shapeOp;
    document.getElementById('btn-op-trim').click(); out.trim = shapeOp;
    document.getElementById('btn-op-trim').click();
    document.getElementById('btn-select').click();
    setShape('rect');
    document.getElementById('btn-shroud').click(); out.shroud = tool;
    document.getElementById('btn-reveal').click(); out.reveal = tool;
    const s = snapToGrid; document.getElementById('btn-snap').click(); out.snap = snapToGrid !== s; document.getElementById('btn-snap').click();
    const a = axisLock; document.getElementById('btn-axislock').click(); out.axis = axisLock !== a; document.getElementById('btn-axislock').click();
    return out;
  })()`);
  rig.check(clicks.door === 'door' && clicks.cut === 'poly/split' && clicks.brush === 'brush' && clicks.join === 'join' &&
            clicks.joinOff === 'new' && clicks.trim === 'trim' && clicks.shroud === 'shroud' && clicks.reveal === 'reveal' &&
            clicks.snap && clicks.axis,
            'an old toolbar id no longer drives the back end when clicked: ' + JSON.stringify(clicks));

  // ── The world map keeps its own bar ───────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('setShapeOp("new"); setShape("select"); document.getElementById("btn-world").click(); 0');
  await lib.settle(dm, 'worldMapOpen', 10000);
  const world = await dm.evaluate(`(() => {
    const bar = [...document.getElementById('toolbar-bottom').children].filter(el => getComputedStyle(el).display !== 'none')
      .map((el, i) => ({ id: el.id, i, o: parseInt(getComputedStyle(el).order, 10) || 0 }))
      .sort((a, b) => a.o - b.o || a.i - b.i).map(x => x.id);
    return { bar, tab: document.querySelector('.tb-seg').getClientRects().length, brush: document.getElementById('btn-brush').getClientRects().length,
             eyes: document.getElementById('tb-whole').getClientRects().length };
  })()`);
  rig.check(world.bar.join() === 'btn-select,wm-add,tb-grp-shape,wm-div,wm-find' && world.tab === 0 && world.brush === 0 && world.eyes === 0,
            'the world map\'s bar is not Select, Add, Place, a divider and Find, with no eyes, tab or Brush: ' + JSON.stringify(world));
  const worldList = await dm.evaluate('__rigList("shape")');
  rig.check(worldList.filter(Boolean).map(r => r.id).filter(Boolean).join() === 'btn-rect,btn-circle,btn-poly,wm-road',
            'the world map\'s Place list is not Rectangle, Circle, Polygon and Road: ' + JSON.stringify(worldList.map(r => r.id)));
  await dm.evaluate('document.getElementById("btn-world").click(); 0');
  await lib.settle(dm, '!worldMapOpen', 10000);

  rig.note('bar width ' + bar0.width + 'px');
};
