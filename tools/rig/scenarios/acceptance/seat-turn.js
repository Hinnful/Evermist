'use strict';

// seat-turn.js — MY SEAT: the DM's map turned so the laptop faces the way the table does.
//
// THE GOAL OF THIS FEATURE: the TV sits in the table turned from the laptop, so the DM turns the
// laptop map to match it and a hand movement on the laptop goes the same way on the table. The TV
// never changes. Every check below serves that sentence.
//
//   1. The Player tab has a My seat control with 0°, 90°, 180° and 270°.
//   2. Picking an angle snaps the DM map at once, and the app remembers it after a restart.
//   3. At every angle the map, the animated map, the fog and the effects sit on each other.
//   4. At every angle each grid square covers the same map square as at 0°.
//   5. Every drawing tool puts its shape where the mouse points, Select's gestures included.
//   6. A drag moves the map with the hand, the wheel zooms about the mouse, Fit fills the laptop.
//   7. Room labels fit the room as the screen shows it; the room card opens beside its room.
//   8. Grid calibration works on a turned map.
//   9. The minimap turns with the DM map, and a drag on it goes the way the hand goes.
//  10. Sync View gives the TV the same framing at 90° as at 0°.
//  11. The TV shows the same picture at every angle.
//  12. At every angle the size label of an effect being placed reads upright and sits above the
//      shape on screen.
//  13. In two-map mode each column turns its own map, and the columns stay side by side.
//  14. At every angle the label of a corner being rounded reads upright and sits below and right
//      of its circle on screen.
//
// ⚠ THE MOUSE IS AIMED BY THE BROWSER'S OWN LAYOUT, never by the app's conversion. __rigMouse is
// replaced below with one that reads the turned canvas's computed transform, so a conversion
// that is wrong in the app cannot be cancelled out by the same wrong conversion here.

const lib = require('../../lib');

const MAP_W = 2400, MAP_H = 1500;
const TURNS = [90, 180, 270];

// Where a map point lands on screen, read from the cursor canvas's computed layout. The PixiJS
// map, the grid and the overlay share that layout (3 checks it), so this is where the DM sees it.
const SEAT_HELPERS = `
globalThis.__seatMatrix = (el) => {
  const t = getComputedStyle(el).transform;
  return (t && t !== 'none') ? new DOMMatrix(t) : new DOMMatrix();
};
globalThis.__seatClient = (mx, my) => {
  const c = document.getElementById('cursor-canvas');
  const w = c.offsetWidth, h = c.offsetHeight;
  const p = __seatMatrix(c).transformPoint(new DOMPoint(mx * zoom + panX - w / 2, my * zoom + panY - h / 2));
  const r = container.getBoundingClientRect();
  return { x: r.left + c.offsetLeft + w / 2 + p.x, y: r.top + c.offsetTop + h / 2 + p.y };
};
globalThis.__rigMouse = (type, mx, my, opts) => {
  const o = opts || {};
  const p = __seatClient(mx, my);
  const ev = new MouseEvent(type, Object.assign({
    clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, button: 0,
  }, o.mods || {}));
  (o.onWindow ? window : container).dispatchEvent(ev);
};
globalThis.__seatClientBox = (x0, y0, x1, y1) => {
  const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => __seatClient(x, y));
  return { left: Math.min(...pts.map(p => p.x)), right: Math.max(...pts.map(p => p.x)),
           top: Math.min(...pts.map(p => p.y)), bottom: Math.max(...pts.map(p => p.y)) };
};
globalThis.__seatPick = (deg) => { document.querySelector('[data-seat="' + deg + '"]').click(); return 0; };
0`;

