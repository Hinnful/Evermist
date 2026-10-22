'use strict';

// hints-first-use.js — THE FIRST-USE HINTS: the empty world map's callout, then the toasts a first map teaches.
// Covers src/ui/hintsFirstMap.js, hints.js and hints.css.
//
//   A. The empty Campaign's call to action says what a map can be.
//   B. A first map opened shows "Reveal part of the map" centred above the Brush, which blinks, recorded as seen.
//   C. Picking another tool closes it and stops the blink.
//   C3. The Rooms hint stays away while a brush stroke is still going.
//   C2. There is no one-per-run limit: the Rooms hint shows in the same run, once the first brush stroke ends.
//   D. A first room that touches no other shows "Edit this room" with its arrow touching it, Select blinking.
//   D2. It follows the room when the camera pans.
//   D3. Picking the room with Select lays out its fog-clouds popup, and the toast stays off it.
//   D4. Nor does the toast move when that popup comes up: it sits below the room from the start.
//   E. Double-clicking into the room closes it, and no repair-keys toast shows on entering edit mode.
//   R. A second room drawn over the first shows "Cut, merge or split rooms" with its arrow touching that room, off the dock, bar
//      and minimap, the repair icon blinking (not the Shape button), and no room-edit toast beside it.
//   R2. Picking a tool that is not a shape closes it.
//   R3. Drawing the next shape closes it.
//   J. A room drawn against the bottom edge puts its toast above it, arrow still touching.
//   K. Deleting that room closes it.
//   L. A hint falling due while another is up replaces it, and the old one's blink stops.
//   H. The world map closes a toast that is up.
//   I. So does switching to another scene.
//
// The arrow's tip sits 6px past the toast's edge, on the side that faces the spot.

const lib = require('../../lib');

const TIP_MAX = 24;
const up = id => '!!document.querySelector(".hintcall-' + id + '")';
const PAGE = `
globalThis.__hfRead = (id, btn) => {
  const h = document.querySelector('.hintcall-' + id);
  if (!h) return null;
  const r = h.getBoundingClientRect(), s = r.width / h.offsetWidth, a = parseFloat(h.style.getPropertyValue('--a')) * s;
  const side = ['above', 'below', 'right', 'left'].find(k => h.classList.contains('hc-' + k));
  const tip = { above: { x: r.left + a, y: r.bottom + 6 }, below: { x: r.left + a, y: r.top - 6 },
                right: { x: r.left - 6, y: r.top + a }, left: { x: r.right + 6, y: r.top + a } }[side];
  const c = document.getElementById('canvas-container').getBoundingClientRect();
  const hit = n => { const e = document.getElementById(n), o = e && e.getBoundingClientRect();
    return !!o && o.width > 0 && r.left < o.right && r.right > o.left && r.top < o.bottom && r.bottom > o.top; };
  return { text: h.textContent, side, tip,
    inside: r.left >= c.left && r.top >= c.top && r.right <= c.right && r.bottom <= c.bottom,
    onChrome: hit('dock') || hit('toolbar-bottom') || hit('minimap-panel'),
    seen: localStorage.getItem('evermist.hintsSeen'), blink: document.getElementById(btn).classList.contains('hintcall-blink') };
};
globalThis.__hfOver = (id, btn) => {
  const h = document.querySelector('.hintcall-' + id), b = document.getElementById(btn);
  if (!h) return null;
  const r = h.getBoundingClientRect(), a = b.getBoundingClientRect();
  return { text: h.textContent, above: r.bottom <= a.top, dx: Math.abs((r.left + r.width / 2) - (a.left + a.width / 2)),
    seen: localStorage.getItem('evermist.hintsSeen'), blink: b.classList.contains('hintcall-blink') };
};
globalThis.__hfPopupOver = id => {
  const p = document.getElementById('room-fog'), h = document.querySelector('.hintcall-' + id);
  if (!p || !h || !p.getClientRects().length) return null;
  const a = p.getBoundingClientRect(), r = h.getBoundingClientRect();
  return { over: r.left < a.right && r.right > a.left && r.top < a.bottom && r.bottom > a.top };
};
// A room drawn and the shape tool left in hand, as a DM does it (__rigDrawRoom picks Select after).
globalThis.__hfDraw = (x1, y1, x2, y2) => {
  setShapeOp('new'); setShape('rect'); document.getElementById('btn-reveal').click(); __rigDrag(x1, y1, x2, y2);
  return polygons[polygons.length - 1].id;
};
globalThis.__hfRoomBox = id => {
  const p = polygons.find(q => q.id === id); let l = 1e9, r = -1e9, t = 1e9, b = -1e9;
  for (const v of p.vertices) { const s = toScreen(v.x, v.y), c = viewToClient(s.sx, s.sy); l = Math.min(l, c.x); r = Math.max(r, c.x); t = Math.min(t, c.y); b = Math.max(b, c.y); }
  return { l, r, t, b };
};
0`;

