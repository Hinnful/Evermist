'use strict';

// room-pieces-sync.js - A ROOM OF SEPARATE PIECES TRAVELS THROUGH IMPORT AND SYNC (spec room-pieces, DoD 10).
//
// The map "Куски" holds a hidden hall "Зал" (uid uH) and a room "Сбоку". One library first, through a backup; then
// two apps on one fake Drive.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   10a. Import: the DM cuts the hall through the middle with the Rectangle and Alt, exports, and restores the file
//        into an emptied library: one room "Зал" of two pieces comes back, the far piece linked to uH.
//   10b. Sync: B gets that map as one room "Зал" of two pieces.
//   10c. Sync back: the DM on B clicks the far piece, sets Half in its popup and types "Склеп" in the room's name field;
//        the name lands on the room, and A gets both pieces half under that one name.

const fs = require('fs');
const path = require('path');
const lib = require('../lib');
const kit = require('../backupKit');

const q = JSON.stringify;
const box = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const room = (id, uid, name, verts) => ({ id, uid, name, mode: 'shroud', cornerRadius: 0, vertices: verts });
const HALL = room(1, 'uH', 'Зал', box(100, 100, 1500, 700));
const SIDE = room(2, 'uS', 'Сбоку', box(1700, 100, 2100, 500));

// The stored map's rooms, one line each: a head's name or a piece's link, and its fog.
const rooms = (dm, id) => dm.evaluate(`sceneStore.loadScene(${q(id)}).then(r => r ? r.polygons.map(p =>
  (p.pieceOf ? '~' + p.pieceOf : p.name) + ':' + p.mode) : null)`, 20000);
const open = async (dm, id) => {
  await dm.evaluate(`switchScene(${q(id)})`, 60000);
  await lib.settle(dm, `!!currentScene && currentScene.id === ${q(id)} && fogCoverT === 0`, 60000);
  await dm.evaluate('(() => { if (worldMapOpen) worldMapHide(); setPlaceMode("rooms"); setShape("select"); return 0; })()');
};

module.exports = async function roomPiecesSync(rig) {
  let dm = rig.dm;
  await lib.installHelpers(dm);
  await kit.install(dm);
  const add = (name, seed) => dm.evaluate(`(async () => {
    const f = await __bk.noiseFile(${q(name)}, 2400, 1600, ${seed}, 0.85);
    return (await addMapsToLibrary([f], { x: ${seed * 300}, y: 400 }, true)).ids[0];
  })()`, 240000);
  const K = await add('Куски', 5), P = await add('Пусто', 6);
  await dm.evaluate(`__bk.editScene(${q(K)}, s => { s.polygons = ${q([HALL, SIDE])}; s.nextPolygonId = 3; })`, 60000);

  const cut = ['Зал:shroud', '~uH:shroud', 'Сбоку:shroud'];
  await lib.step(rig, '10a: import', async () => {
    await open(dm, K);
    await dm.evaluate(`(() => { setShapeOp('trim'); setShape('rect'); __rigDrag(700, 50, 900, 750); setShape('select'); setShapeOp('new'); return 0; })()`);
    await dm.evaluate('doAutoSave()', 60000);
    rig.check(q(await rooms(dm, K)) === q(cut), '10a setup: the cut should leave one room of two pieces, holds ' + q(await rooms(dm, K)));
    const zip = path.join(rig.outDir, 'куски.zip');
    await dm.evaluate(`doExport(${q([K, P])}, { destPath: ${q(zip)} })`, 300000);
    rig.check(fs.existsSync(zip), '10a setup: the backup was not written');
    await dm.evaluate('__bk.wipe()', 120000);
    dm = await rig.restart();
    await lib.installHelpers(dm);
    await kit.install(dm);
    await lib.settle(dm, 'typeof sceneStore !== "undefined"', 30000);
    await dm.evaluate(`restoreFromZipPath(${q(zip)}, __bk.say)`, 300000);
    rig.check(q(await rooms(dm, K)) === q(cut), '10a: the restored map should hold one room "Зал" of two pieces, holds ' + q(await rooms(dm, K)));
  });

  const drive = await rig.fakeDrive();
  const b = await rig.second('b');
  rig.writeSyncConfig(rig.profileDir, drive);
  rig.writeSyncConfig(b.profileDir, drive);
  const dmA = await rig.restart();
  const dmB = await b.restart();
  await lib.installHelpers(dmA);
  await lib.installHelpers(dmB);
  for (const d of [dmA, dmB]) await lib.settle(d, 'typeof syncEngine !== "undefined" && syncEngine.status().state !== "off"', 60000);
  const pulled = (d, want) => lib.poll(async () => {
    await d.evaluate('syncEngine.now()', 60000);
    const n = await rooms(d, K);
    return n && q(n) === q(want) ? n : null;
  }, 120000, 500);
  const push = async d => { await d.evaluate('doAutoSave()', 60000); await open(d, P); await d.evaluate('syncEngine.now()', 60000); };

  await lib.step(rig, '10b: sync', async () => {
    rig.check(!!(await pulled(dmB, cut)), '10b: B should get one room "Зал" of two pieces, holds ' + q(await rooms(dmB, K)));
  });

  const half = ['Склеп:half', '~uH:half', 'Сбоку:shroud'];
  await lib.step(rig, '10c: sync back', async () => {
    await open(dmB, K);
    await dmB.evaluate(`(() => { const far = polygons.find(p => p.pieceOf === 'uH'); const xs = far.vertices.map(v => v.x), ys = far.vertices.map(v => v.y);
      __rigClick((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2);
      document.querySelector('#room-fog .fx-dir[data-dir="half"]').click();
      _rpFieldPid = selectedPolygonId; _rpEl('rp-name').value = 'Склеп'; _rpCommitName(); return 0; })()`);
    await push(dmB);
    rig.check(q(await rooms(dmB, K)) === q(half), '10c: on B the room should be "Склеп", both pieces half, B holds ' + q(await rooms(dmB, K)));
    rig.check(!!(await pulled(dmA, half)), '10c: A should get "Склеп" with both pieces half, holds ' + q(await rooms(dmA, K)));
  });
};