module.exports = async function seatTurn(rig) {
  let dm = rig.dm;

  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await dm.evaluate(SEAT_HELPERS);
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');
  await dm.evaluate('revealCircle(1200, 750, 1400); rebuildFogEffect(); fogDirty = true;' +
                    ' scheduleRender(); 0');
  await lib.settle(dm, '!fogTransRafId && !viewportDirty', 8000);

  // ── 1. the control ───────────────────────────────────────────────────────
  // RED ON: data-seat="270" changed to 2700, and separately the seat pill's cp-tabs class renamed (index.html) — 2026-10-02
  const control = await dm.evaluate(`(() => {
    const pane = document.getElementById('cp-sec-seat');
    const b = [...pane.querySelectorAll('[data-seat]')];
    return { seats: b.map(x => +x.dataset.seat), lit: b.filter(x => x.classList.contains('active'))
      .map(x => +x.dataset.seat), pill: !!b[0] && b[0].parentElement.classList.contains('cp-tabs') };
  })()`);
  rig.check(JSON.stringify(control.seats) === '[0,90,180,270]',
            'Scene control does not offer the four seats: ' + JSON.stringify(control));
  rig.check(control.pill, 'the seats are not a pick-one pill, so they read as four separate buttons');
  // refreshPlayerControlUI lights the pick; it runs on a tab switch and on every click.
  await dm.evaluate('refreshPlayerControlUI(); 0');
  rig.check(JSON.stringify(await dm.evaluate(`[...document.querySelectorAll('[data-seat].active')]
    .map(x => +x.dataset.seat)`)) === '[0]', 'a fresh app does not show 0° as the seat it is at');

  // ── 2, 3, 4, 5, 6 at every angle ─────────────────────────────────────────
  const camAt0 = await dm.evaluate('captureCamera()');
  for (const deg of TURNS) {
    // RED ON: clientToView's 0° early return forced (mapTurn.js), seatTurnCss returning '', the pan
    // delta left unturned (input.js), and localStorage.setItem gated off (mapTurn.js) — 2026-09-29
    await dm.evaluate('__seatPick(' + deg + ')');
    const state = await dm.evaluate(`({ seat: seatTurn,
      lit: [...document.querySelectorAll('[data-seat].active')].map(x => +x.dataset.seat),
      saved: localStorage.getItem('evermist.seatTurn'), cam: captureCamera() })`);
    rig.check(state.seat === deg && JSON.stringify(state.lit) === '[' + deg + ']',
              'picking ' + deg + '° did not turn the map, or the pill lit another seat: ' +
              JSON.stringify(state));
    rig.check(state.saved === String(deg), 'the ' + deg + '° seat was not kept for the next launch');
    // The snap keeps the point the DM was looking at in the middle, at the same zoom.
    rig.check(Math.abs(state.cam.mapCX - camAt0.mapCX) < 1 && Math.abs(state.cam.mapCY - camAt0.mapCY) < 1 &&
              Math.abs(state.cam.zoom - camAt0.zoom) < 1e-6,
              'turning to ' + deg + '° moved the view off what the DM was looking at: ' +
              JSON.stringify(state.cam) + ' from ' + JSON.stringify(camAt0));

    // 3 + 4: every canvas over the map, the PixiJS map and the grid among them, has one layout.
    const layers = await dm.evaluate(`(() => {
      const ref = document.getElementById('cursor-canvas');
      const rr = ref.getBoundingClientRect(), rm = __seatMatrix(ref).toString();
      const off = [];
      for (const c of document.querySelectorAll('#canvas-container > canvas')) {
        if (getComputedStyle(c).display === 'none') continue;
        const r = c.getBoundingClientRect();
        if (Math.abs(r.left - rr.left) > 0.5 || Math.abs(r.top - rr.top) > 0.5 ||
            Math.abs(r.width - rr.width) > 0.5 || Math.abs(r.height - rr.height) > 0.5 ||
            __seatMatrix(c).toString() !== rm || c.width !== ref.width || c.height !== ref.height) {
          off.push(c.id || c.className);
        }
      }
      const box = container.getBoundingClientRect();
      return { off, n: document.querySelectorAll('#canvas-container > canvas').length,
               fills: Math.abs(rr.width - box.width) < 1 && Math.abs(rr.height - box.height) < 1,
               ids: [...document.querySelectorAll('#canvas-container > canvas')].map(c => c.id) };
    })()`);
    rig.check(layers.off.length === 0,
              'at ' + deg + '° these layers sit apart from the rest of the map: ' + layers.off.join(', '));
    rig.check(layers.ids.includes('pixi-canvas') && layers.ids.includes('grid-canvas'),
              'the map or the grid layer is missing, so the check above compared nothing: ' +
              JSON.stringify(layers.ids));
    rig.check(layers.fills, 'at ' + deg + '° the turned map does not fill the map area');

    // 3: the animated map is a <video> on the DM, laid out by its own transform.
    const video = await dm.evaluate(`(() => {
      if (!videoDOMActive) return { dom: false };
      const r = container.getBoundingClientRect(), m = __seatMatrix(mapVideo);
      let worst = 0;
      for (const [x, y] of [[0, 0], [${MAP_W}, 0], [${MAP_W}, ${MAP_H}], [700, 1100]]) {
        const p = m.transformPoint(new DOMPoint(x, y));
        const q = __seatClient(x, y);
        worst = Math.max(worst, Math.hypot(r.left + mapVideo.offsetLeft + p.x - q.x,
                                           r.top + mapVideo.offsetTop + p.y - q.y));
      }
      return { dom: true, worst };
    })()`);
    if (video.dom) {
      rig.check(video.worst < 1, 'at ' + deg + '° the animated map sits ' + video.worst.toFixed(1) +
                'px off the grid and fog drawn over it');
    } else {
      rig.check(await dm.evaluate('!!pixiMapSprite && pixiMapSprite.visible'),
                'the animated map is neither the DOM video nor the PixiJS sprite, so nothing shows it');
    }

    // 5: the rectangle tool.
    const zoomNow = await dm.evaluate('zoom');
    const tol = 3 / zoomNow;
    const id = await dm.evaluate('__rigDrawShroud(500, 400, 900, 650)');
    const s = await dm.evaluate('__rigShape(' + id + ')');
    rig.check(Math.abs(s.box.x0 - 500) < tol && Math.abs(s.box.y0 - 400) < tol &&
              Math.abs(s.box.x1 - 900) < tol && Math.abs(s.box.y1 - 650) < tol,
              'at ' + deg + '° the rectangle landed at ' + JSON.stringify(s.box) +
              ', not under the drag from 500,400 to 900,650');

    // 6: a middle-button drag carries the map point under the pointer with the hand.
    const pan = await dm.evaluate(`(() => {
      const a = __seatClient(1200, 750);
      const ev = (t, x, y) => (t === 'mouseup' ? window : container).dispatchEvent(new MouseEvent(t,
        { clientX: x, clientY: y, button: 1, bubbles: true, cancelable: true }));
      ev('mousedown', a.x, a.y); ev('mousemove', a.x + 80, a.y + 30); ev('mouseup', a.x + 80, a.y + 30);
      const b = __seatClient(1200, 750);
      return { dx: b.x - a.x, dy: b.y - a.y };
    })()`);
    rig.check(Math.abs(pan.dx - 80) < 1 && Math.abs(pan.dy - 30) < 1,
              'at ' + deg + '° dragging the map 80,30 moved it ' + pan.dx.toFixed(1) + ',' +
              pan.dy.toFixed(1) + ', so the map does not follow the hand');

    const wheel = await dm.evaluate(`(() => {
      const a = __seatClient(1500, 900), z0 = zoom;
      container.dispatchEvent(new WheelEvent('wheel', { clientX: a.x, clientY: a.y, deltaY: -100,
        bubbles: true, cancelable: true }));
      const b = __seatClient(1500, 900);
      return { moved: Math.hypot(b.x - a.x, b.y - a.y), zoomed: zoom > z0 };
    })()`);
    rig.check(wheel.zoomed && wheel.moved < 1,
              'at ' + deg + '° the wheel did not zoom about the mouse: the point under it moved ' +
              wheel.moved.toFixed(1) + 'px');

    await dm.evaluate('polygons = polygons.filter(p => p.id !== ' + id + '); rebuildFogFromPolygons();' +
                      ' applyCamera(' + JSON.stringify(camAt0) + '); viewportDirty = true; 0');
  }

  // ── 6. Fit fills the laptop ──────────────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('__seatPick(90); fitToScreen(); viewportDirty = true; scheduleRender(); 0');
  const fit = await dm.evaluate(`(() => {
    const m = __seatClientBox(0, 0, mapWidth, mapHeight), r = container.getBoundingClientRect();
    return { inside: m.left >= r.left - 1 && m.right <= r.right + 1 && m.top >= r.top - 1 &&
                     m.bottom <= r.bottom + 1,
             fill: Math.max((m.right - m.left) / r.width, (m.bottom - m.top) / r.height) };
  })()`);
  rig.check(fit.inside && fit.fill > 0.9,
            'at 90° Fit did not fit the turned map to the laptop: ' + JSON.stringify(fit));

  // ── 5. the other tools, at 90° ───────────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  const zoom90 = await dm.evaluate('zoom');
  const tol90 = 3 / zoom90;

  await dm.evaluate('setShapeOp("new"); document.getElementById("btn-shroud").click(); setShape("poly");' +
                    ' __rigClick(300, 300); __rigClick(600, 320); __rigClick(560, 600); __rigClick(300, 300);' +
                    ' setShape("select"); 0');
  const poly = await dm.evaluate('__rigShape(polygons[polygons.length - 1].id)');
  const want = [[300, 300], [600, 320], [560, 600]];
  rig.check(poly.n === 3 && want.every(([x, y]) =>
              poly.verts.some(v => Math.abs(v.x - x) < tol90 && Math.abs(v.y - y) < tol90)),
            'at 90° the Polygon tool put its corners at ' + JSON.stringify(poly.verts) +
            ' rather than where the clicks were');

  await dm.evaluate('setPaintDirection("shroud"); brushSize = 40; setShape("brush");' +
                    ' __rigDrag(1500, 1150, 1700, 1150, { steps: 8, onWindow: true }); setShape("select"); 0');
  const brushed = await lib.poll(() => dm.evaluate(
    '__rigFog(1600, 1150) > 200 ? { on: __rigFog(1600, 1150), off: __rigFog(1600, 1300) } : null'), 8000);
  rig.check(!!brushed && brushed.off < 60,
            'at 90° the brush did not paint under the stroke, or painted somewhere else: ' +
            JSON.stringify(brushed));

  const room = await dm.evaluate('__rigDrawShroud(1000, 300, 1400, 600)');
  await dm.evaluate('__rigClick(1200, 450); 0');
  rig.check(await dm.evaluate('selectedPolygonId') === room,
            'at 90° a click inside the room did not pick it');
  await dm.evaluate('__rigDrag(1200, 450, 1300, 500); 0');
  const moved = await dm.evaluate('__rigShape(' + room + ').box');
  rig.check(Math.abs(moved.x0 - 1100) < tol90 && Math.abs(moved.y0 - 350) < tol90,
            'at 90° dragging the room 100,50 left it at ' + JSON.stringify(moved));

  const se = await dm.evaluate('boxSidePoint(shapeBoxOf(__rigById(' + room + ')), "se")');
  await dm.evaluate('__rigDrag(' + se.x + ',' + se.y + ',' + (se.x + 200) + ',' + (se.y + 100) + '); 0');
  const scaled = await dm.evaluate('shapeBoxOf(__rigById(' + room + '))');
  rig.check(Math.abs(scaled.maxX - (se.x + 200)) < 2 * tol90 && Math.abs(scaled.maxY - (se.y + 100)) < 2 * tol90 &&
            Math.abs(scaled.minX - 1100) < tol90,
            'at 90° the corner handle did not follow the drag: ' + JSON.stringify(scaled));

  const b = scaled, c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  const out = { x: b.maxX + 13 / zoom90, y: b.minY - 13 / zoom90 };
  const before = await dm.evaluate('__rigShape(' + room + ')');
  const r0 = Math.hypot(out.x - c.x, out.y - c.y), a0 = Math.atan2(out.y - c.y, out.x - c.x) + Math.PI / 6;
  await dm.evaluate('__rigDrag(' + out.x + ',' + out.y + ',' + (c.x + r0 * Math.cos(a0)) + ',' +
                    (c.y + r0 * Math.sin(a0)) + '); 0');
  const after = await dm.evaluate('__rigShape(' + room + ')');
  const edge = s => Math.atan2(s.verts[1].y - s.verts[0].y, s.verts[1].x - s.verts[0].x);
  const turned = ((edge(after) - edge(before)) * 180 / Math.PI + 540) % 360 - 180;
  rig.check(Math.abs(turned - 30) < 2,
            'at 90° turning the room by its corner ring gave ' + turned.toFixed(1) + '° for a 30° drag');
  await dm.evaluate('__rigKey("Escape"); 0');

  // ── 7. labels and the room card ──────────────────────────────────────────
  // RED ON: fitLabelBox handed the unturned room (roomPanel.js), and the card's turned box gated
  // off (roomCard.js) — 2026-09-29
  // A long name in a narrow tall room: whole only when the plate runs along the room's length.
  const hall = await dm.evaluate('__rigDrawShroud(1820, 150, 2070, 1350)');
  const label = async () => dm.evaluate(`(() => {
    const p = __rigById(${hall}); p.name = 'Corridor of Echoes'; showRoomLabels = true;
    selectedPolygonId = null; drawCursor(null, null);
    const e = _rpLabelCache.get(${hall});
    return e ? { text: e.text, x: e.mx, y: e.my } : null;
  })()`);
  const lab90 = await label();
  rig.check(!!lab90 && lab90.text === 'Corridor of Echoes',
            'at 90° the tall room\'s label was cut short, so it is fitted as if the map were upright: ' +
            JSON.stringify(lab90));
  rig.check(!!lab90 && lab90.x >= 1820 && lab90.x <= 2070 && lab90.y >= 150 && lab90.y <= 1350,
            'at 90° the label sits outside its room: ' + JSON.stringify(lab90));
  await dm.evaluate('__seatPick(0); 0');
  const lab0 = await label();
  rig.check(!lab0 || lab0.text !== 'Corridor of Echoes',
            'the long name fits the narrow room upright too, so the check above proves nothing: ' +
            JSON.stringify(lab0));
  await dm.evaluate('__seatPick(90); 0');
  rig.byEye('whether room labels and the calibration numbers read upright at each seat');

  // ⚠ A ROOM NEAR THE MAP'S CORNER. The middle of the view sits still under a turn, so a click
  // read off the unturned map lands on a middle room anyway and the check cannot tell.
  await dm.evaluate('setShape("select"); __rigClick(487, 407); 0');
  rig.check(await dm.evaluate('selectedPolygonId') === poly.id, 'the corner room was not picked');
  await lib.settle(dm, '!document.getElementById("notes-panel").hidden && document.getElementById("panel-room").offsetParent !== null', 8000);
  rig.check(await dm.evaluate('!document.getElementById("notes-panel").hidden && document.getElementById("panel-room").offsetParent !== null'),
            'at 90° picking the corner room did not show it in the left panel');
  await dm.evaluate('__rigKey("Escape"); __rigKey("Escape"); 0');

  // ── 8. calibration ───────────────────────────────────────────────────────
  // RED ON: the HUD centred on the unturned square (gridCalibrate.js) — 2026-09-29
  await dm.evaluate('document.getElementById("cp-grid-calibrate").click(); 0');
  await dm.evaluate('__rigMouse("mousemove", 300, 200); __rigMouse("mousedown", 300, 200);' +
                    ' __rigMouse("mousemove", 720, 410); __rigMouse("mouseup", 720, 410, { onWindow: true }); 0');
  const span = await dm.evaluate('gridCalSpan && ({ ax: gridCalSpan.ax, ay: gridCalSpan.ay,' +
    ' w: gridCalSpan.bx - gridCalSpan.ax, h: gridCalSpan.by - gridCalSpan.ay })');
  rig.check(!!span && Math.abs(span.ax - 300) < tol90 && Math.abs(span.ay - 200) < tol90 &&
            Math.abs(Math.abs(span.w) - 420) < 4,
            'at 90° the calibration square did not start and run where it was dragged: ' +
            JSON.stringify(span));
  const hud = await dm.evaluate(`(() => {
    gridCalPlaceHud();
    const h = document.getElementById('gridcal-hud').getBoundingClientRect();
    const s = gridCalSpan, r = __seatClientBox(s.ax, s.ay, s.bx, s.by);
    return { cx: (h.left + h.right) / 2, from: r.left, to: r.right };
  })()`);
  rig.check(hud.cx >= hud.from - 2 && hud.cx <= hud.to + 2,
            'at 90° the calibration HUD is not centred under its square: ' + JSON.stringify(hud));
  await dm.evaluate('__rigKey("Escape"); 0');
  await dm.waitFor('gridCalArmed === false', 8000, 'calibration to close');

  // ── 9. the minimap ───────────────────────────────────────────────────────
  // RED ON: the minimap drag left unturned, and its canvas left upright (minimap.js, mapTurn.js) — 2026-09-29
  const mm = await dm.evaluate(`(() => {
    const c = document.getElementById('minimap-canvas');
    const m = __seatMatrix(c);
    const r = c.getBoundingClientRect();
    if (!r.width) return { err: 'the minimap has no size on screen' };
    const cx0 = minimapView.mapCX, cy0 = minimapView.mapCY;
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    const orig = c.setPointerCapture; c.setPointerCapture = () => {};
    const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { pointerId: 7, clientX: x, clientY: y,
      bubbles: true, cancelable: true }));
    ev('pointerdown', x0, y0); ev('pointermove', x0 + 30, y0); ev('pointerup', x0 + 30, y0);
    c.setPointerCapture = orig;
    return { turned: Math.abs(m.b - 1) < 1e-6 && Math.abs(m.c + 1) < 1e-6,
             dx: minimapView.mapCX - cx0, dy: minimapView.mapCY - cy0 };
  })()`);
  rig.check(mm.turned, 'at 90° the minimap did not turn with the DM map: ' + JSON.stringify(mm));
  // Turned a quarter clockwise, screen right is the preview's up, so the TV's centre moves to +y.
  rig.check(Math.abs(mm.dx) < 1 && mm.dy > 5,
            'at 90° a drag to the right on the minimap moved the view ' + JSON.stringify(mm) +
            ', not the way the hand went');

  // ── 12. the size label of an effect being placed ─────────────────────────
  // RED ON: uprightAt gated off, and separately the up vector's turn zeroed in drawPresetPreview (toolPreset.js) — 2026-10-03
  // Read at the moment drawPresetPreview draws it: the label's canvas point and the context's
  // transform, then the canvas's own CSS turn, so the answer is what the DM sees on screen.
  await dm.evaluate(`(() => {
    fitToScreen(); setPlaceMode('effects'); setShape('circle');
    setPreset({ kind: 'circle', ...EFFECT_PRESETS.circle[3] });
    globalThis.__seatLabelText = presetLabel('circle', presetArmed.s, presetArmed.w, t);
    globalThis.__seatHits = [];
    const saved = cursorCtx.fillText;
    globalThis.__seatUnspy = () => { delete cursorCtx.fillText; };
    cursorCtx.fillText = function (txt, x, y) {
      if (txt === globalThis.__seatLabelText) globalThis.__seatHits.push({ x, y, m: this.getTransform() });
      return saved.apply(this, arguments);
    };
    globalThis.__seatLabelRead = (mx, my) => {
      const h = globalThis.__seatHits[globalThis.__seatHits.length - 1];
      if (!h) return null;
      const c = document.getElementById('cursor-canvas'), M = __seatMatrix(c);
      const ctxDeg = Math.atan2(h.m.b, h.m.a) * 180 / Math.PI, cssDeg = Math.atan2(M.b, M.a) * 180 / Math.PI;
      const net = ((ctxDeg + cssDeg) % 360 + 540) % 360 - 180;
      const k = c.offsetWidth / c.width, P = h.m.transformPoint(new DOMPoint(h.x, h.y));
      const w = c.offsetWidth, ht = c.offsetHeight;
      const q = M.transformPoint(new DOMPoint(P.x * k - w / 2, P.y * k - ht / 2));
      const r = container.getBoundingClientRect();
      const at = { x: r.left + c.offsetLeft + w / 2 + q.x, y: r.top + c.offsetTop + ht / 2 + q.y };
      return { net, above: __seatClient(mx, my).y - at.y };
    };
    return 0;
  })()`);
  for (const deg of TURNS) {
    await dm.evaluate('__seatPick(' + deg + '); fitToScreen(); globalThis.__seatHits.length = 0; ' +
                      '__rigMouse("mousemove", 1200, 750); 0');
    const read = await lib.poll(() => dm.evaluate('globalThis.__seatHits.length ? { v: __seatLabelRead(1200, 750) } : null'), 8000);
    rig.check(!!read && !!read.v && Math.abs(read.v.net) < 0.5,
              'at ' + deg + '° the size label of an effect being placed is not upright: ' + JSON.stringify(read));
    rig.check(!!read && !!read.v && read.v.above > 5,
              'at ' + deg + '° the size label sits beside or below the shape on screen, not above it: ' +
              JSON.stringify(read));
  }
  await dm.evaluate('__seatUnspy(); setPreset(null); setShape("select"); setPlaceMode("rooms"); __seatPick(90); 0');

  // ── 14. the label of a corner being rounded ──────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  // The same read as 12, against the circle being dragged: the label's net turn on screen, and
  // where it lands from the circle as the DM sees it.
  await dm.evaluate(`(() => {
    polygons.push({ id: 9014, vertices: [{x:600,y:400},{x:1800,y:400},{x:1800,y:1100},{x:600,y:1100}],
                    mode: 'shroud', cornerRadius: 0, name: 'Seat corner' });
    rebuildFogFromPolygons();
    globalThis.__seatHits = [];
    const saved = cursorCtx.fillText;
    globalThis.__seatUnspy = () => { delete cursorCtx.fillText; };
    cursorCtx.fillText = function (txt, x, y) {
      if (/ px$/.test(txt)) globalThis.__seatHits.push({ x, y, m: this.getTransform() });
      return saved.apply(this, arguments);
    };
    globalThis.__seatCornerRead = (mx, my) => {
      const h = globalThis.__seatHits[globalThis.__seatHits.length - 1];
      if (!h) return null;
      const c = document.getElementById('cursor-canvas'), M = __seatMatrix(c);
      const ctxDeg = Math.atan2(h.m.b, h.m.a) * 180 / Math.PI, cssDeg = Math.atan2(M.b, M.a) * 180 / Math.PI;
      const net = ((ctxDeg + cssDeg) % 360 + 540) % 360 - 180;
      const k = c.offsetWidth / c.width, P = h.m.transformPoint(new DOMPoint(h.x, h.y));
      const w = c.offsetWidth, ht = c.offsetHeight;
      const q = M.transformPoint(new DOMPoint(P.x * k - w / 2, P.y * k - ht / 2));
      const r = container.getBoundingClientRect();
      const at = { x: r.left + c.offsetLeft + w / 2 + q.x, y: r.top + c.offsetTop + ht / 2 + q.y };
      const o = __seatClient(mx, my);
      return { net, right: at.x - o.x, below: at.y - o.y };
    };
    return 0;
  })()`);
  for (const deg of TURNS) {
    const read = await dm.evaluate(`(() => {
      __seatPick(${deg}); fitToScreen(); setShape('select');
      const poly = __rigById(9014); poly.cornerRadius = 0;
      selectedPolygonId = 9014; leaveShapeEditMode();
      __rigMouse('mousemove', 1200, 750);
      const h = __rigCornerCircle(0);
      if (!h) return { err: 'no circle on the focused room' };
      globalThis.__seatHits.length = 0;
      __rigMouse('mousedown', h.x, h.y);
      __rigMouse('mousemove', h.x + 30, h.y + 30);
      const v = __seatCornerRead(h.x, h.y);
      __rigMouse('mouseup', h.x + 30, h.y + 30);
      return v;
    })()`);
    rig.check(!!read && !read.err && Math.abs(read.net) < 0.5,
              'at ' + deg + '° the label of a corner being rounded is not upright: ' + JSON.stringify(read));
    rig.check(!!read && !read.err && read.right > 5 && read.below > 5,
              'at ' + deg + '° the rounding label is not below and right of its circle on screen: ' +
              JSON.stringify(read));
  }
  await dm.evaluate('__seatUnspy(); polygons = polygons.filter(p => p.id !== 9014); selectedPolygonId = null;' +
                    ' rebuildFogFromPolygons(); __seatPick(90); 0');

  // ── 10 + 11. the TV ──────────────────────────────────────────────────────
  // RED ON: dmVisibleRegion's sideways branch gated off (viewport.js) — 2026-09-29
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen && fogCoverT === 0', 45000, 'the Player to show the map');
  const tvCam = () => player.evaluate('({ cam: captureCamera(), seat: seatTurn,' +
    ' turned: [...document.querySelectorAll("#canvas-container > canvas")]' +
    '.some(c => getComputedStyle(c).transform !== "none") })');
  const syncAt = deg => dm.evaluate('__seatPick(' + deg + '); applyCamera(' +
    JSON.stringify({ ...camAt0, zoom: camAt0.zoom * 2 }) + '); viewportDirty = true;' +
    ' document.getElementById("btn-sync-view").click(); dmVisibleRegion()');
  // At 0° the region is the one Sync View has always sent, so the TV's zoom can be worked out.
  const sent0 = await syncAt(0);
  const tvSize = await player.evaluate('getViewportSize()');
  const want0 = Math.min(tvSize.w / sent0.viewW, tvSize.h / sent0.viewH);
  const tv0 = await lib.poll(async () => {
    const t = await tvCam();
    return (Math.abs(t.cam.zoom - want0) < want0 * 0.02 && !(await player.evaluate('viewLerpActive'))) ? t : null;
  }, 20000);
  rig.check(!!tv0, 'Sync View at 0° never landed on the TV, so the 90° comparison has nothing to hold to');
  await syncAt(90);
  await lib.hold(1500, 'long enough for a wrongly shaped region to lerp the TV somewhere else');
  await lib.settle(player, '!viewLerpActive', 8000);
  const tv90 = await tvCam();
  rig.note('Sync View at 0° gave the TV ' + JSON.stringify(tv0 && tv0.cam) + ', at 90° ' + JSON.stringify(tv90.cam));
  if (tv0) rig.check(Math.abs(tv90.cam.zoom - tv0.cam.zoom) < tv0.cam.zoom * 0.02 &&
            Math.abs(tv90.cam.mapCX - tv0.cam.mapCX) < 5 && Math.abs(tv90.cam.mapCY - tv0.cam.mapCY) < 5,
            'Sync View framed the TV differently at 90° than at 0°');
  rig.check(tv90.seat === 0 && !tv90.turned, 'the TV turned with the laptop: ' + JSON.stringify(tv90));

  // ── 13. two maps ─────────────────────────────────────────────────────────
  // RED ON: the pane-seat-turn handler gated off (paneRuntime.js) — 2026-09-29
  await dm.evaluate('document.getElementById("btn-two-maps").click(); 0');
  await dm.waitFor('panesActive && panes.A.ready && panes.B.ready', 180000, 'both columns to come up');
  const paneA = await rig.pane('A');
  await paneA.waitFor('typeof currentScene !== "undefined" && currentScene && !!mapOffscreen', 60000,
                      'column A to have the map');
  const colTurn = s => s.evaluate('({ seat: seatTurn, t: getComputedStyle(document.getElementById(' +
    '"cursor-canvas")).transform })');
  const a90 = await colTurn(paneA);
  rig.check(a90.seat === 90 && a90.t !== 'none', 'column A did not come up turned: ' + JSON.stringify(a90));
  const row = await dm.evaluate(`(() => {
    const a = document.querySelector('.pane-col[data-pane="A"]').getBoundingClientRect();
    const b = document.querySelector('.pane-col[data-pane="B"]').getBoundingClientRect();
    return { side: a.right <= b.left + 1 && Math.abs(a.top - b.top) < 1 };
  })()`);
  rig.check(row.side, 'the two columns no longer sit side by side at 90°');
  await dm.evaluate('__seatPick(180); 0');
  await paneA.waitFor('seatTurn === 180', 8000, 'column A to take the new seat');
  rig.check((await colTurn(paneA)).seat === 180, 'a seat picked in two-map mode did not reach column A');
  await dm.evaluate('__seatPick(90); 0');
  await paneA.waitFor('seatTurn === 90', 8000, 'column A to take 90° back');
  await dm.evaluate('document.querySelector(`.pane-col[data-pane="B"] .pane-close`).click(); 0');
  await dm.waitFor('!panesActive', 30000, 'two-map mode to close');

  // ── 2. the seat survives a restart ───────────────────────────────────────
  // RED ON: localStorage.setItem gated off (mapTurn.js) — 2026-09-29
  dm = await rig.restart();
  await lib.installHelpers(dm);
  await dm.evaluate(SEAT_HELPERS);
  const back = await dm.evaluate(`({ seat: seatTurn,
    t: getComputedStyle(document.getElementById('cursor-canvas')).transform,
    lit: (refreshPlayerControlUI(), [...document.querySelectorAll('[data-seat].active')].map(x => +x.dataset.seat)) })`);
  rig.check(back.seat === 90 && back.t !== 'none' && JSON.stringify(back.lit) === '[90]',
            'the app came back up at another seat than the one picked: ' + JSON.stringify(back));
  await dm.evaluate('__seatPick(0); 0');
  rig.check(await dm.evaluate('getComputedStyle(document.getElementById("cursor-canvas")).transform') === 'none',
            'going back to 0° left the map turned');
};
