'use strict';

// search.js — ONE SEARCH FOR EVERYTHING (item 239).
//
// THE GOAL OF THIS FEATURE: finding something no longer means knowing where it lives. One search, from anywhere, finds
// a map, a room, a group, a road, a note, a monster, a fight, a track or a picture and takes the DM to it.
//
// THE CRITERIA ARE THIS HEADER, one per line of the spec's Definition of Done
// (.claude/private/specs/item-239-search-everything.md). Matching and ranking are unit-tested (searchPlan.test.js).
// Covers src/search/search.js, src/search/searchPlan.js, src/search/searchIndex.js, src/search/searchPick.js.
//
//   1. Ctrl+F opens the search from the map, the Campaign and with a dock pane open, and not while a text field has focus.
//   2. The bar ends with a divider and Find, which opens the same search; the Campaign's Find opens it too.
//   3. Empty, it lists the 6 most recently opened things, on the map and on the Campaign, with no map pictures.
//   4. Typing lists groups by their strongest result, the first row selected, a result once; five a group with
//      "N more" opening the rest in place and typing folding it; a note hit shows its words.
//   5. Arrow keys move, Enter picks, Esc and a click outside close.
//   6. A map opens by the Manual/Auto rule from the map and from the Campaign: Manual opens it and the TV waits for Send,
//      Auto asks first. The map on the TV shows Live and opens without asking.
//   7. A room opens its map by the same rule and picks the room.
//   8. A group flies to it on the Campaign and picks it.
//   9. A monster opens the Bestiary on it, a fight the fight table, a track Music marked, a picture Pictures marked.
//  10. A note's hit opens what holds it and shows Notes on it: campaign, group, map and room notes.
//  11. On the Campaign, what does not match dims behind the box while typing.
//  12. The Bestiary keeps its own list filter.
//
// ⚠ The Player is open for 6: Manual holds a map change for it (tvWait.scene) and "Live" needs a map on the TV.
// ⚠ BY EYE: the box's look against the picked prototype (item-239/search.html, variant A).

const lib = require('../../lib');

const CELLAR = { w: 900, h: 600 }, ATTIC = { w: 1000, h: 700 };
const SQUARE = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 250 }, { x: 100, y: 250 }];

const PAGE = `
globalThis.__srType = q => { const i = document.getElementById('sr-input'); i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); return 0; };
globalThis.__srKey = c => { document.getElementById('sr-input').dispatchEvent(new KeyboardEvent('keydown', { code: c, key: c, bubbles: true, cancelable: true })); return 0; };
globalThis.__srRows = () => [...document.querySelectorAll('#sr-list .sr-row')].map(r => ({ nm: r.querySelector('.sr-nm').textContent, on: r.classList.contains('on'),
  sn: (r.querySelector('.sr-sn') || {}).textContent || '', bold: (r.querySelector('.sr-sn b') || {}).textContent || '', act: r.querySelector('.sr-act').textContent,
  live: !!r.querySelector('.sr-live'), thumb: !!r.querySelector('.sr-thumb') }));
globalThis.__srHeads = () => [...document.querySelectorAll('#sr-list .sr-gh')].map(h => h.firstChild.textContent);
globalThis.__srUp = () => document.body.classList.contains('searching') && getComputedStyle(document.getElementById('sr-veil')).display !== 'none';
`;

