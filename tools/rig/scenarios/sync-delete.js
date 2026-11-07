'use strict';

// sync-delete.js - A MAP DELETED ON ONE COMPUTER LEAVES THE OTHER, WAITS 30 DAYS IN "RECENTLY DELETED", AND NEVER COMES
// BACK BY ITSELF.
//
// Two apps on one fake Drive. A makes three small maps and both sync them; then A deletes them one at a time.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   A. A map deleted on A leaves B at B's next sync, with no undo toast on B and nothing of B's own touched.
//   B. Its record and map file stay on the Drive, and both computers list it in Recently deleted with its time.
//   C. Restore on B brings it back on B at once and on A at A's next sync, and the trash is empty again.
//   D. Empty now removes its records and map files from the Drive, and keeps the deletion record, marked purged.
//   E. Past 30 days the purge does the same by itself, and a computer that was offline the whole time does not bring
//      the map back: it leaves that computer too, and nothing of it reaches the Drive again.

const lib = require('../lib');
const kit = require('../backupKit');

const DAY = 86400000;

module.exports = async function syncDelete(rig) {
  const drive = await rig.fakeDrive();
  const b = await rig.second('b');
  rig.writeSyncConfig(rig.profileDir, drive);
  rig.writeSyncConfig(b.profileDir, drive);
  let dmA = await rig.restart();
  let dmB = await b.restart();
  await kit.install(dmA);

  const ids = await dmA.evaluate(`(async () => {
    const out = [];
    for (const [i, n] of ['Склеп', 'Пещера', 'Башня'].entries()) {
      const f = await __bk.noiseFile(n, 800, 600, i + 1, 0.8);
      out.push((await addMapsToLibrary([f], { x: i * 300, y: 0 }, true)).ids[0]);
    }
    return out;
  })()`, 120000);
  const [m1, m2] = ids;
  const q = JSON.stringify;
  const has = (dm, id) => dm.evaluate(`allScenes.some(s => s.id === ${q(id)})`);
  const stored = (dm, id) => dm.evaluate(`sceneStore.loadScene(${q(id)}).then(r => !!r)`, 20000);
  const tick = dm => dm.evaluate('syncEngine.now()', 120000);
  const firstDone = dm => dm.evaluate(`syncIndex.raw.get('synced', '$first').then(x => !!x)`, 20000);
  const onDrive = id => drive.files().filter(f => f.name === 'scene~' + id + '.json' || f.name.startsWith(id + '.') || f.name.startsWith('f_' + id + '.')).map(f => f.name);
  const gone = (dm, id) => dm.evaluate(`syncIndex.raw.get('gone', ${q(id)})`, 20000);
  const status = async () => 'A ' + q(await dmA.evaluate('syncEngine.status()')) + ' B ' + q(await dmB.evaluate('syncEngine.status()'));

  const synced = await lib.poll(async () => {
    await tick(dmA); await tick(dmB);
    return (await Promise.all(ids.map(id => has(dmB, id)))).every(Boolean) && await firstDone(dmA) && await firstDone(dmB);
  }, 120000, 200);
  rig.check(!!synced, 'setup: the three maps did not reach B, or a first sync did not finish: ' + await status());
  if (!synced) return;

  const deleteOnA = async id => {
    await dmA.evaluate(`deleteScenesWithUndo([${q(id)}]); commitPendingDelete(); 0`);
    await lib.poll(async () => !(await stored(dmA, id)), 20000);
    await tick(dmA);
  };

  // A
  await deleteOnA(m1);
  const left = await lib.poll(async () => { await tick(dmB); return !(await has(dmB, m1)) && !(await stored(dmB, m1)); }, 60000, 200);
  rig.check(!!left, 'A: a map deleted on A is still on B after B synced: ' + await status());
  rig.check(await dmB.evaluate(`!smPending && document.getElementById('scene-undo-toast').style.display !== 'block'`), 'A: B showed an undo toast or holds a pending delete');
  rig.check(await has(dmB, ids[2]) && await stored(dmB, ids[2]), 'A: a map nobody deleted left B');

  // B
  rig.check(onDrive(m1).some(n => n.startsWith('scene~')) && onDrive(m1).some(n => n.startsWith(m1 + '.')), 'B: the deleted map\'s record or map file left the Drive: ' + q(onDrive(m1)));
  for (const [who, dm] of [['A', dmA], ['B', dmB]]) {
    const t = await dm.evaluate('syncEngine.trash()', 30000);
    rig.check(t.length === 1 && t[0].id === m1 && t[0].name === 'Склеп' && t[0].at > Date.now() - 10 * 60000, 'B: ' + who + '\'s Recently deleted does not list the map with its time: ' + q(t));
  }

  // C
  rig.check(await dmB.evaluate(`syncEngine.restore(${q(m1)})`, 60000) === true, 'C: Restore on B did not bring the map back on B: ' + await status());
  const back = await lib.poll(async () => { await tick(dmA); return await has(dmA, m1) && await stored(dmA, m1); }, 60000, 200);
  rig.check(!!back, 'C: a map restored on B did not come back on A: ' + await status());
  rig.check((await dmA.evaluate('syncEngine.trash()', 30000)).length === 0 && (await dmB.evaluate('syncEngine.trash()', 30000)).length === 0, 'C: the trash still lists the restored map');

  // D
  await deleteOnA(m1);
  await lib.poll(async () => { await tick(dmB); return !(await has(dmB, m1)); }, 60000, 200);
  rig.check(await dmB.evaluate('syncEngine.emptyNow()', 60000) === 1, 'D: Empty now on B purged nothing');
  rig.check(onDrive(m1).length === 0, 'D: Empty now left the map on the Drive: ' + q(onDrive(m1)));
  await tick(dmA);
  for (const [who, dm] of [['A', dmA], ['B', dmB]]) {
    const g = await gone(dm, m1);
    rig.check(!!g && g.purged === true && g.at > 0, 'D: ' + who + ' does not keep the purged deletion record: ' + q(g));
  }
  rig.check(!(await has(dmA, m1)) && !(await has(dmB, m1)), 'D: the emptied map is back on a computer');

  // E: B goes offline holding m2; A deletes it and, 31 days on, the purge runs.
  rig.writeSyncConfig(b.profileDir, { url: 'http://127.0.0.1:1' });
  dmB = await b.restart();
  await deleteOnA(m2);
  await dmA.evaluate(`globalThis.__rigNow = Date.now; Date.now = () => __rigNow() + ${31 * DAY}; 0`);
  try { await tick(dmA); } finally { await dmA.evaluate('Date.now = __rigNow; 0'); }
  const g2 = await gone(dmA, m2);
  rig.check(!!g2 && g2.purged === true, 'E: 31 days on, A did not purge the deleted map: ' + q(g2));
  rig.check(onDrive(m2).length === 0, 'E: the purge left the map on the Drive: ' + q(onDrive(m2)));
  rig.check(await has(dmB, m2), 'setup: B, offline, should still hold the map');

  rig.writeSyncConfig(b.profileDir, drive);
  dmB = await b.restart();
  const gone2 = await lib.poll(async () => { await tick(dmB); return !(await has(dmB, m2)) && !(await stored(dmB, m2)); }, 60000, 200);
  rig.check(!!gone2, 'E: B, back online after the purge, kept the map: ' + await status());
  await tick(dmA);
  rig.check(onDrive(m2).length === 0, 'E: B brought the purged map back to the Drive: ' + q(onDrive(m2)));
  rig.check(!(await has(dmA, m2)), 'E: the purged map came back on A');
};
