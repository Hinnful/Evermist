'use strict';

// notes-panel.js — WHAT THE NOTES WINDOW SHOWS AND SAVES, AT EVERY LEVEL AND ON EVERY ROUTE.
//
// THE GOAL OF THIS FEATURE: the DM keeps notes for the campaign, a group, a road, a map and a room in one
// window, a map with no rooms has somewhere to put them, and none of it reaches the TV. A note reaches the map
// that holds it, so no autosave writes the old text back.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its letter.
//
//   A. A room's note shows its name as the title with the module dropdown on it, and Delete; a room pick
//      shows its note while the window is open.
//   B. A room pick with the window shut leaves it shut and Notes on the rail as it was, as the Bestiary and the
//      fight table; a click on Notes opens the window on that room.
//   C. Picking a group, a road or a map on the Campaign shows its note.
//   D. Campaign, group, road, map and room notes show and save, a map's note never overwritten by an
//      autosave that runs after it.
//   E. A text field keeps its own undo: Ctrl+Z in it is not the map's.
//   F. Nothing in the window reaches the TV, and the Player and a column carry no window.
//   G. Grid calibration puts the window away and brings it back after.
//   H. In two-map mode the window follows the selected column and an edit goes back to the column it came
//      from; a room of the other column's map renamed from the tree survives that column's next autosave.
//   I. Search's "Show notes" and the Campaign's right-click "Show notes" open the window on that level.

const lib = require('../../lib');

const MAP_W = 2400, MAP_H = 1500;
const INSIDE = { x: 450, y: 380 };
const EMPTY = { x: 1800, y: 1100 };
const TALL = { w: 1200, h: 1500 };

