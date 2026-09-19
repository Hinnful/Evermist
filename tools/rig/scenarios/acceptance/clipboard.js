'use strict';

// clipboard.js — COPYING, PASTING AND DUPLICATING A SHAPE.
//
// THE GOAL OF THIS FEATURE: a dungeon repeats its rooms, and the DM lays the second one down with
// two keys instead of redrawing it.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks directly beneath it, in order.
//
//   A. Ctrl+C then Ctrl+V puts a second room on the map, centred on the pointer, and leaves it
//      picked as a whole object.
//   B. The copy keeps the original's name, description and fog state, and takes an id of its own.
//   C. Ctrl+D lands a duplicate one grid square across, and leaves the clipboard alone.
//   D. THE CLIPBOARD OUTLIVES A SCENE SWITCH. A room copied on one floor pastes onto the next.
//   E. A copied hole pastes as a hole into the shape under the pointer, carrying its own curve,
//      and it never lands where it would leave that shape. Ctrl+D on a hole duplicates it inside
//      its OWN room, one grid square across, and never on top of the one it came from.
//   F. An effect copied in Effects mode still pastes into the effects list from Rooms mode, and
//      the placement mode does not change under the DM.
//   G. A paste is ONE undo step, and undo takes the pasted shape away. A Ctrl+C spends nothing.
//   H. IT REACHES THE TV. A pasted shroud room the players still see through is the failure this
//      feature exists to prevent.
//
//
// ⚠ THE MAP STARTS FULLY FOGGED, so every room here is a SHROUD room inside a revealed clearing.
// On untouched map a shroud room changes nothing and every fog check passes for free.
//
// ⚠ THE POINTER IS MOVED BEFORE EVERY PASTE. A paste reads the last position the map's own
// mousemove recorded, so a Ctrl+V with no move before it drops the shape wherever the previous
// gesture left the cursor, and the check then measures the wrong place.

const lib = require('../../lib');

const MAP_W = 2400, MAP_H = 1500;
const CLEAR = { x: 1200, y: 750, r: 1100 };

const OWN_HELPERS = `
globalThis.__rigLast = (list) => {
  const l = list === 'effects' ? effects : polygons;
  return l.length ? __rigShape(l[l.length - 1].id, list) : null;
};
0`;



const CTRL = '{ ctrlKey: true }';

