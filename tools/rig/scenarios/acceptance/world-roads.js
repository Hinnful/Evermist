'use strict';

// world-roads.js — ROADS ON THE WORLD MAP.
//
// THE GOAL OF THIS FEATURE: the DM draws the road between two towns, marks an exit, and files an
// encounter that happens on the way, so those notes have a home. A road joins a scene with no place, a
// place, or nothing. A road end sticks to what it was drawn on and goes with it. A scene dropped on a road
// belongs to the road and is ungrouped in the library.
//
// THE CRITERIA ARE THIS HEADER, one per line of the spec's Definition of Done
// (.claude/private/specs/world-map-roads.md).
//
//   1. The Road tool on the world bar draws as Figma's pen does: a press puts a point and shows it, dragging out
//      of it bends the line through it, a line follows the pointer, Shift locks 45 degrees, and the scene or place
//      an end will stick to is ringed before the press. Enter, double-click or Esc finishes; a path of one point
//      makes nothing. A finished road stays picked with its points open and no name prompt. A press on the open
//      end of a road picks it up again.
//   2. An end drawn on a scene or a place sticks to it; moving or reshaping that thing moves the end.
//   3. Deleting a scene or a place leaves an open end; undoing the delete reattaches it.
//   4. A road is picked, renamed and deleted like a place.
//   5. A road's notes open in the left panel, survive a rename, and open for a scene on the road.
//   6. A scene dropped on a road snaps onto the line, belongs to the road and is ungrouped in the library,
//      after a restart and with two maps on. A scene dropped where the road runs inside a place belongs to
//      the place. A scene dragged off the line leaves the road.
//   7. Undo, backup and restore carry roads, their notes and their scenes. A restore into a library that
//      already holds scenes and places keeps every road attached to the restored copies.
//   8. The previous release opens this data safely: roads sit in keys of their own and no scene record
//      gains a field.
//   9. (the look is the DM's eye: dashed line on a dark casing, blue when picked, a black diamond for a
//      road's scene zoomed out - marked rig.byEye at the end, with the computed styles it can read)
//  10. The TV shows no road.
//  11. Ctrl+drag bends a road segment, with curve handles and Escape's levels as on a room wall.
//
// ⚠ THE BACKUP IN 7 IS RESTORED FROM A PREPARED FILE: the save dialog is native (see the rig skill), so the
// zip is built by the app's own archiver from the payload doExport builds, and restoreFromZipPath runs
// untouched. doExport's own source is read for the road fields.
// ⚠ 6's RESTART AND TWO MAPS RUN LAST, since both end the page the rest of this file drives.
// ⚠ NEVER PASS AN ASYNC EXPRESSION TO waitFor; the store is read from Node with lib.poll.

const fs = require('fs');
const path = require('path');
const lib = require('../../lib');

