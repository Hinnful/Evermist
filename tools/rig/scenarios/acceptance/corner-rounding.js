'use strict';

// corner-rounding.js — ROUNDING A CORNER BY HAND ON THE MAP, FIGMA'S WAY.
//
// THE GOAL OF THIS FEATURE: a room, an effect and a light all round the same way, by a circle
// inside each corner, and the DM never leaves the map to do it.
//
//   A. A focused shape shows a circle inside each corner while the pointer is on it, and none
//      once the pointer leaves the shape or the map.
//   B. Dragging a focused circle rounds every corner; Alt+drag rounds that corner alone.
//   C. In edit mode no circle shows until a corner is picked, then that corner's alone, and
//      dragging it rounds that corner only.
//   D. A shape smaller than about 70 screen pixels shows no circles.
//   E. A double-click on a circle opens the number field beside it. Digits only; Enter keeps,
//      Esc puts the old radius back, a press on the map keeps.
//   F. One drag, or one opening of the field, is one Ctrl+Z.
//   G. The TV's fog takes the new rounding of a room.
//   H. A press just outside a circle still moves the shape and rounds nothing.
//   I. An effect and a light get the same circles; a circle shape and an arc's own points none.
//   J. The Room tab and the Effects row carry no corner radius field.
//   (The label under a turned seat: seat-turn.js 14. Two-map mode: two-maps.js J.)

const lib = require('../../lib');

const MAP_W = 2000, MAP_H = 1400;
const L = '[{x:300,y:200},{x:1100,y:200},{x:1100,y:600},{x:700,y:600},{x:700,y:1100},{x:300,y:1100}]';

