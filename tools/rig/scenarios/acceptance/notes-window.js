'use strict';

// notes-window.js — THE NOTES WINDOW: ONE WINDOW, THE WHOLE CAMPAIGN AS A TREE BESIDE THE NOTE.
//
// THE GOAL OF THIS FEATURE: the DM keeps a note for anything in the campaign - a map, a room, a group, a road, a
// monster, a faction, a piece of lore - in a window they place anywhere, and reaches any of them from a tree.
// None of it reaches the TV.
//
// Drives src/notes/notesWindow.js, src/notes/notesTree.js, src/notes/notesTreePlan.js, src/notes/notesEntries.js and
// src/notes/notesEntriesPlan.js.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its letter.
//
//   A. Notes on the rail opens and shuts a window the DM moves by its header and resizes by its corner; the
//      rail dot shows while it is open; Esc shuts it. It opens with no map open, on a fresh library, with the
//      campaign note and empty sections, and its "+ New" offers Monster or NPC, Faction or Lore.
//   B. The rail reads Campaign, Notes, Bestiary; a divider; Map settings; a divider; the table tools.
//   C. The tree shows the campaign, its maps and their rooms, then Monsters and NPCs (a DM note, or made with
//      "+ New"), Factions and Lore.
//   D. The header holds hide-tree, back, forward and the breadcrumbs; a crumb opens that level; the middle folds
//      into "…" with a list when narrow.
//   E. A monster's note is its DM notes, editable, the book's lore folded below read-only, with a Stat block
//      button that opens the Bestiary on it.
//   F. Clicking a title renames the entry, for every kind but the campaign; a group's notes follow its name.
//   G. "+ New" makes another of the selected kind beside it with its title ready to type; on a map it asks.
//   H. A right-click offers Rename, New inside (factions and lore), Delete and Show on map, each kind its own;
//      Delete on a room of a map that is not held is greyed and says why in the row. The menu opens at the pointer. The campaign's menu
//      offers Expand all and Collapse all.
//   I. Delete asks with confirmDialog; a faction with children names the count, removes them all, and the window
//      moves to its parent.
//   J. Factions and lore drag to reorder and nest inside their own section.
//   K. In the tree, arrows move, Enter opens and Ctrl+R renames.
//   L. Show on map opens a map or a room on another map by the Manual/Auto rule.
//   M. Search finds factions, lore and a monster's DM note.
//   N. The window's place, size, tree width and hidden tree survive a restart; factions and lore too.

const lib = require('../../lib');

const MAP_W = 2400, MAP_H = 1500;

