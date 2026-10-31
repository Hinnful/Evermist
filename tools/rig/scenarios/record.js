'use strict';
// Records the README clips off-screen: `npm run rig -- record`. Never part of a regression run.
// REC_OUT names the output folder, REC_MAPS the DM's map folder, REC_CLIP the clip to record.
const fs = require('fs');
const path = require('path');
const lib = require('../lib');
const cdp = require('../cdp');
const OUT = process.env.REC_OUT;
const MAPS = process.env.REC_MAPS;

// Every painted frame of one window, with its time, until stop() is called.
function screencast(session, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  const prev = session._onEvent.bind(session);
  session._onEvent = (method, p) => {
    if (method !== 'Page.screencastFrame') return prev(method, p);
    const file = path.join(dir, String(frames.length).padStart(5, '0') + '.jpg');
    fs.writeFileSync(file, Buffer.from(p.data, 'base64'));
    frames.push({ file, t: p.metadata.timestamp });
    session.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
  };
  const start = () => session.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
  const stop = async () => {
    await session.send('Page.stopScreencast');
    session._onEvent = prev;
    const lines = [];
    frames.forEach((f, i) => {
      const next = frames[i + 1] ? frames[i + 1].t : f.t + 0.5;
      lines.push("file '" + f.file.replace(/\\/g, '/') + "'", 'duration ' + Math.max(0.001, next - f.t).toFixed(4));
    });
    if (frames.length) lines.push("file '" + frames[frames.length - 1].file.replace(/\\/g, '/') + "'");
    fs.writeFileSync(path.join(dir, 'list.txt'), lines.join('\n'));
    fs.writeFileSync(path.join(dir, 'start.txt'), String(frames.length ? frames[0].t : 0));
    return frames.length;
  };
  return { start, stop };
}

// A drawn pointer, since a screencast carries none: it glides to a point and dips on a click.
const POINTER = `
globalThis.__cur = (() => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transform:translate(-200px,-200px)';
  d.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))"><path d="M4 2 L4 19.5 L8.6 15.2 L11.8 22.4 L14.9 21 L11.7 13.9 L18 13.9 Z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  document.body.appendChild(d);
  return { el: d, x: -200, y: -200 };
})();
globalThis.__curSet = (x, y) => { __cur.x = x; __cur.y = y; __cur.el.style.transform = 'translate(' + (x - 4) + 'px,' + (y - 2) + 'px)'; };
globalThis.__curTo = (x, y, ms) => new Promise(res => {
  const x0 = __cur.x, y0 = __cur.y, t0 = performance.now();
  const step = t => {
    const k = Math.min(1, (t - t0) / ms), e = (1 - Math.cos(Math.PI * k)) / 2;
    __curSet(x0 + (x - x0) * e, y0 + (y - y0) * e);
    if (k < 1) requestAnimationFrame(step); else res();
  };
  requestAnimationFrame(step);
});
globalThis.__goEl = (sel, ms) => { const r = document.querySelector(sel).getBoundingClientRect(); return __curTo(r.x + r.width / 2, r.y + r.height / 2, ms); };
globalThis.__goMap = (x, y, ms) => { const p = __mapPt(x, y); return __curTo(p.x, p.y, ms); };
globalThis.__clickEl = sel => { __curDip(); document.querySelector(sel).click(); return 0; };
globalThis.__curDip = () => __cur.el.firstChild.animate([{ transform: 'scale(1)' }, { transform: 'scale(.82)' }, { transform: 'scale(1)' }], { duration: 220 });
globalThis.__mapPt = (mx, my) => { const r = container.getBoundingClientRect(); return { x: mx * zoom + panX + r.left, y: my * zoom + panY + r.top }; };
globalThis.__elPt = id => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
// A press, a drag and a release on the map, the pointer travelling with the events frame by frame.
globalThis.__mapDrag = (x1, y1, x2, y2, ms, mods) => new Promise(res => {
  const o = { mods: mods || {} }, t0 = performance.now();
  __rigMouse('mousedown', x1, y1, o); __curDip();
  const step = t => {
    const k = Math.min(1, (t - t0) / ms), e = (1 - Math.cos(Math.PI * k)) / 2;
    const x = x1 + (x2 - x1) * e, y = y1 + (y2 - y1) * e, p = __mapPt(x, y);
    __curSet(p.x, p.y); __rigMouse('mousemove', x, y, o);
    if (k < 1) requestAnimationFrame(step); else { __rigMouse('mouseup', x2, y2, { mods: o.mods }); res(); }
  };
  requestAnimationFrame(step);
});
// The pointer glides to a map point with real mousemoves under it, so hover states follow.
globalThis.__mapHover = (x, y, ms) => new Promise(res => {
  const a = { x: __cur.x, y: __cur.y }, b = __mapPt(x, y), t0 = performance.now(), r = container.getBoundingClientRect();
  const step = t => {
    const k = Math.min(1, (t - t0) / ms), e = (1 - Math.cos(Math.PI * k)) / 2;
    const cx = a.x + (b.x - a.x) * e, cy = a.y + (b.y - a.y) * e;
    __curSet(cx, cy); __rigMouse('mousemove', (cx - r.left - panX) / zoom, (cy - r.top - panY) / zoom);
    if (k < 1) requestAnimationFrame(step); else res();
  };
  requestAnimationFrame(step);
});
// Typing into a field a key at a time, as a hand does.
globalThis.__typeInto = (el, text, ms) => new Promise(res => {
  el.focus(); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true }));
  let i = 0;
  const tick = () => {
    el.value += text[i++]; el.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof mtCloseDropdown === 'function') mtCloseDropdown();   // no module is loaded, so its list says only that
    if (i < text.length) setTimeout(tick, ms + Math.random() * ms * 0.6); else res();
  };
  setTimeout(tick, ms);
});
// The map view closed on a box of the map, centred between the left panel and the rail.
globalThis.__viewBox = (x0, y0, x1, y1, fill, left) => {
  const r = container.getBoundingClientRect(), L = (left || 0) - r.left,
        R = document.getElementById('dock-rail').getBoundingClientRect().left - r.left;
  zoom = Math.min((R - L) / (x1 - x0), (r.height - 150) / (y1 - y0)) * (fill || 0.9);
  panX = (L + R) / 2 - (x0 + x1) / 2 * zoom; panY = (r.height - 90) / 2 - (y0 + y1) / 2 * zoom;
  viewportDirty = gridDirty = fogDirty = cursorDirty = true; scheduleRender();
};
// A smooth zoom of the world map toward a zoom level, about the pointer, as a pinch gesture (a plain wheel here pans).
globalThis.__wmZoom = (zTo, ms) => new Promise(res => {
  const wm = document.getElementById('wm'), z0 = _wmCam.z, t0 = performance.now();
  const step = t => {
    const k = Math.min(1, (t - t0) / ms), e = (1 - Math.cos(Math.PI * k)) / 2, d = -Math.log(z0 * Math.pow(zTo / z0, e) / _wmCam.z) / 0.01;
    if (Math.abs(d) > 1e-6) wm.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: Math.max(-10, Math.min(10, d)), clientX: __cur.x, clientY: __cur.y, bubbles: true, cancelable: true }));
    if (k < 1) requestAnimationFrame(step); else res();
  };
  requestAnimationFrame(step);
});
// The Notes window opened and moved to a screen point (top left), then its right edge, so the map can sit beside it.
globalThis.__nwAt = (l, t, w, h) => {
  nwShow();
  const el = document.getElementById('notes-window'), z = _nwZoom();
  el.style.left = l / z + 'px'; el.style.top = t / z + 'px';
  if (w) el.style.width = w / z + 'px'; if (h) el.style.height = h / z + 'px';
  _nwPlace();
  return Math.round(el.getBoundingClientRect().right);
};
globalThis.__roomCentre = p => { const xs = p.vertices.map(v => v.x), ys = p.vertices.map(v => v.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }; };
`;

