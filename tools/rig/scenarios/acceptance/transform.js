'use strict';

// transform.js — ROTATING AND RESIZING A SHAPE, whole.
//
// THE GOAL OF THIS FEATURE: the DM picks a room already on the map and turns it or resizes it by
// hand, the way they would in Figma, and the players see the result.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its
// letter, wherever in the file that state is cheapest to reach - which is not letter order.
//
//   A. One click on a room draws a bounding box with eight handles, and the box wraps what is
//      actually drawn — a bent wall's bulge included.
//   B. Dragging a corner handle resizes the room and pins the opposite corner.
//   C. Shift holds proportion on a corner; a side handle moves one axis alone.
//   D. A handle dragged past its anchor never turns the room inside out, and never collapses it.
//   E. Dragging just OUTSIDE a corner turns the room around the box centre, keeping its size.
//      A press inside the box always moves the room, however small the box is.
//   F. Shift snaps that turn to fifteen degrees.
//   G. A curved wall and a door ride the transform: the curve grows with the room and the door
//      keeps its place along the wall it is on.
//   H. A hole gets a box of its own, and a hole resized until it would leave its room stops dead.
//      While it wears that box, NOTHING else on the map answers a press.
//   I. A boxed hole opens for editing on one more double-click, and its room's corners stop
//      answering while it is open. Pressing one of the hole's own corners keeps the level open.
//      Escape climbs back one level per press.
//   J. A whole transform is ONE undo step, and undo puts the room back. A press that only picks
//      a handle spends nothing.
//   K. IT REACHES THE TV. A room the DM resized that the players still see at its old size is
//      the failure this feature exists to prevent.
//
//
// ⚠ THE MAP STARTS FULLY FOGGED, so every room here is a SHROUD room inside a revealed clearing.
// On untouched map a shroud room changes nothing and every fog check passes for free.
//
// ⚠ EVERY PRESS AIMED AT A HANDLE IS BUILT FROM THE BOX THE APP REPORTS, never from the rectangle
// the room was drawn as. A resize moves the box, and a press at a remembered corner then lands on
// bare map and drops the selection instead of failing.
//
// ⚠ THE DRAG IS STEPPED. A transform reads the cursor on every mousemove, so a two-move drag
// would hide a gesture that only works at its own endpoints.
//
// ⚠ THE TURN IS AIMED AT THE MIDDLE OF ITS RING, never at the edge. The ring runs from 9 to 26
// screen pixels outside a corner, clientX truncates to a whole pixel, and an aim on the 26 falls
// outside it on one run and inside it on the next. A press that misses lands on bare map and
// drops the selection, so the turn reads as zero degrees instead of as a miss.
const TURN_OFFSET_PX = 13;   // hypot(13,13) = 18.4, clear of both ends of the ring

const lib = require('../../lib');

const MAP_W = 2400, MAP_H = 1500;
const CLEAR = { x: 1200, y: 750, r: 1000 };

const OWN_HELPERS = `
// The box as the app itself computes it, and the handle it would place at a named side.
globalThis.__rigBox = (id) => shapeBoxOf(__rigById(id));
globalThis.__rigHandle = (id, name) => boxSidePoint(shapeBoxOf(__rigById(id)), name);
0`;



// The angle of a ring's first wall, which is what a turn has to move.
const edgeAngle = s => Math.atan2(s.verts[1].y - s.verts[0].y, s.verts[1].x - s.verts[0].x);
const deg = r => r * 180 / Math.PI;

