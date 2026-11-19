'use strict';

// room-layers-sync.js - THE ROOMS' LAYER ORDER TRAVELS THROUGH IMPORT AND SYNC (spec room-layers, DoD 8).
//
// One library plays laptop A and laptop B for the backup, through the backup kit; then two apps on one fake Drive.
// The map "Слои" holds a hidden hall "Зал", a room beside it "Сбоку" and a closet "Чулан" inside the hall.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   8a. Import: laptop A holds "Сбоку" in front of the hall (an order an earlier release let the DM set) and drew
//       "Чулан" inside it, a day after the copy B holds. B imports A's file: "Сбоку" is in front of the hall and
//       "Чулан" sits above the hall, placed as a drawn room is.
//   8b. Sync: the DM on A draws "Альков" around the closet and inside the hall; it lands between them, and B gets it
//       there. The DM on B draws "Проход" between the closet and "Альков", and Claude adds a room on B inside the hall
//       alone, placed just above the hall; A gets both at those layers.

const fs = require('fs');
const path = require('path');

const lib = require('../lib');
const kit = require('../backupKit');

const DAY = 86400000;
const q = JSON.stringify;
const box = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const room = (id, uid, name, verts) => ({ id, uid, name, mode: 'shroud', cornerRadius: 0, vertices: verts });
const HALL = room(1, 'uH', 'Зал', box(100, 100, 1100, 1100));
const SIDE = room(2, 'uS', 'Сбоку', box(1500, 100, 1900, 500));
const CLOSET = room(3, 'uC', 'Чулан', box(400, 400, 600, 600));

const names = (dm, id) => dm.evaluate(`sceneStore.loadScene(${q(id)}).then(r => r ? r.polygons.map(p => p.name) : null)`, 20000);
// A room drawn by hand with the Rectangle on the open map, then named, so the order reads by name.
const draw = (dm, name, x0, y0, x1, y1) => dm.evaluate(`(() => { if (worldMapOpen) worldMapHide(); setPlaceMode('rooms');
  setShape('rect'); const n = polygons.length; __rigDrag(${x0}, ${y0}, ${x1}, ${y1}); setShape('select');
  if (polygons.length !== n + 1) return null;
  polygons.reduce((a, p) => (p.id > a.id ? p : a)).name = ${q(name)}; return polygons.map(p => p.name); })()`);
const open = async (dm, id) => {
  await dm.evaluate(`switchScene(${q(id)})`, 60000);
  await lib.settle(dm, `!!currentScene && currentScene.id === ${q(id)} && fogCoverT === 0`, 60000);
};

module.exports = async function roomLayersSync(rig) {
  let dm = rig.dm;
  await lib.installHelpers(dm);
  await kit.install(dm);
  const now = Date.now(), T0 = now - 30 * DAY, d1 = now - DAY;
  const dir = path.join(rig.outDir, 'слои');
  fs.mkdirSync(dir, { recursive: true });
  const zipOld = path.join(dir, 'старая.zip'), zipA = path.join(dir, 'ноутбук-A.zip');
  const add = (name, seed) => dm.evaluate(`__bk.at(${T0}, async () => {
    const f = await __bk.noiseFile(${q(name)}, 2400, 1600, ${seed}, 0.85);
    return (await addMapsToLibrary([f], { x: ${seed * 300}, y: 400 }, true)).ids[0];
  })`, 240000);
  const L = await add('Слои', 3), P = await add('Пусто', 4);
  const at = (ms, body) => dm.evaluate(`__bk.at(${ms}, async () => { ${body} })`, 240000);

  await lib.step(rig, '8a: import', async () => {
    await at(T0, `await __bk.editScene(${q(L)}, s => { s.polygons = ${q([HALL, SIDE])}; s.nextPolygonId = 4; });`);
    await dm.evaluate(`doExport(${q([L, P])}, { destPath: ${q(zipOld)} })`, 300000);
    await at(d1, `await __bk.editScene(${q(L)}, s => { s.polygons = ${q([SIDE, CLOSET, HALL])}; });`);
    await dm.evaluate(`doExport(${q([L, P])}, { destPath: ${q(zipA)} })`, 300000);
    rig.check(fs.existsSync(zipOld) && fs.existsSync(zipA), '8a setup: the two files were not exported');
    await dm.evaluate('__bk.wipe()', 120000);
    dm = await rig.restart();
    await lib.installHelpers(dm);
    await kit.install(dm);
    await lib.settle(dm, 'typeof sceneStore !== "undefined"', 30000);
    await dm.evaluate(`restoreFromZipPath(${q(zipOld)}, __bk.say)`, 300000);
    rig.check(q(await names(dm, L)) === q(['Зал', 'Сбоку']), '8a setup: the old copy holds ' + q(await names(dm, L)));
    await dm.evaluate(`restoreFromZipPath(${q(zipA)}, __bk.say)`, 300000);
    const got = await names(dm, L);
    rig.check(q(got) === q(['Сбоку', 'Чулан', 'Зал']), '8a: after Import the rooms are ' + q(got) + ', not Сбоку, Чулан, Зал');
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
    const n = await names(d, L);
    return n && q(n) === q(want) ? n : null;
  }, 120000, 500);
  const push = async d => { await d.evaluate('doAutoSave()', 60000); await open(d, P); await d.evaluate('syncEngine.now()', 60000); };

  await lib.step(rig, '8b: sync', async () => {
    rig.check(!!(await pulled(dmB, ['Сбоку', 'Чулан', 'Зал'])), '8b setup: B did not get the map in its order: ' + q(await names(dmB, L)));
    await open(dmA, L);
    const onA = ['Сбоку', 'Чулан', 'Альков', 'Зал'];
    rig.check(q(await draw(dmA, 'Альков', 300, 300, 700, 700)) === q(onA), '8b: the room drawn on A did not land between the closet and the hall: ' + q(await names(dmA, L)));
    await push(dmA);
    rig.check(!!(await pulled(dmB, onA)), '8b: the room drawn on A did not reach B at its layer: ' + q(await names(dmB, L)));

    await open(dmB, L);
    const onB = ['Сбоку', 'Чулан', 'Проход', 'Альков', 'Зал'];
    rig.check(q(await draw(dmB, 'Проход', 350, 350, 650, 650)) === q(onB), '8b: the room drawn on B did not land between the closet and Альков');
    await push(dmB);
    const out = await dmB.evaluate(`MCP_ROOMS_TOOLS.create_room({ name: 'Слои', room: 'Ниша', fog: 'hidden',
      outline: [[${800 / 24}, ${800 / 16}], [${1000 / 24}, ${800 / 16}], [${1000 / 24}, ${1000 / 16}], [${800 / 24}, ${1000 / 16}]] })`, 30000);
    rig.check(!out.isError && /index 5\)/.test(out.text), '8b: Claude\'s room on B did not go just above the hall, room 5 of 6: ' + out.text);
    await dmB.evaluate('syncEngine.now()', 60000);
    const want = ['Сбоку', 'Чулан', 'Проход', 'Альков', 'Ниша', 'Зал'];
    rig.check(!!(await pulled(dmA, want)), '8b: A holds ' + q(await names(dmA, L)) + ', not ' + q(want));
  });
};