module.exports = async function notesWindowFeature(rig) {
  let dm = rig.dm;
  const ev = (expr, ms) => dm.evaluate(expr, ms);
  const shown = () => ev('(() => { const w = document.getElementById("notes-window"); const r = w.getBoundingClientRect(); return !w.hidden && r.width > 0 && r.height > 0; })()');
  const rows = () => ev('[...document.querySelectorAll("#nw-tl .nw-row")].map(r => ({ key: r.dataset.key, name: r.querySelector(".nw-tn").textContent, sel: r.classList.contains("sel"), sec: r.classList.contains("sec") }))');
  const rowKeys = async () => (await rows()).map(r => r.key);
  const click = key => ev('document.querySelector(\'#nw-tl .nw-row[data-key="\' + CSS.escape(' + JSON.stringify(key) + ') + \'"]\').click(); 0');
  const field = () => ev('(() => { const f = document.getElementById("np-field"); const t = document.getElementById("nw-title"); return { hidden: f.hidden, value: f.value, title: t.hidden ? null : t.value, kind: document.getElementById("nw-kind").textContent }; })()');
  const crumbs = () => ev('[...document.querySelectorAll("#nw-crumbs .nw-crumb")].map(c => c.textContent)');
  // ⚠ THE COMMIT IS ON THE FIELD'S OWN blur LISTENER, and el.blur() does not reliably fire one in a window the OS
  // has not focused, so the events go at the listeners directly.
  const typeInto = (id, value) => ev(`(() => {
    const el = document.getElementById(${JSON.stringify(id)});
    el.dispatchEvent(new FocusEvent('focus'));
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur'));
    return 0; })()`);
  const key = (el, k, mods) => ev(`document.querySelector(${JSON.stringify(el)}).dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: ${JSON.stringify(k)}, code: ${JSON.stringify(k.length === 1 ? 'Key' + k.toUpperCase() : k)}, bubbles: true, cancelable: true }, ${JSON.stringify(mods || {})}))); 0`);
  const askAnswer = async yes => {
    await lib.settle(dm, "document.getElementById('cd-anchor') && document.getElementById('cd-anchor').style.display === 'flex'", 6000);
    const q = await ev('({ title: document.getElementById("cd-title").textContent, msg: document.getElementById("cd-msg").textContent })');
    await ev('document.getElementById(' + (yes ? '"cd-ok"' : '"cd-cancel"') + ').click(); 0');
    await lib.settle(dm, "document.getElementById('cd-anchor').style.display !== 'flex'", 6000);
    return q;
  };
  const menuRows = () => ev('[...document.querySelectorAll(".nw-menu .sm-mi")].map(b => ({ text: b.firstChild.textContent, off: b.disabled, why: (b.querySelector(".nw-why") || {}).textContent || "" }))');
  const rightClick = key2 => ev('(() => { const r = document.querySelector(\'#nw-tl .nw-row[data-key="\' + CSS.escape(' + JSON.stringify(key2) + ') + \'"]\'); const b = r.getBoundingClientRect();' +
    ' r.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: b.left + 20, clientY: b.top + 8 })); return 0; })()');
  const menuPick = async text => {
    await lib.settle(dm, 'document.querySelector(".nw-menu")', 4000);
    await ev('[...document.querySelectorAll(".nw-menu .sm-mi")].find(b => b.textContent === ' + JSON.stringify(text) + ').click(); 0');
  };

  // ── A. The window, on an empty library ────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await lib.settle(dm, 'typeof nwToggle === "function" && allScenes.length === 0', 30000);
  await ev('document.getElementById("dock-tab-notes").click(); 0');
  await lib.settle(dm, 'nwIsOpen()', 6000);
  rig.check(await shown(), 'a click on Notes on the rail did not open the window, with no map open');
  rig.check(await ev('document.getElementById("dock-tab-notes").classList.contains("win")'), 'the rail shows no dot while the Notes window is open');
  const empty = await field();
  rig.check(!empty.hidden && empty.value === '' && empty.kind === 'Campaign', 'an empty campaign did not open on the campaign note: ' + JSON.stringify(empty));
  rig.check((await rowKeys()).join() === 'campaign,sec:monster,sec:faction,sec:lore',
            'an empty campaign shows more or less than the campaign and its three empty sections: ' + (await rowKeys()).join());
  await ev('document.getElementById("nw-new").click(); 0');
  await lib.settle(dm, 'document.querySelector(".nw-menu")', 4000);
  rig.check((await menuRows()).map(r => r.text).join() === 'Monster or NPC,Faction,Lore', '+ New on the campaign did not offer Monster or NPC, Faction or Lore: ' + JSON.stringify(await menuRows()));
  await menuPick('Faction');
  await lib.settle(dm, 'document.activeElement && document.activeElement.id === "nw-title"', 4000);
  rig.check(await ev('document.activeElement.id') === 'nw-title', 'a new faction did not leave its title ready to type');
  await typeInto('nw-title', 'Keepers of the Feather');
  await lib.settle(dm, 'notesEntriesAll().some(e => e.name === "Keepers of the Feather")', 4000);
  rig.check((await rowKeys()).some(k => k.startsWith('entry:')), 'the new faction is not in the tree');

  // Esc shuts the window from inside it.
  // RED ON: _nwEscape removed from the window's keydown listeners (notesWindow.js) — 2026-10-30
  await ev('document.getElementById("nw-tl").focus(); 0');
  await key('#nw-tl', 'Escape');
  await lib.settle(dm, '!nwIsOpen()', 4000);
  rig.check(!(await shown()) && !(await ev('document.getElementById("dock-tab-notes").classList.contains("win")')), 'Esc did not shut the Notes window and take the dot off the rail');
  if (!(await ev('nwIsOpen()'))) await ev('document.getElementById("dock-tab-notes").click(); 0');
  await lib.settle(dm, 'nwIsOpen()', 4000);

  // It moves by its header and resizes by its corner, and remembers both.
  const before = await ev('(() => { const w = document.getElementById("notes-window"); return { l: parseFloat(w.style.left), t: parseFloat(w.style.top) }; })()');
  await ev(`(() => { const h = document.getElementById('nw-head'); const b = h.getBoundingClientRect();
    h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: b.left + 200, clientY: b.top + 10 }));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: b.left + 260, clientY: b.top + 50 }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); return 0; })()`);
  const after = await ev('(() => { const w = document.getElementById("notes-window"); return { l: parseFloat(w.style.left), t: parseFloat(w.style.top) }; })()');
  rig.check(after.l > before.l + 20 && after.t > before.t + 20, 'dragging the header did not move the window: ' + JSON.stringify([before, after]));
  await ev('(() => { const w = document.getElementById("notes-window"); w.style.width = "620px"; w.style.height = "460px"; return 0; })()');
  await lib.settle(dm, 'JSON.parse(localStorage.getItem("evermist.notesWin")).width === 620', 4000);
  const saved = await ev('JSON.parse(localStorage.getItem("evermist.notesWin"))');
  rig.check(saved.width === 620 && saved.height === 460 && saved.left === after.l, 'the window did not save its place and size: ' + JSON.stringify(saved));

  // ── B. The rail ───────────────────────────────────────────────────────────
  // RED ON: a second divider put into the rail (index.html) — 2026-10-30
  const rail = await ev(`(() => [...document.querySelectorAll('#dock-rail > *')].map(b => b.classList.contains('rail-sep') ? '|' : b.id).join(','))()`);
  rig.check(rail === 'btn-world,dock-tab-notes,btn-bestiary,|,dock-tab-scene,|,dock-tab-music,dock-tab-sounds,dock-tab-gallery,btn-combat,dock-tab-settings,btn-help',
            'the rail is not Campaign, Notes, Bestiary; a divider; Map settings; a divider; the table tools: ' + rail);

  // ── C. The tree, with a map open ──────────────────────────────────────────
  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await lib.settle(dm, 'fogCoverT === 0', 30000);
  const mapId = await ev('currentScene.id'), mapName = await ev('currentScene.name');
  await ev('polygons = [{ id: 1, vertices: [{ x: 300, y: 250 }, { x: 620, y: 250 }, { x: 620, y: 500 }, { x: 300, y: 500 }], mode: "shroud", cornerRadius: 0, name: "The Vestry", desc: "Two acolytes." },' +
    '{ id: 2, vertices: [{ x: 800, y: 250 }, { x: 1100, y: 250 }, { x: 1100, y: 500 }, { x: 800, y: 500 }], mode: "shroud", cornerRadius: 0 }];' +
    ' nextPolygonId = 3; setShape("select"); selectedPolygonId = null; rebuildFogFromPolygons(); refreshRoomPanel(); scheduleRender(); 0');
  await ev(`(() => { const b = cbNewBlock('Lady Wachter'); b.notes = 'Plots against the Baron.'; b.lore = 'A noble of Vallaki, born of the old line.'; const c = cbNewBlock('Plain wolf'); cbSave(); return 0; })()`);
  await ev('_ntSig = ""; refreshRoomPanel(); 0');
  await lib.settle(dm, 'document.querySelector("#nw-tl .nw-row[data-key^=\\"monster:\\"]")', 6000);
  // RED ON: the monster filter in notesTreeBuild removed, so every bestiary entry lists (notesTreePlan.js) — 2026-10-30
  const keys = await rowKeys();
  rig.check(keys[0] === 'campaign' && keys.includes('map:' + mapId) && keys.filter(k => k.startsWith('monster:')).length === 1,
            'the tree does not show the campaign, the map, and only the monster with a note: ' + keys.join());
  rig.check(keys.join().includes('sec:monster') && keys.indexOf('sec:monster') < keys.indexOf('sec:faction') && keys.indexOf('sec:faction') < keys.indexOf('sec:lore'),
            'the sections are not Monsters and NPCs, Factions, Lore in that order: ' + keys.join());
  rig.check(!keys.includes('sec:roads'), 'a Roads section shows with no road');
  await click('map:' + mapId);
  await lib.settle(dm, 'document.querySelector(\'#nw-tl .nw-row[data-key^="room:"]\')', 6000);
  const withRooms = await rows();
  const roomRows = withRooms.filter(r => r.key.startsWith('room:'));
  rig.check(roomRows.length === 2 && roomRows[0].name === 'The Vestry' && roomRows[1].name === 'Room 2',
            'the map\'s rooms are not listed with an unnamed room as "Room N": ' + JSON.stringify(roomRows));
  rig.check((await field()).title === mapName && (await field()).kind === 'Map', 'a click on the map row did not show the map\'s note: ' + JSON.stringify(await field()));

  // ── D. The header ─────────────────────────────────────────────────────────
  // RED ON: ntPathOf answering the shown node alone, not its path (notesTree.js) — 2026-10-30
  await click('room:' + mapId + ':1');
  await lib.settle(dm, 'selectedPolygonId === 1', 6000);
  const trail = await crumbs();
  rig.check(trail.join('>') === 'Campaign>' + mapName + '>The Vestry', 'the breadcrumbs are not the room\'s path: ' + trail.join('>'));
  await ev('(document.querySelector("#nw-crumbs .nw-crumb[data-go]:not(.last):nth-child(3)") || { click() {} }).click(); 0');
  await lib.settle(dm, 'document.getElementById("nw-kind").textContent === "Map"', 6000);
  rig.check(await ev('selectedPolygonId') === 1 && (await field()).kind === 'Map', 'a crumb did not open its level while leaving the room selected');
  await ev('document.getElementById("nw-back").click(); 0');
  await lib.settle(dm, 'document.getElementById("nw-kind").textContent !== "Map"', 6000);
  rig.check(await ev('document.getElementById("nw-kind").textContent') === 'Room', 'Back did not return to the room');
  await ev('document.getElementById("nw-fwd").click(); 0');
  await lib.settle(dm, 'document.getElementById("nw-kind").textContent === "Map"', 6000);
  rig.check(await ev('document.getElementById("nw-kind").textContent') === 'Map', 'Forward did not return to the map');
  // A long room name folds the middle into "…", whose list holds the level it hid.
  await ev('polygons[0].name = "The Vestry of the Hundred Bells and Other Lesser Chambers"; document.getElementById("notes-window").style.width = "330px"; refreshRoomPanel(); 0');
  await click('room:' + mapId + ':1');
  await lib.settle(dm, 'document.querySelector("#nw-crumbs .more")', 6000);
  rig.check(!!(await ev('document.querySelector("#nw-crumbs .more")')), 'a narrow header did not fold the middle crumbs into "…"');
  await ev('document.querySelector("#nw-crumbs .more").click(); 0');
  await lib.settle(dm, 'document.querySelector(".nw-menu")', 4000);
  rig.check((await menuRows()).some(r => r.text === mapName), 'the "…" list does not hold the folded level: ' + JSON.stringify(await menuRows()));
  await ev('document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); 0');
  await ev('polygons[0].name = "The Vestry"; document.getElementById("notes-window").style.width = "620px"; refreshRoomPanel(); 0');
  // The tree hides, the window gives its width back and the note keeps its own.
  const w0 = await ev('document.getElementById("notes-window").offsetWidth');
  await ev('document.getElementById("nw-tree-btn").click(); 0');
  const hid = await ev('({ w: document.getElementById("notes-window").offsetWidth, tree: document.getElementById("nw-tree").getBoundingClientRect().width })');
  rig.check(hid.tree === 0 && hid.w < w0, 'hiding the tree left it on screen or the window as wide: ' + JSON.stringify([w0, hid]));
  await ev('document.getElementById("nw-tree-btn").click(); 0');

  // ── E. A monster's note ───────────────────────────────────────────────────
  const monKey = (await rowKeys()).find(k => k.startsWith('monster:'));
  await click(monKey);
  await lib.settle(dm, 'document.getElementById("nw-kind").textContent === "Monster or NPC"', 6000);
  const mon = await ev(`({ field: document.getElementById('np-field').value, lore: document.getElementById('nw-lore-body').textContent,
    open: document.getElementById('nw-lore').open, loreVisible: document.getElementById('nw-lore').getBoundingClientRect().height > 0,
    ro: !document.getElementById('nw-lore-body').isContentEditable, stat: document.getElementById('nw-stat').getBoundingClientRect().height > 0 })`);
  rig.check(mon.field === 'Plots against the Baron.' && mon.lore.startsWith('A noble of Vallaki') && !mon.open && mon.loreVisible && mon.ro && mon.stat,
            'a monster\'s window is not its DM note, the lore folded below read-only, and a Stat block button: ' + JSON.stringify(mon));
  await typeInto('np-field', 'Plots against the Baron. Owes Izek a favour.');
  await lib.settle(dm, 'Object.values(cbState.blocks).find(b => b.name === "Lady Wachter").notes.endsWith("favour.")', 4000);
  rig.check(await ev('Object.values(cbState.blocks).find(b => b.name === "Lady Wachter").lore') === 'A noble of Vallaki, born of the old line.',
            'editing the monster\'s note changed the book\'s lore');
  await ev('document.getElementById("nw-stat").click(); 0');
  await lib.settle(dm, 'bsIsOpen() && bs.open === ' + JSON.stringify(monKey.slice(8)), 6000);
  rig.check(await ev('bsIsOpen() && bs.open === ' + JSON.stringify(monKey.slice(8))), 'the Stat block button did not open the Bestiary on the monster');
  await ev('bestiarySetOpen(false); 0');

  // ── F. Titles rename ──────────────────────────────────────────────────────
  // RED ON: _npTitleCommit calling no rename (notesPanel.js) — 2026-10-30
  await click('map:' + mapId);
  await lib.settle(dm, 'document.getElementById("nw-kind").textContent === "Map"', 6000);
  await typeInto('nw-title', 'The Crypt Below');
  await lib.settle(dm, 'currentScene.name === "The Crypt Below"', 6000);
  rig.check(await ev('allScenes.find(s => s.id === currentScene.id).name') === 'The Crypt Below' && (await rows()).some(r => r.name === 'The Crypt Below'),
            'renaming a map by its title did not reach the library and the tree');
  await click('campaign');
  await lib.settle(dm, 'document.getElementById("nw-kind").textContent === "Campaign"', 6000);
  rig.check(await ev('document.getElementById("nw-title").readOnly'), 'the campaign\'s title can be edited, and it has no name to keep');
  // A group's notes follow its new name.
  await ev('(() => { const n = addGroup("Vallaki"); worldSceneSet(currentScene.id, { group: n }); notesPlaceSet("Vallaki", "Walled town."); sceneListChanged(); refreshRoomPanel(); return 0; })()');
  await lib.settle(dm, 'document.querySelector(\'#nw-tl .nw-row[data-key="place:Vallaki"]\')', 6000);
  await click('place:Vallaki');
  await lib.settle(dm, 'document.getElementById("np-field").value === "Walled town."', 6000);
  await typeInto('nw-title', 'Vallaki Town');
  await lib.settle(dm, 'notesPlaceGet("Vallaki Town") === "Walled town."', 6000);
  rig.check(await ev('notesPlaceGet("Vallaki Town")') === 'Walled town.' && !(await ev('notesPlaceGet("Vallaki")')) && (await field()).value === 'Walled town.',
            'a group\'s notes did not follow its new name: ' + JSON.stringify(await field()));

  // ── G. + New ──────────────────────────────────────────────────────────────
  const facKey = (await rowKeys()).find(k => k.startsWith('entry:'));
  await click(facKey);
  await lib.settle(dm, 'document.getElementById("nw-kind").textContent === "Faction"', 6000);
  rig.check((await ev('document.getElementById("nw-new").textContent')) === '+ New faction', '+ New does not name the kind it makes: ' + await ev('document.getElementById("nw-new").textContent'));
  await ev('document.getElementById("nw-new").click(); 0');
  await lib.settle(dm, 'notesEntriesAll().length === 2 && document.activeElement.id === "nw-title"', 6000);
  const two = await ev('notesEntriesAll().map(e => ({ kind: e.kind, parent: e.parent }))');
  rig.check(two.length === 2 && two.every(e => e.kind === 'faction' && e.parent === 'faction') && await ev('document.activeElement.id') === 'nw-title',
            '+ New on a faction did not make another beside it with its title ready: ' + JSON.stringify(two));
  await typeInto('nw-title', 'Vistani');
  await click('map:' + mapId);
  await lib.settle(dm, 'document.getElementById("nw-kind").textContent === "Map"', 6000);
  await ev('document.getElementById("nw-new").click(); 0');
  await lib.settle(dm, 'document.querySelector(".nw-menu")', 4000);
  rig.check((await menuRows()).map(r => r.text).join() === 'Monster or NPC,Faction,Lore', '+ New on a map did not ask Monster or NPC, Faction or Lore');
  await menuPick('Monster or NPC');
  await lib.settle(dm, 'Object.values(cbState.blocks).some(b => b.listed)', 6000);
  rig.check(await ev('Object.values(cbState.blocks).filter(b => b.listed).length') === 1 && (await rowKeys()).filter(k => k.startsWith('monster:')).length === 2,
            '+ New on a map did not make a blank Bestiary entry that the tree lists');
  await typeInto('nw-title', 'Izek Strazni');

  // ── H. The right-click menu ───────────────────────────────────────────────
  await rightClick(facKey);
  await lib.settle(dm, 'document.querySelector(".nw-menu")', 4000);
  rig.check((await menuRows()).map(r => r.text).join() === 'Rename,New inside,Delete', 'a faction\'s menu is not Rename, New inside, Delete: ' + JSON.stringify(await menuRows()));
  // RED ON: position: fixed dropped from .nw-menu (notesWindow.css) — 2026-10-30
  const at = await ev('(() => { const r = document.querySelector(\'#nw-tl .nw-row[data-key="\' + CSS.escape(' + JSON.stringify(facKey) + ') + \'"]\').getBoundingClientRect(); const m = document.querySelector(".nw-menu").getBoundingClientRect(); return { dx: m.left - (r.left + 20), dy: m.top - (r.top + 8) }; })()');
  rig.check(Math.abs(at.dx) < 6 && Math.abs(at.dy) < 6, 'the right-click menu did not open at the pointer: ' + JSON.stringify(at));
  await ev('document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); 0');
  await rightClick('campaign');
  rig.check((await menuRows()).map(r => r.text).join() === 'Expand all,Collapse all', 'the campaign\'s menu is not Expand all, Collapse all: ' + JSON.stringify(await menuRows()));
  await menuPick('Collapse all');
  await lib.settle(dm, '![...document.querySelectorAll("#nw-tl .nw-row")].some(r => r.dataset.key.startsWith("room:"))', 4000);
  const folded = (await rowKeys()).length;
  await rightClick('campaign');
  await menuPick('Expand all');
  await lib.settle(dm, '[...document.querySelectorAll("#nw-tl .nw-row")].some(r => r.dataset.key.startsWith("room:"))', 4000);
  rig.check((await rowKeys()).some(k => k.startsWith('room:')) && (await rowKeys()).length > folded, 'Expand all did not open the maps down to their rooms');
  await ev('document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); 0');
  await rightClick('map:' + mapId);
  rig.check((await menuRows()).map(r => r.text).join() === 'Rename,Show on map,Delete', 'a map\'s menu is not Rename, Show on map, Delete: ' + JSON.stringify(await menuRows()));
  await ev('document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); 0');
  await rightClick('place:Vallaki Town');
  rig.check((await menuRows()).map(r => r.text).join() === 'Rename,Show on map,Delete', 'a group\'s menu is not Rename, Show on map, Delete');
  await ev('document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); 0');

  // ── I. Delete asks, and a faction takes its children ──────────────────────
  // RED ON: confirmDialog replaced by the delete itself in ntDelete (notesTree.js) — 2026-10-30
  const childId = await ev('notesEntryAdd("faction", "Vistani scouts", notesEntriesAll().find(e => e.name === "Keepers of the Feather").id).id');
  await ev('notesEntryAdd("faction", "Scout deeper", ' + JSON.stringify(childId) + '); _ntSig = ""; refreshRoomPanel(); 0');
  await click(facKey);
  await lib.settle(dm, 'document.getElementById("nw-kind").textContent === "Faction"', 6000);
  await rightClick(facKey);
  await menuPick('Delete');
  const q = await askAnswer(false);
  rig.check(await ev('notesEntriesAll().length') === 4 && /2 entries/.test(q.msg), 'the question did not name the two entries inside, or Cancel still deleted: ' + JSON.stringify(q));
  await rightClick(facKey);
  await menuPick('Delete');
  await askAnswer(true);
  await lib.settle(dm, 'notesEntriesAll().length === 1', 6000);
  rig.check(await ev('notesEntriesAll().length') === 1, 'deleting a faction did not take its children with it');
  rig.check((await field()).kind === 'Campaign', 'the window stayed on a deleted entry instead of moving to its parent, the campaign note: ' + JSON.stringify(await field()));

  // ── J. Factions and lore drag ─────────────────────────────────────────────
  // RED ON: _ntDrop moving nothing in notesTree.js — 2026-10-30
  const ids = {};
  for (const n of ['Aaa', 'Bbb', 'Ccc']) ids[n] = await ev('notesEntryAdd("lore", ' + JSON.stringify(n) + ', "lore").id');
  await ev('_ntSig = ""; refreshRoomPanel(); 0');
  const drag = (from, to, zone) => ev(`(() => { const q = k => document.querySelector('#nw-tl .nw-row[data-key="' + CSS.escape(k) + '"]'); const f = q(${JSON.stringify(from)}), t = q(${JSON.stringify(to)}); const dt = new DataTransfer();
    f.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const r = t.getBoundingClientRect(); const y = ${JSON.stringify(zone)} === 'before' ? r.top + 2 : ${JSON.stringify(zone)} === 'after' ? r.bottom - 2 : r.top + r.height / 2;
    t.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
    t.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
    f.dispatchEvent(new DragEvent('dragend', { bubbles: true })); return 0; })()`);
  const order = () => ev('notesEntriesAll().filter(e => e.kind === "lore" && e.parent === "lore").sort((a, b) => a.order - b.order).map(e => e.name).join()');
  await drag('entry:' + ids.Ccc, 'entry:' + ids.Aaa, 'before');
  await lib.settle(dm, 'notesEntriesAll().find(e => e.name === "Ccc").order === 0', 4000);
  rig.check(await order() === 'Ccc,Aaa,Bbb', 'dragging a lore entry above another did not reorder them: ' + await order());
  await drag('entry:' + ids.Bbb, 'entry:' + ids.Ccc, 'in');
  await lib.settle(dm, 'notesEntriesAll().find(e => e.name === "Bbb").parent !== "lore"', 4000);
  rig.check(await ev('notesEntriesAll().find(e => e.name === "Bbb").parent') === ids.Ccc, 'dragging a lore entry onto another did not nest it inside');
  const remaining = await ev('notesEntriesAll().find(e => e.kind === "faction").id');
  await drag('entry:' + ids.Aaa, 'entry:' + remaining, 'in');
  rig.check(await ev('notesEntriesAll().find(e => e.name === "Aaa").parent') === 'lore', 'a lore entry was dragged into a faction, but each stays in its own section');

  // ── K. Keys in the tree ───────────────────────────────────────────────────
  await ev('document.getElementById("nw-tl").focus(); 0');
  await click('campaign');
  await lib.settle(dm, 'document.getElementById("nw-kind").textContent === "Campaign"', 4000);
  await key('#nw-tl', 'ArrowDown');
  await lib.settle(dm, 'document.querySelector("#nw-tl .nw-row.cur")', 4000);
  const cur = await ev('document.querySelector("#nw-tl .nw-row.cur").dataset.key');
  rig.check(cur !== 'campaign', 'the Down arrow did not move the tree\'s cursor off the shown row');
  await key('#nw-tl', 'Enter');
  await lib.settle(dm, 'document.querySelector("#nw-tl .nw-row.sel").dataset.key !== "campaign"', 4000);
  rig.check(await ev('document.querySelector("#nw-tl .nw-row.sel").dataset.key') === cur, 'Enter did not open the row the cursor was on');
  await key('#nw-tl', 'r', { ctrlKey: true });
  await lib.settle(dm, 'document.querySelector("#nw-tl .nw-tn input")', 4000);
  rig.check(!!(await ev('document.querySelector("#nw-tl .nw-tn input")')), 'Ctrl+R did not start renaming the row');
  await ev(`(() => { const i = document.querySelector('#nw-tl .nw-tn input'); i.value = 'Renamed by key'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 0; })()`);
  await lib.settle(dm, '(document.querySelector("#nw-tl .nw-row.sel .nw-tn") || {}).textContent === "Renamed by key"', 6000);
  rig.check(await ev('(document.querySelector("#nw-tl .nw-row.sel .nw-tn") || {}).textContent') === 'Renamed by key', 'a rename typed in the tree did not reach the row: ' + JSON.stringify(await rows()) + ' picked ' + cur);

  // ── L. Show on map ────────────────────────────────────────────────────────
  const second = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: 1200, h: 1500 });
  await ev('createNewScene(' + await rig.fixtures.asFileExpr(dm, second) + ')', 180000);
  await dm.waitFor('currentScene && mapWidth === 1200', 180000, 'the second map to load');
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');
  const otherId = await ev('currentScene.id');
  await ev('autoSync = false; _ntSig = ""; refreshRoomPanel(); 0');
  await ev('searchReadScenes()', 30000);
  await ev('_ntSig = ""; refreshRoomPanel(); 0');
  await lib.settle(dm, 'document.querySelector(\'#nw-tl .nw-row[data-key="room:' + mapId + ':1"]\')', 6000);
  // A room of a map that is not held cannot be deleted from here; Manual opens its map with no question.
  await rightClick('room:' + mapId + ':1');
  await lib.settle(dm, 'document.querySelector(".nw-menu")', 4000);
  const farMenu = await menuRows();
  rig.check(farMenu.some(r => r.text === 'Delete' && r.off && r.why === 'Open the map to delete'), 'Delete is not greyed on a room of a map that is not open: ' + JSON.stringify(farMenu));
  await menuPick('Show on map');
  await lib.settle(dm, 'currentScene && currentScene.id === ' + JSON.stringify(mapId) + ' && selectedPolygonId === 1', 60000);
  rig.check(await ev('currentScene.id') === mapId && await ev('selectedPolygonId') === 1, 'Show on map on a room of another map did not open that map on the DM\'s screen with the room picked, in Manual');
  await ev('autoSync = true; 0');
  await rightClick('map:' + otherId);
  await menuPick('Show on map');
  const ask = await askAnswer(false);
  rig.check(/Open/.test(ask.title) && await ev('currentScene.id') === mapId, 'in Auto, Show on map did not ask before opening a map for the TV, or opened it anyway: ' + JSON.stringify(ask));
  await ev('autoSync = false; 0');
  // A group is flown to on the Campaign map.
  const groupName = await ev('knownGroupNames()[0]');
  await rightClick('place:' + groupName);
  await menuPick('Show on map');
  await lib.settle(dm, 'worldMapOpen && worldMapSel.place === ' + JSON.stringify(groupName), 15000);
  rig.check(await ev('worldMapOpen') && await ev('worldMapSel.place') === groupName, 'Show on map on a group did not take the Campaign map to it');
  await ev('worldMapHide(); 0');
  await lib.settle(dm, '!worldMapOpen', 8000);

  // ── M. Search finds them ──────────────────────────────────────────────────
  const found = await ev('(() => { const all = searchEntries(); const q = w => spSearch(w, all).groups.map(g => g.id + ":" + g.rows.map(r => r.entry.name + "@" + r.rank).join("|")).join(" ; "); return { lore: q("Ccc"), note: q("Baron") }; })()');
  rig.check(/lore:Ccc@0/.test(found.lore) && /monster:Lady Wachter@4/.test(found.note),
            'search does not find a lore entry and a monster by its DM note: ' + JSON.stringify(found));

  // ── N. A restart keeps the window and what was written in it ──────────────
  await ev('(() => { const e = document.getElementById("nw-tedge"); const b = e.getBoundingClientRect();' +
    ' e.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: b.left + 2, clientY: b.top + 40 }));' +
    ' window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: b.left + 62, clientY: b.top + 40 }));' +
    ' window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); return 0; })()');
  await ev('document.getElementById("nw-tree-btn").click(); 0');
  const geo = await ev('JSON.parse(localStorage.getItem("evermist.notesWin"))');
  rig.check(geo.treeHidden === true && geo.treeW > 200, 'the tree\'s width or hidden state was not saved: ' + JSON.stringify(geo));
  const entryCount = await ev('notesEntriesAll().length');
  await ev('doAutoSave()', 60000);
  dm = await rig.restart();
  await lib.installHelpers(dm);
  await lib.settle(dm, 'typeof nwToggle === "function" && currentScene && fogCoverT === 0', 90000);
  await dm.evaluate('document.getElementById("dock-tab-notes").click(); 0');
  await lib.settle(dm, 'nwIsOpen()', 6000);
  const back = await dm.evaluate('(() => { const w = document.getElementById("notes-window"); return { l: parseFloat(w.style.left), t: parseFloat(w.style.top), w: parseFloat(w.style.width), tree: document.getElementById("nw-tree").getBoundingClientRect().width, entries: notesEntriesAll().length }; })()');
  rig.check(back.l === geo.left && back.t === geo.top && back.w === geo.width && back.tree === 0 && back.entries === entryCount,
            'after a restart the window did not come back where it was left, with its tree hidden, and its factions and lore: ' + JSON.stringify([geo, back]));

  rig.byEye('the window\'s look against .claude/private/design/item-195/notes-v2.html');
};
