'use strict';

// backup-large-library.js — A BIG LIBRARY SURVIVES A BACKUP.
//
// Not a blocker: it takes minutes and exists to stress what the blocker's one-map backup cannot. A library the way
// the DM's grows: many still maps (a few of them huge), two animated maps, three rooms, two effects, a light, notes,
// a fog layer and a picture on most of them, and the campaign records around them.
//
//   npm run rig -- backup-large-library
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   A. The library is built the app's own way and the export runs to the end on it (the zip is written, no dialog
//      is left on screen, the renderer's heap is noted).
//   B. The zip lists every map's files, its manifest, and the campaign, fights, module text and pictures.
//   C. After the library is emptied and the app restarted, the app really is empty.
//   D. Importing the zip into the empty library brings back every map with its size, rooms, effects, lights, notes,
//      grid, fog layer, room pictures and its animated map's file, byte for byte.
//   E. The campaign records come back: groups, roads, notes, entries, fights, bestiary, module text, pictures.
//   F. A restored map opens, and its fog layer is still clear where it was cleared.
//
// KNOWN AND NOT FAILED HERE: music, which a backup does not carry at all (noted, no item yet).
//
// ⚠ THE SAVE DIALOG IS THE ONE SEAM THE RIG CANNOT CROSS: doExport takes a destPath that goes round it. The DM's own
// hand test of Export and Import stays.

const fs = require('fs');
const path = require('path');

const lib = require('../lib');
const kit = require('../backupKit');

// The sizes the run uses by default finish in about a minute (379 MB of still maps). RIG_BACKUP_SMALL=60 RIG_BACKUP_HUGE=8 (535 MB) raises them
// past the size a one-message export stalled at.
const SMALL = { count: Number(process.env.RIG_BACKUP_SMALL) || 40, w: 3200, h: 2133 };
const HUGE = { count: Number(process.env.RIG_BACKUP_HUGE) || 6, w: 8000, h: 5000 };
const VIDEOS = [{ name: 'Видео зал', w: 3110, h: 2160 }, { name: 'Видео склеп', w: 3840, h: 2160, big: true }];

const heap = dm => dm.evaluate('performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1');

