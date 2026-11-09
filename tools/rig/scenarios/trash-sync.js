'use strict';

// trash-sync.js - WITH SYNC ON, EACH COMPUTER KEEPS ITS OWN COPY OF A DELETED MAP, RESTORE WORKS OFFLINE FROM IT, AND
// A MAP TRASHED BEFORE THE FIRST SYNC STAYS ON ITS COMPUTER (backlog 283, Part 2: DoD 8-10).
//
// Two apps on one fake Drive. Before A is signed in, A makes "Склеп" and "Мост" and deletes "Склеп". Then both sign in
// and sync, and A deletes "Мост".
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   A. A map in A's trash before A first syncs never reaches the Drive or B, and stays in A's own trash.
//   B. A deletes "Мост": at B's next sync it leaves B's library into B's own trash, its time the deletion record's,
//      so B's Trash row reads the same days left as A's, with no toast on B.
//   C. With the Drive down, Restore on B's row brings "Мост" back on B from B's copy, and marks B's deletion record
//      restored.
//   D. With the Drive up again, "Мост" stays on B through B's next syncs, comes back on A, and neither trash lists it.
//   E. A music track deleted on A (Part 3, DoD 17): at B's next sync it leaves B's music folder for B's own
//      userData/trash/music, its entry's time the deletion record's. With the Drive down, Restore on B's row brings it
//      back into B's folder from that copy and marks B's deletion record restored. With the Drive up, it stays on B,
//      comes back on A from A's own trash with nothing downloaded, and neither trash lists it.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const lib = require('../lib');
const kit = require('../backupKit');

