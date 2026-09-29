'use strict';

// ping.js — A PING AT A POINT ON THE MAP, SO THE PLAYERS LOOK WHERE THE DM MEANS.
//
// THE GOAL OF THIS FEATURE: the DM Ctrl+middle-clicks a point and the TV shows a short gold mark
// there, without the DM picking a tool or changing anything on the map.
//
//   A. Ctrl+middle-click on the DM map shows a ping at that map point on the DM map and on the TV.
//   B. A plain middle-drag still pans the map and pings nothing.
//   C. A ping with a drawing tool armed draws nothing, adds no room, and leaves undo alone.
//   D. The ping ends on its own on both screens, and nothing of it is saved in the scene.
//   E. With My seat turned, the ping lands on the map point under the pointer.
//   F. The shortcut legend lists the ping.
//   (Two-map mode: two-maps.js Q.)

const lib = require('../../lib');

const MAP_W = 2000, MAP_H = 1400;

// Aimed by the browser's own layout of the turned canvas, never by the app's conversion (seat-turn.js).
const OWN_HELPERS = `
globalThis.__pingClient = (mx, my) => {
  const c = document.getElementById('cursor-canvas');
  const w = c.offsetWidth, h = c.offsetHeight, t = getComputedStyle(c).transform;
  const m = (t && t !== 'none') ? new DOMMatrix(t) : new DOMMatrix();
  const p = m.transformPoint(new DOMPoint(mx * zoom + panX - w / 2, my * zoom + panY - h / 2));
  const r = container.getBoundingClientRect();
  return { x: r.left + c.offsetLeft + w / 2 + p.x, y: r.top + c.offsetTop + h / 2 + p.y };
};
globalThis.__pingPress = (mx, my, ctrl) => {
  const p = __pingClient(mx, my);
  container.dispatchEvent(new MouseEvent('mousedown', { clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, button: 1, ctrlKey: ctrl }));
  return 0;
};
globalThis.__pingLast = () => { const p = _pings[_pings.length - 1]; return p ? { x: p.mx, y: p.my, n: _pings.length } : null; };
0`;

module.exports = async function pingFeature(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await dm.evaluate(OWN_HELPERS);
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');
  const tv = await rig.player();
  await dm.evaluate('sendToPlayer(); 0');
  await tv.waitFor('mapWidth > 0 && fogCoverT === 0', 30000, 'the map to reach the TV');

  // ── A. the ping reaches both screens at the same map point ────────────────
  // RED ON: the postMessage in pingAt gated off with false && (playerWindow.js) — 2026-09-29
  await dm.evaluate('__pingPress(700, 500, true)');
  const dmPing = await dm.evaluate('__pingLast()');
  rig.check(dmPing && Math.abs(dmPing.x - 700) < 2 && Math.abs(dmPing.y - 500) < 2,
            'Ctrl+middle-click showed no ping at the point on the DM map: ' + JSON.stringify(dmPing));
  await lib.settle(tv, 'typeof _pings !== "undefined" && _pings.length > 0', 5000);
  const tvPing = await tv.evaluate('_pings[0] && { x: _pings[0].mx, y: _pings[0].my }');
  rig.check(tvPing && Math.abs(tvPing.x - 700) < 2 && Math.abs(tvPing.y - 500) < 2,
            'the TV showed the ping somewhere else: ' + JSON.stringify(tvPing));
  const onTv = await tv.evaluate(`(() => { const c = document.getElementById('ping-canvas');
    return c ? { w: c.width, h: c.height, vw: innerWidth * devicePixelRatio, vh: innerHeight * devicePixelRatio } : null; })()`);
  rig.check(onTv && Math.abs(onTv.w - onTv.vw) <= 2 && Math.abs(onTv.h - onTv.vh) <= 2,
            'the TV\'s ping layer does not fill the TV window: ' + JSON.stringify(onTv));
  rig.byEye('the ping reads from across the room and looks like the bezel prototype');

  // ── B. a plain middle-drag still pans ─────────────────────────────────────
  // RED ON: the ctrlKey test dropped and the press handed on to toolMouseDown (input.js); B and C both red — 2026-09-29
  const before = await dm.evaluate('({ panX, n: _pings.length })');
  await dm.evaluate(`(() => { const p = __pingClient(1000, 700);
    container.dispatchEvent(new MouseEvent('mousedown', { clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, button: 1 }));
    container.dispatchEvent(new MouseEvent('mousemove', { clientX: p.x + 80, clientY: p.y, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: p.x + 80, clientY: p.y, bubbles: true, button: 1 }));
    container.dispatchEvent(new MouseEvent('mouseup', { clientX: p.x + 80, clientY: p.y, bubbles: true, button: 1 }));
    return 0; })()`);
  const after = await dm.evaluate('({ panX, n: _pings.length })');
  rig.check(Math.abs(after.panX - before.panX - 80) < 2, 'a middle-drag no longer pans the map: ' + JSON.stringify({ before, after }));
  rig.check(after.n <= before.n, 'a plain middle-drag placed a ping');

  // ── C. a ping with a tool armed changes nothing ───────────────────────────
  // RED ON: the ping press handed on to toolMouseDown (input.js) — 2026-09-29
  const map0 = await dm.evaluate('({ rooms: polygons.length, undo: undoStack.length, drawing: !!isDrawing })');
  await dm.evaluate('setShape("rect"); __pingPress(900, 600, true); setShape("poly"); __pingPress(950, 650, true); setShape("select"); 0');
  const map1 = await dm.evaluate('({ rooms: polygons.length, undo: undoStack.length, drawing: !!isDrawing, polyPts: activePolygon ? 1 : 0 })');
  rig.check(map1.rooms === map0.rooms && map1.undo === map0.undo && !map1.drawing && !map1.polyPts,
            'a ping with a drawing tool armed changed the map: ' + JSON.stringify({ map0, map1 }));

  // ── D. the ping ends, and nothing of it is saved ──────────────────────────
  // RED ON: the splice in _pingTick gated off with false && (ping.js) — 2026-09-29
  const ended = await lib.poll(async () => {
    const a = await dm.evaluate('_pings.length'), b = await tv.evaluate('_pings.length');
    return a === 0 && b === 0 ? { done: true } : null;
  }, 8000);
  rig.check(ended && ended.done, 'a ping was still showing 8 seconds after it was placed');
  const saved = await dm.evaluate('JSON.stringify(currentScene || {}).includes("ping")');
  rig.check(!saved, 'the scene carries a ping');

  // ── E. My seat turned ─────────────────────────────────────────────────────
  // RED ON: screenToMap swapped for an unturned client read in the ping line (input.js) — 2026-09-29
  await dm.evaluate('setSeatTurn(90); 0');
  await lib.settle(dm, '!viewportDirty', 5000);
  await dm.evaluate('__pingPress(600, 900, true)');
  const turned = await dm.evaluate('__pingLast()');
  rig.check(turned && Math.abs(turned.x - 600) < 3 && Math.abs(turned.y - 900) < 3,
            'with My seat at 90° the ping landed off the pointer: ' + JSON.stringify(turned));
  await dm.evaluate('setSeatTurn(0); 0');

  // ── F. the legend ─────────────────────────────────────────────────────────
  // RED ON: the legend row's text changed (index.html) — 2026-09-29
  rig.check(await dm.evaluate('document.getElementById("shortcut-legend").textContent.includes("Ping a point")'),
            'the shortcut legend does not list the ping');
};
