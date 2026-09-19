'use strict';

// editing.js — THE EDITING FEATURE, whole.
//
// THE GOAL OF THIS FEATURE: the DM picks a room already on the map, changes it any way the app
// allows, and the players see the change. Every check below serves that sentence.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks directly beneath it, in order.
//
//   A. The Select tool picks a room, and picks the right one.
//        clicking inside · clicking empty map · overlapping rooms
//   A2. ONE CLICK picks the room whole; a DOUBLE-CLICK opens it for editing. The two levels are
//       never live at once, and Escape climbs one of them per press.
//        no corner is reachable at the object level · a double-click puts one in reach ·
//        Escape drops the corner, then edit mode, then the room
//   B. Every geometry edit changes the room it was aimed at, and only that one.
//        move the body · drag a vertex · drag an edge · delete a vertex, and be refused the
//        deletion that would take a room below three corners
//   C. An edit that starts on the map finishes wherever the mouse ends up.
//   D. Editing does not spend undo the DM has not earned, and undo puts the room back. A press
//      that only PICKS something spends no fog crossfade either.
//   E. A room's fog mode can be changed after the fact, and it cycles rather than toggles.
//   F. Corner radius reshapes the fog, not just the outline.
//   G. Deleting removes the room and its fog together.
//   H. EVERY ONE OF THOSE REACHES THE TV. A room the DM edited that the players still see in its
//      old place is the failure this feature exists to prevent.
//   I. What must NOT reach the TV still does not: a room's name and notes are the DM's alone.
//
//
// ⚠ THE MAP STARTS FULLY FOGGED. Every room edited here is a SHROUD room drawn inside a
// revealed clearing, so moving it has somewhere to move away from — on untouched map a shroud
// room changes nothing and every check passes without the app doing anything.
//
// ⚠ CLIENT COORDINATES ARE INTEGERS. MouseEvent.clientX/Y truncate, so a map coordinate makes
// the round trip with up to 1/zoom of error. Geometric checks here carry a tolerance derived
// from the live zoom; a run failing by half a unit is telling you about the tolerance.

const lib = require('../../lib');

const MAP_W = 2400, MAP_H = 1500;
const CLEAR = { x: 1200, y: 700, r: 900 };     // the clearing everything is edited inside




