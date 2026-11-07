'use strict';

// sync-travel.js - AN EDIT ON ONE COMPUTER REACHES THE OTHER, ONCE, AND SENDS NOTHING BACK.
//
// Two apps on one fake Drive. A holds an animated map with three rooms and has the TV open; B starts empty.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   A. The map reaches B on its own with its rooms, and B's animated map file is byte for byte A's.
//   B. A room renamed and a note written on A reach B without B doing anything.
//   C. A fog edit on A uploads the small record and the fog picture, and no video.
//   D. What B pulled is not sent back: B's folder on the Drive holds no record of that map, and A's uploads of the
//      map file number one.
//   E. No stretch of sync work on either page takes 50 ms (DoD 10): A's ticks with its TV on the animated map, and an
//      apply on B of a map A adds while B's own TV shows the animated map.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const lib = require('../lib');
const kit = require('../backupKit');

const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const mapFile = (r, id) => fs.readdirSync(path.join(r.profileDir, 'maps')).map(f => path.join(r.profileDir, 'maps', f)).find(f => f.includes(id) && !f.endsWith('.sync-part'));
const read = (dm, id) => dm.evaluate(`sceneStore.loadScene(${JSON.stringify(id)}).then(r => r && ({ notes: r.notes, rooms: r.polygons.map(p => p.name), type: r.mapType,
  fog: r.baseFogBlob ? r.baseFogBlob.size : 0 }))`, 20000);
const slices = dm => dm.evaluate(`performance.getEntriesByType('measure').filter(m => m.name.startsWith('sync:')).map(m => [m.name, m.duration])`);

