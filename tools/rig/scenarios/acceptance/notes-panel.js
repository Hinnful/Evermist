'use strict';

// notes-panel.js — THE LEFT PANEL: BREADCRUMBS AND NOTES AT EVERY LEVEL.
//
// THE GOAL OF THIS FEATURE: the DM keeps notes for the campaign, for a scene and for a room in one
// panel on the left, and a scene with no rooms has somewhere to put them. None of it reaches the TV.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its
// letter, wherever in the file that state is cheapest to reach - which is not letter order.
//
//   A. The panel shows Campaign › Scene › Room, and the Room crumb exists only while a room is
//      selected. It runs the full height, and the minimap sits to its right.
//   I. The pane's width is dragged on its inner edge and remembered; collapsing the panel leaves a
//      floating icon and moves the minimap with it; the toolbar stays centred on the window; the
//      notes area carries the app's own scrollbar.
//   B. A click on empty map selects the scene and shows its notes.
//   C. A click on a crumb shows that level's notes and nothing else changes: the room stays
//      selected with its crumb, and the TV does not change. The levels never merge.
//   D. The room's notes and pictures are in the panel; module text still fills the room's notes
//      and still asks before it replaces them.
//   E. The Player shows nothing of it.
//   F. In two-map mode the panel follows the selected column. Opening another scene brings that
//      scene's notes, and the scene's notes scroll when they are long.
//   G. Grid calibration puts the panel away and gives it back.
//   H. Campaign, scene and room notes survive a restart, the saved scene keeps every room's
//      `vertices` and `desc` with `notes` a top-level string, and the panel remembers whether it
//      was open. This is the shape the previous release reads.
//
// ⚠ H RESTARTS THE APP, so it runs last: rig.restart() hands back a new DM session and the `dm`
// taken at the top is a dead socket after it.

const lib = require('../../lib');

const MAP_W = 2400, MAP_H = 1500;
const ROOM = { x1: 300, y1: 250, x2: 620, y2: 500 };
const INSIDE = { x: 450, y: 380 };
const EMPTY = { x: 1800, y: 1100 };
const TALL = { w: 1200, h: 1500 };

