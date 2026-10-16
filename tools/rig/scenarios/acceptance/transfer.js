'use strict';

// transfer.js — EXPORT AND IMPORT THAT MERGE.
//
// THE GOAL OF THIS FEATURE: the DM carries a campaign between a PC and a laptop, trip after trip, and
// never repairs a map by hand afterwards. An import UPDATES what the library already holds, the newer
// edit wins part by part, and a room revealed at the table stays revealed.
//
// THE CRITERIA ARE THIS HEADER. One run plays the home PC and the laptop on one profile: build a library,
// export file A, edit and export file B, empty the library (the laptop), import A, play the table, then
// import B. Each lettered line has its checks under a marker carrying its letter.
//
//   A. Importing a scene the library holds updates it. No copy appears, on a second trip or a later one.
//   B. A part edited later in the file replaces the local one. A part edited later here is kept: rooms
//      revealed at the table stay revealed after an import of scenes home left untouched.
//   C. Rooms match one by one. A room new from home arrives hidden and after the local rooms. Notes made
//      at home and a reveal made at the table both survive in one room. A room added on each machine
//      stays two rooms.
//   D. Places and roads match the same way, a place renamed on one machine included. The backdrop
//      follows the same rule and travels with a picked export.
//   E. A matched scene keeps its place on the world map, and an import that matches nothing lands
//      beside the layout as one block.
//   F. An import that updates the open scene shows the merged scene on the DM window and the TV, and the
//      next autosave keeps it. The world map then opens on what came in with those scenes picked, and
//      one report names each scene and room where an edit was overwritten.
//   G. Settings say Export and Import, never Backup or Restore.
//   H. A file from the previous release (no uids, no times) matches by scene id. A part with no time
//      is the oldest, a tie goes to the file, and a time past the moment of import counts as that moment.
//   I. A room deleted on one machine disappears on the other unless that one edited it later, and an
//      undone delete brings the room back for good.
//   J. A stopped import leaves every record and map file as it was.
//   K. What only a person can check.
//
// ⚠ THE EXPORT GOES THROUGH doExport ITSELF, by its destPath option: the native save dialog is the one
// seam nothing crosses. The import runs restoreFromZipPath untouched.
// ⚠ EVERY EDIT IS STAMPED WITH Date.now(), so a step that must be LATER than the last waits for the
// clock to move on (`later`). Equal times would make a tie, and a tie goes to the file.

const fs = require('fs');
const path = require('path');

const lib = require('../../lib');

const MAP_W = 1200, MAP_H = 800;
const ROOMS = {
  hall: ['Hall', 100, 100], crypt: ['Crypt', 300, 100], vault: ['Vault', 500, 100], pit: ['Pit', 700, 100],
  well: ['Well', 900, 100], armory: ['Armory', 100, 400], lap: ['Laptop room', 300, 400], closet: ['Closet', 500, 400],
};
const box = (x, y) => [{ x, y }, { x: x + 150, y }, { x: x + 150, y: y + 150 }, { x, y: y + 150 }];
const centre = k => ({ x: ROOMS[k][1] + 75, y: ROOMS[k][2] + 75 });
const room = (k, id, extra) => JSON.stringify(Object.assign({
  id, uid: 'r-' + k, name: ROOMS[k][0], mode: 'shroud', cornerRadius: 0, vertices: box(ROOMS[k][1], ROOMS[k][2]),
}, extra || {}));
const names = rooms => rooms.map(r => r.name);
const byName = (rooms, n) => rooms.find(r => r.name === n) || {};

