'use strict';

// room-layers-rollback.js - A MAP WITH REORDERED ROOMS OPENS THE SAME ON THE PREVIOUS RELEASE (spec room-layers, DoD 11).
//
// One profile. On a map holding a hidden hall, the DM draws a revealed closet inside it, which this build places in
// front of the hall (5.12.0 only ever appended a new room), and saves; the previous
// release, 5.12.0, extracted under ~/.cache/evermist-rig/prev/, then opens the same library. A run against any other
// previous release fails on its version line, since the trip it checks is back to 5.12.0.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   0.  The previous release under the cache is 5.12.0.
//  11.  Here the closet, placed in front, is clear and the hall around it fogged. On 5.12.0 the map opens with the
//       closet still in front, clear, and the hall still fogged.

const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../lib');
const kit = require('../backupKit');

const PREV = path.join(os.homedir(), '.cache', 'evermist-rig', 'prev', 'squashfs-root', 'evermist');
const q = JSON.stringify;
const box = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const ROOMS = [
  { id: 1, uid: 'uH', name: 'Зал', mode: 'shroud', cornerRadius: 0, vertices: box(100, 100, 1100, 1100) },
];

const look = async (dm, id) => {
  await dm.evaluate(`switchScene(${q(id)})`, 60000);
  await lib.settle(dm, `!!currentScene && currentScene.id === ${q(id)} && fogCoverT === 0 && !fogTransRafId && !fogDirty`, 60000);
  return dm.evaluate('({ order: polygons.map(p => p.name), closet: __rigFog(500, 500), hall: __rigFog(900, 900) })');
};

module.exports = async function roomLayersRollback(rig) {
  if (!rig.check(fs.existsSync(PREV), '0: no previous release is extracted at ' + PREV)) return;
  let dm = rig.dm;
  await lib.installHelpers(dm);
  await kit.install(dm);
  const id = await dm.evaluate(`(async () => {
    const f = await __bk.noiseFile('Слои', 2400, 1600, 5, 0.85);
    const r = await addMapsToLibrary([f], { x: 0, y: 400 }, true);
    await __bk.editScene(r.ids[0], s => { s.polygons = ${q(ROOMS)}; s.nextPolygonId = 2; });
    return r.ids[0];
  })()`, 240000);

  let here = null;
  await lib.step(rig, '11 here', async () => {
    await look(dm, id);
    await dm.evaluate(`(() => { if (worldMapOpen) worldMapHide(); setPlaceMode('rooms'); setPaintDirection('reveal');
      setShape('rect'); __rigDrag(400, 400, 600, 600); setShape('select');
      const c = polygons.find(p => p.name !== 'Зал'); if (c) c.name = 'Чулан'; return 0; })()`);
    await dm.evaluate('doAutoSave()', 60000);
    here = await look(dm, id);
    rig.check(q(here.order) === q(['Чулан', 'Зал']) && here.closet < 128 && here.hall > 200,
      '11 setup: drawn inside the hall, the closet should be in front and clear in the fogged hall here: ' + q(here));
  });
  if (!here) return;

  dm = await rig.restart({ exe: PREV });
  const ver = await dm.evaluate('window.electronAPI.getAppVersion()');
  if (!rig.check(ver === '5.12.0', '0: the previous release under ' + PREV + ' is ' + ver + ', not 5.12.0; refresh the cache')) return;
  await lib.installHelpers(dm);
  await lib.step(rig, '11 on 5.12.0', async () => {
    const then = await look(dm, id);
    rig.check(q(then.order) === q(here.order) && then.closet < 128 && then.hall > 200,
      '11: on 5.12.0 the map opens as ' + q(then) + ', not as it was saved: ' + q(here));
  });
};