module.exports = async function backupLargeLibrary(rig) {
  let dm = rig.dm;
  await lib.installHelpers(dm);
  await kit.install(dm);
  const t0 = Date.now();
  const lap = what => rig.note(what + ': ' + Math.round((Date.now() - t0) / 1000) + 's into the run');

  // ── A. Build the library ───────────────────────────────────────────────────
  const made = [];   // { id, name, fogAt, big }
  const addStill = async (name, w, h, seed, big) => {
    const r = await dm.evaluate(`(async () => {
      const f = await __bk.noiseFile(${JSON.stringify(name)}, ${w}, ${h}, ${seed}, ${big ? 0.95 : 0.9});
      return addMapsToLibrary([f], { x: ${(seed % 6) * 300}, y: ${Math.floor(seed / 6) * 250} }, true);
    })()`, 300000);
    rig.check(r && r.ids && r.ids.length === 1, 'setup: the map "' + name + '" did not import: ' + JSON.stringify(r));
    if (r && r.ids && r.ids[0]) made.push({ id: r.ids[0], name, big });
  };
  for (let i = 0; i < HUGE.count; i++) await addStill('Огромная карта ' + (i + 1), HUGE.w, HUGE.h, 100 + i, true);
  for (let i = 0; i < SMALL.count; i++) await addStill('Карта ' + (i + 1), SMALL.w, SMALL.h, i + 1, false);
  for (const v of VIDEOS) {
    const base = await rig.fixtures.tableMap(dm, rig.fixtureDir, v.big
      ? { w: v.w, h: v.h, seconds: 2, bitrate: 30000000, name: 'rig-big-video.mp4' }
      : { w: v.w, h: v.h });
    const file = await rig.fixtures.asFileExpr(dm, Object.assign({}, base, { name: v.name + '.mp4' }));
    const r = await dm.evaluate(`addMapsToLibrary([${file}], { x: 1800, y: ${v.big ? 500 : 250} }, true)`, 300000);
    rig.check(r && r.ids && r.ids.length === 1, 'setup: the animated map "' + v.name + '" did not import: ' + JSON.stringify(r));
    if (r && r.ids && r.ids[0]) made.push({ id: r.ids[0], name: v.name, video: true });
  }
  lap('maps imported (' + made.length + ')');
  const total = made.length;
  rig.check(total === HUGE.count + SMALL.count + VIDEOS.length, 'setup: only ' + total + ' maps were made');

  for (let i = 0; i < made.length; i++) {
    const m = made[i];
    const got = await dm.evaluate(`__bk.decorate(${JSON.stringify(m.id)}, ${i + 1}, { pictured: ${i % 4 === 0} })`, 120000);
    m.fogAt = got.fogAt;
  }
  await dm.evaluate(`__bk.campaign(${JSON.stringify(made.map(m => m.id))}, 'L')`, 120000);
  await dm.evaluate('__bk.fights("L"); __bk.moduleText("Книга L"); 0');
  await dm.evaluate('__bk.gallery(3, "Картинка")', 60000);
  const track = path.join(rig.outDir, 'тема героев.mp3');
  fs.writeFileSync(track, Buffer.from('ID3rig-not-really-audio'));
  await dm.evaluate('window.electronAPI.copyMusicFiles([' + JSON.stringify(track) + '])');
  lap('records written');

  // The fog fixture is only worth asking after the backup if the app itself shows it before.
  const samples = [made.find(x => x.big), made.find(x => !x.big && !x.video), made.find(x => x.video)];
  for (const m of samples) {
    await dm.evaluate('switchScene(' + JSON.stringify(m.id) + ')', 240000);
    await lib.settle(dm, 'currentScene && currentScene.id === ' + JSON.stringify(m.id) + ' && fogCoverT === 0', 120000);
    await lib.installHelpers(dm);
    const a = await dm.evaluate('__rigFog(' + Math.round(m.fogAt.x) + ',' + Math.round(m.fogAt.y) + ')');
    rig.check(a < 128, 'setup: the cleared fog spot of "' + m.name + '" reads ' + a + ' before any backup, so the fixture is wrong');
  }
  const before = kit.withVideoHashes(await dm.evaluate('__bk.digest()', 300000));
  rig.check(Object.keys(before.scenes).length === total, 'setup: the library holds ' + Object.keys(before.scenes).length + ' maps, not ' + total);
  const stillBytes = Object.values(before.scenes).filter(s => s.type === 'image').reduce((n, s) => n + Number(String(s.map).split(':')[1] || 0), 0);
  rig.note('library: ' + total + ' maps, ' + Math.round(stillBytes / 1048576) + ' MB of still maps; heap ' + await heap(dm) + ' MB');

  // ── Export ─────────────────────────────────────────────────────────────────
  const dir = path.join(rig.outDir, 'большая копия');
  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, 'библиотека.zip');
  const h0 = await heap(dm), tExp = Date.now();
  // ⚠ BOUNDED: an export that never answers must end this run with a name, not a timeout.
  try {
    await dm.evaluate(`doExport(allScenes.map(s => s.id), { destPath: ${JSON.stringify(zip)} })`, 240000);
  } catch (err) {
    rig.check(false, 'A: the export of ' + total + ' maps (' + Math.round(stillBytes / 1048576) + ' MB of still maps) did not finish in 4 minutes: ' + (err && err.message ? err.message : err));
    return;
  }
  rig.note('export: ' + Math.round((Date.now() - tExp) / 1000) + 's, heap ' + h0 + ' -> ' + await heap(dm) + ' MB');
  rig.check(fs.existsSync(zip) && fs.statSync(zip).size > 0 && kit.zipEntries(zip).reduce((n, e) => n + e.size, 0) >= stillBytes,
            'A: the export wrote no usable zip: ' + (fs.existsSync(zip) ? kit.zipEntries(zip).reduce((n, e) => n + e.size, 0) + ' bytes inside for ' + stillBytes + ' of maps' : 'no file'));
  rig.check(!(await dm.evaluate('!!document.getElementById("cd-modal")')), 'A: a dialog was left on screen after the export');

  // ── B. What the zip holds ──────────────────────────────────────────────────
  const names = fs.existsSync(zip) ? kit.zipEntries(zip).map(e => e.name) : [];
  const has = n => names.includes(n);
  for (const root of ['manifest.json', 'campaign.json', 'combat.json', 'moduleText.json', 'gallery.json']) {
    rig.check(has(root), 'B: the zip has no ' + root + '; it holds ' + names.slice(0, 8).join(', '));
  }
  rig.check(names.some(n => n.startsWith('gallery/')), 'B: the zip carries no picture files');
  const missingMaps = made.filter(m => !names.some(n => n.includes(m.id)));
  rig.check(missingMaps.length === 0, 'B: no file in the zip for these maps: ' + missingMaps.map(m => m.name).join(', '));
  rig.check(!names.some(n => /music/i.test(n)), 'B: the zip carries music, so the known gap below is out of date');

  // ── C. An empty library ────────────────────────────────────────────────────
  await dm.evaluate('__bk.wipe()', 300000);
  dm = await rig.restart();
  await lib.installHelpers(dm);
  await kit.install(dm);
  await lib.settle(dm, 'typeof sceneStore !== "undefined"', 30000);
  const empty = await dm.evaluate('__bk.emptyNow()');
  rig.check(Object.entries(empty).every(([k, v]) => k === 'note' ? v === '' : v === 0),
            'C: the library was not empty before the import, so it proves nothing: ' + JSON.stringify(empty));

  // ── D and E. Import ────────────────────────────────────────────────────────
  const tImp = Date.now(), h1 = await heap(dm);
  const out = await dm.evaluate(`(async () => {
    __bk.said = [];
    const r = await restoreFromZipPath(${JSON.stringify(zip)}, __bk.say);
    return { added: r && r.done ? r.done.added.length : -1, said: __bk.said, dialog: !!document.getElementById('cd-modal') };
  })()`, 900000);
  rig.note('import: ' + Math.round((Date.now() - tImp) / 1000) + 's, heap ' + h1 + ' -> ' + await heap(dm) + ' MB');
  rig.check(out.added === total, 'D: the import reported ' + out.added + ' maps added, not ' + total);
  const unexpected = out.said.filter(m => !m.startsWith('Import finished'));
  rig.check(unexpected.length === 0, 'D: the import raised messages beyond its report: ' + unexpected.join(' // '));
  rig.check(!out.dialog, 'D: a dialog was left on screen after the import');

  const after = kit.withVideoHashes(await dm.evaluate('__bk.digest()', 300000));
  const diffs = kit.diffDigests(before, after, ['stamps', 'roomPicsInGallery']);
  const mapDiffs = diffs.filter(d => d.where.startsWith('map '));
  rig.check(mapDiffs.length === 0, 'D: ' + mapDiffs.length + ' differences in the restored maps: ' + mapDiffs.slice(0, 6).map(kit.describe).join(' ; '));
  const worldDiffs = diffs.filter(d => d.where === 'campaign');
  rig.check(worldDiffs.length === 0, 'E: the campaign records differ after the import: ' + worldDiffs.slice(0, 6).map(kit.describe).join(' ; '));
  const stamps = Object.keys(before.scenes).filter(id => before.scenes[id].stamps !== (after.scenes[id] || {}).stamps);
  rig.check(stamps.length === 0, 'D: ' + stamps.length + ' maps lost the times their edits were made, which a later import compares');
  kit.known(rig, 'none filed', !diffs.some(d => d.where === 'music'), 'music is not in a backup: the library had ' + before.music.length + ' track, the restored one ' + after.music.length);

  const pictured = made.filter((m, i) => i % 4 === 0).length;
  rig.check(after.world.roomPicsInGallery === String(pictured), 'E: the room pictures of the restored maps did not join Pictures: ' + after.world.roomPicsInGallery + ' of ' + pictured);

  // ── F. A restored map opens, fog and all ───────────────────────────────────
  for (const m of samples) {
    await dm.evaluate('switchScene(' + JSON.stringify(m.id) + ')', 240000);
    await lib.settle(dm, 'currentScene && currentScene.id === ' + JSON.stringify(m.id) + ' && fogCoverT === 0', 120000);
    await lib.installHelpers(dm);
    const clear = await lib.poll(async () => {
      const a = await dm.evaluate('__rigFog(' + Math.round(m.fogAt.x) + ',' + Math.round(m.fogAt.y) + ')');
      return a < 128 ? { a } : null;
    }, 30000);
    rig.check(!!clear, 'F: "' + m.name + '" opened from the restored library with its cleared fog fogged again');
    rig.check(await dm.evaluate('polygons.length') === 3, 'F: "' + m.name + '" opened without its three rooms');
  }
  lap('done');
};
