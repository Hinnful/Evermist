'use strict';

// trash-old-db.js - A COMPUTER WHOSE TRASH DATABASE HAS NO PLACE FOR TRACKS STILL TRASHES MUSIC, AND SYNC'S READ OF THE
// TRASH DOES NOT FAIL.
//
// The DM's own `evermist-trash` is version 1 with only `maps`, made before the release that shipped `tracks`. Version
// 1 never upgrades, so every read of the tracks failed with "One of the specified object stores was not found" and
// stopped sync. One app with no Google client; the broken database is made before the app opens it.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   A. Sync's read of the trashed tracks answers a list instead of failing.
//   B. A deleted track leaves the music folder and the Trash lists it by its name.
//   C. After a restart the Trash still lists it, and Restore puts its file back.
//   D. A deleted map still lands in the Trash on the old database.

const fs = require('fs');
const path = require('path');
const lib = require('../lib');

module.exports = async function trashOldDb(rig) {
  const q = JSON.stringify;
  let dm = rig.dm;
  const dir = path.join(rig.profileDir, 'music');
  const files = d => { try { return fs.readdirSync(d).filter(n => !n.startsWith('.')).sort(); } catch (_) { return []; } };
  const listed = () => dm.evaluate('sceneTrash.list()', 20000);

  // Setup: the reload's first script, ahead of the app's own open, swaps the trash database for the old one.
  await dm.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    indexedDB.deleteDatabase('evermist-trash');
    const r = indexedDB.open('evermist-trash', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('maps', { keyPath: 'id' });
    r.onsuccess = () => { window.__oldTrash = Array.from(r.result.objectStoreNames); r.result.close(); };
  })()` });
  await dm.send('Page.reload');
  const up = await lib.poll(async () => { try { return await dm.evaluate(`document.readyState === 'complete' && typeof _muRefreshTracks === 'function' && !!window.__oldTrash`); } catch (_) { return false; } }, 60000, 300);
  rig.check(!!up, 'setup: the app did not come back after the reload');
  await lib.installHelpers(dm);
  const made = await dm.evaluate('window.__oldTrash');
  rig.check(q(made) === q(['maps']), 'setup: the old trash database was not made with only maps: ' + q(made));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Битва.wav'), lib.wav(4, 7));
  await dm.evaluate('_muRefreshTracks().then(() => 0)', 30000);

  // A
  const held = await dm.evaluate(`sceneTrash.trackHashes().then(l => ({ ok: Array.isArray(l) }), e => ({ err: String(e && e.message || e) }))`, 20000);
  rig.check(held.ok === true, 'A: reading the trashed tracks failed: ' + q(held));

  // B
  const id = await dm.evaluate(`sceneTrash.trashTrack('Битва.wav').then(x => x, e => 'ERR ' + (e && e.message || e))`, 30000);
  rig.check(typeof id === 'string' && id.startsWith('track:'), 'B: trashing the track failed: ' + q(id));
  rig.check(!files(dir).includes('Битва.wav'), 'B: the track is still in the music folder: ' + q(files(dir)));
  rig.check((await listed().catch(e => [])).some(e => e.name === 'Битва'), 'B: the Trash does not list "Битва": ' + q(await listed().catch(e => String(e))));

  // C
  dm = await rig.restart(); await lib.installHelpers(dm);
  rig.check((await listed().catch(e => [])).some(e => e.id === id), 'C: after a restart the Trash does not list "Битва"');
  const back = await dm.evaluate(`sceneTrash.restoreTrack(${q(id)}).then(x => x, e => 'ERR ' + (e && e.message || e))`, 30000);
  rig.check(back === 'Битва.wav' && files(dir).includes('Битва.wav'), 'C: Restore did not put the file back: ' + q(back) + ' ' + q(files(dir)));

  // D
  const sceneId = await lib.importWithPlan(rig, 'Карта');
  await dm.evaluate(`deleteScenesWithUndo(${q([sceneId])}); commitPendingDelete(); 0`);
  const inTrash = await lib.poll(async () => (await listed()).some(e => e.id === sceneId), 30000, 200);
  rig.check(!!inTrash, 'D: the deleted map is not in the Trash');
};