module.exports = async function editing(rig) {
  const dm = rig.dm;

  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await dm.evaluate('revealCircle(' + CLEAR.x + ',' + CLEAR.y + ',' + CLEAR.r + ');' +
                    'rebuildFogEffect(); fogDirty = true; scheduleRender(); 0');
  await dm.waitFor('fogCoverT === 0 && fogTransRafId === null', 30000, 'the clearing to open');
  const tol = 3 / (await dm.evaluate('zoom'));

  // ══ A. The Select tool picks a room, and picks the right one ══
  const a1 = await dm.evaluate('__rigDrawShroud(600, 400, 900, 700)');
  await dm.evaluate('__rigClick(750, 550); 0');
  rig.check(await dm.evaluate('selectedPolygonId') === a1,
            'clicking inside a room did not select it');

  // Clicking bare map lets go. Without this the card would stay open over the map forever.
  await dm.evaluate('__rigClick(1800, 1350); 0');
  rig.check(await dm.evaluate('selectedPolygonId') === null,
            'clicking empty map did not deselect the room');

  // Overlapping rooms: the LAST drawn wins. Array order is fog compositing precedence
  // (CLAUDE.md), so the room painted on top is the one the click belongs to.
  const a2 = await dm.evaluate('__rigDrawShroud(800, 500, 1100, 800)');
  await dm.evaluate('__rigClick(850, 650); 0');   // inside both a1 and a2
  rig.check(await dm.evaluate('selectedPolygonId') === a2,
            'clicking where two rooms overlap selected the one UNDERNEATH, so the DM edits a ' +
            'room they cannot see the edge of');

  // ══ A2. One click picks the room whole; a double-click opens it for editing ══
  rig.check(await dm.evaluate('shapeEditMode') === false,
            'one click opened the room for editing — a click picks it as a whole object, and ' +
            'its corners are not reachable until a double-click asks for them');

  // AT THE OBJECT LEVEL a corner is not a target. A press there takes the bounding box handle
  // sitting on it, and going nowhere writes nothing - see transform.js for what a drag does.
  const corner = await dm.evaluate('__rigById(' + a2 + ').vertices[0]');
  await dm.evaluate('__rigMouse("mousedown", ' + corner.x + ',' + corner.y + ');' +
                    ' __rigMouse("mouseup", ' + corner.x + ',' + corner.y + '); 0');
  rig.check(await dm.evaluate('selectedVertexIndex') === -1,
            'pressing a corner took the corner while the room was picked as a whole object, so ' +
            'the two levels are live at once and the vertices sit under everything else');

  await dm.evaluate('__rigDbl(850, 650); 0');
  rig.check(await dm.evaluate('shapeEditMode') === true &&
            await dm.evaluate('selectedPolygonId') === a2,
            'a double-click on a room did not open it for editing');

  // NOW the corner is a target.
  const corner2 = await dm.evaluate('__rigById(' + a2 + ').vertices[0]');
  await dm.evaluate('__rigMouse("mousedown", ' + corner2.x + ',' + corner2.y + ');' +
                    ' __rigMouse("mouseup", ' + corner2.x + ',' + corner2.y + '); 0');
  rig.check(await dm.evaluate('selectedVertexIndex') === 0,
            'pressing a corner inside edit mode did not take it, so a reshape would move the ' +
            'whole room instead');

  // Escape climbs exactly one level per press, and never two.
  await dm.evaluate('__rigKey("Escape"); 0');
  rig.check(await dm.evaluate('selectedVertexIndex') === -1 &&
            await dm.evaluate('shapeEditMode') === true &&
            await dm.evaluate('selectedPolygonId') === a2,
            'Escape on a picked corner left edit mode as well — it peels back one level at a time');
  await dm.evaluate('__rigKey("Escape"); 0');
  rig.check(await dm.evaluate('shapeEditMode') === false &&
            await dm.evaluate('selectedPolygonId') === a2,
            'Escape let go of the whole room instead of just edit mode');
  await dm.evaluate('__rigKey("Escape"); 0');
  rig.check(await dm.evaluate('selectedPolygonId') === null,
            'Escape at the object level did not let go of the room');

  // Every geometry check below edits corners and walls, so it runs inside edit mode.
  await dm.evaluate('__rigDbl(850, 650); 0');

  // ══ B. Every geometry edit changes the room it was aimed at, and only that one ══
  // B1 — moving the body.
  const beforeMove = await dm.evaluate('__rigById(' + a2 + ').vertices.map(v => ({x:v.x, y:v.y}))');
  const otherBefore = await dm.evaluate('JSON.stringify(__rigById(' + a1 + ').vertices)');
  await dm.evaluate('__rigClick(1000, 750); 0');    // inside a2 only
  rig.check(await dm.evaluate('selectedPolygonId') === a2, 'the room to move was not selected');
  await dm.evaluate('__rigDrag(1000, 750, 1150, 850); 0');
  const afterMove = await dm.evaluate('__rigById(' + a2 + ').vertices');
  const dx = afterMove[0].x - beforeMove[0].x, dy = afterMove[0].y - beforeMove[0].y;
  rig.note('body drag asked for +150,+100 and moved +' + dx.toFixed(1) + ',+' + dy.toFixed(1));
  rig.check(Math.abs(dx - 150) < tol && Math.abs(dy - 100) < tol,
            'dragging the body moved the room by ' + dx.toFixed(1) + ',' + dy.toFixed(1) +
            ' instead of 150,100');
  rig.check(afterMove.every((v, i) => Math.abs((v.x - beforeMove[i].x) - dx) < 0.001 &&
                                      Math.abs((v.y - beforeMove[i].y) - dy) < 0.001),
            'the room was reshaped by a body drag rather than moved as one piece');
  rig.check(await dm.evaluate('JSON.stringify(__rigById(' + a1 + ').vertices)') === otherBefore,
            'moving one room moved another one with it');

  // B2 — dragging a vertex reshapes that room alone, and moves ONLY that vertex.
  const v0 = await dm.evaluate('__rigById(' + a2 + ').vertices[0]');
  const restBefore = await dm.evaluate(
    'JSON.stringify(__rigById(' + a2 + ').vertices.slice(1))');
  await dm.evaluate('__rigDrag(' + v0.x + ',' + v0.y + ',' +
                    (v0.x - 130) + ',' + (v0.y - 90) + '); 0');
  const v0After = await dm.evaluate('__rigById(' + a2 + ').vertices[0]');
  rig.check(Math.abs(v0After.x - (v0.x - 130)) < tol && Math.abs(v0After.y - (v0.y - 90)) < tol,
            'dragging a corner did not take it where it was dragged');
  rig.check(await dm.evaluate('JSON.stringify(__rigById(' + a2 + ').vertices.slice(1))') === restBefore,
            'dragging one corner moved the room\'s other corners as well');

  // B3 — dragging an EDGE moves both its ends, perpendicular to itself, and nothing else.
  const verts = await dm.evaluate('__rigById(' + a2 + ').vertices');
  const e0 = verts[0], e1 = verts[1];
  const midX = (e0.x + e1.x) / 2, midY = (e0.y + e1.y) / 2;
  await dm.evaluate('__rigDrag(' + midX + ',' + midY + ',' + midX + ',' + (midY - 120) + '); 0');
  const afterEdge = await dm.evaluate('__rigById(' + a2 + ').vertices');
  rig.check(Math.abs(afterEdge[0].y - e0.y) > 20 && Math.abs(afterEdge[1].y - e1.y) > 20,
            'dragging an edge did not move both of its ends');
  rig.check(Math.abs(afterEdge[2].x - verts[2].x) < 0.001 &&
            Math.abs(afterEdge[2].y - verts[2].y) < 0.001,
            'dragging an edge moved a corner that is not on it');

  // B4 — Delete on a selected corner removes that corner, and REFUSES on a triangle. A polygon
  // cannot go below three corners and still be a shape.
  const nBefore = await dm.evaluate('__rigById(' + a2 + ').vertices.length');
  const c0 = await dm.evaluate('__rigById(' + a2 + ').vertices[0]');
  await dm.evaluate('__rigMouse("mousedown", ' + c0.x + ',' + c0.y + ');' +
                    ' __rigMouse("mouseup", ' + c0.x + ',' + c0.y + '); 0');
  rig.check(await dm.evaluate('selectedVertexIndex') === 0, 'the corner to delete was not taken');
  await dm.evaluate('__rigKey("Delete"); 0');
  rig.check(await dm.evaluate('__rigById(' + a2 + ').vertices.length') === nBefore - 1,
            'Delete on a selected corner did not remove it');

  // The refusal, reached the way a DM reaches it: keep deleting corners off a rectangle until
  // only three are left, then ask once more. Editing the vertex array by hand instead would
  // leave the click landing outside whatever shape that produced.
  const tri = await dm.evaluate('__rigDrawShroud(1500, 950, 1750, 1200)');
  await dm.evaluate('__rigDbl(1620, 1080); 0');
  rig.check(await dm.evaluate('selectedPolygonId') === tri && await dm.evaluate('shapeEditMode'),
            'the room to whittle was not open for editing');
  for (let i = 0; i < 3; i++) {
    const tv = await dm.evaluate('__rigById(' + tri + ').vertices[0]');
    await dm.evaluate('__rigMouse("mousedown", ' + tv.x + ',' + tv.y + ');' +
                      ' __rigMouse("mouseup", ' + tv.x + ',' + tv.y + '); __rigKey("Delete"); 0');
  }
  const triLeft = await dm.evaluate(
    '(() => { const p = __rigById(' + tri + '); return p ? p.vertices.length : 0; })()');
  rig.note('a rectangle asked to give up four corners kept ' + triLeft);
  rig.check(triLeft === 3,
            'whittling a room past three corners left it with ' + triLeft + ' — a room below ' +
            'three corners is not a shape and paints no fog');

  // ══ C. An edit that starts on the map finishes wherever the mouse ends up ══
  // ⚠ THE BOTTOM TOOLBAR FLOATS OVER THE MAP, so a drag along the lower edge crosses it on
  // nearly every stroke. A release the map never hears has to commit all the same.
  await dm.evaluate('__rigClick(1150, 850); 0');
  const beforeOff = await dm.evaluate('__rigById(' + a2 + ').vertices[0].x');
  await dm.evaluate('__rigDrag(1150, 850, 1250, 900, { onWindow: true }); 0');   // released on window
  const afterOff = await dm.evaluate('__rigById(' + a2 + ').vertices[0].x');
  rig.check(Math.abs((afterOff - beforeOff) - 100) < tol,
            'a drag released off the map was abandoned instead of committed — the room snapped ' +
            'back and the DM loses the edit');

  // ══ D. Editing does not spend undo the DM has not earned ══
  // ⚠ SELECTING IS A CLICK THAT MOVES NOTHING. Pushing undo on mousedown spent one Ctrl+Z and a
  // full fog-canvas clone on every selection, so the DM pressed undo and watched nothing happen.
  await dm.evaluate('__rigClick(1800, 1350); 0');       // deselect first
  const undoBefore = await dm.evaluate('undoStack.length');
  await dm.evaluate('__rigClick(1150, 850); 0');        // a pure selection
  rig.check(await dm.evaluate('undoStack.length') === undoBefore,
            'selecting a room spent an undo step, so the DM\'s next undo does nothing visible');

  // ⚠ A PICK IS NOT AN EDIT ON THE FOG SIDE EITHER. Committing a press that moved nothing runs
  // startFogTransition and pushes the scene to the Player, which is a full fog rebuild per click.
  // fogTransRafId is what a started crossfade leaves behind.
  await dm.evaluate('__rigDbl(1150, 850); 0');
  await dm.waitFor('fogTransRafId === null', 15000, 'the crossfade from the last edit to finish');
  const pickVert = await dm.evaluate('__rigById(' + a2 + ').vertices[0]');
  await dm.evaluate('__rigMouse("mousedown", ' + pickVert.x + ',' + pickVert.y + ');' +
                    ' __rigMouse("mouseup", ' + pickVert.x + ',' + pickVert.y + '); 0');
  rig.check(await dm.evaluate('selectedVertexIndex') === 0, 'the corner to pick was not taken');
  rig.check(await dm.evaluate('fogTransRafId') === null,
            'picking a corner started a fog crossfade, so every click on a handle rebuilds the ' +
            'whole fog canvas and re-sends the scene to the Player');
  await dm.evaluate('__rigKey("Escape"); __rigKey("Escape"); 0');

  // And a real edit DOES earn one, and undo puts the room back where it was.
  const preEdit = await dm.evaluate('__rigById(' + a2 + ').vertices[0].x');
  await dm.evaluate('__rigDrag(1150, 850, 1300, 850); 0');
  rig.check(await dm.evaluate('undoStack.length') > undoBefore,
            'moving a room did not push an undo step, so the move cannot be taken back');
  await dm.evaluate('undo(); 0');
  const undone = await dm.evaluate('__rigById(' + a2 + ').vertices[0].x');
  rig.check(Math.abs(undone - preEdit) < tol,
            'undo did not put the room back where it was (x ' + undone.toFixed(1) +
            ' against ' + preEdit.toFixed(1) + ')');

  // ══ E. A room's fog mode changes after the fact, and it CYCLES ══
  // ⚠ THREE STATES, NOT A TOGGLE. A two-way toggle on a half room would send it to shroud with
  // no keyboard route back, so the key could leave a state it cannot reach.
  await dm.evaluate('__rigClick(1150, 850); 0');
  const seen = [];
  for (let i = 0; i < 4; i++) {
    seen.push(await dm.evaluate('__rigById(' + a2 + ').mode'));
    await dm.evaluate('__rigKey("KeyT"); 0');
  }
  rig.note('fog mode cycle from the map: ' + seen.join(' → '));
  rig.check(seen[0] === 'shroud' && seen[1] === 'half' && seen[2] === 'reveal' && seen[3] === 'shroud',
            'the fog mode did not cycle shroud → half → reveal → shroud: ' + seen.join(' → '));

  // ══ F. Corner radius reshapes the FOG, not just the outline ══
  // Sampled hard in the corner, where a radius cuts the shape away. The room is put back to
  // shroud first so the corner has fog in it to lose.
  // ⚠ A FRESH ROOM IN CLEAN GROUND, not the one edited above. That one has been moved, reshaped
  // and had a corner removed, so which vertex is its top-left is anyone's guess and a sample
  // offset from vertex 0 can land outside it entirely.
  const RC = { x1: 1450, y1: 350, x2: 1680, y2: 580 };
  const rounded = await dm.evaluate('__rigDrawShroud(' + RC.x1 + ',' + RC.y1 + ',' +
                                    RC.x2 + ',' + RC.y2 + ')');
  await dm.evaluate('__rigClick(' + ((RC.x1 + RC.x2) / 2) + ',' + ((RC.y1 + RC.y2) / 2) + '); 0');
  rig.check(await dm.evaluate('selectedPolygonId') === rounded,
            'the room to round was not selected, so its card is closed and the radius field is ' +
            'not on screen');
  await dm.evaluate(lib.SETTLE);
  const inCorner = { x: RC.x1 + 14, y: RC.y1 + 14 };
  const cornerBefore = await dm.evaluate('__rigFog(' + inCorner.x + ',' + inCorner.y + ')');
  await dm.evaluate('(() => { const n = document.getElementById("rp-radius-num");' +
                    ' n.value = 110; n.dispatchEvent(new Event("input", { bubbles: true }));' +
                    ' return 0; })()');
  await dm.evaluate(lib.SETTLE);
  const cornerAfter = await dm.evaluate('__rigFog(' + inCorner.x + ',' + inCorner.y + ')');
  rig.note('fog in the corner — sharp ' + cornerBefore + ', rounded ' + cornerAfter);
  rig.check(cornerBefore > 200,
            'the corner under test had no fog to begin with (alpha ' + cornerBefore + '), so ' +
            'rounding it proves nothing');
  rig.check(cornerAfter < cornerBefore - 60,
            'rounding the corner left the fog square (alpha ' + cornerBefore + ' → ' +
            cornerAfter + ') — the outline rounded but the fog the players see did not');

  // ══ G. Deleting removes the room and its fog together ══
  const doomed = await dm.evaluate('__rigDrawShroud(700, 900, 950, 1100)');
  await dm.evaluate(lib.SETTLE);
  rig.check(await dm.evaluate('__rigFog(820, 1000)') > 200, 'the room to delete painted no fog');
  await dm.evaluate('__rigClick(820, 1000); __rigKey("Delete"); 0');
  await dm.evaluate(lib.SETTLE);
  rig.check(await dm.evaluate('!__rigById(' + doomed + ')'), 'Delete did not remove the room');
  rig.check(await dm.evaluate('__rigFog(820, 1000)') < 60,
            'the deleted room left its fog behind, so the players still cannot see ground the ' +
            'DM uncovered');

  // ══ H. Every one of those reaches the TV ══
  rig.check(await dm.evaluate('autoSync === true'),
            'auto-sync is off, so no edit could reach the Player and the checks below would be ' +
            'reading the TV\'s own starting state');
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen && !!fogDataCanvas', 45000, 'the Player to receive the map');
  await player.waitFor('fogCoverT === 0', 45000, 'the scene cover to lift on the Player');

  // One room, in a clean patch of the clearing, moved after the Player is watching.
  const tracked = await dm.evaluate('__rigDrawShroud(1700, 400, 1950, 650)');
  const WAS = { x: 1820, y: 520 }, WENT = { x: 2120, y: 520 };
  await dm.evaluate(lib.SETTLE);
  try { await player.waitFor(lib.TV_FOG + '(' + WAS.x + ',' + WAS.y + ') > 200', 30000,
                             'the new room to reach the Player'); } catch (_) {}
  rig.check(await player.evaluate(lib.TV_FOG + '(' + WAS.x + ',' + WAS.y + ')') > 200,
            'a room drawn while the Player was open never reached the TV');

  await dm.evaluate('__rigClick(' + WAS.x + ',' + WAS.y + '); 0');
  await dm.evaluate('__rigDrag(' + WAS.x + ',' + WAS.y + ',' + WENT.x + ',' + WENT.y + '); 0');
  await dm.evaluate(lib.SETTLE);
  try { await player.waitFor(lib.TV_FOG + '(' + WENT.x + ',' + WENT.y + ') > 200', 30000,
                             'the moved room to reach the Player'); } catch (_) {}
  const moved = await player.evaluate(
    '({ was: ' + lib.TV_FOG + '(' + WAS.x + ',' + WAS.y + '),' +
    '   now: ' + lib.TV_FOG + '(' + WENT.x + ',' + WENT.y + ') })');
  rig.note('TV after the move — where it was ' + moved.was + ', where it went ' + moved.now);
  rig.check(moved.now > 200, 'moving a room did not carry its fog to the new ground on the TV');
  rig.check(moved.was < 60,
            'the ground the room moved OFF is still hidden on the TV (alpha ' + moved.was +
            ') — the shroud was left behind and the table loses map the DM uncovered');

  // A mode change reaches the TV too. Shroud → reveal is the case that gives ground BACK.
  await dm.evaluate('__rigKey("KeyT"); 0');   // shroud → half
  await dm.evaluate('__rigKey("KeyT"); 0');   // half → reveal
  rig.check(await dm.evaluate('__rigById(' + tracked + ').mode') === 'reveal',
            'the room under test is not in Reveal mode, so the TV check below means nothing');
  await dm.evaluate(lib.SETTLE);
  try { await player.waitFor(lib.TV_FOG + '(' + WENT.x + ',' + WENT.y + ') < 60', 30000,
                             'the mode change to reach the Player'); } catch (_) {}
  rig.check(await player.evaluate(lib.TV_FOG + '(' + WENT.x + ',' + WENT.y + ')') < 60,
            'changing a room from Shroud to Reveal did not clear that ground on the TV');

  // Deleting reaches it as well.
  await dm.evaluate('__rigClick(' + WENT.x + ',' + WENT.y + '); __rigKey("Delete"); 0');
  await dm.evaluate(lib.SETTLE);
  rig.check(await dm.evaluate('!__rigById(' + tracked + ')'), 'the tracked room was not deleted');

  // ══ I. What must NOT reach the TV still does not ══
  const keep = await dm.evaluate('__rigDrawShroud(350, 950, 600, 1150)');
  await dm.evaluate('__rigClick(470, 1050); 0');
  // ⚠ THE CARD'S FIELDS COMMIT ON BLUR, NOT ON INPUT. Typing into them and reading the room back
  // finds the old name, and a leak check that follows would pass because nothing was ever set.
  await dm.evaluate('(() => { const set = (id, v) => { const el = document.getElementById(id);' +
                    '   el.value = v; el.dispatchEvent(new FocusEvent("blur")); };' +
                    ' set("rp-name", "Hidden Stair"); set("rp-desc", "The trap is armed");' +
                    ' return 0; })()');
  await dm.evaluate(lib.SETTLE);
  // Nothing to poll for: the claim is that a name and a note do NOT arrive. The wait has to be
  // long enough for a push that carried them to have landed, and then the reading is the proof.
  await lib.hold(600, 'the leak check below is about what did NOT arrive, so the push needs ' +
    'time to have arrived for the reading to mean anything');
  const leak = await player.evaluate(`(() => {
    const n = (typeof polygons !== 'undefined' && polygons) ? polygons.length : 0;
    const body = document.body.innerText || '';
    return { rooms: n, inText: body.indexOf('Hidden Stair') >= 0 || body.indexOf('trap is armed') >= 0 };
  })()`);
  rig.check(leak.rooms === 0,
            'the TV is holding ' + leak.rooms + ' room(s), and a room carries the name and notes ' +
            'the DM wrote for themselves');
  rig.check(!leak.inText, 'a room name or note is rendered somewhere in the Player window');
  rig.check(await dm.evaluate('__rigById(' + keep + ').name') === 'Hidden Stair',
            'the name never reached the room on the DM either, so the check above passed for ' +
            'the wrong reason');
};