module.exports = async function transfer(rig) {
  const dm = rig.dm;
  const out = n => path.join(rig.outDir, n);
  const later = () => lib.hold(6, 'the clock must move on, so the next edit is stamped later than the last');
  const ev = (expr, ms) => dm.evaluate(expr, ms || 120000);

  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');
  await ev(`(() => {
    globalThis.__tfSave = async fn => { fn(); rebuildFogFromPolygons(); rebuildFogEffect(); fogDirty = true; scheduleRender(); await doAutoSave(); return 0; };
    globalThis.__tfRooms = async id => (await sceneStore.loadScene(id)).polygons.map(p => ({ uid: p.uid, name: p.name, desc: p.desc || '', mode: p.modeWithHoles || p.mode, id: p.id }));
    globalThis.__tfRec = async id => { const s = await sceneStore.loadScene(id); return { name: s.name, notes: s.notes, edits: s.edits, next: s.nextPolygonId, fx: (s.effects || []).map(e => e.uid), pos: s.worldPos }; };
    globalThis.__tfPng = n => new Promise(res => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; c.getContext('2d').fillRect(0, 0, 32, 32); c.toBlob(b => res(new File([b], n, { type: 'image/png' })), 'image/png'); });
    globalThis.__tfDrain = () => { const a = document.getElementById('cd-anchor'); const seen = []; for (let i = 0; i < 20 && a && a.style.display === 'flex'; i++) { seen.push(document.getElementById('cd-title').textContent + ' | ' + document.getElementById('cd-msg').textContent); document.getElementById(a.classList.contains('cd-solo') ? 'cd-ok' : 'cd-cancel').click(); } return seen; };
    globalThis.__tfClear = async () => {
      const ids = allScenes.map(s => s.id);
      deleteScenesWithUndo(ids); commitPendingDelete();
      for (const id of ids) { await sceneStore.deleteScene(id); await window.electronAPI.deleteVideoFile(id).catch(() => {}); }
      for (const n of Object.keys(worldPlacesAll())) worldShapeDelete(n);
      for (const r of worldRoadRecords()) worldRoadDelete(r.uid);
      notesPlacesWrite({}); notesRoadsWrite({}); notesCampaignSet('');
      await _wbClear();
      return allScenes.length;
    };
    return 0;
  })()`);

  // ── The home PC: a scene with rooms, a place, a road and a backdrop ───────
  const s1 = await ev('currentScene.id');
  await ev(`(async () => {
    renameScene(${JSON.stringify(s1)}, 'Cave');
    await __tfSave(() => {
      polygons = [${room('hall', 1)}, ${room('crypt', 2, { desc: 'Old notes' })}, ${room('vault', 3)}, ${room('pit', 4)}, ${room('well', 5)}];
      nextPolygonId = 6;
    });
    worldEnsurePositions();
    const p = currentScene.worldPos;
    addGroup('Keep');
    worldPlaceSet('Keep', { vertices: [{ x: p.x - 300, y: p.y - 300 }, { x: p.x + 300, y: p.y - 300 }, { x: p.x + 300, y: p.y + 300 }, { x: p.x - 300, y: p.y + 300 }] });
    worldAssignAll();
    notesPlaceSet('Keep', 'Gate note.');
    const uid = worldRoadCreate([{ x: p.x + 800, y: p.y }, { x: p.x + 1200, y: p.y }], [{ kind: null }, { kind: null }]);
    worldRoadRename(uid, 'Old Road');
    notesRoadSet(uid, 'Road note.');
    await _wbChoose(await __tfPng('backdrop.png'));
    return 0;
  })()`);
  const homeRoad = await ev('worldRoadRecords()[0].uid');
  rig.check(await ev('worldPlaceByName("Keep") !== null && !!_wbMeta && _wbMeta.at > 0 && worldRoadRecords().length === 1'),
            'the home library was not prepared (a place, a road and a backdrop), so nothing below is about an import');
  const fileA = out('A.zip'), fileB = out('B.zip'), fileC = out('C-picked.zip');
  await later();
  await ev(`doExport(allScenes.map(s => s.id), { destPath: ${JSON.stringify(fileA)} })`, 300000);
  rig.check(fs.existsSync(fileA) && fs.statSync(fileA).size > 0, 'doExport produced no file at ' + fileA);

  // ── Home edits, after A: file B ───────────────────────────────────────────
  await later();
  await ev(`(async () => {
    renameScene(${JSON.stringify(s1)}, 'Deep Cave');
    await __tfSave(() => {
      polygons.find(p => p.uid === 'r-crypt').desc = 'Home notes';
      polygons = polygons.filter(p => p.uid !== 'r-pit' && p.uid !== 'r-well');
      polygons.push(${room('armory', 6)});
      nextPolygonId = 7;
    });
    renameGroup('Keep', 'Castle');
    notesPlaceSet('Castle', 'Home gate note.');
    worldRoadRename(${JSON.stringify(homeRoad)}, "King's Road");
    notesRoadSet(${JSON.stringify(homeRoad)}, 'Home road note.');
    const bg = worldBackgroundMeta();
    worldBackgroundDragTo(bg, 40, 25);
    worldBackgroundDragEnd();
    await importMapFiles([await __tfPng('Lair.png')]);
    worldEnsurePositions();
    for (const m of allScenes) for (let i = 0; i < 100 && !(await sceneStore.loadScene(m.id)).worldPos; i++) await new Promise(r => setTimeout(r, 20));
    await switchScene(${JSON.stringify(s1)});
    await doAutoSave();
    return 0;
  })()`, 300000);
  const home = JSON.parse(await ev(`JSON.stringify({ s1: allScenes.find(s => s.id === ${JSON.stringify(s1)}).worldPos,
    s2: allScenes.find(s => s.id !== ${JSON.stringify(s1)}).worldPos, s2id: allScenes.find(s => s.id !== ${JSON.stringify(s1)}).id,
    bg: worldBackgroundMeta() })`));
  await ev(`doExport(allScenes.map(s => s.id), { destPath: ${JSON.stringify(fileB)} })`, 300000);
  await ev(`doExport([${JSON.stringify(s1)}], { destPath: ${JSON.stringify(fileC)}, partial: true })`, 300000);
  rig.check(fs.existsSync(fileB) && fs.existsSync(fileC), 'doExport produced no file for the second trip');

  // ── D. The backdrop travels with a picked export ─────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const picked = await ev(`(async () => { const g = await window.electronAPI.readBackupWorldBackground(${JSON.stringify(fileC)}); return g ? JSON.parse(g.meta) : null; })()`);
  rig.check(!!picked && picked.at > 0 && Math.round(picked.x) === Math.round(home.bg.x),
            'an export of picked scenes left the world map backdrop out, so a place moved at home reaches the laptop without its picture: ' + JSON.stringify(picked));

  // ── The laptop: an empty library, then file A ────────────────────────────
  rig.check(await ev('__tfClear()', 180000) === 0, 'the library could not be emptied to act as the laptop');
  await ev('__tfDrain(); 0');
  await ev(`restoreFromZipPath(${JSON.stringify(fileA)})`, 300000);
  await ev('__tfDrain(); if (worldMapOpen) worldMapHide(); 0');
  await ev(`switchScene(${JSON.stringify(s1)})`, 120000);
  await dm.waitFor('currentScene && currentScene.id === ' + JSON.stringify(s1) + ' && fogCoverT === 0', 60000, 'the laptop scene to open');
  const first = await ev(`(async () => ({ count: allScenes.length, ids: allScenes.map(s => s.id), name: allScenes[0].name, rooms: await __tfRooms(${JSON.stringify(s1)}), places: Object.keys(worldPlacesAll()), roads: worldRoadRecords().map(r => r.uid) }))()`);
  rig.check(first.count === 1 && first.ids[0] === s1 && first.name === 'Cave' && first.rooms.length === 5,
            'importing file A into an empty library did not bring the scene back under its own id: ' + JSON.stringify(first));

  // ── The table: reveal rooms, add what only this machine has ──────────────
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen && !!fogDataCanvas', 45000, 'the Player to receive the map');
  await later();
  await ev(`__tfSave(() => {
    polygons.find(p => p.uid === 'r-crypt').mode = 'revealed';
    polygons.find(p => p.uid === 'r-hall').mode = 'revealed';
    polygons = polygons.filter(p => p.uid !== 'r-vault');
    polygons.find(p => p.uid === 'r-well').desc = 'Laptop well notes';
    polygons.push(${room('lap', 7)});
    nextPolygonId = 8;
    setEffects(effects.concat([{ id: 1, uid: 'fx-laptop', material: 'fire', name: 'Laptop fire', cornerRadius: 0, vertices: ${JSON.stringify(box(700, 400))} }]));
    nextEffectId = 2;
  })`, 120000);
  await ev(`notesPlaceSet('Keep', 'Laptop gate note.'); 0`);
  await ev(lib.SETTLE);

  // ── I. Undoing a delete brings the room back for good ────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await later();
  const undone = await ev(`(async () => {
    await __tfSave(() => { polygons.push(${room('closet', 8)}); nextPolygonId = 9; });
    pushUndo();
    await __tfSave(() => { polygons = polygons.filter(p => p.uid !== 'r-closet'); });
    const gone = (await __tfRec(${JSON.stringify(s1)})).edits.goneRooms['r-closet'] > 0;
    undo();
    await doAutoSave();
    const rec = await __tfRec(${JSON.stringify(s1)});
    return { gone, back: (await __tfRooms(${JSON.stringify(s1)})).some(r => r.uid === 'r-closet'), still: rec.edits.goneRooms['r-closet'] !== undefined };
  })()`, 120000);
  rig.check(undone.gone && undone.back && !undone.still,
            'a room deleted and then restored by Ctrl+Z is still recorded as deleted, so the next import takes it away: ' + JSON.stringify(undone));

  // ── Import B with the scene open ─────────────────────────────────────────
  await later();
  const tableState = await ev(`(async () => ({ pos: currentScene.worldPos, open: currentScene.id }))()`);
  rig.check(tableState.open === s1, 'the scene was not open for the second import');
  await ev(`restoreFromZipPath(${JSON.stringify(fileB)})`, 300000);

  // ── A. No copy appears ───────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const after = await ev(`(async () => ({
    names: allScenes.map(s => s.name), ids: allScenes.map(s => s.id), open: currentScene && currentScene.id,
    rooms: await __tfRooms(${JSON.stringify(s1)}), rec: await __tfRec(${JSON.stringify(s1)}),
    places: Object.keys(worldPlacesAll()), placeNote: notesPlaceGet('Castle'), keepNote: notesPlaceGet('Keep'),
    roads: worldRoadRecords().map(r => ({ name: r.name, note: notesRoadGet(r.uid) })),
    bg: worldBackgroundMeta(), s2: allScenes.find(s => s.id === ${JSON.stringify(home.s2id)}),
    dm: polygons.map(p => p.name), mapOpen: worldMapOpen, picked: worldMapOpen ? worldMapPicked() : [],
    dialogs: __tfDrain(),
  }))()`, 120000);
  rig.note('after the second import: ' + JSON.stringify({ names: after.names, rooms: names(after.rooms), places: after.places }));
  rig.check(after.ids.length === 2 && after.ids.includes(s1) && after.ids.includes(home.s2id) && !after.names.some(n => / \(\d+\)$/.test(n)),
            'the second import added a copy of a scene instead of updating it: ' + JSON.stringify(after.names));

  // ── B. The newer part wins, and a reveal survives ────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(after.names.includes('Deep Cave') && !after.names.includes('Cave'),
            "a scene renamed at home did not take its new name, so an edit made later in the file did not win: " + JSON.stringify(after.names));
  rig.check(byName(after.rooms, 'Hall').mode === 'revealed' && byName(after.rooms, 'Crypt').mode === 'revealed',
            'rooms revealed at the table were hidden again by an import of scenes home never revealed: ' + JSON.stringify(after.rooms));

  // ── C. Rooms match one by one ────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(byName(after.rooms, 'Crypt').desc === 'Home notes',
            "the notes written at home did not reach a room the table had revealed: " + JSON.stringify(byName(after.rooms, 'Crypt')));
  rig.check(JSON.stringify(names(after.rooms)) === JSON.stringify(['Hall', 'Crypt', 'Well', 'Laptop room', 'Closet', 'Armory']),
            'the rooms are not the local ones in their own order with the room new from home last: ' + JSON.stringify(names(after.rooms)));
  rig.check(byName(after.rooms, 'Armory').mode === 'shroud',
            'a room new from home did not arrive hidden: ' + JSON.stringify(byName(after.rooms, 'Armory')));
  rig.check(after.rooms.some(r => r.name === 'Armory') && after.rooms.some(r => r.name === 'Laptop room'),
            'a room added at home and one added here did not both stay');
  rig.check(new Set(after.rooms.map(r => r.id)).size === after.rooms.length && after.rec.next > Math.max(...after.rooms.map(r => r.id)),
            'a room from the file took an id already in use, or the id counter was not moved past it: ' + JSON.stringify([after.rooms.map(r => r.id), after.rec.next]));

  // ── I. Deletions travel, unless the other machine edited later ───────────
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(!after.rooms.some(r => r.name === 'Pit'),
            'a room deleted at home is still on the laptop, which never touched it: ' + JSON.stringify(names(after.rooms)));
  rig.check(byName(after.rooms, 'Well').desc === 'Laptop well notes',
            'a room deleted at home was deleted here although it was edited here later: ' + JSON.stringify(byName(after.rooms, 'Well')));
  rig.check(!after.rooms.some(r => r.name === 'Vault'),
            'a room deleted on the laptop came back from a file that held it from before: ' + JSON.stringify(names(after.rooms)));
  rig.check(after.rec.fx.includes('fx-laptop'), 'an effect added on the laptop did not survive the import');

  // ── D. Places and roads match, renames included ──────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(JSON.stringify(after.places) === JSON.stringify(['Castle']),
            'a place renamed at home did not match its local copy, or came twice: ' + JSON.stringify(after.places));
  rig.check(after.placeNote === 'Laptop gate note.' && after.keepNote === '',
            "a place note edited here later than at home was replaced, or the note did not follow the rename: " + JSON.stringify([after.placeNote, after.keepNote]));
  rig.check(after.roads.length === 1 && after.roads[0].name === "King's Road" && after.roads[0].note === 'Home road note.',
            'a road edited at home did not update, or came twice: ' + JSON.stringify(after.roads));
  rig.check(Math.round(after.bg.x) === Math.round(home.bg.x) && Math.round(after.bg.y) === Math.round(home.bg.y),
            'the backdrop moved at home did not move on the laptop: ' + JSON.stringify([after.bg, home.bg]));

  // ── E. Positions ─────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(after.rec.pos.x === tableState.pos.x && after.rec.pos.y === tableState.pos.y,
            'a matched scene moved on the world map: ' + JSON.stringify([tableState.pos, after.rec.pos]));
  rig.check(!!after.s2 && after.s2.worldPos.x === home.s2.x && after.s2.worldPos.y === home.s2.y,
            'a scene new from a file that matched things did not keep its place from home: ' + JSON.stringify([after.s2 && after.s2.worldPos, home.s2]));

  // ── F. The open scene, the TV, and the report ────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(after.open === s1 && after.dm.includes('Armory') && !after.dm.includes('Vault'),
            'the open scene on the DM window was not reloaded to the merged scene: ' + JSON.stringify(after.dm));
  try { await player.waitFor(lib.TV_FOG + '(' + centre('crypt').x + ',' + centre('crypt').y + ') < 60', 45000, 'the revealed room on the TV'); } catch (_) {}
  const tv = JSON.parse(await player.evaluate('JSON.stringify({ crypt: (' + lib.TV_FOG + ')(' + centre('crypt').x + ',' + centre('crypt').y + '), armory: (' +
                                              lib.TV_FOG + ')(' + centre('armory').x + ',' + centre('armory').y + ') })'));
  rig.check(tv.crypt < 60 && tv.armory > 200,
            'the TV does not show the merged scene (the table\'s reveal clear, the new room hidden): ' + JSON.stringify(tv));
  await ev('doAutoSave()');
  const kept = await ev(`(async () => (await __tfRooms(${JSON.stringify(s1)})).map(r => r.name))()`);
  rig.check(kept.includes('Armory') && kept.includes('Crypt'), 'the next autosave dropped what the import merged: ' + JSON.stringify(kept));
  rig.check(after.mapOpen && JSON.stringify(after.picked.slice().sort()) === JSON.stringify([s1, home.s2id].sort()),
            'the world map did not open with the added and updated scenes picked: ' + JSON.stringify([after.mapOpen, after.picked]));
  const report = after.dialogs.find(d => d.startsWith('Import finished')) || '';
  rig.check(/1 scene added/.test(report) && /1 scene updated/.test(report) && /Deep Cave/.test(report) && /Crypt/.test(report),
            'the report does not count what was added and updated, or name the scene and room where an edit was overwritten: ' + JSON.stringify(after.dialogs));

  // ── G. Export and Import in Settings ─────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const words = await ev(`(() => { const blk = document.getElementById('wm-bk-export').closest('.dk-blk'); return { text: blk.textContent, title: document.getElementById('wm-bk-restore').title, veil: (document.getElementById('wm-dropveil') || {}).textContent || '' }; })()`);
  rig.check(!/backup|restore/i.test(words.text + words.title + words.veil) && /Import/.test(words.text) && /Export/.test(words.text),
            'Settings still say Backup or Restore: ' + JSON.stringify(words));
  rig.byEye('Settings, the progress window and the report read as Export and Import, in English and in Russian');
  rig.byEye('the world map opens framed on what came in, with those scenes picked, and the report sits clear of the map');

  // ── E. An import that matches nothing lands beside the layout ────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const fileE = out('E.zip');
  const beside = await ev(`(async () => {
    await importMapFiles([await __tfPng('Outsider.png')]);
    const s3 = allScenes.find(s => s.name === 'Outsider');
    const at = { x: s3.worldPos.x, y: s3.worldPos.y };
    await doExport([s3.id], { destPath: ${JSON.stringify(fileE)}, partial: true });
    await switchScene(${JSON.stringify(s1)});
    deleteScenesWithUndo([s3.id]); commitPendingDelete(); await sceneStore.deleteScene(s3.id);
    const others = allScenes.map(s => s.worldPos.x);
    await restoreFromZipPath(${JSON.stringify(fileE)});
    const back = allScenes.find(s => s.id === s3.id);
    __tfDrain(); if (worldMapOpen) worldMapHide();
    return { at, back: back && back.worldPos, right: Math.max(...others) };
  })()`, 300000);
  rig.check(!!beside.back && beside.back.x > beside.right,
            'an import that matched nothing did not land beside the existing layout: ' + JSON.stringify(beside));

  // ── H. A file from the previous release ──────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const fileH = out('H.zip');
  const legacy = await ev(`(async () => {
    await importMapFiles([await __tfPng('Legacy.png')]);
    // The new scene is open, and its autosave would write over the record made by hand below.
    await switchScene(${JSON.stringify(s1)});
    const meta = allScenes.find(m => m.name === 'Legacy');
    const old = await sceneStore.loadScene(meta.id);
    // The scene as 4.5 saved it: no uids and no times anywhere, rooms known by their numeric ids only.
    const room = { id: 1, name: 'Legacy room', mode: 'shroud', cornerRadius: 0, vertices: ${JSON.stringify(box(100, 100))} };
    await sceneStore.putScene({ ...old, polygons: [room], nextPolygonId: 2, edits: undefined });
    const mapExt = mapExtFromScene(old);
    await window.electronAPI.createBackupZip(${JSON.stringify(fileH)}, [{
      id: old.id, mapType: 'image', mapExt,
      metadata: { id: old.id, name: 'Legacy name', mapType: 'image', mapWidth: old.mapWidth, mapHeight: old.mapHeight,
        mapMimeType: 'image/png', mapExt, polygons: [{ ...room, name: 'Legacy room, in the file' }], nextPolygonId: 2, notes: 'Legacy notes',
        effects: [], nextEffectId: 1, gridConfig: { ...old.gridConfig, cellSize: 33 }, fogSettings: old.fogSettings, createdAt: 0, sortOrder: 0,
        edits: { scene: { grid: Date.now() + 1e10 } } },
      mapBuffer: await blobToArrayBuffer(old.mapBlob), fogBuffer: null, thumbBuffer: null,
    }], null);
    const count = allScenes.length;
    await restoreFromZipPath(${JSON.stringify(fileH)});
    __tfDrain(); if (worldMapOpen) worldMapHide();
    const back = await sceneStore.loadScene(old.id);
    return { name: back.name, notes: back.notes, grid: back.gridConfig.cellSize, gridAt: back.edits.scene.grid, now: Date.now(),
             rooms: back.polygons.map(r => r.name), uid: back.polygons[0].uid, count, after: allScenes.length };
  })()`, 300000);
  rig.check(legacy.name === 'Legacy name' && legacy.notes === 'Legacy notes',
            'a part with no time on either side did not go to the file, which is where a tie belongs: ' + JSON.stringify(legacy));
  rig.check(legacy.grid === 33 && legacy.gridAt <= legacy.now,
            'a time past the moment of import was not counted as that moment: ' + JSON.stringify(legacy));
  rig.check(legacy.rooms.length === 1 && legacy.rooms[0] === 'Legacy room, in the file' && legacy.uid === 'legacy-1',
            'a room of the previous release did not match by its id, so it was duplicated or left as it was: ' + JSON.stringify(legacy));
  rig.check(legacy.after === legacy.count, 'a file from the previous release added a copy of a scene it matched by id: ' + JSON.stringify(legacy));

  // ── J. A stopped import leaves everything as it was ──────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const fileD = out('D.zip');
  const mapsDir = path.join(rig.profileDir, 'maps');
  const mapFiles = () => fs.existsSync(mapsDir) ? fs.readdirSync(mapsDir).sort() : [];
  await ev(`(async () => {
    const sc = await sceneStore.loadScene(${JSON.stringify(s1)});
    const mapExt = mapExtFromScene(sc);
    await window.electronAPI.createBackupZip(${JSON.stringify(fileD)}, [{
      id: sc.id, mapType: 'video', mapExt,
      metadata: { id: sc.id, name: 'Name from a stopped import', mapType: 'video', mapWidth: sc.mapWidth, mapHeight: sc.mapHeight,
        mapMimeType: 'video/webm', mapExt, polygons: sc.polygons, nextPolygonId: sc.nextPolygonId, notes: 'Stopped notes',
        effects: [], nextEffectId: 1, gridConfig: sc.gridConfig, fogSettings: sc.fogSettings, createdAt: 0, sortOrder: 0,
        edits: { scene: { name: Date.now(), notes: Date.now() } } },
      mapBuffer: null, fogBuffer: null, thumbBuffer: null,
    }], null);
    return 0;
  })()`, 120000);
  await ev('__tfDrain(); 0');
  const filesBefore = mapFiles();
  const recBefore = await ev(`(async () => { const s = await sceneStore.loadScene(${JSON.stringify(s1)}); return JSON.stringify({ name: s.name, notes: s.notes, edits: s.edits, polygons: s.polygons }); })()`);
  const stopped = await ev(`(async () => {
    const origShow = showMapProgress, origPct = updateMapProgress, state = {};
    showMapProgress = function (label) { origShow(label); if (label === 'Saving scenes…') state.asked = true; };
    updateMapProgress = function (pct) {
      origPct(pct);
      if (!state.asked || state.title || pct < 100) return;
      document.getElementById('map-progress-stop').click();
      state.title = document.getElementById('cd-title').textContent;
      document.getElementById('cd-ok').click();
    };
    await restoreFromZipPath(${JSON.stringify(fileD)});
    showMapProgress = origShow;
    updateMapProgress = origPct;
    state.dialogs = __tfDrain();
    return state;
  })()`, 300000);
  rig.note('stopping an import: ' + JSON.stringify(stopped));
  const recAfter = await ev(`(async () => { const s = await sceneStore.loadScene(${JSON.stringify(s1)}); return JSON.stringify({ name: s.name, notes: s.notes, edits: s.edits, polygons: s.polygons }); })()`);
  rig.check(stopped.asked && stopped.title === 'Stop importing?',
            'the import could not be stopped from the progress window: ' + JSON.stringify(stopped));
  rig.check(recAfter === recBefore, 'a stopped import changed a scene it had matched: ' + recAfter.slice(0, 300) + ' against ' + recBefore.slice(0, 300));
  rig.check(JSON.stringify(mapFiles()) === JSON.stringify(filesBefore), 'a stopped import changed the files in the maps folder: ' + JSON.stringify([filesBefore, mapFiles()]));

  // ── Records still read as the previous release reads them ────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const shape = await ev(`(async () => {
    const rec = await sceneStore.loadScene(${JSON.stringify(s1)});
    const extra = Object.keys(rec).filter(k => k === 'edits' || /uid/i.test(k));
    return { extra, json: (() => { try { JSON.parse(JSON.stringify(rec.edits)); return true; } catch (_) { return false; } })(),
      roomKeys: [...new Set(rec.polygons.flatMap(p => Object.keys(p)))].filter(k => /edit|stamp/i.test(k)),
      place: Object.values(JSON.parse(localStorage.getItem('evermist.placeShapes'))).every(p => Array.isArray(p.vertices)) };
  })()`);
  rig.check(JSON.stringify(shape.extra) === '["edits"]' && shape.json && shape.roomKeys.length === 0 && shape.place,
            'the stored records gained more than additive fields the previous release can ignore: ' + JSON.stringify(shape));
  rig.byEye('a real export through the Export button, imported on a second machine: its save dialog is a native window nothing can drive');
};