module.exports = async function notesPanelFeature(rig) {
  const dm = rig.dm;
  const ev = (expr, ms) => dm.evaluate(expr, ms);
  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await lib.settle(dm, 'fogCoverT === 0', 30000);
  await ev('polygons = [{ id: 1, vertices: [{ x: 300, y: 250 }, { x: 620, y: 250 }, { x: 620, y: 500 }, { x: 300, y: 500 }], mode: "shroud", cornerRadius: 0, name: "The Vestry", desc: "Two acolytes." }];' +
    ' nextPolygonId = 2; setShape("select"); selectedPolygonId = null; rebuildFogFromPolygons(); refreshRoomPanel(); scheduleRender(); 0');
  const sceneId = await ev('currentScene.id'), sceneName = await ev('currentScene.name');
  const typeInto = (id, value) => ev(`(() => {
    const el = document.getElementById(${JSON.stringify(id)});
    el.dispatchEvent(new FocusEvent('focus'));
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur'));
    return 0; })()`);
  const win = () => ev(`(() => {
    const w = document.getElementById('notes-window'), shown = el => !!el && el.offsetParent !== null;
    const f = document.getElementById('np-field'), r = document.getElementById('rp-desc');
    return { open: nwIsOpen(), visible: !w.hidden && w.getBoundingClientRect().width > 0, kind: document.getElementById('nw-kind').textContent,
      crumbs: [...document.querySelectorAll('#nw-crumbs .nw-crumb')].map(c => c.textContent), field: shown(f) ? f.value : null,
      roomName: shown(document.getElementById('rp-name')) ? document.getElementById('rp-name').value : null, roomField: shown(r) ? r.value : null,
      title: document.getElementById('nw-title').hidden ? null : document.getElementById('nw-title').value,
      tab: document.getElementById('dock-tab-notes').className, tabOff: document.getElementById('dock-tab-notes').disabled };
  })()`);
  const openWin = async () => { if (!(await ev('nwIsOpen()'))) await ev('document.getElementById("dock-tab-notes").click(); 0'); await lib.settle(dm, 'nwIsOpen()', 6000); };

  const player = await rig.player();
  await player.waitFor('!!mapOffscreen', 45000, 'the Player to receive the map');
  await player.evaluate('globalThis.__npMsgs = []; window.addEventListener("message", e => __npMsgs.push(e.data && e.data.type)); 0');
  const tvDom = () => player.evaluate('document.body.querySelectorAll("*").length + "|" + document.body.textContent');
  const tvBefore = await tvDom();

  // ── A. A room's note ──────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await openWin();
  await ev('__rigClick(' + INSIDE.x + ', ' + INSIDE.y + '); 0');
  await lib.settle(dm, 'selectedPolygonId === 1 && document.getElementById("nw-kind").textContent === "Room"', 6000);
  const inRoom = await win();
  rig.check(inRoom.roomName === 'The Vestry' && inRoom.roomField === 'Two acolytes.' && inRoom.field === null && inRoom.crumbs.join('>') === 'Campaign>' + sceneName + '>The Vestry',
            'a room pick did not show its name, its note and its path in the open window: ' + JSON.stringify(inRoom));
  rig.check(await ev('!!document.querySelector("#notes-window .rp-mt-dd") && document.getElementById("rp-delete").getBoundingClientRect().width > 0 && !document.getElementById("rp-delete").disabled'),
            'the room does not carry its module dropdown on the name, or its Delete');
  await typeInto('rp-desc', 'Two acolytes and a font.');
  await lib.settle(dm, 'polygons[0].desc === "Two acolytes and a font."', 6000);
  await ev('applyModuleEntryToRoom({ title: "K1. The Gatehouse", body: "Two guards stand here." }); 0');
  await lib.settle(dm, "document.getElementById('cd-anchor') && document.getElementById('cd-anchor').style.display === 'flex'", 6000);
  rig.check(await ev('document.getElementById("cd-title").textContent') === 'Replace description?' && await ev('polygons[0].name') === 'K1. The Gatehouse',
            'module text over a room with notes did not ask first');
  await ev('document.getElementById("cd-cancel").click(); 0');
  await typeInto('rp-name', 'The Vestry');
  await typeInto('rp-desc', 'Two acolytes.');
  await ev('__rigClick(' + EMPTY.x + ', ' + EMPTY.y + '); 0');
  await lib.settle(dm, 'selectedPolygonId === null && document.getElementById("nw-kind").textContent === "Map"', 6000);
  rig.check((await win()).kind === 'Map' && (await win()).field === '', 'a click on empty map did not leave the map\'s note showing');

  // ── B. A pick with the window shut ────────────────────────────────────────
  // RED ON: the pick lighting Notes with the open tint (dock.js) — 2026-10-30
  await ev('document.getElementById("dock-tab-notes").click(); 0');
  await lib.settle(dm, '!nwIsOpen()', 6000);
  await ev('__rigClick(' + INSIDE.x + ', ' + INSIDE.y + '); 0');
  await lib.settle(dm, 'selectedPolygonId === 1', 6000);
  const shut = await win();
  rig.check(!shut.open && !shut.visible && !shut.tab.includes('active') && !shut.tab.includes('win'), 'a room picked with the window shut opened it, or marked Notes on the rail: ' + JSON.stringify(shut));
  await ev('__rigClick(' + EMPTY.x + ', ' + EMPTY.y + '); 0');
  await lib.settle(dm, 'selectedPolygonId === null', 6000);
  rig.check(!(await win()).tab.includes('active'), 'a deselect with the window shut marked Notes on the rail');
  await ev('__rigClick(' + INSIDE.x + ', ' + INSIDE.y + '); 0');
  await lib.settle(dm, 'selectedPolygonId === 1', 6000);
  await ev('document.getElementById("dock-tab-notes").click(); 0');
  await lib.settle(dm, 'nwIsOpen() && document.getElementById("nw-kind").textContent === "Room"', 6000);
  const open = await win();
  rig.check(open.roomName === 'The Vestry' && open.tab.includes('win') && !open.tab.includes('active'), 'a click on Notes did not open the window on the picked room with the dot alone: ' + JSON.stringify(open));

  // ── D. Every level shows and saves ────────────────────────────────────────
  await ev('document.querySelector("#nw-crumbs .nw-crumb[data-go]").click(); 0');
  await lib.settle(dm, 'document.getElementById("nw-kind").textContent === "Campaign"', 6000);
  await typeInto('np-field', 'The duke is a lich.');
  await lib.settle(dm, 'localStorage.getItem("evermist.campaignNotes") === "The duke is a lich."', 6000);
  await ev('document.querySelector(\'#nw-tl .nw-row[data-key="map:' + sceneId + '"]\').click(); 0');
  await lib.settle(dm, 'document.getElementById("nw-kind").textContent === "Map"', 6000);
  // RED ON: _npCommitMap writing the stored record instead of the open scene (notesPanel.js) — 2026-10-30
  await typeInto('np-field', 'The crypt floods at midnight.');
  await lib.settle(dm, 'currentScene.notes === "The crypt floods at midnight."', 6000);
  await ev('doAutoSave()', 60000);
  const kept = await ev('sceneStore.loadScene(' + JSON.stringify(sceneId) + ').then(s => s.notes)', 30000);
  rig.check(kept === 'The crypt floods at midnight.' && await ev('localStorage.getItem("evermist.campaignNotes")') === 'The duke is a lich.',
            'a map\'s note, or the campaign\'s, was not kept by the next autosave: ' + JSON.stringify(kept));
  await ev('(() => { const n = addGroup("Vallaki"); worldSceneSet(currentScene.id, { group: n }); sceneListChanged(); return 0; })()');
  await ev('worldMapShow(); 0');
  await lib.settle(dm, 'worldMapOpen', 6000);
  await ev('worldMapSelect({ sceneId: null, place: "Vallaki" }); 0');
  await lib.settle(dm, 'document.getElementById("nw-kind").textContent === "Group"', 6000);
  await typeInto('np-field', 'Walled town.');
  await lib.settle(dm, 'notesPlaceGet("Vallaki") === "Walled town."', 6000);
  // C. Picking a group, a map and a road on the Campaign shows its note.
  // RED ON: _npFollow answering the campaign whatever the Campaign has picked (notesPanel.js) — 2026-10-30
  rig.check((await win()).kind === 'Group' && (await win()).field === 'Walled town.' && (await win()).title === 'Vallaki', 'picking a group on the Campaign did not show its note: ' + JSON.stringify(await win()));
  await ev('worldMapSelect({ sceneId: ' + JSON.stringify(sceneId) + ', place: "" }); 0');
  await lib.settle(dm, 'document.getElementById("nw-kind").textContent === "Map"', 6000);
  rig.check((await win()).field === 'The crypt floods at midnight.', 'picking a map on the Campaign did not show its note: ' + JSON.stringify(await win()));
  const roadUid = await ev('worldRoadCreate([{ x: 0, y: 0 }, { x: 300, y: 300 }], [null, null], [], [])');
  await ev('worldMapSelect({ sceneId: null, place: "", road: ' + JSON.stringify(roadUid) + ' }); 0');
  await lib.settle(dm, 'document.getElementById("nw-kind").textContent === "Road"', 6000);
  await typeInto('np-field', 'Ambush at the bridge.');
  await lib.settle(dm, 'notesRoadGet(' + JSON.stringify(roadUid) + ') === "Ambush at the bridge."', 6000);
  rig.check((await win()).kind === 'Road' && await ev('notesRoadGet(' + JSON.stringify(roadUid) + ')') === 'Ambush at the bridge.', 'a road\'s note did not show and save');
  // I. The Campaign's right-click "Show notes" and search's open the window on that level.
  // RED ON: _wmOpenNotes opening nothing (worldMapMenu.js) — 2026-10-30
  await ev('nwHide(); worldMapSelect({ sceneId: null, place: "Vallaki" }); _wmOpenNotes(); 0');
  await lib.settle(dm, 'nwIsOpen() && document.getElementById("nw-kind").textContent === "Group"', 6000);
  rig.check((await win()).open && (await win()).kind === 'Group', 'Show notes in the Campaign\'s menu did not open the window on the group');
  await ev('nwHide(); worldMapHide(); 0');
  await lib.settle(dm, '!worldMapOpen', 8000);
  // RED BY DESIGN: written against the feature, never re-proved
  await ev('searchPick({ entry: { key: "map:' + sceneId + '", kind: "map", id: "' + sceneId + '", name: ' + JSON.stringify(sceneName) + ' }, rank: SP_NOTE }); 0');
  await lib.settle(dm, 'nwIsOpen() && document.getElementById("nw-kind").textContent === "Map"', 15000);
  rig.check((await win()).open && (await win()).field === 'The crypt floods at midnight.', 'search\'s Show notes on a map did not open the window on its note: ' + JSON.stringify(await win()));
  await ev('nwHide(); searchPick({ entry: { key: "campaign", kind: "campaign" }, rank: SP_NOTE }); 0');
  await lib.settle(dm, 'nwIsOpen() && document.getElementById("nw-kind").textContent === "Campaign"', 6000);
  rig.check((await win()).field === 'The duke is a lich.', 'search\'s Show notes on the campaign did not open its note');

  // ── E. A field keeps its own undo ─────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const undo = await ev(`(() => { const f = document.getElementById('np-field'); let reached = false;
    const spy = () => { reached = true; }; document.addEventListener('keydown', spy);
    const e = new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true });
    f.dispatchEvent(e); document.removeEventListener('keydown', spy); return { reached, prevented: e.defaultPrevented }; })()`);
  // The editor takes Ctrl+Z for its own history, so the key is never the map's.
  rig.check(!undo.reached && undo.prevented, 'Ctrl+Z in a notes field reached the map\'s undo or was not taken by the editor: ' + JSON.stringify(undo));

  // ── F. The TV and the other windows ───────────────────────────────────────
  await lib.hold(1200, 'long enough for a note to have pushed something to the TV, then prove it did not');
  const tvMsgs = (await player.evaluate('__npMsgs')).filter(m => ['fog-update', 'tv-picture', 'scene-transition', 'view-snap', 'fog-color'].includes(m));
  rig.check(tvMsgs.length === 0 && await tvDom() === tvBefore, 'a note, a pick or the window changed what the TV shows: ' + JSON.stringify(tvMsgs));
  const tv = await player.evaluate('(() => { const w = document.getElementById("notes-window"); return !w || getComputedStyle(w).display === "none" || w.hidden; })()');
  rig.check(tv, 'the Player carries the Notes window');

  // ── G. Calibration ────────────────────────────────────────────────────────
  // RED ON: dockHoldForCalibration not calling nwHoldForCalibration (dock.js) — 2026-10-30
  await ev('selectedPolygonId = null; refreshRoomPanel(); 0');
  await ev('__rigClick(' + INSIDE.x + ', ' + INSIDE.y + '); 0');
  await lib.settle(dm, 'selectedPolygonId === 1 && document.getElementById("nw-kind").textContent === "Room"', 6000);
  await ev('document.getElementById("cp-grid-calibrate").click(); 0');
  await lib.settle(dm, 'gridCalArmed === true && !nwIsOpen()', 8000);
  rig.check(!(await ev('nwIsOpen()')) && await ev('document.getElementById("dock-tab-notes").disabled') && await ev('selectedPolygonId') === 1,
            'calibration left the Notes window over the map, its rail button enabled, or dropped the selection');
  await ev('document.getElementById("gridcal-done").click(); 0');
  await lib.settle(dm, 'gridCalArmed === false && nwIsOpen()', 8000);
  rig.check((await win()).open && (await win()).kind === 'Room' && !(await win()).tabOff, 'the window did not come back on the same room after calibration: ' + JSON.stringify(await win()));
  await ev('__rigClick(' + EMPTY.x + ', ' + EMPTY.y + '); 0');
  await lib.settle(dm, 'selectedPolygonId === null', 6000);

  // ── H. Two maps ───────────────────────────────────────────────────────────
  const second = await rig.fixtures.tableMap(dm, rig.fixtureDir, TALL);
  await ev('createNewScene(' + await rig.fixtures.asFileExpr(dm, second) + ')', 180000);
  await dm.waitFor('currentScene && mapWidth === ' + TALL.w, 180000, 'the second map to load');
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');
  const otherId = await ev('currentScene.id');
  await ev('switchScene(' + JSON.stringify(sceneId) + '); 0');
  await dm.waitFor('currentScene && currentScene.id === ' + JSON.stringify(sceneId) + ' && fogCoverT === 0', 60000, 'the first map');
  await ev('document.getElementById("btn-two-maps").click(); 0');
  await dm.waitFor('panesActive && panes.A.ready && panes.B.ready', 180000, 'both columns to come up');
  const paneA = await rig.pane('A'), paneB = await rig.pane('B');
  await paneA.waitFor('typeof currentScene !== "undefined" && currentScene && !!mapOffscreen', 60000, 'column A to hold a map');
  await ev('worldMapColumnFill(' + JSON.stringify(otherId) + '); 0');
  await dm.waitFor('panes.B.sceneId === ' + JSON.stringify(otherId), 60000, 'the second map in column B');
  await paneB.waitFor('typeof currentScene !== "undefined" && currentScene && !!mapOffscreen', 60000, 'column B to hold a map');
  rig.check(await paneA.evaluate('getComputedStyle(document.getElementById("notes-window")).display') === 'none', 'a column carries the Notes window');
  await ev('selectPane("A"); document.getElementById("nw-tl").focus(); 0');
  await ev('document.querySelector(\'#nw-tl .nw-row[data-key="map:' + sceneId + '"]\').click(); 0');
  await lib.settle(dm, 'document.getElementById("nw-kind").textContent === "Map" && document.getElementById("np-field").value === "The crypt floods at midnight."', 15000);
  rig.check((await win()).title === sceneName && (await win()).field === 'The crypt floods at midnight.', 'with column A selected the window is not showing its map\'s note: ' + JSON.stringify(await win()));
  await typeInto('np-field', 'A: the floor is wet.');
  await lib.poll(async () => (await paneA.evaluate('currentScene.notes')) === 'A: the floor is wet.' ? { ok: 1 } : null, 8000);
  rig.check(await paneA.evaluate('currentScene.notes') === 'A: the floor is wet.' && !(await paneB.evaluate('currentScene.notes')), 'a map note typed with column A selected did not land in column A alone');
  await ev('selectPane("B"); 0');
  const nameB = await paneB.evaluate('currentScene.name');
  await lib.settle(dm, 'document.getElementById("nw-title").value === ' + JSON.stringify(nameB), 15000);
  await typeInto('np-field', 'B: dry as bone.');
  await lib.poll(async () => (await paneB.evaluate('currentScene.notes')) === 'B: dry as bone.' ? { ok: 1 } : null, 8000);
  rig.check(await paneB.evaluate('currentScene.notes') === 'B: dry as bone.' && await paneA.evaluate('currentScene.notes') === 'A: the floor is wet.', 'a map note typed with column B selected did not land in column B alone: ' + JSON.stringify({ a: await paneA.evaluate('currentScene.notes'), b: await paneB.evaluate('currentScene.notes'), aim: await ev('_npAim'), colB: await ev('panes.B.sceneId'), other: otherId, sel: await ev('panesSelected'), win: await win() }));

  // A room of column A's map, renamed from the tree while column B is the selected one, survives A's next autosave.
  // RED ON: pane-room-patch left out of PANE_CONTROLS (paneRuntime.js) — 2026-10-30
  await paneA.evaluate('polygons.push({ id: 901, vertices: [{x:100,y:100},{x:420,y:100},{x:420,y:320},{x:100,y:320}], mode: "shroud", cornerRadius: 0, name: "Cellar", desc: "Rats." }); nextPolygonId = 902; rebuildFogFromPolygons(); doAutoSave()', 60000);
  await ev('searchStale(' + JSON.stringify(sceneId) + '); searchReadScenes()', 30000);
  await ev('_ntSig = ""; refreshRoomPanel(); 0');
  await lib.settle(dm, 'document.querySelector(\'#nw-tl .nw-row[data-key="room:' + sceneId + ':901"]\')', 10000);
  await ev(`(() => { const r = document.querySelector('#nw-tl .nw-row[data-key="room:${sceneId}:901"]'); const b = r.getBoundingClientRect();
    r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 20, clientY: b.top + 8 })); return 0; })()`);
  await lib.settle(dm, 'document.querySelector(".nw-menu")', 4000);
  await ev('[...document.querySelectorAll(".nw-menu .sm-mi")].find(b => b.textContent === "Rename").click(); 0');
  await lib.settle(dm, 'document.querySelector("#nw-tl .nw-tn input")', 4000);
  await ev(`(() => { const i = document.querySelector('#nw-tl .nw-tn input'); i.value = 'Wine cellar'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 0; })()`);
  await lib.poll(async () => (await paneA.evaluate('polygons.find(p => p.id === 901).name')) === 'Wine cellar' ? { ok: 1 } : null, 10000);
  await paneA.evaluate('doAutoSave()', 60000);
  const stored = await ev('sceneStore.loadScene(' + JSON.stringify(sceneId) + ').then(s => s.polygons.map(p => p.id + ":" + p.name).join())', 30000);
  rig.check(/901:Wine cellar/.test(stored) && /^1:/.test(stored), 'a room renamed from the tree for the other column\'s map was lost at that column\'s next autosave, or the room list was reordered: ' + stored);

  await ev('document.querySelector(`.pane-col[data-pane="B"] .pane-close`).click(); 0');
  await dm.waitFor('!panesActive', 30000, 'closing a column to end two-map mode');
  rig.byEye('the window sits over the map in the dock\'s grey with the toolbar still centred');
};
