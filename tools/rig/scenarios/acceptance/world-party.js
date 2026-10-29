'use strict';

// world-party.js — THE PARTY MARKER ON THE CAMPAIGN.
//
// THE GOAL OF THIS FEATURE: the DM preps maps the party is not in, so the open map does not say where the
// party is. One marker on the Campaign shows it. The TV never shows it.
//
// THE CRITERIA ARE THIS HEADER, one per line of the spec's Definition of Done
// (.claude/private/specs/item-164-party-marker.md).
//
// Changed files this scenario covers: src/world/worldParty.js, src/world/worldPartyPlan.js,
// src/world/worldMapMenu.js, src/world/worldMist.js, src/world/worldMap.js, src/world/worldPlaces.js,
// src/notes/notesPlan.js, src/scenes/backup.js, src/scenes/transferImport.js, src/css/worldMap.css,
// src/i18n/ru.js.
//
//   1. Right-clicking a map, a group or the empty ground offers "Put the marker here". Picking it puts the marker there:
//      on a map centred on the card's top edge; on a group or the ground at the clicked point.
//   2. Only one marker exists. "Put the marker here" somewhere else moves it there.
//   3. Dragging the marker moves it. Released over a map (within a few screen pixels of its card) it lands on that
//      map, and the card lights while the drag is over it. Released elsewhere it stays where it was dropped.
//      Dragging it never pans the map or moves a card.
//   4. Right-clicking the marker offers "Remove the marker", which removes it, and nothing else.
//   4b. The Marker tool (campaign toolbar, DoD 4): armed, one click on a map's card puts the marker on that map, one click
//      on bare ground puts it there, and the bar returns to Select each time. Esc leaves it armed-off with nothing placed.
//   5. A marker on a map follows that map when it is moved. When that map is deleted the marker stays at its
//      last spot, free.
//   6. Ctrl+Z and Ctrl+Shift+Z undo and redo placing, moving and removing it.
//   7. Look: one size on screen at every zoom, a slow bob (2.6s), none under reduced motion; the mist thins in a
//      circle around it; it shows at both zoom levels. (The colours and the glow are the DM's eye.)
//   8. The marker survives a restart. "Back up everything" carries it; an import sets it only when the library has
//      none. A pick export does not carry it.
//   9. A library saved with a marker loads on the previous release without error: the field sits in a key of its
//      own and in campaign.json, and no scene record gains one.
//  10. The labels go through the translation table, with Russian.
//  11. The TV never shows the marker.
//
// ⚠ THE EXPORT IS READ BACK, NEVER CLICKED: the save dialog is native, so doExport's destPath goes round it and
// the app's own reader says what campaign.json carries.
// ⚠ NEVER PASS AN ASYNC EXPRESSION TO waitFor.
// ⚠ THE RESTART RUNS LAST, since it ends the page the rest of this file drives.

const path = require('path');
const lib = require('../../lib');

const MAP_W = 900, MAP_H = 600;

