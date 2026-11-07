'use strict';

// sync-offline.js - OFFLINE THE APP WORKS AS TODAY, AND WHAT WAITED GOES UP WHEN THE NETWORK IS BACK (DoD 7).
//
// Two apps on one fake Drive. A makes a map and both sync; then the Drive goes away twice: once plainly, once in the
// middle of a map file's upload, as when the lid closes.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   A. With the Drive unreachable A's status line says offline, an edit made then is saved here, and no dialog shows.
//   B. Once the Drive is back, the network's return alone sends that edit, and it reaches B.
//   C. A map file's upload cut off part-way leaves no file on the Drive while it is cut: a half-written file is never
//      taken for a finished one, and B does not get the map.
//   D. Once the Drive is back the upload resumes where it stopped, in the same upload session, and the file B gets is
//      byte for byte A's.

const lib = require('../lib');
const kit = require('../backupKit');

const CUT = 60000;

module.exports = async function syncOffline(rig) {
  const drive = await rig.fakeDrive();
  const b = await rig.second('b');
  rig.writeSyncConfig(rig.profileDir, drive);
  rig.writeSyncConfig(b.profileDir, drive);
  const dmA = await rig.restart();
  const dmB = await b.restart();
  await kit.install(dmA);
  await kit.install(dmB);
  const q = JSON.stringify;
  const tick = dm => dm.evaluate('syncEngine.now()', 120000);
  const status = async () => 'A ' + q(await dmA.evaluate('syncEngine.status()')) + ' B ' + q(await dmB.evaluate('syncEngine.status()'));
  const notesOn = (dm, id) => dm.evaluate(`sceneStore.loadScene(${q(id)}).then(r => r ? r.notes || '' : null)`, 20000);
  const mapHash = (dm, id) => dm.evaluate(`sceneStore.loadScene(${q(id)}).then(r => r && r.mapBlob ? __bk.hash(r.mapBlob) : null)`, 20000);
  const line = () => dmA.evaluate(`document.getElementById('sy-line').textContent`);
  const dialog = () => dmA.evaluate(`!!document.getElementById('cd-ok') && document.getElementById('cd-ok').offsetParent !== null`);
  const addMap = (name, seed) => dmA.evaluate(`(async () => {
    const f = await __bk.noiseFile(${q(name)}, 900, 700, ${seed}, 0.9);
    return (await addMapsToLibrary([f], { x: ${seed * 300}, y: 0 }, true)).ids[0];
  })()`, 120000);

  const m1 = await addMap('Склеп', 1);
  const ready = await lib.poll(async () => { await tick(dmA); await tick(dmB); return dmB.evaluate(`allScenes.some(s => s.id === ${q(m1)})`); }, 120000, 200);
  rig.check(!!ready, 'setup: the map did not reach B: ' + await status());
  if (!ready) return;
  await dmA.evaluate(`if (document.getElementById('dock-pane-settings').hidden) document.getElementById('dock-tab-settings').click(); 0`);

  // A
  await drive.down();
  await dmA.evaluate(`__bk.editScene(${q(m1)}, s => { s.notes = 'A: без сети'; })`, 20000);
  await tick(dmA);
  const off = await lib.poll(async () => (await dmA.evaluate('syncEngine.status().state')) === 'offline' && /^Offline/.test(await line()), 20000, 200);
  rig.check(!!off, 'A: with the Drive unreachable the status line does not say offline: ' + q(await line()) + ' ' + await status());
  rig.check(await notesOn(dmA, m1) === 'A: без сети', 'A: an edit made offline was not saved on A');
  rig.check(!(await dialog()), 'A: being offline put a dialog on screen');

  // B
  await drive.up();
  await dmA.evaluate(`window.dispatchEvent(new Event('online')); 0`);
  const back = await lib.poll(async () => { await tick(dmB); return await notesOn(dmB, m1) === 'A: без сети'; }, 60000, 300);
  rig.check(!!back, 'B: the edit made offline did not reach B once the Drive was back: ' + await status());
  rig.check(/^Last synced/.test(await line()), 'B: A\'s status line still does not say synced: ' + q(await line()));

  // C
  await lib.poll(async () => (await dmA.evaluate('syncEngine.status().state')) !== 'syncing', 30000, 200);
  drive.cutNext = { bytes: CUT, down: true };
  const m2 = await addMap('Башня', 2);
  const want = await mapHash(dmA, m2);
  const fileName = () => { const u = drive.stats.puts.find(p => p.name.startsWith(m2 + '.')); return u ? u.name : null; };
  await tick(dmA);
  const cut = await lib.poll(async () => drive.cutNext === null && (await dmA.evaluate('syncEngine.status().state')) === 'offline', 30000, 200);
  rig.check(!!cut && !!fileName(), 'C: the map file\'s upload was not cut, or A does not say offline: ' + q(drive.stats.puts) + ' ' + await status());
  rig.check(!drive.files().some(f => f.name.startsWith(m2 + '.')), 'C: a half-written map file reads as present on the Drive');
  rig.check(!(await dmB.evaluate(`allScenes.some(s => s.id === ${q(m2)})`)), 'C: B got a map whose file never finished');

  // D
  await drive.up();
  await dmA.evaluate(`window.dispatchEvent(new Event('online')); 0`);
  const got = await lib.poll(async () => { await tick(dmB); return await mapHash(dmB, m2); }, 60000, 300);
  const name = fileName();
  const inits = drive.stats.sessions.filter(n => n === name).length;
  const resumed = drive.stats.puts.filter(p => p.name === name).map(p => p.start);
  const done = drive.stats.uploads.filter(u => u.name === name);
  rig.note('D: the cut file\'s PUTs started at ' + q(resumed) + ', sessions opened ' + inits);
  rig.check(inits === 1 && resumed.includes(CUT), 'D: the upload did not resume where it stopped in its own session: ' + inits + ' sessions, PUTs from ' + q(resumed));
  rig.check(done.length === 1 && done[0].size > CUT, 'D: the map file was not finished once on the Drive: ' + q(done));
  rig.check(!!got && got === want, 'D: the map file B got is not A\'s: ' + got + ' vs ' + want);
};
