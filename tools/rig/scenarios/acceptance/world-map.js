'use strict';

// world-map.js — THE WORLD MAP: A MAP OF THE CAMPAIGN BESIDE THE SCENE LIBRARY.
//
// THE GOAL OF THIS FEATURE: the DM sees a campaign as places on a map, moves scenes between them,
// keeps notes per place, and adds a scene without leaving what is on the TV. A place IS a scene
// group, so the library and the map are two views of one fact.
//
// THE CRITERIA ARE THIS HEADER, one per line of the spec's Definition of Done.
//
//   1. A World map button sits on the rail under the Scene library. It and M open the map with a
//      zoom-out from the open scene.
//   2. The Mist look. Zoomed out no scene is shown, only the places; the places show their names, and a scene with no place is a black diamond with its name beside it. Zoomed in the scenes
//      wear their names inside the print at the top left and the places have none. A place's outline is white
//      and 2px. The mist is cut by every place. The TV has none of it.
//   3. The middle button pans, the wheel zooms around the pointer, a left drag on empty space does
//      nothing.
//   4. A DOUBLE click opens a scene with a zoom-in, a single click only picks it. Esc and the button
//      return; with no scene open Esc does nothing. With two maps on it fills the selected column.
//      A scene opened from the map starts with no room picked, and a column it fills keeps its own notes.
//   5. Dragging a scene: within its place moves it; onto a loose scene makes a place, a rectangle that
//      fits both, picked as "New place" (its name is hidden zoomed in, so no rename opens); out of the
//      polygon takes it out. Dragging a place's name moves the polygon and its scenes.
//   6. A double-click on a name renames it, and the library shows the new name.
//   7. The toolbar holds Select, Add a scene and Find. Add puts the scene in the next clear spot beside
//      the picked one, picks it and shows it, and leaves the open scene alone; the new scene opens fully fogged.
//   8. The notes panel gains a Place level, with notes per place that follow a rename.
//   9. Positions and place notes survive a restart, a backup and a restore, and a move made with two
//      maps on survives leaving them.
//  10. The TV never changes while the world map is open.
//  11. The toolbar's rectangle, circle and polygon tools each draw a place, and a scene inside it
//      belongs to it.
//  12. A scene belongs to a place only while ALL of its card is inside the OUTLINE: one pixel out
//      takes it out, a rounded corner and a curved wall included. A scene filed under a place in the
//      library is brought inside its place.
//  13. A place edits exactly like a room, because the room's own code edits it: corners, a corner
//      circle that rounds, a wall bent into a curve, a corner added or deleted, the box that scales,
//      Escape one level at a time, and Ctrl+Z. It is kept across a restart.
//  14. Zoomed out, a place keeps its polygon, in white.
//  15. The right-click menu offers the scene's, the place's or the ground's actions; Delete is off
//      for the open scene.
//  16. Pre-4.0 fixes: the dock goes dark but for what never reaches the TV; no invisible rename; every
//      scene move is one undo step; Esc, Delete, Enter and ? on the map; Effects shapes absent; only the
//      tool in hand is blue; a place delete asks nothing and its notes go and come back with it; a taken
//      place name is refused; the Split refusal reads as a place in Russian.
//
// ⚠ THE BACKUP IN 9 IS MIRRORED, NOT EXERCISED: the save dialog is native (see the rig skill). The
// file lists are read as text and the place notes go through the same payload and parser the zip uses.
// The DM still hand-tests a real backup.
// ⚠ 9 RESTARTS THE APP, so it runs last.
// ⚠ NEVER PASS AN ASYNC EXPRESSION TO waitFor; the store is read from Node with lib.poll.

const lib = require('../../lib');
const MAP_W = 900, MAP_H = 600;
// ⚠ THE PRINTS FADE AND GLIDE for 0.3s after every camera move, and a slow runner reads or drops on them mid-flight.
// Finite animations only: the mist drifts forever.
const SETTLED = 'document.getAnimations().every(a => a.effect.getComputedTiming().iterations === Infinity)';
const WM_CARD_W_ = 110, WM_CARD_H_ = 77;

const PAGE = `
globalThis.__wmC = el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
globalThis.__wmE = (type, el, p, o) => (el || window).dispatchEvent(new MouseEvent(type,
  Object.assign({ clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, button: 0 }, o || {})));
globalThis.__wmCard = name => [...document.querySelectorAll('.wm-card')].find(c => c.querySelector('.wm-nm').textContent === name);
globalThis.__wmHead = name => [...document.querySelectorAll('.wm-hl')].find(e => e.textContent === name);
globalThis.__wmDrag = (el, to, o) => {
  const a = __wmC(el);
  __wmE('mousedown', el, a, o);
  __wmE('mousemove', window, { x: (a.x + to.x) / 2, y: (a.y + to.y) / 2 }, o);
  __wmE('mousemove', window, to, o);
  __wmE('mouseup', window, to, o);
};
globalThis.__wmClick = (el, o) => { const p = __wmC(el); __wmE('mousedown', el, p, o); __wmE('mouseup', window, p, o); };
globalThis.__wmDbl = el => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
globalThis.__wmCam = (cx, cy, z) => { _wmCam = { cx, cy, z }; _wmApplyCam(); };
globalThis.__wmS = (x, y) => { const v = _wmView(); return { x: v.w / 2 + (x - _wmCam.cx) * _wmCam.z, y: v.h / 2 + (y - _wmCam.cy) * _wmCam.z }; };
globalThis.__wmGround = (type, p, o) => __wmE(type, document.getElementById('wm'), p, o);
globalThis.__wmPress = (p, to, o) => {
  __wmGround('mousedown', p, o);
  __wmE('mousemove', window, { x: (p.x + to.x) / 2, y: (p.y + to.y) / 2 }, o);
  __wmE('mousemove', window, to, o);
  __wmE('mouseup', window, to, o);
};
globalThis.__wmPlace = name => worldPlaceByName(name);
globalThis.__wmEnter = text => {
  const el = _wmEditing;
  el.textContent = text;
  el.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true }));
};
`;