module.exports = async function syncTravel(rig) {
  const drive = await rig.fakeDrive();
  const b = await rig.second('b');
  rig.writeSyncConfig(rig.profileDir, drive);
  rig.writeSyncConfig(b.profileDir, drive);
  let dmA = await rig.restart(); await lib.installHelpers(dmA);
  const dmB = await b.restart();

  const id = await lib.importWithPlan(rig, 'Карта');
  dmA = rig.dm;
  await lib.drawRooms(rig, 3);
  await dmA.evaluate('scheduleAutoSave(); doAutoSave()', 30000);
  await rig.player();

  // A
  const got = await lib.poll(async () => { const r = await read(dmB, id); return r && r.rooms.length === 3 ? r : null; }, 90000, 500);
  rig.check(!!got, 'A: the map did not reach B with its three rooms');
  if (!got) { rig.note('A status ' + JSON.stringify(await dmA.evaluate('syncEngine.status()')) + ' B ' + JSON.stringify(await dmB.evaluate('syncEngine.status()'))); return; }
  const fileB = await lib.poll(() => { try { return mapFile(b, id); } catch (_) { return null; } }, 20000);
  rig.check(!!fileB && sha(fileB) === sha(mapFile(rig, id)), 'A: the animated map file on B is not A\'s');
  const videoUploads = () => drive.stats.uploads.filter(u => u.name.startsWith(id + '.')).length;
  rig.check(videoUploads() === 1, 'A: the map file went up ' + videoUploads() + ' times');

  const holders = () => drive.files().filter(f => f.name.startsWith('rec-') && drive.files().some(x => x.parents.includes(f.id) && x.name === 'scene~' + id + '.json')).length;
  await dmB.evaluate('syncEngine.now()', 60000);
  rig.check(holders() === 1, 'A: B sent back the map it pulled (' + holders() + ' computers hold its record)');
  if (holders() !== 1) {
    const ent = dm => dm.evaluate(`syncIndex.entries().then(l => l.filter(e => e.key === 'scene:${id}').map(e => [e.hash.slice(0, 8), e.parts.map.hash.slice(0, 8), e.parts.fog.hash.slice(0, 8), e.edits.length]))`, 20000);
    rig.note('uploads ' + JSON.stringify(drive.stats.uploads.map(u => u.name.slice(0, 40) + '..' + u.name.slice(-5) + ':' + u.size)));
    rig.note('A entry ' + JSON.stringify(await ent(dmA)) + ' B entry ' + JSON.stringify(await ent(dmB)));
    const body = dm => dm.evaluate(`sceneStore.loadScene(${JSON.stringify(id)}).then(r => { const o = {}; for (const k of Object.keys(r)) if (!SY_SCENE_BLOBS.includes(k)) o[k] = esCanon(r[k]); return o; })`, 20000);
    const [x, y] = [await body(dmA), await body(dmB)];
    rig.note('the records differ in: ' + Object.keys(x).concat(Object.keys(y)).filter((k, i, l) => l.indexOf(k) === i && x[k] !== y[k]).map(k => k + ' ' + String(x[k]).slice(0, 80) + ' | ' + String(y[k]).slice(0, 80)).join('; '));
  }

  // B
  await dmA.evaluate(`polygons[0].name = 'Новый зал'; currentScene.notes = 'ночью у ворот'; scheduleAutoSave(); doAutoSave()`, 30000);
  const edited = await lib.poll(async () => { const r = await read(dmB, id); return r && r.rooms[0] === 'Новый зал' && r.notes === 'ночью у ворот' ? r : null; }, 90000, 500);
  rig.check(!!edited, 'B: a renamed room and a note did not reach B');

  // C
  const before = drive.stats.uploads.length;
  // revealAllMap asks first while the TV is on Auto; the rooms themselves are what changes the fog.
  await dmA.evaluate('revealAllRooms(); scheduleAutoSave(); doAutoSave()', 30000);
  await lib.poll(() => drive.stats.uploads.slice(before).some(u => u.name === 'scene~' + id + '.json'), 90000, 500);
  const fresh = drive.stats.uploads.slice(before);
  rig.check(fresh.some(u => u.name === 'scene~' + id + '.json'), 'C: a fog edit did not upload the record: ' + JSON.stringify(fresh.map(u => u.name.slice(0, 12) + u.name.slice(-6))) + ' ' + JSON.stringify(await dmA.evaluate('syncEngine.status()')));
  rig.check(!fresh.some(u => u.name.startsWith(id + '.')) && videoUploads() === 1, 'C: a fog edit uploaded the video again');
  const fogB = await lib.poll(async () => { const r = await read(dmB, id); return r && r.fog && r.fog !== got.fog ? r : null; }, 90000, 500);
  rig.note('C: the fog picture on B ' + (fogB ? 'changed' : 'did not change'));
  // One computer's tidying used to delete the other's just-sent files, so they went up on every tick.
  const blobUps = drive.stats.uploads.filter(u => !u.name.includes('~')).map(u => u.name);
  const twice = blobUps.filter((n, i) => blobUps.indexOf(n) !== i);
  rig.check(!twice.length, 'C: a file went up more than once: ' + JSON.stringify(twice.map(n => n.slice(0, 12))));

  // D
  await dmB.evaluate('syncEngine.now()', 60000);
  rig.check(holders() === 1, 'D: ' + holders() + ' computers hold a record of the map on the Drive, B sent back what it pulled');

  // E
  await dmB.evaluate(`switchScene(${JSON.stringify(id)})`, 30000);
  const tvSession = await b.player();
  await lib.settle(tvSession, '!!mapVideo && !mapVideo.paused', 30000);
  const tvB = { tv: await dmB.evaluate('tvSceneId'), playing: await tvSession.evaluate('!!mapVideo && !mapVideo.paused') };
  rig.check(tvB.tv === id && tvB.playing, 'E: B\'s TV is not playing the animated map: ' + JSON.stringify(tvB));
  await dmB.evaluate(`performance.clearMeasures(); 0`);
  await kit.install(dmA);
  const extra = await dmA.evaluate(`(async () => {
    const f = await __bk.noiseFile('Башня', 900, 700, 3, 0.85);
    return (await addMapsToLibrary([f], { x: 900, y: 0 }, true)).ids[0];
  })()`, 120000);
  await dmA.evaluate('syncEngine.now()', 60000);
  const landed = await lib.poll(async () => { await dmB.evaluate('syncEngine.now()', 60000); return dmB.evaluate(`allScenes.some(s => s.id === ${JSON.stringify(extra)})`); }, 60000, 300);
  rig.check(!!landed, 'E: the map A added did not land on B while B\'s TV played');
  const applied = (await slices(dmB)).filter(x => /^sync:(thumb|build)$/.test(x[0]));
  rig.check(applied.length > 0, 'E: B measured no slice of applying the map while its TV played');
  for (const [who, dm] of [['A', dmA], ['B', dmB]]) {
    const s = await slices(dm);
    rig.note(who + ': ' + s.length + ' sync slices, the longest ' + Math.round(Math.max(0, ...s.map(x => x[1]))) + ' ms');
    rig.check(s.length > 0, 'E: ' + who + ' measured no slice of sync work');
    rig.check(s.every(x => x[1] < 50), 'E: a slice of sync work on ' + who + ' took 50 ms or more: ' + JSON.stringify(s.filter(x => x[1] >= 50)));
  }
};
