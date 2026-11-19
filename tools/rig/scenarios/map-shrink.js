'use strict';

// map-shrink.js - THE AI ASSISTANT COPIES A MAP AND SHRINKS ONE, KEEPING EVERYTHING ON IT (copy_scene, shrink_map).
// It guards the DM's maps: a shrink replaces a map's file for good.
//
// One app with the sync index on (a sync config pointing nowhere). An animated map "Холм": a VP9 WebM at 4800x2700, the
// format and size of a Dungeon Alchemist export, made with ffmpeg. It carries three rooms (one with a hole, a rounded
// corner and a door), a revealed disc of fog, two effects, a light, notes and a fitted grid.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   A. copy_scene makes "Холм копия": the reply states the pixel size and the 4K warning; the copy holds the same rooms,
//      grid, fog picture, fog look, effects, lights and notes, read_scene reads the same, and it has its own .webm file.
//   B. Deleting the original (delete_scene, confirmed) leaves the copy whole: its file is still in userData/maps.
//   C. shrink_map to 4K makes the copy 3840x2160: read_scene reads the same in percent (within 0.15); its file is an .mp4,
//      smaller, and the .webm is gone; the .webm was still on disk when the new record finished saving; the reply says
//      the shrink is permanent.
//   D. The shrunk copy opens and plays at 3840x2160.
//   E. shrink_map on the open map is refused, and nothing changes.
//   F. The sync index holds the new file's SHA-256 for the map, so the next sync sends the new file.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const lib = require('../lib');
const kit = require('../backupKit');

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

// Three seconds of moving test picture, VP9 at 4800x2700, cached for the run like the recorded fixtures.
function vp9Source(dir) {
  const file = path.join(dir, 'rig-da-4800x2700.webm');
  if (!fs.existsSync(file)) {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=4800x2700:rate=10', '-t', '3',
      '-c:v', 'libvpx-vp9', '-crf', '10', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-pix_fmt', 'yuv420p', file]);
    if (r.error || r.status !== 0) return null;
  }
  return { base64: fs.readFileSync(file).toString('base64'), name: 'Холм.webm', type: 'video/webm' };
}

