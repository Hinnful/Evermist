'use strict';

// sync-faults.js - WHAT THE DRIVE AND THE OTHER COMPUTER CAN THROW AT SYNC, THROUGH THE REAL APP (DoD 13, clock skew).
//
// Two apps on one fake Drive, a map on both. Then the Drive fills up, the sign-in expires, a computer on a newer
// Evermist leaves a record, and a record arrives stamped a day in the future.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   A. With the Drive full, A's status line says so, nothing of the new map reaches the Drive, and A keeps the map and
//      the edit made then; once there is room both go up and reach B.
//   B. An access token the Drive no longer takes is refreshed and sync carries on: an edit made then reaches B, and
//      neither status line says signed out.
//   C. A record from a newer sync format is skipped: its map does not appear, the status line asks to update, and the
//      rest of the sync still runs.
//   D. A record stamped in the future counts as the puller's now: B takes A's note, keeps it under B's own time, not
//      the future one, and a later edit on B goes up.

const lib = require('../lib');
const kit = require('../backupKit');
const { FOLDER } = require('../fakeDrive');

const DAY = 86400000;

module.exports = async function syncFaults(rig) {
  const drive = await rig.fakeDrive();
  const b = await rig.second('b');
  rig.writeSyncConfig(rig.profileDir, drive);
  rig.writeSyncConfig(b.profileDir, drive);
  const dmA = await rig.restart();
  const dmB = await b.restart();
  await kit.install(dmA);
  const q = JSON.stringify;
  const tick = async dm => { await lib.settle(dm, "syncEngine.status().state !== 'off'", 30000); return dm.evaluate('syncEngine.now()', 120000); };
  const status = async () => 'A ' + q(await dmA.evaluate('syncEngine.status()')) + ' B ' + q(await dmB.evaluate('syncEngine.status()'));
  const notesOn = (dm, id) => dm.evaluate(`sceneStore.loadScene(${q(id)}).then(r => r ? r.notes || '' : null)`, 20000);
  const has = (dm, id) => dm.evaluate(`allScenes.some(s => s.id === ${q(id)})`);
  const line = () => dmA.evaluate(`document.getElementById('sy-line').textContent`);
  const note = (id, text) => dmA.evaluate(`__bk.editScene(${q(id)}, s => { s.notes = ${q(text)}; })`, 20000);
  const addMap = (name, seed) => dmA.evaluate(`(async () => {
    const f = await __bk.noiseFile(${q(name)}, 640, 480, ${seed}, 0.85);
    return (await addMapsToLibrary([f], { x: ${seed * 300}, y: 0 }, true)).ids[0];
  })()`, 120000);
  const reaches = (id, text) => lib.poll(async () => { await tick(dmB); return await notesOn(dmB, id) === text; }, 60000, 300);

  const m1 = await addMap('Склеп', 1);
  const ready = await lib.poll(async () => { await tick(dmA); await tick(dmB); return has(dmB, m1); }, 120000, 300);
  rig.check(!!ready, 'setup: the map did not reach B: ' + await status());
  if (!ready) return;
  await dmA.evaluate(`if (document.getElementById('dock-pane-settings').hidden) document.getElementById('dock-tab-settings').click(); 0`);

  // A
  drive.quotaFull = true;
  const m2 = await addMap('Башня', 2);
  await note(m1, 'A: диск полон');
  await tick(dmA);
  const full = await lib.poll(async () => (await dmA.evaluate('syncEngine.status().state')) === 'full' && /Drive is full/.test(await line()), 20000, 200);
  rig.check(!!full, 'A: with the Drive full the status line does not say so: ' + q(await line()) + ' ' + await status());
  rig.check(!drive.files().some(f => f.name.startsWith(m2 + '.') || f.name === 'scene~' + m2 + '.json'), 'A: a file of the new map reached a full Drive');
  rig.check(await has(dmA, m2) && await notesOn(dmA, m1) === 'A: диск полон', 'A: A lost the map or the edit made while the Drive was full');
  drive.quotaFull = false;
  await tick(dmA);
  rig.check(!!(await reaches(m1, 'A: диск полон')) && await has(dmB, m2), 'A: once the Drive had room, the edit or the map did not reach B: ' + await status());

  // B
  const [r0, u0] = [drive.stats.refreshes, drive.stats.unauthorized];
  drive.expireToken();
  await note(m1, 'A: после 401');
  await tick(dmA);
  rig.check(!!(await reaches(m1, 'A: после 401')), 'B: after the token expired, the edit did not reach B: ' + await status());
  rig.check(drive.stats.unauthorized > u0 && drive.stats.refreshes >= r0 + 2, 'B: the Drive refused no call or no token was refreshed: 401s ' + (drive.stats.unauthorized - u0) + ', refreshes ' + (drive.stats.refreshes - r0));
  for (const [who, dm] of [['A', dmA], ['B', dmB]]) {
    rig.check((await dm.evaluate('syncEngine.status().state')) !== 'signedOut', 'B: ' + who + ' reads as signed out after a refresh');
  }

  // C
  const dir = drive.put({ name: 'rec-mnewer', mimeType: FOLDER, parents: ['appDataFolder'] }, null);
  const rec = { format: 2, key: 'scene:newer1', rec: { id: 'newer1', name: 'Из будущей версии', polygons: [], edits: {} }, thumb: null, blobs: { map: null, fog: null } };
  drive.put({ name: 'scene~newer1.json', parents: [dir.id], mimeType: 'application/json',
    appProperties: { hash: 'a'.repeat(64), format: '2', at: String(Date.now()), edited: String(Date.now()) } }, Buffer.from(JSON.stringify(rec)));
  await note(m1, 'A: рядом с новой версией');
  await tick(dmA);
  const asked = await lib.poll(async () => /newer Evermist/.test(await line()), 20000, 200);
  rig.check(!!asked, 'C: a record from a newer format did not make the status line ask to update: ' + q(await line()) + ' ' + await status());
  rig.check(!(await has(dmA, 'newer1')), 'C: a record from a newer format was applied');
  rig.check(!!(await reaches(m1, 'A: рядом с новой версией')), 'C: the rest of the sync stopped for a newer record: ' + await status());

  // D
  const future = Date.now() + DAY;
  await dmA.evaluate(`__bk.at(${future}, () => __bk.editScene(${q(m1)}, s => { s.notes = 'A: из будущего'; }))`, 20000);
  await tick(dmA);
  const t0 = await dmB.evaluate('Date.now()');
  rig.check(!!(await reaches(m1, 'A: из будущего')), 'D: B did not take a note stamped in the future: ' + await status());
  const stamp = await dmB.evaluate(`sceneStore.loadScene(${q(m1)}).then(r => r.edits.scene.notes)`, 20000);
  const t1 = await dmB.evaluate('Date.now()');
  rig.check(stamp >= t0 && stamp <= t1, 'D: B kept the note under ' + new Date(stamp).toISOString() + ', not its own now (' + new Date(t0).toISOString() + ')');
  await dmB.evaluate(`sceneStore.loadScene(${q(m1)}).then(s => { s.notes = 'B: позже'; return sceneStore.saveScene(s); })`, 20000);
  const machineB = await dmB.evaluate('syncEngine.status().machine');
  const sent = await lib.poll(async () => {
    await tick(dmB);
    const f = drive.files().find(x => x.name === 'scene~' + m1 + '.json' && drive.files().some(d => d.id === x.parents[0] && d.name === 'rec-' + machineB));
    return f && JSON.parse(drive.read(f.id).toString()).rec.notes === 'B: позже';
  }, 60000, 300);
  rig.check(!!sent, 'D: a later edit on B did not go up after a future-stamped one: ' + await status());
};