module.exports = async function notesPanelFeature(rig) {
  let dm = rig.dm;

  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await lib.settle(dm, 'fogCoverT === 0', 30000);

  await dm.evaluate('polygons = [{ id: 1, vertices: [' +
    '{ x: ' + ROOM.x1 + ', y: ' + ROOM.y1 + ' }, { x: ' + ROOM.x2 + ', y: ' + ROOM.y1 + ' },' +
    '{ x: ' + ROOM.x2 + ', y: ' + ROOM.y2 + ' }, { x: ' + ROOM.x1 + ', y: ' + ROOM.y2 + ' }],' +
    ' mode: "shroud", cornerRadius: 0, name: "The Vestry", desc: "Two acolytes." }];' +
    ' nextPolygonId = 2; setShape("select"); selectedPolygonId = null;' +
    ' rebuildFogFromPolygons(); refreshRoomPanel(); scheduleRender(); 0');

  const sceneName = await dm.evaluate('currentScene.name');
  const sceneId = await dm.evaluate('currentScene.id');

  const panel = () => dm.evaluate(`(() => {
    const p = document.getElementById('notes-panel');
    const on = p.querySelector('.np-crumb.on');
    const f = document.getElementById('np-field'), r = document.getElementById('rp-desc');
    const shown = el => !!el && el.offsetParent !== null;
    return {
      shown: shown(p) && p.getBoundingClientRect().width > 0,
      labels: [...p.querySelectorAll('.np-crumb')].map(b => b.textContent),
      levels: [...p.querySelectorAll('.np-crumb')].map(b => b.dataset.level),
      on: on ? on.dataset.level : null,
      field: shown(f) ? f.value : null,
      roomField: shown(r) ? r.value : null,
      collapsed: p.hidden,
      fab: !document.getElementById('np-fab').hidden,
    };
  })()`);
  const crumb = lv => dm.evaluate('document.querySelector("#np-crumbs .np-crumb[data-level=" + ' + JSON.stringify(lv) + ' + "]").click(); 0');
  // ⚠ THE COMMIT IS ON THE FIELD'S OWN blur LISTENER, and el.blur() does not reliably fire one in a
  // window the OS has not focused, so the events go at the listeners directly.
  const typeInto = (id, value) => dm.evaluate(`(() => {
    const el = document.getElementById(${JSON.stringify(id)});
    if (!el) return { err: 'no field ' + ${JSON.stringify(id)} };
    el.dispatchEvent(new FocusEvent('focus'));
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur'));
    return { ok: true };
  })()`);
  const ledger = () => dm.evaluate(`({
    scene: currentScene ? currentScene.notes : null,
    campaign: localStorage.getItem('evermist.campaignNotes'),
    room: polygons.length ? polygons[0].desc : null,
    selected: selectedPolygonId,
  })`);

  // A Player on the TV, and a record of every message it is sent from here on.
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen', 45000, 'the Player to receive the map');
  await player.evaluate('globalThis.__npMsgs = []; window.addEventListener("message", e => __npMsgs.push(e.data && e.data.type)); 0');
  // Text and element count, not the markup: the cover's classes change on their own timers.
  const tvDom = () => player.evaluate('document.body.querySelectorAll("*").length + "|" + document.body.textContent');
  const tvDomBefore = await tvDom();

  // ── A. The crumbs ─────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const bare = await panel();
  rig.check(bare.shown, 'the left panel is not on screen with a scene open');
  rig.check(bare.labels.length === 2 && bare.levels.join() === 'campaign,scene' && bare.labels[1] === sceneName,
            'with no room selected the crumbs are not Campaign › Scene: ' + JSON.stringify(bare));
  // RED BY DESIGN: written against the fix, never re-proved
  const both = await dm.evaluate('["panel-room", "np-field"].map(id => getComputedStyle(document.getElementById(id)).display)');
  rig.check(both[0] === 'none' && both[1] !== 'none',
            'the scene level shows with the room level also on screen, so two notes are open at once: ' + JSON.stringify(both));
  rig.check(bare.on === 'scene' && bare.field === '',
            'with no room selected the scene level is not the one showing: ' + JSON.stringify(bare));

  await dm.evaluate('__rigClick(' + INSIDE.x + ', ' + INSIDE.y + '); 0');
  await lib.settle(dm, 'selectedPolygonId === 1', 6000);
  const inRoom = await panel();
  rig.check(inRoom.levels.join() === 'campaign,scene,room' && inRoom.labels[2] === 'The Vestry' && inRoom.on === 'room',
            'selecting a room did not add its crumb and show its level: ' + JSON.stringify(inRoom));
  // A crumb trail too long for the panel: the room's crumb reads in full, the ones before it give way,
  // and each names itself on hover.
  // RED ON: the shrink-first .np-crumb rules removed (notesPanel.css) — 2026-10-09
  await dm.evaluate('polygons[0].name = "The Bell Vestry"; refreshRoomPanel(); 0');
  await lib.settle(dm, 'document.querySelector("#np-crumbs .np-crumb:last-child").textContent === "The Bell Vestry"', 6000);
  const trail = await dm.evaluate(`(() => {
    const box = document.getElementById('np-crumbs'), cs = [...box.querySelectorAll('.np-crumb')];
    const natural = [...box.children].reduce((w, c) => w + (c.classList.contains('np-crumb') ? c.scrollWidth : c.offsetWidth), 0);
    // In the crumb's own px, as min-width is: the on-screen rect carries the interface zoom.
    const floor = parseFloat(getComputedStyle(cs[0]).minWidth) + 1;
    return { tight: natural > box.clientWidth, crumbs: cs.map(b => ({ text: b.textContent, title: b.title, cut: b.scrollWidth > b.clientWidth + 1, atFloor: b.clientWidth <= floor })) };
  })()`);
  rig.note('the crumb trail: ' + JSON.stringify(trail));
  rig.check(trail.tight, 'the crumb trail fits the panel, so it proves nothing about which crumb gives way: ' + JSON.stringify(trail));
  // ⚠ A WIDER FONT (macOS) can leave too little room even with the earlier crumbs at their floor: the room's crumb may
  // then be cut, but only once every crumb before it has given all it can.
  rig.check((!trail.crumbs[trail.crumbs.length - 1].cut || trail.crumbs.slice(0, -1).every(c => c.atFloor)) && trail.crumbs.every(c => c.title === c.text),
            "the current crumb is cut short while earlier ones are not, or a crumb has no full name on hover: " + JSON.stringify(trail));
  await dm.evaluate('polygons[0].name = "The Vestry"; refreshRoomPanel(); 0');
  await lib.settle(dm, 'document.querySelector("#np-crumbs .np-crumb:last-child").textContent === "The Vestry"', 6000);
  const onlyRoom = await dm.evaluate('["panel-room", "np-field"].map(id => getComputedStyle(document.getElementById(id)).display)');
  rig.check(onlyRoom[0] !== 'none' && onlyRoom[1] === 'none', 'the room level shows with the scene level also on screen: ' + JSON.stringify(onlyRoom));
  rig.check(inRoom.roomField === 'Two acolytes.' && inRoom.field === null,
            "the room's notes are not what the panel shows for a selected room: " + JSON.stringify(inRoom));

  // The panel runs the full height, and the minimap sits to its right, bottom left of the map.
  const geoNow = () => dm.evaluate(`(() => {
    const p = document.getElementById('notes-panel').getBoundingClientRect();
    const m = document.getElementById('minimap-panel').getBoundingClientRect();
    return { panelTop: p.top, panelBottom: p.bottom, panelRight: p.right, miniLeft: m.left, miniBottom: m.bottom, h: innerHeight };
  })()`);
  const geo = await geoNow();
  rig.check(geo.panelTop <= 1 && geo.panelBottom >= geo.h - 1 && geo.miniLeft >= geo.panelRight && geo.miniLeft - geo.panelRight < 40 && geo.miniBottom > geo.h - 40,
            'the panel is not full height, or the minimap is not stuck to its right edge: ' + JSON.stringify(geo));

  // ── I. Width, collapse and scrollbar ──────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const edge = await dm.evaluate('(() => { const r = document.getElementById("np-edge").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()');
  await dm.evaluate(`(() => {
    const e = document.getElementById('np-edge');
    const at = (t, x, tgt) => tgt.dispatchEvent(new MouseEvent(t, { clientX: x, clientY: ${edge.y}, bubbles: true, button: 0 }));
    at('mousedown', ${edge.x}, e); at('mousemove', ${edge.x} + 60, window); at('mouseup', ${edge.x} + 60, window);
    return 0;
  })()`);
  const wide = await geoNow();
  // The pane stops where the toolbar would no longer fit, so a small window may allow no growth at all.
  const room = await dm.evaluate('_npMaxW(document.getElementById("notes-panel")) - 220');
  rig.note('room to widen the pane in this window: ' + Math.round(room) + 'px');
  if (room > 30) {
    rig.check(wide.panelRight > geo.panelRight + 20 && wide.miniLeft >= wide.panelRight && wide.miniLeft - wide.panelRight < 40,
              'dragging the panel edge did not widen it, or the minimap did not follow: ' + JSON.stringify([geo, wide]));
    rig.check(await dm.evaluate('+localStorage.getItem("evermist.notesWidth") > 220'), 'the dragged width was not remembered');
  } else {
    rig.check(wide.panelRight <= geo.panelRight + 1 && wide.miniLeft >= wide.panelRight,
              'the pane grew past where the toolbar still fits: ' + JSON.stringify([geo, wide]));
  }
  const bar = await dm.evaluate('getComputedStyle(document.getElementById("np-body"), "::-webkit-scrollbar").width');
  rig.check(bar === '8px', 'the notes area has no visible scrollbar of the app\'s own: ' + bar);
  const centred = () => dm.evaluate('(() => { const r = document.getElementById("toolbar-bottom").getBoundingClientRect();' +
    ' return Math.abs((r.left + r.right) / 2 - innerWidth / 2); })()');
  rig.check(await centred() < 2, 'the toolbar is not centred on the window with the panel open: off by ' + await centred());
  await dm.evaluate('document.getElementById("np-toggle").click(); 0');
  await lib.settle(dm, 'document.getElementById("notes-panel").hidden', 6000);
  rig.check((await panel()).fab && await centred() < 2,
            'collapsing the panel left no floating icon, or moved the toolbar: ' + JSON.stringify(await panel()));
  const shut = await geoNow();
  rig.check(shut.panelRight < wide.panelRight - 20 && shut.panelRight < 60 && shut.miniLeft >= shut.panelRight && shut.miniLeft < wide.miniLeft - 20,
            'collapsing the panel did not leave the rail alone and bring the minimap with it: ' + JSON.stringify([wide, shut]));
  await dm.evaluate('document.getElementById("np-fab").click(); 0');
  await lib.settle(dm, '!document.getElementById("notes-panel").hidden', 6000);

  // ── B. An empty-map click selects the scene ───────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('__rigClick(' + EMPTY.x + ', ' + EMPTY.y + '); 0');
  await lib.settle(dm, 'selectedPolygonId === null', 6000);
  await lib.settle(dm, '!document.getElementById("np-field").hidden', 6000);
  const empty = await panel();
  rig.check(empty.levels.join() === 'campaign,scene' && empty.on === 'scene' && empty.field !== null,
            'a click on empty map did not leave the scene level showing: ' + JSON.stringify(empty));
  await typeInto('np-field', 'The crypt floods at midnight.');
  await lib.settle(dm, 'currentScene.notes === "The crypt floods at midnight."', 6000);
  rig.check((await ledger()).scene === 'The crypt floods at midnight.',
            'scene notes typed into the panel never reached the scene: ' + JSON.stringify(await ledger()));

  // The scene notes scroll when they are long, with the app's own scrollbar.
  // RED BY DESIGN: written against the fix, never re-proved
  await typeInto('np-field', Array.from({ length: 120 }, (_, i) => 'Line ' + i).join('\n'));
  const scroll = await dm.evaluate(`(() => {
    const f = document.getElementById('np-field');
    f.scrollTop = 0; const top = f.scrollTop; f.scrollTop = 300;
    return { tall: f.scrollHeight > f.clientHeight + 100, moved: f.scrollTop > top,
             overflow: getComputedStyle(f).overflowY, bar: getComputedStyle(f, '::-webkit-scrollbar').width };
  })()`);
  rig.check(scroll.tall && scroll.moved && scroll.overflow === 'auto' && scroll.bar === '8px',
            'long scene notes do not scroll, or carry no scrollbar of the app\'s own: ' + JSON.stringify(scroll));
  await typeInto('np-field', 'The crypt floods at midnight.');
  await lib.settle(dm, 'currentScene.notes === "The crypt floods at midnight."', 6000);

  // Escape leaves the notes field and keeps what was typed.
  // RED ON: Escape reverting every field to dataset.orig (_rpWireField, roomCard.js) — 2026-10-09
  await dm.evaluate(`(() => { const el = document.getElementById('np-field');
    el.dispatchEvent(new FocusEvent('focus')); el.value = 'The crypt floods at dawn.';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur')); return 0; })()`);
  await lib.settle(dm, 'currentScene.notes === "The crypt floods at dawn."', 6000);
  rig.check((await ledger()).scene === 'The crypt floods at dawn.' && (await panel()).field === 'The crypt floods at dawn.',
            'Escape in the notes field threw away what was typed: ' + JSON.stringify(await ledger()));
  await typeInto('np-field', 'The crypt floods at midnight.');
  await lib.settle(dm, 'currentScene.notes === "The crypt floods at midnight."', 6000);

  // ── C. A crumb picks a level and the TV does not change ───────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await player.evaluate('__npMsgs.length = 0; 0');
  await crumb('campaign');
  await lib.settle(dm, 'document.querySelector("#np-crumbs .np-crumb.on").dataset.level === "campaign"', 6000);
  const camp = await panel();
  rig.check(camp.on === 'campaign' && camp.field === '',
            'the Campaign crumb did not show the campaign level, empty on a first run: ' + JSON.stringify(camp));
  await typeInto('np-field', 'The duke is a lich.');
  await lib.settle(dm, 'localStorage.getItem("evermist.campaignNotes") === "The duke is a lich."', 6000);
  rig.check((await ledger()).campaign === 'The duke is a lich.' && (await ledger()).scene === 'The crypt floods at midnight.',
            'campaign notes did not land in their own store, or they overwrote the scene notes: ' + JSON.stringify(await ledger()));

  await crumb('scene');
  await lib.settle(dm, 'document.querySelector("#np-crumbs .np-crumb.on").dataset.level === "scene"', 6000);
  rig.check((await panel()).field === 'The crypt floods at midnight.',
            'the Scene crumb did not bring the scene notes back: ' + JSON.stringify(await panel()));

  // The levels are separate: a crumb picks one, and the room stays selected with its crumb.
  await dm.evaluate('__rigClick(' + INSIDE.x + ', ' + INSIDE.y + '); 0');
  await lib.settle(dm, 'selectedPolygonId === 1', 6000);
  await crumb('scene');
  await lib.settle(dm, 'document.querySelector("#np-crumbs .np-crumb.on").dataset.level === "scene"', 6000);
  const sceneBesideRoom = await panel();
  rig.check(sceneBesideRoom.levels.join() === 'campaign,scene,room' && sceneBesideRoom.field === 'The crypt floods at midnight.' &&
            sceneBesideRoom.roomField === null && await dm.evaluate('selectedPolygonId') === 1,
            'the Scene crumb deselected the room, dropped its crumb, or merged the two levels: ' + JSON.stringify(sceneBesideRoom));
  await crumb('room');
  await lib.settle(dm, 'document.querySelector("#np-crumbs .np-crumb.on").dataset.level === "room"', 6000);
  const roomAgain = await panel();
  rig.check(roomAgain.roomField === 'Two acolytes.' && roomAgain.field === null && await dm.evaluate('selectedPolygonId') === 1,
            'the Room crumb did not bring the room notes back, alone: ' + JSON.stringify(roomAgain));
  await crumb('campaign');
  await lib.settle(dm, 'document.querySelector("#np-crumbs .np-crumb.on").dataset.level === "campaign"', 6000);
  const campBesideRoom = await panel();
  rig.check(campBesideRoom.field === 'The duke is a lich.' && campBesideRoom.levels.length === 3 && await dm.evaluate('selectedPolygonId') === 1,
            'the Campaign crumb deselected the room or dropped its crumb: ' + JSON.stringify(campBesideRoom));
  // Picking a room again follows it, and an empty click leaves for the scene.
  await dm.evaluate('selectedPolygonId = null; refreshRoomPanel(); __rigClick(' + INSIDE.x + ', ' + INSIDE.y + '); 0');
  await lib.settle(dm, 'selectedPolygonId === 1', 6000);
  rig.check((await panel()).on === 'room', 'picking a room while the campaign level showed did not move to the room');
  await crumb('campaign');
  await dm.evaluate('__rigClick(' + EMPTY.x + ', ' + EMPTY.y + '); 0');
  await lib.settle(dm, 'selectedPolygonId === null', 6000);
  await lib.settle(dm, 'document.querySelector("#np-crumbs .np-crumb.on").dataset.level === "scene"', 6000);
  rig.check((await panel()).on === 'scene', 'an empty-map click left the campaign level showing');

  await lib.hold(1500, 'long enough for a crumb click to have pushed something to the TV, then prove it did not');
  const TV_CHANGES = ['fog-update', 'tv-picture', 'scene-transition', 'view-snap', 'fog-color'];
  const tvMsgs = (await player.evaluate('__npMsgs')).filter(m => TV_CHANGES.includes(m));
  rig.check(tvMsgs.length === 0, 'a crumb click, a room pick or a note changed what the TV shows: ' + JSON.stringify(tvMsgs));

  // ── D. The room's notes and pictures live here; module text still asks ────
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('__rigClick(' + INSIDE.x + ', ' + INSIDE.y + '); 0');
  await lib.settle(dm, 'selectedPolygonId === 1', 6000);
  const home = await dm.evaluate(`(() => {
    const p = document.getElementById('notes-panel');
    return { notes: p.contains(document.getElementById('rp-desc')), pics: p.contains(document.getElementById('rp-pic-add')),
             tab: document.getElementById('dock').contains(document.getElementById('rp-desc')) || document.getElementById('dock').contains(document.getElementById('rp-pic-add')) };
  })()`);
  rig.check(home.notes && home.pics && !home.tab,
            'the room notes and the picture button are not in the left panel alone: ' + JSON.stringify(home));
  await typeInto('rp-desc', 'Two acolytes and a font.');
  await lib.settle(dm, 'polygons[0].desc === "Two acolytes and a font."', 6000);

  await dm.evaluate('applyModuleEntryToRoom({ title: "K1. The Gatehouse", body: "Two guards stand here." }); 0');
  await lib.settle(dm, "document.getElementById('cd-anchor') && document.getElementById('cd-anchor').style.display === 'flex'", 6000);
  const ask = await dm.evaluate(`({ title: document.getElementById('cd-title').textContent,
    name: polygons[0].name, desc: polygons[0].desc })`);
  rig.check(ask.title === 'Replace description?' && ask.desc === 'Two acolytes and a font.' && ask.name === 'K1. The Gatehouse',
            'filling a room that has notes did not ask first, or it replaced them before the answer: ' + JSON.stringify(ask));
  await dm.evaluate('document.getElementById("cd-cancel").click(); 0');
  await lib.settle(dm, "document.getElementById('cd-anchor').style.display !== 'flex'", 6000);
  rig.check(await dm.evaluate('polygons[0].desc') === 'Two acolytes and a font.',
            'Keep mine still replaced the room notes');

  await dm.evaluate('applyModuleEntryToRoom({ title: "K2. The Chapel", body: "A font of black water." }); 0');
  await lib.settle(dm, "document.getElementById('cd-anchor').style.display === 'flex'", 6000);
  await dm.evaluate('document.getElementById("cd-ok").click(); 0');
  await lib.settle(dm, 'polygons[0].desc === "A font of black water."', 6000);
  rig.check((await panel()).roomField === 'A font of black water.',
            "the panel's room field did not show the module text that filled it: " + JSON.stringify(await panel()));
  // A long entry shows whole: the field grows to the text it was filled with, as it does to typing.
  // RED ON: _rpFitNotes() removed from _rpSyncEntryFields (roomCard.js) — 2026-10-09
  await dm.evaluate('applyModuleEntryToRoom({ title: "K3. The Long Hall", body: Array.from({ length: 14 }, (_, i) => "Line " + i + " of a long room description.").join("\\n") }); 0');
  await lib.settle(dm, "document.getElementById('cd-anchor').style.display === 'flex'", 6000);
  await dm.evaluate('document.getElementById("cd-ok").click(); 0');
  await lib.settle(dm, 'polygons[0].desc.startsWith("Line 0")', 6000);
  const fit = await dm.evaluate('(el => ({ scroll: el.scrollHeight, client: el.clientHeight }))(document.getElementById("rp-desc"))');
  rig.check(fit.scroll <= fit.client + 1, 'a long module entry is cut off in the room field until the DM types in it: ' + JSON.stringify(fit));
  await typeInto('rp-desc', 'Two acolytes.');
  await lib.settle(dm, 'polygons[0].desc === "Two acolytes."', 6000);

  // ── E. The Player shows nothing of it ─────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const tv = await player.evaluate(`({
    shown: (() => { const p = document.getElementById('notes-panel'); return !!p && p.getBoundingClientRect().width > 0; })(),
    leaked: [...document.querySelectorAll('textarea')].some(t => /lich|floods|acolyte/i.test(t.value)),
  })`);
  rig.check(!tv.shown && !tv.leaked, 'the Player shows the notes panel, or holds what was typed into it: ' + JSON.stringify(tv));
  rig.check(await tvDom() === tvDomBefore, 'the Player page gained or lost elements or text while the notes were edited');

  // ── G. Calibration puts the panel away ────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('document.getElementById("cp-grid-calibrate").click(); 0');
  await lib.settle(dm, 'gridCalArmed === true', 8000);
  await lib.settle(dm, 'document.getElementById("notes-panel").hidden', 6000);
  rig.check(await dm.evaluate('document.getElementById("notes-panel").hidden') && await dm.evaluate('selectedPolygonId') === 1,
            'the panel stayed over the map that calibration has to be dragged on, or calibration dropped the selection');
  await dm.evaluate('document.getElementById("gridcal-done").click(); 0');
  await lib.settle(dm, 'gridCalArmed === false', 8000);
  await lib.settle(dm, '!document.getElementById("notes-panel").hidden', 6000);
  rig.check((await panel()).shown && (await panel()).on === 'room',
            'the panel did not come back on the same room after calibration: ' + JSON.stringify(await panel()));
  await dm.evaluate('__rigClick(' + EMPTY.x + ', ' + EMPTY.y + '); 0');
  await lib.settle(dm, 'selectedPolygonId === null', 6000);

  // ── F. Two maps: the panel follows the selected column ────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  // A room is showing when the scene changes, so the level has to fall to the new scene's notes.
  await dm.evaluate('__rigClick(' + INSIDE.x + ', ' + INSIDE.y + '); 0');
  await lib.settle(dm, 'selectedPolygonId === 1', 6000);
  const second = await rig.fixtures.tableMap(dm, rig.fixtureDir, TALL);
  await dm.evaluate('createNewScene(' + await rig.fixtures.asFileExpr(dm, second) + ')', 180000);
  await dm.waitFor('currentScene && mapWidth === ' + TALL.w, 180000, 'the second map to load');
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');
  const otherId = await dm.evaluate('currentScene.id');
  // RED BY DESIGN: written against the fix, never re-proved
  await lib.settle(dm, 'document.getElementById("np-field").value === ""', 8000);
  const other = await panel();
  rig.check(other.labels[1] !== sceneName && other.on === 'scene' && other.field === '' && other.levels.length === 2,
            "opening another scene left the first scene's notes, or its room, in the panel: " + JSON.stringify(other));
  await dm.evaluate('switchScene(' + JSON.stringify(sceneId) + '); 0');
  await dm.waitFor('currentScene && currentScene.id === ' + JSON.stringify(sceneId) + ' && fogCoverT === 0', 60000, 'the first scene');
  await lib.settle(dm, 'document.getElementById("np-field").value === "The crypt floods at midnight."', 8000);
  rig.check((await panel()).field === 'The crypt floods at midnight.' && (await panel()).labels[1] === sceneName,
            'switching back to the first scene did not bring its notes back: ' + JSON.stringify(await panel()));

  await dm.evaluate('document.getElementById("btn-two-maps").click(); 0');
  await dm.waitFor('panesActive && panes.A.ready && panes.B.ready', 180000, 'both columns to come up');
  const paneA = await rig.pane('A');
  const paneB = await rig.pane('B');
  await paneA.waitFor('typeof currentScene !== "undefined" && currentScene && !!mapOffscreen', 60000, 'column A to hold a map');
  await dm.evaluate('worldMapColumnFill(' + JSON.stringify(otherId) + '); 0');   // the double-click on the world map, which closes it
  await dm.waitFor('panes.B.sceneId === ' + JSON.stringify(otherId), 60000, 'the second map to land in column B');
  await paneB.waitFor('typeof currentScene !== "undefined" && currentScene && !!mapOffscreen', 60000, 'column B to hold a map');

  const nameA = await paneA.evaluate('currentScene.name');
  const nameB = await paneB.evaluate('currentScene.name');
  await dm.evaluate('selectPane("A"); 0');
  await lib.settle(dm, 'document.querySelector("#np-crumbs .np-crumb:last-child").textContent === ' + JSON.stringify(nameA), 15000);
  rig.check((await panel()).labels[1] === nameA && (await panel()).field === 'The crypt floods at midnight.',
            "with column A selected the panel is not showing A's scene and its notes: " + JSON.stringify(await panel()));
  await typeInto('np-field', 'A: the floor is wet.');
  await lib.poll(async () => (await paneA.evaluate('currentScene.notes')) === 'A: the floor is wet.' ? { ok: 1 } : null, 8000);
  rig.check(await paneA.evaluate('currentScene.notes') === 'A: the floor is wet.' && !(await paneB.evaluate('currentScene.notes')),
            'scene notes typed with column A selected did not land in column A alone');

  await dm.evaluate('selectPane("B"); 0');
  await lib.settle(dm, 'document.querySelector("#np-crumbs .np-crumb:last-child").textContent === ' + JSON.stringify(nameB), 15000);
  rig.check((await panel()).labels[1] === nameB && (await panel()).field === '',
            "with column B selected the panel is not showing B's scene, empty: " + JSON.stringify(await panel()));
  await typeInto('np-field', 'B: dry as bone.');
  await lib.poll(async () => (await paneB.evaluate('currentScene.notes')) === 'B: dry as bone.' ? { ok: 1 } : null, 8000);
  rig.check(await paneB.evaluate('currentScene.notes') === 'B: dry as bone.' && await paneA.evaluate('currentScene.notes') === 'A: the floor is wet.',
            'scene notes typed with column B selected did not land in column B alone');

  // A room selected in column B: the Room crumb appears, and the Scene crumb leaves it selected there.
  await paneB.evaluate('polygons.push({ id: 901, vertices: [{x:100,y:100},{x:420,y:100},{x:420,y:320},{x:100,y:320}],' +
    ' mode: "shroud", cornerRadius: 0, name: "Cellar", desc: "Rats." }); nextPolygonId = 902; rebuildFogFromPolygons();' +
    ' setShape("select"); selectedPolygonId = 901; drawCursor(lastScreenX, lastScreenY); 0');
  await lib.settle(dm, 'document.querySelectorAll("#np-crumbs .np-crumb").length === 3', 15000);
  rig.check((await panel()).labels[2] === 'Cellar' && (await panel()).roomField === 'Rats.',
            "a room selected in the selected column did not reach the panel: " + JSON.stringify(await panel()));
  await typeInto('rp-desc', 'Rats, and one very large rat.');
  await lib.poll(async () => (await paneB.evaluate('polygons.find(p => p.id === 901).desc')) === 'Rats, and one very large rat.' ? { ok: 1 } : null, 8000);
  rig.check(await paneB.evaluate('polygons.find(p => p.id === 901).desc') === 'Rats, and one very large rat.',
            'room notes typed in the panel did not land in the selected column');
  await crumb('scene');
  await lib.settle(dm, 'document.querySelector("#np-crumbs .np-crumb.on").dataset.level === "scene"', 15000);
  rig.check((await panel()).field === 'B: dry as bone.' && (await panel()).levels.length === 3 && await paneB.evaluate('selectedPolygonId') === 901,
            "the Scene crumb deselected column B's room, or did not show its scene's notes: " + JSON.stringify(await panel()));
  await crumb('room');
  await lib.settle(dm, 'document.getElementById("rp-desc").value === "Rats, and one very large rat."', 15000);
  rig.check((await panel()).on === 'room', 'the Room crumb did not bring column B\'s room notes back');

  await dm.evaluate('document.querySelector(`.pane-col[data-pane="B"] .pane-close`).click(); 0');
  await dm.waitFor('!panesActive', 30000, 'closing a column to end two-map mode');
  await dm.waitFor('currentScene && currentScene.id === ' + JSON.stringify(sceneId) + ' && fogCoverT === 0', 60000, 'the first scene to come back');

  // ── H. Everything survives a restart ──────────────────────────────────────
  // Notes still under the cursor when the app closes are saved: the close fires no blur.
  // RED ON: the beforeunload listener in initNotesPanel removed (notesPanel.js) — 2026-10-09
  await lib.settle(dm, '!document.getElementById("np-field").hidden', 8000);
  await dm.evaluate(`(() => { const el = document.getElementById('np-field'); el.focus();
    el.value = 'A: the floor is wet. The door sticks.'; el.dispatchEvent(new Event('input', { bubbles: true }));
    window.dispatchEvent(new Event('beforeunload')); return 0; })()`);
  const closed = await lib.poll(async () => {
    const n = await dm.evaluate('sceneStore.loadScene(' + JSON.stringify(sceneId) + ').then(s => s && s.notes)');
    return n === 'A: the floor is wet. The door sticks.' ? { n } : null;
  }, 15000);
  rig.check(!!closed, 'notes typed with the cursor still in the field were lost when the app closed');
  await dm.evaluate('document.getElementById("np-field").blur(); 0');
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('document.getElementById("np-toggle").click(); 0');
  rig.check((await panel()).collapsed && await dm.evaluate('localStorage.getItem("evermist.notesPanelOpen")') === '0',
            'the collapse button did not collapse the panel and remember it');
  await dm.evaluate('doAutoSave()', 60000);
  dm = await rig.restart();
  await lib.installHelpers(dm);
  await lib.settle(dm, 'currentScene && currentScene.id === ' + JSON.stringify(sceneId) + ' && fogCoverT === 0', 90000);

  const record = await dm.evaluate(`(async () => {
    const s = await sceneStore.loadScene(${JSON.stringify(sceneId)});
    return { notes: s.notes, notesType: typeof s.notes,
             polys: (s.polygons || []).map(p => ({ vertices: Array.isArray(p.vertices) && p.vertices.length, desc: p.desc })) };
  })()`);
  rig.check(record.notesType === 'string' && record.notes === 'A: the floor is wet. The door sticks.',
            'the saved scene does not carry its notes as a top-level string: ' + JSON.stringify(record));
  rig.check(record.polys.length === 1 && record.polys[0].vertices === 4 && record.polys[0].desc === 'Two acolytes.',
            'a saved room lost its vertices or its desc, the shape the previous release reads: ' + JSON.stringify(record.polys));
  rig.check(await dm.evaluate('localStorage.getItem("evermist.campaignNotes")') === 'The duke is a lich.',
            'the campaign notes did not survive the restart');

  const back = await panel();
  rig.check(back.collapsed, 'the panel came up open after the DM left it collapsed');
  await dm.evaluate('document.getElementById("np-fab").click(); 0');
  await dm.evaluate('__rigClick(' + EMPTY.x + ', ' + EMPTY.y + '); 0');
  await lib.settle(dm, '!document.getElementById("np-field").hidden && document.getElementById("np-field").value !== ""', 8000);
  rig.check((await panel()).field === 'A: the floor is wet. The door sticks.',
            'after a restart the scene level does not show the notes it was left with: ' + JSON.stringify(await panel()));
  await crumb('campaign');
  await lib.settle(dm, 'document.getElementById("np-field").value === "The duke is a lich."', 8000);
  rig.check((await panel()).field === 'The duke is a lich.', 'after a restart the campaign level does not show its notes');

  rig.byEye('the panel sits bottom-left above the minimap, with the toolbar still centred between them');
};
