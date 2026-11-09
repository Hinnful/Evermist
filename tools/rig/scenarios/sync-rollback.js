'use strict';

// sync-rollback.js - THE ROLLBACK TRIP: THE PREVIOUS RELEASE OPENS A SYNCED LIBRARY, AND WHAT IT DID GOES UP (DoD 12).
//
// Two apps on one fake Drive. A syncs a library of three maps with B; then A's profile is opened by the previous
// release's packaged build (5.4.1, which has no sync), edited and trimmed there, and opened again by this build.
// The previous build is the extracted AppImage under ~/.cache/evermist-rig/prev/; nothing is downloaded here.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   A. The previous release opens the synced profile with every map and note intact: each map opens, and its name,
//      note, rooms and picture are what this build left, and so is the campaign note.
//   B. Back on this build, the edit made on the previous release goes up: A's record of that map on the Drive carries
//      it, and B takes it.
//   C. The map deleted on the previous release is recorded as deleted: A keeps a deletion record for it, and it leaves
//      B and shows in B's Trash.
//   D. Both computers agree: the same maps, with the same notes.

const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../lib');
const kit = require('../backupKit');

const PREV = path.join(os.homedir(), '.cache', 'evermist-rig', 'prev', 'squashfs-root', 'evermist');

module.exports = async function syncRollback(rig) {
  if (!rig.check(fs.existsSync(PREV), 'setup: the previous release is not extracted at ' + PREV)) return;
  const drive = await rig.fakeDrive();
  const b = await rig.second('b');
  rig.writeSyncConfig(rig.profileDir, drive);
  rig.writeSyncConfig(b.profileDir, drive);
  let dmA = await rig.restart();
  const dmB = await b.restart();
  await kit.install(dmA);
  await kit.install(dmB);
  const q = JSON.stringify;
  const tick = async dm => { await lib.settle(dm, "syncEngine.status().state !== 'off'", 30000); return dm.evaluate('syncEngine.now()', 120000); };
  const status = async () => 'A ' + q(await dmA.evaluate('syncEngine.status()')) + ' B ' + q(await dmB.evaluate('syncEngine.status()'));
  const has = (dm, id) => dm.evaluate(`allScenes.some(s => s.id === ${q(id)})`);
  const notesOn = (dm, id) => dm.evaluate(`sceneStore.loadScene(${q(id)}).then(r => r ? r.notes || '' : null)`, 20000);
  const digest = dm => dm.evaluate(`(async () => {
    const o = {};
    for (const s of allScenes) {
      const r = await sceneStore.loadScene(s.id);
      o[s.id] = { name: r.name, notes: r.notes || '', rooms: (r.polygons || []).map(p => p.name + '|' + (p.desc || '')).join(';'), map: await __bk.hash(r.mapBlob) };
    }
    return { scenes: o, campaign: notesCampaignGet() };
  })()`, 60000);

  const ids = await dmA.evaluate(`(async () => {
    const out = [];
    for (const [i, n] of ['Склеп', 'Башня', 'Мост'].entries()) {
      const f = await __bk.noiseFile(n, 640, 480, i + 1, 0.85);
      const id = (await addMapsToLibrary([f], { x: i * 300, y: 0 }, true)).ids[0];
      await __bk.decorate(id, i + 1, {});
      out.push(id);
    }
    notesCampaignSet('Кампания до отката');
    return out;
  })()`, 120000);
  const [mEdit, mGone, mKeep] = ids;
  const synced = await lib.poll(async () => {
    await tick(dmA); await tick(dmB);
    return (await Promise.all(ids.map(id => has(dmB, id)))).every(Boolean) && await dmB.evaluate(`syncIndex.raw.get('synced', '$first').then(x => !!x)`, 20000);
  }, 120000, 300);
  rig.check(!!synced, 'setup: the library did not reach B: ' + await status());
  if (!synced) return;
  await tick(dmA);
  const before = await digest(dmA);

  // A
  const dmOld = await rig.restart({ exe: PREV });
  rig.check(await dmOld.evaluate('typeof syncEngine === "undefined"'), 'setup: the swapped build is not the previous release');
  await kit.install(dmOld);
  const old = await digest(dmOld);
  rig.check(Object.keys(old.scenes).length === 3, 'A: the previous release lists ' + Object.keys(old.scenes).length + ' maps, not 3');
  for (const id of ids) {
    rig.check(q(old.scenes[id]) === q(before.scenes[id]), 'A: the previous release reads map ' + (before.scenes[id] || {}).name + ' differently: ' + q(old.scenes[id]) + ' vs ' + q(before.scenes[id]));
    await dmOld.evaluate(`switchScene(${q(id)})`, 30000);
    rig.check(await dmOld.evaluate(`!!currentScene && currentScene.id === ${q(id)} && mapWidth > 0`), 'A: the previous release did not open map ' + before.scenes[id].name);
  }
  rig.check(old.campaign === before.campaign, 'A: the previous release reads the campaign note as ' + q(old.campaign));

  await dmOld.evaluate(`switchScene(${q(mKeep)})`, 30000);
  await dmOld.evaluate(`__bk.editScene(${q(mEdit)}, s => { s.notes = 'Правка в 5.4.1'; })`, 20000);
  await dmOld.evaluate(`deleteScenesWithUndo([${q(mGone)}]); commitPendingDelete(); 0`);
  const removed = await lib.poll(async () => !(await dmOld.evaluate(`sceneStore.loadScene(${q(mGone)}).then(r => !!r)`, 20000)), 20000);
  rig.check(!!removed, 'setup: the previous release did not delete the map');

  dmA = await rig.restart({ exe: null });
  await kit.install(dmA);
  rig.check(await dmA.evaluate('typeof syncEngine !== "undefined"'), 'setup: the swap back did not start this build');

  // B
  const machineA = await lib.poll(async () => { await tick(dmA); return dmA.evaluate('syncEngine.status().machine'); }, 30000);
  const recOnDrive = () => {
    const dir = drive.files().find(d => d.name === 'rec-' + machineA);
    const f = dir && drive.files().find(x => x.name === 'scene~' + mEdit + '.json' && x.parents[0] === dir.id);
    return f ? JSON.parse(drive.read(f.id).toString()).rec.notes : null;
  };
  const up = await lib.poll(async () => { await tick(dmA); return recOnDrive() === 'Правка в 5.4.1'; }, 60000, 300);
  rig.check(!!up, 'B: the edit made on the previous release did not go up: the Drive holds ' + q(recOnDrive()) + ' ' + await status());
  const took = await lib.poll(async () => { await tick(dmB); return await notesOn(dmB, mEdit) === 'Правка в 5.4.1'; }, 60000, 300);
  rig.check(!!took, 'B: B did not take the edit made on the previous release: ' + await status());

  // C
  const g = await dmA.evaluate(`syncIndex.raw.get('gone', ${q(mGone)})`, 20000);
  rig.check(!!g && g.at > 0 && !g.purged, 'C: A keeps no deletion record of the map deleted on the previous release: ' + q(g));
  const left = await lib.poll(async () => { await tick(dmB); return !(await has(dmB, mGone)); }, 60000, 300);
  rig.check(!!left, 'C: the map deleted on the previous release is still on B: ' + await status());
  const trash = await dmB.evaluate('syncEngine.trash()', 30000);
  rig.check(trash.length === 1 && trash[0].id === mGone, 'C: B\'s Trash does not list it: ' + q(trash));

  // D
  await tick(dmA);
  const [da, db] = [await digest(dmA), await digest(dmB)];
  const notes = d => q(Object.keys(d.scenes).sort().map(id => [id, d.scenes[id].notes]));
  rig.check(notes(da) === notes(db) && Object.keys(da.scenes).length === 2 && await has(dmA, mKeep), 'D: the two computers do not agree: A ' + notes(da) + ' B ' + notes(db));
  rig.check(da.campaign === db.campaign, 'D: the campaign note differs: A ' + q(da.campaign) + ' B ' + q(db.campaign));
};