// Real key events, a character at a time with a hand's uneven pace, at whatever holds focus.
async function typeKeys(session, text, ms) {
  for (const ch of text) {
    await session.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch });
    await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    await lib.hold(ms + Math.random() * ms * 0.6, 'the next key');
  }
}
async function pressEnter(session) {
  await session.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
}

module.exports = async function record(rig) {
  const dm = rig.dm;
  const clip = process.env.REC_CLIP || 'hero';
  // No first-use hint cards over the footage.
  await dm.evaluate("try { localStorage.setItem('evermist.hintsOff', '1'); } catch (_) {} hintClose(); 0");

  // The DM's animated map, imported under an English name, with its floor plan (when it has one) as rooms.
  const importAnim = async (name, rel, withPlan) => {
    const full = path.join(MAPS, rel);
    const expr = await rig.fixtures.asFileExpr(dm, { base64: fs.readFileSync(full).toString('base64'), name: name + '.webm', type: 'video/webm' });
    await dm.evaluate('createNewScene(' + expr + ')', 300000);
    await dm.waitFor('currentScene && currentScene.name === ' + JSON.stringify(name) + ' && fogCoverT === 0', 300000, 'the import of ' + name);
    const plan = full.replace(/\.webm$/i, '.dd2vtt');
    if (withPlan && fs.existsSync(plan)) {
      await dm.writeBig('__plan', fs.readFileSync(plan, 'utf8'));
      await dm.evaluate('(async () => { hideFloorPlanNotice(); await attachPlanText(__plan); applyPlanToScene(describePlan(__plan)); hideFloorPlanNotice(); return 0; })()', 60000);
    }
    return dm.evaluate('currentScene.id');
  };
  // A still of the DM's map (made by record.js) imported under an English name, with its floor plan as rooms.
  const importStill = async (name, file, planRel) => {
    const jpg = fs.readFileSync(path.join(process.env.REC_STILLS, file + '.jpg'));
    const expr = await rig.fixtures.asFileExpr(dm, { base64: jpg.toString('base64'), name: name + '.jpg', type: 'image/jpeg' });
    await dm.evaluate('createNewScene(' + expr + ')', 300000);
    await dm.waitFor('currentScene && currentScene.name === ' + JSON.stringify(name) + ' && fogCoverT === 0', 300000, 'the import of ' + name);
    const plan = planRel && path.join(MAPS, planRel).replace(/\.webm$/i, '.dd2vtt');
    if (plan && fs.existsSync(plan)) {
      await dm.writeBig('__plan', fs.readFileSync(plan, 'utf8'));
      await dm.evaluate('(async () => { hideFloorPlanNotice(); await attachPlanText(__plan); applyPlanToScene(describePlan(__plan)); hideFloorPlanNotice(); return 0; })()', 60000);
    }
    return dm.evaluate('currentScene.id');
  };
  const go = (sel, ms) => dm.evaluate('__goEl(' + JSON.stringify(sel) + ', ' + ms + ')');
  const goMap = (x, y, ms) => dm.evaluate('__goMap(' + x + ', ' + y + ', ' + ms + ')');
  const press = sel => dm.evaluate('__clickEl(' + JSON.stringify(sel) + ')');
  const cropJson = (dir, json) => { fs.mkdirSync(path.join(OUT, dir), { recursive: true }); fs.writeFileSync(path.join(OUT, dir, 'crop.json'), json); };
  const RAIL_CROP = 'JSON.stringify({ x: 0, w: Math.round(document.getElementById("dock-rail").getBoundingClientRect().left) & ~1, h: innerHeight })';
  const bbox = () => dm.evaluate('JSON.stringify((() => { const xs = polygons.flatMap(p => p.vertices.map(v => v.x)), ys = polygons.flatMap(p => p.vertices.map(v => v.y)); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; })())').then(JSON.parse);


  if (clip === 'hero') {
    // The Watcherhouse: three rooms picked and revealed from the popup above each, the TV clearing as they go.
    await importAnim('Watcherhouse', 'Вахтерхаус/Evermist WebM 150 + VTT/Вахтерхаус_01.webm', true);
    await lib.installHelpers(dm);
    await dm.evaluate(POINTER);
    // The DM window is inset in the picture, and its own minimap would be a minimap inside a minimap.
    await dm.evaluate("document.head.appendChild(Object.assign(document.createElement('style'), { textContent: '#minimap-panel { visibility: hidden !important; }' })); 0");
    await dm.evaluate('dockOpen(null); nwHide(); polygons.forEach(p => { p.mode = "shroud"; }); rebuildFogFromPolygons(); fogDirty = true; fitToScreen(); scheduleRender(); 0');
    const tv = await rig.player();
    await dm.evaluate('sendToPlayer(); 0');
    await lib.settle(tv, 'typeof fogCoverT === "undefined" || fogCoverT === 0', 30000);
    const [x0, y0, x1, y1] = await bbox();
    const pick = JSON.parse(await dm.evaluate(`JSON.stringify(polygons.map(p => {
      const xs = p.vertices.map(v => v.x), ys = p.vertices.map(v => v.y);
      return { id: p.id, a: (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)), x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    }).sort((a, b) => b.a - a.a).slice(0, 3))`));
    // The TV closes on the three rooms, up and to the left of the laptop inset in its corner.
    const rx0 = Math.min(...pick.map(r => r.x0)), rx1 = Math.max(...pick.map(r => r.x1)), ry0 = Math.min(...pick.map(r => r.y0)), ry1 = Math.max(...pick.map(r => r.y1));
    const rw = rx1 - rx0, rh = ry1 - ry0, cx = (rx0 + rx1) / 2, cy = (ry0 + ry1) / 2;
    await dm.evaluate('__viewBox(' + [x0, y0, x1, y1, 0.92].join(',') + ');' +
      ' minimapSetView({ mapCX: ' + (cx + rw * 0.04) + ', mapCY: ' + (cy + rh * 0.1) + ', zoom: Math.min(1280 / ' + rw + ', 720 / ' + rh + ') * 0.78 }); _postSnapThrottled(); 0');
    await lib.hold(2000, 'the TV settles on the building');
    cropJson('hero', await dm.evaluate(RAIL_CROP));
    const rooms = JSON.parse(await dm.evaluate(`JSON.stringify(polygons.map(p => {
      const xs = p.vertices.map(v => v.x), ys = p.vertices.map(v => v.y);
      return { id: p.id, a: (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)), c: __roomCentre(p) };
    }).sort((a, b) => b.a - a.a).slice(0, 3).sort((a, b) => a.c.x - b.c.x))`));
    rig.note('rooms ' + rooms.length);
    const a = screencast(dm, path.join(OUT, 'hero', 'dm')), b = screencast(tv, path.join(OUT, 'hero', 'tv'));
    await dm.evaluate('(p => __curSet(p.x, p.y))(__mapPt(' + rooms[0].c.x + ' - 300, ' + rooms[0].c.y + ' + 200)); 0');
    await a.start(); await b.start();
    await lib.hold(400, 'opening beat');
    await goMap(rooms[0].c.x, rooms[0].c.y, 500);
    for (let i = 0; i < rooms.length; i++) {
      const r = rooms[i];
      await dm.evaluate('__curDip(); __rigClick(' + r.c.x + ', ' + r.c.y + '); 0');
      await lib.settle(dm, 'document.getElementById("room-fog").style.display === "flex"', 5000);
      await go('#room-fog .fx-dir[data-dir="reveal"]', 450);
      await press('#room-fog .fx-dir[data-dir="reveal"]');
      // The next room waits for this reveal's crossfade to end on both windows: a pick that lands inside it
      // lifts the whole fog on the TV for a moment. The pointer walks to it meanwhile.
      await lib.settle(dm, '!fogTransRafId', 15000);
      await Promise.all([lib.settle(tv, '!fogTransRafId && !fogDirty', 15000),
        i + 1 < rooms.length ? goMap(rooms[i + 1].c.x, rooms[i + 1].c.y, 500) : Promise.resolve()]);
      await lib.hold(500, 'the reveal has landed');
    }
    await lib.hold(700, 'closing beat');
    rig.note('dm frames ' + await a.stop() + ', tv frames ' + await b.stop());
  }

  if (clip === 'rooms') {
    // The windmill's loft: a room drawn inside the floor, its corners dragged onto the real wall corners, then rounded
    // to the radius of the real arcs. The floor spans (695, 688) to (2005, 1997) with 330 units of round at each corner.
    await importAnim('Windmill Loft', 'Костедробилка 3/Evermist WebM 150 + VTT Full Walls/Костедробилка 3.webm', false);
    await lib.installHelpers(dm);
    await dm.evaluate(POINTER);
    const FLOOR = { x0: 695, y0: 688, x1: 2005, y1: 1997 };
    await dm.evaluate('dockOpen(null); nwHide(); revealAllRooms(); __viewBox(560, 560, 2140, 2130, 0.92); 0');
    await lib.settle(dm, '!fogTransRafId && !fogDirty && !viewportDirty', 15000);
    await lib.hold(3500, 'the revealed fog finishes fading');
    cropJson('rooms', await dm.evaluate(RAIL_CROP));
    const A = { x: 880, y: 860 }, B = { x: 1830, y: 1830 };
    const a = screencast(dm, path.join(OUT, 'rooms', 'dm'));
    await dm.evaluate('(p => __curSet(p.x, p.y))(__mapPt(1350, 2250)); 0');
    await a.start();
    await lib.hold(500, 'opening beat');
    // The rectangle tool from the bar, then the drag.
    await go('#tb-grp-shape', 600);
    await dm.evaluate('__curDip(); setShapeOp("new"); setShape("rect"); document.getElementById("btn-reveal").click(); 0');
    await lib.hold(300, 'the tool is picked');
    await goMap(A.x, A.y, 500);
    await dm.evaluate('__mapDrag(' + A.x + ', ' + A.y + ', ' + B.x + ', ' + B.y + ', 900)');
    await dm.evaluate('setShape("select"); 0');
    const id = await dm.evaluate('polygons[polygons.length - 1].id');
    await lib.hold(450, 'the room is drawn');
    await goMap(1350, 1350, 450);
    await dm.evaluate('__curDip(); __rigClick(1350, 1350); enterShapeEditMode(' + id + '); 0');
    await lib.hold(400, 'the corners show');
    // Each corner dragged out onto the real wall corner.
    const corners = [[A, { x: FLOOR.x0, y: FLOOR.y0 }], [{ x: B.x, y: A.y }, { x: FLOOR.x1, y: FLOOR.y0 }],
                     [B, { x: FLOOR.x1, y: FLOOR.y1 }], [{ x: A.x, y: B.y }, { x: FLOOR.x0, y: FLOOR.y1 }]];
    for (const [from, to] of corners) {
      await goMap(from.x, from.y, 300);
      await dm.evaluate('__mapDrag(' + from.x + ', ' + from.y + ', ' + to.x + ', ' + to.y + ', 380)');
    }
    await dm.evaluate('leaveShapeEditMode(); 0');
    // The corner circle over the room, one dragged rounds all four to the radius of the real arcs.
    await dm.evaluate('__mapHover(' + (FLOOR.x0 + 220) + ', ' + (FLOOR.y0 + 220) + ', 350)');
    const c = JSON.parse(await dm.evaluate('JSON.stringify(cornerCircles(polygons.find(p => p.id === ' + id + '))[0] || null)'));
    rig.note('circle ' + (c ? 'found' : 'missing'));
    if (c) {
      await dm.evaluate('__mapHover(' + c.x + ', ' + c.y + ', 400)');
      await dm.evaluate('__mapDrag(' + c.x + ', ' + c.y + ', ' + (c.x + c.dir.x * 470) + ', ' + (c.y + c.dir.y * 470) + ', 800)');
    }
    await lib.hold(400, 'the corners settle');
    await goMap(FLOOR.x1 + 150, FLOOR.y1 + 100, 550);
    await lib.hold(1000, 'closing beat');
    rig.note('dm frames ' + await a.stop() + ' ' + await dm.evaluate('JSON.stringify((p => ({ polys: polygons.length, r: p.cornerRadii || p.cornerRadius, bbox: p.vertices.map(v => [Math.round(v.x), Math.round(v.y)]) }))(polygons.find(p => p.id === ' + id + ')))'));
  }
  if (clip === 'module') {
    // Death House, Curse of Strahd's free introductory adventure, fills a room of the manor from the book.
    await importStill("Baron's Manor", 'manor', 'Особняк Барона/Evermist WebM 150 + VTT/Особняк Барона_00.webm');
    await lib.installHelpers(dm);
    await dm.evaluate(POINTER);
    await dm.evaluate(`(() => { const n = { 1: 'Washroom', 2: "Servants' Quarters", 3: 'Parlour', 4: 'Landing', 5: 'Main Hall',
      6: 'Kitchen', 7: 'Larder', 9: 'Sitting Room' };
      for (const p of polygons) if (n[p.id]) p.name = n[p.id];
      revealAllFog(); fogDirty = true; resetRoomLabelCache(); cursorDirty = true; scheduleRender(); dockOpen(null); return 0; })()`);
    const res = JSON.parse(await dm.evaluate('(async () => { const r = await window.electronAPI.extractPdfTextPath(' + JSON.stringify(process.env.REC_MODULE) + ');' +
      ' if (!r || !r.ok) return JSON.stringify({ ok: false, e: r && r.error }); _mtImport(r.text, "Death House", r.blockText); closeModuleTextModal();' +
      ' return JSON.stringify({ ok: true, n: mtEntries.length }); })()', 120000));
    rig.note('module ' + JSON.stringify(res));
    // The import's own report on the monsters it found, put away before the camera rolls.
    for (let i = 0; i < 3; i++) await dm.evaluate('(b => { if (b && b.offsetParent !== null) b.click(); return 0; })(document.getElementById("cd-ok"))');
    const dining = JSON.parse(await dm.evaluate('JSON.stringify(__roomCentre(polygons.find(p => p.id === 8)))'));
    // A Notes window wide enough for the room's text to read, the whole building centred beside it.
    const nwRight = await dm.evaluate('__nwAt(16, 24, 540, 640)');
    const [x0, y0, x1, y1] = await bbox();
    await dm.evaluate('__viewBox(' + [x0, y0, x1, y1, 0.94, nwRight + 16].join(',') + '); 0');
    await lib.hold(1200, 'the view settles');
    cropJson('module', await dm.evaluate(RAIL_CROP));
    const a = screencast(dm, path.join(OUT, 'module', 'dm'));
    await dm.evaluate('(p => __curSet(p.x + 300, p.y + 200))(__mapPt(' + dining.x + ', ' + dining.y + ')); 0');
    await a.start();
    await lib.hold(300, 'opening beat');
    await goMap(dining.x, dining.y, 450);
    await dm.evaluate('__curDip(); __rigClick(' + dining.x + ', ' + dining.y + '); 0');
    await lib.hold(550, 'the room opens in the window');
    await go('#rp-name', 300);
    await dm.evaluate(`(async () => { const el = document.getElementById('rp-name'); __curDip();
      el.focus(); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true }));
      for (const ch of 'dining') { await new Promise(f => setTimeout(f, 90 + Math.random() * 40)); el.value += ch; el.dispatchEvent(new Event('input', { bubbles: true })); }
      return 0; })()`);
    await lib.hold(700, 'the list of matches');
    await go('#rp-mt-list .rp-mt-opt', 300);
    await dm.evaluate('__curDip(); document.querySelector("#rp-mt-list .rp-mt-opt").click(); 0');
    await lib.hold(2800, 'the name and the notes fill in');
    await goMap(dining.x + 200, dining.y + 120, 350);
    await lib.hold(400, 'closing beat');
    rig.note('dm frames ' + await a.stop() + ' name ' + await dm.evaluate('polygons.find(p => p.id === 8).name'));
  }

  if (clip === 'twomaps') {
    // A fight moves upstairs at the Blue Water Inn: the TV splits to show both floors, neither one moving.
    // Two maps that look nothing alike, so the two halves read as two places at a glance.
    // Both ANIMATED: the moving map is what the clip is for. The bell tower is cut down to its building.
    const FLOORS = [['Mill Floor', path.join(MAPS, 'Костедробилка 2/Evermist WebM 150 + VTT Full Walls/Костедробилка 2.webm'), 'video/webm'],
                    ['Bell Tower', path.join(MAPS, 'Праздник/Evermist WebM 150 + VTT Full Walls/Праздник.webm'), 'video/webm']];
    const id = {};
    for (let i = 0; i < FLOORS.length; i++) {
      const [n, file, type] = FLOORS[i];
      const expr = await rig.fixtures.asFileExpr(dm, { base64: fs.readFileSync(file).toString('base64'), name: n + '.webm', type });
      await dm.evaluate('createNewScene(' + expr + ')', 300000);
      await dm.waitFor('currentScene && currentScene.name === ' + JSON.stringify(n) + ' && fogCoverT === 0', 300000, 'the import of ' + n);
      id[n] = await dm.evaluate('currentScene.id');
      await dm.evaluate('(async () => { revealAllFog(); fogDirty = true; scheduleRender(); await doAutoSave(); return 0; })()', 60000);
      await dm.evaluate('worldSceneSet(' + JSON.stringify(id[n]) + ', { group: "", worldPos: { x: ' + (i * 140) + ', y: 0 } }); 0');
    }
    await dm.evaluate('switchScene(' + JSON.stringify(id['Mill Floor']) + '); 0', 120000);
    await dm.waitFor('currentScene && currentScene.name === "Mill Floor" && fogCoverT === 0', 120000, 'the mill');
    await lib.installHelpers(dm);
    await dm.evaluate(POINTER);
    await dm.evaluate('dockOpen(null); nwHide(); 0');
    const tv = await rig.player();
    await dm.evaluate('sendToPlayer(); 0');
    await lib.settle(tv, 'typeof fogCoverT === "undefined" || fogCoverT === 0', 30000);
    await lib.hold(2000, 'the TV settles');
    fs.mkdirSync(path.join(OUT, 'twomaps'), { recursive: true });
    fs.writeFileSync(path.join(OUT, 'twomaps', 'crop.json'), await dm.evaluate('JSON.stringify({ x: 0, w: Math.round(document.getElementById("dock-rail").getBoundingClientRect().left) & ~1, h: innerHeight })'));
    const port = Number(/:(\d+)\//.exec(dm.ws.url)[1]);

    const a = screencast(dm, path.join(OUT, 'twomaps', 'dm')), b = screencast(tv, path.join(OUT, 'twomaps', 'tv1'));
    await dm.evaluate('__curSet(innerWidth * 0.5, innerHeight * 0.55); 0');
    await a.start(); await b.start();
    await lib.hold(1400, 'opening beat');
    // The Scene pane, and its Two maps button.
    await dm.evaluate('(async () => { const p = __elPt("dock-tab-scene"); await __curTo(p.x, p.y, 900); __curDip(); dockOpen("scene"); return 0; })()');
    await lib.hold(500, 'the pane opens');
    await dm.evaluate('(async () => { const p = __elPt("btn-two-maps"); await __curTo(p.x, p.y, 800); __curDip(); document.getElementById("btn-two-maps").click(); return 0; })()');
    await dm.waitFor('panesActive && worldMapOpen && !_wmAnim', 120000, 'two columns and the world map');
    // The TV window becomes the two-half screen: its own connection from here on.
    const shell = await cdp.waitForTarget(port, t => t.url.includes('stage.html'), 30000, 'the two-half TV screen');
    await b.stop();
    const st = await cdp.connect(shell.webSocketDebuggerUrl, 'stage');
    await st.send('Page.enable');
    const c = screencast(st, path.join(OUT, 'twomaps', 'tv2'));
    await c.start();
    await lib.hold(700, 'the map to pick from');
    // Close on the inn, then the upper floor into the second column.
    const inn = JSON.parse(await dm.evaluate('JSON.stringify((() => { const r = document.getElementById("wm").getBoundingClientRect(), v = _wmView(), s = allScenes.find(x => x.name === "Bell Tower").worldPos; return { x: r.left + v.w / 2 + (s.x - _wmCam.cx) * _wmCam.z, y: r.top + v.h / 2 + (s.y - _wmCam.cy) * _wmCam.z }; })())'));
    await dm.evaluate('__curTo(' + inn.x + ', ' + inn.y + ', 900)');
    await dm.evaluate('__wmZoom(1.15, 2600)');
    await lib.hold(500, 'the floors show');
    await dm.evaluate(`(async () => { const c = [...document.querySelectorAll('.wm-card')].find(c => c.querySelector('.wm-nm').textContent === 'Bell Tower').firstChild;
      const r = c.getBoundingClientRect(); await __curTo(r.x + r.width / 2, r.y + r.height / 2, 800); __curDip();
      await new Promise(f => setTimeout(f, 120)); __curDip(); c.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })); return 0; })()`);
    await dm.waitFor('!worldMapOpen && panes.B.sceneId === ' + JSON.stringify(id['Bell Tower']), 60000, 'the bell tower in the second column');
    await dm.evaluate('dockOpen(null); 0');
    await dm.evaluate('(async () => { await __curTo(innerWidth * 0.62, innerHeight * 0.5, 900); return 0; })()');
    await lib.hold(2500, 'the cover lifts on both halves');
    await lib.hold(2200, 'both floors on the TV');
    rig.note('dm ' + await a.stop() + ', tv ' + (await c.stop()));
    // One TV list from the two windows' frames, in time order.
    const merged = ['tv1', 'tv2'].flatMap(d => {
      const t = fs.readFileSync(path.join(OUT, 'twomaps', d, 'list.txt'), 'utf8').split('\n');
      const out = [];
      for (let i = 0; i + 1 < t.length; i += 2) if (t[i].startsWith('file') && t[i + 1].startsWith('duration')) out.push(t[i], t[i + 1]);
      return out;
    });
    fs.mkdirSync(path.join(OUT, 'twomaps', 'tv'), { recursive: true });
    fs.writeFileSync(path.join(OUT, 'twomaps', 'tv', 'list.txt'), merged.join('\n'));
    fs.copyFileSync(path.join(OUT, 'twomaps', 'tv1', 'start.txt'), path.join(OUT, 'twomaps', 'tv', 'start.txt'));
    st.close();
  }


  if (clip === 'world') {
    // The campaign map: zoom out to the places, along the road, into the map the road passes.
    const PLACES = { 'Vallaki': ['Mill Fight'], 'Barovia Hills': ['Hill Road'], '': ['Standing Stones'] };
    const STILL = { 'Mill Fight': 'mill', 'Hill Road': 'road' };
    const AT = { 'Mill Fight': [0, 0], 'Hill Road': [800, 330], 'Standing Stones': [420, 200] };
    const id = {};
    for (const [place, names] of Object.entries(PLACES)) for (const n of names) {
      // Only the stones, the map the clip opens, are animated.
      if (STILL[n]) await importStill(n, STILL[n], null);
      else await importAnim(n, 'Холм Былого, Круг/Evermist WebM 150 + VTT Full Walls/Холм Былого, Круг.webm', false);
      id[n] = await dm.evaluate('currentScene.id');
      // Revealed, as a map the party has already explored: under full fog every print reads grey.
      await dm.evaluate('(async () => { revealAllFog(); fogDirty = true; scheduleRender(); await doAutoSave(); return 0; })()', 60000);
      await dm.evaluate('worldSceneSet(' + JSON.stringify(id[n]) + ', { group: ' + JSON.stringify(place) + ', worldPos: { x: ' + AT[n][0] + ', y: ' + AT[n][1] + ' } }); 0');
    }
    await dm.evaluate('switchScene(' + JSON.stringify(id['Hill Road']) + '); 0', 120000);
    await dm.waitFor('currentScene && currentScene.name === "Hill Road" && fogCoverT === 0', 120000, 'the hill road');
    await lib.installHelpers(dm);
    await dm.evaluate(POINTER);
    await dm.evaluate(`
      globalThis.__wmS = (x, y) => { const v = _wmView(), r = document.getElementById('wm').getBoundingClientRect(); return { x: r.left + v.w / 2 + (x - _wmCam.cx) * _wmCam.z, y: r.top + v.h / 2 + (y - _wmCam.cy) * _wmCam.z }; };
      globalThis.__wmE = (type, el, p, o) => (el || window).dispatchEvent(new MouseEvent(type, Object.assign({ clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, button: 0 }, o || {})));
      globalThis.__wmCentre = n => wmPolyCentre(wmOutline(worldPlaceByName(n)));
      0`);
    // Laid out once, off camera, with the road between the town and the hills.
    await dm.evaluate('dockOpen(null); nwHide(); worldMapShow(); 0');
    await lib.settle(dm, '!_wmAnim', 20000);
    await dm.evaluate(`(() => {
      const a = __wmCentre('Vallaki'), b = __wmCentre('Barovia Hills');
      _wmCam = { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, z: 0.35 }; _wmApplyCam();
      document.getElementById('wm-road').click();
      const mid = { x: (a.x + b.x) / 2 + 20, y: (a.y + b.y) / 2 - 60 };
      for (const w of [a, mid, b]) { const p = __wmS(w.x, w.y); __wmE('mousedown', document.getElementById('wm'), p); __wmE('mouseup', window, p); }
      __rigKey('Enter');
      const r = worldRoadRecords()[worldRoadRecords().length - 1];
      _wmRenameStart(_wmEls.get('r' + r.uid), 'road', r.uid);
      _wmEditing.textContent = 'Old Svalich Road';
      _wmEditing.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true }));
      worldMapSelect({ sceneId: null, place: '' }); setShape('select');
      const w = allScenes.find(x => x.name === 'Standing Stones');
      const on = wrPointAt(wrSamples(r), 0.3);
      worldUndoPush();
      worldSceneSet(w.id, { worldPos: worldRoadsSettleScene(w.id, { x: Math.round(on.x), y: Math.round(on.y) }) });
      worldRoadsCommit(); worldAssignAll(); worldMapRefresh();
      return 0; })()`);
    rig.note('road ' + await dm.evaluate('JSON.stringify(worldRoadRecords().map(r => r.name))') + ' stones on road ' + await dm.evaluate('!!worldRoadOfScene(allScenes.find(x => x.name === "Standing Stones").id)'));
    await dm.evaluate('worldMapHide(); 0');
    await lib.settle(dm, '!worldMapOpen', 15000);
    await lib.hold(1200, 'the scene is back');
    cropJson('world', await dm.evaluate(RAIL_CROP));

    const a = screencast(dm, path.join(OUT, 'world', 'dm'));
    await dm.evaluate('__curSet(innerWidth * 0.55, innerHeight * 0.6); 0');
    await a.start();
    await lib.hold(700, 'opening beat on the map');
    await go('#btn-world', 550);
    await dm.evaluate('__clickEl("#btn-world")');
    await lib.settle(dm, 'worldMapOpen && !_wmAnim', 20000);
    await lib.hold(1400, 'the places in the mist');
    // Straight to the stones on the road, a smooth zoom around the pointer until their card shows, then in.
    const stones = JSON.parse(await dm.evaluate('JSON.stringify((s => __wmS(s.worldPos.x, s.worldPos.y))(allScenes.find(x => x.name === "Standing Stones")))'));
    await dm.evaluate('__curTo(' + stones.x + ', ' + stones.y + ', 650)');
    await dm.evaluate('__wmZoom(1.05, 1300)');
    await lib.hold(500, 'the card shows');
    await dm.evaluate(`(async () => { const c = [...document.querySelectorAll('.wm-card')].find(c => c.querySelector('.wm-nm').textContent === 'Standing Stones').firstChild;
      const r = c.getBoundingClientRect(); await __curTo(r.x + r.width / 2, r.y + r.height / 2, 450); __curDip();
      c.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })); return 0; })()`);
    await lib.settle(dm, 'currentScene && currentScene.name === "Standing Stones" && !worldMapOpen', 30000);
    await lib.hold(1500, 'closing beat on the stones');
    rig.note('dm frames ' + await a.stop() + ', open ' + await dm.evaluate('currentScene.name'));
  }

  if (clip === 'notes') {
    // A room note links to its innkeeper with @, and the link opens his note, which links on to the town.
    await importAnim('Blue Water Inn', 'Постоялый Двор/Evermist WebM 150 + VTT/Постоялый Двор_01.webm', true);
    await lib.installHelpers(dm);
    await dm.evaluate(POINTER);
    await dm.evaluate(`(() => {
      // The four biggest rooms, named for an inn; the rest of the plan's rooms are left out.
      const area = s => { const xs = s.vertices.map(v => v.x), ys = s.vertices.map(v => v.y); return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)); };
      polygons = polygons.sort((p, q) => area(q) - area(p)).slice(0, 4);
      ['Common Room', 'Kitchen', 'Stable', 'Storeroom'].forEach((nm, i) => { if (polygons[i]) polygons[i].name = nm; });
      globalThis.__taproom = polygons[0].id;
      revealAllRooms(); fogDirty = true; resetRoomLabelCache(); cursorDirty = true; scheduleRender(); dockOpen(null);
      const town = notesEntryAdd('lore', 'Vallaki', 'lore');
      notesEntrySetNote(town.id, 'A walled town. The burgomaster holds a festival every week.');
      const b = cbNewBlock('Urwin Martikov'); b.listed = true; b.meta = 'Medium humanoid, neutral good';
      b.notes = 'Innkeeper of the Blue Water Inn in @[Vallaki](entry:' + town.id + '). His family also runs the Wizard of Wines winery.';
      cbSave(); return 0; })()`);
    const room = JSON.parse(await dm.evaluate('JSON.stringify(__roomCentre(polygons.find(p => p.id === __taproom)))'));
    const nwRight = await dm.evaluate('__nwAt(16, 24, 520, 520)');
    await dm.evaluate('ntGoKey("campaign"); 0');
    const [x0, y0, x1, y1] = await bbox();
    // The map closed up until it covers the whole background, the inn centred right of the Notes window.
    await dm.evaluate('(() => { const r = container.getBoundingClientRect(), z = 0.3, bx = ' + ((x0 + x1) / 2) + ', by = ' + ((y0 + y1) / 2) + ';' +
      ' const tx = (' + nwRight + ' + r.width) / 2, ty = r.height * 0.5;' +
      ' zoom = z; panX = Math.min(0, Math.max(r.width - mapWidth * z, tx - bx * z)); panY = Math.min(0, Math.max(r.height - mapHeight * z, ty - by * z));' +
      ' viewportDirty = gridDirty = fogDirty = cursorDirty = true; scheduleRender(); return 0; })()');
    await lib.settle(dm, '!fogTransRafId && !fogDirty && !viewportDirty', 15000);
    await lib.hold(3500, 'the revealed fog finishes fading');
    cropJson('notes', await dm.evaluate(RAIL_CROP));
    const a = screencast(dm, path.join(OUT, 'notes', 'dm'));
    await dm.evaluate('(p => __curSet(p.x + 300, p.y + 220))(__mapPt(' + room.x + ', ' + room.y + ')); 0');
    await a.start();
    await lib.hold(800, 'the campaign tree');
    await goMap(room.x, room.y, 600);
    await dm.evaluate('__curDip(); __rigClick(' + room.x + ', ' + room.y + '); 0');
    await lib.settle(dm, 'document.getElementById("nw-kind").textContent === "Room"', 5000);
    await lib.hold(500, 'the room opens in the window');
    await go('#rp-desc', 550);
    await dm.evaluate('(() => { __curDip(); const f = document.getElementById("rp-desc"); f.focus(); const s = getSelection(); s.selectAllChildren(f); s.collapseToEnd(); return 0; })()');
    await typeKeys(dm, '@Urw', 80);
    await lib.settle(dm, 'document.querySelector(".ne-pop")', 5000);
    await lib.hold(600, 'the picker lists the match');
    await pressEnter(dm);
    await lib.settle(dm, 'document.querySelectorAll("#rp-desc .mn").length === 1', 5000);
    await typeKeys(dm, ' runs the inn with his wife Danika.', 55);
    await lib.hold(600, 'the link reads as blue');
    await go('#rp-desc .mn', 600);
    await dm.evaluate('__curDip(); document.querySelector("#rp-desc .mn").click(); 0');
    await lib.settle(dm, 'document.getElementById("nw-kind").textContent !== "Room"', 6000);
    await lib.hold(2000, 'the innkeeper note, with the room that mentions him');
    rig.note('dm frames ' + await a.stop() + ' kind ' + await dm.evaluate('document.getElementById("nw-kind").textContent'));
  }

  if (clip === 'search') {
    // Ctrl+F finds "wolf" in five kinds of thing; a click on the Dire Wolf opens its stat block.
    await importAnim('Winery', 'Винодельня/Evermist WebM 150 + VTT/Винодельня_00.webm', false);
    await lib.installHelpers(dm);
    await dm.evaluate(POINTER);
    const W = await dm.evaluate('mapWidth'), H = await dm.evaluate('mapHeight');
    const sq = [[0.4, 0.4], [0.5, 0.4], [0.5, 0.5], [0.4, 0.5]].map(([x, y]) => ({ x: Math.round(W * x), y: Math.round(H * y) }));
    await dm.evaluate(`(() => {
      polygons = [{ id: 1, vertices: ${JSON.stringify(sq)}, mode: 'shroud', cornerRadius: 0, name: 'Wolf Den', desc: 'Wolf tracks circle the cart.' }];
      nextPolygonId = 2; currentScene.notes = 'A wolf pack follows the caravan at night.';
      revealAllRooms(); autoSync = false; setShape('select'); selectedPolygonId = null; rebuildFogFromPolygons(); refreshRoomPanel(); dockOpen(null); fitToScreen(); scheduleRender();
      const b = cbNewBlock('Dire Wolf'); b.listed = true; b.source = 'SRD'; b.meta = 'Large beast, unaligned'; b.ac = '14 (natural armor)'; b.hp = '37 (5d10 + 10)'; b.speed = '50 ft.';
      b.abil = ['17 (+3)', '15 (+2)', '15 (+2)', '3 (-4)', '12 (+1)', '7 (-2)']; b.senses = 'passive Perception 13'; b.cr = '1';
      b.secs = { Traits: [{ n: 'Keen Hearing and Smell.', t: 'The wolf has advantage on Wisdom (Perception) checks that rely on hearing or smell.' }],
                 Actions: [{ n: 'Bite.', t: 'Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 10 (2d6 + 3) piercing damage.' }] };
      cbSave();
      combatAddFight(cbState, combatFightId); cbState.fights.find(f => f.id === cbState.openId).name = 'Wolf pack ambush';
      combatOpenFight(cbState, cbState.fights[0].id);
      _muTracks.push({ name: 'Wolf Howls at Night.m4a' });
      return 0; })()`);
    await lib.settle(dm, '!fogTransRafId && !fogDirty && !viewportDirty', 15000);
    await lib.hold(3500, 'the revealed fog finishes fading');
    cropJson('search', await dm.evaluate(RAIL_CROP));
    const a = screencast(dm, path.join(OUT, 'search', 'dm'));
    await dm.evaluate('__curSet(innerWidth * 0.82, innerHeight * 0.18); 0');
    await a.start();
    await lib.hold(1400, 'opening beat');
    await dm.evaluate('__rigKey("KeyF", { ctrlKey: true }); 0');
    await lib.settle(dm, 'document.body.classList.contains("searching") && _srProgress === null', 20000);
    await lib.hold(900, 'the box opens');
    await typeKeys(dm, 'wolf', 170);
    await lib.hold(3000, 'the kinds listed');
    rig.note('rows ' + await dm.evaluate('JSON.stringify([...document.querySelectorAll("#sr-list .sr-row")].map(r => r.querySelector(".sr-nm").textContent + " / " + r.querySelector(".sr-act").textContent))') +
             ' heads ' + await dm.evaluate('JSON.stringify([...document.querySelectorAll("#sr-list .sr-gh")].map(h => h.firstChild.textContent))'));
    await dm.evaluate('([...document.querySelectorAll("#sr-list .sr-row")].find(r => r.querySelector(".sr-nm").textContent === "Dire Wolf") || {}).id = "__pick"; 0');
    await go('#__pick', 650);
    await dm.evaluate('__curDip(); document.getElementById("__pick").click(); 0');
    await lib.settle(dm, 'bsIsOpen()', 10000);
    await lib.hold(2000, 'the stat block opens in the Bestiary');
    rig.note('dm frames ' + await a.stop() + ' bestiary ' + await dm.evaluate('bsIsOpen()'));
  }
};