module.exports = async function cornerRounding(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');

  const stage = () => dm.evaluate(`(() => {
    setPlaceMode('rooms'); setShape('select'); fitToScreen();
    polygons = polygons.filter(p => p.id !== 7001);
    polygons.push({ id: 7001, vertices: ${L}, mode: 'shroud', cornerRadius: 0, name: 'Rig L' });
    rebuildFogFromPolygons(); fogDirty = true; scheduleRender();
    selectedPolygonId = 7001; leaveShapeEditMode();
    return 0;
  })()`);
  const room = () => dm.evaluate('(p => ({ r: p.cornerRadius, radii: p.cornerRadii || null, v0: p.vertices[0] }))(__rigById(7001))');
  const circles = () => dm.evaluate('cornerCircles(__rigById(7001)).map(h => h.flat)');
  const depth = () => dm.evaluate('undoStack.length');
  await stage();

  // ── A. circles while the pointer is on the focused shape ─────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('__rigPoint(1600, 1200); 0');
  rig.check((await circles()).length === 0, 'A: a focused room showed circles with the pointer off it');
  await dm.evaluate('__rigPoint(500, 700); 0');
  rig.check((await circles()).join() === '0,1,2,3,4,5',
            'A: a focused room did not show a circle in each of its six corners: ' + await circles());
  await dm.evaluate('container.dispatchEvent(new MouseEvent("mouseleave")); 0');
  rig.check((await circles()).length === 0, 'A: the circles stayed after the pointer left the map');

  // ── B. drag rounds every corner, Alt+drag one ────────────────────────────
  // RED ON: cornerRoundDown gated off in selectMouseDown (shapeSelect.js) — 2026-10-07
  await dm.evaluate('__rigPoint(500, 700); 0');
  const d0 = await depth();
  await dm.evaluate('(h => __rigDrag(h.x, h.y, h.x + 40, h.y + 40))(__rigCornerCircle(0)); 0');
  const all = await room();
  rig.check(all.r > 20 && !all.radii, 'B: a drag on a circle did not round every corner: ' + JSON.stringify(all));
  rig.check(await depth() === d0 + 1, 'F: one rounding drag did not cost exactly one undo step');
  await dm.evaluate('__rigPoint(500, 700); (h => __rigDrag(h.x, h.y, h.x - 50, h.y + 50, { mods: { altKey: true } }))(__rigCornerCircle(1)); 0');
  const one = await room();
  rig.check(one.radii && one.radii[1] > all.r && one.radii.every((r, i) => i === 1 || r == null),
            'B: Alt+drag did not round that corner alone: ' + JSON.stringify(one));

  // ── F. Ctrl+Z takes one drag back ────────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('__rigKey("KeyZ", { ctrlKey: true }); 0');
  const undone = await room();
  rig.check(!undone.radii && undone.r === all.r,
            'F: Ctrl+Z did not take back the Alt+drag alone: ' + JSON.stringify(undone));

  // ── C. edit mode: the picked corner's circle alone ───────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  await stage();
  await dm.evaluate('__rigDbl(500, 700); 0');
  rig.check(await dm.evaluate('shapeEditMode') && (await circles()).length === 0,
            'C: edit mode showed circles before a corner was picked: ' + await circles());
  await dm.evaluate('__rigClick(1100, 600); 0');
  rig.check((await circles()).join() === '2', 'C: picking a corner did not show its circle alone: ' + await circles());
  await dm.evaluate('(h => __rigDrag(h.x, h.y, h.x - 40, h.y - 40))(__rigCornerCircle(2)); 0');
  const edited = await room();
  rig.check(edited.radii && edited.radii[2] > 0 && !edited.r && edited.radii.every((r, i) => i === 2 || r == null),
            'C: dragging the picked corner\'s circle did not round that corner alone: ' + JSON.stringify(edited));

  // ── D. a small shape shows none ──────────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  await stage();
  await dm.evaluate('zoom = 60 / 800; panX = 20; panY = 20; __rigPoint(500, 700); 0');
  rig.check((await circles()).length === 0, 'D: a room smaller than 70 screen pixels still showed circles');
  await stage();

  // ── E. the number field ──────────────────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('__rigPoint(500, 700); 0');
  const opened = await dm.evaluate(`(h => { __rigClick(h.x, h.y); __rigMouse('dblclick', h.x, h.y);
    const f = document.getElementById('corner-field'), n = document.getElementById('corner-field-num');
    const b = f.getBoundingClientRect();
    return { shown: getComputedStyle(f).display !== 'none', focused: document.activeElement === n,
             value: n.value, w: b.width }; })(__rigCornerCircle(0))`);
  rig.check(opened.shown && opened.focused && opened.value === '0' && opened.w > 40,
            'E: a double-click on a circle did not open the focused number field: ' + JSON.stringify(opened));
  const e0 = await depth();
  const typed = await dm.evaluate(`(() => { const n = document.getElementById('corner-field-num');
    n.value = '3a6'; n.dispatchEvent(new Event('input', { bubbles: true }));
    n.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return { value: n.value, r: __rigById(7001).cornerRadius,
             shown: getComputedStyle(document.getElementById('corner-field')).display !== 'none' }; })()`);
  rig.check(typed.value === '36' && typed.r === 36 && !typed.shown,
            'E: typing a radius and Enter did not keep it and close the field: ' + JSON.stringify(typed));
  rig.check(await depth() === e0 + 1, 'F: one opening of the field did not cost exactly one undo step');
  const escaped = await dm.evaluate(`(h => { __rigClick(h.x, h.y); __rigMouse('dblclick', h.x, h.y);
    const n = document.getElementById('corner-field-num');
    n.value = '80'; n.dispatchEvent(new Event('input', { bubbles: true }));
    const mid = __rigById(7001).cornerRadius;
    n.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { mid, after: __rigById(7001).cornerRadius }; })(__rigCornerCircle(0))`);
  rig.check(escaped.mid === 80 && escaped.after === 36 && await depth() === e0 + 1,
            'E: Esc did not put the old radius back and leave the history as it was: ' + JSON.stringify(escaped));
  const pressed = await dm.evaluate(`(h => { __rigClick(h.x, h.y); __rigMouse('dblclick', h.x, h.y);
    const n = document.getElementById('corner-field-num');
    n.value = '50'; n.dispatchEvent(new Event('input', { bubbles: true }));
    __rigClick(1600, 1200);
    return { r: __rigById(7001).cornerRadius,
             shown: getComputedStyle(document.getElementById('corner-field')).display !== 'none' }; })(__rigCornerCircle(0))`);
  rig.check(pressed.r === 50 && !pressed.shown, 'E: a press on the map did not keep the typed radius: ' + JSON.stringify(pressed));

  // ── G. the TV's fog takes the rounding ───────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  // A REVEALED room, so its square corner is clear on the TV and rounding it brings fog back there.
  await stage();
  await dm.evaluate('__rigById(7001).mode = "reveal"; ' + lib.SETTLE);
  const tv = await rig.player();
  await dm.evaluate('sendToPlayer(); 0');
  await tv.waitFor('mapWidth > 0 && fogCoverT === 0', 30000, 'the map to reach the TV');
  const corner = { x: 300 + 18, y: 200 + 18 };
  const tvFog = () => tv.evaluate('(' + lib.TV_FOG + ')(' + corner.x + ',' + corner.y + ')');
  const tvBefore = await lib.poll(async () => { const a = await tvFog(); return a < 60 ? { a } : null; }, 15000);
  rig.check(!!tvBefore, "G: the revealed room's corner was not clear on the TV, so rounding it proves nothing");
  await dm.evaluate('__rigPoint(500, 700); __rigTypeCorner(0, 150); ' + lib.SETTLE);
  const tvAfter = await lib.poll(async () => { const a = await tvFog(); return a > 120 ? { a } : null; }, 15000);
  rig.check(!!tvAfter, "G: the TV still showed the revealed room's square corner after it was rounded");

  // ── H. a press just outside a circle moves the shape ─────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  await stage();
  await dm.evaluate('__rigPoint(500, 700); 0');
  const nearMiss = await dm.evaluate(`(h => { const off = 14 / zoom;
    __rigDrag(h.x + off, h.y + off, h.x + off + 100, h.y + off + 60);
    return { v0: __rigById(7001).vertices[0], r: __rigById(7001).cornerRadius, tol: 2 / zoom }; })(__rigCornerCircle(0))`);
  rig.check(Math.abs(nearMiss.v0.x - 400) < nearMiss.tol && Math.abs(nearMiss.v0.y - 260) < nearMiss.tol && !nearMiss.r,
            'H: a press just outside a corner circle did not move the room, or rounded it: ' + JSON.stringify(nearMiss));

  // ── I. effects and lights ────────────────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  const kinds = await dm.evaluate(`(() => {
    setPlaceMode('effects'); setShape('select');
    const cone = addEffect(coneVertices({ x: 900, y: 700 }, { x: 1500, y: 700 }, 0));
    const ring = addEffect(circleVertices({ x: 1500, y: 300 }, { x: 1700, y: 300 }));
    const lit = addLightShape([{x:300,y:1150},{x:800,y:1150},{x:800,y:1350},{x:300,y:1350}]);
    effectsChanged(); lightsChanged();
    const at = (s, x, y) => { selectedPolygonId = s.id; leaveShapeEditMode(); __rigPoint(x, y);
                             return cornerCircles(s).map(h => h.flat); };
    const out = { coneN: cone.vertices.length, cone: at(cone, 1100, 700), ring: at(ring, 1500, 300),
                  light: at(lit, 550, 1250) };
    out.lightTyped = __rigTypeCorner(0, 30) && lit.cornerRadius === 30;
    return out;
  })()`);
  rig.check(kinds.cone.length === 3 && kinds.cone.includes(0),
            'I: a cone did not get a circle on its apex and its two far corners alone: ' + JSON.stringify(kinds));
  rig.check(kinds.ring.length === 0, 'I: a circle shape showed circles on its own points: ' + JSON.stringify(kinds));
  rig.check(kinds.light.length === 4 && kinds.lightTyped,
            'I: a light did not round by its circles like a room: ' + JSON.stringify(kinds));

  // ── J. no radius field left in the dock or the bar ───────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  rig.check(await dm.evaluate('["rp-radius-field", "rp-radius-num", "fx-radius-field", "fx-radius-num"]' +
                              '.every(id => !document.getElementById(id))'),
            'J: a corner radius field is still in the Room tab or the Effects row');

  rig.byEye('whether the circles, the drag label and the number field look right on the map');
};