const MAP_W = 900, MAP_H = 600;

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
globalThis.__wmCam = (cx, cy, z) => { _wmCam = { cx, cy, z }; _wmApplyCam(); };
globalThis.__wmS = (x, y) => { const v = _wmView(); return { x: v.w / 2 + (x - _wmCam.cx) * _wmCam.z, y: v.h / 2 + (y - _wmCam.cy) * _wmCam.z }; };
globalThis.__wmGround = (type, p, o) => __wmE(type, document.getElementById('wm'), p, o);
globalThis.__wmEnter = text => {
  const el = _wmEditing;
  el.textContent = text;
  el.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true }));
};
globalThis.__wmDbl = el => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
// The road tool: a click per world point, then Enter.
globalThis.__wrClick = w => { const p = __wmS(w.x, w.y); __wmGround('mousedown', p); __wmE('mouseup', window, p); };
globalThis.__wrDraw = (pts, finish) => {
  if (_wmTool !== 'road') document.getElementById('wm-road').click();
  for (const w of pts) __wrClick(w);
  if (finish !== false) __rigKey('Enter');
};
// The road's own line: where a fraction of it lies, in the world and on screen.
globalThis.__wrAt = (uid, t) => wrPointAt(wrSamples(worldRoadByUid(uid)), t);
globalThis.__wrScreen = (uid, t) => { const w = __wrAt(uid, t); return __wmS(w.x, w.y); };
globalThis.__wrHit = uid => document.querySelector('.roadhit[data-uid="' + uid + '"]');
globalThis.__wrPress = (uid, t, o) => { const p = __wrScreen(uid, t); __wmE('mousedown', __wrHit(uid), p, o); __wmE('mouseup', window, p, o); };
globalThis.__wrDist = (uid, w) => wrNearest(wrSamples(worldRoadByUid(uid)), w).d;
globalThis.__wrName = (uid, text) => { _wmRenameStart(_wmEls.get('r' + uid), 'road', uid); __wmEnter(text); };
globalThis.__wrLastUid = () => worldRoadRecords()[worldRoadRecords().length - 1].uid;
globalThis.__wrMove = (w, o) => { const p = __wmS(w.x, w.y); __wmE('mousemove', window, p, o); };
globalThis.__wrDragFrom = (w, to, o) => {
  if (_wmTool !== 'road') document.getElementById('wm-road').click();
  const a = __wmS(w.x, w.y), b = __wmS(to.x, to.y);
  __wmGround('mousedown', a, o);
  __wmE('mousemove', window, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, o);
  __wmE('mousemove', window, b, o);
  __wmE('mouseup', window, b, o);
};
globalThis.__wrScene = n => allScenes.find(s => s.name === n);
globalThis.__wrLoose = n => { const s = __wrScene(n); return { x: s.worldPos.x, y: s.worldPos.y, g: sanitizeGroupName(s.group) }; };
`;

module.exports = async function worldRoadsFeature(rig) {
  let dm = rig.dm;

  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H });
  const expr = await rig.fixtures.asFileExpr(dm, map);
  const named = n => '(f => new File([f], ' + JSON.stringify(n) + ', { type: f.type }))(' + expr + ')';
  const importAs = async name => {
    await dm.evaluate('createNewScene(' + named(name + '.mp4') + ')', 120000);
    await dm.waitFor('currentScene && currentScene.name === ' + JSON.stringify(name), 120000, 'the import of ' + name);
    return dm.evaluate('currentScene.id');
  };
  const poll = async (read, ok, ms) => {
    let last;
    const got = await lib.poll(async () => { last = await read(); return ok(last) ? { v: last } : null; }, ms || 12000, 150);
    return got ? got.v : last;
  };
  const tvSeen = async tv => tv.evaluate('JSON.stringify(__got)');

  const ID = {};
  for (const n of ['Nanlet', 'Vallaki', 'Ambush at the Ford', 'Barn', 'Well']) ID[n] = await importAs(n);
  // Where everything starts: two towns apart, a scene to drop on a road, and a place of two scenes.
  const START = { Nanlet: { x: 0, y: 0 }, Vallaki: { x: 900, y: 0 }, 'Ambush at the Ford': { x: 700, y: 330 }, Barn: { x: 0, y: 600 }, Well: { x: 140, y: 600 } };
  await dm.evaluate('(async () => { const at = ' + JSON.stringify(START) + ', id = ' + JSON.stringify(ID) +
    '; for (const n of Object.keys(at)) await worldSceneSet(id[n], { worldPos: at[n] }); return 0; })()', 30000);
  await dm.evaluate('(' + JSON.stringify([ID.Barn, ID.Well]) + ').forEach(i => worldSceneSet(i, { group: "Hamlet" })); 0');
  await lib.installHelpers(dm);
  await dm.evaluate(PAGE);
  await dm.evaluate('dockOpen(null); 0');
  const tv = await rig.player();
  await tv.evaluate('globalThis.__got = []; addEventListener("message", e => __got.push((e.data && e.data.type) || typeof e.data)); 0');

  await dm.evaluate('worldMapShow(); 0');
  await lib.settle(dm, '!_wmAnim', 20000);
  await dm.evaluate('__wmCam(450, 330, 0.9); 0');
  rig.check(await dm.evaluate('!!worldPlaceByName("Hamlet") && worldRoadRecords().length === 0'),
            'the map did not open with the Hamlet place and no roads');

  // ── 1. The Road tool draws by clicks ────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(await dm.evaluate('(b => !!b && getComputedStyle(b).display !== "none")(document.getElementById("wm-road"))'),
            'the world bar has no Road button');
  await dm.evaluate('document.getElementById("wm-road").click(); 0');
  rig.check(await dm.evaluate('_wmTool === "road" && document.getElementById("wm-road").classList.contains("active")'),
            'the Road button did not arm the road tool');
  await dm.evaluate('__wrClick({ x: 300, y: 200 }); __rigKey("Escape"); 0');
  rig.check(await dm.evaluate('worldRoadRecords().length === 0 && !_wmRoadPath && _wmTool === "road"'),
            'Escape did not drop the path and keep the tool');
  await dm.evaluate('__wrClick({ x: 300, y: 200 }); __rigKey("Enter"); 0');
  rig.check(await dm.evaluate('worldRoadRecords().length === 0'), 'a path of one point made a road');
  await dm.evaluate('__wrDraw([{ x: 0, y: 0 }, { x: 450, y: 120 }, { x: 900, y: 0 }]); 0');
  const r1 = JSON.parse(await dm.evaluate('JSON.stringify((r => ({ uid: r.uid, id: r.id, n: r.vertices.length, ends: r.ends, name: r.name, sel: worldMapSel.road === r.uid, tool: _wmTool, editing: !!_wmEditing }))(worldRoadRecords()[0]))'));
  rig.check(r1.n === 3, 'the road has ' + r1.n + ' points, not the three clicked');
  rig.check(r1.ends[0].kind === 'scene' && r1.ends[0].ref === ID.Nanlet && r1.ends[1].kind === 'scene' && r1.ends[1].ref === ID.Vallaki,
            'the ends did not stick to the two scenes they were drawn on: ' + JSON.stringify(r1.ends));
  rig.check(r1.sel && r1.tool === 'select' && !r1.editing, 'a finished road is not picked with the tool put back and no name prompt: ' + JSON.stringify(r1));
  rig.check(await dm.evaluate('shapeEditMode && selectedPolygonId === worldRoadRecords()[0].id'), 'a finished road does not stay open at its points');
  await dm.evaluate('__wrName(' + JSON.stringify(r1.uid) + ', "Svalich Road"); 0');
  rig.check(await dm.evaluate('worldRoadRecords()[0].name') === 'Svalich Road', 'the typed name did not become the road\'s name');
  rig.check(await dm.evaluate('(l => !!l && /roadcase/.test(l.previousElementSibling.getAttribute("class")))(document.querySelector(".road"))'),
            'the road is not a line on its own casing');
  const r1uid = r1.uid;

  // The pen: points shown, a curve dragged out of a point, Shift, the halo, Esc, picking an end up again.
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('document.getElementById("wm-road").click(); __wrClick({ x: 300, y: 450 }); 0');
  rig.check(await dm.evaluate('_wmRoadPath && _wmRoadPath.pts.length === 1'), 'a press did not put the first point');
  await dm.evaluate('__wrMove({ x: 360, y: 450 }, {}); 0');
  const hov = await dm.evaluate('_wmRoadHover && { x: _wmRoadHover.p.x, y: _wmRoadHover.p.y }');
  rig.check(hov && Math.abs(hov.y - 450) < 2, 'the line did not follow the pointer from the last point');
  await dm.evaluate('__wrMove({ x: 360, y: 420 }, { shiftKey: true }); 0');
  const locked = await dm.evaluate('({ p: _wmRoadHover.p, a: _wmRoadPath.pts[0], tol: 2 / _wmCam.z })');
  const ldx = Math.abs(locked.p.x - locked.a.x), ldy = Math.abs(locked.p.y - locked.a.y);
  rig.check(ldy < 1e-6 || ldx < 1e-6 || Math.abs(ldx - ldy) < 1e-6,
            'Shift did not lock the line to 45 degrees: ' + JSON.stringify(locked));
  await dm.evaluate('__wrMove({ x: 0, y: 0 }, {}); 0');
  rig.check(await dm.evaluate('!!_wmRoadHover.at && _wmRoadHover.at.kind === "scene" && _wmRoadHover.at.ref === ' + JSON.stringify(ID.Nanlet)),
            'hovering a scene with no place does not mark it as what the end will stick to');
  await dm.evaluate('__wrMove({ x: 70, y: 600 }, {}); 0');
  rig.check(await dm.evaluate('!!_wmRoadHover.at && _wmRoadHover.at.kind === "place"'), 'hovering inside a place does not mark the place');
  await dm.evaluate('__rigKey("Escape"); 0');
  rig.check(await dm.evaluate('worldRoadRecords().length === 1 && !_wmRoadPath'), 'Esc on a path of one point made a road or kept the path');
  // A drag out of a point bends the line through it.
  await dm.evaluate('__wrClick({ x: 300, y: 450 }); __wrDragFrom({ x: 450, y: 520 }, { x: 520, y: 480 }); __wrClick({ x: 600, y: 450 }); 0');
  rig.check(await dm.evaluate('_wmRoadPath.pts.length === 3 && !!_wmRoadPath.pts[1].hh && _wmRoadPath.pts[1].hh.ox === -_wmRoadPath.pts[1].hh.ix'),
            'dragging out of a point did not give it a curve with the two sides mirrored');
  await dm.evaluate('__rigKey("Escape"); 0');
  const pen = JSON.parse(await dm.evaluate('JSON.stringify((r => ({ n: r.vertices.length, h: (r.handles || []).filter(Boolean).length, sel: selectedPolygonId === r.id && shapeEditMode, naming: !!_wmEditing, uid: r.uid }))(worldRoadRecords()[worldRoadRecords().length - 1]))'));
  rig.check(await dm.evaluate('worldRoadRecords().length') === 2 && pen.n === 3 && pen.h === 1 && pen.sel && !pen.naming,
            'Esc did not finish the road with its curve, picked and open, with no name prompt: ' + JSON.stringify(pen));
  // Pressing on the open road's own line keeps it picked, and does not put it down.
  await dm.evaluate('__wrPress(' + JSON.stringify(pen.uid) + ', 0.5); 0');
  rig.check(await dm.evaluate('selectedPolygonId === worldRoadByUid(' + JSON.stringify(pen.uid) + ').id && shapeEditMode'),
            'a press on the line of an open road put the road down');
  // Picking up an open end: the road gets longer from that end.
  const was = JSON.parse(await dm.evaluate('JSON.stringify(worldRoadByUid(' + JSON.stringify(pen.uid) + ').vertices)'));
  await dm.evaluate('__rigKey("Escape"); __rigKey("Escape"); 0');
  await dm.evaluate('document.getElementById("wm-road").click(); __wrMove(' + JSON.stringify(was[0]) + ', {}); 0');
  rig.check(await dm.evaluate('!!_wmRoadHover.resume'), 'hovering the open end of a road does not offer to pick it up');
  await dm.evaluate('__wrClick(' + JSON.stringify(was[0]) + '); __wrClick({ x: 200, y: 400 }); __rigKey("Enter"); 0');
  const after = JSON.parse(await dm.evaluate('JSON.stringify({ v: worldRoadByUid(' + JSON.stringify(pen.uid) + ').vertices, n: worldRoadRecords().length })'));
  rig.check(after.n === 2 && after.v.length === 4 && Math.hypot(after.v[3].x - 200, after.v[3].y - 400) < 1.5 && Math.hypot(after.v[0].x - was[2].x, after.v[0].y - was[2].y) < 1.5,
            'picking up the open end did not extend the same road from that end: ' + JSON.stringify([was, after.v]));
  await dm.evaluate('worldUndo(); 0');
  rig.check(await dm.evaluate('worldRoadByUid(' + JSON.stringify(pen.uid) + ').vertices.length') === 3, 'Ctrl+Z did not undo the extension');
  await dm.evaluate('worldUndo(); 0');
  rig.check(await dm.evaluate('worldRoadRecords().length') === 1, 'Ctrl+Z did not undo the drawn road');
  await dm.evaluate('worldMapSelect({ sceneId: null, place: "", road: ' + JSON.stringify(r1uid) + ' }); 0');

  // ── 4. Pick, rename, delete ─────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('__wmGround("mousedown", { x: 10, y: 10 }); __wmE("mouseup", window, { x: 10, y: 10 }); 0');
  rig.check(await dm.evaluate('!worldMapSel.road && !document.querySelector(".road.sel")'), 'a click on the ground did not put the road down');
  await dm.evaluate('__wrPress(' + JSON.stringify(r1uid) + ', 0.7); 0');
  rig.check(await dm.evaluate('worldMapSel.road === ' + JSON.stringify(r1uid) + ' && !!document.querySelector(".road.sel")'), 'a click on the line did not pick the road');
  const blue = await dm.evaluate('(p => { p.style.color = "var(--b-icon)"; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return { want: c, got: getComputedStyle(document.querySelector(".road.sel")).stroke }; })(document.createElement("i"))');
  rig.check(blue.got === blue.want, 'a picked road is not blue: ' + JSON.stringify(blue));
  await dm.evaluate('__rigKey("Delete"); 0');
  rig.check(await dm.evaluate('worldRoadRecords().length === 0'), 'Delete did not remove the picked road');
  await dm.evaluate('worldUndo(); 0');
  rig.check(await dm.evaluate('worldRoadRecords().length === 1 && worldRoadRecords()[0].uid === ' + JSON.stringify(r1uid)),
            'Ctrl+Z did not bring the deleted road back under its own key');
  // The menu's rename, as a place has.
  await dm.evaluate('(() => { const p = __wrScreen(' + JSON.stringify(r1uid) + ', 0.7); __wmE("contextmenu", __wrHit(' + JSON.stringify(r1uid) + '), p); return 0; })()');
  rig.check(await dm.evaluate('[...document.querySelectorAll(".wm-menu .sm-mi")].map(b => b.textContent).join("|")') === 'Rename|Edit points|Delete road',
            'the road\'s right-click menu is not Rename, Edit points, Delete road');
  await dm.evaluate('document.querySelector(".wm-menu .sm-mi").click(); 0');
  await dm.evaluate('__wmEnter("Old Svalich Road"); 0');
  rig.check(await dm.evaluate('worldRoadByUid(' + JSON.stringify(r1uid) + ').name') === 'Old Svalich Road', 'the menu\'s Rename did not rename the road');

  // ── 5. Notes ────────────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const panel = () => dm.evaluate(`(() => ({
    crumbs: [...document.querySelectorAll('#np-crumbs .np-crumb')].map(b => b.dataset.level),
    labels: [...document.querySelectorAll('#np-crumbs .np-crumb')].map(b => b.textContent),
    field: document.getElementById('np-field').value,
  }))()`);
  await lib.settle(dm, 'document.querySelectorAll("#np-crumbs .np-crumb").length === 2', 8000);
  const p0 = await panel();
  rig.check(JSON.stringify(p0.crumbs) === JSON.stringify(['campaign', 'road']) && p0.labels[1] === 'Old Svalich Road',
            'with a road picked the panel does not show Campaign and the road: ' + JSON.stringify(p0));
  await dm.evaluate('(() => { const f = document.getElementById("np-field"); f.value = "Wolves at dusk."; f.dispatchEvent(new Event("input", { bubbles: true })); notesPanelSettle(); return 0; })()');
  rig.check(await dm.evaluate('notesRoadGet(' + JSON.stringify(r1uid) + ')') === 'Wolves at dusk.', 'the road\'s notes did not reach the store');
  await dm.evaluate('__wmDbl(__wrHit(' + JSON.stringify(r1uid) + ')); __rigKey("Escape"); __rigKey("Escape"); 0');
  await dm.evaluate('_wmRenameStart(_wmEls.get("r" + ' + JSON.stringify(r1uid) + '), "road", ' + JSON.stringify(r1uid) + '); __wmEnter("The Old Road"); 0');
  rig.check(await dm.evaluate('worldRoadByUid(' + JSON.stringify(r1uid) + ').name') === 'The Old Road', 'the rename did not take');
  rig.check(await dm.evaluate('notesRoadGet(' + JSON.stringify(r1uid) + ')') === 'Wolves at dusk.', 'a rename lost the road\'s notes');
  await dm.evaluate('__wrPress(' + JSON.stringify(r1uid) + ', 0.7); 0');
  await lib.settle(dm, 'document.getElementById("np-field").value === "Wolves at dusk."', 8000);
  rig.check((await panel()).field === 'Wolves at dusk.', 'after the rename the panel does not show the notes: ' + JSON.stringify(await panel()));

  // ── 6. A scene on a road ────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  // First where the road runs inside a place: the place keeps the scene.
  await dm.evaluate('__wrDraw([{ x: 70, y: 600 }, { x: 300, y: 660 }, { x: 400, y: 700 }]); __wrName(__wrLastUid(), "Hamlet Lane"); 0');
  const r2uid = await dm.evaluate('worldRoadRecords().find(r => r.name === "Hamlet Lane").uid');
  const r2 = JSON.parse(await dm.evaluate('JSON.stringify(worldRoadByUid(' + JSON.stringify(r2uid) + ').ends)'));
  rig.check(r2[0].kind === 'place' && r2[0].ref === 'Hamlet' && Number.isFinite(r2[0].dx) && r2[1].kind === null,
            'a road drawn from inside a place to bare ground does not stick to the place at its first end: ' + JSON.stringify(r2));
  // A road that ends in a place is drawn only as far as the place's outline, and enters it.
  const cut = JSON.parse(await dm.evaluate('JSON.stringify((r => ({ v: worldRoadVisible(r), whole: r.vertices[0], d: wrNearestOnRing(wmOutline(worldPlaceByName("Hamlet")), worldRoadVisible(r)[0]).d }))(worldRoadByUid(' + JSON.stringify(r2uid) + ')))'));
  rig.check(cut.v && cut.d < 1.5 && Math.hypot(cut.v[0].x - cut.whole.x, cut.v[0].y - cut.whole.y) > 5,
            'a road ending in a place is not cut at the outline of the place: ' + JSON.stringify(cut));
  rig.check(await dm.evaluate('!!document.querySelector(".road") && [...document.querySelectorAll(".road")].some(l => /^M/.test(l.getAttribute("d")) && !/C/.test(l.getAttribute("d")))'),
            'the drawn line of a road that enters a place is not the cut line');
  const AMB = 'Ambush at the Ford';
  const dropOn = async (name, uid, t) => {
    await dm.evaluate('(() => { const c = __wmCard(' + JSON.stringify(name) + ').firstChild, p = __wrScreen(' + JSON.stringify(uid) + ', ' + t + '); __wmDrag(c, p); return 0; })()');
  };
  await dropOn(AMB, r2uid, 0.12);
  const inPlace = await dm.evaluate('({ road: !!worldRoadOfScene(' + JSON.stringify(ID[AMB]) + '), s: __wrLoose(' + JSON.stringify(AMB) + ') })');
  rig.check(!inPlace.road && inPlace.s.g === 'Hamlet', 'a scene dropped where a road runs inside a place did not belong to the place: ' + JSON.stringify(inPlace));
  await dropOn(AMB, r1uid, 0.25);
  const onRoad = JSON.parse(await dm.evaluate('JSON.stringify((() => { const s = __wrScene(' + JSON.stringify(AMB) + '), r = worldRoadOfScene(s.id); return { uid: r && r.uid, g: sanitizeGroupName(s.group), pos: s.worldPos, d: r && __wrDist(r.uid, s.worldPos), card: document.querySelector(".wm-card.onroad .wm-nm").textContent }; })())'));
  rig.check(onRoad.uid === r1uid && onRoad.g === '' && onRoad.d < 1.5,
            'a scene dropped on a road did not snap onto its line, belong to it and leave its group: ' + JSON.stringify(onRoad));
  rig.check(onRoad.card === AMB, 'the road\'s scene is not drawn as a road scene');
  await dm.evaluate('__wmE("mousedown", __wmCard(' + JSON.stringify(AMB) + ').firstChild, __wmC(__wmCard(' + JSON.stringify(AMB) + ').firstChild)); __wmE("mouseup", window, __wmC(__wmCard(' + JSON.stringify(AMB) + ').firstChild)); 0');
  await lib.settle(dm, 'document.querySelectorAll("#np-crumbs .np-crumb").length === 2', 8000);
  const sceneOnRoad = await panel();
  rig.check(JSON.stringify(sceneOnRoad.crumbs) === JSON.stringify(['campaign', 'road']) && sceneOnRoad.field === 'Wolves at dusk.',
            'picking a scene on a road does not show the road\'s notes: ' + JSON.stringify(sceneOnRoad));
  // Zoomed out it is a black diamond on the line with no name beside it.
  await dm.evaluate('__wmCam(450, 330, 0.3); 0');
  await lib.settle(dm, 'document.getAnimations().length === 0', 5000);
  const far = await dm.evaluate(`(() => { const m = document.querySelector('.wm-lm.stn'), d = m && m.querySelector('.wm-dot'), l = m && m.querySelector('.wm-lbl');
    return m && { op: getComputedStyle(m).opacity, bg: getComputedStyle(d).backgroundColor, lbl: getComputedStyle(l).display, card: getComputedStyle(__wmCard(${JSON.stringify(AMB)})).opacity }; })()`);
  rig.check(far && far.op === '1' && far.bg === 'rgb(11, 11, 13)' && far.lbl === 'none' && far.card === '0',
            'zoomed out, a road\'s scene is not a black diamond with no name: ' + JSON.stringify(far));
  const casing = await dm.evaluate('(l => ({ w: getComputedStyle(l).strokeWidth, dash: getComputedStyle(l).strokeDasharray, vec: l.getAttribute("vector-effect"), cw: getComputedStyle(l.previousElementSibling).strokeWidth }))(document.querySelector(".road"))');
  rig.check(casing.vec === 'non-scaling-stroke' && parseFloat(casing.w) >= 3 && Math.abs(parseFloat(casing.cw) - parseFloat(casing.w) - 4) < 1e-6 && casing.dash !== 'none', 'the road is not a dashed line of at least 3px on a casing 4px wider, far out: ' + JSON.stringify(casing));
  await dm.evaluate('__wmCam(450, 330, 0.9); 0');
  // Off the line it leaves the road.
  await dm.evaluate('(() => { const c = __wmCard(' + JSON.stringify(AMB) + ').firstChild, p = __wmS(700, 420); __wmDrag(c, p); return 0; })()');
  rig.check(await dm.evaluate('!worldRoadOfScene(' + JSON.stringify(ID[AMB]) + ') && !document.querySelector(".wm-lm.stn")'),
            'a scene dragged off its road is still on it');
  await dropOn(AMB, r1uid, 0.25);
  rig.check(await dm.evaluate('!!worldRoadOfScene(' + JSON.stringify(ID[AMB]) + ')'), 'the scene did not go back onto the road');

  // ── 2. Ends follow what they stick to ───────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const end = (uid, k) => dm.evaluate('(r => { const v = r.vertices[' + k + ' ? r.vertices.length - 1 : 0]; return { x: v.x, y: v.y }; })(worldRoadByUid(' + JSON.stringify(uid) + '))');
  const near = (a, b, tol) => Math.hypot(a.x - b.x, a.y - b.y) <= (tol || 1.5);
  const nan0 = await end(r1uid, 0);
  rig.check(near(nan0, START.Nanlet), 'the road\'s first end is not on Nanlet\'s centre: ' + JSON.stringify(nan0));
  await dm.evaluate('(() => { const c = __wmCard("Nanlet").firstChild, p = __wmC(c); __wmDrag(c, { x: p.x - 60, y: p.y + 54 }); return 0; })()');
  // RED ON: the picked-road test removed from `dragged` in worldRoadsCommit (worldRoads.js) — 2026-10-09
  const nan1 = await end(r1uid, 0), nanScene = await dm.evaluate('__wrLoose("Nanlet")');
  rig.check(near(nan1, nanScene) && Math.hypot(nan1.x - nan0.x, nan1.y - nan0.y) > 30,
            'dragging a scene did not take the road\'s end with it: ' + JSON.stringify([nan0, nan1, nanScene]));
  const amb1 = await dm.evaluate('__wrLoose(' + JSON.stringify(AMB) + ')');
  rig.check(await dm.evaluate('__wrDist(' + JSON.stringify(r1uid) + ', ' + JSON.stringify(amb1) + ')') < 1.5,
            'the scene on the road did not stay on the line when its end moved');
  // The place.
  const h0 = await end(r2uid, 0);
  await dm.evaluate('__wmCam(70, 600, 0.5); (() => { const h = __wmHead("Hamlet"), p = __wmC(h); __wmDrag(h, { x: p.x + 40, y: p.y + 30 }); return 0; })()');
  const h1 = await end(r2uid, 0), z5 = await dm.evaluate('_wmCam.z');
  rig.check(Math.abs((h1.x - h0.x) - 40 / z5) < 3 && Math.abs((h1.y - h0.y) - 30 / z5) < 3,
            'carrying a place did not carry the road end that sticks to it: ' + JSON.stringify([h0, h1, z5]));
  // A reshape that leaves the spot outside the place.
  await dm.evaluate('(() => { const rec = worldPlaceByName("Hamlet"), b = wmPolyBounds(rec.vertices); rec.vertices = wmRectShape(b.x, b.y, b.x + 120, b.y + b.h); worldPlaceCommit(); return 0; })()');
  // RED ON: the picked-road test removed from `dragged` in worldRoadsCommit (worldRoads.js) — 2026-10-09
  const h2 = await end(r2uid, 0);
  rig.check(await dm.evaluate('(o => wmPointInPoly({ x: ' + h2.x + ', y: ' + h2.y + ' }, o) || wrNearestOnRing(o, { x: ' + h2.x + ', y: ' + h2.y + ' }).d < 1.5)(wmOutline(worldPlaceByName("Hamlet")))'),
            'a reshape left the road end outside its place: ' + JSON.stringify(h2));
  await dm.evaluate('__wmCam(450, 330, 0.9); 0');

  // ── 11. Bends, handles, Escape's levels ─────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  // ⚠ BENT AWAY FROM THE CORNER'S TURN: bowed the other way, the corner flattens past the turn a circle needs.
  await dm.evaluate('__wrPress(' + JSON.stringify(r1uid) + ', 0.7, { ctrlKey: true }); 0');
  rig.check(await dm.evaluate('shapeEditMode && selectedPolygonId === worldRoadByUid(' + JSON.stringify(r1uid) + ').id'), 'Ctrl+click did not open the road\'s points');
  const bend0 = await dm.evaluate('worldRoadByUid(' + JSON.stringify(r1uid) + ').vertices.length');
  const mid = await dm.evaluate('(() => { const r = worldRoadByUid(' + JSON.stringify(r1uid) + '), a = r.vertices[1], b = r.vertices[2]; return __wmS((a.x + b.x) / 2, (a.y + b.y) / 2); })()');
  await dm.evaluate('(() => { const m = ' + JSON.stringify(mid) + ', hit = __wrHit(' + JSON.stringify(r1uid) + '), o = { ctrlKey: true };' +
    ' __wmE("mousedown", hit, m, o); __wmE("mousemove", window, { x: m.x, y: m.y - 30 }, o); __wmE("mousemove", window, { x: m.x, y: m.y - 60 }, o); __wmE("mouseup", window, { x: m.x, y: m.y - 60 }, o); return 0; })()');
  const bent = JSON.parse(await dm.evaluate('JSON.stringify((r => ({ h: (r.handles || []).filter(Boolean).length, samples: wrSamples(r).length, d: r.scenes.map(s => __wrDist(r.uid, __wrScene(' + JSON.stringify(AMB) + ').worldPos)) }))(worldRoadByUid(' + JSON.stringify(r1uid) + ')))'));
  rig.check(bent.h === 2 && bent.samples > 6, 'Ctrl+drag on a segment did not bend it with two curve handles: ' + JSON.stringify(bent));
  rig.check(bent.d.every(d => d < 1.5), 'the scene on the road left the line when the road bent: ' + JSON.stringify(bent));
  rig.check(await dm.evaluate('worldRoadByUid(' + JSON.stringify(r1uid) + ').vertices.length') === bend0, 'bending a segment added or dropped a point');
  // A corner is picked, then Escape climbs one level at a time.
  const corner = await dm.evaluate('(() => { const v = worldRoadByUid(' + JSON.stringify(r1uid) + ').vertices[1]; return __wmS(v.x, v.y); })()');
  await dm.evaluate('(() => { const p = ' + JSON.stringify(corner) + '; __wmE("mousedown", __wrHit(' + JSON.stringify(r1uid) + '), p); __wmE("mouseup", window, p); return 0; })()');
  rig.check(await dm.evaluate('selectedVertexIndex === 1'), 'a click on the road\'s corner did not pick it');
  // The corner's circle rounds it, as on a place; the ends have none.
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('__wmE("mousemove", window, ' + JSON.stringify(corner) + '); 0');
  const circle = JSON.parse(await dm.evaluate('JSON.stringify(_wmWithCamera(() => cornerCircles(worldRoadByUid(' + JSON.stringify(r1uid) + ')).map(h => ({ x: h.x, y: h.y, dx: h.dir.x, dy: h.dir.y, flat: h.flat }))))'));
  rig.check(circle.length === 1 && circle[0].flat === 1, 'a road\'s picked corner shows one rounding circle, and its ends none: ' + JSON.stringify(circle));
  const cs = await dm.evaluate('(c => __wmS(c.x, c.y))(' + JSON.stringify(circle[0]) + ')');
  const to = { x: cs.x + circle[0].dx * 40 * await dm.evaluate('_wmCam.z'), y: cs.y + circle[0].dy * 40 * await dm.evaluate('_wmCam.z') };
  await dm.evaluate('(() => { const a = ' + JSON.stringify(cs) + ', b = ' + JSON.stringify(to) + ';' +
    ' __wmGround("mousedown", a); __wmE("mousemove", window, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); __wmE("mousemove", window, b); __wmE("mouseup", window, b); return 0; })()');
  const rounded = JSON.parse(await dm.evaluate('JSON.stringify((r => ({ radii: r.cornerRadii, v: r.vertices[1], d: wrNearest(wrSamples(r), r.vertices[1]).d, sel: selectedPolygonId === r.id }))(worldRoadByUid(' + JSON.stringify(r1uid) + ')))'));
  rig.check(rounded.radii && rounded.radii[1] > 0 && rounded.radii[0] == null && rounded.radii[2] == null && rounded.d > 1 && rounded.sel,
            'dragging the circle did not round the corner of the road: ' + JSON.stringify(rounded));
  await dm.evaluate('__rigKey("Escape"); 0');
  rig.check(await dm.evaluate('selectedVertexIndex === -1 && shapeEditMode'), 'the first Escape did not drop the corner and keep the points open');
  await dm.evaluate('__rigKey("Escape"); 0');
  rig.check(await dm.evaluate('!shapeEditMode && selectedPolygonId === worldRoadByUid(' + JSON.stringify(r1uid) + ').id'), 'the second Escape did not close the points and keep the road');
  await dm.evaluate('__rigKey("Escape"); 0');
  rig.check(await dm.evaluate('selectedPolygonId === null && worldMapOpen'), 'the third Escape did not put the road down');
  // A road cannot be cut below two points.
  const two = await dm.evaluate('(() => { const r = worldRoadByUid(' + JSON.stringify(r2uid) + '); return r.vertices.length; })()');
  rig.check(two === 3, 'the second road does not have its three points');

  // ── 3. Deleting a scene or a place ──────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const before = await end(r1uid, 1);
  await dm.evaluate('deleteScenesWithUndo([' + JSON.stringify(ID.Vallaki) + ']); 0');
  rig.check(await dm.evaluate('worldRoadByUid(' + JSON.stringify(r1uid) + ').ends[1].kind') === 'scene', 'the end opened the moment the scene was removed, before the toast could undo it');
  await dm.evaluate('undoDelete(); 0');
  rig.check(await dm.evaluate('worldRoadByUid(' + JSON.stringify(r1uid) + ').ends[1].ref') === ID.Vallaki && near(await end(r1uid, 1), before),
            'undoing a scene\'s delete did not leave the road\'s end on it');
  await dm.evaluate('deleteScenesWithUndo([' + JSON.stringify(ID.Vallaki) + ']); commitPendingDelete(); 0');
  const gone = JSON.parse(await dm.evaluate('JSON.stringify(worldRoadByUid(' + JSON.stringify(r1uid) + ').ends)'));
  rig.check(gone[1].kind === null && gone[0].kind === 'scene', 'deleting a scene did not leave an open end where it was: ' + JSON.stringify(gone));
  rig.check(near(await end(r1uid, 1), before), 'the open end moved off the spot the scene held');
  // A place, through the library's own delete, which asks nothing.
  await dm.evaluate('deleteGroup({ name: "Hamlet", scenes: allScenes.filter(s => sanitizeGroupName(s.group) === "Hamlet") }); 0');
  await lib.settle(dm, '!worldPlaceByName("Hamlet")', 8000);
  rig.check(await dm.evaluate('worldRoadByUid(' + JSON.stringify(r2uid) + ').ends[0].kind') === null, 'deleting a place did not leave its road with an open end');
  await dm.evaluate('worldUndo(); 0');
  const back = JSON.parse(await dm.evaluate('JSON.stringify(worldRoadByUid(' + JSON.stringify(r2uid) + ').ends[0])'));
  rig.check(back.kind === 'place' && back.ref === 'Hamlet' && !!(await dm.evaluate('!!worldPlaceByName("Hamlet")')),
            'undoing the place\'s delete did not reattach the road: ' + JSON.stringify(back));

  // ── 7. Undo, then backup and restore ────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('__wrDraw([{ x: 300, y: 500 }, { x: 420, y: 540 }]); __wrName(__wrLastUid(), "Short cut"); 0');
  rig.check(await dm.evaluate('worldRoadRecords().length === 3'), 'the third road was not drawn');
  await dm.evaluate('__rigKey("KeyZ", { ctrlKey: true }); 0');
  rig.check(await dm.evaluate('worldRoadRecords().length === 2'), 'Ctrl+Z did not undo drawing a road');
  await dm.evaluate('__rigKey("KeyY", { ctrlKey: true }); 0');
  rig.check(await dm.evaluate('worldRoadRecords().length === 3'), 'Ctrl+Y did not redo it');
  await dm.evaluate('__rigKey("KeyZ", { ctrlKey: true }); worldMapHide(); 0');
  await dm.evaluate('notesRoadSet(' + JSON.stringify(r2uid) + ', "Mud after rain."); 0');

  const src = await dm.evaluate('({ exp: doExport.toString(), res: adoptCampaignNotesFromZip.toString() })');
  rig.check(/worldRoadsExport/.test(src.exp) && /notesRoadsAll/.test(src.exp), 'the backup export carries no roads or no road notes');
  rig.check(/worldRoadsMerge/.test(src.res) && /notesRekey/.test(src.res), 'the restore does not remap roads and road notes');

  // The prepared file: the library as the export builds it, through the app's own archiver.
  const zip = path.join(rig.outDir, 'roads.zip');
  await dm.evaluate(`(async () => {
    const scenesData = [];
    for (const meta of allScenes) {
      const scene = await sceneStore.loadScene(meta.id);
      const mapExt = mapExtFromScene(scene);
      const mapMimeType = scene.mapBlob ? (scene.mapBlob.type || 'image/jpeg') : (mapExt === '.mp4' ? 'video/mp4' : 'video/webm');
      scenesData.push({
        id: scene.id, mapType: scene.mapType || 'image', mapExt,
        metadata: { id: scene.id, name: scene.name, group: scene.group || '', worldPos: scene.worldPos, mapType: scene.mapType || 'image',
          mapWidth: scene.mapWidth, mapHeight: scene.mapHeight, mapMimeType, mapExt, polygons: [], nextPolygonId: 1,
          notes: scene.notes, effects: [], nextEffectId: 1, gridConfig: {}, createdAt: 0, sortOrder: scene.sortOrder || 0 },
        mapBuffer: scene.mapType !== 'video' ? await blobToArrayBuffer(scene.mapBlob) : null,
        fogBuffer: null, thumbBuffer: await blobToArrayBuffer(scene.thumbnail),
      });
    }
    await window.electronAPI.createBackupZip(${JSON.stringify(zip)}, scenesData, null, null,
      notesCampaignPayload(notesCampaignGet(), notesPlacesAll(), worldPlacesExport(), worldRoadsExport(), notesRoadsAll()));
    return 0;
  })()`, 300000);
  rig.check(fs.existsSync(zip) && fs.statSync(zip).size > 0, 'the backup archiver produced no file');
  const raw = await dm.evaluate('window.electronAPI.readBackupCampaign(' + JSON.stringify(zip) + ')');
  const carried = JSON.parse(raw);
  rig.check(Object.keys(carried.roads || {}).length === 2 && carried.roadNotes && carried.roadNotes[r1uid] === 'Wolves at dusk.' && carried.roadNotes[r2uid] === 'Mud after rain.',
            'campaign.json does not carry both roads and their notes: ' + raw.slice(0, 400));
  const had = JSON.parse(await dm.evaluate('JSON.stringify({ scenes: allScenes.map(s => s.id), roads: worldRoadRecords().map(r => r.uid), places: Object.keys(worldPlacesAll()) })'));
  await dm.evaluate('(async () => { await restoreFromZipPath(' + JSON.stringify(zip) + '); return 0; })()', 300000);
  await dm.waitFor('allScenes.length === ' + (had.scenes.length * 2), 60000, 'the restored scenes to join the library');
  const restored = JSON.parse(await dm.evaluate(`JSON.stringify((() => {
    const old = new Set(${JSON.stringify(had.scenes)}), oldRoads = new Set(${JSON.stringify(had.roads)});
    const fresh = worldRoadRecords().filter(r => !oldRoads.has(r.uid));
    return { count: worldRoadRecords().length, places: Object.keys(worldPlacesAll()).length, fresh: fresh.map(r => ({
      name: r.name, note: notesRoadGet(r.uid),
      ends: r.ends.map(e => ({ kind: e.kind, copy: e.kind === 'scene' ? !old.has(e.ref) && allScenes.some(s => s.id === e.ref) : null, ref: e.ref })),
      scenes: r.scenes.map(s => ({ copy: !old.has(s.id) && allScenes.some(x => x.id === s.id), t: s.t })),
      onScene: r.ends.map((e, k) => { if (e.kind !== 'scene') return null; const s = allScenes.find(x => x.id === e.ref), v = r.vertices[k ? r.vertices.length - 1 : 0]; return Math.hypot(v.x - s.worldPos.x, v.y - s.worldPos.y); }),
      stray: r.scenes.map(s => { const x = allScenes.find(a => a.id === s.id); return x ? __wrDist(r.uid, x.worldPos) : null; }),
    })) };
  })())`));
  rig.check(restored.count === had.roads.length * 2 && restored.fresh.length === had.roads.length,
            'a restore into a library that already has roads did not add each road once: ' + JSON.stringify(restored));
  rig.check(restored.places === had.places.length, 'a restore duplicated a place the DM already had');
  const rb = restored.fresh.find(r => r.name === 'The Old Road'), rh = restored.fresh.find(r => r.name === 'Hamlet Lane');
  rig.check(rb && rb.ends[0].kind === 'scene' && rb.ends[0].copy === true && rb.ends[1].kind === null,
            'a restored road\'s end did not attach to the restored copy of its scene, or kept the id of the original: ' + JSON.stringify(rb));
  rig.check(rb && rb.onScene[0] !== null && rb.onScene[0] < 1.5, 'a restored road\'s end is not on the restored scene: ' + JSON.stringify(rb));
  rig.check(rb && rb.scenes.length === 1 && rb.scenes[0].copy === true && rb.stray[0] < 1.5,
            'a restored road does not hold the restored copy of its scene on its line: ' + JSON.stringify(rb));
  rig.check(rh && rh.ends[0].kind === null, 'a restored road kept an end on a place the DM already had under that name: ' + JSON.stringify(rh));
  rig.check(rb && rh && rb.note === 'Wolves at dusk.' && rh.note === 'Mud after rain.', 'the restored roads did not bring their notes: ' + JSON.stringify([rb && rb.note, rh && rh.note]));

  // ── 8. The previous release opens this safely ───────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const shape = await dm.evaluate(`(async () => {
    const keys = new Set();
    for (const m of allScenes) { const r = await sceneStore.loadScene(m.id); Object.keys(r).forEach(k => keys.add(k)); }
    const meta = new Set(); allScenes.forEach(s => Object.keys(s).forEach(k => meta.add(k)));
    return { rec: [...keys].filter(k => /road/i.test(k)), meta: [...meta].filter(k => /road/i.test(k)),
      own: !!localStorage.getItem('evermist.worldRoads') && !!localStorage.getItem('evermist.roadNotes'),
      places: Object.values(JSON.parse(localStorage.getItem('evermist.placeShapes'))).every(p => !Object.keys(p).some(k => /road/i.test(k))) };
  })()`);
  rig.check(shape.rec.length === 0 && shape.meta.length === 0, 'a scene gained a road field the previous release does not know: ' + JSON.stringify(shape));
  rig.check(shape.own && shape.places, 'roads are not kept under keys of their own, away from the places');

  // ── 10. The TV ──────────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await lib.hold(1500, 'a late push to the TV would arrive within a second and a half of the last edit');
  const seen = await tvSeen(tv);
  rig.check(!/road/i.test(seen), 'the TV was sent a road: ' + seen);
  rig.check(await tv.evaluate('(s => !s || s.getClientRects().length === 0)(document.getElementById("wm-roads")) && !document.querySelector(".road, .roadcase, .wm-rn")'),
            'the TV window shows a road');

  // ── 6. After a restart, and with two maps on ───────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const snap = JSON.parse(await dm.evaluate('JSON.stringify({ roads: worldRoadsExport(), notes: notesRoadsAll() })'));
  await dm.evaluate('doAutoSave()', 60000);
  dm = await rig.restart();
  await lib.installHelpers(dm);
  await lib.settle(dm, 'allScenes.length === ' + (had.scenes.length * 2 - 0), 60000);
  await dm.evaluate(PAGE);
  const again = JSON.parse(await dm.evaluate('JSON.stringify({ roads: worldRoadsExport(), notes: notesRoadsAll() })'));
  rig.check(JSON.stringify(again.roads) === JSON.stringify(snap.roads) && JSON.stringify(again.notes) === JSON.stringify(snap.notes),
            'the roads or their notes are not what they were after a restart');
  const stay = await dm.evaluate('(() => { const s = __wrScene(' + JSON.stringify(AMB) + '), r = worldRoadOfScene(s.id); return { on: !!r && r.uid === ' + JSON.stringify(r1uid) + ', g: sanitizeGroupName(s.group), d: r && __wrDist(r.uid, s.worldPos) }; })()');
  rig.check(stay.on && stay.g === '' && stay.d < 1.5, 'after a restart the scene is not on its road: ' + JSON.stringify(stay));

  // ⚠ TWO MAPS STARTS FROM THE OPEN MAP, and the restart opens the last one a moment after the list loads.
  await dm.waitFor('currentScene && fogCoverT === 0', 90000, 'the restart to open the last scene');
  await dm.evaluate('document.getElementById("btn-two-maps").click(); 0');
  await dm.waitFor('panesActive && panes.A.ready && panes.B.ready', 180000, 'both columns to come up');
  const paneA = await rig.pane('A');
  await paneA.waitFor('typeof currentScene !== "undefined" && currentScene && !!mapOffscreen', 60000, 'column A to hold a map');
  await dm.evaluate('worldMapShow(); 0');
  await lib.settle(dm, '!_wmAnim', 15000);
  await dm.evaluate('selectPane("A"); __wmCam(450, 330, 0.9); 0');
  const heldId = await dm.evaluate('panes.A.sceneId'), heldName = await dm.evaluate('allScenes.find(s => s.id === panes.A.sceneId).name');
  await dm.evaluate('(() => { const c = __wmCard(' + JSON.stringify(heldName) + ').firstChild, p = __wrScreen(' + JSON.stringify(r1uid) + ', 0.75); __wmDrag(c, p); return 0; })()');
  const held = JSON.parse(await dm.evaluate('JSON.stringify((() => { const s = allScenes.find(x => x.id === panes.A.sceneId), r = worldRoadOfScene(s.id); return { on: !!r && r.uid === ' + JSON.stringify(r1uid) + ', g: sanitizeGroupName(s.group), pos: s.worldPos }; })())'));
  rig.check(held.on && held.g === '', 'with two maps on, a scene dropped on a road did not join it: ' + JSON.stringify(held));
  const inColumn = await poll(() => paneA.evaluate('({ x: currentScene.worldPos.x, y: currentScene.worldPos.y, g: currentScene.group || "" })'),
    v => v && Math.abs(v.x - held.pos.x) < 0.001 && v.g === '', 12000);
  rig.check(inColumn && Math.abs(inColumn.x - held.pos.x) < 0.001 && Math.abs(inColumn.y - held.pos.y) < 0.001 && inColumn.g === '',
            'the column holding the scene was not told its place on the road, so its next autosave reverts it: ' + JSON.stringify([inColumn, held]));
  await dm.evaluate('worldMapHide(); document.querySelector(`.pane-col[data-pane="B"] .pane-close`).click(); 0');
  await dm.waitFor('!panesActive', 30000, 'closing a column to end two-map mode');
  rig.check(await dm.evaluate('!!worldRoadOfScene(' + JSON.stringify(heldId) + ')'), 'leaving two maps lost the scene\'s place on the road');

  rig.byEye('The road reads as one line: a dashed light line on a dark casing, the same width at every zoom, blue ' +
            'once picked, its name on a plate close in; and a scene on a road is a black diamond on the line when zoomed ' +
            'out. The rig reads the computed styles; whether it looks right on the DM\'s map is theirs to judge.');
  rig.byEye('A real .zip export, restored into a fresh library, brings the roads back attached to the restored scenes. ' +
            'The save dialog is native, so the rig builds the file with the app\'s own archiver and cannot click Export.');
};