const PAGE = `
globalThis.__wmC = el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
globalThis.__wmE = (type, el, p, o) => (el || window).dispatchEvent(new MouseEvent(type,
  Object.assign({ clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, button: 0 }, o || {})));
globalThis.__wmCam = (cx, cy, z) => { _wmCam = { cx, cy, z }; _wmApplyCam(); };
globalThis.__wmS = (x, y) => { const v = _wmView(); return { x: v.w / 2 + (x - _wmCam.cx) * _wmCam.z, y: v.h / 2 + (y - _wmCam.cy) * _wmCam.z }; };
globalThis.__wmDrag = (el, to) => {
  const a = __wmC(el);
  __wmE('mousedown', el, a);
  __wmE('mousemove', window, { x: (a.x + to.x) / 2, y: (a.y + to.y) / 2 });
  __wmE('mousemove', window, to);
  __wmE('mouseup', window, to);
};
globalThis.__wpCard = id => document.querySelector('.wm-card[data-id="' + id + '"]');
globalThis.__wpBody = () => document.querySelector('.wp-body');
// A right-click on an element (or the bare layer) at a screen point, then what the menu holds.
globalThis.__wpMenu = (el, p) => __wmE('contextmenu', el || document.getElementById('wm'), p, { button: 2 });
globalThis.__wpRows = () => [...document.querySelectorAll('.wm-menu .sm-mi')].map(b => b.textContent);
globalThis.__wpPick = text => [...document.querySelectorAll('.wm-menu .sm-mi')].find(x => x.textContent === text).click();
globalThis.__wpAsk = (el, p, text) => { __wpMenu(el, p); const rows = __wpRows(); __wpPick(text); return rows; };
globalThis.__wpHere = id => { const c = __wpCard(id); return __wpAsk(c.firstChild, __wmC(c), "Put the marker here"); };
// The marker pressed and carried to a screen point in two moves; with hold the button stays down.
globalThis.__wpCarry = (to, hold) => {
  const a = __wmC(__wpBody());
  __wmE('mousedown', __wpBody(), a);
  __wmE('mousemove', window, { x: (a.x + to.x) / 2, y: (a.y + to.y) / 2 });
  __wmE('mousemove', window, to);
  if (!hold) __wmE('mouseup', window, to);
};
globalThis.__wpParty = () => JSON.stringify(worldPartyExport());
`;

