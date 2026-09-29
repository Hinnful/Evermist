'use strict';

// effect-presets.js — an area effect at an exact D&D size in one click.
//
//   A. The Effects flyout offers Line and Ring beside the four shapes; Rooms offers neither.
//      The flyout wears the bar's own surface.
//   B. A shape with sizes shows them in the row above the bar, the dashed hand-draw button
//      first and picked; a picked size wears the outlined blue box.
//   C. Line and Ring have no hand tool, so picking one arms its default size.
//   D. The wheel steps through the sizes and wraps at both ends; Ctrl+wheel still zooms.
//   E. A click places the effect at the exact size, where it was clicked, never snapped; it
//      arrives selected, the bar returns to Select, Undo removes it.
//   F. A drag aims a cone from the press point.
//   G. Changing the grid leaves a placed preset alone; the next one takes the new grid.
//   H. The Ring row is 20×1, 20×5, 60×5; a ring is a band of that thickness around a real hole,
//      and it reaches the TV with that hole.
//   I. Escape drops a picked size.

const lib = require('../../lib');

const MAP_W = 2400, MAP_H = 1400;

module.exports = async function effectPresets(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await dm.waitFor('!!mapOffscreen', 60000, 'the DM map surface');
  await dm.evaluate('setPlaceMode("effects"); setShape("select"); 0');

  // ══ A ══
  // RED BY DESIGN: written against the feature, never re-proved
  const shown = id => `getComputedStyle(document.getElementById("${id}")).display !== "none"`;
  rig.check(await dm.evaluate(shown('btn-line') + ' && ' + shown('btn-ring')) === true,
            'the Effects flyout does not offer Line and Ring');
  await dm.evaluate('setPlaceMode("rooms"); 0');
  rig.check(await dm.evaluate('!(' + shown('btn-line') + ') && !(' + shown('btn-ring') + ')') === true,
            'the Rooms flyout offers Line or Ring, which no room is');
  await dm.evaluate('setPlaceMode("effects"); 0');
  const surf = await dm.evaluate(`(() => {
    const m = getComputedStyle(document.getElementById('shape-menu'));
    const b = getComputedStyle(document.getElementById('toolbar-bottom'));
    return { m: m.backgroundColor, b: b.backgroundColor, bw: m.borderTopWidth };
  })()`);
  rig.check(surf.m === surf.b && surf.bw !== '0px',
            'the shape flyout does not wear the bar\'s surface: ' + JSON.stringify(surf));

  // ══ B ══
  // RED BY DESIGN: written against the feature, never re-proved
  const ROW = `(() => {
    const row = document.getElementById('ctx-presets');
    const bs = [...row.querySelectorAll('[data-preset]')];
    const on = bs.find(b => b.classList.contains('active'));
    return { shown: getComputedStyle(row).display !== 'none', keys: bs.map(b => b.dataset.preset),
             text: bs.map(b => b.textContent), on: on ? on.dataset.preset : null,
             onBorder: on ? getComputedStyle(on).borderTopColor : null };
  })()`;
  await dm.evaluate('setShape("circle"); 0');
  let row = await dm.evaluate(ROW);
  rig.check(row.shown && row.keys[0] === 'hand' && row.text.slice(1).join() === '5,10,15,20,30,40,60',
            'the Circle row is not the hand button then 5 to 60: ' + JSON.stringify(row));
  rig.check(row.on === 'hand' && (await dm.evaluate('presetArmed')) === null,
            'picking Circle did not leave hand drawing picked: ' + JSON.stringify(row));
  await dm.evaluate('document.querySelector("#ctx-presets [data-preset=\\"3\\"]").click(); 0');
  row = await dm.evaluate(ROW);
  const armed = await dm.evaluate('presetArmed');
  rig.check(armed && armed.kind === 'circle' && armed.s === 20, 'clicking 20 did not arm a 20 ft circle: ' + JSON.stringify(armed));
  rig.check(row.on === '3' && !/rgba\(0, 0, 0, 0\)/.test(row.onBorder),
            'the picked size does not wear an outline: ' + JSON.stringify(row));

  // ══ D ══
  // RED ON: stepPreset clamped instead of stepPresetIndex (toolPreset.js) — 2026-09-29
  const wheel = (dy, ctrl) => dm.evaluate(`(() => {
    const r = container.getBoundingClientRect();
    container.dispatchEvent(new WheelEvent('wheel', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      deltaY: ${dy}, ctrlKey: ${!!ctrl}, bubbles: true, cancelable: true }));
    return presetArmed ? presetArmed.s : null;
  })()`);
  rig.check(await wheel(-100) === 30, 'the wheel up from 20 did not step to 30');
  await wheel(-100); await wheel(-100);
  rig.check(await wheel(-100) === 5, 'the wheel up from 60 did not wrap to 5');
  rig.check(await wheel(100) === 60, 'the wheel down from 5 did not wrap to 60');
  const z0 = await dm.evaluate('zoom');
  rig.check(await wheel(-100, true) === 60 && (await dm.evaluate('zoom')) > z0,
            'Ctrl+wheel did not zoom, or it changed the size');
  await wheel(100); await wheel(100); await wheel(100);   // back to 20

  // ══ E ══
  // RED BY DESIGN: written against the feature, never re-proved
  const n0 = await dm.evaluate('effects.length');
  const AT = { x: 733.3, y: 611.7 };
  await dm.evaluate(`__rigClick(${AT.x}, ${AT.y}); 0`);
  const placed = await dm.evaluate(`(() => {
    const e = effects[effects.length - 1];
    const cx = e.vertices.reduce((s, v) => s + v.x, 0) / e.vertices.length;
    const cy = e.vertices.reduce((s, v) => s + v.y, 0) / e.vertices.length;
    return { n: effects.length, id: e.id, cx, cy, r: Math.hypot(e.vertices[0].x - cx, e.vertices[0].y - cy),
             want: 20 * gridSize / 5, tol: 2 / zoom, shape, sel: selectedPolygonId, armed: presetArmed };
  })()`);
  rig.check(placed.n === n0 + 1, 'a click with 20 armed placed ' + (placed.n - n0) + ' effects');
  rig.check(Math.abs(placed.r - placed.want) < 0.01, 'the 20 ft circle has radius ' + placed.r + ', not ' + placed.want);
  rig.check(Math.hypot(placed.cx - AT.x, placed.cy - AT.y) < placed.tol,
            'the circle is not centred where it was clicked, so it snapped: ' + JSON.stringify(placed));
  rig.check(placed.shape === 'select' && placed.sel === placed.id && placed.armed === null,
            'after placing, the bar is not on Select with the new effect selected: ' + JSON.stringify(placed));
  await dm.evaluate('undo(); 0');
  rig.check(await dm.evaluate('effects.length') === n0, 'Undo did not remove the placed preset');

  // ══ F ══
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('setShape("cone"); document.querySelector("#ctx-presets [data-preset=\\"1\\"]").click(); 0');
  await dm.evaluate('__rigDrag(900, 500, 900, 700); 0');
  const cone = await dm.evaluate(`(() => {
    const v = effects[effects.length - 1].vertices;
    return { ax: v[0].x, ay: v[0].y, farY: Math.max(...v.map(p => p.y)), want: 30 * gridSize / 5, tol: 2 / zoom };
  })()`);
  rig.check(Math.hypot(cone.ax - 900, cone.ay - 500) < cone.tol, 'the cone does not start at the press point');
  rig.check(cone.farY - 500 >= cone.want - 1, 'the cone was not aimed down the drag: ' + JSON.stringify(cone));

  // ══ G ══
  // RED BY DESIGN: written against the feature, never re-proved
  const before = await dm.evaluate('JSON.stringify(effects[effects.length - 1].vertices)');
  const cell0 = await dm.evaluate('gridSize');
  await lib.fire(dm, 'grid-size-num', Math.round(cell0 * 1.5));
  rig.check(await dm.evaluate('gridSize') !== cell0, 'the grid size did not change');
  rig.check(await dm.evaluate('JSON.stringify(effects[effects.length - 1].vertices)') === before,
            'changing the grid moved or resized a placed preset');
  await dm.evaluate('setShape("circle"); document.querySelector("#ctx-presets [data-preset=\\"3\\"]").click();' +
                    ' __rigClick(1500, 400); 0');
  const r2 = await dm.evaluate(`(() => { const v = effects[effects.length - 1].vertices;
    const cx = v.reduce((s, p) => s + p.x, 0) / v.length, cy = v.reduce((s, p) => s + p.y, 0) / v.length;
    return { r: Math.hypot(v[0].x - cx, v[0].y - cy), want: 20 * gridSize / 5 }; })()`);
  rig.check(Math.abs(r2.r - r2.want) < 0.01, 'the next preset did not take the new grid: ' + JSON.stringify(r2));
  await lib.fire(dm, 'grid-size-num', cell0);

  // ══ C, H ══
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('setShape("line"); 0');
  const line = await dm.evaluate('presetArmed');
  row = await dm.evaluate(ROW);
  rig.check(line && line.s === 60 && line.w === 5 && row.keys[0] !== 'hand',
            'picking Line did not arm 60×5 with no hand button: ' + JSON.stringify({ line, row }));
  await dm.evaluate('setShape("ring"); 0');
  row = await dm.evaluate(ROW);
  rig.check(row.text.join() === '20×1,20×5,60×5' && row.on === '0',
            'the Ring row is not 20×1, 20×5, 60×5 with the first armed: ' + JSON.stringify(row));
  // RED ON: setShapeHoles skipped in toolPresetFinish (toolPreset.js) — 2026-09-29
  await dm.evaluate('document.querySelector("#ctx-presets [data-preset=\\"1\\"]").click(); __rigClick(1800, 900); 0');
  const ring = await dm.evaluate(`(() => { const e = effects[effects.length - 1], ft = gridSize / 5;
    return { id: e.id, holes: (e.holes || []).length, inHole: pointInShape(1800 + 4 * ft, 900, e),
             inBand: pointInShape(1800 + 7.5 * ft, 900, e) }; })()`);
  rig.check(ring.holes === 1 && !ring.inHole && ring.inBand,
            'the ring is not a band around a real hole: ' + JSON.stringify(ring));
  const player = await rig.player();
  await dm.evaluate('sendToPlayer(); 0');
  await player.waitFor('effects.some(e => e.id === ' + ring.id + ')', 30000, 'the ring to reach the TV');
  rig.check(await player.evaluate('(effects.find(e => e.id === ' + ring.id + ').holes || []).length') === 1,
            'the ring reached the TV without its hole');

  // ══ I ══
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('setShape("circle"); document.querySelector("#ctx-presets [data-preset=\\"2\\"]").click(); __rigKey("Escape"); 0');
  rig.check(await dm.evaluate('presetArmed === null && shape === "circle"'),
            'Escape did not drop the picked size back to hand drawing');
  await dm.evaluate('setShape("ring"); __rigKey("Escape"); 0');
  rig.check(await dm.evaluate('presetArmed === null && shape === "select"'),
            'Escape on a Ring did not return the bar to Select');

  rig.byEye('the size row and the cursor label read as the prototype (item 113)');
};