module.exports = async function search(rig) {
  const dm = rig.dm;
  const type = q => dm.evaluate('__srType(' + JSON.stringify(q) + ')');
  const rows = () => dm.evaluate('__srRows()');
  const heads = () => dm.evaluate('__srHeads()');
  const key = c => dm.evaluate('__srKey(' + JSON.stringify(c) + ')');
  const ctrlF = () => dm.evaluate('__rigKey("KeyF", { ctrlKey: true }); 0');
  const idle = () => lib.settle(dm, '_srProgress === null', 30000);
  const closed = () => dm.evaluate('!document.body.classList.contains("searching")');
  const pickFirst = async q => { await ctrlF(); await dm.waitFor('__srUp()', 4000, 'the search to open'); await idle(); await type(q); await key('Enter'); };
  const isOn = id => 'currentScene && currentScene.id === ' + JSON.stringify(id) + ' && fogCoverT === 0';

  // ── The library: two maps, rooms and notes, a group, a monster, a fight, a track, a picture ──
  await lib.openMap(rig, CELLAR);
  const cellarId = await dm.evaluate('currentScene.id');
  await dm.evaluate('renameScene(' + JSON.stringify(cellarId) + ', "Cellar"); 0');
  await lib.openMap(rig, ATTIC);
  const atticId = await dm.evaluate('currentScene.id');
  await dm.evaluate('renameScene(' + JSON.stringify(atticId) + ', "Attic"); 0');
  await lib.settle(dm, 'fogCoverT === 0', 30000);
  await dm.evaluate(PAGE);
  await dm.evaluate('sceneStore.updateScene(' + JSON.stringify(cellarId) + ', rec => { rec.notes = "Barrels of ember wine."; rec.polygons = [{ id: 1, vertices: ' +
    JSON.stringify(SQUARE) + ', mode: "shroud", cornerRadius: 0, name: "Wine rack", desc: "Hidden lever behind the third cask." }]; }).then(() => 1)');
  await dm.evaluate('polygons = [{ id: 1, vertices: ' + JSON.stringify(SQUARE) + ', mode: "shroud", cornerRadius: 0, name: "Vestry", desc: "Two acolytes guard the font." }];' +
    ' nextPolygonId = 2; currentScene.notes = "Brass lamps burn all night."; setShape("select"); selectedPolygonId = null; rebuildFogFromPolygons(); refreshRoomPanel(); scheduleRender(); 0');
  await dm.evaluate(`(() => {
    for (let i = 1; i <= 7; i++) cbState.blocks['g' + i] = { id: 'g' + i, name: 'Gob ' + i, cr: '1/4', meta: 'Small humanoid', ac: '15', hp: '7', abil: [8, 14, 10, 10, 8, 8], secs: {}, lore: '' };
    combatAddFight(cbState, combatFightId);
    cbState.fights.find(f => f.id === cbState.openId).name = 'Goblin ambush';
    globalThis.__ambush = cbState.openId;
    combatOpenFight(cbState, cbState.fights[0].id);
    _gaPics.unshift({ id: 'p1', name: 'Klarg portrait', blob: new Blob(['x'], { type: 'image/png' }), added: 1 });
    notesCampaignSet('The lich wakes at dusk.');
    const from = worldPlaceCreate([{ x: 5000, y: 5000 }, { x: 5600, y: 5000 }, { x: 5600, y: 5400 }, { x: 5000, y: 5400 }]);
    worldShapeRename(from, 'Frostmere');
    notesPlaceSet('Frostmere', 'Wolves howl nightly.');
    return 0;
  })()`);
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen && mapWidth === ' + ATTIC.w, 45000, 'the Attic to reach the Player');

  // ── 1. Ctrl+F ─────────────────────────────────────────────────────────────
  await ctrlF();
  await lib.settle(dm, '__srUp()', 4000);
  // RED ON: _srInput.focus() removed from searchOpen (search.js) — 2026-10-30
  rig.check(await dm.evaluate('__srUp() && document.activeElement === document.getElementById("sr-input")'), 'Ctrl+F did not open the search with its field focused');
  await key('Escape');
  // RED ON: searchClose() removed from the Escape branch of _srKey (search.js) — 2026-10-30
  rig.check(await closed(), 'Esc did not close the search');
  await dm.evaluate('dockOpen("music"); 0');
  await ctrlF();
  // RED ON: the KeyF branch in input.js refused while the Music pane is open — 2026-10-30
  rig.check(await dm.evaluate('__srUp()'), 'Ctrl+F did not open the search with a dock pane open');
  await key('Escape');
  await dm.evaluate('dockOpen("scene"); 0');
  // The key arrives from a text field: it is the field's, not the search's.
  const fieldKept = await dm.evaluate(`(() => { const i = document.createElement('input'); document.body.appendChild(i); i.focus();
    i.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
    const up = document.body.classList.contains('searching'); i.remove(); return !up; })()`);
  // RED ON: the INPUT test removed from the focused-field guard (input.js) — 2026-10-30
  rig.check(fieldKept, 'Ctrl+F opened the search while a text field had focus');

  // ── 2. The bar's Find ─────────────────────────────────────────────────────
  const tail = await dm.evaluate(`[...document.getElementById('toolbar-bottom').children].filter(e => e.getClientRects().length).slice(-2).map(e => e.id)`);
  // RED ON: #div-find hidden in index.html — 2026-10-30
  rig.check(tail.join() === 'div-find,tb-find', 'the bar does not end with a divider and Find: ' + tail.join());
  await dm.evaluate('document.getElementById("tb-find").click(); 0');
  // RED ON: searchInit's Find click loop emptied (search.js) — 2026-10-30
  rig.check(await dm.evaluate('__srUp()'), 'the bar\'s Find did not open the search');
  await key('Escape');

  // ── 3. Empty: what was opened lately ──────────────────────────────────────
  await dm.evaluate('for (const i of [1, 2, 3, 4, 5]) searchRecentAdd("monster:g" + i); 0');
  await ctrlF();
  await idle();
  const recent = await rows();
  // RED ON: SP_RECENT set to 5 (searchPlan.js) — 2026-10-30
  rig.check(recent.length === 6 && recent[0].nm === 'Gob 5' && recent[0].on && !recent.some(r => r.thumb && r.nm === 'Wine rack'),
            'the empty search is not the 6 newest things opened: ' + JSON.stringify(recent));
  rig.check((await heads()).join() === 'Recent', 'the empty search has no Recent heading: ' + (await heads()).join());
  await key('Escape');
  await dm.evaluate('worldMapShow(); 0');
  await lib.settle(dm, 'worldMapOpen && !_wmAnim', 10000);
  await ctrlF();
  await idle();
  const worldRecent = await rows();
  // RED ON: SP_RECENT set to 5 (searchPlan.js) — 2026-10-30
  rig.check(worldRecent.length === 6 && worldRecent[0].nm === 'Gob 5' && await dm.evaluate('document.querySelectorAll("#sr-list img, #sr-list .wf-row").length === 0'),
            'the Campaign\'s empty search is not the same recent list: ' + JSON.stringify(worldRecent));

  // ── 11. The Campaign dims what does not match ─────────────────────────────
  await type('cellar');
  // RED ON: _srTyped sets _wmQuery to '' (search.js) — 2026-10-30
  rig.check(await dm.evaluate('_wmQuery === "cellar" && document.querySelectorAll(".wm-card.dim, .wm-lm.dim").length > 0'), 'typing did not dim the maps that do not match');
  await key('Escape');
  rig.check(await dm.evaluate('_wmQuery === "" && document.querySelectorAll(".wm-card.dim, .wm-lm.dim").length === 0'), 'closing the search left the Campaign dimmed');
  await dm.evaluate('document.getElementById("wm-find").click(); 0');
  // RED ON: searchInit's Find click loop emptied (search.js) — 2026-10-30
  rig.check(await dm.evaluate('__srUp()'), 'the Campaign\'s Find did not open the search');
  await key('Escape');
  await dm.evaluate('worldMapHide(); 0');
  await lib.settle(dm, '!worldMapOpen', 6000);

  // ── 4. Typing ─────────────────────────────────────────────────────────────
  await ctrlF();
  await idle();
  await type('wine');
  const wine = await rows();
  const wineHeads = await heads();
  // RED ON: spSearch sorts groups by kind only (searchPlan.js) — 2026-10-30
  rig.check(wineHeads.join() === 'Rooms,Maps' && wine[0].nm === 'Wine rack' && wine[0].on && wine[1].nm === 'Cellar' && wine[1].sn.includes('wine') && wine[1].bold === 'wine',
            'groups are not ordered by their strongest result with the first row selected, or the note hit shows no words: ' + JSON.stringify({ wineHeads, wine }));
  await type('lever');
  const lever = await rows();
  // RED ON: spSnippet's excerpt starts three letters before the hit (searchPlan.js) — 2026-10-30
  rig.check(lever.length === 1 && lever[0].sn === 'Hidden lever behind the third cask.' && lever[0].bold === 'lever', 'the room note hit is not shown from a whole word: ' + JSON.stringify(lever));
  await type('gob');
  const five = await rows();
  const more = await dm.evaluate('(document.querySelector("#sr-list .sr-more") || {}).textContent');
  // RED ON: SP_PER_GROUP set to 6 (searchPlan.js) — 2026-10-30
  rig.check(five.filter(r => /^Gob \d$/.test(r.nm)).length === 5 && more === '2 more', 'a group does not show five rows and "2 more": ' + JSON.stringify({ five, more }));
  await dm.evaluate('document.querySelector("#sr-list .sr-more").click(); 0');
  // RED ON: the data-more click returns without opening the group (search.js) — 2026-10-30
  rig.check((await rows()).filter(r => /^Gob \d$/.test(r.nm)).length === 7 && await dm.evaluate('!document.querySelector("#sr-list .sr-more")'), '"N more" did not open the rest of the group in place');
  await type('gob');
  rig.check((await rows()).filter(r => /^Gob \d$/.test(r.nm)).length === 5, 'typing again did not fold the group');
  rig.check(await dm.evaluate('new Set(_srRows.map(r => r.entry.key)).size === _srRows.length'), 'a result appears twice');

  // ── 5. Keys and a click outside ───────────────────────────────────────────
  await type('gob');
  await key('ArrowDown');
  // RED ON: ArrowDown steps 0 in _srKey (search.js) — 2026-10-30
  rig.check((await rows()).findIndex(r => r.on) === 1, 'Arrow Down did not move the selection');
  await key('ArrowUp');
  rig.check((await rows()).findIndex(r => r.on) === 0, 'Arrow Up did not move the selection back');
  await dm.evaluate('document.getElementById("sr-veil").dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); 0');
  // RED ON: the veil's mousedown listener emptied (search.js) — 2026-10-30
  rig.check(await closed(), 'a click outside the box did not close it');

  // ── 6. A map: Auto asks, the map on the TV opens without asking and shows Live ──
  await ctrlF();
  await idle();
  await type('attic');
  const onTv = await rows();
  // RED ON: the Live badge branch in _srRow set to false (search.js) — 2026-10-30
  rig.check(onTv[0].nm === 'Attic' && onTv[0].live, 'the map on the TV does not show Live: ' + JSON.stringify(onTv));
  await type('cellar');
  const notLive = await rows();
  rig.check(notLive[0].nm === 'Cellar' && !notLive[0].live && notLive[0].act === 'Open and send', 'a map not on the TV shows Live, or Auto does not say Open and send: ' + JSON.stringify(notLive));
  await key('Enter');
  await lib.settle(dm, '_cdOpen', 4000);
  // RED ON: _srOpenScene never asks (searchPick.js) — 2026-10-30
  rig.check(await dm.evaluate('_cdOpen && currentScene.id === ' + JSON.stringify(atticId) + ' && autoSync'), 'Auto did not ask before opening a map');
  await dm.evaluate('document.getElementById("cd-cancel").click(); 0');
  rig.check(await dm.evaluate('currentScene.id === ' + JSON.stringify(atticId)), 'Cancel still opened the map');
  await pickFirst('cellar');
  await lib.settle(dm, '_cdOpen', 4000);
  await dm.evaluate('document.getElementById("cd-ok").click(); 0');
  await dm.waitFor(isOn(cellarId), 60000, 'the Cellar to open after the question');
  await player.waitFor('!!mapOffscreen && mapWidth === ' + CELLAR.w, 45000, 'the Cellar to reach the Player in Auto');
  await pickFirst('cellar');
  // RED ON: _srOpenScene asks unless Manual, the open and on-TV tests removed (searchPick.js) — 2026-10-30
  rig.check(await dm.evaluate('!_cdOpen && currentScene.id === ' + JSON.stringify(cellarId)), 'the map already on the TV asked before opening');

  // Manual: it opens on the DM's screen and the TV waits for Send.
  await dm.evaluate('document.getElementById("btn-auto-sync").click(); 0');
  await lib.settle(dm, '!autoSync', 4000);
  await pickFirst('attic');
  await dm.waitFor(isOn(atticId), 60000, 'the Attic to open in Manual');
  // RED ON: _srGoScene clears tvWait.scene after a Manual switch (searchPick.js) — 2026-10-30
  rig.check(await dm.evaluate('!_cdOpen && tvWait.scene === true'), 'Manual asked, or did not leave the TV waiting for Send');
  rig.check(await player.evaluate('mapWidth') === CELLAR.w, 'Manual changed the map on the TV before Send');
  // From the Campaign, Manual.
  await dm.evaluate('worldMapShow(); 0');
  await lib.settle(dm, 'worldMapOpen && !_wmAnim', 10000);
  await pickFirst('cellar');
  await dm.waitFor(isOn(cellarId) + ' && !worldMapOpen', 60000, 'the Cellar to open from the Campaign in Manual');
  // RED ON: _srGoScene opens a confirmDialog after a Manual open from the Campaign (searchPick.js) — 2026-10-30
  rig.check(await dm.evaluate('!_cdOpen'), 'Manual asked before opening a map from the Campaign');
  // Auto, from the Campaign.
  await dm.evaluate('document.getElementById("btn-auto-sync").click(); worldMapShow(); 0');
  await lib.settle(dm, 'autoSync && worldMapOpen && !_wmAnim', 10000);
  await pickFirst('attic');
  await lib.settle(dm, '_cdOpen', 4000);
  // RED ON: _srOpenScene skips the question while the Campaign is open (searchPick.js) — 2026-10-30
  rig.check(await dm.evaluate('_cdOpen && currentScene.id === ' + JSON.stringify(cellarId) + ' && worldMapOpen'), 'Auto did not ask before opening a map from the Campaign');
  await dm.evaluate('document.getElementById("cd-cancel").click(); worldMapHide(); 0');
  await lib.settle(dm, '!worldMapOpen', 6000);

  // ── 7 and 10. A room, and a note's hit: the map opens and the room is picked ──
  await dm.evaluate('document.getElementById("btn-auto-sync").click(); 0');
  await lib.settle(dm, '!autoSync', 4000);
  await dm.evaluate('switchScene(' + JSON.stringify(atticId) + '); 0');
  await dm.waitFor(isOn(atticId), 60000, 'the Attic');
  await dm.evaluate('dockOpen("scene"); 0');
  await pickFirst('wine rack');
  await dm.waitFor(isOn(cellarId) + ' && selectedPolygonId === 1', 60000, 'the Wine rack to be picked');
  // RED ON: searchPick opens a confirmDialog after a Manual room pick (searchPick.js) — 2026-10-30
  rig.check(await dm.evaluate('!_cdOpen'), 'a room asked in Manual');
  await dm.evaluate('switchScene(' + JSON.stringify(atticId) + '); 0');
  await dm.waitFor(isOn(atticId), 60000, 'the Attic');
  // The window shut: a room note hit opens it.
  await dm.evaluate('nwHide(); 0');
  await pickFirst('lever');
  await dm.waitFor(isOn(cellarId) + ' && selectedPolygonId === 1', 60000, 'the room holding the lever note');
  await lib.settle(dm, 'nwIsOpen()', 6000);
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(await dm.evaluate('nwIsOpen()'), 'a room note hit did not show Notes');
  await dm.evaluate('switchScene(' + JSON.stringify(atticId) + '); 0');
  await dm.waitFor(isOn(atticId), 60000, 'the Attic');
  await dm.evaluate('nwHide(); 0');
  await pickFirst('ember');
  // A settle, not a waitFor: a waitFor on the same state threw before the check could name the failure.
  await lib.settle(dm, isOn(cellarId) + ' && nwIsOpen() && document.getElementById("nw-kind").textContent === "Map"', 60000);
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(await dm.evaluate(isOn(cellarId) + ' && nwIsOpen() && document.getElementById("nw-kind").textContent === "Map"'), 'a map note hit did not show the map\'s notes');
  await dm.evaluate('nwHide(); 0');
  await pickFirst('lich');
  await lib.settle(dm, 'nwIsOpen() && document.getElementById("nw-kind").textContent === "Campaign"', 6000);
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(await dm.evaluate('nwIsOpen() && document.getElementById("nw-kind").textContent === "Campaign"'), 'a campaign note hit did not show the campaign notes');

  // ── 8 and 10. A group flies to it on the Campaign; its note shows its notes ──
  await dm.evaluate('nwHide(); 0');
  await pickFirst('frostmere');
  await lib.settle(dm, 'worldMapOpen && worldMapSel.place === "Frostmere"', 10000);
  // RED ON: _srPlace selects place '' (searchPick.js) — 2026-10-30
  rig.check(await dm.evaluate('worldMapOpen && worldMapSel.place === "Frostmere"'), 'a group did not open the Campaign with it picked');
  await dm.evaluate('worldMapHide(); worldMapSel = { sceneId: null, place: "" }; nwHide(); 0');
  await lib.settle(dm, '!worldMapOpen', 6000);
  await pickFirst('howl');
  await lib.settle(dm, 'worldMapOpen && worldMapSel.place === "Frostmere" && nwIsOpen()', 10000);
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(await dm.evaluate('worldMapOpen && worldMapSel.place === "Frostmere" && nwIsOpen()'), 'a group note hit did not show the group\'s notes');
  await dm.evaluate('worldMapHide(); 0');
  await lib.settle(dm, '!worldMapOpen', 6000);

  // ── 9 and 12. A monster, a fight, a track, a picture; the Bestiary keeps its filter ──
  await pickFirst('gob 3');
  await lib.settle(dm, 'bsIsOpen() && bs.open === "g3"', 6000);
  // RED ON: searchPick shows monster g1 (searchPick.js) — 2026-10-30
  rig.check(await dm.evaluate('bsIsOpen() && bs.open === "g3"'), 'a monster did not open the Bestiary on its stat block');
  await dm.evaluate('(() => { const i = document.getElementById("bs-search"); i.value = "gob 7"; i.dispatchEvent(new Event("input", { bubbles: true })); return 0; })()');
  // RED ON: _bsShown's filter passes everything (bestiary.js) — 2026-10-30
  rig.check(await dm.evaluate('_bsShown().length === 1'), 'the Bestiary\'s own filter no longer narrows its list');
  await dm.evaluate('(() => { const i = document.getElementById("bs-search"); i.value = ""; i.dispatchEvent(new Event("input", { bubbles: true })); bestiarySetOpen(false); return 0; })()');
  await pickFirst('ambush');
  await lib.settle(dm, 'cbState.openId === __ambush && document.getElementById("cb-fight").style.display === "block"', 6000);
  // RED ON: cbSetOpen(true) removed from the fight pick (searchPick.js) — 2026-10-30
  rig.check(await dm.evaluate('cbState.openId === __ambush && document.getElementById("cb-fight").style.display === "block"'), 'a fight did not open the fight table on it');
  await dm.evaluate('cbSetOpen(false); 0');
  // The folder is read again each time the pane opens, so the track is seeded after the last time it did.
  await dm.evaluate('_muTracks = [{ name: "dungeon-drums.mp3", size: 1, url: "" }]; 0');
  await pickFirst('drums');
  await lib.settle(dm, 'dockActivePane() === "music"', 6000);
  // RED ON: musicPickTrack('') in searchPick (searchPick.js) — 2026-10-30
  rig.check(await dm.evaluate('dockActivePane() === "music" && _muSearchPick === "dungeon-drums.mp3"'), 'a track did not open Music with it picked');
  await pickFirst('klarg');
  await lib.settle(dm, 'dockActivePane() === "gallery"', 6000);
  // RED ON: galleryPickPicture('') in searchPick (searchPick.js) — 2026-10-30
  rig.check(await dm.evaluate('dockActivePane() === "gallery" && _gaPicked === "p1" && !galleryOnTv("p1")'), 'a picture did not open Pictures with it picked and off the TV');

  // ── The rooms and notes are read once and kept until a scene is saved ──
  await dm.evaluate('switchScene(' + JSON.stringify(atticId) + '); 0');
  await dm.waitFor(isOn(atticId), 60000, 'the Attic');
  await dm.evaluate('sceneStore.updateScene(' + JSON.stringify(cellarId) + ', rec => { rec.polygons[0].desc = "A trapdoor under the rack."; }).then(() => 1)');
  await ctrlF();
  await idle();
  await type('trapdoor');
  // RED ON: searchStale calls removed from sceneStore.js — 2026-10-30
  rig.check((await rows()).some(r => r.nm === 'Wine rack' && r.bold === 'trapdoor'), 'a saved scene\'s new note was not found: ' + JSON.stringify(await rows()));
  await type('zzzz');
  rig.check(await dm.evaluate('document.querySelector("#sr-list .sr-msg").textContent === "No results"'), 'a search with no match did not say No results');
  await key('Escape');
  rig.byEye('the box against the picked prototype, variant A');
};