module.exports = async function mapShrink(rig) {
  const q = JSON.stringify;
  rig.writeSyncConfig(rig.profileDir, { url: 'http://127.0.0.1:9' });
  const dm = await rig.restart();
  await kit.install(dm);
  const mapsDir = path.join(rig.profileDir, 'maps');
  const fileOf = id => (fs.existsSync(mapsDir) ? fs.readdirSync(mapsDir).filter(n => n.startsWith(id + '.')) : []);
  const size = id => fileOf(id).reduce((a, n) => a + fs.statSync(path.join(mapsDir, n)).size, 0);
  const ask = (tool, args) => dm.evaluate(`_mcpAnswer({ tool: ${q(tool)}, args: ${q(args)} }).then(r => r.text)`, 280000);
  // The grid's cellPx is map pixels by design; everything else read_scene gives is percent.
  const read = async name => { const j = JSON.parse(await ask('read_scene', { name })); delete j.name; delete j.group; delete j.map; if (j.grid) delete j.grid.cellPx; return j; };
  const differ = (a, b, tol, at = '') => {
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tol ? null : at + ': ' + a + ' vs ' + b;
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = differ(a[k], b[k], tol, at + '.' + k); if (d) return d; }
      return null;
    }
    return a === b ? null : at + ': ' + q(a) + ' vs ' + q(b);
  };
  const plain = id => dm.evaluate(`sceneStore.loadScene(${q(id)}).then(async r => ({ rooms: JSON.stringify(r.polygons), grid: JSON.stringify(r.gridConfig), fog: await __bk.hash(r.baseFogBlob),
    look: JSON.stringify([r.fogTheme, r.weather, r.timeOfDay]), effects: JSON.stringify(r.effects), lights: JSON.stringify([r.lightShapes, r.lightsHidden]), notes: r.notes, mapPath: r.mapPath, w: r.mapWidth, h: r.mapHeight }))`, 30000);

  // Setup
  const src0 = vp9Source(rig.fixtureDir);
  if (!rig.check(!!src0, 'setup: ffmpeg could not make the VP9 source (is ffmpeg with libvpx installed?)')) return;
  const file = await rig.fixtures.asFileExpr(dm, src0);
  const src = await dm.evaluate(`(async () => {
    const id = (await addMapsToLibrary([${file}], { x: 0, y: 0 }, true)).ids[0];
    await __bk.decorate(id, 1, {});
    await __bk.editScene(id, sc => {
      const w = sc.mapWidth, h = sc.mapHeight, p = sc.polygons[0];
      p.holes = [[{ x: 0.2 * w, y: 0.2 * h }, { x: 0.3 * w, y: 0.2 * h }, { x: 0.3 * w, y: 0.3 * h }, { x: 0.2 * w, y: 0.3 * h }]];
      p.cornerRadii = [60, 0, 0, 0, 0, 0, 0, 0];
      p.doors = [{ edge: 1, t: 0.5 }];
      sc.gridConfig = Object.assign({}, sc.gridConfig, { enabled: true, cellSize: 150, offsetX: 37, offsetY: 21 });
      sc.name = 'Холм';
    });
    allScenes.find(s => s.id === id).name = 'Холм';
    return id;
  })()`, 240000);
  const before = await plain(src);
  rig.check(before.w === 4800 && before.h === 2700 && /\.webm$/.test(before.mapPath) && fileOf(src).length === 1, 'setup: "Холм" is not a 4800x2700 WebM map with a file: ' + q([before.w, before.h, before.mapPath, fileOf(src)]));
  const readSrc = await read('Холм');

  // A
  const copied = await ask('copy_scene', { name: 'Холм', newName: 'Холм копия' });
  rig.check(/4800×2700 pixels/.test(copied) && /larger than 4K/.test(copied), 'A: the copy_scene reply does not state the size and the 4K warning: ' + copied);
  const cid = await dm.evaluate(`(allScenes.find(s => s.name === 'Холм копия') || {}).id || null`);
  if (!rig.check(!!cid, 'A: no map "Холм копия" in the library: ' + copied)) return;
  const copy = await plain(cid);
  for (const k of ['rooms', 'grid', 'fog', 'look', 'effects', 'lights', 'notes', 'w', 'h']) rig.check(copy[k] === before[k], 'A: the copy\'s ' + k + ' differs from the original\'s');
  rig.check(copy.mapPath !== before.mapPath && q(fileOf(cid)) === q([cid + '.webm']) && size(cid) === size(src), 'A: the copy has no .webm of its own in userData/maps: ' + q([copy.mapPath, fileOf(cid)]));
  const d1 = differ(readSrc, await read('Холм копия'), 0);
  rig.check(!d1, 'A: read_scene reads the copy differently: ' + d1);

  // B
  const del = await ask('delete_scene', { name: 'Холм', confirmed: true });
  const gone = await lib.poll(async () => !(await dm.evaluate(`allScenes.some(s => s.id === ${q(src)})`)) && fileOf(src).length === 0, 20000, 200);
  rig.check(!!gone, 'B: the original did not leave the library with its file: ' + del);
  rig.check(fileOf(cid).length === 1 && (await plain(cid)).rooms === before.rooms, 'B: deleting the original took the copy\'s file or rooms with it');

  // C: the moment the new record has saved, which file the app finds for the map.
  await dm.evaluate(`(() => { const up = sceneStore.updateScene; globalThis.__rigSaves = [];
    sceneStore.updateScene = async (id, fn) => { await up(id, fn); if (id === ${q(cid)}) __rigSaves.push(await window.electronAPI.getVideoFilePath(id)); }; return 0; })()`);
  const oldSize = size(cid);
  const shrunk = await ask('shrink_map', { name: 'Холм копия', size: '4K' });
  rig.note('shrink_map: ' + shrunk);
  const after = await plain(cid);
  rig.check(after.w === 3840 && after.h === 2160, 'C: the shrunk map is ' + after.w + 'x' + after.h + ', not 3840x2160: ' + shrunk);
  rig.check(/permanent/.test(shrunk), 'C: the reply does not say the shrink is permanent: ' + shrunk);
  const d2 = differ(readSrc, await read('Холм копия'), 0.15);
  rig.check(!d2, 'C: read_scene moved after the shrink: ' + d2);
  rig.check(q(fileOf(cid)) === q([cid + '.mp4']) && after.mapPath === 'maps/' + cid + '.mp4', 'C: the map\'s file is not one .mp4 with the .webm gone: ' + q([fileOf(cid), after.mapPath]));
  rig.check(size(cid) < oldSize, 'C: the file on disk did not get smaller: ' + oldSize + ' -> ' + size(cid));
  rig.note('file ' + oldSize + ' -> ' + size(cid) + ' bytes');
  const saves = await dm.evaluate('__rigSaves');
  rig.check(saves.length >= 1 && /\.webm$/.test(saves[0] || ''), 'C: the .webm was not on disk when the new record saved: ' + q(saves));

  // D
  await dm.evaluate(`switchScene(${q(cid)})`, 60000);
  const t0 = await lib.poll(async () => dm.evaluate('mapVideo && mapVideo.readyState >= 2 ? { t: mapVideo.currentTime, w: mapVideo.videoWidth, h: mapVideo.videoHeight } : null'), 30000, 200);
  const plays = t0 && await lib.poll(async () => dm.evaluate(`mapVideo && !mapVideo.paused && mapVideo.currentTime !== ${t0.t}`), 15000, 200);
  rig.check(!!plays && t0.w === 3840 && t0.h === 2160 && await dm.evaluate('mapWidth') === 3840, 'D: the shrunk map does not play at 3840x2160: ' + q(t0));

  // E
  const refused = await ask('shrink_map', { name: 'Холм копия' });
  rig.check(/open/.test(refused) && /Not done/.test(refused), 'E: shrink_map on the open map was not refused: ' + refused);
  rig.check((await plain(cid)).rooms === after.rooms, 'E: the refused shrink changed the rooms');

  // F
  const want = sha(fs.readFileSync(path.join(mapsDir, cid + '.mp4')));
  const ix = await lib.poll(async () => {
    const e = await dm.evaluate(`syncIndex.isOn() ? syncIndex.raw.get('index', ${q('scene:' + cid)}) : null`, 20000);
    return e && e.parts && e.parts.map.hash === want ? e : null;
  }, 30000, 300);
  rig.check(!!ix, 'F: the sync index does not hold the new file\'s hash: ' + q(await dm.evaluate(`syncIndex.isOn() ? syncIndex.raw.get('index', ${q('scene:' + cid)}).then(e => e && e.parts) : 'sync index off'`, 20000)));
};