module.exports = async function trashSync(rig) {
  const q = JSON.stringify;
  let dmA = rig.dm;
  await kit.install(dmA);
  const has = (dm, id) => dm.evaluate(`allScenes.some(s => s.id === ${q(id)})`);
  const stored = (dm, id) => dm.evaluate(`sceneStore.loadScene(${q(id)}).then(r => !!r)`, 20000);
  const listed = dm => dm.evaluate('sceneTrash.list()', 20000);
  const tick = dm => dm.evaluate('syncEngine.now()', 120000);
  const firstDone = dm => dm.evaluate(`syncIndex.raw.get('synced', '$first').then(x => !!x)`, 20000);
  const gone = (dm, id) => dm.evaluate(`syncIndex.raw.get('gone', ${q(id)})`, 20000);
  const onDrive = id => drive.files().filter(f => f.name === 'scene~' + id + '.json' || f.name.startsWith(id + '.') || f.name.startsWith('f_' + id + '.')).map(f => f.name);
  const openSettings = dm => dm.evaluate(`(() => { if (document.getElementById('dock-pane-settings').hidden) document.getElementById('dock-tab-settings').click(); return !document.getElementById('dock-pane-settings').hidden; })()`);
  const rows = dm => dm.evaluate(`Array.from(document.querySelectorAll('#sy-trash .dk-trash-row')).map(r => ({ name: r.querySelector('.nm').textContent, left: r.querySelector('.mt').textContent, id: r.querySelector('[data-restore]').dataset.restore }))`);

  // Setup: A, not signed in yet, trashes "Склеп".
  const [m0, m1] = await dmA.evaluate(`(async () => {
    const out = [];
    for (const [i, n] of ['Склеп', 'Мост'].entries()) out.push((await addMapsToLibrary([await __bk.noiseFile(n, 800, 600, i + 1, 0.8)], { x: i * 300, y: 0 }, true)).ids[0]);
    return out;
  })()`, 120000);
  await dmA.evaluate(`deleteScenesWithUndo([${q(m0)}]); commitPendingDelete(); 0`);
  const trashed = await lib.poll(async () => !(await stored(dmA, m0)) && (await listed(dmA)).some(e => e.id === m0), 30000, 200);
  rig.check(!!trashed, 'setup: A did not move "Склеп" into its trash before signing in');
  if (!trashed) return;

  const drive = await rig.fakeDrive();
  const b = await rig.second('b');
  rig.writeSyncConfig(rig.profileDir, drive);
  rig.writeSyncConfig(b.profileDir, drive);
  dmA = await rig.restart();
  let dmB = await b.restart();
  await kit.install(dmA);
  const status = async () => 'A ' + q(await dmA.evaluate('syncEngine.status()')) + ' B ' + q(await dmB.evaluate('syncEngine.status()'));

  const synced = await lib.poll(async () => {
    await tick(dmA); await tick(dmB);
    return await has(dmB, m1) && await firstDone(dmA) && await firstDone(dmB);
  }, 120000, 200);
  rig.check(!!synced, 'setup: "Мост" did not reach B, or a first sync did not finish: ' + await status());
  if (!synced) return;

  // A
  rig.check(onDrive(m0).length === 0, 'A: a map in A\'s trash before its first sync reached the Drive: ' + q(onDrive(m0)));
  rig.check(!(await has(dmB, m0)) && !(await stored(dmB, m0)) && !(await listed(dmB)).some(e => e.id === m0), 'A: a map in A\'s trash before its first sync reached B');
  rig.check((await listed(dmA)).some(e => e.id === m0), 'A: the map trashed before the first sync left A\'s own trash');
  rig.check(!(await dmA.evaluate('syncEngine.trash()', 30000)).some(e => e.id === m0), 'A: the map trashed before the first sync is listed as on the Drive');

  // B
  await dmA.evaluate(`deleteScenesWithUndo([${q(m1)}]); commitPendingDelete(); 0`);
  await lib.poll(async () => !(await stored(dmA, m1)), 20000);
  await tick(dmA);
  const moved = await lib.poll(async () => { await tick(dmB); return !(await has(dmB, m1)) && !(await stored(dmB, m1)) && (await listed(dmB)).some(e => e.id === m1); }, 60000, 200);
  rig.check(!!moved, 'B: a map deleted on A did not move into B\'s own trash at B\'s sync: ' + await status());
  if (!moved) return;
  const atA = (await listed(dmA)).find(e => e.id === m1), atB = (await listed(dmB)).find(e => e.id === m1), gB = await gone(dmB, m1);
  rig.check(!!gB && atB.at === gB.at, 'B: B\'s trash entry does not carry the deletion record\'s time: ' + q({ atB, gB }));
  rig.check(!!atA && Math.abs(atA.at - atB.at) < 60000, 'B: A and B count the deletion from different times: ' + q({ atA, atB }));
  rig.check(await dmB.evaluate(`!smPending && document.getElementById('scene-undo-toast').style.display !== 'block'`), 'B: B showed an undo toast or holds a pending delete');
  await openSettings(dmA); await openSettings(dmB);
  const rowOf = async dm => { await dm.evaluate('trashPanelRefresh()', 30000); return (await rows(dm)).filter(r => r.id === m1); };
  const rA = await rowOf(dmA), rB = await rowOf(dmB);
  rig.check(rB.length === 1 && rB[0].name === 'Мост' && rB[0].left === '30 days left' && rA.length === 1 && rA[0].left === rB[0].left,
    'B: the Trash rows do not read one "Мост" with the same days left on both: ' + q({ A: rA, B: rB }));

  // C
  await drive.down();
  await tick(dmB);
  const offRow = await lib.poll(async () => (await rowOf(dmB)).length === 1, 20000, 300);
  rig.check(!!offRow, 'C: with the Drive down B\'s Trash does not list "Мост": ' + q(await rows(dmB)));
  await dmB.evaluate(`document.querySelector('#sy-trash [data-restore=${q(m1)}]').click(); 0`);
  const back = await lib.poll(async () => await has(dmB, m1) && await stored(dmB, m1), 30000, 200);
  rig.check(!!back, 'C: Restore on B with the Drive down did not bring "Мост" back: ' + await status());
  const marked = await lib.poll(async () => { const g = await gone(dmB, m1); return g && g.restoredAt >= g.at ? g : null; }, 20000, 200);
  rig.check(!!marked, 'C: Restore offline did not mark B\'s deletion record restored: ' + q(await gone(dmB, m1)));

  // D
  await drive.up();
  await dmB.evaluate(`window.dispatchEvent(new Event('online')); 0`);
  const onA = await lib.poll(async () => { await tick(dmB); await tick(dmA); return await has(dmA, m1) && await stored(dmA, m1); }, 60000, 300);
  rig.check(!!onA, 'D: "Мост", restored on B offline, did not come back on A once the Drive was up: ' + await status());
  await tick(dmB); await tick(dmB);
  rig.check(await has(dmB, m1) && await stored(dmB, m1), 'D: the next sync dropped "Мост" from B again: ' + await status());
  rig.check(!(await listed(dmA)).some(e => e.id === m1) && !(await listed(dmB)).some(e => e.id === m1), 'D: a trash still lists the restored "Мост"');
  rig.check(!(await dmA.evaluate('syncEngine.trash()', 30000)).some(e => e.id === m1), 'D: the Drive\'s Trash still lists the restored "Мост"');

  // E
  const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
  const TR = 'Набат.wav', wv = lib.wav(6, 7), h = sha(wv);
  const dirA = path.join(rig.profileDir, 'music'), dirB = path.join(b.profileDir, 'music');
  const trA = path.join(rig.profileDir, 'trash', 'music'), trB = path.join(b.profileDir, 'trash', 'music');
  const ls = d => { try { return fs.readdirSync(d).filter(n => !n.startsWith('.')); } catch (_) { return []; } };
  const holds = (d, n) => { try { return sha(fs.readFileSync(path.join(d, n))) === h; } catch (_) { return false; } };
  const muGone = dm => dm.evaluate(`syncIndex.raw.get('synced', '$music').then(x => (x && x.st.gone[${q(h)}]) || null)`, 20000);
  const trackRows = dm => listed(dm).then(l => l.filter(e => e.hash === h));
  fs.mkdirSync(dirA, { recursive: true });
  fs.writeFileSync(path.join(dirA, TR), wv);
  await dmA.evaluate('_muRefreshTracks().then(() => 0)', 30000);
  const reached = await lib.poll(async () => { await tick(dmA); await tick(dmB); return holds(dirB, TR); }, 90000, 300);
  rig.check(!!reached, 'E setup: the track did not reach B: ' + q(ls(dirB)) + ' ' + await status());
  if (!reached) return;
  await dmA.evaluate(`sceneTrash.trashTrack(${q(TR)}).then(() => _muRefreshTracks()).then(() => 0)`, 30000);
  rig.check(!ls(dirA).includes(TR) && ls(trA).length === 1, 'E setup: A\'s delete did not move the track into A\'s trash: ' + q(ls(trA)));
  await tick(dmA);
  const intoB = await lib.poll(async () => { await tick(dmB); return !ls(dirB).includes(TR) && ls(trB).length === 1 && (await trackRows(dmB)).length === 1; }, 60000, 300);
  rig.check(!!intoB, 'E: a track deleted on A did not move into B\'s own trash: B music ' + q(ls(dirB)) + ' trash ' + q(ls(trB)) + ' ' + await status());
  if (!intoB) return;
  const gTr = await muGone(dmB), eB = (await trackRows(dmB))[0];
  rig.check(!!gTr && eB.at === gTr.at && holds(trB, ls(trB)[0]), 'E: B\'s track entry does not carry the deletion record\'s time, or its file is not the track: ' + q({ eB, gTr }));

  await drive.down();
  const row = await lib.poll(async () => (await dmB.evaluate('trashPanelRefresh().then(() => 0)', 30000), dmB.evaluate(`!!document.querySelector('#sy-trash [data-restore=${q(eB.id)}]')`)), 20000, 300);
  rig.check(!!row, 'E: with the Drive down B\'s Trash does not list the track');
  if (row) await dmB.evaluate(`document.querySelector('#sy-trash [data-restore=${q(eB.id)}]').click(); 0`);
  const backB = await lib.poll(async () => holds(dirB, TR) && !ls(trB).length, 30000, 200);
  rig.check(!!backB, 'E: Restore on B with the Drive down did not bring the track back from B\'s copy: B music ' + q(ls(dirB)) + ' trash ' + q(ls(trB)));
  const gB2 = await lib.poll(async () => { const g = await muGone(dmB); return g && g.restoredAt >= g.at ? g : null; }, 20000, 200);
  rig.check(!!gB2, 'E: Restore offline did not mark B\'s music deletion record restored: ' + q(await muGone(dmB)));

  await drive.up();
  await dmB.evaluate(`window.dispatchEvent(new Event('online')); 0`);
  const from = drive.stats.requests.length;
  const onA2 = await lib.poll(async () => { await tick(dmB); await tick(dmA); return holds(dirA, TR); }, 60000, 300);
  rig.check(!!onA2, 'E: the track restored on B did not come back on A: A music ' + q(ls(dirA)) + ' trash ' + q(ls(trA)) + ' ' + await status());
  await tick(dmB); await tick(dmB);
  rig.check(holds(dirB, TR), 'E: the next sync took the restored track off B again: ' + q(ls(dirB)));
  const fetched = drive.stats.requests.slice(from).filter(r => drive.files().some(f => f.name.endsWith('.' + h) && r === 'GET /drive/v3/files/' + f.id));
  rig.check(!ls(trA).length && !fetched.length, 'E: A did not take the track from its own trash: A trash ' + q(ls(trA)) + ', downloads ' + q(fetched));
  rig.check(!(await trackRows(dmA)).length && !(await trackRows(dmB)).length, 'E: a trash still lists the restored track');
};