// Distance from a point to a box, 0 inside it.
const away = (p, b) => Math.hypot(Math.max(b.l - p.x, 0, p.x - b.r), Math.max(b.t - p.y, 0, p.y - b.b));

module.exports = async function hintsFirstUse(rig) {
  const dm = rig.dm;
  const gone = id => lib.settle(dm, '!' + up(id), 8000);
  const seen = list => dm.evaluate('localStorage.setItem("evermist.hintsSeen", ' + JSON.stringify(JSON.stringify(list)) + '); 0');

  // A. RED ON: the callout's line reverted to "Add the maps for your game here. Double-click one…" (index.html)
  await lib.settle(dm, 'worldMapOpen && !_wmAnim', 30000);
  const callout = await dm.evaluate('document.getElementById("wm-empty").textContent');
  rig.check(/Any image or video of a map/.test(callout), 'the empty Campaign call to action does not say what a map can be: ' + callout);

  await dm.evaluate(PAGE);
  await lib.openMap(rig, { w: 2400, h: 1500 });
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');

  // B. RED ON: the reveal toast anchored with _hfAtRoom(0) instead of _hintPlaceOver('btn-brush') (hintsFirstMap.js)
  await lib.settle(dm, up('reveal'), 8000);
  const reveal = await dm.evaluate('__hfOver("reveal", "btn-brush")');
  rig.check(reveal && /Reveal part of the map/.test(reveal.text) && /Pick the Brush and paint/.test(reveal.text),
    'opening a first map showed no reveal toast: ' + JSON.stringify(reveal));
  rig.check(reveal && reveal.above && reveal.dx < 3, 'the reveal toast is not centred just above the Brush: ' + JSON.stringify(reveal));
  rig.check(reveal && reveal.seen === '["reveal"]' && reveal.blink, 'the reveal toast was not recorded as seen, or the Brush does not blink: ' + JSON.stringify(reveal));

  // C. RED ON: hintsFirstSync's if (!select) hintClose('reveal') removed (hintsFirstMap.js)
  await dm.evaluate('setShape("brush"); 0');
  await gone('reveal');
  rig.check(!(await dm.evaluate(up('reveal'))), 'picking the Brush did not close the reveal toast');
  rig.check(!(await dm.evaluate('document.getElementById("btn-brush").classList.contains("hintcall-blink")')),
    'the Brush kept blinking after the reveal toast closed');

  // C3. RED ON: hintsRoomsAsk() moved back to toolBrushStart (toolBrush.js)
  await dm.evaluate('__rigMouse("mousedown", 300, 300); __rigMouse("mousemove", 360, 330); 0');
  await lib.hold(800, 'a toast shown mid-stroke would be up by now');
  rig.check(!(await dm.evaluate(up('rooms'))), 'the Rooms hint showed while the brush stroke was still going');

  // C2. RED ON: _hintsMayShow refusing once any hint is recorded as seen (hints.js)
  await dm.evaluate('__rigMouse("mousemove", 420, 360); __rigMouse("mouseup", 420, 360); 0');
  await lib.settle(dm, up('rooms'), 8000);
  const rooms = await dm.evaluate('__hfOver("rooms", "btn-shape")');
  rig.check(rooms && /Show one room at a time/.test(rooms.text) && rooms.seen === '["reveal","rooms"]',
    'the Rooms hint did not show in the same run as the reveal hint: ' + JSON.stringify(rooms));

  // D. RED ON: hintsRoomDrawn's room-edit _hintShow removed (hintsFirstMap.js)
  const id = await dm.evaluate('__rigDrawRoom("reveal", 700, 500, 1300, 900)');
  await lib.settle(dm, up('room-edit'), 8000);
  const edit = await dm.evaluate('__hfRead("room-edit", "btn-select")');
  const box = await dm.evaluate('__hfRoomBox(' + id + ')');
  rig.check(edit && /Edit this room/.test(edit.text) && /Pick Select, then double-click the room to move its corners/.test(edit.text),
    'drawing a room showed no room-edit toast: ' + JSON.stringify(edit));
  rig.check(edit && away(edit.tip, box) <= TIP_MAX, 'the room-edit toast\'s arrow does not touch the room: ' + JSON.stringify({ edit, box }));
  rig.check(edit && edit.inside && !edit.onChrome, 'the room-edit toast sits outside the map or over the dock, bar or minimap: ' + JSON.stringify(edit));
  rig.check(edit && edit.seen === '["reveal","rooms","room-edit"]' && edit.blink, 'the room-edit toast was not recorded, or Select does not blink: ' + JSON.stringify(edit));
  rig.check(!(await dm.evaluate(up('repair-keys'))), 'a room touching no other showed the repair-keys toast');

  // D2. RED ON: hintsFirstPlace() removed from hintsFirstSync (hintsFirstMap.js)
  await dm.evaluate('panX += 60; panY += 40; pixiSetViewport(zoom, panX, panY); viewportDirty = true; cursorDirty = true; scheduleRender(); 0');
  await lib.settle(dm, 'Math.abs(__hfRoomBox(' + id + ').l - ' + box.l + ') > 30', 8000);
  await lib.hold(500, 'the toast, if it follows, has repainted by now');
  const moved = await dm.evaluate('__hfRead("room-edit", "btn-select")');
  rig.check(moved && away(moved.tip, await dm.evaluate('__hfRoomBox(' + id + ')')) <= TIP_MAX,
    'the room-edit toast did not follow its room when the camera panned: ' + JSON.stringify(moved));

  // D3. RED ON: hintsFirstPlace() removed from refreshRoomSwitcher (roomSwitcher.js)
  // The popup lays out in the same frame as the pick, after the toast placed itself.
  const before = await dm.evaluate('__hfRead("room-edit", "btn-select")');
  await dm.evaluate('setShape("select"); __rigClick(1000, 700); 0');
  await lib.settle(dm, '!!document.getElementById("room-fog") && document.getElementById("room-fog").getClientRects().length > 0', 8000);
  await lib.hold(600, 'the popup has laid out and the toast, if it dodges, has repainted');
  const pop = await dm.evaluate('__hfPopupOver("room-edit")');
  rig.check(pop && !pop.over, 'the room-edit toast covers the picked room\'s fog-clouds popup, or the popup is not up: ' + JSON.stringify(pop));
  // D4. RED ON: _hfPlace trying above before below (hintsFirstMap.js)
  const after = await dm.evaluate('__hfRead("room-edit", "btn-select")');
  rig.check(before && after && before.side === after.side && Math.hypot(after.tip.x - before.tip.x, after.tip.y - before.tip.y) < 4,
    'the room-edit toast jumped when the room was picked and its popup came up: ' + JSON.stringify({ before, after }));

  // E. RED ON: the shapeEditMode close of room-edit removed from hintsFirstSync (hintsFirstMap.js)
  await dm.evaluate('__rigDbl(1000, 700); 0');
  await lib.settle(dm, 'shapeEditMode', 8000);
  await gone('room-edit');
  rig.check(!(await dm.evaluate(up('room-edit'))), 'entering edit mode did not close the room-edit toast');
  await lib.hold(800, 'a repair-keys toast, if edit mode still raised one, would be up by now');
  rig.check(!(await dm.evaluate(up('repair-keys'))), 'entering edit mode showed the repair-keys toast');

  // R. RED ON: hintsRoomDrawn's touches branch inverted (hintsFirstMap.js)
  const over = await dm.evaluate('__hfDraw(1000, 700, 1600, 1100)');
  await lib.settle(dm, up('repair-keys'), 8000);
  const repair = await dm.evaluate('__hfRead("repair-keys", "op-sw")');
  const obox = await dm.evaluate('__hfRoomBox(' + over + ')');
  rig.check(repair && /Cut, merge or split rooms/.test(repair.text) && /Hold Shift while you draw to merge a shape into the rooms it touches, Alt to cut it out, or Ctrl to split them/.test(repair.text),
    'a room drawn over another showed no repair-keys toast: ' + JSON.stringify(repair));
  rig.check(repair && away(repair.tip, obox) <= TIP_MAX, 'the repair-keys toast\'s arrow does not touch the new room: ' + JSON.stringify({ repair, obox }));
  rig.check(repair && repair.inside && !repair.onChrome, 'the repair-keys toast sits outside the map or over the dock, bar or minimap: ' + JSON.stringify(repair));
  rig.check(repair && repair.seen === '["reveal","rooms","room-edit","repair-keys"]' && repair.blink,
    'the repair-keys toast was not recorded, or the repair icon does not blink: ' + JSON.stringify(repair));
  // R4. RED ON: the repair-keys blink target reverted to 'btn-shape' (hintsFirstMap.js)
  rig.check(!(await dm.evaluate('document.getElementById("btn-shape").classList.contains("hintcall-blink")')),
    'the Shape button blinks for the repair-keys toast, which points at the repair icon');
  rig.check(!(await dm.evaluate(up('room-edit'))), 'a room over another showed the room-edit toast too');

  // R2. RED ON: the SHAPE_FAMILY close of repair-keys removed from hintsFirstSync (hintsFirstMap.js)
  await dm.evaluate('setShape("brush"); 0');
  await gone('repair-keys');
  rig.check(!(await dm.evaluate(up('repair-keys'))), 'picking the Brush did not close the repair-keys toast');

  // R3. RED ON: hintsRoomDrawn's hintClose('repair-keys') removed (hintsFirstMap.js)
  await seen(['reveal', 'rooms', 'room-edit']);
  await dm.evaluate('__hfDraw(1000, 700, 1500, 1050); 0');
  await lib.settle(dm, up('repair-keys'), 8000);
  await dm.evaluate('__hfDraw(1800, 100, 2300, 300); 0');
  await lib.hold(800, 'the next room, if it left the toast up, would have by now');
  rig.check(!(await dm.evaluate(up('repair-keys'))), 'drawing the next shape left the repair-keys toast up');

  // J. RED ON: _hfPlace taking tries[0] (below) instead of the first that fits (hintsFirstMap.js)
  await seen(['reveal', 'rooms']);
  await dm.evaluate('fitToScreen(); viewportDirty = true; cursorDirty = true; scheduleRender(); 0');
  await lib.settle(dm, '!viewportDirty', 8000);
  const top = await dm.evaluate('__rigDrawRoom("reveal", 900, 1250, 1500, 1480)');
  await lib.settle(dm, up('room-edit'), 8000);
  const flip = await dm.evaluate('__hfRead("room-edit", "btn-select")');
  rig.check(flip && flip.side === 'above' && away(flip.tip, await dm.evaluate('__hfRoomBox(' + top + ')')) <= TIP_MAX && flip.inside && !flip.onChrome,
    'a room against the bottom edge did not put its toast above it, arrow touching: ' + JSON.stringify(flip));

  // K. RED ON: hintsFirstSync's polygons.some(...) close removed (hintsFirstMap.js)
  await dm.evaluate('deletePolygonById(' + top + '); __rigPoint(900, 600); 0');
  await gone('room-edit');
  rig.check(!(await dm.evaluate(up('room-edit'))), 'deleting the room left its edit toast up');

  // L. RED ON: _hintShow's `if (prev) _hintDrop(prev)` removed (hints.js)
  // The Rooms hint stays away from a map that has rooms, so they go first.
  await dm.evaluate('polygons.filter(p => !p.material && !p.light).map(p => p.id).forEach(deletePolygonById);' +
    ' localStorage.removeItem("evermist.hintsSeen"); setShape("select"); selectedPolygonId = null; __rigPoint(10, 10); 0');
  await lib.settle(dm, up('reveal'), 8000);
  await dm.evaluate('hintsRoomsAsk(); 0');
  const swapped = await dm.evaluate('({ reveal: ' + up('reveal') + ', rooms: ' + up('rooms') + ', brush: document.getElementById("btn-brush").classList.contains("hintcall-blink") })');
  rig.check(!swapped.reveal && swapped.rooms && !swapped.brush, 'a hint falling due did not replace the one up, or the old blink stayed: ' + JSON.stringify(swapped));

  // H. RED ON: hintsFirstSync's `if (!select) hintClose('reveal')` removed (hintsFirstMap.js)
  await dm.evaluate('hintClose(); localStorage.removeItem("evermist.hintsSeen"); __rigPoint(12, 12); 0');
  await lib.settle(dm, up('reveal'), 8000);
  await dm.evaluate('worldMapShow(); 0');
  await gone('reveal');
  rig.check(!(await dm.evaluate(up('reveal'))), 'the world map opened with a reveal toast still up');
  await dm.evaluate('worldMapHide(); 0');

  // I. RED ON: hintsScreenChanged() removed from switchScene (sceneSwitch.js)
  const first = await dm.evaluate('currentScene.id');
  await lib.openMap(rig, { w: 1800, h: 1200 });
  await dm.waitFor('fogCoverT === 0', 30000, 'the second scene cover to lift');
  await dm.evaluate('localStorage.removeItem("evermist.hintsSeen"); setShape("select"); __rigPoint(12, 12); 0');
  await lib.settle(dm, up('reveal'), 8000);
  await dm.evaluate('switchScene(' + JSON.stringify(first) + '); 0');
  await lib.settle(dm, 'currentScene && currentScene.id === ' + JSON.stringify(first), 30000);
  rig.check(!(await dm.evaluate(up('reveal'))), 'a scene switch left the reveal toast up');
};
