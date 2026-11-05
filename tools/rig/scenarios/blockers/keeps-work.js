'use strict';

// keeps-work.js — THE DM'S WORK IS NOT LOST.
//
// A Russian-named animated 3110x2160 map with its three rooms from the floor plan, one of them revealed.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   A. After the app is closed and started again, it opens the same map at its size, with its three rooms and the
//      room that was revealed still revealed, and the other two still fogged.
//   B. A backup zip of the library, restored into an empty library, brings the map and its rooms back, with the
//      map's video file on disk.
//
// ⚠ THE BACKUP'S SAVE DIALOG IS THE ONE SEAM THE RIG CANNOT CROSS: doExport takes a destPath that goes round it,
// and the restore is the app's own restoreFromZipPath. The native dialog is the DM's own hand test.

const fs = require('fs');
const path = require('path');

const lib = require('../../lib');

const NAME = 'Тронный зал';

module.exports = async function keepsWork(rig) {
  let dm = rig.dm;
  const sceneId = await lib.importWithPlan(rig, NAME);
  const rooms = await lib.drawRooms(rig, 3);
  rig.check(rooms.length === 3, 'setup: the plan did not give three rooms: ' + rooms.length);
  const seen = rooms[0], hidden = rooms[2];

  // The first room revealed through the app's own mode change; the autosave then has to put it on disk.
  await dm.evaluate('setPolygonMode(' + seen.id + ', "reveal"); scheduleAutoSave(); 0');
  await lib.settle(dm, 'fogCoverT === 0 && !fogTransRafId', 30000);
  // ⚠ WAITED FOR ON DISK, never slept through: a restart that beats the autosave proves only that the timer lost.
  const onDisk = await lib.poll(async () => {
    const got = await dm.evaluate(`(async () => {
      const s = await sceneStore.loadScene(${JSON.stringify(sceneId)});
      return s && s.baseFogBlob && (s.polygons || []).length === 3
        ? (s.polygons.find(p => p.id === ${seen.id}) || {}).mode : null;
    })()`, 30000);
    return got === 'reveal' ? { mode: got } : null;
  }, 60000, 500);
  rig.check(!!onDisk, 'setup: the revealed room never reached the disk, so the restart below asks nothing');

  // ── A. A restart keeps the map, its rooms and its fog ─────────────────────
  // RED ON: the stored scene's rooms emptied and sceneStore/doAutoSave writes neutered before the restart — 2026-11-05
  dm = await rig.restart();
  await lib.installHelpers(dm);
  await lib.settle(dm, 'currentScene && fogCoverT === 0 && mapWidth > 0', 120000);
  const back = await dm.evaluate(`({ id: currentScene && currentScene.id, name: currentScene && currentScene.name,
    w: mapWidth, h: mapHeight, type: currentScene && currentScene.mapType, rooms: polygons.map(p => p.mode) })`);
  rig.check(back.id === sceneId && back.name === NAME, 'A: the app did not reopen the map it was closed on: ' + JSON.stringify(back));
  rig.check(back.w === lib.DM_MAP.w && back.h === lib.DM_MAP.h && back.type === 'video',
            'A: the map came back at the wrong size or no longer animated: ' + JSON.stringify(back));
  rig.check(back.rooms.length === 3, 'A: the rooms did not come back: ' + JSON.stringify(back.rooms));
  const sees = await lib.poll(async () => {
    const a = await dm.evaluate('__rigFog(' + Math.round(seen.cx) + ',' + Math.round(seen.cy) + ')');
    return a < 128 ? { a } : null;
  }, 30000);
  rig.check(!!sees, 'A: the room that was revealed is fogged again after the restart');
  rig.check(await dm.evaluate('__rigFog(' + Math.round(hidden.cx) + ',' + Math.round(hidden.cy) + ')') > 200,
            'A: a room nobody revealed came back clear after the restart');

  // ── B. A backup restores into an empty library ────────────────────────────
  // RED ON: the same patch as A (the backup is read from the emptied store) — 2026-11-05
  const dir = path.join(rig.outDir, 'резервная копия');
  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, 'библиотека.zip');
  await dm.evaluate(`doExport(allScenes.map(s => s.id), { destPath: ${JSON.stringify(zip)} })`, 300000);
  rig.check(fs.existsSync(zip) && fs.statSync(zip).size > 0, 'B: the backup wrote no zip');

  const restored = await dm.evaluate(`(async () => {
    const ids = allScenes.map(s => s.id);
    deleteScenesWithUndo(ids);
    commitPendingDelete();
    for (const id of ids) { await sceneStore.deleteScene(id); await window.electronAPI.deleteVideoFile(id).catch(() => {}); }
    const emptied = allScenes.length;
    await restoreFromZipPath(${JSON.stringify(zip)});
    const out = [];
    for (const meta of allScenes) {
      const sc = await sceneStore.loadScene(meta.id);
      out.push({ name: sc.name, type: sc.mapType, w: sc.mapWidth, h: sc.mapHeight, rooms: (sc.polygons || []).length,
                 abs: sc.mapType === 'video' ? await window.electronAPI.getVideoFilePath(sc.id) : null });
    }
    return { emptied, scenes: out };
  })()`, 300000);
  rig.check(restored.emptied === 0, 'B: the library was not empty before the restore, so it proves nothing: ' + restored.emptied);
  const map = restored.scenes.find(s => s.name === NAME);
  rig.check(!!map && map.type === 'video' && map.w === lib.DM_MAP.w && map.h === lib.DM_MAP.h,
            'B: the map did not come back from the backup: ' + JSON.stringify(restored.scenes));
  rig.check(!!map && map.rooms === 3, 'B: the map came back without its rooms: ' + JSON.stringify(map));
  rig.check(!!map && !!map.abs && fs.existsSync(map.abs) && fs.statSync(map.abs).size > 0, 'B: the restored map has no video file on disk');
};
