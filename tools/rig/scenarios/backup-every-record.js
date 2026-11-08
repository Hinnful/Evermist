'use strict';

// backup-every-record.js — A BACKUP CARRIES EVERY KIND OF RECORD THE APP KEEPS.
//
// A small library with one of everything, exported, the app emptied and restarted, the file imported; then each kind
// is read back and named in its own check, so a failure says which kind was lost.
//
//   npm run rig -- backup-every-record
//
// THE KINDS, read off src/scenes/backup.js, electron/backupZip.js and src/scenes/transferImport.js:
//
//   per map     the image or the animated map's file, the thumbnail, the rooms (with doors from a real floor plan), the
//               effects, the lights, the notes, the fog layer, the grid, the fog look and weather, the TV fit, the room
//               pictures, the floor plan and its file name, where the map sits on the Campaign and its group
//   campaign    groups and their notes, roads and their notes, the party marker, factions and lore, the campaign note,
//               the group uids that mentions point at, the world map's backdrop
//   other       fights and the bestiary, module text, Pictures
//   NOT CARRIED music (noted, not failed: nothing files it yet)
//
//   A. The zip lists the files each kind travels in.
//   B. After the app is emptied and restarted, it is empty, and an Import brings back each kind below.
//
// ⚠ THE SAVE DIALOG IS THE ONE SEAM THE RIG CANNOT CROSS: doExport takes a destPath that goes round it.

const fs = require('fs');
const path = require('path');

const lib = require('../lib');
const kit = require('../backupKit');

// Which digest keys belong to which kind, so a difference is reported under its name.
const MAP_KINDS = {
  'the map file': ['map', 'videoFile', 'size', 'type'], 'the thumbnail': ['thumb'], 'the rooms': ['rooms', 'nextIds'],
  'the effects': ['effects'], 'the lights': ['lights'], 'the map notes': ['notes'], 'the fog layer': ['fog'],
  'the grid': ['grid'], 'the fog look': ['fogLook'], 'the weather': ['weather'], 'the TV fit': ['tvFit'],
  'the room pictures': ['pictures'], 'the floor plan': ['floorPlan'], 'the map name': ['name'],
  'where the map sits on the Campaign': ['group', 'worldPos'],
};
const WORLD_KINDS = {
  'the groups': ['places', 'groupUids'], 'the group notes': ['placeNotes'], 'the roads': ['roads'], 'the road notes': ['roadNotes'],
  'the party marker': ['party'], 'the factions and lore': ['entries'], 'the campaign note': ['campaignNote', 'campaignNoteAt'],
  'the fights and the bestiary': ['combat'], 'the module text': ['moduleText'], 'Pictures': ['gallery'],
  'the world map backdrop': ['worldBg'],
};