module.exports = async function worldMapFeature(rig) {
  let dm = rig.dm;

  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H });
  const expr = await rig.fixtures.asFileExpr(dm, map);
  const named = n => '(f => new File([f], ' + JSON.stringify(n) + ', { type: f.type }))(' + expr + ')';
  const importAs = async name => {
    await dm.evaluate('createNewScene(' + named(name + '.mp4') + ')', 120000);
    await dm.waitFor('currentScene && currentScene.name === ' + JSON.stringify(name), 120000, 'the import of ' + name);
    return dm.evaluate('currentScene.id');
  };
  const stored = id => dm.evaluate('(async () => { const r = await sceneStore.loadScene(' + JSON.stringify(id) +
    '); return r ? { name: r.name, group: r.group, pos: r.worldPos, fog: !!r.baseFogBlob, plan: r.planOfferPending } : null; })()', 30000);
  const poll = async (read, ok, ms) => {
    let last;
    const got = await lib.poll(async () => { last = await read(); return ok(last) ? { v: last } : null; }, ms || 12000, 150);
    return got ? got.v : last;
  };
  const id = {};
  for (const n of ['Cellar', 'Ground Floor', 'Attic', 'Frostmere Pass']) id[n] = await importAs(n);
  await dm.evaluate('(' + JSON.stringify([id.Cellar, id['Ground Floor'], id.Attic]) + ').forEach(i => worldSceneSet(i, { group: "Watcherhouse" })); 0');
  await dm.evaluate('switchScene(' + JSON.stringify(id['Ground Floor']) + '); 0', 120000);
  await dm.waitFor('currentScene && currentScene.id === ' + JSON.stringify(id['Ground Floor']) + ' && fogCoverT === 0', 90000, 'the Ground Floor');
  await lib.installHelpers(dm);
  await dm.evaluate(PAGE);
  await dm.evaluate('dockOpen(null); 0');

  // The TV's inbox, counted from here: nothing below may add to it until the scene is opened.
  const tv = await rig.player();
  await tv.evaluate('globalThis.__got = []; addEventListener("message", e => __got.push((e.data && e.data.type) || typeof e.data)); 0');
  // ⚠ COUNTED FROM QUIET, not from the window opening: the TV's first map and fog arrive a moment after it is up, and one
  // landing after the listener read as the world map sending it.
  let heard = -1;
  await lib.poll(async () => { const n = await tv.evaluate('__got.length'); if (n === heard) return { quiet: true }; heard = n; return null; }, 20000, 1500);
  await tv.evaluate('__got = []; 0');
  const tvSeen = () => tv.evaluate('JSON.stringify(__got)');

  // ── 1. The button and M zoom out from the open scene ──────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(await dm.evaluate('document.querySelector("#dock-rail .rail-btn").id') === 'btn-world',
            'the World map button is not the first button on the rail');
  const opened = await dm.evaluate(`(() => {
    document.getElementById('btn-world').click();
    const at = allScenes.find(s => s.id === currentScene.id).worldPos;
    return { open: worldMapOpen, z: _wmCam.z, fill: wmFillZoom(_wmView()), cx: _wmCam.cx, cy: _wmCam.cy, at,
             stamped: allScenes.every(s => s.worldPos) };
  })()`);
  rig.check(opened.open === true, 'the World map button did not open the world map');
  rig.check(opened.stamped, 'opening the map left scenes with no position');
  rig.check(Math.abs(opened.z - opened.fill) < 1e-6 * opened.fill && Math.abs(opened.cx - opened.at.x) < 1e-6 && Math.abs(opened.cy - opened.at.y) < 1e-6,
            'the map did not start on the open scene\'s card to zoom out from it: ' + JSON.stringify(opened));
  await lib.settle(dm, '!_wmAnim && _wmCam.z < WM_SPLIT', 15000);
  const onStore = await poll(() => stored(id.Cellar), v => v && v.pos, 12000);
  rig.check(onStore && onStore.pos && typeof onStore.pos.x === 'number',
            'the first-open layout was not written to the store, so it is lost on restart: ' + JSON.stringify(onStore));
  await dm.evaluate('__rigKey("Escape"); 0');
  await lib.settle(dm, '!worldMapOpen', 15000);
  rig.check(await dm.evaluate('!worldMapOpen && !document.body.classList.contains("world")'),
            'Esc did not close the world map back onto the open scene');
  await dm.evaluate('__rigKey("KeyM"); 0');
  rig.check(await dm.evaluate('worldMapOpen'), 'M did not open the world map');
  await lib.settle(dm, '!_wmAnim && _wmCam.z < WM_SPLIT', 15000);

  // ── 2. Prints and plates by level ──────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await lib.settle(dm, SETTLED, 8000);
  const out = await dm.evaluate(`(() => ({
    level: document.getElementById('wm').className,
    places: [...document.querySelectorAll('.wm-hl')].filter(e => getComputedStyle(e).opacity === '1').map(e => e.textContent),
    loose: [...document.querySelectorAll('.wm-lm .wm-lbl')].map(e => e.textContent),
    dot: (d => d && { bg: getComputedStyle(d).backgroundColor, on: getComputedStyle(d.parentNode).opacity })(document.querySelector('.wm-lm .wm-dot')),
    prints: [...document.querySelectorAll('.wm-card.placed')].map(c => getComputedStyle(c).opacity),
    mist: document.querySelectorAll('.wmist-clear-places polygon').length === worldPlaceRecords().length && document.querySelectorAll('.wmist-clear-places polygon').length > 0,
  }))()`);
  rig.check(/\bplaces\b/.test(out.level), 'the overview is not at the places level: ' + out.level);
  rig.check(JSON.stringify(out.places) === JSON.stringify(['Watcherhouse']),
            'zoomed out, the place does not wear its name plate alone: ' + JSON.stringify(out.places));
  rig.check(JSON.stringify(out.loose) === JSON.stringify(['Frostmere Pass']), 'zoomed out, the loose scene does not keep its name: ' + JSON.stringify(out.loose));
  rig.check(out.dot && out.dot.bg === 'rgb(11, 11, 13)' && out.dot.on === '1', 'zoomed out, a scene with no place is not a black diamond: ' + JSON.stringify(out.dot));
  rig.check(out.prints.length === 3 && out.prints.every(o => o === '0'), 'zoomed out, the scenes of a place still show: ' + JSON.stringify(out.prints));
  rig.check(out.mist, 'the mist is not cut by every place');
  // A place's plate is a room's label: its type size by zoom and clamped, its weight, its padding.
  const pc = JSON.parse(await dm.evaluate('JSON.stringify(_wmPlaces().find(p => p.name === "Watcherhouse").centre)'));
  for (const zz of [0.3, 0.45, 0.6, 0.7]) {
    await dm.evaluate('__wmCam(' + pc.x + ', ' + pc.y + ', ' + zz + ')');
    const at = await dm.evaluate(`(() => { const h = __wmHead('Watcherhouse'), cs = getComputedStyle(h), z = _wmCam.z;
      return { z, px: parseFloat(cs.fontSize) * z, want: roomLabelFontPx(_wmZq(z)), weight: cs.fontWeight, padX: parseFloat(cs.paddingLeft) * z, padY: parseFloat(cs.paddingTop) * z }; })()`);
    rig.check(Math.abs(at.px - at.want) < 0.5 && at.weight === '600' && Math.abs(at.padX - 13) < 0.5 && Math.abs(at.padY - 8) < 0.5,
              'at zoom ' + at.z.toFixed(2) + ' the place plate does not match the room label in size, weight and padding: ' + JSON.stringify(at));
  }
  await dm.evaluate('__wmCam(' + pc.x + ', ' + pc.y + ', 0.9)');
  await lib.settle(dm, SETTLED, 8000);
  const inn = await dm.evaluate(`(() => {
    const z = _wmCam.z, c = __wmCard('Ground Floor'), th = c.querySelector('.wm-th').getBoundingClientRect(), nm = c.querySelector('.wm-nm').getBoundingClientRect();
    return { scenes: /\\bscenes\\b/.test(document.getElementById('wm').className), z, op: getComputedStyle(c).opacity,
      w: th.width, h: th.height, dx: nm.left - th.left, dy: nm.top - th.top, inside: nm.right <= th.right + 0.5 && nm.bottom <= th.bottom + 0.5,
      show: getComputedStyle(c.querySelector('.wm-nm')).display, plates: [...document.querySelectorAll('.wm-hl')].every(e => getComputedStyle(e).opacity === '0') };
  })()`);
  rig.check(inn.scenes && inn.op === '1' && Math.abs(inn.w - WM_CARD_W_ * inn.z) < 1 && Math.abs(inn.h - WM_CARD_H_ * inn.z) < 1, 'zoomed in, a scene is not a shown 110x77 print: ' + JSON.stringify(inn));
  rig.check(inn.show !== 'none' && inn.inside && inn.dx >= 0 && inn.dx < 12 * inn.z && inn.dy >= 0 && inn.dy < 12 * inn.z,
            'zoomed in, the scene name is not a plate inside the print at its top left: ' + JSON.stringify(inn));
  rig.check(inn.plates, 'zoomed in, a place name plate still shows');

  // The camera cannot leave the map: far out, the window is still inside what the map reaches.
  await dm.evaluate('for (let i = 0; i < 40; i++) document.getElementById("wm").dispatchEvent(new WheelEvent("wheel", { deltaY: 600, clientX: 400, clientY: 300, bubbles: true, cancelable: true })); 0');
  const WM_SPLIT_ = await dm.evaluate('WM_SPLIT');
  const far = JSON.parse(await dm.evaluate('JSON.stringify((e => { const a = _wmToWorld(0, 0), b = _wmToWorld(_wmView().w, _wmView().h); return { z: _wmCam.z, floor: _wmFloor(), a, b, e }; })(_wmExtent()))'));
  rig.check(far.z >= far.floor - 1e-9 && (far.floor >= WM_SPLIT_ * 0.85 - 1e-9 || far.a.x >= far.e.x0 - 1 && far.a.y >= far.e.y0 - 1 && far.b.x <= far.e.x1 + 1 && far.b.y <= far.e.y1 + 1),
            'zoomed far out, the window shows ground beyond the map: ' + JSON.stringify(far));
  await dm.evaluate('__wmCam(' + pc.x + ', ' + pc.y + ', 0.9); 0');
  // The outline's look is read from the table the room code draws from; a room's own look is untouched.
  rig.check(await dm.evaluate('POLY_LOOK.place.lineW === 2 && POLY_LOOK.place.lineA === 1 && POLY_LOOK.place.edgeA === 0 && POLY_STATE_RGB.place === "255,255,255"'),
            'the place outline is not white, full strength and 2px with no soft edge');
  rig.check(await dm.evaluate('POLY_LOOK.shroud.lineW === 1.3 && POLY_LOOK.reveal.lineW === 1.3 && POLY_STATE_RGB.shroud === "150,80,255"'),
            'the Mist look changed how a room is drawn on the battlemap');

  // ── 3. Pan, zoom, and a left drag that does nothing ───────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const pan = await dm.evaluate(`(() => {
    const wm = document.getElementById('wm'), z = _wmCam.z, c0 = { ..._wmCam };
    __wmE('mousedown', wm, { x: 500, y: 300 }, { button: 1 });
    __wmE('mousemove', window, { x: 560, y: 340 }, { button: 1 });
    __wmE('mouseup', window, { x: 560, y: 340 }, { button: 1 });
    const c1 = { ..._wmCam };
    __wmE('mousedown', wm, { x: 400, y: 600 });
    __wmE('mousemove', window, { x: 440, y: 620 });
    __wmE('mouseup', window, { x: 440, y: 620 });
    return { z, dx: c1.cx - c0.cx, dy: c1.cy - c0.cy, still: _wmCam.cx === c1.cx && _wmCam.cy === c1.cy };
  })()`);
  rig.check(Math.abs(pan.dx + 60 / pan.z) < 0.01 && Math.abs(pan.dy + 40 / pan.z) < 0.01,
            'the middle button did not pan the map by the drag: ' + JSON.stringify(pan));
  rig.check(pan.still, 'a left drag on empty space moved the map');
  const zoom = await dm.evaluate(`(() => {
    const wm = document.getElementById('wm'), p = { x: 640, y: 260 };
    const w0 = _wmToWorld(p.x, p.y), z0 = _wmCam.z;
    wm.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true }));
    const w1 = _wmToWorld(p.x, p.y);
    return { grew: _wmCam.z > z0, drift: Math.hypot(w1.x - w0.x, w1.y - w0.y) };
  })()`);
  rig.check(zoom.grew && zoom.drift < 0.01, 'the wheel did not zoom around the pointer: ' + JSON.stringify(zoom));

  // ── 5. Dragging scenes ─────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const layout = async () => {
    const all = JSON.parse(await dm.evaluate('JSON.stringify(allScenes.map(s => s.worldPos))'));
    const cx = all.reduce((a, p) => a + p.x, 0) / all.length, cy = all.reduce((a, p) => a + p.y, 0) / all.length;
    // ⚠ THE UPDATE TOAST COMES UP WHENEVER A CHECK ANSWERS (on macOS mid-run) and covers the prints in its corner, so a
    // drop aimed at a card lands on the toast. Closed, as a DM closes it before working on the map.
    await dm.evaluate('__wmCam(' + cx + ', ' + cy + ', 0.9); if (typeof hideUpdateToast === "function") hideUpdateToast(); 0');
    await lib.settle(dm, SETTLED, 8000);
  };
  await layout();
  const at = n => dm.evaluate('(() => { const s = allScenes.find(x => x.name === ' + JSON.stringify(n) + '); return { x: s.worldPos.x, y: s.worldPos.y, g: s.group }; })()');
  const gf0 = await at('Ground Floor');
  await dm.evaluate('(() => { const c = __wmCard("Ground Floor").firstChild, p = __wmC(c); __wmDrag(c, { x: p.x, y: p.y + 10 }); return 0; })()');
  const gf1 = await at('Ground Floor');
  const z6 = await dm.evaluate('_wmCam.z');
  rig.check(gf1.g === 'Watcherhouse' && Math.abs((gf1.y - gf0.y) - 10 / z6) < 2 / z6 && Math.abs(gf1.x - gf0.x) < 2 / z6,
            'a drag within its place did not move the scene there: ' + JSON.stringify([gf0, gf1]));
  const gfDisk = await poll(() => stored(id['Ground Floor']), v => v && v.pos && Math.abs(v.pos.y - gf1.y) < 0.001, 12000);
  rig.check(gfDisk && Math.abs(gfDisk.pos.y - gf1.y) < 0.001, 'the move did not reach the store: ' + JSON.stringify(gfDisk));

  const attic0 = await at('Attic');
  // What sits under the drop point is recorded with the result: the drop finds its target by a hit-test.
  const aimed = await dm.evaluate(`(() => { const t = __wmCard('Frostmere Pass'), p = __wmC(t.firstChild), u = document.elementFromPoint(p.x, p.y);
    const r = t.getBoundingClientRect();
    return { p: { x: Math.round(p.x), y: Math.round(p.y) }, card: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      under: u ? (u.id || u.className.baseVal || u.className || u.tagName) + ' < ' + ((u.closest('.wm-card') || {}).className || 'no card') : null,
      z: +_wmCam.z.toFixed(3), cls: document.getElementById('wm').className }; })()`);
  await dm.evaluate('(() => { __wmDrag(__wmCard("Attic").firstChild, __wmC(__wmCard("Frostmere Pass").firstChild)); return 0; })()');
  const fresh = await dm.evaluate(`({ editing: !!_wmEditing, picked: worldMapSel.place,
    a: allScenes.find(s => s.name === 'Attic').group, f: allScenes.find(s => s.name === 'Frostmere Pass').group })`);
  fresh.aimed = aimed;
  // RED ON: the _wmNameShown guard removed from _wmDrop (worldMapEdit.js), which opened a rename on a hidden plate — 2026-10-09
  rig.check(!fresh.editing && fresh.picked === 'New place' && fresh.a === 'New place' && fresh.f === 'New place',
            'dropping a scene on a loose scene did not make a picked place, or opened a rename on its hidden name: ' + JSON.stringify(fresh));
  // One Ctrl+Z takes back the place AND the move; Ctrl+Shift+Z puts both back.
  const undone = await dm.evaluate(`(() => { __rigKey('KeyZ', { ctrlKey: true });
    const a = allScenes.find(s => s.name === 'Attic'), out = { place: !!worldPlaceByName('New place'), g: a.group, pos: { ...a.worldPos } };
    __rigKey('KeyZ', { ctrlKey: true, shiftKey: true }); out.back = allScenes.find(s => s.name === 'Attic').group; return out; })()`);
  // RED ON: worldUndoDropLast() removed after the drop's worldPlaceCreate (worldMapEdit.js) — 2026-10-09
  rig.check(!undone.place && undone.g === attic0.g && undone.pos.x === attic0.x && undone.pos.y === attic0.y && undone.back === 'New place',
            'one Ctrl+Z after a drop on a loose scene did not take back both the place and the move: ' + JSON.stringify(undone));
  await dm.evaluate('renameGroupAsking("New place", "Pass"); 0');
  rig.check(await dm.evaluate('allScenes.filter(s => s.group === "Pass").length') === 2, 'naming the new place did not keep both scenes in it');

  await layout();
  await dm.evaluate('(() => { const c = __wmCard("Frostmere Pass").firstChild, p = __wmC(c); __wmDrag(c, { x: p.x + 120, y: p.y + 160 }); return 0; })()');
  const gone = await stored(id['Frostmere Pass']);
  rig.check(gone && gone.group === '', 'dropping a scene on empty space did not take it out of its place: ' + JSON.stringify(gone));
  rig.check(await dm.evaluate('Object.keys(worldPlacesAll()).includes("Pass") && allScenes.filter(s => s.group === "Pass").length === 1'),
            'a place left with one scene stopped being a place');
  // Filed under Watcherhouse the way the library does it, then brought inside its polygon, so every
  // check below runs on the same three-scene place.
  await dm.evaluate('worldSceneSet(' + JSON.stringify(id.Attic) + ', { group: "Watcherhouse" }); worldPullIn(); worldAssignAll(); worldMapRefresh(); 0');
  rig.check(await dm.evaluate('allScenes.find(s => s.name === "Attic").group') === 'Watcherhouse' &&
            await dm.evaluate('wmRectInPoly(wmCardRect(allScenes.find(s => s.name === "Attic").worldPos), wmOutline(worldPlaceByName("Watcherhouse")))'),
            'a scene filed under a place in the library was not brought inside its polygon');

  await layout();
  const before = JSON.parse(await dm.evaluate('JSON.stringify(allScenes.filter(s => s.group === "Watcherhouse").map(s => [s.name, s.worldPos]))'));
  await dm.evaluate('(() => { const h = __wmHead("Watcherhouse"), p = __wmC(h); __wmDrag(h, { x: p.x + 40, y: p.y + 30 }); return 0; })()');
  const after = JSON.parse(await dm.evaluate('JSON.stringify(allScenes.filter(s => s.group === "Watcherhouse").map(s => [s.name, s.worldPos]))'));
  const dxs = before.map((b, i) => after[i][1].x - b[1].x), dys = before.map((b, i) => after[i][1].y - b[1].y);
  rig.check(dxs.every(d => Math.abs(d - dxs[0]) < 1e-6) && dys.every(d => Math.abs(d - dys[0]) < 1e-6) && Math.abs(dxs[0]) > 20,
            'dragging a place\'s name did not move all its scenes together: ' + JSON.stringify([dxs, dys]));

  // ── 6. Renaming ────────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('__wmDbl(__wmCard("Cellar").querySelector(".wm-nm")); 0');
  rig.check(await dm.evaluate('!!_wmEditing'), 'a double-click on a scene\'s name did not start editing it');
  await dm.evaluate('__wmEnter("  Cellar   below "); 0');
  const renamed = await poll(() => stored(id.Cellar), v => v && v.name === 'Cellar below', 12000);
  rig.check(renamed && renamed.name === 'Cellar below', 'the renamed scene is not in the store, trimmed and on one line: ' + JSON.stringify(renamed));
  // RED BY DESIGN: written against the change, never re-proved (this read the library window's name field)
  rig.check(await dm.evaluate('allScenes.some(s => s.name === "Cellar below")'),
            'the scene\'s new name is not on its record in memory');
  // Place notes first, so the rename below has something to carry.
  await dm.evaluate('__wmClick(__wmHead("Watcherhouse")); 0');
  await dm.evaluate('(() => { const f = document.getElementById("np-field"); f.value = "Mist off the river."; f.dispatchEvent(new Event("input", { bubbles: true })); f.dispatchEvent(new FocusEvent("blur")); return 0; })()');
  await dm.evaluate('__wmDbl(__wmHead("Watcherhouse")); __wmEnter("The Watcherhouse"); 0');
  const groups = await poll(() => dm.evaluate('JSON.stringify(allScenes.filter(s => s.group === "The Watcherhouse").length)'), v => v === '3', 12000);
  rig.check(groups === '3', 'renaming a place did not rename the group on its scenes: ' + groups);
  // RED BY DESIGN: written against the change, never re-proved (this read the library window's group heading)
  rig.check(await dm.evaluate('Object.keys(worldPlacesAll()).includes("The Watcherhouse") || allScenes.some(s => s.group === "The Watcherhouse")'),
            'the place\'s new name is on no place record and no scene');
  const carried = await dm.evaluate('JSON.stringify(Object.entries(notesPlacesAll()))');
  rig.check(carried === JSON.stringify([['The Watcherhouse', 'Mist off the river.']]),
            'a rename did not carry the place\'s notes to its new name: ' + carried);

  // ── 11. Drawing places ─────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await layout();
  const drawn = () => dm.evaluate('Object.keys(worldPlacesAll()).length');
  const n0 = await drawn();
  const z0 = await dm.evaluate('_wmCam.z');
  await dm.evaluate('document.getElementById("btn-rect").click(); 0');
  rig.check(await dm.evaluate('_wmTool') === 'rect', 'the rectangle tool did not pick the layer tool');
  rig.check(await dm.evaluate('_wmCam.z') === z0 && !await dm.evaluate('_wmAnim'), 'picking a drawing tool moved the camera');
  await dm.evaluate('(() => { const r = __wmCard("Frostmere Pass").getBoundingClientRect();' +
    ' const a = { x: r.x - 40, y: r.y - 50 }, b = { x: r.x + r.width + 40, y: r.y + r.height + 40 };' +
    ' __wmPress(a, b); return 0; })()');
  rig.check(await drawn() === n0 + 1, 'the rectangle tool did not draw a place');
  // RED ON: the _wmNameShown guard removed from _wmCreatePlace (worldMapShapes.js) — 2026-10-09
  rig.check(await dm.evaluate('!_wmEditing && _wmTool === "select" && /^New place/.test(worldMapSel.place)'),
            'a new place drawn zoomed in opened a rename on its hidden name, or was not picked, or kept the tool');
  await dm.evaluate('renameGroupAsking(worldMapSel.place, "Frost"); 0');
  rig.check(await dm.evaluate('allScenes.find(s => s.name === "Frostmere Pass").group') === 'Frost',
            'a scene inside a newly drawn place does not belong to it');
  const n1 = await drawn();
  await dm.evaluate('__rigKey("KeyO"); 0');
  await dm.evaluate('(() => { const c = { x: 640, y: 120 }; __wmPress(c, { x: c.x + 60, y: c.y }); return 0; })()');
  rig.check(await drawn() === n1 + 1 && await dm.evaluate('worldPlaceRecords().pop().vertices.length') >= 12, 'the circle tool did not draw a round place');
  await dm.evaluate('renameGroupAsking(worldMapSel.place, "Round"); 0');
  await dm.evaluate('__rigKey("KeyP"); 0');
  await dm.evaluate('(() => { for (const p of [{ x: 760, y: 90 }, { x: 860, y: 90 }, { x: 810, y: 170 }]) { __wmGround("mousedown", p); __wmE("mouseup", window, p); } return 0; })()');
  rig.check(await dm.evaluate('!!_wmPre'), 'a polygon being clicked out shows no outline');
  await dm.evaluate('__rigKey("Enter"); 0');
  rig.check(await drawn() === n1 + 2, 'the polygon tool did not make a place on Enter');
  await dm.evaluate('renameGroupAsking(worldMapSel.place, "Wedge"); 0');
  rig.check(await dm.evaluate('worldPlacesAll().Wedge.vertices.length') === 3, 'the polygon does not have the three corners that were clicked');
  rig.check(/"Wedge"/.test(await dm.evaluate('localStorage.getItem("evermist.placeShapes")')),
            'the polygon was not written to the browser storage the backup and the next sitting read');

  // ── 16. Pre-4.0 fixes ──────────────────────────────────────────────────────
  // Placed before 12, which stops the file early until the later stage. Every check undoes what it did.
  const dock = () => dm.evaluate(`(() => ({ pane: dockActivePane(), tab: document.getElementById('dock-tab-scene').disabled,
    fog: document.getElementById('fog-half-alpha-num').closest('.cp-group').inert, wm: document.getElementById('wm-bg-group').inert,
    music: document.getElementById('dock-tab-music').disabled }))()`);
  await dm.evaluate('worldMapHide(); dockOpen("scene"); worldMapShow(); 0');
  await lib.settle(dm, '!_wmAnim', 15000);
  const dk1 = await dock();
  // RED ON: dockHoldForWorld(true) removed from worldMapShow (worldMap.js) — 2026-10-09
  rig.check(dk1.pane !== 'scene' && dk1.tab && dk1.fog && !dk1.wm && !dk1.music,
            'with the world map up, Scene control is live or Fog in every scene is not disabled: ' + JSON.stringify(dk1));
  await dm.evaluate('worldMapHide(); 0');
  const dk2 = await dock();
  // RED ON: dockHoldForWorld(false) removed from worldMapHide (worldMap.js) — 2026-10-09
  rig.check(dk2.pane === 'scene' && !dk2.tab && !dk2.fog, 'closing the world map did not give Scene control back: ' + JSON.stringify(dk2));
  await dm.evaluate('dockOpen(null); worldMapShow(); 0');
  await lib.settle(dm, '!_wmAnim', 15000);
  await layout();

  const tiny = await dm.evaluate(`(() => { const name = worldPlaceCreate(wmRectShape(-6000, -6000, -5960, -5960)); worldMapRefresh(); __wmCam(-5980, -5980, 0.3);
    const p = __wmS(-5980, -5980); document.getElementById('wm').dispatchEvent(new MouseEvent('contextmenu', { clientX: p.x, clientY: p.y, button: 2, bubbles: true, cancelable: true }));
    const rows = [...document.querySelectorAll('.wm-menu .sm-mi')].map(b => b.textContent + (b.disabled ? ' (off)' : ''));
    worldMapMenuClose(); const off = _wmEls.get('h' + name).classList.contains('off'); worldPlaceDelete(worldPlaceByName(name).id); return { off, rows }; })()`);
  // RED ON: the plate .off test removed from Rename's off in _wmPlaceRows (worldMapMenu.js) — 2026-10-09
  rig.check(tiny.off && tiny.rows[0] === 'Rename (off)', 'Rename is on for a place whose name is hidden: ' + JSON.stringify(tiny));
  await layout();

  await dm.evaluate('worldUndoClear(); 0');
  const at0 = await at('Attic');
  await dm.evaluate('(() => { const c = __wmCard("Attic").firstChild, p = __wmC(c); __wmDrag(c, { x: p.x, y: p.y + 260 }); __rigKey("KeyZ", { ctrlKey: true }); return 0; })()');
  const at1 = await at('Attic');
  // RED ON: the card drag's undo push made conditional on a road again (worldMapEdit.js) — 2026-10-09
  rig.check(at1.x === at0.x && at1.y === at0.y && at1.g === at0.g, 'Ctrl+Z after dragging a scene did not put it back: ' + JSON.stringify([at0, at1]));
  await dm.evaluate('worldUndoClear(); _wmTakeOut(allScenes.find(s => s.name === "Attic").id, allScenes.find(s => s.name === "Attic").group); __rigKey("KeyZ", { ctrlKey: true }); 0');
  const at2 = await at('Attic');
  // RED ON: worldUndoPush() removed from _wmTakeOut (worldMapMenu.js) — 2026-10-09
  rig.check(at2.x === at0.x && at2.y === at0.y && at2.g === at0.g, 'Ctrl+Z after Take out of its place did not put it back: ' + JSON.stringify([at0, at2]));

  await dm.evaluate('__wmClick(__wmCard("Attic").firstChild); __rigKey("Escape"); 0');
  // RED ON: Escape's pick test back to `> 1` (worldMap.js) — 2026-10-09
  rig.check(await dm.evaluate('worldMapOpen && !worldMapSel.sceneId'), 'Esc with one scene picked closed the map or kept the pick');
  await lib.settle(dm, 'worldMapOpen && !_wmAnim', 15000);
  await layout();
  const keys = await dm.evaluate(`(() => {
    const n0 = allScenes.length;
    __wmClick(__wmCard('Attic').firstChild); __rigKey('Delete'); const n1 = allScenes.length;
    document.querySelector('#scene-undo-toast .undo-btn').click(); worldMapRefresh();
    __wmClick(__wmCard(currentScene.name).firstChild); __rigKey('Backspace'); const n2 = allScenes.length;
    const real = worldMapOpenScene; let got = null; worldMapOpenScene = i => { got = i; };
    __wmClick(__wmCard('Attic').firstChild); __rigKey('Enter'); worldMapOpenScene = real;
    return { n0, n1, n2, n3: allScenes.length, enter: got === allScenes.find(s => s.name === 'Attic').id };
  })()`);
  // RED ON: the Delete and Enter branches for picked scenes removed from worldMapKeys (worldMap.js) — 2026-10-09
  rig.check(keys.n1 === keys.n0 - 1 && keys.n2 === keys.n0 && keys.n3 === keys.n0 && keys.enter,
            'Delete on a picked scene, Delete held off the open scene, or Enter opening the pick failed: ' + JSON.stringify(keys));

  const legend = await dm.evaluate(`(() => { worldMapSelect({ sceneId: null, place: '' }); __rigKey('Slash', { shiftKey: true }); const up = legendVisible;
    __rigKey('Escape'); return { up, down: !legendVisible, open: worldMapOpen }; })()`);
  // RED ON: the legend branch removed from worldMapKeys (worldMap.js) — 2026-10-09
  rig.check(legend.up && legend.down && legend.open, '? did not open the legend, or Esc closed the map instead of it: ' + JSON.stringify(legend));
  if (!legend.down) await dm.evaluate('if (legendVisible) toggleLegend(); 0');
  await lib.settle(dm, 'worldMapOpen && !_wmAnim', 15000);

  const list = await dm.evaluate('(() => { document.querySelector("#tb-grp-shape .tb-chev").click(); const r = [...document.querySelectorAll("#tb-dd [data-dd]")].map(b => b.dataset.dd); _tbCloseList(); return r; })()');
  // RED ON: the worldMapOpen filter removed from _tbOpenList (shapeMenu.js) — 2026-10-09
  rig.check(!list.some(r => /cone|line|ring/.test(r)) && list.includes('btn-rect'), 'the world map\'s Shape list carries Effects shapes: ' + JSON.stringify(list));
  const blue = await dm.evaluate('(() => { document.getElementById("wm-road").click(); const o = { sel: document.getElementById("btn-select").classList.contains("active"), road: document.getElementById("wm-road").classList.contains("active") }; setShape("select"); o.back = document.getElementById("btn-select").classList.contains("active"); return o; })()');
  // RED ON: btn-select's toggle removed from worldMapRoadButtonSync (worldMapRoads.js) — 2026-10-09
  rig.check(!blue.sel && blue.road && blue.back, 'with Road in hand Select is still blue, or Select did not come back: ' + JSON.stringify(blue));

  const del = await dm.evaluate(`(() => {
    const dlg = () => { const a = document.getElementById('cd-anchor'); return !!a && a.style.display !== 'none' && a.style.display !== ''; };
    notesPlaceSet('Frost', 'Wolves at night.');
    worldPlaceDelete(worldPlaceByName('Frost').id);
    const r = { dlg: dlg(), gone: !worldPlaceByName('Frost'), notes: notesPlaceGet('Frost') };
    __rigKey('KeyZ', { ctrlKey: true });
    Object.assign(r, { back: !!worldPlaceByName('Frost'), notesBack: notesPlaceGet('Frost'), g: allScenes.find(s => s.name === 'Frostmere Pass').group });
    notesPlaceSet('Frost', ''); return r;
  })()`);
  // RED ON: deleteGroup's confirmDialog put back (worldMapStore.js) — 2026-10-09
  rig.check(!del.dlg && del.gone, 'deleting a place with a scene in it asked first, or did not delete it: ' + JSON.stringify(del));
  // RED ON: notesPlaceSet(name, '') removed from deleteGroup; and, separately, _wpRestoreNotes removed from _wpRestore (worldMapStore.js, worldPlaces.js) — 2026-10-09
  rig.check(del.notes === '' && del.back && del.notesBack === 'Wolves at night.' && del.g === 'Frost',
            'a deleted place kept its notes, or Ctrl+Z did not bring the place and its notes back: ' + JSON.stringify(del));

  const dup = await dm.evaluate(`(() => { renameGroupAsking('Round', 'Wedge');
    const a = document.getElementById('cd-anchor'), dlg = !!a && a.style.display !== 'none' && a.style.display !== '';
    const r = { dlg, both: !!worldPlaceByName('Round') && !!worldPlaceByName('Wedge') }; if (dlg) document.getElementById('cd-ok').click(); return r; })()`);
  // RED ON: renameGroupAsking's refusal swapped back for the merge confirm (worldMapStore.js) — 2026-10-09
  rig.check(dup.dlg && dup.both, 'a rename onto a place name already taken was not refused: ' + JSON.stringify(dup));

  const refusal = await dm.evaluate(`(() => { const real = messageDialog; let got = null; messageDialog = o => { got = o.message; };
    _wmSplit([{ x: 90000, y: 90000 }, { x: 90100, y: 90000 }]); messageDialog = real; return { msg: got, ru: !!got && i18nLookup(RU, got) !== got }; })()`);
  // RED ON: _wmRefuse back to splitting "room" into "place" (worldMapShapes.js) — 2026-10-09
  rig.check(/place/.test(refusal.msg || '') && refusal.ru, 'the Split refusal is not a place string with a Russian entry: ' + JSON.stringify(refusal));

  // ── 12. One pixel out is out ───────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const edge = await dm.evaluate(`(() => {
    const rec = worldPlaceByName('The Watcherhouse'), out = wmOutline(rec), s = allScenes.find(x => x.name === 'Ground Floor');
    const gap = wmPolyBounds(out), card = wmCardRect(s.worldPos);
    const flush = { x: s.worldPos.x + (gap.x + gap.w - (card.x + card.w)), y: s.worldPos.y };
    const at = p => wmPlaceOf(wmCardRect(p), { Watcherhouse: out });
    return { here: wmRectInPoly(card, out), flush: at(flush), past: at({ x: flush.x + 1, y: flush.y }) };
  })()`);
  rig.check(edge.here, 'a scene filed in a place sits outside its outline');
  rig.check(edge.flush === 'Watcherhouse' && edge.past === '', 'a card flush with the wall is not in, or a card one pixel past it still is: ' + JSON.stringify(edge));

  // ── 13. Editing a place exactly as a room ──────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  // Frost is the rectangle round Frostmere Pass. Pick it, then double-click it open as a room opens.
  const frost = () => dm.evaluate('JSON.stringify((r => ({ v: r.vertices, cr: r.cornerRadius, rr: r.cornerRadii, h: r.handles }))(worldPlaceByName("Frost")))').then(JSON.parse);
  const scr = (x, y) => dm.evaluate('JSON.stringify(__wmS(' + x + ', ' + y + '))').then(JSON.parse);
  const fb = JSON.parse(await dm.evaluate('JSON.stringify(wmPolyBounds(wmOutline(worldPlaceByName("Frost"))))'));
  await dm.evaluate('__wmCam(' + (fb.x + fb.w / 2) + ', ' + (fb.y + fb.h / 2) + ', 0.9); 0');
  const inside = await scr(fb.x + 14, fb.y + fb.h - 10);
  await dm.evaluate('__wmGround("mousedown", ' + JSON.stringify(inside) + '); __wmE("mouseup", window, ' + JSON.stringify(inside) + '); 0');
  rig.check(await dm.evaluate('worldMapSel.place') === 'Frost' && await dm.evaluate('selectedPolygonId') === await dm.evaluate('worldPlaceByName("Frost").id'),
            'a click inside a place did not pick it as a room is picked');
  await dm.evaluate('__wmGround("dblclick", ' + JSON.stringify(inside) + '); 0');
  rig.check(await dm.evaluate('shapeEditMode'), 'a double-click did not open the place to its corners');
  // A corner picked shows its rounding circle; dragging it rounds that corner.
  let f = await frost();
  const c0 = await scr(f.v[0].x, f.v[0].y);
  await dm.evaluate('__wmGround("mousedown", ' + JSON.stringify(c0) + '); __wmE("mouseup", window, ' + JSON.stringify(c0) + '); 0');
  const circle = JSON.parse(await dm.evaluate('JSON.stringify(_wmWithCamera(() => cornerCircles(findActiveShape()).map(h => ({ x: h.x, y: h.y }))))'));
  rig.check(circle.length === 1, 'a picked corner shows no rounding circle: ' + JSON.stringify(circle));
  const cs = await scr(circle[0].x, circle[0].y);
  await dm.evaluate('__wmPress(' + JSON.stringify(cs) + ', { x: ' + (cs.x + 40) + ', y: ' + (cs.y + 40) + ' }); 0');
  f = await frost();
  rig.check(f.rr && f.rr[0] > 0 && !f.rr[1], 'dragging the circle did not round that corner alone: ' + JSON.stringify(f.rr));
  rig.check(await dm.evaluate('wmOutline(worldPlaceByName("Frost")).length') > 4, 'the outline does not follow the rounded corner');
  // A wall bent with Ctrl+drag becomes a curve, as on a room.
  f = await frost();
  const wallMid = await scr((f.v[1].x + f.v[2].x) / 2, (f.v[1].y + f.v[2].y) / 2);
  await dm.evaluate('__wmPress(' + JSON.stringify(wallMid) + ', { x: ' + (wallMid.x + 50) + ', y: ' + wallMid.y + ' }, { ctrlKey: true }); 0');
  f = await frost();
  rig.check(f.h && f.h.some(h => h && (h.ox || h.oy || h.ix || h.iy)), 'Ctrl+drag did not bend the wall into a curve');
  // A corner added with a double-click on a wall, and taken back with Ctrl+Z.
  const n = f.v.length;
  const top = await scr((f.v[0].x + f.v[1].x) / 2 + 40, f.v[0].y);
  await dm.evaluate('__wmGround("mousedown", ' + JSON.stringify(top) + '); __wmE("mouseup", window, ' + JSON.stringify(top) + '); __wmGround("dblclick", ' + JSON.stringify(top) + '); 0');
  rig.check((await frost()).v.length === n + 1, 'a double-click on a wall did not add a corner');
  await dm.evaluate('__rigKey("KeyZ", { ctrlKey: true }); 0');
  rig.check((await frost()).v.length === n, 'Ctrl+Z did not take the added corner back');
  await dm.evaluate('__rigKey("KeyZ", { ctrlKey: true, shiftKey: true }); 0');
  rig.check((await frost()).v.length === n + 1, 'Ctrl+Shift+Z did not put the corner back');
  // The corner picked and Delete: the room's own delete.
  // RED ON: worldUndoStep clearing the selection on every undo (worldPlaces.js) — 2026-10-09
  await dm.evaluate('selectedVertexIndex = ' + (n > 3 ? 1 : 0) + '; __rigKey("Delete"); 0');
  rig.check((await frost()).v.length === n, 'Delete on a picked corner did not remove it');
  // Escape climbs a level at a time and the map stays open until nothing is picked.
  await dm.evaluate('__rigKey("Escape"); 0');
  const afterEsc = await dm.evaluate('JSON.stringify({ edit: shapeEditMode, picked: selectedPolygonId != null, open: worldMapOpen })');
  rig.check(JSON.parse(afterEsc).open && JSON.parse(afterEsc).picked, 'the first Escape closed the map or dropped the place: ' + afterEsc);
  // The box at object level scales the whole place, and the scene that no longer fits is out.
  await dm.evaluate('if (shapeEditMode) __rigKey("Escape"); 0');
  const bx = JSON.parse(await dm.evaluate('JSON.stringify(wmPolyBounds(wmOutline(worldPlaceByName("Frost"))))'));
  const se = await scr(bx.x + bx.w, bx.y + bx.h);
  const verts0 = await dm.evaluate('JSON.stringify(worldPlaceByName("Frost").vertices)');
  await dm.evaluate('__wmPress(' + JSON.stringify(se) + ', { x: ' + (se.x - 330) + ', y: ' + (se.y - 150) + ' }); 0');
  rig.check(verts0 !== await dm.evaluate('JSON.stringify(worldPlaceByName("Frost").vertices)'), 'dragging the box handle did not scale the place');
  rig.check(await dm.evaluate('allScenes.find(s => s.name === "Frostmere Pass").group') === '',
            'a scene that no longer fits inside the scaled place is still in it');
  const kept = await dm.evaluate('localStorage.getItem("evermist.placeShapes")');
  rig.check(/"cornerRadii"/.test(kept) && /"handles"/.test(kept), 'the rounding and the curve were not kept with the place');

  // ── 14. Zoomed out, a place keeps its polygon ──────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const wb = JSON.parse(await dm.evaluate('JSON.stringify(wmPolyBounds(wmOutline(worldPlaceByName("The Watcherhouse"))))'));
  await dm.evaluate('__wmCam(' + (wb.x + wb.w / 2) + ', ' + (wb.y + wb.h / 2) + ', 0.25); 0');
  rig.check(await dm.evaluate('/\\bplaces\\b/.test(document.getElementById("wm").className)'), 'the camera is not at the places level');
  const edgePt = await scr(wb.x + wb.w / 2, wb.y + 1);
  const ink = await dm.evaluate('(() => { const d = cursorCtx.getImageData(Math.round(' + edgePt.x + ') - 2, Math.round(' + edgePt.y + ') - 2, 5, 5).data; let best = [0, 0, 0, 0]; for (let i = 3; i < d.length; i += 4) if (d[i] > best[3]) best = [d[i - 3], d[i - 2], d[i - 1], d[i]]; return best; })()');
  rig.check(ink[3] > 0, 'zoomed out, an outline is not drawn: its edge reads transparent');
  rig.check(ink[0] > 235 && ink[1] > 235 && ink[2] > 235, 'zoomed out, an outline is not white: ' + JSON.stringify(ink));

  // ── 15a. Picking more than one scene ──────────────────────────────────────
  // Shift+click adds a scene to the pick and takes it back out; a Shift-drag box on the ground adds every scene it touches.
  // RED ON: the shift branch removed from _wmClick (worldMapEdit.js) — 2026-10-09
  await layout();
  await dm.evaluate('worldMapSelect({ sceneId: null, place: "" }); __wmClick(__wmCard("Attic").firstChild); __wmClick(__wmCard("Cellar below").firstChild, { shiftKey: true }); 0');
  const two = await dm.evaluate('worldMapPicked().map(id => allScenes.find(s => s.id === id).name).sort()');
  rig.check(JSON.stringify(two) === JSON.stringify(['Attic', 'Cellar below']), 'Shift+click did not add a scene to the pick: ' + JSON.stringify(two));
  await dm.evaluate('__wmClick(__wmCard("Cellar below").firstChild, { shiftKey: true }); 0');
  rig.check(JSON.stringify(await dm.evaluate('worldMapPicked().map(id => allScenes.find(s => s.id === id).name)')) === JSON.stringify(['Attic']),
            'a second Shift+click did not take the scene back out of the pick');
  // RED ON: the shiftKey test removed from the ground press that starts the box (worldMapEdit.js) — 2026-10-09
  const box = await dm.evaluate(`(() => { const cs = ['Attic', 'Cellar below', 'Ground Floor'].map(n => __wmCard(n).getBoundingClientRect());
    return { a: { x: Math.min(...cs.map(r => r.left)) - 30, y: Math.min(...cs.map(r => r.top)) - 30 }, b: { x: Math.max(...cs.map(r => r.right)) + 30, y: Math.max(...cs.map(r => r.bottom)) + 30 } }; })()`);
  await dm.evaluate('worldMapSelect({ sceneId: null, place: "" }); __wmPress(' + JSON.stringify(box.a) + ', ' + JSON.stringify(box.b) + ', { shiftKey: true }); 0');
  const boxed = await dm.evaluate('worldMapPicked().map(id => allScenes.find(s => s.id === id).name).sort()');
  rig.check(['Attic', 'Cellar below', 'Ground Floor'].every(n => boxed.includes(n)), 'a Shift-drag box did not pick the scenes it touched: ' + JSON.stringify(boxed));
  await dm.evaluate('worldMapSelect({ sceneId: null, place: "" }); 0');

  // ── 15. The right-click menu ───────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const rows = () => dm.evaluate('[...document.querySelectorAll(".wm-menu .sm-mi")].map(b => b.textContent + (b.disabled ? " (off)" : ""))');
  const rclick = (expr) => dm.evaluate('(() => { const el = ' + expr + '; const p = __wmC(el); el.dispatchEvent(new MouseEvent("contextmenu", { clientX: p.x, clientY: p.y, button: 2, bubbles: true, cancelable: true })); return 0; })()');
  const press = label => dm.evaluate('[...document.querySelectorAll(".wm-menu .sm-mi")].find(b => b.textContent === ' + JSON.stringify(label) + ').click(); 0');
  await layout();
  await rclick('__wmCard("Attic").firstChild');
  const sceneRows = await rows();
  rig.check(JSON.stringify(sceneRows) === JSON.stringify(['Open', 'Rename', 'Take out of its place', 'Export this scene', 'Delete scene']) ||
            JSON.stringify(sceneRows) === JSON.stringify(['Open', 'Rename', 'Take out of its place', 'Export this scene', 'Delete scene (off)']),
            'a scene\'s menu is not Open, Rename, Take out of its place, Export, Delete: ' + JSON.stringify(sceneRows));
  await press('Rename');
  rig.check(await dm.evaluate('!!_wmEditing'), 'Rename in the menu did not start editing the name');
  await dm.evaluate('_wmEditing.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape", bubbles: true, cancelable: true })); 0');
  await rclick('__wmCard("Frostmere Pass").firstChild');
  const pass = await rows();
  rig.check(pass[pass.length - 1] === 'Delete scene', 'the delete row is off for a scene that is not open: ' + JSON.stringify(pass));
  const nBefore = await dm.evaluate('allScenes.length');
  await press('Delete scene');
  rig.check(await dm.evaluate('allScenes.length') === nBefore - 1 && await dm.evaluate('worldMapOpen'),
            'Delete in the menu did not remove the scene, or closed the map');
  await dm.evaluate('document.querySelector("#scene-undo-toast .undo-btn").click(); 0');
  rig.check(await dm.evaluate('allScenes.length') === nBefore, 'the undo toast did not bring the deleted scene back');
  const open = await dm.evaluate('currentScene.name');
  await rclick('__wmCard(' + JSON.stringify(open) + ').firstChild');
  const openRows = await rows();
  // RED ON: the open-scene off removed from the Delete scene row in _wmSceneRows (worldMapMenu.js) — 2026-10-09
  rig.check(openRows[openRows.length - 1] === 'Delete scene (off)', 'the open scene can be deleted from the map, which would switch the TV: ' + JSON.stringify(openRows));
  await dm.evaluate('__rigKey("Escape"); 0');
  rig.check(await dm.evaluate('worldMapOpen && !document.querySelector(".wm-menu")'), 'Esc did not close the menu first, or left the map');
  await rclick('__wmHead("The Watcherhouse")');
  rig.check(JSON.stringify((await rows()).map(r => r.replace(/^Rename \(off\)$/, 'Rename'))) === JSON.stringify(['Rename', 'Fit in view', 'Delete place']), 'a place\'s menu is wrong: ' + JSON.stringify(await rows()));
  await dm.evaluate('__wmE("mousedown", document.getElementById("wm"), { x: 5, y: 5 }); 0');
  await dm.evaluate('(() => { const wm = document.getElementById("wm"); wm.dispatchEvent(new MouseEvent("contextmenu", { clientX: 700, clientY: 40, button: 2, bubbles: true, cancelable: true })); return 0; })()');
  rig.check(JSON.stringify(await rows()) === JSON.stringify(['Add a scene here', 'Show everything']), 'the ground\'s menu is wrong: ' + JSON.stringify(await rows()));
  await dm.evaluate('__wmE("mousedown", document.getElementById("wm"), { x: 5, y: 5 }); 0');
  rig.check(await dm.evaluate('!document.querySelector(".wm-menu")'), 'a click elsewhere left the menu up');

  // ── 7. The toolbar, and adding a scene ────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const bar = await dm.evaluate(`[...document.getElementById('toolbar-bottom').children]
    .filter(el => getComputedStyle(el).display !== 'none')
    .map((el, i) => ({ id: el.id, i, o: parseInt(getComputedStyle(el).order, 10) || 0 }))
    .sort((a, b) => a.o - b.o || a.i - b.i).map(x => x.id)`);
  rig.check(JSON.stringify(bar) === JSON.stringify(['btn-select', 'tb-grp-shape', 'tb-grp-ops', 'wm-road', 'wm-add', 'wm-find', 'btn-axislock']),
            'the toolbar does not read Select, Shape, repairs and Road, then Add a scene and Find, then Straighten: ' + JSON.stringify(bar));
  await dm.evaluate('__rigKey("KeyF", { ctrlKey: true }); 0');
  rig.check(await dm.evaluate('document.body.classList.contains("searching") && getComputedStyle(document.getElementById("context-row")).visibility === "visible" && document.getElementById("wm-search").getClientRects().length > 0'),
            'Ctrl+F did not open the Find field in the context row');
  // RED BY DESIGN: written against the change, never re-proved
  await dm.evaluate('(() => { const i = document.getElementById("wm-search"); i.value = "watcher"; i.dispatchEvent(new Event("input", { bubbles: true })); return 0; })()');
  const found = await dm.evaluate(`(() => { const l = document.getElementById('wm-find-list');
    return { shown: !l.hidden, rows: [...l.querySelectorAll('.wf-row .wf-nm')].map(e => e.textContent), count: (l.querySelector('.wf-n') || {}).textContent }; })()`);
  rig.check(found.shown && found.rows.includes('The Watcherhouse') && /match/.test(found.count || ''),
            'Find did not list the place with a count: ' + JSON.stringify(found));
  await dm.evaluate('document.getElementById("wm-search").dispatchEvent(new KeyboardEvent("keydown", { code: "Enter", key: "Enter", bubbles: true, cancelable: true })); 0');
  rig.check(await dm.evaluate('!document.body.classList.contains("searching") && worldMapSel.place === "The Watcherhouse"'),
            'Enter on a Find row did not pick it and put the field away');
  await dm.evaluate('document.getElementById("wm-find").click(); 0');
  await dm.evaluate('document.getElementById("wm-find").click(); 0');
  rig.check(await dm.evaluate('!document.body.classList.contains("searching")'), 'the Find button did not close the field');

  const openBefore = await dm.evaluate('currentScene.id');
  const centre = JSON.parse(await dm.evaluate('JSON.stringify({ x: _wmCam.cx, y: _wmCam.cy })'));
  // ⚠ THE PICKER'S OWN HANDLER, on a real FileList: setFileInputFiles reports success and fills nothing.
  await dm.evaluate('(() => { const inp = document.getElementById("wm-file-input"); const dt = new DataTransfer(); dt.items.add(' +
    named('Wolf den.mp4') + '); inp.files = dt.files; inp.dispatchEvent(new Event("change", { bubbles: true })); return 0; })()', 120000);
  await dm.waitFor('allScenes.some(s => s.name === "Wolf den")', 120000, 'the added scene to reach the library');
  const added = await dm.evaluate('(() => { const s = allScenes.find(x => x.name === "Wolf den"); return { id: s.id, pos: s.worldPos, group: s.group }; })()');
  rig.check(await dm.evaluate('currentScene.id') === openBefore, 'adding a scene opened it, and the open scene changed');
  // RED BY DESIGN: rewritten for the landing spot beside the pick, never re-proved here (see section 16)
  rig.check(Math.hypot(added.pos.x - centre.x, added.pos.y - centre.y) < 400 &&
            await dm.evaluate('worldMapSel.sceneId === ' + JSON.stringify(added.id)),
            'the new scene did not land near the view centre, picked: ' + JSON.stringify([added, centre]));
  const rec = await poll(() => stored(added.id), v => v, 12000);
  rig.check(rec && rec.fog === false && !rec.plan, 'the added scene was saved with a fog of its own or a pending plan: ' + JSON.stringify(rec));
  rig.check(await dm.evaluate('worldMapOpen && !!__wmCard("Wolf den")'), 'the new scene did not appear on the world map');

  // ── 10. The TV did not change ──────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  // Space, Shift+S, Delete and a scene tool key reach the hidden scene unless the map holds them back. V is the map's own Select.
  const calls = await dm.evaluate(`(() => {
    const seen = [];
    worldMapSelect({ sceneId: null, place: '' });   // Delete on a picked scene is the map's own, and would remove it
    for (const n of ['sendToPlayer', 'takeDownTvPicture', 'deleteSelectedPart', 'setShape']) {
      const real = globalThis[n]; globalThis[n] = (...a) => { seen.push(n); return real.apply(globalThis, a); };
      globalThis['__real_' + n] = real;
    }
    for (const c of ['Space', 'Delete', 'KeyB']) __rigKey(c);
    __rigKey('KeyS', { shiftKey: true });
    for (const n of ['sendToPlayer', 'takeDownTvPicture', 'deleteSelectedPart', 'setShape']) globalThis[n] = globalThis['__real_' + n];
    return seen;
  })()`);
  rig.check(calls.length === 0, 'the world map let a key reach the hidden scene: ' + JSON.stringify(calls));
  await lib.hold(1500, 'a late push to the TV would arrive within a second and a half of the last edit');
  rig.check(await tvSeen() === '[]', 'the TV was sent something while the world map was open: ' + await tvSeen());
  rig.check(await tv.evaluate('(wm => !wm || getComputedStyle(wm).display === "none")(document.getElementById("wm")) && (m => !m || m.getClientRects().length === 0)(document.getElementById("wm-mist"))'),
            'the TV window shows the world map or its mist');

  // ── 4. A double-click opens, Esc returns ───────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  // A room picked in the open scene is put away while the map is up.
  await dm.evaluate('worldMapHide(); 0');
  await lib.settle(dm, '!worldMapOpen', 15000);
  await dm.evaluate('(() => { selectedPolygonId = __rigDrawRoom("reveal", 120, 120, 260, 220); refreshRoomPanel(); return 0; })()');
  await dm.evaluate('worldMapShow(); 0');
  await lib.settle(dm, '!_wmAnim', 15000);
  await layout();
  await dm.evaluate('__wmClick(__wmCard("Attic").firstChild); 0');
  rig.check(await dm.evaluate('worldMapSel.sceneId === allScenes.find(s => s.name === "Attic").id && document.querySelectorAll(".wm-card.sel").length === 1'),
            'a single click did not pick the scene with a ring');
  rig.check(await dm.evaluate('currentScene.id') === openBefore && await dm.evaluate('worldMapOpen'), 'a single click opened the scene');
  const crumbs1 = await dm.evaluate('[...document.querySelectorAll("#np-crumbs .np-crumb")].map(b => b.textContent)');
  rig.check(JSON.stringify(crumbs1) === JSON.stringify(['Campaign', 'The Watcherhouse']),
            'with a scene picked the panel does not show its place: ' + JSON.stringify(crumbs1));
  await dm.evaluate('__wmDbl(__wmCard("Attic").firstChild); 0');
  await lib.settle(dm, 'currentScene && currentScene.id === allScenes.find(s => s.name === "Attic").id && !worldMapOpen', 60000);
  rig.check(await dm.evaluate('currentScene.name') === 'Attic' && await dm.evaluate('!worldMapOpen'),
            'a double-click did not open the scene and put the map away');
  // RED ON: the scene-id test removed from _wmRestoreSelection (worldMap.js) — 2026-10-09
  const picked = JSON.parse(await dm.evaluate('JSON.stringify([selectedPolygonId, shapeEditMode])'));
  rig.check(picked[0] === null && picked[1] === false,
            'the scene opened from the map came up with the last scene\'s room picked: ' + JSON.stringify(picked));
  await dm.evaluate('__rigKey("KeyM"); 0');
  await lib.settle(dm, '!_wmAnim', 15000);
  await dm.evaluate('document.getElementById("btn-world").click(); 0');
  await lib.settle(dm, '!worldMapOpen', 15000);
  rig.check(await dm.evaluate('!worldMapOpen'), 'the button did not return to the open scene');
  await dm.evaluate('__rigKey("KeyM"); 0');
  await lib.settle(dm, '!_wmAnim', 15000);
  await dm.evaluate('globalThis.__keep = currentScene; currentScene = null; __rigKey("Escape"); 0');
  await lib.hold(1500, 'a return that was going to happen would have started and finished by now');
  rig.check(await dm.evaluate('worldMapOpen'), 'Esc closed the world map with no scene open to return to');
  await dm.evaluate('currentScene = __keep; 0');

  // ── 8. The notes panel's Place level ───────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('__rigKey("Escape"); 0');
  await lib.settle(dm, '!worldMapOpen', 15000);
  const levels = () => dm.evaluate(`(() => ({
    crumbs: [...document.querySelectorAll('#np-crumbs .np-crumb')].map(b => b.dataset.level),
    on: (document.querySelector('#np-crumbs .np-crumb.on') || {}).dataset && document.querySelector('#np-crumbs .np-crumb.on').dataset.level,
    field: document.getElementById('np-field').value,
  }))()`);
  await lib.settle(dm, 'document.querySelectorAll("#np-crumbs .np-crumb").length === 3', 8000);
  const inGroup = await levels();
  rig.check(JSON.stringify(inGroup.crumbs) === JSON.stringify(['campaign', 'place', 'scene']),
            'a scene in a group does not show Campaign, Place, Scene: ' + JSON.stringify(inGroup));
  await dm.evaluate('document.querySelector("#np-crumbs .np-crumb[data-level=place]").click(); 0');
  await lib.settle(dm, 'document.getElementById("np-field").value === "Mist off the river."', 8000);
  rig.check((await levels()).field === 'Mist off the river.' && (await levels()).on === 'place',
            'the Place crumb does not show the place\'s notes: ' + JSON.stringify(await levels()));
  await dm.evaluate('switchScene(' + JSON.stringify(id['Frostmere Pass']) + '); 0', 120000);
  await dm.waitFor('currentScene && currentScene.id === ' + JSON.stringify(id['Frostmere Pass']) + ' && fogCoverT === 0', 90000, 'the loose scene');
  await lib.settle(dm, 'document.querySelectorAll("#np-crumbs .np-crumb").length === 2', 8000);
  rig.check(JSON.stringify((await levels()).crumbs) === JSON.stringify(['campaign', 'scene']),
            'a scene with no group shows a Place crumb: ' + JSON.stringify(await levels()));
  await dm.evaluate('switchScene(' + JSON.stringify(added.id) + '); 0', 120000);
  await lib.settle(dm, 'currentScene && currentScene.id === ' + JSON.stringify(added.id) + ' && fogCoverT === 0', 90000);
  const addedOpen = JSON.parse(await dm.evaluate('JSON.stringify({ open: currentScene && currentScene.id === ' + JSON.stringify(added.id) +
    ', name: currentScene && currentScene.name, cover: fogCoverT, map: !!mapOffscreen, video: !!(typeof videoEl !== "undefined" && videoEl), w: mapWidth, h: mapHeight })'));
  rig.check(addedOpen.open && addedOpen.cover === 0, 'the scene added on the world map did not open: ' + JSON.stringify(addedOpen));
  rig.check(await dm.evaluate('__rigFog(100, 100)') === 255, 'the scene added on the world map did not open fully fogged');

  // ── 9. It survives two maps, a backup and a restart ───────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  // The backup, mirrored: the file lists read as text, and the place notes through the zip's own payload.
  const lists = await dm.evaluate('({ list: sceneStore.listScenes.toString(), exp: doExport.toString(), res: restoreFromZipPath.toString() })');
  rig.check(/worldPos/.test(lists.list), 'sceneStore.listScenes drops the position, so a restart forgets the layout');
  rig.check(/worldPos/.test(lists.exp) && /notesPlacesAll/.test(lists.exp), 'the backup export carries no position or no place notes');
  rig.check((lists.res.match(/worldPos/g) || []).length >= 2, 'the restore does not rebuild the position into the scene and the library list');
  const trip = await dm.evaluate(`(() => {
    const raw = notesCampaignPayload(notesCampaignGet(), notesPlacesAll());
    const back = notesParsePlaces(raw);
    return { raw: !!raw, places: Object.entries(back.places), broken: back.broken };
  })()`);
  rig.check(trip.raw && !trip.broken && JSON.stringify(trip.places) === JSON.stringify([['The Watcherhouse', 'Mist off the river.']]),
            'the place notes do not survive the backup\'s own payload: ' + JSON.stringify(trip));
  rig.byEye('A real .zip export, restored into a fresh library, brings the layout and the place notes back. ' +
            'The save dialog is native, so the rig mirrors the field lists and cannot drive the file.');

  // Two maps: a move made with a scene in a column survives leaving two maps.
  await dm.evaluate('switchScene(' + JSON.stringify(id['Ground Floor']) + '); 0', 120000);
  await dm.waitFor('currentScene && currentScene.id === ' + JSON.stringify(id['Ground Floor']) + ' && fogCoverT === 0', 90000, 'the Ground Floor');
  await dm.evaluate('(async () => { currentScene.notes = "Ground floor notes"; await doAutoSave();' +
    ' await sceneStore.updateScene(' + JSON.stringify(id.Cellar) + ', r => { r.notes = "Cellar notes"; }); return 0; })()', 60000);
  await dm.evaluate('document.getElementById("btn-two-maps").click(); 0');
  await dm.waitFor('panesActive && panes.A.ready && panes.B.ready', 180000, 'both columns to come up');
  const paneA = await rig.pane('A');
  await paneA.waitFor('typeof currentScene !== "undefined" && currentScene && !!mapOffscreen', 60000, 'column A to hold a map');
  await dm.evaluate('worldMapShow(); 0');
  await lib.settle(dm, '!_wmAnim', 15000);
  await dm.evaluate('selectPane("A"); 0');
  await layout();
  const heldId = await dm.evaluate('panes.A.sceneId');
  const heldName = await dm.evaluate('allScenes.find(s => s.id === panes.A.sceneId).name');
  const p0 = await dm.evaluate('({ ...allScenes.find(s => s.id === panes.A.sceneId).worldPos })');
  await dm.evaluate('(() => { const c = __wmCard(' + JSON.stringify(heldName) + ').firstChild, p = __wmC(c); __wmDrag(c, { x: p.x + 30, y: p.y + 20 }); return 0; })()');
  const p1 = await dm.evaluate('({ ...allScenes.find(s => s.id === panes.A.sceneId).worldPos })');
  rig.check(p1.x !== p0.x || p1.y !== p0.y, 'the drag of a scene held by a column did not move it');
  const inColumn = await poll(() => paneA.evaluate('({ ...currentScene.worldPos })'), v => v && Math.abs(v.x - p1.x) < 0.001, 12000);
  rig.check(inColumn && Math.abs(inColumn.x - p1.x) < 0.001 && Math.abs(inColumn.y - p1.y) < 0.001,
            'the column holding the scene was not told its new position, so its next autosave reverts it: ' + JSON.stringify(inColumn));
  // Opening a scene with two maps on fills the selected column.
  const other = id.Cellar;
  await dm.evaluate('__wmDbl(__wmCard(allScenes.find(s => s.id === ' + JSON.stringify(other) + ').name).firstChild); 0');
  await lib.settle(dm, 'panes.A.sceneId === ' + JSON.stringify(other), 60000);
  rig.check(await dm.evaluate('panes.A.sceneId') === other, 'with two maps on, a double-click did not fill the selected column');
  await lib.settle(dm, 'paneSelectedScene() && paneSelectedScene().key === ' + JSON.stringify(other), 30000);
  await lib.hold(1500, 'a stale notes commit from the shell reaches the column within a second and a half of its report');
  // RED ON: the filled-text test removed from _npCommit's column branch (notesPanel.js) — 2026-10-09
  const colNotes = await paneA.evaluate('currentScene && currentScene.id === ' + JSON.stringify(other) + ' ? currentScene.notes : null');
  rig.check(colNotes === 'Cellar notes', 'the column filled from the map had its notes replaced by the last scene\'s: ' + JSON.stringify(colNotes));
  await dm.evaluate('worldMapHide(); 0');
  await dm.evaluate('document.querySelector(`.pane-col[data-pane="B"] .pane-close`).click(); 0');
  await dm.waitFor('!panesActive', 30000, 'closing a column to end two-map mode');
  const left = await poll(() => stored(heldId), v => v && v.pos && Math.abs(v.pos.x - p1.x) < 0.001, 15000);
  rig.check(left && left.pos && Math.abs(left.pos.x - p1.x) < 0.001 && Math.abs(left.pos.y - p1.y) < 0.001,
            'a move made with two maps on did not survive leaving them: ' + JSON.stringify([left, p1]));

  // The restart, last.
  const snap = JSON.parse(await dm.evaluate('JSON.stringify(allScenes.map(s => [s.name, s.group, s.worldPos]).sort())'));
  await dm.evaluate('doAutoSave()', 60000);
  dm = await rig.restart();
  await lib.installHelpers(dm);
  await lib.settle(dm, 'allScenes.length === ' + snap.length, 60000);
  const again = JSON.parse(await dm.evaluate('JSON.stringify(allScenes.map(s => [s.name, s.group, s.worldPos]).sort())'));
  rig.check(JSON.stringify(again) === JSON.stringify(snap), 'the layout is not what it was after a restart: ' + JSON.stringify([snap, again]));
  rig.check(await dm.evaluate('notesPlaceGet("The Watcherhouse")') === 'Mist off the river.', 'the place notes did not survive the restart');

  rig.byEye('The zoom out from the open scene, the zoom in on a double-click, the circles and outlines, and the ' +
            'ring on a picked scene read as one map the DM can steer. Look and motion are theirs to judge.');
};
