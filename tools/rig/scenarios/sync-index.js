'use strict';

// sync-index.js - SYNC KNOWS WHAT CHANGED WITHOUT READING THE LIBRARY.
//
// An animated map, a gallery picture and some campaign text, with the sync config file placed in the profile.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   A. Without the config file the app keeps no sync database at all.
//   B. With it, a start gives every record a hash, and an animated map's hash is its file's SHA-256.
//   C. A note edit rehashes the record and not the video file; a change to the map's own part rehashes the file.
//   D. A start with nothing changed leaves every entry alone, and an edit made behind the app's back (as the previous
//      release would) is rehashed.
//   E. A saved gallery picture and campaign text each get an entry; the picture's carries its Blob's hash.
//   F. A map deleted after it was synced is recorded as deleted; one never synced is not. A map synced before and
//      missing at start is recorded as deleted.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const lib = require('../lib');

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const entries = dm => dm.evaluate('syncIndex.isOn() ? syncIndex.entries().then(l => Object.fromEntries(l.map(e => [e.key, e]))) : {}', 20000);
const gone = dm => dm.evaluate('syncIndex.isOn() ? syncIndex.goneRecords().then(l => l.map(g => g.id)) : []', 20000);
// A raw write into the sync database, for a state only a real sync leaves behind.
const rawSynced = (dm, key) => dm.evaluate(`new Promise((res, rej) => {
  const r = indexedDB.open('evermist-sync');
  r.onsuccess = () => { const tx = r.result.transaction('synced', 'readwrite'); tx.objectStore('synced').put({ key: ${JSON.stringify(key)}, hash: 'x' });
    tx.oncomplete = () => { r.result.close(); res(1); }; tx.onerror = () => rej(tx.error); };
})`, 20000);

module.exports = async function syncIndexScenario(rig) {
  let dm = rig.dm;
  const id = await lib.importWithPlan(rig, 'Карта');
  const video = () => fs.readdirSync(path.join(rig.profileDir, 'maps')).map(f => path.join(rig.profileDir, 'maps', f)).find(f => f.includes(id));

  // A
  const names = await dm.evaluate('indexedDB.databases().then(l => l.map(d => d.name))', 20000);
  rig.check(!names.includes('evermist-sync'), 'A: no config file, yet the app made a sync database: ' + names);

  // B
  rig.writeSyncConfig(rig.profileDir, { url: 'http://127.0.0.1:9' });
  dm = await rig.restart(); await lib.installHelpers(dm);
  let ix = await lib.poll(async () => { const e = await entries(dm); return e['scene:' + id] && e['scene:' + id].parts.map.hash ? e : null; }, 60000, 300);
  rig.check(!!ix, 'B: the map has no entry with a hash after a start');
  if (!ix) return;
  const h0 = sha(fs.readFileSync(video()));
  rig.check(ix['scene:' + id].parts.map.hash === h0, 'B: the map hash is not the file\'s SHA-256: ' + ix['scene:' + id].parts.map.hash);
  rig.check(ix['scene:' + id].blobs.length === 1 && ix['scene:' + id].blobs[0].owner === id, 'B: the entry does not name the map file');

  // C: the file changes behind the app, which only a rehash would notice.
  fs.appendFileSync(video(), Buffer.from([1, 2, 3]));
  const h1 = sha(fs.readFileSync(video()));
  const was = ix['scene:' + id].hash;
  await dm.evaluate(`sceneStore.updateScene(${JSON.stringify(id)}, r => { r.notes = 'ночью'; })`, 20000);
  ix = await lib.poll(async () => { const e = await entries(dm); return e['scene:' + id].hash !== was ? e : null; }, 20000);
  rig.check(!!ix, 'C: a note edit did not change the record hash');
  if (!ix) return;
  rig.check(ix['scene:' + id].parts.map.hash === h0, 'C: a note edit rehashed the video file');
  await dm.evaluate(`sceneStore.updateScene(${JSON.stringify(id)}, r => { r.mapWidth = r.mapWidth + 1; })`, 20000);
  ix = await lib.poll(async () => { const e = await entries(dm); return e['scene:' + id].parts.map.hash === h1 ? e : null; }, 20000);
  rig.check(!!ix, 'C: a change to the map part did not rehash the file');

  // D
  const before = (await entries(dm))['scene:' + id];
  dm = await rig.restart(); await lib.installHelpers(dm);
  await lib.poll(async () => (await entries(dm))['scene:' + id], 30000);
  const quiet = (await entries(dm))['scene:' + id];
  rig.check(quiet.at === before.at && quiet.hash === before.hash, 'D: a start with nothing changed rewrote the entry');
  await dm.evaluate(`new Promise((res, rej) => {
    const r = indexedDB.open('evermist');
    r.onsuccess = () => { const db = r.result, tx = db.transaction('scenes', 'readwrite'), s = tx.objectStore('scenes');
      s.get(${JSON.stringify(id)}).onsuccess = e => { const rec = e.target.result; rec.notes = 'правка старого выпуска';
        rec.edits.scene.notes = Date.now() + 5; s.put(rec); };
      tx.oncomplete = () => { db.close(); res(1); }; tx.onerror = () => rej(tx.error); };
  })`, 20000);
  dm = await rig.restart(); await lib.installHelpers(dm);
  ix = await lib.poll(async () => { const e = (await entries(dm))['scene:' + id]; return e && e.hash !== before.hash ? e : null; }, 30000);
  rig.check(!!ix, 'D: an edit made behind the app was not rehashed at start');

  // E
  const abc = Buffer.from('abc');
  await dm.evaluate(`galleryStore.put({ id: 'pp1', name: 'Печать', added: 1, blob: new Blob(['abc']) }); notesCampaignSet('привет'); 0`, 20000);
  ix = await lib.poll(async () => { const e = await entries(dm); return e['pic:pp1'] && e['local:evermist.campaignNotes'] ? e : null; }, 20000);
  rig.check(!!ix, 'E: a saved picture and campaign text did not both get an entry');
  if (ix) rig.check(ix['pic:pp1'].blobs[0].hash === sha(abc), 'E: the picture entry does not carry its Blob\'s hash');

  // F
  await rawSynced(dm, 'scene:' + id);
  await rawSynced(dm, 'scene:призрак');
  await dm.evaluate(`sceneStore.deleteScene(${JSON.stringify(id)})`, 20000);
  let g = await lib.poll(async () => { const l = await gone(dm); return l.includes(id) ? l : null; }, 20000);
  rig.check(!!g, 'F: a map deleted after it was synced was not recorded as deleted');
  const other = await dm.evaluate('sceneStore.listScenes().then(l => l.length)', 20000);
  rig.note('scenes left after the delete: ' + other);
  dm = await rig.restart(); await lib.installHelpers(dm);
  g = await lib.poll(async () => { const l = await gone(dm); return l.includes('призрак') ? l : null; }, 30000);
  rig.check(!!g, 'F: a map synced before and missing at start was not recorded as deleted');
};
