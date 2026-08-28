'use strict';

// backup.js — BACKUP AND RESTORE, as far as anything but a person can reach it.
//
// THE GOAL OF THIS FEATURE: the DM's whole library — maps, fog, rooms, effects, grids and the
// campaign's module text — leaves one machine as a single .zip and arrives on another with nothing
// missing. Every check below serves that sentence.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks directly beneath it, in order.
//
//   A. A restore ADDS to the library. It never replaces it, and it never disturbs the scene the
//      DM has open.
//   B. A restored scene comes back whole: its map at its own size, its fog, its grid and its fog
//      look.
//   C. Rooms and effects come back with their own fields, corner radii included.
//   D. A restored scene keeps its floor plan, so Draw Rooms still works on it.
//   E. A name already in the library comes back de-duplicated rather than overwriting.
//   F. The module text rides at the zip ROOT and is adopted on restore; a zip without it leaves
//      the loaded book alone.
//   G. Export's metadata list is a WHITELIST, and every field a restore reads back is in it.
//   H. What only a person can check.
//
// ⚠ THE EXPORT'S SAVE DIALOG IS THE ONE SEAM NOTHING CAN CROSS. doExport opens a native
// showSaveDialog as its FIRST act, and `window.electronAPI` comes through contextBridge, so it is
// non-writable, non-configurable, and its methods cannot be replaced either. There is no way to
// reach the payload builder behind it. So:
//
//   • the zip here is built by handing the app's own createBackupZip the same payload doExport
//     builds, through the real archiver IPC;
//   • the RESTORE side runs the app's own restoreFromZipPath completely untouched;
//   • section G reads doExport's OWN source for its whitelist, because that is the only way to
//     see the list the export really uses rather than the copy this file writes.
//
// Backup and restore therefore still get the DM's own hand test, whatever this file reports. That
// is the one exception to "never ask the DM to hand-verify what the rig can check".
//
// ⚠ SECTION G IS A SOURCE-TEXT CHECK, and that is deliberate rather than lazy. A field missing
// from that whitelist is dropped SILENTLY on export — the zip is valid, the restore succeeds, and
// the loss only shows up as a room without its corner radii or a scene without its Draw Rooms
// button. Nothing else in reach can see it.
//
// ⚠ THE MAP IS ANIMATED, AND EVERY ACCEPTANCE FILE'S IS. Animated is the only kind the DM
// ever uses, so a suite running on still PNGs proved the app worked in a case that never
// happens. `tableMap` (tools/rig/fixtures.js) records the clip once per run and caches it by
// size. Do not swap it back to `stillMap`; smoke.js is the one file that wants both.

const fs = require('fs');
const path = require('path');

const MAP_W = 1200, MAP_H = 800;
const ROOM = { x1: 200, y1: 150, x2: 550, y2: 400 };
const FX = { x1: 700, y1: 450, x2: 1000, y2: 700 };

const PLAN = JSON.stringify({
  format: 0.3,
  resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 10, y: 8 }, pixels_per_grid: 100 },
  line_of_sight: [
    [{ x: 1, y: 1 }, { x: 4, y: 1 }], [{ x: 5, y: 1 }, { x: 7, y: 1 }],
    [{ x: 7, y: 1 }, { x: 7, y: 5 }], [{ x: 7, y: 5 }, { x: 1, y: 5 }],
    [{ x: 1, y: 5 }, { x: 1, y: 1 }],
  ],
  portals: [{ bounds: [{ x: 4, y: 1 }, { x: 5, y: 1 }] }],
});

const MODULE = [
  'K1. The Gatehouse',
  'Two guards stand here, bored and cold. They have not been paid in a month.',
  '',
  'K2. The Chapel',
  'A font of black water sits at the far end. Drinking from it is a very bad idea.',
].join('\n');

