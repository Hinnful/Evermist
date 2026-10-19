'use strict';

// touchpad.js — A MAC TOUCHPAD DRIVES THE DM MAP.
//
//   A. A mouse wheel notch (deltaY -100) zooms in by one fixed step.
//   B. A two-finger scroll (small fractional deltaY, a deltaX) pans the map and leaves the zoom alone.
//   C. A pinch (ctrlKey wheel) zooms in proportion to its deltaY.
//   D. Backspace, a MacBook's delete key, deletes the selected room.
//   E. A two-finger scroll on the world map pans it and leaves the zoom alone.
//
// Covers src/ui/wheelPlan.js, src/ui/input.js, src/world/worldMapEdit.js.

const lib = require('../../lib');

const MAP_W = 2000, MAP_H = 1400;

const HELPERS = `
globalThis.__wheel = (o) => {
  const r = container.getBoundingClientRect();
  container.dispatchEvent(new WheelEvent('wheel', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
    bubbles: true, cancelable: true, deltaMode: 0, ...o }));
  return { zoom, panX, panY };
};
0`;

module.exports = async function touchpadFeature(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await dm.evaluate(HELPERS);
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');

  // ── A. a mouse wheel notch is one fixed step ───────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const z0 = await dm.evaluate('zoom');
  const a = await dm.evaluate('__wheel({ deltaY: -100 })');
  rig.check(Math.abs(a.zoom / z0 - 1.1) < 0.001, 'a mouse wheel notch did not zoom by one 1.1x step: ' + z0 + ' -> ' + a.zoom);

  // ── B. a two-finger scroll pans ────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await lib.hold(250, 'the mouse gesture to end, so the scroll reads as its own gesture');
  const p0 = await dm.evaluate('({ panX, panY, zoom })');
  const b = await dm.evaluate('__wheel({ deltaX: 12, deltaY: 20.5 })');
  rig.check(Math.abs(b.zoom - p0.zoom) < 1e-9, 'a two-finger scroll changed the zoom: ' + p0.zoom + ' -> ' + b.zoom);
  rig.check(b.panX < p0.panX - 1 && b.panY < p0.panY - 1,
            'a two-finger scroll did not pan the map: ' + JSON.stringify(p0) + ' -> ' + JSON.stringify(b));

  // ── C. a pinch zooms in proportion ─────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await lib.hold(250, 'the scroll gesture to end');
  const small = await dm.evaluate('__wheel({ deltaY: -2, ctrlKey: true })');
  const big = await dm.evaluate('__wheel({ deltaY: -10, ctrlKey: true })');
  const gs = small.zoom / b.zoom, gb = big.zoom / small.zoom;
  rig.check(gs > 1 && gb > gs, 'a pinch did not zoom in proportion to its delta: ' + gs + ' then ' + gb);
  rig.check(gb < 1.5, 'a pinch jumped like a wheel notch: ' + gb);

  // ── D. Backspace deletes the selected room ─────────────────────────────────
  const gone = await dm.evaluate(`(() => {
    setPlaceMode('rooms'); setShape('select');
    polygons.push({ id: 7101, vertices: [{x:100,y:100},{x:400,y:100},{x:400,y:400},{x:100,y:400}], mode: 'shroud', name: 'Rig BS' });
    rebuildFogFromPolygons(); selectedPolygonId = 7101; leaveShapeEditMode();
    __rigKey('Backspace');
    return !polygons.some(p => p.id === 7101);
  })()`);
  rig.check(gone, 'Backspace did not delete the selected room');

  // ── E. a two-finger scroll pans the world map ──────────────────────────────
  await dm.evaluate("__rigKey('KeyM'); 0");
  await lib.settle(dm, 'worldMapOpen && !_wmAnim', 15000);
  await lib.hold(250, 'the map gesture to end');
  const w = await dm.evaluate(`(() => {
    const c0 = { ..._wmCam }, r = _wm.getBoundingClientRect();
    _wm.dispatchEvent(new WheelEvent('wheel', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      bubbles: true, cancelable: true, deltaMode: 0, deltaX: 12, deltaY: 20.5 }));
    return { c0, c1: { ..._wmCam } };
  })()`);
  rig.check(w.c1.z === w.c0.z && (w.c1.cx !== w.c0.cx || w.c1.cy !== w.c0.cy),
            'a two-finger scroll did not pan the world map: ' + JSON.stringify(w));
};
