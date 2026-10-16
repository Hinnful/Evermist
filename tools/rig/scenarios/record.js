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
  // A hand moves in a slight arc: the control point sits off the straight line by a tenth of it.
  const mx = (x0 + x) / 2 - (y - y0) * 0.1, my = (y0 + y) / 2 + (x - x0) * 0.1;
  const step = t => {
    const k = Math.min(1, (t - t0) / ms), e = (1 - Math.cos(Math.PI * k)) / 2, u = 1 - e;
    __curSet(u * u * x0 + 2 * u * e * mx + e * e * x, u * u * y0 + 2 * u * e * my + e * e * y);
    if (k < 1) requestAnimationFrame(step); else res();
  };
  requestAnimationFrame(step);
});
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
globalThis.__viewBox = (x0, y0, x1, y1, fill) => {
  const r = container.getBoundingClientRect(), L = document.getElementById('notes-panel').getBoundingClientRect().right - r.left,
        R = document.getElementById('dock-rail').getBoundingClientRect().left - r.left;
  zoom = Math.min((R - L) / (x1 - x0), (r.height - 150) / (y1 - y0)) * (fill || 0.9);
  panX = (L + R) / 2 - (x0 + x1) / 2 * zoom; panY = (r.height - 90) / 2 - (y0 + y1) / 2 * zoom;
  viewportDirty = gridDirty = fogDirty = cursorDirty = true; scheduleRender();
};
globalThis.__roomCentre = p => { const xs = p.vertices.map(v => v.x), ys = p.vertices.map(v => v.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }; };
`;

function mapFile(rel) {
  const full = path.join(MAPS, rel);
  return { full, base64: fs.readFileSync(full).toString('base64'), type: 'video/webm' };
}

module.exports = async function record(rig) {
  const dm = rig.dm;
  const clip = process.env.REC_CLIP || 'hero';

  // A map of the DM's, imported under an English name, with its floor plan drawn as rooms.
  const importMap = async (rel, name, withPlan = true) => {
    const m = mapFile(rel);
    const expr = await rig.fixtures.asFileExpr(dm, { base64: m.base64, name: name + '.webm', type: m.type });
    await dm.evaluate('createNewScene(' + expr + ')', 300000);
    await dm.waitFor('currentScene && currentScene.name === ' + JSON.stringify(name) + ' && fogCoverT === 0', 300000, 'the import of ' + name);
    const plan = m.full.replace(/\.webm$/i, '.dd2vtt');
    if (withPlan && fs.existsSync(plan)) {
      await dm.writeBig('__plan', fs.readFileSync(plan, 'utf8'));
      await dm.evaluate('(async () => { hideFloorPlanNotice(); await attachPlanText(__plan); applyPlanToScene(describePlan(__plan)); hideFloorPlanNotice(); return 0; })()', 60000);
    }
    return dm.evaluate('currentScene.id');
  };

  if (clip === 'hero') {
    await importMap('Особняк Барона/Evermist WebM 150 + VTT/Особняк Барона_00.webm', "Baron's Manor");
    await lib.installHelpers(dm);
    await dm.evaluate(POINTER);
    await dm.evaluate('dockOpen(null); polygons.forEach(p => { p.mode = "shroud"; }); rebuildFogFromPolygons(); fogDirty = true; fitToScreen(); scheduleRender(); 0');
    const tv = await rig.player();
    await dm.evaluate('sendToPlayer(); 0');
    await lib.settle(tv, 'typeof fogCoverT === "undefined" || fogCoverT === 0', 30000);
    await dm.evaluate(`(() => { const n = { 1: 'Washroom', 2: "Servants' Quarters", 3: 'Parlour', 4: 'Landing', 5: 'Main Hall',
      6: 'Kitchen', 7: 'Larder', 8: 'Dining Room', 9: 'Sitting Room' };
      for (const p of polygons) if (n[p.id]) p.name = n[p.id];
      resetRoomLabelCache(); refreshRoomPanel(); cursorDirty = true; scheduleRender(); doAutoSave(); return 0; })()`);
    // Both screens close on the building, so each half of the GIF shows rooms and not lawn.
    const box = JSON.parse(await dm.evaluate(`JSON.stringify((() => {
      const xs = polygons.flatMap(p => p.vertices.map(v => v.x)), ys = polygons.flatMap(p => p.vertices.map(v => v.y));
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    })())`));
    const bw = box.x1 - box.x0, bh = box.y1 - box.y0, cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    await dm.evaluate(`(() => { const r = container.getBoundingClientRect();
      const L = document.getElementById('notes-panel').getBoundingClientRect().right, R = document.getElementById('dock-rail').getBoundingClientRect().left;
      zoom = Math.min((R - L) / ${bw}, (r.height - 150) / ${bh}) * 0.92;
      panX = (L + R) / 2 - r.left - ${cx} * zoom; panY = (r.height - 90) / 2 - ${cy} * zoom;
      viewportDirty = gridDirty = fogDirty = cursorDirty = true; scheduleRender();
      // The TV leaves its bottom-right corner to the laptop inset: the building sits up and to the left.
      minimapSetView({ mapCX: ${cx} + ${bw} * 0.17, mapCY: ${cy} + ${bh} * 0.12, zoom: Math.min(1280 / ${bw}, 720 / ${bh}) * 0.74 }); _postSnapThrottled(); return 0; })()`);
    await lib.hold(2500, 'the TV settles on the building');
    fs.mkdirSync(path.join(OUT, 'hero'), { recursive: true });
    fs.writeFileSync(path.join(OUT, 'hero', 'crop.json'), await dm.evaluate('JSON.stringify((() => { const L = Math.round(document.getElementById("notes-panel").getBoundingClientRect().right), R = Math.round(document.getElementById("dock-rail").getBoundingClientRect().left); return { x: L, w: (R - L) & ~1, h: innerHeight }; })())'));
    // Three rooms, biggest first, then put in reading order so the pointer travels left to right.
    const rooms = JSON.parse(await dm.evaluate(`JSON.stringify(polygons.map(p => {
      const xs = p.vertices.map(v => v.x), ys = p.vertices.map(v => v.y);
      return { id: p.id, a: (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)), c: __roomCentre(p) };
    }).sort((a, b) => b.a - a.a).slice(0, 3).sort((a, b) => a.c.x - b.c.x))`));
    rig.note('rooms ' + JSON.stringify(rooms));

    const a = screencast(dm, path.join(OUT, 'hero', 'dm')), b = screencast(tv, path.join(OUT, 'hero', 'tv'));
    await dm.evaluate('(p => __curSet(p.x, p.y))(__mapPt(' + rooms[0].c.x + ' - 300, ' + rooms[0].c.y + ' + 200)); 0');
    await a.start(); await b.start();
    await lib.hold(900, 'opening beat');
    for (const r of rooms) {
      await dm.evaluate('(async () => { const p = __mapPt(' + r.c.x + ', ' + r.c.y + '); await __curTo(p.x, p.y, 900); __curDip(); __rigClick(' + r.c.x + ', ' + r.c.y + '); return 0; })()');
      await lib.hold(350, 'the selection shows');
      await dm.evaluate('(async () => { const p = __elPt("btn-reveal"); await __curTo(p.x, p.y, 800); __curDip(); document.getElementById("btn-reveal").click(); return 0; })()');
      await lib.hold(1500, 'the reveal fades in on the TV');
    }
    await dm.evaluate('(async () => { const p = __mapPt(' + rooms[rooms.length - 1].c.x + ' + 250, ' + rooms[rooms.length - 1].c.y + ' + 150); await __curTo(p.x, p.y, 700); return 0; })()');
    await lib.hold(1200, 'closing beat');
    rig.note('dm frames ' + await a.stop() + ', tv frames ' + await b.stop());
  }

  if (clip === 'rooms') {
    // The windmill's floor is round at the ends: one rectangle, its corners rounded, then named.
    await importMap('Костедробилка 2/Evermist WebM 150 + VTT Full Walls/Костедробилка 2.webm', 'Old Bonegrinder', false);
    await lib.installHelpers(dm);
    await dm.evaluate(POINTER);
    await dm.evaluate('dockOpen(null); _npSetOpen(true); __viewBox(560, 560, 2140, 2130, 0.92); 0');
    await lib.hold(1500, 'the view settles');
    fs.mkdirSync(path.join(OUT, 'rooms'), { recursive: true });
    fs.writeFileSync(path.join(OUT, 'rooms', 'crop.json'), await dm.evaluate('JSON.stringify({ x: 0, w: Math.round(document.getElementById("dock-rail").getBoundingClientRect().left) & ~1, h: innerHeight })'));
    const A = { x: 712, y: 706 }, B = { x: 1988, y: 1980 };
    const a = screencast(dm, path.join(OUT, 'rooms', 'dm'));
    await dm.evaluate('(p => __curSet(p.x, p.y))(__mapPt(1350, 2250)); 0');
    await a.start();
    await lib.hold(700, 'opening beat');
    // The rectangle tool from the bar, then the drag.
    await dm.evaluate('(async () => { const p = __elPt("tb-grp-shape"); await __curTo(p.x - 8, p.y, 800); __curDip(); setShapeOp("new"); setShape("rect"); document.getElementById("btn-reveal").click(); return 0; })()');
    await lib.hold(300, 'the tool is picked');
    await dm.evaluate('(async () => { const p = __mapPt(' + A.x + ', ' + A.y + '); await __curTo(p.x, p.y, 900); return 0; })()');
    await dm.evaluate('__mapDrag(' + A.x + ', ' + A.y + ', ' + B.x + ', ' + B.y + ', 1300)');
        await dm.evaluate('setShape("select"); 0');
    const id = await dm.evaluate('polygons[polygons.length - 1].id');
    await lib.hold(500, 'the room is drawn');
    await dm.evaluate('(async () => { await __mapHover(1500, 1300, 700); __curDip(); __rigClick(1500, 1300); return 0; })()');
    await lib.hold(300, 'the room is picked');
    // The name, typed in the left panel.
    await dm.evaluate('(async () => { const p = __elPt("rp-name"); await __curTo(p.x - 40, p.y, 900); __curDip(); await __typeInto(document.getElementById("rp-name"), "Mill Floor", 85);' +
      ' document.getElementById("rp-name").dispatchEvent(new FocusEvent("blur")); return 0; })()');
    // Over the room, the corner circles show; one dragged rounds all four.
    await dm.evaluate('__mapHover(' + (A.x + 120) + ', ' + (A.y + 120) + ', 600)');
    const c = JSON.parse(await dm.evaluate('JSON.stringify(cornerCircles(polygons.find(p => p.id === ' + id + '))[0])'));
    rig.note('circle ' + JSON.stringify(c));
    await dm.evaluate('__mapHover(' + c.x + ', ' + c.y + ', 450)');
    await lib.hold(250, 'the circle is under the pointer');
    await dm.evaluate('__mapDrag(' + c.x + ', ' + c.y + ', ' + (c.x + c.dir.x * 470) + ', ' + (c.y + c.dir.y * 470) + ', 1100)');
    rig.note('radii ' + await dm.evaluate('JSON.stringify(polygons.find(p => p.id === ' + id + ').cornerRadii || polygons.find(p => p.id === ' + id + ').cornerRadius)'));
    await lib.hold(500, 'the corners settle');
    await dm.evaluate('(async () => { const p = __mapPt(1350, 1350); await __curTo(p.x + 260, p.y + 240, 900); return 0; })()');
    await lib.hold(1400, 'closing beat');
    rig.note('dm frames ' + await a.stop() + ' name ' + await dm.evaluate('polygons.find(p => p.id === ' + id + ').name'));
  }

  if (clip === 'module') {
    // Death House, Curse of Strahd's free introductory adventure, fills a room of the manor from the book.
    await importMap('Особняк Барона/Evermist WebM 150 + VTT/Особняк Барона_00.webm', "Baron's Manor");
    await lib.installHelpers(dm);
    await dm.evaluate(POINTER);
    await dm.evaluate(`(() => { const n = { 1: 'Washroom', 2: "Servants' Quarters", 3: 'Parlour', 4: 'Landing', 5: 'Main Hall',
      6: 'Kitchen', 7: 'Larder', 9: 'Sitting Room' };
      for (const p of polygons) if (n[p.id]) p.name = n[p.id];
      revealAllFog(); fogDirty = true; resetRoomLabelCache(); cursorDirty = true; scheduleRender(); dockOpen(null); _npSetOpen(true); return 0; })()`);
    const res = JSON.parse(await dm.evaluate('(async () => { const r = await window.electronAPI.extractPdfTextPath(' + JSON.stringify(process.env.REC_MODULE) + ');' +
      ' if (!r || !r.ok) return JSON.stringify({ ok: false, e: r && r.error }); _mtImport(r.text, "Death House", r.blockText); closeModuleTextModal();' +
      ' return JSON.stringify({ ok: true, n: mtEntries.length, titles: mtEntries.map(e => e.title).slice(0, 40) }); })()', 120000));
    rig.note('module ' + JSON.stringify(res));
    // The import's own report on the monsters it found, put away before the camera rolls.
    for (let i = 0; i < 3; i++) await dm.evaluate('(b => { if (b && b.offsetParent !== null) b.click(); return 0; })(document.getElementById("cd-ok"))');
    const dining = JSON.parse(await dm.evaluate('JSON.stringify(__roomCentre(polygons.find(p => p.id === 8)))'));
    // A wider panel, as the DM drags it, so the room's text reads; then the whole building centred beside it.
    await dm.evaluate(`(() => { _npWantW = 360; _npLayout();
      const xs = polygons.flatMap(p => p.vertices.map(v => v.x)), ys = polygons.flatMap(p => p.vertices.map(v => v.y));
      __viewBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), 0.94); return 0; })()`);
    await lib.hold(1500, 'the view settles');
    fs.mkdirSync(path.join(OUT, 'module'), { recursive: true });
    fs.writeFileSync(path.join(OUT, 'module', 'crop.json'), await dm.evaluate('JSON.stringify({ x: 0, w: Math.round(document.getElementById("dock-rail").getBoundingClientRect().left) & ~1, h: innerHeight })'));
    const a = screencast(dm, path.join(OUT, 'module', 'dm'));
    await dm.evaluate('(p => __curSet(p.x + 300, p.y + 200))(__mapPt(' + dining.x + ', ' + dining.y + ')); 0');
    await a.start();
    await lib.hold(800, 'opening beat');
    await dm.evaluate('(async () => { await __mapHover(' + dining.x + ', ' + dining.y + ', 900); __curDip(); __rigClick(' + dining.x + ', ' + dining.y + '); return 0; })()');
    await lib.hold(600, 'the room opens in the panel');
    await dm.evaluate(`(async () => { const el = document.getElementById('rp-name'), p = __elPt('rp-name'); await __curTo(p.x - 30, p.y, 900); __curDip();
      el.focus(); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true }));
      for (const ch of 'dining') { await new Promise(f => setTimeout(f, 140 + Math.random() * 80)); el.value += ch; el.dispatchEvent(new Event('input', { bubbles: true })); }
      return 0; })()`);
    await lib.hold(900, 'the list of matches');
    const row = await dm.evaluate('(r => r ? JSON.stringify({ t: r.textContent, ...__elPt(r.id || (r.id = "__mtrow")) }) : "null")(document.querySelector("#rp-mt-list .rp-mt-opt"))');
    rig.note('row ' + row);
    await dm.evaluate('(async () => { const r = document.querySelector("#rp-mt-list .rp-mt-opt"), b = r.getBoundingClientRect(); await __curTo(b.x + 60, b.y + b.height / 2, 800); __curDip(); r.click(); return 0; })()');
    await lib.hold(2600, 'the name and the notes fill in');
    await dm.evaluate('(async () => { const p = __mapPt(' + dining.x + ', ' + dining.y + '); await __curTo(p.x + 200, p.y + 120, 900); return 0; })()');
    await lib.hold(1200, 'closing beat');
    rig.note('dm frames ' + await a.stop() + ' name ' + await dm.evaluate('polygons.find(p => p.id === 8).name'));
  }

  if (clip === 'twomaps') {
    // A fight moves upstairs at the Blue Water Inn: the TV splits to show both floors, neither one moving.
    // Two maps that look nothing alike, so the two halves read as two places at a glance.
    // Both ANIMATED: the moving map is what the clip is for. The bell tower is cut down to its building.
    const FLOORS = [['Mill Floor', path.join(MAPS, 'Костедробилка 2/Evermist WebM 150 + VTT Full Walls/Костедробилка 2.webm'), 'video/webm'],
                    ['Bell Tower', process.env.REC_BELL, 'video/mp4']];
    const id = {};
    for (let i = 0; i < FLOORS.length; i++) {
      const [n, file, type] = FLOORS[i];
      const expr = await rig.fixtures.asFileExpr(dm, { base64: fs.readFileSync(file).toString('base64'), name: n + (type === 'video/mp4' ? '.mp4' : '.webm'), type });
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
    await dm.evaluate('dockOpen(null); _npSetOpen(false); 0');
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
    await lib.hold(1000, 'opening beat');
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
    await dm.evaluate(`new Promise(res => { const wm = document.getElementById('wm'); let n = 0;
      const step = () => { wm.dispatchEvent(new WheelEvent('wheel', { deltaY: -8, clientX: __cur.x, clientY: __cur.y, bubbles: true, cancelable: true }));
        if (++n < 140 && _wmCam.z < 1.15) requestAnimationFrame(step); else res(); };
      requestAnimationFrame(step); })`);
    await lib.hold(500, 'the floors show');
    await dm.evaluate(`(async () => { const c = [...document.querySelectorAll('.wm-card')].find(c => c.querySelector('.wm-nm').textContent === 'Bell Tower').firstChild;
      const r = c.getBoundingClientRect(); await __curTo(r.x + r.width / 2, r.y + r.height / 2, 800); __curDip();
      await new Promise(f => setTimeout(f, 120)); __curDip(); c.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })); return 0; })()`);
    await dm.waitFor('!worldMapOpen && panes.B.sceneId === ' + JSON.stringify(id['Bell Tower']), 60000, 'the bell tower in the second column');
    await dm.evaluate('dockOpen(null); 0');
    await dm.evaluate('(async () => { await __curTo(innerWidth * 0.62, innerHeight * 0.5, 900); return 0; })()');
    await st.evaluate('0');
    const clear = await lib.poll(async () => {
      const halves = JSON.parse(await st.evaluate('JSON.stringify([...document.querySelectorAll("iframe")].map(f => { try { return f.contentWindow.fogCoverT; } catch (e) { return null; } }))'));
      return halves.length === 2 && halves.every(v => v === 0) ? { ok: true } : null;
    }, 20000, 200);
    rig.note('both halves clear: ' + !!clear);
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
    // A small Curse of Strahd campaign from stills of the DM's maps: the world map shows each as a print.
    const STILLS = process.env.REC_STILLS;
    // Vallaki holds the Watcherhouse; Old Bonegrinder is its own place half a day out; the wolves wait on the road.
    const PLACES = { 'Vallaki': ['The Watcherhouse', "Baron's Manor", 'Blue Water Inn', 'Blinsky Toys'],
                     'Old Bonegrinder': ['Bakery', 'Mill Floor', 'Loft'],
                     '': ['Wolves on the Road'] };
    const AT = { 'The Watcherhouse': [0, 0], "Baron's Manor": [140, 0], 'Blue Water Inn': [0, 105], 'Blinsky Toys': [140, 105],
                 'Bakery': [760, 330], 'Mill Floor': [900, 330], 'Loft': [1040, 330], 'Wolves on the Road': [420, 200] };
    const id = {};
    // The two scenes the clip opens are the DM's animated maps; the rest only ever show as prints.
    const ANIM = { 'The Watcherhouse': 'watcherhouse.mp4', 'Wolves on the Road': 'road.mp4' };
    for (const [place, names] of Object.entries(PLACES)) for (const n of names) {
      const file = ANIM[n] ? { base64: fs.readFileSync(path.join(process.env.REC_ANIM, ANIM[n])).toString('base64'), name: n + '.mp4', type: 'video/mp4' }
                           : { base64: fs.readFileSync(path.join(STILLS, n + '.jpg')).toString('base64'), name: n + '.jpg', type: 'image/jpeg' };
      const expr = await rig.fixtures.asFileExpr(dm, file);
      await dm.evaluate('createNewScene(' + expr + ')', 300000);
      await dm.waitFor('currentScene && currentScene.name === ' + JSON.stringify(n) + ' && fogCoverT === 0', 300000, 'the import of ' + n);
      id[n] = await dm.evaluate('currentScene.id');
      // Revealed, as a scene the party has already explored: under full fog every print reads grey.
      await dm.evaluate('(async () => { revealAllFog(); fogDirty = true; scheduleRender(); await doAutoSave(); return 0; })()', 60000);
      await dm.evaluate('worldSceneSet(' + JSON.stringify(id[n]) + ', { group: ' + JSON.stringify(place) + ', worldPos: { x: ' + AT[n][0] + ', y: ' + AT[n][1] + ' } }); 0');
    }
    await dm.evaluate('switchScene(' + JSON.stringify(id['The Watcherhouse']) + '); 0', 120000);
    await dm.waitFor('currentScene && currentScene.name === "The Watcherhouse" && fogCoverT === 0', 120000, 'the Watcherhouse');
    await lib.installHelpers(dm);
    await dm.evaluate(POINTER);
    await dm.evaluate(`
      globalThis.__wmS = (x, y) => { const v = _wmView(), r = document.getElementById('wm').getBoundingClientRect(); return { x: r.left + v.w / 2 + (x - _wmCam.cx) * _wmCam.z, y: r.top + v.h / 2 + (y - _wmCam.cy) * _wmCam.z }; };
      globalThis.__wmE = (type, el, p, o) => (el || window).dispatchEvent(new MouseEvent(type, Object.assign({ clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, button: 0 }, o || {})));
      globalThis.__wmCentre = n => wmPolyCentre(wmOutline(worldPlaceByName(n)));
      0`);
    // Laid out once, off camera, with the road between the town and the mill.
    await dm.evaluate('dockOpen(null); _npSetOpen(false); worldMapShow(); 0');
    await lib.settle(dm, '!_wmAnim', 20000);
    await dm.evaluate(`(() => {
      const a = __wmCentre('Vallaki'), b = __wmCentre('Old Bonegrinder');
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
      const w = allScenes.find(x => x.name === 'Wolves on the Road');
      const on = wrPointAt(wrSamples(r), 0.3);
      worldUndoPush();
      worldSceneSet(w.id, { worldPos: worldRoadsSettleScene(w.id, { x: Math.round(on.x), y: Math.round(on.y) }) });
      worldRoadsCommit(); worldAssignAll(); worldMapRefresh();
      return 0; })()`);
    rig.note('wolves ' + await dm.evaluate('JSON.stringify((s => ({ pos: s.worldPos, g: s.group, road: !!worldRoadOfScene(s.id) }))(allScenes.find(x => x.name === "Wolves on the Road")))'));
    rig.note('road ' + await dm.evaluate('JSON.stringify(worldRoadRecords().map(r => [r.name, r.ends]))'));
    await dm.evaluate('worldMapHide(); 0');
    await lib.settle(dm, '!worldMapOpen', 15000);
    await lib.hold(1500, 'the scene is back');
    fs.mkdirSync(path.join(OUT, 'world'), { recursive: true });
    fs.writeFileSync(path.join(OUT, 'world', 'crop.json'), await dm.evaluate('JSON.stringify({ x: 0, w: Math.round(document.getElementById("dock-rail").getBoundingClientRect().left) & ~1, h: innerHeight })'));

    const a = screencast(dm, path.join(OUT, 'world', 'dm'));
    await dm.evaluate('__curSet(innerWidth * 0.55, innerHeight * 0.6); 0');
    await a.start();
    await lib.hold(900, 'opening beat on the scene');
    // The World map button, and the zoom out to the places.
    await dm.evaluate('(async () => { const p = __elPt("btn-world"); await __curTo(p.x, p.y, 1000); __curDip(); document.getElementById("btn-world").click(); return 0; })()');
    await lib.settle(dm, 'worldMapOpen && !_wmAnim', 20000);
    await lib.hold(1400, 'the places in the mist');
    // To the mill, and a smooth wheel zoom around the pointer until its scenes show.
    const mill = JSON.parse(await dm.evaluate('JSON.stringify((s => __wmS(s.worldPos.x, s.worldPos.y))(allScenes.find(x => x.name === "Wolves on the Road")))'));
    await dm.evaluate('__curTo(' + mill.x + ', ' + mill.y + ', 1000)');
    await dm.evaluate(`new Promise(res => { const wm = document.getElementById('wm'); let n = 0;
      const step = () => { wm.dispatchEvent(new WheelEvent('wheel', { deltaY: -8, clientX: __cur.x, clientY: __cur.y, bubbles: true, cancelable: true }));
        if (++n < 140 && _wmCam.z < 1.05) requestAnimationFrame(step); else res(); };
      requestAnimationFrame(step); })`);
    await lib.hold(1000, 'the scenes of the mill show');
    // A double-click on Mill Floor opens it.
    await dm.evaluate(`(async () => { const c = [...document.querySelectorAll('.wm-card')].find(c => c.querySelector('.wm-nm').textContent === 'Wolves on the Road').firstChild;
      const r = c.getBoundingClientRect(); await __curTo(r.x + r.width / 2, r.y + r.height / 2, 900); __curDip();
      await new Promise(f => setTimeout(f, 120)); __curDip(); c.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })); return 0; })()`);
    await lib.settle(dm, 'currentScene && currentScene.name === "Wolves on the Road" && !worldMapOpen', 30000);
    await lib.hold(1600, 'closing beat on the mill');
    rig.note('dm frames ' + await a.stop() + ', z ' + await dm.evaluate('_wmCam.z') + ', open ' + await dm.evaluate('currentScene.name'));
  }
};
