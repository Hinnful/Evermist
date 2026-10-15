'use strict';

// effect-presets.js — an area effect at an exact D&D size in one click.
//
//   A. The Effects shape list offers Line, Wall and Ring beside the other shapes; Rooms greys all
//      three. The list wears the bar's own surface.
//   B. A shape with sizes shows the size field in the row: by hand first, a typed size after. A typed
//      size lands on a grid square.
//   C. Line, Wall and Ring have no hand tool, so picking one arms its default size: a line one square
//      wide, a wall and a ring one foot thick.
//   D. The map's wheel steps the size one grid square at a time and stops at the largest; Ctrl+wheel
//      still zooms.
//   E. A click places the effect at the exact size, where it was clicked, never snapped; it
//      arrives selected, the bar returns to Select, Undo removes it.
//   F. A drag aims a cone from the press point.
//   G. Changing the grid leaves a placed preset alone; the next one takes the new grid.
//   H. A Ring is a band one foot thick around a real hole, and it reaches the TV with that hole.
//   I. Escape drops a picked size.

const lib = require('../../lib');

const MAP_W = 2400, MAP_H = 1400;

module.exports = async function effectPresets(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await dm.waitFor('!!mapOffscreen', 60000, 'the DM map surface');
  await dm.evaluate('setPlaceMode("effects"); setShape("select"); 0');
  // A size is typed into the field the way the DM types it.
  const typeSize = ft => dm.evaluate('(() => { const i = document.querySelector("#ctx-presets .sz-in");' +
    ' i.value = "' + ft + '"; i.dispatchEvent(new Event("change", { bubbles: true })); return 0; })()');

  // ══ A ══
  // RED ON: shapeInMode's greying gated off with false && in the shape list (shapeMenu.js) — 2026-10-16
  const offered = async () => {
    await dm.evaluate('document.querySelector("[data-chev=shape]").click(); 0');
    const rows = await dm.evaluate('[...document.querySelectorAll("#tb-dd .dd-it")].map(r => ({ id: r.dataset.dd, off: r.disabled }))');
    return id => rows.some(r => r.id === id && !r.off);
  };
  let has = await offered();
  rig.check(has('btn-line') && has('btn-wall') && has('btn-ring'), 'the Effects shape list does not offer Line, Wall and Ring');
  await dm.evaluate('document.querySelector("[data-chev=shape]").click(); setPlaceMode("rooms"); 0');
  has = await offered();
  rig.check(!has('btn-line') && !has('btn-wall') && !has('btn-ring'), 'the Rooms shape list offers Line, Wall or Ring, which no room is');
  await dm.evaluate('document.querySelector("[data-chev=shape]").click(); setPlaceMode("effects");' +
                    ' document.querySelector("[data-chev=shape]").click(); 0');
  const surf = await dm.evaluate(`(() => {
    const m = getComputedStyle(document.getElementById('tb-dd'));
    const b = getComputedStyle(document.getElementById('toolbar-bottom'));
    return { m: m.backgroundColor, b: b.backgroundColor, bw: m.borderTopWidth };
  })()`);
  rig.check(surf.m === surf.b && surf.bw !== '0px',
            'the shape list does not wear the bar\'s surface: ' + JSON.stringify(surf));
  await dm.evaluate('document.querySelector("[data-chev=shape]").click(); 0');

  // ══ B ══
  // RED BY DESIGN: written against the size field, never re-proved
  await dm.evaluate('setShape("circle"); 0');
  const FIELD = `(() => {
    const row = document.getElementById('ctx-presets'), f = row.querySelector('.sz-field');
    return { shown: getComputedStyle(row).display !== 'none', hand: !!f && f.classList.contains('hand'),
             value: f ? f.querySelector('.sz-in').value : null };
  })()`;
  let field = await dm.evaluate(FIELD);
  rig.check(field.shown && field.hand && (await dm.evaluate('presetArmed')) === null,
            'picking Circle did not leave hand drawing in the size field: ' + JSON.stringify(field));
  await typeSize(23);
  field = await dm.evaluate(FIELD);
  const armed = await dm.evaluate('presetArmed');
  rig.check(armed && armed.kind === 'circle' && armed.s === 25 && !field.hand && field.value === '25',
            'typing 23 did not land on the 25 ft square and arm a 25 ft circle: ' + JSON.stringify({ armed, field }));
  await typeSize(20);

  // ══ D ══
  // RED ON: stepPreset's stepPresetIndex wrapped instead of clamping (toolPreset.js) — 2026-10-16
  const wheel = (dy, ctrl) => dm.evaluate(`(() => {
    const r = container.getBoundingClientRect();
    container.dispatchEvent(new WheelEvent('wheel', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      deltaY: ${dy}, ctrlKey: ${!!ctrl}, bubbles: true, cancelable: true }));
    return presetArmed ? presetArmed.s : null;
  })()`);
  rig.check(await wheel(-100) === 25, 'the wheel up from 20 did not step one square to 25');
  for (let i = 0; i < 7; i++) await wheel(-100);
  rig.check(await wheel(-100) === 60, 'the wheel up from the largest size did not stop at 60');
  const z0 = await dm.evaluate('zoom');
  rig.check(await wheel(-100, true) === 60 && (await dm.evaluate('zoom')) > z0,
            'Ctrl+wheel did not zoom, or it changed the size');
  await typeSize(5);
  rig.check(await wheel(100) === null, 'the wheel down from the smallest size did not step to drawing by hand');
  await typeSize(20);

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
  await dm.evaluate('setShape("cone"); 0');
  await typeSize(30);
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
  await dm.evaluate('setShape("circle"); 0');
  await typeSize(20);
  await dm.evaluate('__rigClick(1500, 400); 0');
  const r2 = await dm.evaluate(`(() => { const v = effects[effects.length - 1].vertices;
    const cx = v.reduce((s, p) => s + p.x, 0) / v.length, cy = v.reduce((s, p) => s + p.y, 0) / v.length;
    return { r: Math.hypot(v[0].x - cx, v[0].y - cy), want: 20 * gridSize / 5 }; })()`);
  rig.check(Math.abs(r2.r - r2.want) < 0.01, 'the next preset did not take the new grid: ' + JSON.stringify(r2));
  await lib.fire(dm, 'grid-size-num', cell0);

  // ══ J ══
  // RED ON: presetPxPerFt reading gridSize alone, not the hex cell's width (toolPreset.js) — 2026-10-16
  // A hex grid's size is its corner radius, so one 5 ft cell is gridSize * sqrt(3) across the flats.
  await dm.evaluate('document.getElementById("btn-grid-hptop").click(); setShape("circle"); 0');
  await typeSize(20);
  await dm.evaluate('__rigClick(1500, 1000); 0');
  const hex = await dm.evaluate(`(() => { const v = effects[effects.length - 1].vertices;
    const cx = v.reduce((s, p) => s + p.x, 0) / v.length, cy = v.reduce((s, p) => s + p.y, 0) / v.length;
    return { r: Math.hypot(v[0].x - cx, v[0].y - cy), want: 20 * gridSize * Math.sqrt(3) / 5, mode: gridMode }; })()`);
  rig.check(hex.mode !== 'square' && Math.abs(hex.r - hex.want) < 0.01,
            'a 20 ft circle on a hex grid is not 20 ft of hex cells in radius: ' + JSON.stringify(hex));
  // A grid size change moves the armed outline at once, without a pointer move.
  await dm.evaluate('setShape("circle"); 0');
  await typeSize(30);
  const ink0 = await dm.evaluate('presetPxPerFt()');
  await lib.fire(dm, 'grid-size-num', Math.round(cell0 * 2));
  rig.check(await dm.evaluate('presetPxPerFt()') > ink0, 'the preset size did not follow a grid size change');
  await dm.evaluate('document.getElementById("btn-grid-sq").click(); 0');
  await lib.fire(dm, 'grid-size-num', cell0);
  rig.check(await dm.evaluate('presetPxPerFt()') === cell0 / 5, 'the preset size did not return to the square scale');
  await dm.evaluate('setShape("select"); 0');

  // ══ C, H ══
  // RED BY DESIGN: written against the feature, never re-proved
  const noHand = await dm.evaluate(`(() => { const out = {};
    for (const k of ['line', 'wall', 'ring']) { setShape(k); out[k] = presetArmed && { s: presetArmed.s, w: presetArmed.w };
      out[k + 'Hand'] = document.querySelector('#ctx-presets .sz-field').classList.contains('hand'); }
    return out; })()`);
  rig.check(noHand.line.s === 60 && noHand.line.w === 5 && noHand.wall.s === 30 && noHand.wall.w === 1 &&
            noHand.ring.s === 20 && noHand.ring.w === 1 && !noHand.lineHand && !noHand.wallHand && !noHand.ringHand,
            'Line, Wall and Ring did not arm 60, 30 and 20 ft with a square, a foot and a foot thick: ' + JSON.stringify(noHand));
  // RED ON: setShapeHoles skipped in toolPresetFinish (toolPreset.js) — 2026-09-29
  await dm.evaluate('__rigClick(1800, 900); 0');
  const ring = await dm.evaluate(`(() => { const e = effects[effects.length - 1], ft = gridSize / 5;
    return { id: e.id, holes: (e.holes || []).length, inHole: pointInShape(1800 + 4 * ft, 900, e),
             inBand: pointInShape(1800 + 9.5 * ft, 900, e), outside: pointInShape(1800 + 10.5 * ft, 900, e) }; })()`);
  rig.check(ring.holes === 1 && !ring.inHole && ring.inBand && !ring.outside,
            'the ring is not a one foot band around a real hole: ' + JSON.stringify(ring));
  const player = await rig.player();
  await dm.evaluate('sendToPlayer(); 0');
  await player.waitFor('effects.some(e => e.id === ' + ring.id + ')', 30000, 'the ring to reach the TV');
  rig.check(await player.evaluate('(effects.find(e => e.id === ' + ring.id + ').holes || []).length') === 1,
            'the ring reached the TV without its hole');

  // ══ I ══
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('setShape("circle"); 0');
  await typeSize(10);
  await dm.evaluate('__rigKey("Escape"); 0');
  rig.check(await dm.evaluate('presetArmed === null && shape === "circle"'),
            'Escape did not drop the picked size back to hand drawing');
  await dm.evaluate('setShape("ring"); __rigKey("Escape"); 0');
  rig.check(await dm.evaluate('presetArmed === null && shape === "select"'),
            'Escape on a Ring did not return the bar to Select');

  rig.byEye('the size field and the cursor label read as the prototype (item 175)');
};
