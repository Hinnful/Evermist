'use strict';

// notes-tree-rollback.js - THE PREVIOUS RELEASE OPENS NOTES OVER A STORED NOTES ORDER (spec notes-tree, DoD 13).
//
// One profile on a fake Drive. This build stores an order and a Notes group for a map's rooms and the monsters, and
// sends its `local:evermist.notesOrder` record up; the previous release, 5.12.0, extracted under
// ~/.cache/evermist-rig/prev/, then opens the same library, opens Notes and syncs. A run against any other previous
// release fails on its version line, since the trip it checks is back to 5.12.0. Console errors fail the run.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   0.  The previous release under the cache is 5.12.0.
//  13.  On 5.12.0 the Notes window opens on the map with every room listed, the key is left as this build wrote it,
//       and a sync tick on the fake Drive ends without an error.

const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../lib');
const kit = require('../backupKit');

const PREV = path.join(os.homedir(), '.cache', 'evermist-rig', 'prev', 'squashfs-root', 'evermist');
const q = JSON.stringify;
const box = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const ROOMS = [
  { id: 1, uid: 'uH', name: 'Зал', mode: 'shroud', cornerRadius: 0, vertices: box(100, 100, 500, 500) },
  { id: 2, uid: 'uA', name: '', mode: 'shroud', cornerRadius: 0, vertices: box(600, 100, 900, 400) },
  { id: 3, uid: 'uK', name: 'Кухня', mode: 'reveal', cornerRadius: 0, vertices: box(100, 600, 500, 900) },
];

module.exports = async function notesTreeRollback(rig) {
  if (!rig.check(fs.existsSync(PREV), '0: no previous release is extracted at ' + PREV)) return;
  const drive = await rig.fakeDrive();
  rig.writeSyncConfig(rig.profileDir, drive);
  let dm = await rig.restart();
  await lib.installHelpers(dm);
  await kit.install(dm);
  await lib.settle(dm, 'typeof syncEngine !== "undefined" && syncEngine.status().state !== "off"', 60000);
  const id = await dm.evaluate(`(async () => {
    const f = await __bk.noiseFile('Откат', 1200, 800, 3, 0.85);
    const r = await addMapsToLibrary([f], { x: 0, y: 0 }, true);
    await __bk.editScene(r.ids[0], s => { s.polygons = ${q(ROOMS)}; s.nextPolygonId = 4; });
    for (const n of ['Волк', 'Гоблин']) { const b = cbNewBlock(n); b.notes = 'заметка'; }
    cbSave();
    return r.ids[0];
  })()`, 240000);
  const claude = (tool, args) => dm.evaluate(`_mcpAnswer(${q({ tool, args })})`, 60000);
  let stored = null;
  await lib.step(rig, '13 here', async () => {
    const a = await claude('set_notes_order', { level: 'map', name: 'Откат', order: ['Кухня', 'Зал'], groups: [{ name: 'Крыло', items: ['Room 2', 'Зал'] }] });
    const b = await claude('set_notes_order', { level: 'monsters', order: ['Гоблин', 'Волк'] });
    rig.check(!a.isError && !b.isError, '13 setup: the order was not set: ' + a.text + ' / ' + b.text);
    await dm.evaluate('syncEngine.now()', 60000);
    stored = await dm.evaluate(`localStorage.getItem('evermist.notesOrder')`);
    const up = await lib.poll(async () => drive.files().some(f => /notesOrder/.test(f.name || '') || /notesOrder/.test(q(f.appProperties || f.properties || {}))) || null, 30000, 500);
    rig.check(!!stored && !!up, '13 setup: the order was not stored and sent: ' + q({ stored: !!stored, files: drive.files().map(f => f.name) }));
  });
  if (!stored) return;

  dm = await rig.restart({ exe: PREV });
  const ver = await dm.evaluate('window.electronAPI.getAppVersion()');
  if (!rig.check(ver === '5.12.0', '0: the previous release under ' + PREV + ' is ' + ver + ', not 5.12.0; refresh the cache')) return;
  await lib.installHelpers(dm);
  await lib.step(rig, '13 on 5.12.0', async () => {
    await dm.evaluate(`switchScene(${q(id)})`, 60000);
    await lib.settle(dm, `!!currentScene && currentScene.id === ${q(id)}`, 60000);
    await dm.evaluate('(async () => { nwShow(); await searchReadScenes(); refreshRoomPanel(); return 0; })()', 60000);
    const rows = await dm.evaluate(`[...document.querySelectorAll('#nw-tl .nw-row')].map(r => r.dataset.key).filter(k => k.startsWith('room:'))`);
    rig.check(rows.length === 3, '13: the Notes window on 5.12.0 lists ' + q(rows) + ', not the three rooms');
    await lib.settle(dm, 'typeof syncEngine !== "undefined" && syncEngine.status().state !== "off"', 60000);
    await dm.evaluate('syncEngine.now()', 60000);
    const st = await dm.evaluate('syncEngine.status()');
    rig.check(st.state !== 'error', '13: a sync tick on 5.12.0 ended in ' + q(st));
    rig.check(await dm.evaluate(`localStorage.getItem('evermist.notesOrder')`) === stored, '13: 5.12.0 changed or dropped the stored order');
  });
};
