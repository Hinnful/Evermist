'use strict';

// world-map-seat.js — THE WORLD MAP WITH MY SEAT TURNED.
//
// THE GOAL OF THIS FEATURE: the world map is never turned, whatever My seat does to the scene. A
// place's outline, drawn on the room's overlay canvas, sits under the spot the DM drew it and under
// the place's name plate.
//
//   1. At 0°, 90° and 270° a rectangle place drawn on the world map has its outline on the overlay
//      canvas under all four edges of the drawn spot.
//   2. The place's name plate sits at the top left of that outline.
//   3. The overlay canvas lies upright over the whole window while the map is open.
//   4. Closing the map gives the scene's turned canvases back.
//
// ⚠ THE OUTLINE IS READ OFF THE PIXELS of #cursor-canvas, mapped through the canvas's own client rect.
// The check never asks the app where it drew.

const lib = require('../../lib');

const MAP_W = 900, MAP_H = 600;
const TURNS = [0, 90, 270];

const PAGE = `
globalThis.__wsE = (type, el, p) => (el || window).dispatchEvent(new MouseEvent(type,
  { clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, button: 0 }));
globalThis.__wsPress = (a, b) => {
  __wsE('mousedown', document.getElementById('wm'), a);
  __wsE('mousemove', window, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  __wsE('mousemove', window, b);
  __wsE('mouseup', window, b);
};
globalThis.__wsEdge = (x, y) => {
  const c = cursorCanvas, r = c.getBoundingClientRect();
  const px = Math.round((x - r.left) / r.width * c.width), py = Math.round((y - r.top) / r.height * c.height);
  const R = 8, x0 = Math.max(0, px - R), y0 = Math.max(0, py - R);
  const w = Math.min(c.width, px + R) - x0, h = Math.min(c.height, py + R) - y0;
  if (w <= 0 || h <= 0) return false;
  const d = cursorCtx.getImageData(x0, y0, w, h).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 80) return true;
  return false;
};
`;

module.exports = async function worldMapSeat(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');
  await dm.evaluate(PAGE);

  for (const deg of TURNS) {
    await dm.evaluate('setSeatTurn(' + deg + '); 0');
    await lib.settle(dm, '!viewportDirty', 8000);
    await dm.evaluate('worldMapShow(); 0');
    await lib.settle(dm, 'worldMapOpen && !_wmAnim', 15000);
    // ⚠ AT THE PLACES LEVEL: with no place drawn the map opens on the prints, where a place's name is hidden by design.
    await dm.evaluate('_wmCam = { ..._wmCam, z: WM_SPLIT * 0.8 }; _wmApplyCam(); 0');
    await dm.evaluate('document.getElementById("btn-rect").click(); 0');
    const box = await dm.evaluate(`(() => {
      const r = container.getBoundingClientRect();
      const a = { x: r.left + r.width * 0.08, y: r.top + r.height * 0.12 };
      const b = { x: r.left + r.width * 0.30, y: r.top + r.height * 0.40 };
      __wsPress(a, b);
      return { a, b };
    })()`);
    await lib.settle(dm, '!viewportDirty', 8000);
    const mid = { x: (box.a.x + box.b.x) / 2, y: (box.a.y + box.b.y) / 2 };
    const edges = await dm.evaluate(`({
      top: __wsEdge(${mid.x}, ${box.a.y}), bottom: __wsEdge(${mid.x}, ${box.b.y}),
      left: __wsEdge(${box.a.x}, ${mid.y}), right: __wsEdge(${box.b.x}, ${mid.y}) })`);
    // RED ON: the body.world #cursor-canvas seat rule removed (worldMap.css) and _wmFitOverlay's size left to syncSize — 2026-10-16
    rig.check(edges.top && edges.bottom && edges.left && edges.right,
              'at ' + deg + '° the place outline is not under the drawn spot: ' + JSON.stringify(edges));

    const plate = await dm.evaluate(`(() => {
      const h = [...document.querySelectorAll('.wm-hl')].find(e => /^New group/.test(e.textContent));
      if (!h) return null;
      const r = h.getBoundingClientRect();
      return { dx: r.left - ${box.a.x}, dy: r.top - ${box.a.y} };
    })()`);
    rig.check(plate && plate.dx > -4 && plate.dx < 40 && plate.dy > -4 && plate.dy < 40,
              'at ' + deg + '° the place plate is not at the top left of the drawn spot: ' + JSON.stringify(plate));

    const lay = await dm.evaluate(`(() => {
      const c = cursorCanvas.getBoundingClientRect(), k = container.getBoundingClientRect();
      return { same: Math.abs(c.left - k.left) < 1 && Math.abs(c.top - k.top) < 1 &&
                     Math.abs(c.width - k.width) < 1 && Math.abs(c.height - k.height) < 1,
               plain: getComputedStyle(cursorCanvas).transform === 'none',
               bitmap: cursorCanvas.width === container.clientWidth && cursorCanvas.height === container.clientHeight };
    })()`);
    rig.check(lay.same && lay.plain && lay.bitmap,
              'at ' + deg + '° the overlay canvas is not upright over the window: ' + JSON.stringify(lay));

    await dm.evaluate('worldPlaceDelete(worldMapSel.place ? worldPlaceByName(worldMapSel.place).id : null); worldMapHide(); 0');
    await lib.settle(dm, '!worldMapOpen', 15000);
    const back = await dm.evaluate(`(() => {
      const a = mapAreaSize(), cs = getComputedStyle(mapCanvas);
      const grid = getComputedStyle(gridCanvasEl);
      return { turned: container.classList.contains('seat-turned') === (${deg} !== 0),
               cursor: cursorCanvas.width === a.w && cursorCanvas.height === a.h,
               rot: ${deg} === 0 || getComputedStyle(cursorCanvas).transform !== 'none' };
    })()`);
    rig.check(back.turned && back.cursor && back.rot,
              'closing the world map at ' + deg + '° did not give the scene its turned canvases back: ' + JSON.stringify(back));
  }
  await dm.evaluate('setSeatTurn(0); 0');
};