module.exports = async function worldPartyFeature(rig) {
  let dm = rig.dm;

  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H });
  const expr = await rig.fixtures.asFileExpr(dm, map);
  const named = n => '(f => new File([f], ' + JSON.stringify(n) + ', { type: f.type }))(' + expr + ')';
  const importAs = async name => {
    await dm.evaluate('createNewScene(' + named(name + '.mp4') + ')', 120000);
    await dm.waitFor('currentScene && currentScene.name === ' + JSON.stringify(name), 120000, 'the import of ' + name);
    return dm.evaluate('currentScene.id');
  };
  const party = async () => JSON.parse(await dm.evaluate('__wpParty()'));
  const near = (a, b, tol) => Math.abs(a - b) <= (tol || 1.5);
  const at = w => '__wmS(' + w.x + ', ' + w.y + ')';
  const key = (code, o) => dm.evaluate('__rigKey(' + JSON.stringify(code) + ', ' + JSON.stringify(o) + '); 0');
  const ask = async (target, point, label) => JSON.parse(await dm.evaluate('JSON.stringify(__wpAsk(' + target + ', ' + point + ', ' + JSON.stringify(label) + '))'));
  const HERE = 'Put the marker here';

  const ID = {};
  for (const n of ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon']) ID[n] = await importAs(n);
  // Three loose maps in a row, and a group of two below them.
  const START = { Alpha: { x: 0, y: 0 }, Beta: { x: 400, y: 0 }, Gamma: { x: 800, y: 0 }, Delta: { x: 0, y: 600 }, Epsilon: { x: 140, y: 600 } };
  await dm.evaluate('(async () => { const at = ' + JSON.stringify(START) + ', id = ' + JSON.stringify(ID) +
    '; for (const n of Object.keys(at)) await worldSceneSet(id[n], { worldPos: at[n] }); return 0; })()', 30000);
  await dm.evaluate('(' + JSON.stringify([ID.Delta, ID.Epsilon]) + ').forEach(i => worldSceneSet(i, { group: "Hamlet" })); 0');
  await lib.installHelpers(dm);
  await dm.evaluate(PAGE);
  await dm.evaluate('dockOpen(null); 0');
  const tv = await rig.player();
  await tv.evaluate('globalThis.__got = []; addEventListener("message", e => __got.push((e.data && e.data.type) || typeof e.data)); 0');

  await dm.evaluate('worldMapShow(); 0');
  await lib.settle(dm, '!_wmAnim', 20000);
  await dm.evaluate('__wmCam(450, 330, 0.9); 0');
  rig.check(await dm.evaluate('!!worldPlaceByName("Hamlet") && worldPartyExport() === null && !document.querySelector(".wp-here")'),
            'the map did not open with the Hamlet group and no marker');

  // ── 1. "Put the marker here" on a map, a group and the ground ───────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const alpha = '__wpCard(' + JSON.stringify(ID.Alpha) + ')';
  let rows = await ask(alpha + '.firstChild', '__wmC(' + alpha + ')', HERE);
  rig.check(rows.includes(HERE), 'a map\'s menu does not offer "Put the marker here": ' + JSON.stringify(rows));
  let got = await party();
  rig.check(got && got.scene === ID.Alpha && near(got.x, 0) && near(got.y, -38.5), 'on a map the marker is not centred on the card\'s top edge: ' + JSON.stringify(got));
  const hc = await dm.evaluate('(() => { const c = wmPolyCentre(wmOutline(worldPlaceByName("Hamlet"))); return { x: c.x, y: c.y }; })()');
  rows = await ask('null', at(hc), HERE);
  rig.check(rows.includes(HERE), 'a group\'s menu does not offer "Put the marker here": ' + JSON.stringify(rows));
  got = await party();
  rig.check(got && got.scene === undefined && near(got.x, hc.x, 2) && near(got.y, hc.y, 2), 'on a group the marker is not at the clicked point: ' + JSON.stringify([got, hc]));
  rows = await ask('null', at({ x: 400, y: 300 }), HERE);
  rig.check(rows.includes(HERE), 'the ground\'s menu does not offer "Put the marker here": ' + JSON.stringify(rows));
  got = await party();
  rig.check(got && got.scene === undefined && near(got.x, 400, 2) && near(got.y, 300, 2), 'on the ground the marker is not at the clicked point: ' + JSON.stringify(got));

  // ── 2. Only one marker ──────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(await dm.evaluate('document.querySelectorAll(".wp-here").length') === 1, 'more than one marker is on the map after three placements');
  await dm.evaluate('__wpHere(' + JSON.stringify(ID.Alpha) + '); 0');
  got = await party();
  rig.check(got && got.scene === ID.Alpha && await dm.evaluate('document.querySelectorAll(".wp-here").length') === 1,
            '"Put the marker here" somewhere else did not move the one marker: ' + JSON.stringify(got));

  // A map that already holds the marker does not offer "Put the marker here" again.
  await dm.evaluate('__wpMenu(' + alpha + '.firstChild, __wmC(' + alpha + ')); 0');
  rows = JSON.parse(await dm.evaluate('JSON.stringify(__wpRows())'));
  rig.check(rows.length > 0 && !rows.includes(HERE), 'a map that holds the marker still offers the row: ' + JSON.stringify(rows));
  await dm.evaluate('document.getElementById("wm").dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); 0');

  // ── 3. Dragging ─────────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const snapOf = () => dm.evaluate('JSON.stringify({ cam: _wmCam, pos: allScenes.map(s => s.worldPos) })');
  const before = await snapOf();
  const beta = '__wpCard(' + JSON.stringify(ID.Beta) + ')';
  await dm.evaluate('__wpCarry(__wmC(' + beta + '), true); 0');
  rig.check(await dm.evaluate(beta + '.classList.contains("drop")'), 'the card under the dragged marker does not light');
  await dm.evaluate('__wmE("mouseup", window, __wmC(' + beta + ')); 0');
  got = await party();
  rig.check(got && got.scene === ID.Beta && near(got.x, 400) && near(got.y, -38.5), 'released over a map the marker did not land on it: ' + JSON.stringify(got));
  rig.check(await dm.evaluate('!document.querySelector(".wm-card.drop")'), 'a card still lights after the marker was released');
  // Within a few screen pixels of the card still lands on it: 4px past Gamma's right edge.
  await dm.evaluate('(() => { const p = __wmS(800 + 55, 0); __wpCarry({ x: p.x + 4, y: p.y }); return 0; })()');
  got = await party();
  rig.check(got && got.scene === ID.Gamma, 'released 4px outside a card the marker did not land on it: ' + JSON.stringify(got));
  // Anywhere else it stays where it was dropped, free.
  await dm.evaluate('__wpCarry(' + at({ x: 600, y: 300 }) + '); 0');
  got = await party();
  rig.check(got && got.scene === undefined && near(got.x, 600, 2) && near(got.y, 300, 2), 'released over bare ground the marker did not stay where it was dropped: ' + JSON.stringify(got));
  rig.check(await snapOf() === before, 'dragging the marker panned the map or moved a card');

  // ── 4. The marker's own menu ────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('__wpMenu(__wpBody(), __wmC(__wpBody())); 0');
  rows = JSON.parse(await dm.evaluate('JSON.stringify(__wpRows())'));
  // RED BY DESIGN: written against the fix, never re-proved
  rig.check(rows.length === 1 && rows[0] === 'Remove the marker', 'the marker\'s menu holds more than "Remove the marker": ' + JSON.stringify(rows));
  await dm.evaluate('__wpPick("Remove the marker"); 0');
  rig.check(await dm.evaluate('worldPartyExport() === null && !document.querySelector(".wp-here")'), '"Remove the marker" did not remove the marker');

  // ── 4b. The Marker tool ─────────────────────────────────────────────────────
  // One click on a map's card, then one on bare ground; each puts the marker there and hands the bar back to Select.
  const armMarker = () => dm.evaluate('document.getElementById("wm-marker").click(); 0');
  const tool = () => dm.evaluate('({ tool: _wmTool, lit: document.getElementById("wm-marker").classList.contains("active"), select: document.getElementById("btn-select").classList.contains("active") })').then(x => JSON.stringify(x));
  await armMarker();
  rig.check(await tool() === JSON.stringify({ tool: 'marker', lit: true, select: false }), 'a click on Marker did not arm it');
  await dm.evaluate('__wmE("mousedown", ' + alpha + '.firstChild, __wmC(' + alpha + ')); __wmE("mouseup", window, __wmC(' + alpha + ')); 0');
  got = await party();
  // RED BY DESIGN: written against the fix, never re-proved
  rig.check(got && got.scene === ID.Alpha, 'a click on a map with the Marker tool armed did not put the marker on that map: ' + JSON.stringify(got));
  // RED BY DESIGN: written against the fix, never re-proved
  rig.check(await tool() === JSON.stringify({ tool: 'select', lit: false, select: true }), 'the bar did not return to Select after the marker was placed');
  await armMarker();
  await dm.evaluate('(() => { const p = ' + at({ x: 700, y: 300 }) + '; __wmE("mousedown", document.getElementById("wm"), p); __wmE("mouseup", window, p); return 0; })()');
  got = await party();
  rig.check(got && got.scene === undefined && near(got.x, 700, 2) && near(got.y, 300, 2), 'a click on bare ground with the Marker tool armed did not put the marker there: ' + JSON.stringify(got));
  const kept = JSON.stringify(got);
  await armMarker();
  await key('Escape');
  await dm.evaluate('(() => { const p = ' + at({ x: 200, y: 300 }) + '; __wmE("mousedown", document.getElementById("wm"), p); __wmE("mouseup", window, p); return 0; })()');
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(JSON.stringify(await party()) === kept, 'Esc did not cancel the Marker tool: the next click moved the marker');
  await dm.evaluate('worldPartyRemove(); 0');

  // ── 6. Undo and redo ────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('__wpHere(' + JSON.stringify(ID.Alpha) + '); 0');
  const placed = await party();
  await key('KeyZ', { ctrlKey: true });
  rig.check(await dm.evaluate('worldPartyExport() === null'), 'Ctrl+Z did not undo placing the marker');
  await key('KeyZ', { ctrlKey: true, shiftKey: true });
  rig.check(JSON.stringify(await party()) === JSON.stringify(placed), 'Ctrl+Shift+Z did not redo placing the marker');
  await dm.evaluate('__wpCarry(' + at({ x: 600, y: 300 }) + '); 0');
  await key('KeyZ', { ctrlKey: true });
  rig.check(JSON.stringify(await party()) === JSON.stringify(placed), 'Ctrl+Z did not undo moving the marker');
  await key('KeyZ', { ctrlKey: true, shiftKey: true });
  got = await party();
  rig.check(got && got.scene === undefined && near(got.x, 600, 2), 'Ctrl+Shift+Z did not redo moving the marker: ' + JSON.stringify(got));
  await dm.evaluate('__wpMenu(__wpBody(), __wmC(__wpBody())); __wpPick("Remove the marker"); 0');
  await key('KeyZ', { ctrlKey: true });
  rig.check(await dm.evaluate('worldPartyExport() !== null && !!document.querySelector(".wp-here")'), 'Ctrl+Z did not undo taking the marker off');
  await key('KeyZ', { ctrlKey: true, shiftKey: true });
  rig.check(await dm.evaluate('worldPartyExport() === null'), 'Ctrl+Shift+Z did not redo taking the marker off');

  // ── 7. The look ─────────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('__wpHere(' + JSON.stringify(ID.Alpha) + '); 0');
  const look = async z => {
    await dm.evaluate('__wmCam(450, 330, ' + z + '); 0');
    return JSON.parse(await dm.evaluate('JSON.stringify((() => { const b = __wpBody(), r = b.getBoundingClientRect(), h = document.querySelector(".wmist-hole"), s = getComputedStyle(b);' +
      ' return { h: r.height, shown: b.getClientRects().length > 0, anim: s.animationName, dur: s.animationDuration, hole: h.getAttribute("display") !== "none", r: h.getAttribute("r"), cx: +h.getAttribute("cx"), cy: +h.getAttribute("cy"), level: _wm.className }; })())'));
  };
  // A runner's OS may ask for reduced motion, so the bob is read with motion allowed, then with it refused.
  await dm.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  const far = await look(0.3), close = await look(1.4);
  rig.check(far.shown && close.shown && far.level.includes('places') && close.level.includes('scenes'), 'the marker does not show at both zoom levels: ' + JSON.stringify([far, close]));
  rig.check(Math.abs(far.h - close.h) < 1.5 && close.h > 40 && close.h < 80, 'the marker is not one size on screen at every zoom: ' + far.h + ' and ' + close.h);
  rig.check(close.anim === 'wpBob' && close.dur === '2.6s', 'the marker does not bob slowly: ' + close.anim + ' ' + close.dur);
  await dm.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  rig.check(await dm.evaluate('getComputedStyle(__wpBody()).animationName') === 'none', 'the marker still bobs under reduced motion');
  await dm.send('Emulation.setEmulatedMedia', { features: [] });
  rig.check(far.hole && close.hole && Number(close.r) > 100 && near(close.cx, 0) && near(close.cy, -38.5), 'the mist does not thin in a circle around the marker at both zoom levels: ' + JSON.stringify([far, close]));
  const still = await dm.evaluate('(() => { for (const sh of document.styleSheets) for (const r of sh.cssRules) if (r.media && /reduce/.test(r.media.mediaText)) for (const q of r.cssRules) if (q.selectorText === ".wp-body") return q.style.animationName || q.style.animation; return null; })()');
  rig.check(still === 'none', 'the bob is not switched off under reduced motion: ' + still);
  rig.byEye('The marker is a flat blue four-point compass star with a ring and white lines, a soft blue glow and no shading, about 50px tall; ' +
            'the mist lifts around it in a soft circle.');

  // ── 5. It follows its map, and stays when the map is deleted ────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  // Live: mid-drag, with the button down, the marker is already over the card's top edge.
  await dm.evaluate('(() => { const c = ' + alpha + '.firstChild, a = __wmC(c), to = ' + at({ x: 300, y: -250 }) + '; __wmE("mousedown", c, a); __wmE("mousemove", window, { x: (a.x + to.x) / 2, y: (a.y + to.y) / 2 }); __wmE("mousemove", window, to); return 0; })()');
  const liveAt = JSON.parse(await dm.evaluate('JSON.stringify((() => { const r = document.querySelector(".wp-here"); return { left: parseFloat(r.style.left), top: parseFloat(r.style.top) }; })())'));
  rig.check(near(liveAt.left, 300, 3) && near(liveAt.top, -250 - 38.5, 3), 'the marker did not follow its map live while the map was dragged: ' + JSON.stringify(liveAt));
  await dm.evaluate('__wmE("mouseup", window, ' + at({ x: 300, y: -250 }) + '); 0');
  await dm.evaluate('__wmCam(450, 330, 0.9); __wmDrag(' + alpha + '.firstChild, ' + at({ x: 100, y: -250 }) + '); 0');
  const mv = JSON.parse(await dm.evaluate('JSON.stringify((() => { const s = allScenes.find(x => x.id === ' + JSON.stringify(ID.Alpha) + '), e = document.querySelector(".wp-here");' +
    ' return { pos: s.worldPos, party: worldPartyExport(), left: parseFloat(e.style.left), top: parseFloat(e.style.top) }; })())'));
  rig.check(mv.party && mv.party.scene === ID.Alpha && near(mv.party.x, mv.pos.x) && near(mv.party.y, mv.pos.y - 38.5) && near(mv.left, mv.pos.x) && near(mv.top, mv.pos.y - 38.5),
            'the marker did not follow its map when the map was moved: ' + JSON.stringify(mv));
  await dm.evaluate('_wmDeletePicked([' + JSON.stringify(ID.Alpha) + ']); commitPendingDelete(); 0');
  await lib.settle(dm, '!allScenes.some(s => s.id === ' + JSON.stringify(ID.Alpha) + ')', 15000);
  await dm.evaluate('worldMapRefresh(); 0');
  got = await party();
  rig.check(got && got.scene === undefined && near(got.x, mv.party.x) && near(got.y, mv.party.y), 'when its map was deleted the marker did not stay at its last spot, free: ' + JSON.stringify(got));
  rig.check(await dm.evaluate('!!document.querySelector(".wp-here")'), 'the marker vanished with its map');

  // ── 10. The labels, in Russian ──────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const ru = JSON.parse(await dm.evaluate('JSON.stringify([RU[i18nKey("Put the marker here")], RU[i18nKey("Remove the marker")], RU[i18nKey("Marker")]])'));
  rig.check(ru[0] === 'Поставить метку сюда' && ru[1] === 'Убрать метку' && ru[2] === 'Метка', 'the labels have no Russian: ' + JSON.stringify(ru));

  // ── 8. Backup and import ────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('__wpHere(' + JSON.stringify(ID.Beta) + '); 0');
  const own = await party();
  const fullZip = path.join(rig.outDir, 'party-full.zip'), pickZip = path.join(rig.outDir, 'party-pick.zip');
  const readCampaign = async zip => JSON.parse(await dm.evaluate('window.electronAPI.readBackupCampaign(' + JSON.stringify(zip) + ')') || '{}');
  await dm.evaluate('(async () => { await doExport(allScenes.map(s => s.id), { destPath: ' + JSON.stringify(fullZip) + ' }); return 0; })()', 300000);
  const full = await readCampaign(fullZip);
  rig.check(full.party && full.party.scene === ID.Beta && near(full.party.x, own.x) && near(full.party.y, own.y), 'Back up everything does not carry the marker: ' + JSON.stringify(full.party));
  await dm.evaluate('(async () => { await doExport([' + JSON.stringify(ID.Beta) + '], { partial: true, destPath: ' + JSON.stringify(pickZip) + ' }); return 0; })()', 300000);
  const pick = await readCampaign(pickZip);
  rig.check(!pick.party, 'a pick export carries the marker: ' + JSON.stringify(pick.party));
  const dismiss = 'for (let i = 0; i < 20; i++) { const a = document.getElementById("cd-anchor"); if (!a || a.style.display !== "flex") break; document.getElementById(a.classList.contains("cd-solo") ? "cd-ok" : "cd-cancel").click(); } 0';
  // An import sets the marker only when the library has none.
  await dm.evaluate('worldPartyRemove(); 0');
  await dm.evaluate('(async () => { await restoreFromZipPath(' + JSON.stringify(fullZip) + '); return 0; })()', 300000);
  await dm.evaluate(dismiss);
  got = await party();
  rig.check(got && got.scene === ID.Beta, 'an import into a library with no marker did not set it: ' + JSON.stringify(got));
  await dm.evaluate('__wpCarry(' + at({ x: 600, y: 300 }) + '); 0');
  const mine = await party();
  await dm.evaluate('(async () => { await restoreFromZipPath(' + JSON.stringify(fullZip) + '); return 0; })()', 300000);
  await dm.evaluate(dismiss);
  rig.check(JSON.stringify(await party()) === JSON.stringify(mine), 'an import replaced a marker the library already had: ' + JSON.stringify(await party()));

  // ── 9. The previous release opens this safely ───────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const shape = await dm.evaluate(`(async () => {
    const keys = new Set();
    for (const m of allScenes) { const r = await sceneStore.loadScene(m.id); Object.keys(r).forEach(k => keys.add(k)); }
    const meta = new Set(); allScenes.forEach(s => Object.keys(s).forEach(k => meta.add(k)));
    return { rec: [...keys].filter(k => /party/i.test(k)), meta: [...meta].filter(k => /party/i.test(k)), own: !!localStorage.getItem('evermist.worldParty') };
  })()`);
  rig.check(shape.rec.length === 0 && shape.meta.length === 0, 'a scene gained a party field the previous release does not know: ' + JSON.stringify(shape));
  rig.check(shape.own, 'the marker is not kept under a key of its own');
  const legacy = JSON.parse(await dm.evaluate('JSON.stringify(notesParseCampaign(notesCampaignPayload("lore", null, null, null, null, worldPartyExport())))'));
  rig.check(legacy.text === 'lore' && legacy.broken === false, 'the notes of a campaign.json that carries a marker do not read the way the previous release reads them: ' + JSON.stringify(legacy));

  // ── 11. The TV ──────────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await lib.hold(1500, 'a late push to the TV would arrive within a second and a half of the last edit');
  const seen = await tv.evaluate('JSON.stringify(__got)');
  rig.check(!/party|marker/i.test(seen), 'the TV was sent the marker: ' + seen);
  rig.check(await tv.evaluate('!document.querySelector(".wp-here, #wm-party")'), 'the TV window holds the marker');

  // ── 8. After a restart ──────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const snap = await party();
  await dm.evaluate('worldMapHide(); doAutoSave()', 60000);
  dm = await rig.restart();
  await lib.installHelpers(dm);
  await lib.settle(dm, 'allScenes.length === 4', 60000);
  await dm.evaluate(PAGE);
  const back = await party();
  rig.check(JSON.stringify(back) === JSON.stringify(snap), 'the marker is not what it was after a restart: ' + JSON.stringify([snap, back]));
  await dm.evaluate('worldMapShow(); 0');
  await lib.settle(dm, '!_wmAnim', 15000);
  rig.check(await dm.evaluate('!!document.querySelector(".wp-here")'), 'the marker is not drawn after a restart');
};