module.exports = async function transform(rig) {
  const dm = rig.dm;

  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await dm.evaluate(OWN_HELPERS);
  await dm.evaluate('revealCircle(' + CLEAR.x + ',' + CLEAR.y + ',' + CLEAR.r + ');' +
                    'rebuildFogEffect(); fogDirty = true; scheduleRender(); 0');
  await dm.waitFor('fogCoverT === 0 && fogTransRafId === null', 30000, 'the clearing to open');
  const zoom = await dm.evaluate('zoom');
  const tol = 3 / zoom;

  // ══ A. One click draws a box with eight handles ══
  // RED BY DESIGN: written against the fix, never re-proved
  const aRoom = await dm.evaluate('__rigDrawShroud(600, 400, 1000, 700)');
  await dm.evaluate('__rigClick(800, 550); 0');
  rig.check(await dm.evaluate('selectedPolygonId') === aRoom &&
            await dm.evaluate('shapeEditMode') === false,
            'the room was not picked as a whole object, so there is no box to measure');

  const boxA = await dm.evaluate('__rigBox(' + aRoom + ')');
  rig.check(!!boxA, 'a room picked as an object carries no bounding box at all');
  rig.check(Math.abs(boxA.minX - 600) < tol && Math.abs(boxA.minY - 400) < tol &&
            Math.abs(boxA.maxX - 1000) < tol && Math.abs(boxA.maxY - 700) < tol,
            'the box came out as ' + JSON.stringify(boxA) + ' rather than round the room');
  rig.check(await dm.evaluate('boxSidePoints(__rigBox(' + aRoom + ')).length') === 8,
            'the box does not carry eight handles, so a side or a corner cannot be grabbed');

  // The bulge of a bent wall is INSIDE the box. A box off the anchors cuts through it.
  await dm.evaluate('__rigDbl(800, 550); 0');
  await dm.evaluate('__rigDrag(800, 400, 800, 280, { mods: { ctrlKey: true } }); 0');
  await dm.evaluate('__rigKey("Escape"); __rigKey("Escape"); __rigClick(800, 600); 0');
  const bent = await dm.evaluate('__rigShape(' + aRoom + ')');
  const boxBent = await dm.evaluate('__rigBox(' + aRoom + ')');
  rig.check(!!bent.handles && bent.handles.some(h => h),
            'the wall was never bent, so this check is measuring a plain rectangle');
  rig.note('the bent room\'s corners stop at y ' + Math.round(bent.box.y0) +
           ' and its box reaches y ' + Math.round(boxBent.minY));
  rig.check(boxBent.minY < bent.box.y0 - 1,
            'the box stopped at the corners and cut through the bulge of the bent wall');

  // ══ B. A corner handle resizes, and pins the opposite corner ══
  // RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('__rigKey("Escape"); 0');
  const bRoom = await dm.evaluate('__rigDrawShroud(600, 900, 1000, 1200)');
  await dm.evaluate('__rigClick(800, 1050); 0');
  const beforeB = await dm.evaluate('__rigShape(' + bRoom + ')');
  const boxB = await dm.evaluate('__rigBox(' + bRoom + ')');
  const seB = await dm.evaluate('__rigHandle(' + bRoom + ', "se")');
  const targetX = boxB.minX + (boxB.maxX - boxB.minX) * 1.5;
  const targetY = boxB.minY + (boxB.maxY - boxB.minY) * 1.5;
  await dm.evaluate('__rigDrag(' + seB.x + ',' + seB.y + ',' + targetX + ',' + targetY + '); 0');
  const afterB = await dm.evaluate('__rigBox(' + bRoom + ')');
  rig.note('the south-east handle went to ' + Math.round(targetX) + ',' + Math.round(targetY) +
           ' and the box now runs to ' + Math.round(afterB.maxX) + ',' + Math.round(afterB.maxY));
  rig.check(Math.abs(afterB.minX - boxB.minX) < tol && Math.abs(afterB.minY - boxB.minY) < tol,
            'the opposite corner moved during a resize, so the room slid as well as grew');
  rig.check(Math.abs(afterB.maxX - targetX) < 2 * tol && Math.abs(afterB.maxY - targetY) < 2 * tol,
            'the dragged corner ended at ' + Math.round(afterB.maxX) + ',' +
            Math.round(afterB.maxY) + ' rather than under the cursor');
  rig.check((await dm.evaluate('__rigShape(' + bRoom + ')')).verts.length === beforeB.verts.length,
            'the resize changed how many corners the room has');

  // ══ C. Shift holds proportion; a side handle moves one axis ══
  // RED BY DESIGN: written against the fix, never re-proved
  const boxC = await dm.evaluate('__rigBox(' + bRoom + ')');
  const wC = boxC.maxX - boxC.minX, hC = boxC.maxY - boxC.minY;
  const seC = await dm.evaluate('__rigHandle(' + bRoom + ', "se")');
  // Asked for 1.5x across and 1.1x down. Shift takes the larger and applies it to both.
  await dm.evaluate('__rigDrag(' + seC.x + ',' + seC.y + ',' + (boxC.minX + wC * 1.5) + ',' +
                    (boxC.minY + hC * 1.1) + ', { mods: { shiftKey: true } }); 0');
  const afterC = await dm.evaluate('__rigBox(' + bRoom + ')');
  const rx = (afterC.maxX - afterC.minX) / wC, ry = (afterC.maxY - afterC.minY) / hC;
  rig.note('Shift-resize asked for 1.50x by 1.10x and gave ' + rx.toFixed(2) + 'x by ' +
           ry.toFixed(2) + 'x');
  rig.check(Math.abs(rx - ry) < 0.06,
            'Shift gave ' + rx.toFixed(2) + ' across and ' + ry.toFixed(2) + ' down, so it did ' +
            'not hold the room\'s proportion');

  const boxC2 = await dm.evaluate('__rigBox(' + bRoom + ')');
  const eC = await dm.evaluate('__rigHandle(' + bRoom + ', "e")');
  await dm.evaluate('__rigDrag(' + eC.x + ',' + eC.y + ',' + (eC.x + 150) + ',' +
                    (eC.y + 200) + '); 0');
  const afterC2 = await dm.evaluate('__rigBox(' + bRoom + ')');
  rig.check(Math.abs((afterC2.maxY - afterC2.minY) - (boxC2.maxY - boxC2.minY)) < 2 * tol,
            'an east handle changed the room\'s height as well as its width');
  rig.check(afterC2.maxX > boxC2.maxX + tol, 'an east handle did not widen the room at all');

  // ══ D. A handle past its anchor never turns the room inside out ══
  // RED BY DESIGN: written against the fix, never re-proved
  const signD = Math.sign((await dm.evaluate('__rigShape(' + bRoom + ')')).area2);
  const boxD = await dm.evaluate('__rigBox(' + bRoom + ')');
  const seD = await dm.evaluate('__rigHandle(' + bRoom + ', "se")');
  await dm.evaluate('__rigDrag(' + seD.x + ',' + seD.y + ',' + (boxD.minX - 600) + ',' +
                    (boxD.minY - 600) + '); 0');
  const afterD = await dm.evaluate('__rigShape(' + bRoom + ')');
  rig.note('the corner was dragged 600 past its anchor and the room came out ' +
           Math.round(afterD.box.x1 - afterD.box.x0) + ' by ' +
           Math.round(afterD.box.y1 - afterD.box.y0));
  rig.check(Math.sign(afterD.area2) === signD,
            'dragging a handle past its anchor mirrored the room — a reversed ring is what tells ' +
            'a hole from an outline, so the room now reads as the wrong kind of shape');
  rig.check(afterD.box.x1 - afterD.box.x0 > 0.5 && afterD.box.y1 - afterD.box.y0 > 0.5,
            'the room was collapsed to nothing by a resize and can never be grabbed again');

  // ══ E. Turning, around the box centre ══
  // RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('__rigKey("Escape"); 0');
  const eRoom = await dm.evaluate('__rigDrawShroud(1400, 500, 1900, 800)');
  await dm.evaluate('__rigClick(1650, 650); 0');
  const beforeE = await dm.evaluate('__rigShape(' + eRoom + ')');
  const boxE = await dm.evaluate('__rigBox(' + eRoom + ')');
  const cE = { x: (boxE.minX + boxE.maxX) / 2, y: (boxE.minY + boxE.maxY) / 2 };
  const neE = await dm.evaluate('__rigHandle(' + eRoom + ', "ne")');
  // Just OUTSIDE the corner is the turn; a press on the corner itself resizes instead.
  const outE = { x: neE.x + TURN_OFFSET_PX / zoom, y: neE.y - TURN_OFFSET_PX / zoom };
  rig.check(!!(await dm.evaluate('findBoxHandleAt(__rigById(' + eRoom + '), ' + outE.x + ',' +
                                 outE.y + ')') || {}).rotate,
            'the point just outside the corner does not offer the turn, so the drag below would ' +
            'land on bare map and read as a room that never turned');
  const rE = Math.hypot(outE.x - cE.x, outE.y - cE.y);
  const aE = Math.atan2(outE.y - cE.y, outE.x - cE.x) + Math.PI / 6;   // 30 degrees
  await dm.evaluate('__rigDrag(' + outE.x + ',' + outE.y + ',' +
                    (cE.x + rE * Math.cos(aE)) + ',' + (cE.y + rE * Math.sin(aE)) + '); 0');
  const afterE = await dm.evaluate('__rigShape(' + eRoom + ')');
  const turnedE = deg(edgeAngle(afterE) - edgeAngle(beforeE));
  rig.note('the room was turned by 30 degrees and came out ' + turnedE.toFixed(1));
  rig.check(Math.abs(turnedE - 30) < 3,
            'the drag outside the corner turned the room by ' + turnedE.toFixed(1) +
            ' degrees instead of 30');
  rig.check(Math.abs(Math.abs(afterE.area2) - Math.abs(beforeE.area2)) <
            Math.abs(beforeE.area2) * 0.03,
            'turning the room changed its size, so the gesture resizes as well as turns');
  rig.check(afterE.box.x1 - afterE.box.x0 > (beforeE.box.x1 - beforeE.box.x0) + 1,
            'the room\'s footprint on the map is unchanged, so nothing was turned at all');

  // ⚠ 30 SCREEN PIXELS, AND THE NUMBER IS THE CHECK. The turn ring runs to 26px round each
  // corner, so the centre of a box this size is 21px from all four of them and sits inside every
  // one. At 50px it is 35px away, outside them all, and the check passes with the zone unbounded.
  await dm.evaluate('__rigKey("Escape"); 0');
  const tSide = Math.round(30 / zoom);
  const tiny = await dm.evaluate('__rigDrawShroud(700, 700, ' + (700 + tSide) + ', ' +
                                 (700 + tSide) + ')');
  const cT = { x: 700 + Math.round(tSide / 2), y: 700 + Math.round(tSide / 2) };
  await dm.evaluate('__rigClick(' + cT.x + ',' + cT.y + '); 0');
  rig.check(await dm.evaluate('selectedPolygonId') === tiny,
            'the small room was not picked, so the check below measures nothing');
  const beforeT = await dm.evaluate('__rigShape(' + tiny + ')');
  await dm.evaluate('__rigDrag(' + cT.x + ',' + cT.y + ',' + (cT.x + 200) + ',' + cT.y + '); 0');
  const afterT = await dm.evaluate('__rigShape(' + tiny + ')');
  const tdx = afterT.verts[0].x - beforeT.verts[0].x;
  const tdy = afterT.verts[0].y - beforeT.verts[0].y;
  rig.note('a press in the middle of a 30px box moved the room +' + tdx.toFixed(1) + ',+' +
           tdy.toFixed(1) + ' against the 200,0 it was dragged');
  rig.check(Math.abs(tdx - 200) < 2 * tol && Math.abs(tdy) < 2 * tol,
            'a drag from the middle of a small room turned it instead of moving it, so a room ' +
            'that size can never be put anywhere');
  await dm.evaluate('__rigKey("Escape"); __rigClick(' + (cT.x + 200) + ',' + cT.y + ');' +
                    ' __rigKey("Delete"); 0');

  // ══ F. Shift snaps the turn to fifteen degrees ══
  // RED BY DESIGN: written against the fix, never re-proved
  // ⚠ PICKED AGAIN FIRST. The small-room check above selects and deletes a room of its own,
  // and a press on a handle of an UNSELECTED room falls through to the map and reads as a turn
  // of zero degrees. Its centre is unmoved by E, which turned it about that point.
  await dm.evaluate('__rigClick(1650, 650); 0');
  rig.check(await dm.evaluate('selectedPolygonId') === eRoom,
            'the turned room could not be picked again, so F would measure a room nobody held');
  const beforeF = await dm.evaluate('__rigShape(' + eRoom + ')');
  const boxF = await dm.evaluate('__rigBox(' + eRoom + ')');
  const cF = { x: (boxF.minX + boxF.maxX) / 2, y: (boxF.minY + boxF.maxY) / 2 };
  const neF = await dm.evaluate('__rigHandle(' + eRoom + ', "ne")');
  const outF = { x: neF.x + TURN_OFFSET_PX / zoom, y: neF.y - TURN_OFFSET_PX / zoom };
  const rF = Math.hypot(outF.x - cF.x, outF.y - cF.y);
  const aF = Math.atan2(outF.y - cF.y, outF.x - cF.x) + 22 * Math.PI / 180;  // 22 asked, 15 due
  await dm.evaluate('__rigDrag(' + outF.x + ',' + outF.y + ',' +
                    (cF.x + rF * Math.cos(aF)) + ',' + (cF.y + rF * Math.sin(aF)) +
                    ', { mods: { shiftKey: true } }); 0');
  rig.check(await dm.evaluate('selectedPolygonId') === eRoom,
            'the Shift-held press let go of the room, so it missed the turn ring and the angle ' +
            'below is measuring a room nobody touched');
  const afterF = await dm.evaluate('__rigShape(' + eRoom + ')');
  const turnedF = deg(edgeAngle(afterF) - edgeAngle(beforeF));
  rig.note('Shift-turn asked for 22 degrees and gave ' + turnedF.toFixed(2));
  rig.check(Math.abs(turnedF - 15) < 1.5,
            'a Shift-held turn of 22 degrees landed on ' + turnedF.toFixed(2) +
            ' rather than snapping to 15');

  // ══ G. A curve and a door ride the transform ══
  // RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('__rigKey("Escape"); 0');
  const gRoom = await dm.evaluate('__rigDrawShroud(500, 1000, 900, 1300)');
  await dm.evaluate('setShape("door"); __rigClick(700, 1000); setShape("select"); 0');
  await dm.evaluate('__rigDbl(700, 1150); 0');
  await dm.evaluate('__rigDrag(500, 1150, 380, 1150, { mods: { ctrlKey: true } }); 0');   // bend the left wall
  await dm.evaluate('__rigKey("Escape"); __rigKey("Escape"); __rigClick(700, 1150); 0');
  const beforeG = await dm.evaluate('__rigShape(' + gRoom + ')');
  rig.check(beforeG.doors.length === 1,
            'the door tool placed ' + beforeG.doors.length + ' doors, so G is testing nothing');
  rig.check(!!beforeG.handles && beforeG.handles.some(h => h),
            'the left wall was never bent, so G is testing nothing');

  const boxG = await dm.evaluate('__rigBox(' + gRoom + ')');
  const seG = await dm.evaluate('__rigHandle(' + gRoom + ', "se")');
  await dm.evaluate('__rigDrag(' + seG.x + ',' + seG.y + ',' +
                    (boxG.minX + (boxG.maxX - boxG.minX) * 2) + ',' +
                    (boxG.minY + (boxG.maxY - boxG.minY) * 2) + '); 0');
  const afterG = await dm.evaluate('__rigShape(' + gRoom + ')');
  rig.check(afterG.doors.length === 1 &&
            afterG.doors[0].edge === beforeG.doors[0].edge &&
            Math.abs(afterG.doors[0].t - beforeG.doors[0].t) < 0.001,
            'the resize moved the door onto another wall, or along the one it was on');
  rig.check(!!afterG.doors[0].pt && !!beforeG.doors[0].pt &&
            Math.abs(afterG.doors[0].pt.x - beforeG.doors[0].pt.x) > tol,
            'the door stayed at its old map point while its wall moved away from under it');
  const bendBefore = beforeG.handles.find(h => h);
  const bendAfter = afterG.handles ? afterG.handles.find(h => h) : null;
  rig.check(!!bendAfter,
            'the resize straightened the bent wall, so a curved room cannot be resized at all');
  rig.check(Math.hypot(bendAfter.ox, bendAfter.oy) + Math.hypot(bendAfter.ix, bendAfter.iy) >
            (Math.hypot(bendBefore.ox, bendBefore.oy) + Math.hypot(bendBefore.ix, bendBefore.iy)) * 1.5,
            'the wall kept its old bend depth through a doubling, so the curve did not grow with ' +
            'the room and the outline no longer matches the box');

  // ══ H. A hole gets a box of its own, and stops where it would leave its room ══
  // RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('__rigKey("Escape"); 0');
  const keep = await dm.evaluate('__rigDrawShroud(1300, 950, 1900, 1350)');
  await dm.evaluate('__rigOpRect("trim", 1500, 1080, 1700, 1220)');
  const hBefore = await dm.evaluate('__rigShape(' + keep + ')');
  rig.check(!!hBefore && hBefore.holes === 1,
            'the trim left ' + (hBefore ? hBefore.holes : 'no') + ' hole, so H is testing nothing');

  await dm.evaluate('__rigDbl(1350, 1000); 0');
  await dm.evaluate('__rigClick(1600, 1150); 0');
  rig.check(await dm.evaluate('selectedHoleIndex') === 0,
            'clicking inside the courtyard did not pick it');
  const boxH = await dm.evaluate('__rigBox(' + keep + ')');
  rig.check(!!boxH && boxH.hole === 0,
            'a picked hole carries no box of its own, so it can only ever be moved');
  rig.check(boxH.minX > hBefore.box.x0 + 1 && boxH.maxX < hBefore.box.x1 - 1,
            'the box on a picked hole was drawn round the whole keep instead of round the hole');

  // NO HIDDEN GRABS. The keep's own corners and walls are off screen at this level, so a
  // press on one has to reach nothing at all.
  const keepCorner = hBefore.verts[0];
  rig.check(await dm.evaluate('findVertexAt(__rigById(' + keep + '), ' + keepCorner.x + ',' +
                              keepCorner.y + ')') === -1 &&
            await dm.evaluate('findEdgeAt(__rigById(' + keep + '), ' + keepCorner.x + ',' +
                              ((hBefore.box.y0 + hBefore.box.y1) / 2) + ')') === -1,
            'the keep corners and walls still answer while its courtyard wears a box, so the ' +
            'DM reshapes the room by pressing on a dot the app draws nowhere');

  const seH = await dm.evaluate('__rigHandle(' + keep + ', "se")');
  await dm.evaluate('__rigDrag(' + seH.x + ',' + seH.y + ', 3000, 2000, { steps: 24 }); 0');
  const afterH = await dm.evaluate('__rigShape(' + keep + ')');
  rig.check(afterH.holes === 1, 'resizing the courtyard lost it entirely');
  rig.check(Math.sign(afterH.holeArea2[0]) === Math.sign(hBefore.holeArea2[0]),
            'resizing the courtyard reversed its winding, so it stopped reading as a hole');
  rig.check(Math.abs(afterH.holeArea2[0]) > Math.abs(hBefore.holeArea2[0]) * 1.05,
            'the courtyard was refused on every frame and never grew at all');
  const hc = { x: (afterH.holeBox[0].x0 + afterH.holeBox[0].x1) / 2,
               y: (afterH.holeBox[0].y0 + afterH.holeBox[0].y1) / 2 };
  rig.note('the courtyard was resized towards 3000,2000 and its centre stopped at ' +
           Math.round(hc.x) + ',' + Math.round(hc.y) + ' inside a keep reaching ' +
           Math.round(afterH.box.x1) + ',' + Math.round(afterH.box.y1));
  rig.check(hc.x <= afterH.box.x1 && hc.y <= afterH.box.y1 &&
            hc.x >= afterH.box.x0 && hc.y >= afterH.box.y0,
            'the courtyard was resized clean off the keep it belongs to, which is the one thing ' +
            'the gesture must refuse');

  // ══ I. A boxed hole opens for editing on one more double-click ══
  // RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('__rigDbl(' + Math.round(hc.x) + ',' + Math.round(hc.y) + '); 0');
  rig.check(await dm.evaluate('holeEditMode') === true &&
            await dm.evaluate('selectedHoleIndex') === 0,
            'a double-click inside a boxed courtyard did not open it, so its corners are the ' +
            'only ones in the app the DM cannot reach');
  rig.check(await dm.evaluate('__rigBox(' + keep + ')') === null,
            'the box stayed on screen beside the courtyard\'s own corners — the two levels are ' +
            'never live at once');
  const outerCorner = (await dm.evaluate('__rigShape(' + keep + ')')).verts[0];
  rig.check(await dm.evaluate('findVertexAt(__rigById(' + keep + '), ' + outerCorner.x + ',' +
                              outerCorner.y + ')') === -1,
            'the keep\'s own corners still answer while its courtyard is open for editing, so ' +
            'two rings\' vertices sit on top of each other');
  // The first thing anyone does at this level, and it must not close it.
  const holeCorner = (await dm.evaluate('__rigShape(' + keep + ')')).holeBox[0];
  await dm.evaluate('__rigClick(' + holeCorner.x0 + ',' + holeCorner.y0 + '); 0');
  rig.check(await dm.evaluate('selectedVertexIndex') >= 0,
            'pressing one of the courtyard own corners did not take it');
  rig.check(await dm.evaluate('holeEditMode') === true &&
            await dm.evaluate('selectedHoleIndex') === 0,
            'pressing a corner of the open courtyard closed the level it was open on, so the ' +
            'rest of its corners stop answering mid-edit');

  await dm.evaluate('__rigKey("Escape"); __rigKey("Escape"); 0');
  rig.check(await dm.evaluate('holeEditMode') === false &&
            await dm.evaluate('selectedHoleIndex') === 0,
            'Escape let go of the courtyard as well as closing it — it peels back one level at ' +
            'a time');
  rig.check(!!(await dm.evaluate('__rigBox(' + keep + ')')),
            'the courtyard\'s box did not come back when its editing closed');

  // ══ J. One transform, one undo step ══
  // RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('__rigKey("Escape"); __rigKey("Escape"); __rigKey("Escape"); 0');
  await dm.evaluate('__rigClick(1650, 650); 0');
  rig.check(await dm.evaluate('selectedPolygonId') === eRoom,
            'the turned room could not be picked again, so J is measuring another room');
  const beforeJ = await dm.evaluate('__rigShape(' + eRoom + ')');
  const undoJ = await dm.evaluate('undoStack.length');
  const boxJ = await dm.evaluate('__rigBox(' + eRoom + ')');
  const seJ = await dm.evaluate('__rigHandle(' + eRoom + ', "se")');
  await dm.evaluate('__rigDrag(' + seJ.x + ',' + seJ.y + ',' +
                    (boxJ.minX + (boxJ.maxX - boxJ.minX) * 1.6) + ',' +
                    (boxJ.minY + (boxJ.maxY - boxJ.minY) * 1.6) + '); 0');
  const spentJ = await dm.evaluate('undoStack.length') - undoJ;
  rig.note('a resize of eight moves spent ' + spentJ + ' undo step(s)');
  rig.check(spentJ === 1,
            'one resize spent ' + spentJ + ' undo steps, so taking it back needs that many ' +
            'presses of Ctrl+Z');
  await dm.evaluate('undo(); 0');
  await dm.evaluate(lib.SETTLE);
  const undoneJ = await dm.evaluate('__rigShape(' + eRoom + ')');
  rig.check(undoneJ.verts.every((v, i) => Math.abs(v.x - beforeJ.verts[i].x) < 0.01 &&
                                          Math.abs(v.y - beforeJ.verts[i].y) < 0.01),
            'one undo did not put the resized room back where it was');

  // A press that only PICKS a handle spends nothing, exactly as a body drag does not.
  await dm.evaluate('__rigClick(1650, 650); 0');
  const idleJ = await dm.evaluate('undoStack.length');
  const seJ2 = await dm.evaluate('__rigHandle(' + eRoom + ', "se")');
  await dm.evaluate('__rigMouse("mousedown", ' + seJ2.x + ',' + seJ2.y + ');' +
                    ' __rigMouse("mouseup", ' + seJ2.x + ',' + seJ2.y + '); 0');
  rig.check(await dm.evaluate('undoStack.length') === idleJ,
            'pressing a handle without moving it spent an undo step the DM never earned');

  // ══ K. It reaches the TV ══
  // RED BY DESIGN: written against the fix, never re-proved
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen && !!fogDataCanvas', 45000, 'the Player to receive the map');
  await player.waitFor('fogCoverT === 0', 45000, 'the scene cover to lift on the Player');

  // A small room in a clean patch of the clearing, and a probe on open ground beside it.
  const kRoom = await dm.evaluate('__rigDrawShroud(1000, 600, 1200, 780)');
  const PROBE = { x: 1300, y: 700 };
  await dm.evaluate(lib.SETTLE);
  rig.check(await dm.evaluate('__rigFog(' + PROBE.x + ',' + PROBE.y + ')') < 60,
            'the ground the resize has to swallow is already hidden on the DM, so growing a ' +
            'shroud room over it would prove nothing');
  try { await player.waitFor(lib.TV_FOG + '(' + PROBE.x + ',' + PROBE.y + ') < 60', 30000,
                             'the Player to show that ground open'); } catch (_) {}

  await dm.evaluate('__rigClick(1100, 690); 0');
  const boxK = await dm.evaluate('__rigBox(' + kRoom + ')');
  const seK = await dm.evaluate('__rigHandle(' + kRoom + ', "se")');
  await dm.evaluate('__rigDrag(' + seK.x + ',' + seK.y + ',' + (PROBE.x + 120) + ',' +
                    (boxK.maxY + 120) + '); 0');
  await dm.evaluate(lib.SETTLE);
  rig.check(await dm.evaluate('__rigFog(' + PROBE.x + ',' + PROBE.y + ')') > 200,
            'the DM\'s own fog did not follow the resize, so nothing could reach the TV');
  try { await player.waitFor(lib.TV_FOG + '(' + PROBE.x + ',' + PROBE.y + ') > 200', 30000,
                             'the resized room to reach the Player'); } catch (_) {}
  const tv = await player.evaluate(lib.TV_FOG + '(' + PROBE.x + ',' + PROBE.y + ')');
  rig.note('the ground the resize swallowed reads alpha ' + tv + ' on the TV');
  rig.check(tv > 200,
            'the players still see open ground where the DM grew a shroud room over it, so the ' +
            'whole gesture stops at the DM window');
};
