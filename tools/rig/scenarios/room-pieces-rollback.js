'use strict';

// room-pieces-rollback.js - A ROOM OF SEPARATE PIECES OPENS ON THE PREVIOUS RELEASE AND COMES BACK (spec room-pieces,
// DoD 11 and 12).
//
// One profile, in Russian. On this build a hidden hall "Зал" is cut through the middle with the Rectangle and Alt
// (Cut out), which leaves one room of two pieces, and the map saves. The previous release, 5.14.8, extracted under
// ~/.cache/evermist-rig/prev-5.14.8/, opens the same library: the room loader (normalizeRoomFields, the save's encoding
// and decoding) is the same in 5.14.8 and 5.15.0. There the DM reveals the hall's first piece alone and saves. This
// build opens it once more. A run against any other previous release fails on its version line. Console errors fail it.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   0.  The previous release under the cache is 5.14.8.
//   1.  Here the cut leaves one room, "Зал", of two pieces, the far piece linked to the hall's uid; the save holds it.
//   2.  On 5.14.8 the map opens with no error and shows both pieces as rooms of their own, nothing lost, both hidden.
//   3.  On 5.14.8 the first piece is revealed alone and the map saves; the far piece's link is still in the save.
//   4.  Back on this build the map opens with no error as one room "Зал" of two pieces again, and both pieces take
//       the most hidden fog of the two, hidden: fog that disagrees fails toward hidden, never toward revealed.

const fs = require('fs');
const path = require('path');
const os = require('os');
const lib = require('../lib');
const kit = require('../backupKit');

const PREV = path.join(os.homedir(), '.cache', 'evermist-rig', 'prev-5.14.8', 'evermist');
const q = JSON.stringify;
const box = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const HALL = { id: 1, uid: 'uH', name: 'Зал', mode: 'shroud', cornerRadius: 0, vertices: box(100, 100, 1500, 700) };
const DIALOG = '(typeof _cdOpen !== "undefined" && _cdOpen ? (document.getElementById("cd-msg") || {}).textContent || "a dialog" : "")';

const ROOMS = `polygons.map(p => ({ id: p.id, name: p.name, mode: p.mode, uid: p.uid || null, pieceOf: p.pieceOf || null }))`;
const open = async (dm, id) => {
  await dm.evaluate(`switchScene(${q(id)})`, 60000);
  await lib.settle(dm, `!!currentScene && currentScene.id === ${q(id)} && fogCoverT === 0 && !fogDirty`, 60000);
  await dm.evaluate('(() => { if (worldMapOpen) worldMapHide(); setPlaceMode("rooms"); setShape("select"); return 0; })()');
  return dm.evaluate(ROOMS);
};
const faults = async dm => {
  const dialog = await dm.evaluate(DIALOG);
  return (dm.errors || []).slice().concat(dialog ? ['dialog: ' + dialog] : []);
};
const stored = (dm, id) => dm.evaluate(`sceneStore.loadScene(${q(id)}).then(s => s.polygons.map(p => ({ id: p.id, mode: p.mode,
  uid: p.uid || null, pieceOf: p.pieceOf || null })))`, 60000);

module.exports = async function roomPiecesRollback(rig) {
  if (!rig.check(fs.existsSync(PREV), '0: no previous release is extracted at ' + PREV)) return;
  let dm = await lib.inRussian(rig);
  await kit.install(dm);
  const id = await dm.evaluate(`(async () => {
    const f = await __bk.noiseFile('Куски', 2400, 1600, 9, 0.85);
    const r = await addMapsToLibrary([f], { x: 0, y: 400 }, true);
    await __bk.editScene(r.ids[0], s => { s.polygons = ${q([HALL])}; s.nextPolygonId = 2; });
    return r.ids[0];
  })()`, 240000);

  let here = null;
  await lib.step(rig, '1 here', async () => {
    await open(dm, id);
    await dm.evaluate(`(() => { setShapeOp('trim'); setShape('rect'); __rigDrag(700, 50, 900, 750); setShape('select'); setShapeOp('new'); return 0; })()`);
    await dm.evaluate('doAutoSave()', 60000);
    here = await dm.evaluate(ROOMS);
    const save = await stored(dm, id);
    rig.check(here.length === 2 && here[0].uid === 'uH' && here[1].pieceOf === 'uH' && here[0].name === 'Зал'
      && await dm.evaluate('roomHeads(polygons).length') === 1,
      '1: the cut should leave one room "Зал" of two pieces, got ' + q(here));
    rig.check(save.length === 2 && save.some(p => p.pieceOf === 'uH'), '1: the save should hold the piece and its link, holds ' + q(save));
  });
  if (!here || here.length !== 2) return;
  const pieceId = here.find(p => p.pieceOf).id;

  dm = await rig.restart({ exe: PREV });
  const ver = await dm.evaluate('window.electronAPI.getAppVersion()');
  if (!rig.check(ver === '5.14.8', '0: the previous release under ' + PREV + ' is ' + ver + ', not 5.14.8; refresh the cache')) return;
  await lib.installHelpers(dm);
  await lib.step(rig, '2 and 3 on 5.14.8', async () => {
    const then = await open(dm, id);
    const bad = await faults(dm);
    rig.check(!bad.length, '2: on 5.14.8 the map should open without error, got ' + q(bad));
    rig.check(then.length === 2 && then.every(p => p.mode === 'shroud'),
      '2: on 5.14.8 both pieces should show as rooms, hidden, got ' + q(then));
    await dm.evaluate('(() => { setPolygonMode(1, "reveal"); return 0; })()');
    await dm.evaluate('doAutoSave()', 60000);
    const save = await stored(dm, id);
    rig.check(save.find(p => p.id === 1).mode === 'reveal' && save.find(p => p.id === pieceId).pieceOf === 'uH',
      '3: on 5.14.8 the first piece should save revealed and the far piece keep its link, holds ' + q(save));
  });

  dm = await rig.restart({ exe: null });
  await lib.installHelpers(dm);
  await lib.step(rig, '4 back here', async () => {
    const back = await open(dm, id);
    const bad = await faults(dm);
    rig.check(!bad.length, '4: back on this build the map should open without error, got ' + q(bad));
    rig.check(back.length === 2 && back.find(p => p.id === pieceId).pieceOf === 'uH' && await dm.evaluate('roomHeads(polygons).length') === 1,
      '4: back here the map should hold one room of two pieces, got ' + q(back));
    rig.check(back.every(p => p.mode === 'shroud'), '4: both pieces should take the most hidden fog, hidden, got ' + q(back));
  });
};