module.exports = async function clipboard(rig) {
  const dm = rig.dm;

  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H });
  const expr = await rig.fixtures.asFileExpr(dm, map);
  const named = n => '(f => new File([f], ' + JSON.stringify(n) + ', { type: f.type }))(' + expr + ')';

  await dm.evaluate('createNewScene(' + named('ground-floor.mp4') + ')', 120000);
  const floorOne = await dm.evaluate('currentScene.id');
  await lib.installHelpers(dm);
  await dm.evaluate(OWN_HELPERS);
  await dm.evaluate('revealCircle(' + CLEAR.x + ',' + CLEAR.y + ',' + CLEAR.r + ');' +
                    'rebuildFogEffect(); fogDirty = true; scheduleRender(); 0');
  await dm.waitFor('fogCoverT === 0 && fogTransRafId === null', 30000, 'the clearing to open');
  const zoom = await dm.evaluate('zoom');
  const tol = 3 / zoom;

  // ══ A. Ctrl+C, Ctrl+V, and the copy lands under the pointer ══
  const aRoom = await dm.evaluate('__rigDrawShroud(500, 300, 800, 500)');
  await dm.evaluate('__rigClick(650, 400); 0');
  rig.check(await dm.evaluate('selectedPolygonId') === aRoom,
            'the room was not picked, so there is nothing for Ctrl+C to copy');

  const beforeA = await dm.evaluate('polygons.length');
  await dm.evaluate('__rigKey("KeyC", ' + CTRL + '); 0');
  const DROP = { x: 1500, y: 400 };
  await dm.evaluate('__rigPoint(' + DROP.x + ',' + DROP.y + '); __rigKey("KeyV", ' + CTRL + '); 0');
  rig.check(await dm.evaluate('polygons.length') === beforeA + 1,
            'Ctrl+V put no second room on the map at all');

  const pasted = await dm.evaluate('__rigLast("rooms")');
  const centreA = { x: (pasted.box.x0 + pasted.box.x1) / 2, y: (pasted.box.y0 + pasted.box.y1) / 2 };
  rig.note('the paste centred on ' + Math.round(centreA.x) + ',' + Math.round(centreA.y) +
           ' with the pointer at ' + DROP.x + ',' + DROP.y);
  rig.check(Math.abs(centreA.x - DROP.x) < tol && Math.abs(centreA.y - DROP.y) < tol,
            'the paste landed centred on ' + Math.round(centreA.x) + ',' + Math.round(centreA.y) +
            ' rather than under the pointer');
  rig.check(Math.abs((pasted.box.x1 - pasted.box.x0) - 300) < tol &&
            Math.abs((pasted.box.y1 - pasted.box.y0) - 200) < tol,
            'the pasted room came out a different size from the one that was copied');
  rig.check(await dm.evaluate('selectedPolygonId') === pasted.id &&
            await dm.evaluate('shapeEditMode') === false,
            'the paste did not leave the new room picked as a whole object, ready to drag');

  // ══ B. Name, description and fog state carry; the id does not ══
  await dm.evaluate('__rigOf("rooms",' + aRoom + ').name = "Guard Post";' +
                    '__rigOf("rooms",' + aRoom + ').desc = "Two guards, one asleep."; 0');
  await dm.evaluate('__rigClick(650, 400); __rigKey("KeyC", ' + CTRL + '); 0');
  await dm.evaluate('__rigPoint(1500, 900); __rigKey("KeyV", ' + CTRL + '); 0');
  const copyB = await dm.evaluate('__rigLast("rooms")');
  const origB = await dm.evaluate('__rigShape(' + aRoom + ', \"rooms\")');
  rig.check(copyB.name === 'Guard Post',
            'the copy is called "' + copyB.name + '" rather than carrying the original\'s name');
  rig.check(copyB.desc === 'Two guards, one asleep.',
            'the description written on the original did not follow the copy');
  rig.check(copyB.mode === origB.mode && copyB.mode === 'shroud',
            'the copy came in as "' + copyB.mode + '" rather than keeping the original\'s fog state');
  rig.check(copyB.id !== aRoom && (await dm.evaluate('polygons.filter(p => p.id === ' +
            copyB.id + ').length')) === 1,
            'the copy took an id another room already holds, so the two cannot be told apart');

  // ══ C. Ctrl+D lands one grid square across, and leaves the clipboard alone ══
  // A SECOND, NARROWER ROOM goes on the clipboard first. Without it the paste that follows the
  // Ctrl+D measures 300 units wide whether it came from the clipboard or from the duplicate, and
  // the check passes either way.
  const cNarrow = await dm.evaluate('__rigDrawShroud(300, 1150, 450, 1250)');
  await dm.evaluate('__rigClick(375, 1200); __rigKey("KeyC", ' + CTRL + '); 0');
  rig.check(await dm.evaluate('selectedPolygonId') === cNarrow,
            'the narrow room was not picked, so the clipboard still holds the wide one');

  const cell = await dm.evaluate('gridSize > 0 ? gridSize : 70');
  await dm.evaluate('__rigClick(650, 400); 0');
  rig.check(await dm.evaluate('selectedPolygonId') === aRoom,
            'Ctrl+D is about to duplicate a room other than the one C measures');
  const beforeC = await dm.evaluate('__rigShape(' + aRoom + ', \"rooms\")');
  await dm.evaluate('__rigKey("KeyD", ' + CTRL + '); 0');
  const dupC = await dm.evaluate('__rigLast("rooms")');
  rig.note('one grid square is ' + Math.round(cell) + ' map units; the duplicate moved ' +
           Math.round(dupC.box.x0 - beforeC.box.x0) + ',' +
           Math.round(dupC.box.y0 - beforeC.box.y0));
  rig.check(Math.abs((dupC.box.x0 - beforeC.box.x0) - cell) < 0.01 &&
            Math.abs((dupC.box.y0 - beforeC.box.y0) - cell) < 0.01,
            'Ctrl+D did not land the duplicate one grid square across');
  rig.check(dupC.id !== aRoom && dupC.name === 'Guard Post',
            'the duplicate is not a separate room carrying the original name');

  // The clipboard still holds the NARROW room, so Ctrl+D never touched it.
  await dm.evaluate('__rigPoint(700, 1400); __rigKey("KeyV", ' + CTRL + '); 0');
  const afterC = await dm.evaluate('__rigLast("rooms")');
  rig.note('the paste after a Ctrl+D came out ' + Math.round(afterC.box.x1 - afterC.box.x0) +
           ' units wide, against 150 for the clipboard and 300 for the duplicate');
  rig.check(Math.abs((afterC.box.x1 - afterC.box.x0) - 150) < tol,
            'the paste after a Ctrl+D did not come from the clipboard, so Ctrl+D overwrote it');

  // ══ D. The clipboard outlives a scene switch ══
  // ⚠ AIMED CLEAR OF THE DUPLICATE C left one square down and across, or the click picks that
  // instead and D measures the wrong room.
  await dm.evaluate('__rigClick(550, 350); 0');
  rig.check(await dm.evaluate('selectedPolygonId') === aRoom,
            'the click picked the duplicate rather than the room D means to carry across');
  await dm.evaluate('__rigKey("KeyC", ' + CTRL + '); 0');
  await dm.evaluate('createNewScene(' + named('first-floor.mp4') + ')', 120000);
  await dm.waitFor('currentScene && currentScene.id !== ' + JSON.stringify(floorOne), 120000,
                   'the second scene to open');
  await dm.waitFor('fogCoverT === 0', 30000, 'the second scene\'s cover to lift');
  await lib.installHelpers(dm);
  await dm.evaluate(OWN_HELPERS);
  rig.check(await dm.evaluate('polygons.length') === 0,
            'the second scene arrived carrying rooms, so a paste into it proves nothing');
  await dm.evaluate('__rigPoint(1200, 700); __rigKey("KeyV", ' + CTRL + '); 0');
  const acrossD = await dm.evaluate('__rigLast("rooms")');
  rig.check(await dm.evaluate('polygons.length') === 1 && !!acrossD,
            'a room copied on one floor did not paste onto the next, so the clipboard died with ' +
            'the scene');
  rig.check(acrossD.name === 'Guard Post' && acrossD.mode === 'shroud',
            'the room that crossed scenes arrived without its name or its fog state');
  await dm.evaluate('switchScene(' + JSON.stringify(floorOne) + ')', 120000);
  await dm.waitFor('currentScene && currentScene.id === ' + JSON.stringify(floorOne), 60000,
                   'the switch back to the ground floor');
  await dm.waitFor('fogCoverT === 0', 30000, 'the ground floor\'s cover to lift');
  await lib.installHelpers(dm);
  await dm.evaluate(OWN_HELPERS);
  rig.check(!!(await dm.evaluate('__rigShape(' + aRoom + ', \"rooms\")')),
            'the ground floor came back without the rooms A to C drew, so everything below it ' +
            'is measuring an empty scene');

  // ══ E. A hole pastes as a hole, into the shape under the pointer ══
  const eRoom = await dm.evaluate('__rigDrawShroud(1400, 1000, 1900, 1350)');
  await dm.evaluate('__rigOpRect("trim", 1480, 1080, 1620, 1200)');
  await dm.evaluate(lib.SETTLE);
  const holed = await dm.evaluate('__rigShape(' + eRoom + ', \"rooms\")');
  rig.check(!!holed && holed.holes === 1,
            'the Trim left ' + (holed ? holed.holes : 'no room') + ' rather than one hole, so E ' +
            'is measuring the wrong thing');

  // Bend one of the hole's own walls, so the paste has a curve to carry. The hole's corners only
  // answer at its OWN level, which is one double-click past the room's.
  await dm.evaluate('__rigClick(1800, 1300); __rigDbl(1800, 1300); 0');
  await dm.evaluate('__rigClick(1550, 1140); __rigDbl(1550, 1140); 0');
  rig.check(await dm.evaluate('selectedHoleIndex') === 0 &&
            await dm.evaluate('holeEditMode') === true,
            'the hole never opened for editing, so its wall cannot be bent');
  const holeBox = holed.holeBox[0];
  const midX = (holeBox.x0 + holeBox.x1) / 2;
  await dm.evaluate('__rigDrag(' + midX + ',' + holeBox.y0 + ',' + midX + ',' +
                    (holeBox.y0 - 40) + ', { mods: { ctrlKey: true } }); 0');
  const bentE = await dm.evaluate('__rigShape(' + eRoom + ', \"rooms\")');
  const bentCount = bentE.handles ? bentE.handles.filter(h => h).length : 0;
  rig.check(bentCount > 0,
            'the wall of the hole was never bent, so the curve half of E measures nothing');

  await dm.evaluate('__rigKey("Escape"); 0');
  rig.check(await dm.evaluate('selectedHoleIndex') === 0,
            'the hole is no longer picked, so Ctrl+C would copy the whole room instead');
  await dm.evaluate('__rigKey("KeyC", ' + CTRL + '); 0');
  const DROP_E = { x: 1780, y: 1180 };
  const roomsBeforeE = await dm.evaluate('polygons.length');
  await dm.evaluate('__rigPoint(' + DROP_E.x + ',' + DROP_E.y + '); __rigKey("KeyV", ' +
                    CTRL + '); 0');
  await dm.evaluate(lib.SETTLE);
  const afterE = await dm.evaluate('__rigShape(' + eRoom + ', \"rooms\")');
  rig.check(afterE.holes === 2,
            'the copied hole landed as ' + afterE.holes + ' hole(s) rather than two, so it did ' +
            'not paste into the room under the pointer');
  rig.check(await dm.evaluate('polygons.length') === roomsBeforeE,
            'the copied hole made a room of its own instead of a hole in the room it landed on');
  const newHole = afterE.holeBox[1];
  const cE = { x: (newHole.x0 + newHole.x1) / 2, y: (newHole.y0 + newHole.y1) / 2 };
  rig.note('the pasted hole centred on ' + Math.round(cE.x) + ',' + Math.round(cE.y) +
           ' with the pointer at ' + DROP_E.x + ',' + DROP_E.y);
  rig.check(Math.abs(cE.x - DROP_E.x) < 60 && Math.abs(cE.y - DROP_E.y) < 60,
            'the pasted hole landed at ' + Math.round(cE.x) + ',' + Math.round(cE.y) +
            ' rather than near the pointer');
  const afterCount = afterE.handles ? afterE.handles.filter(h => h).length : 0;
  rig.note('the room carried ' + bentCount + ' curved corners before the paste and ' +
           afterCount + ' after');
  rig.check(afterCount > bentCount,
            'the pasted hole arrived straight-walled, so its curve did not travel with it');

  // ⚠ Ctrl+D ON A HOLE GOES INTO ITS OWN ROOM, and never lays a ring over the original: a
  // duplicate the DM cannot see is worse than one that never arrived.
  await dm.evaluate('__rigClick(1550, 1140); 0');
  rig.check(await dm.evaluate('selectedHoleIndex') >= 0,
            'no hole is picked, so Ctrl+D would duplicate the whole room');
  const dupHoleBefore = await dm.evaluate('__rigShape(' + eRoom + ', \"rooms\")');
  const pickedIdx = await dm.evaluate('selectedHoleIndex');
  await dm.evaluate('__rigKey("KeyD", ' + CTRL + '); 0');
  const dupHoleAfter = await dm.evaluate('__rigShape(' + eRoom + ', \"rooms\")');
  rig.check(dupHoleAfter.holes === dupHoleBefore.holes + 1,
            'Ctrl+D on a hole left ' + dupHoleAfter.holes + ' holes where ' +
            (dupHoleBefore.holes + 1) + ' were due, so it duplicated into another shape');
  const src = dupHoleBefore.holeBox[pickedIdx];
  const made = dupHoleAfter.holeBox[dupHoleAfter.holes - 1];
  rig.note('the duplicated hole moved ' + Math.round(made.x0 - src.x0) + ',' +
           Math.round(made.y0 - src.y0) + ' against a grid square of ' + Math.round(cell));
  rig.check(Math.abs(Math.abs(made.x0 - src.x0) - cell) < 0.01 &&
            Math.abs(Math.abs(made.y0 - src.y0) - cell) < 0.01,
            'the duplicated hole landed on top of the one it came from, so the DM sees nothing ' +
            'happen while the room carries two rings');

  // A hole aimed at bare map lands nowhere, and takes no undo step with it.
  const holesBeforeMiss = dupHoleAfter.holes;
  const undoMiss = await dm.evaluate('undoStack.length');
  await dm.evaluate('__rigPoint(300, 1400); __rigKey("KeyV", ' + CTRL + '); 0');
  rig.check((await dm.evaluate('__rigShape(' + eRoom + ', \"rooms\")')).holes === holesBeforeMiss &&
            await dm.evaluate('undoStack.length') === undoMiss,
            'a hole pasted where no room sits still changed something');

  // ══ F. An effect pastes into the effects list from Rooms mode ══
  await dm.evaluate('__rigKey("Escape"); __rigKey("Escape"); __rigKey("Escape"); 0');
  await dm.evaluate('setPlaceMode("effects"); 0');
  await dm.evaluate('setShapeOp("new"); setShape("rect"); __rigDrag(300, 300, 550, 500);' +
                    ' setShape("select"); 0');
  const fx = await dm.evaluate('__rigLast("effects")');
  rig.check(!!fx && !!fx.material, 'no effect was drawn, so F is measuring nothing');
  await dm.evaluate('__rigClick(425, 400); __rigKey("KeyC", ' + CTRL + '); 0');
  await dm.evaluate('setPlaceMode("rooms"); 0');
  const roomsBeforeF = await dm.evaluate('polygons.length');
  const fxBeforeF = await dm.evaluate('effects.length');
  await dm.evaluate('__rigPoint(900, 1300); __rigKey("KeyV", ' + CTRL + '); 0');
  rig.check(await dm.evaluate('effects.length') === fxBeforeF + 1,
            'an effect copied in Effects mode did not paste while the DM stood in Rooms mode');
  rig.check(await dm.evaluate('polygons.length') === roomsBeforeF,
            'the effect pasted into the ROOMS list, so a fire became a room');
  rig.check(await dm.evaluate('placeMode') === 'rooms',
            'the placement mode changed under the DM when the effect pasted');
  const fxCopy = await dm.evaluate('__rigLast("effects")');
  rig.check(fxCopy.material === fx.material && fxCopy.id !== fx.id,
            'the pasted effect lost its material or took the original\'s id');
  rig.check(await dm.evaluate('selectedPolygonId') === null,
            'an effect pasted from Rooms mode was left selected, where the Rooms list cannot ' +
            'hold it. ⚠ Ids are numbered per list, so this reads the selection being EMPTY, ' +
            'never the id of the pasted effect');

  // ══ G. One paste is one undo step ══
  await dm.evaluate('setShape("select"); __rigClick(550, 350); 0');
  const undoIdle = await dm.evaluate('undoStack.length');
  await dm.evaluate('__rigKey("KeyC", ' + CTRL + '); 0');
  rig.check(await dm.evaluate('undoStack.length') === undoIdle,
            'a Ctrl+C that copies nothing onto the map still spent an undo step');
  const countG = await dm.evaluate('polygons.length');
  await dm.evaluate('__rigPoint(2000, 400); __rigKey("KeyV", ' + CTRL + '); 0');
  const spentG = await dm.evaluate('undoStack.length') - undoIdle;
  rig.note('one paste spent ' + spentG + ' undo step(s)');
  rig.check(spentG === 1,
            'one paste spent ' + spentG + ' undo steps, so taking it back needs that many presses');
  await dm.evaluate('undo(); 0');
  await dm.evaluate(lib.SETTLE);
  rig.check(await dm.evaluate('polygons.length') === countG,
            'one undo did not take the pasted room away again');

  // ══ H. It reaches the TV ══
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen && !!fogDataCanvas', 45000, 'the Player to receive the map');
  await player.waitFor('fogCoverT === 0', 45000, 'the scene cover to lift on the Player');

  const PROBE = { x: 1150, y: 620 };
  await dm.evaluate(lib.SETTLE);
  rig.check(await dm.evaluate('__rigFog(' + PROBE.x + ',' + PROBE.y + ')') < 60,
            'the ground the paste has to swallow is already hidden on the DM, so pasting a ' +
            'shroud room over it would prove nothing');
  try { await player.waitFor(lib.TV_FOG + '(' + PROBE.x + ',' + PROBE.y + ') < 60', 30000,
                             'the Player to show that ground open'); } catch (_) {}

  await dm.evaluate('__rigClick(550, 350); __rigKey("KeyC", ' + CTRL + '); 0');
  await dm.evaluate('__rigPoint(' + PROBE.x + ',' + PROBE.y + '); __rigKey("KeyV", ' + CTRL + '); 0');
  await dm.evaluate(lib.SETTLE);
  rig.check(await dm.evaluate('__rigFog(' + PROBE.x + ',' + PROBE.y + ')') > 200,
            'the DM\'s own fog did not follow the paste, so nothing could reach the TV');
  try { await player.waitFor(lib.TV_FOG + '(' + PROBE.x + ',' + PROBE.y + ') > 200', 30000,
                             'the pasted room to reach the Player'); } catch (_) {}
  const tv = await player.evaluate(lib.TV_FOG + '(' + PROBE.x + ',' + PROBE.y + ')');
  rig.note('the ground the pasted room swallowed reads alpha ' + tv + ' on the TV');
  rig.check(tv > 200,
            'the players still see open ground where the DM pasted a shroud room, so the whole ' +
            'gesture stops at the DM window');
};