module.exports = async function backupFeature(rig) {
  const dm = rig.dm;

  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir,
    { w: MAP_W, h: MAP_H });
  const expr = await rig.fixtures.asFileExpr(dm, map);
  await dm.evaluate('createNewScene(' + expr + ')', 120000);
  await dm.waitFor('currentScene && mapWidth === ' + MAP_W, 120000, 'the map to load on the DM');
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');

  // Everything a backup has to carry, put onto the one scene: a named room with per-corner radii,
  // an effect, a hand-set grid, a dialled-in fog colour, real fog, and a floor plan.
  const prepared = await dm.evaluate(`(async () => {
    const s = document.getElementById('grid-size');
    s.value = 137; s.dispatchEvent(new Event('input', { bubbles: true }));
    const c = document.getElementById('fog-color');
    c.value = '#c02020'; c.dispatchEvent(new Event('input', { bubbles: true }));

    polygons = [{
      id: 1,
      vertices: [{ x: ${ROOM.x1}, y: ${ROOM.y1} }, { x: ${ROOM.x2}, y: ${ROOM.y1} },
                 { x: ${ROOM.x2}, y: ${ROOM.y2} }, { x: ${ROOM.x1}, y: ${ROOM.y2} }],
      mode: 'half', cornerRadius: 24, cornerRadii: [0, 40, 12, null],
      name: 'The Vestry', desc: 'Two acolytes and a trapped font.',
    }];
    nextPolygonId = 2;
    setEffects([{
      id: 1,
      vertices: [{ x: ${FX.x1}, y: ${FX.y1} }, { x: ${FX.x2}, y: ${FX.y1} },
                 { x: ${FX.x2}, y: ${FX.y2} }, { x: ${FX.x1}, y: ${FX.y2} }],
      material: 'fire', cornerRadius: 18, cornerRadii: [6, null, 30, 6], name: 'Burning pews',
    }]);
    nextEffectId = 2;
    currentScene.floorPlan = ${JSON.stringify(PLAN)};

    revealCircle(300, 250, 120);
    rebuildFogFromPolygons(); rebuildFogEffect(); fogDirty = true; scheduleRender();
    doAutoSave();
    await new Promise(r => setTimeout(r, 900));
    return { id: currentScene.id, name: currentScene.name, rooms: polygons.length,
             effects: effects.length, grid: gridSize };
  })()`, 60000);
  rig.note('the scene being backed up: ' + JSON.stringify(prepared));
  rig.check(prepared.rooms === 1 && prepared.effects === 1 && prepared.grid === 137,
            'the scene was not prepared, so nothing below is about a backup: ' +
            JSON.stringify(prepared));

  await dm.evaluate(`(() => {
    globalThis.__rigLoadModule = text => {
      const inp = document.getElementById('mt-file-input');
      const dt = new DataTransfer();
      dt.items.add(new File([text], 'Watcherhouse.txt', { type: 'text/plain' }));
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return 0;
    };
    __rigLoadModule(${JSON.stringify(MODULE)});
    return 0;
  })()`);
  await rig.sleep(600);
  rig.check(await dm.evaluate('mtEntries.length') === 2,
            'the module text did not load, so section F has nothing to travel with');

  // ── Building the zip, through the app's own archiver ──────────────────────
  const zipPath = path.join(rig.outDir, 'library.zip');
  const exported = await dm.evaluate(`(async () => {
    const scenesData = [];
    for (const meta of allScenes) {
      const scene = await sceneStore.loadScene(meta.id);
      if (!scene) continue;
      const mapExt = mapExtFromScene(scene);
      const mapBuffer = scene.mapType !== 'video' ? await blobToArrayBuffer(scene.mapBlob) : null;
      let fogBuffer = null;
      if (scene.baseFogBlob) fogBuffer = await blobToArrayBuffer(scene.baseFogBlob);
      else if (scene.baseFogPNG) fogBuffer = await dataURLToArrayBuffer(scene.baseFogPNG);
      const thumbBuffer = await blobToArrayBuffer(scene.thumbnail);
      const mapMimeType = scene.mapBlob ? (scene.mapBlob.type || 'image/jpeg')
                                        : (mapExt === '.mp4' ? 'video/mp4' : 'video/webm');
      scenesData.push({
        id: scene.id, mapType: scene.mapType || 'image', mapExt,
        metadata: {
          id: scene.id, name: scene.name, mapType: scene.mapType || 'image',
          mapWidth: scene.mapWidth, mapHeight: scene.mapHeight, mapMimeType, mapExt,
          polygons: scene.polygons || [], nextPolygonId: scene.nextPolygonId || 1,
          effects: scene.effects || [], nextEffectId: scene.nextEffectId || 1,
          floorPlan: scene.floorPlan, gridConfig: scene.gridConfig || {},
          fogSettings: scene.fogSettings, createdAt: scene.createdAt || 0,
          sortOrder: scene.sortOrder || 0,
        },
        mapBuffer, fogBuffer, thumbBuffer,
      });
    }
    await window.electronAPI.createBackupZip(${JSON.stringify(zipPath)}, scenesData,
      mtBackupPayload());
    return { count: scenesData.length, before: allScenes.length,
             openId: currentScene.id, openName: currentScene.name };
  })()`, 300000);
  rig.check(fs.existsSync(zipPath) && fs.statSync(zipPath).size > 0,
            'the backup archiver produced no file at ' + zipPath);
  rig.note('exported ' + exported.count + ' scene(s) → ' +
           Math.round(fs.statSync(zipPath).size / 1024) + ' KB');

  // ── A. A restore adds, and leaves the open scene alone ────────────────────
  const restored = await dm.evaluate(`(async () => {
    await restoreFromZipPath(${JSON.stringify(zipPath)});
    const out = [];
    for (const meta of allScenes) {
      const sc = await sceneStore.loadScene(meta.id);
      out.push({
        id: sc.id, name: sc.name, w: sc.mapWidth, h: sc.mapHeight,
        mapType: sc.mapType, mapPath: sc.mapPath || null,
        // ⚠ AN ANIMATED MAP HAS NO mapBlob. Its bytes live in a file under the app's own data
        // directory and the scene carries a path, so "the map came back" means the FILE is there.
        // A check on mapBlob would fail on every animated map, which is every map the DM uses.
        hasMap: sc.mapType === 'video'
          ? !!(await window.electronAPI.getVideoFilePath(sc.id))
          : !!sc.mapBlob,
        hasFog: !!sc.baseFogBlob, hasThumb: !!sc.thumbnail,
        grid: sc.gridConfig ? sc.gridConfig.cellSize : null,
        fogHex: sc.fogSettings ? sc.fogSettings.pickedHex : null,
        plan: !!sc.floorPlan,
        rooms: (sc.polygons || []).map(p => ({ name: p.name, desc: p.desc, mode: p.mode,
                 cr: p.cornerRadius, radii: p.cornerRadii, verts: p.vertices.length })),
        effects: (sc.effects || []).map(e => ({ name: e.name, material: e.material,
                 cr: e.cornerRadius, radii: e.cornerRadii, verts: e.vertices.length })),
        nextPolygonId: sc.nextPolygonId, nextEffectId: sc.nextEffectId,
      });
    }
    return { scenes: out, openId: currentScene ? currentScene.id : null,
             openName: currentScene ? currentScene.name : null };
  })()`, 300000);
  rig.note('the library after the restore: ' +
           JSON.stringify(restored.scenes.map(s => s.name)));
  rig.check(restored.scenes.length === exported.before + exported.count,
            'the restore did not ADD ' + exported.count + ' scene(s): the library holds ' +
            restored.scenes.length + ' where it held ' + exported.before);
  rig.check(restored.openId === exported.openId,
            'the restore switched the DM off the map they had open: ' + restored.openId +
            ' against ' + exported.openId);
  rig.check(restored.openName === exported.openName,
            'the scene the DM had open was renamed by the restore: ' + restored.openName);

  // ⚠ EVERY CHECK FROM HERE TO THE END OF SECTION D READS `copy`. Gated, not left to throw: a
  // restore that added nothing would otherwise kill the run on a TypeError, the report would read
  // "the rig threw" instead of naming the failure, and sections F and G — which do not touch the
  // copy at all — would never run.
  const copy = restored.scenes.find(s => s.id !== exported.openId);
  const original = restored.scenes.find(s => s.id === exported.openId);
  if (rig.check(!!copy && !!original,
                'the restore did not leave a second scene beside the original, so nothing about ' +
                'what came back can be checked: the library holds ' +
                JSON.stringify(restored.scenes.map(x => x.name)))) {
    // ── E. A taken name comes back de-duplicated ─────────────────────────────
    rig.check(copy.name !== exported.openName,
              'the restored copy took the same name as the scene already in the library, so one of ' +
              'them is now unidentifiable: both read ' + JSON.stringify(copy.name));
    rig.check(/ \(2\)$/.test(copy.name),
              'the restored copy was not de-duplicated the way the app names a second copy: ' +
              JSON.stringify(copy.name));

    // ── B. The scene comes back whole ────────────────────────────────────────
    rig.note('the restored copy: ' + JSON.stringify(copy));
    rig.check(copy.w === MAP_W && copy.h === MAP_H,
              'the restored map came back at the wrong size: ' + copy.w + 'x' + copy.h);
    rig.check(copy.hasMap,
              'the restored scene has no map file on disk, so it opens on nothing: mapType ' +
              copy.mapType + ', path ' + copy.mapPath);
    // Its OWN copy of the video, under its own id. Pointing at the original's file would mean
    // deleting one scene breaks the other.
    rig.check(copy.mapPath && original.mapPath && copy.mapPath !== original.mapPath,
              "the restored scene points at the original's video file, so deleting either one " +
              'breaks the other: both read ' + copy.mapPath);
    rig.check(!copy.mapPath || copy.mapPath.indexOf(copy.id) !== -1,
              "the restored scene's video file is not named after the scene that owns it: " +
              copy.mapPath);
    rig.check(copy.hasFog,
              'the restored scene has no fog, so everything the DM revealed in a whole session is ' +
              'gone and the map opens fully shrouded');
    rig.check(copy.hasThumb, 'the restored scene has no thumbnail, so its card in the library is blank');
    rig.check(copy.grid === 137,
              'the restored scene lost the grid it was fitted to: ' + copy.grid);
    rig.check(copy.fogHex === '#c02020',
              'the restored scene lost the fog colour the DM dialled in: ' + copy.fogHex);

    // ── C. Rooms and effects, with their own fields ──────────────────────────
    rig.check(copy.rooms.length === 1,
              'the restored scene lost its rooms: ' + JSON.stringify(copy.rooms));
    const r = copy.rooms[0] || {};
    rig.check(r.name === 'The Vestry' && r.desc === 'Two acolytes and a trapped font.',
              "a restored room lost its name or the DM's notes: " + JSON.stringify(r));
    rig.check(r.mode === 'half',
              'a restored room lost its fog mode, so the map opens shrouded where it was half: ' +
              r.mode);
    rig.check(r.cr === 24,
              'a restored room lost its corner radius: ' + r.cr);
    // ⚠ THE FIELD A WHITELIST DROPS FIRST. cornerRadii is per-corner and was added after the
    // record's first shape, so any normalisation from a fixed key list loses it silently.
    rig.check(Array.isArray(r.radii) && r.radii.length === 4 &&
              r.radii[1] === 40 && r.radii[2] === 12,
              'a restored room lost its per-corner radii, which is the field a fixed key list drops ' +
              'first: ' + JSON.stringify(r.radii));

    rig.check(copy.effects.length === 1,
              'the restored scene lost its effects, so ground the DM marked as burning is gone: ' +
              JSON.stringify(copy.effects));
    const e = copy.effects[0] || {};
    rig.check(e.name === 'Burning pews' && e.material === 'fire',
              'a restored effect lost its name or its material: ' + JSON.stringify(e));
    rig.check(Array.isArray(e.radii) && e.radii[2] === 30,
              'a restored effect lost its per-corner radii: ' + JSON.stringify(e.radii));
    rig.check(copy.nextPolygonId >= 2 && copy.nextEffectId >= 2,
              'the restored scene came back with id counters that would collide with its own ' +
              'shapes: ' + copy.nextPolygonId + '/' + copy.nextEffectId);

    // ── D. The floor plan survives ───────────────────────────────────────────
    rig.check(copy.plan,
              'the restored scene lost its floor plan, so Draw Rooms is disabled on it with ' +
              'nothing to explain why');
    const drawable = await dm.evaluate(`(async () => {
      await switchScene(${JSON.stringify(copy.id)});
      return { on: currentScene.id, planBtn: !document.getElementById('btn-floorplan').disabled };
    })()`, 120000);
    rig.check(drawable.planBtn,
              'Draw Rooms is disabled on the restored scene even though its plan came back');
  }

  // ── F. The module text rides at the zip root ─────────────────────────────
  const adopted = await dm.evaluate(`(async () => {
    const before = mtEntries.length;
    mtStore([], '');
    const emptied = mtEntries.length;
    await adoptModuleTextFromZip(${JSON.stringify(zipPath)});
    return { before, emptied, after: mtEntries.length,
             first: mtEntries.length ? mtEntries[0].title : null,
             source: mtSourceName || null };
  })()`, 120000);
  rig.note('the module text out of the zip: ' + JSON.stringify(adopted));
  rig.check(adopted.emptied === 0,
            'the book could not be cleared first, so the adoption below proves nothing');
  rig.check(adopted.after === 2 && adopted.first === 'K1. The Gatehouse',
            'the module text did not travel in the backup, so a DM restoring on another machine ' +
            'has their maps and not their module: ' + JSON.stringify(adopted));

  // A zip written before module text existed carries no such entry, and must leave the loaded
  // book exactly as it was.
  const plainZip = path.join(rig.outDir, 'no-module.zip');
  const untouched = await dm.evaluate(`(async () => {
    const scenesData = [];
    const scene = await sceneStore.loadScene(${JSON.stringify(exported.openId)});
    scenesData.push({
      id: scene.id, mapType: 'image', mapExt: mapExtFromScene(scene),
      metadata: { id: scene.id, name: scene.name, mapType: 'image',
                  mapWidth: scene.mapWidth, mapHeight: scene.mapHeight,
                  mapMimeType: 'image/png', mapExt: mapExtFromScene(scene),
                  polygons: [], nextPolygonId: 1, effects: [], nextEffectId: 1,
                  gridConfig: {}, createdAt: 0, sortOrder: 0 },
      mapBuffer: await blobToArrayBuffer(scene.mapBlob),
      fogBuffer: null, thumbBuffer: await blobToArrayBuffer(scene.thumbnail),
    });
    // The third argument is what carries the book. Null is what every older zip has.
    await window.electronAPI.createBackupZip(${JSON.stringify(plainZip)}, scenesData, null);
    const before = mtEntries.length;
    await adoptModuleTextFromZip(${JSON.stringify(plainZip)});
    return { before, after: mtEntries.length };
  })()`, 300000);
  rig.note('a zip with no module text in it: ' + JSON.stringify(untouched));
  rig.check(untouched.after === untouched.before && untouched.after === 2,
            'restoring a backup with no module text in it wiped the book that was loaded, so an ' +
            'older zip costs the DM their whole module: ' + JSON.stringify(untouched));

  // ── G. The export whitelist ──────────────────────────────────────────────
  // Read off doExport itself. Nothing else can see the list the export really uses: the payload
  // above is this file's own copy of it, so the two agreeing proves nothing.
  // ⚠ READ INSIDE THE `metadata:` LITERAL, NOT THE WHOLE FUNCTION. Several of these names are
  // also local consts a few lines above it, so a search over the whole source finds them whether
  // or not they are ever written into the zip. And the keys may be shorthand (`mapExt,`) as well
  // as `key: value`, so the match is on the name, not on a colon.
  const whitelist = await dm.evaluate(`(() => {
    const src = doExport.toString();
    const at = src.indexOf('metadata: {');
    if (at === -1) return { err: 'doExport has no metadata literal any more' };
    let depth = 0, end = -1;
    for (let i = src.indexOf('{', at); i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (!depth) { end = i; break; } }
    }
    if (end === -1) return { err: 'the metadata literal does not close' };
    const block = src.slice(at, end);
    const want = ['polygons', 'nextPolygonId', 'effects', 'nextEffectId', 'floorPlan',
                  'gridConfig', 'fogSettings', 'name', 'mapWidth', 'mapHeight', 'mapType',
                  'mapMimeType', 'mapExt', 'createdAt', 'sortOrder'];
    const missing = want.filter(k => !new RegExp('(^|[\\\\s{,])' + k + '\\\\s*[:,}\\\\n]').test(block));
    return { missing, carriesModuleText: src.indexOf('mtBackupPayload') !== -1 };
  })()`);
  if (whitelist.err) rig.check(false, 'the export whitelist could not be read: ' + whitelist.err);
  rig.note('the export whitelist: ' + JSON.stringify(whitelist));
  rig.check(!whitelist.err && whitelist.missing.length === 0,
            'the export drops ' + JSON.stringify(whitelist.missing) + ' — a field missing from ' +
            "that list goes silently, the zip stays valid, and the loss shows up as a room " +
            'without its radii or a scene without its Draw Rooms button');
  rig.check(whitelist.carriesModuleText,
            'the export no longer puts the module text in the zip, so a restored library comes ' +
            'back without the campaign');

  // ── H. What only a person can check ──────────────────────────────────────
  rig.byEye('a real export through the Backup button — its save dialog is a native window and ' +
            "`electronAPI` cannot be stubbed, so the picked path, the progress bar and the file " +
            'that lands on disk are all beyond anything but a hand test');
  rig.byEye('a real restore of that file on a second machine, which is the whole point of the ' +
            'feature and the one thing a single-machine run can never be');
};