module.exports = async function backupEveryRecord(rig) {
  let dm = rig.dm;
  await kit.install(dm);

  // ── The map with a real floor plan: rooms and doors from the app's own Draw Rooms ──
  const planId = await lib.importWithPlan(rig, 'План зала');
  await kit.install(dm);
  const rooms = await lib.drawRooms(rig, 3);
  rig.check(rooms.length === 3, 'setup: the plan did not give three rooms: ' + rooms.length);
  await dm.evaluate('setPolygonMode(' + rooms[0].id + ', "reveal"); scheduleAutoSave(); 0');
  await lib.settle(dm, 'fogCoverT === 0 && !fogTransRafId', 30000);
  await dm.evaluate('doAutoSave()', 60000);
  const planHas = await dm.evaluate('(async () => { const s = await sceneStore.loadScene(' + JSON.stringify(planId) + '); return { rooms: s.polygons.length, doors: s.polygons.reduce((n, p) => n + (p.doors || []).length, 0), plan: !!s.floorPlan }; })()');
  rig.check(planHas.rooms === 3 && planHas.doors > 0 && planHas.plan, 'setup: the plan map is missing its rooms, doors or floor plan: ' + JSON.stringify(planHas));

  // ── Three still maps, written the way the other scenarios do ──
  const made = [];
  for (let i = 0; i < 3; i++) {
    const r = await dm.evaluate(`(async () => {
      const f = await __bk.noiseFile(${JSON.stringify('Карта ' + (i + 1))}, 2400, 1600, ${i + 1}, 0.85);
      return addMapsToLibrary([f], { x: ${i * 260}, y: 300 }, true);
    })()`, 240000);
    made.push(r.ids[0]);
    await dm.evaluate(`__bk.decorate(${JSON.stringify(r.ids[0])}, ${i + 1}, { pictured: ${i === 0} })`, 60000);
  }
  rig.check(made.every(Boolean), 'setup: a map did not import');
  const camp = await dm.evaluate(`__bk.campaign(${JSON.stringify(made)}, 'всё')`, 60000);
  await dm.evaluate('__bk.fights("всё"); __bk.moduleText("Книга всё"); 0');
  await dm.evaluate('__bk.gallery(3, "Картинка")', 60000);
  const bg = await dm.evaluate(`(async () => worldBackgroundSet(await __bk.noiseFile('Подложка', 800, 600, 9, 0.8)))()`, 60000);
  rig.check(bg === true, 'setup: the world map backdrop did not take, so it is not under test');
  const track = path.join(rig.outDir, 'мелодия.mp3');
  fs.writeFileSync(track, Buffer.from('ID3rig-not-really-audio'));
  await dm.evaluate('window.electronAPI.copyMusicFiles([' + JSON.stringify(track) + '])');

  const before = kit.withVideoHashes(await dm.evaluate('__bk.digest()', 120000));
  rig.check(Object.keys(before.scenes).length === 4, 'setup: the library holds ' + Object.keys(before.scenes).length + ' maps, not 4');
  rig.check(JSON.parse(before.world.roads) && Object.keys(JSON.parse(before.world.roads)).length === 1, 'setup: no road was made');
  rig.check(before.world.party !== 'null', 'setup: no party marker was placed, so it is not under test');
  rig.check(JSON.parse(before.world.entries).length === 3 && Object.keys(JSON.parse(before.world.places)).length === 2, 'setup: entries or groups are missing');

  // ── Export, and the zip's own contents ─────────────────────────────────────
  const dir = path.join(rig.outDir, 'всё');
  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, 'всё.zip');
  await dm.evaluate(`doExport(allScenes.map(s => s.id), { destPath: ${JSON.stringify(zip)} })`, 300000);
  rig.check(fs.existsSync(zip) && fs.statSync(zip).size > 0, 'A: the backup wrote no zip');
  const names = fs.existsSync(zip) ? kit.zipEntries(zip).map(e => e.name) : [];
  // A. Each kind's file.
  for (const [file, kind] of [['manifest.json', 'the maps'], ['campaign.json', 'groups, roads, notes, factions, lore and the marker'], ['combat.json', 'fights and the bestiary'],
                              ['moduleText.json', 'module text'], ['gallery.json', 'Pictures'], ['world-background.json', 'the world map backdrop']]) {
    rig.check(names.includes(file), 'A: ' + kind + ' have no ' + file + ' in the zip; it holds ' + names.slice(0, 12).join(', '));
  }
  rig.check(names.some(n => n.startsWith('gallery/')), 'A: Pictures travel without their image files');
  rig.check(names.some(n => /pic-pic1rig/.test(n)), 'A: the room picture has no file in the zip: ' + names.filter(n => /pic/.test(n)).join(', '));
  for (const id of [planId].concat(made)) rig.check(names.some(n => n.includes(id)), 'A: no file for the map ' + id + ' in the zip');
  rig.check(!names.some(n => /music|\.mp3/i.test(n)), 'A: the zip carries music, so the known gap below is out of date');
  rig.note('the zip holds ' + names.length + ' entries: ' + names.filter(n => !n.includes('/')).slice(0, 14).join(', ') + ' ...');

  // ── Empty, restarted, imported ─────────────────────────────────────────────
  await dm.evaluate('__bk.wipe()', 120000);
  dm = await rig.restart();
  await lib.installHelpers(dm);
  await kit.install(dm);
  await lib.settle(dm, 'typeof sceneStore !== "undefined"', 30000);
  const empty = await dm.evaluate('__bk.emptyNow()');
  rig.check(Object.entries(empty).every(([k, v]) => k === 'note' ? v === '' : v === 0), 'B: the library was not empty before the import: ' + JSON.stringify(empty));
  const bgGone = await dm.evaluate('worldBackgroundBackupPayload()');
  rig.check(bgGone === null, 'B: the world map backdrop survived the wipe, so it proves nothing');

  const out = await dm.evaluate(`(async () => {
    __bk.said = [];
    const r = await restoreFromZipPath(${JSON.stringify(zip)}, __bk.say);
    return { said: __bk.said, added: r && r.done ? r.done.added.length : -1 };
  })()`, 300000);
  rig.check(out.added === 4, 'B: the import added ' + out.added + ' maps, not 4');
  const unexpected = out.said.filter(m => !m.startsWith('Import finished'));
  rig.check(unexpected.length === 0, 'B: the import raised messages beyond its report: ' + unexpected.join(' // '));

  const after = kit.withVideoHashes(await dm.evaluate('__bk.digest()', 120000));
  const diffs = kit.diffDigests(before, after, ['stamps', 'roomPicsInGallery']);
  const missing = diffs.filter(d => d.key === 'missing' || d.key === 'appeared');
  rig.check(missing.length === 0, 'B: maps went missing or appeared: ' + missing.map(kit.describe).join(' ; '));
  for (const [kind, keys] of Object.entries(MAP_KINDS)) {
    const bad = diffs.filter(d => d.where.startsWith('map ') && keys.includes(d.key));
    rig.check(bad.length === 0, 'B: ' + kind + ' did not come back: ' + bad.slice(0, 3).map(kit.describe).join(' ; '));
  }
  for (const [kind, keys] of Object.entries(WORLD_KINDS)) {
    const bad = diffs.filter(d => d.where === 'campaign' && keys.includes(d.key));
    rig.check(bad.length === 0, 'B: ' + kind + ' did not come back: ' + bad.slice(0, 3).map(kit.describe).join(' ; '));
  }
  const stamps = Object.keys(before.scenes).filter(id => before.scenes[id].stamps !== (after.scenes[id] || {}).stamps);
  rig.check(stamps.length === 0, 'B: ' + stamps.length + ' maps lost the times their edits were made, which a later import compares');
  const leftover = diffs.filter(d => d.where !== 'music' && !Object.values(MAP_KINDS).concat(Object.values(WORLD_KINDS)).some(keys => keys.includes(d.key)) && d.key !== 'missing' && d.key !== 'appeared');
  rig.check(leftover.length === 0, 'B: something else differs, unnamed by any kind above: ' + leftover.slice(0, 4).map(kit.describe).join(' ; '));
  // The door and the revealed room are the map's own, read from the restored record.
  const planBack = await dm.evaluate('(async () => { const s = await sceneStore.loadScene(' + JSON.stringify(planId) + '); return { doors: s.polygons.reduce((n, p) => n + (p.doors || []).length, 0), modes: s.polygons.map(p => p.mode) }; })()');
  rig.check(planBack.doors === planHas.doors && planBack.modes[0] === 'reveal', 'B: the plan map came back without its doors or its revealed room: ' + JSON.stringify(planBack));
  rig.check(camp.roads.length === 1, 'setup: road bookkeeping');

  kit.known(rig, 'none filed', !diffs.some(d => d.where === 'music'), 'music is not in a backup: the library had ' + before.music.length + ' track, the restored one ' + after.music.length);
};
