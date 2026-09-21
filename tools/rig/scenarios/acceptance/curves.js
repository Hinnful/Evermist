'use strict';

// curves.js — CURVED WALLS, whole.
//
// THE GOAL OF THIS FEATURE: a round tower, a cave mouth and a curved corridor stop being a chain
// of short straight segments clicked by hand. Every check below serves that sentence.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its
// letter, wherever in the file that state is cheapest to reach - which is not letter order.
//
//   A. Ctrl+drag a wall bends it, and the bend LEANS toward where the wall was grabbed.
//        a bend appears · grabbing near one end leans that way
//   B. Ctrl+click straightens a wall, and a bend dragged back near straight snaps flat on its own.
//   C. The curve handles belong to the SELECTED corner alone, and the two are independent.
//        none before a corner is picked · one appears with it · dragging one leaves the other
//   D. A bent wall reshapes the FOG, not just the outline, AND IT REACHES THE TV.
//        a shroud room's bulge fogs ground · a revealed room bends too, which is the only
//        way the shared-wall band is reached at all
//   E. A door on a bent wall rides the curve instead of the straight line between its corners.
//   F. Join, Trim and Cut KEEP the curve, the corner radii and the doors. They used to drop all
//      three, which is the behaviour this reverses.
//   G. A door whose wall a repair removed is dropped, and the DM is TOLD. Nothing goes silently.
//   H. A bent corner keeps its radius, filleted against the curve, and a click in a wall's
//      bulge still finds the room.
//        the stored radius survives the bend · the card takes a new one too · the bulge
//        is clickable
//
//
// ⚠ THE MAP STARTS FULLY FOGGED, so every room here is a SHROUD room inside a revealed clearing.
// On untouched map a shroud room changes nothing and a fog check passes without the app acting.
//
// ⚠ CLIENT COORDINATES ARE INTEGERS, so a map coordinate makes the round trip with up to 1/zoom
// of error. Geometric checks carry a tolerance derived from the live zoom.
//
// ⚠ A RECTANGLE'S WALL 0 IS ITS TOP, running left to right: commitClosedShape is handed
// [(x1,y1),(x2,y1),(x2,y2),(x1,y2)]. Bending it upward is bending it OUT of the room.

const lib = require('../../lib');

const MAP_W = 2400, MAP_H = 1500;
const CLEAR = { x: 1200, y: 700, r: 900 };

const OWN_HELPERS = `
// The bend gesture itself. Ctrl must be on the mousedown, which is where selectMouseDown reads it.
globalThis.__rigBend = (x1, y1, x2, y2) => __rigDrag(x1, y1, x2, y2, { mods: { ctrlKey: true } });
globalThis.__rigH = (id, i) => {
  const p = __rigById(id);
  return (p && p.handles && p.handles[i]) ? p.handles[i] : null;
};
globalThis.__rigBent = (id, i) => {
  const h = __rigH(id, i);
  return !!(h && (h.ix || h.iy || h.ox || h.oy));
};
globalThis.__rigCut = (pts) => {
  setShape('cut');
  for (const p of pts) __rigClick(p[0], p[1]);
  container.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  setShape('select');
  return 0;
};
// ⚠ AIM EVERY GESTURE AT THE WALL, NOT AT WHERE IT STARTED. A bent wall bows away from the line
// between its corners, so a click at the old coordinates misses it and the gesture never runs.
// ⚠ THE CUBIC IS EVALUATED HERE, never read through doorPoint: aiming through the same code
// criterion E measures would make every gesture fail when that code breaks.
globalThis.__rigWallPoint = (id, edge, t) => {
  const p = __rigById(id), ring = p.vertices, n = ring.length;
  const a = ring[edge % n], b = ring[(edge + 1) % n];
  const ha = (p.handles && p.handles[edge % n]) || {};
  const hb = (p.handles && p.handles[(edge + 1) % n]) || {};
  const c1 = { x: a.x + (ha.ox || 0), y: a.y + (ha.oy || 0) };
  const c2 = { x: b.x + (hb.ix || 0), y: b.y + (hb.iy || 0) };
  const u = 1 - t, w0 = u*u*u, w1 = 3*u*u*t, w2 = 3*u*t*t, w3 = t*t*t;
  return { x: w0*a.x + w1*c1.x + w2*c2.x + w3*b.x,
           y: w0*a.y + w1*c1.y + w2*c2.y + w3*b.y };
};
globalThis.__rigNotice = () => {
  const el = document.getElementById('notice-toast');
  return (el && el.classList.contains('show')) ? el.textContent : null;
};
0`;



module.exports = async function curves(rig) {
  const dm = rig.dm;

  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await dm.evaluate(OWN_HELPERS);
  await dm.evaluate('revealCircle(' + CLEAR.x + ',' + CLEAR.y + ',' + CLEAR.r + ');' +
                    'rebuildFogEffect(); fogDirty = true; scheduleRender(); 0');
  await dm.waitFor('fogCoverT === 0 && fogTransRafId === null', 30000, 'the clearing to open');
  const zoom = await dm.evaluate('zoom');
  const tol = 3 / zoom;

  // ══ A. Ctrl+drag a wall bends it, and the bend leans where it was grabbed ══
  // RED BY DESIGN: written against the fix, never re-proved
  const a = await dm.evaluate('__rigDrawShroud(600, 400, 900, 700)');
  await dm.evaluate('__rigDbl(750, 550); 0');
  rig.check(await dm.evaluate('shapeEditMode') === true, 'the room did not open for editing');

  await dm.evaluate('__rigBend(750, 400, 750, 300); 0');
  rig.check(await dm.evaluate('__rigBent(' + a + ', 0) || __rigBent(' + a + ', 1)'),
            'Ctrl+dragging a wall left it straight, so a round tower is still a chain of ' +
            'hand-clicked segments');

  // GRABBED NEAR ONE END, the bend leans that way. A single bow number would arc symmetrically,
  // and that shape was refused for exactly this reason.
  const b = await dm.evaluate('__rigDrawShroud(1400, 400, 1700, 700)');
  await dm.evaluate('__rigDbl(1550, 550); 0');
  await dm.evaluate('__rigBend(1450, 400, 1450, 320); 0');
  // Defensive on purpose: a mutation that stops the bend leaves no handles at all, and a throw
  // here would hide which criterion actually caught it.
  const lean = await dm.evaluate(
    '(() => { const p = __rigById(' + b + '), hs = p.handles || [];' +
    ' const h0 = hs[0] || {}, h1 = hs[1] || {};' +
    ' return { near: Math.hypot(h0.ox || 0, h0.oy || 0),' +
    '          far: Math.hypot(h1.ix || 0, h1.iy || 0) }; })()');
  rig.check(lean.near > lean.far * 1.2,
            'a wall grabbed near its left end bent symmetrically: near ' + lean.near.toFixed(1) +
            ' vs far ' + lean.far.toFixed(1) + ', so the curve does not follow the hand');

  // ══ B. Ctrl+click straightens, and a bend dragged back near straight snaps flat ══
  // RED BY DESIGN: written against the fix, never re-proved
  const bMid = await dm.evaluate('__rigWallPoint(' + b + ', 0, 0.5)');
  await dm.evaluate('__rigClick(' + bMid.x + ',' + bMid.y + ', { mods: { ctrlKey: true } }); 0');
  rig.check(!(await dm.evaluate('__rigBent(' + b + ', 0) || __rigBent(' + b + ', 1)')),
            'Ctrl+clicking a bent wall left it bent, so a curve can only be undone');

  // Dragged back onto the straight line between its corners, from wherever the bow put it.
  await dm.evaluate('__rigDbl(750, 550); 0');
  const aMid = await dm.evaluate('__rigWallPoint(' + a + ', 0, 0.5)');
  await dm.evaluate('__rigBend(' + aMid.x + ',' + aMid.y + ', 750, 400); 0');
  rig.check(!(await dm.evaluate('__rigBent(' + a + ', 0) || __rigBent(' + a + ', 1)')),
            'a wall dragged back onto the line between its corners kept a curve on it, so ' +
            'flattening one by hand is impossible without the key');

  // ══ C. The handles belong to the selected corner alone, and the two are independent ══
  // RED BY DESIGN: written against the fix, never re-proved
  const aFlat = await dm.evaluate('__rigWallPoint(' + a + ', 0, 0.5)');
  await dm.evaluate('__rigBend(' + aFlat.x + ',' + aFlat.y + ', 750, 300); 0');
  await dm.evaluate('__rigClick(1800, 1350); __rigDbl(750, 550); 0');
  rig.check(await dm.evaluate('selectedVertexIndex') === -1 &&
            await dm.evaluate('selectedHandlePoints(__rigById(' + a + ')).length') === 0,
            'curve handles were on screen with no corner picked, so every corner of every room ' +
            'carries two more targets over the map');

  const v0 = await dm.evaluate('__rigById(' + a + ').vertices[0]');
  await dm.evaluate('__rigClick(' + v0.x + ',' + v0.y + '); 0');
  rig.check(await dm.evaluate('selectedVertexIndex') === 0 &&
            await dm.evaluate('selectedHandlePoints(__rigById(' + a + ')).length') > 0,
            'picking a bent corner showed no curve handle, so the curve cannot be adjusted');

  // INDEPENDENT: dragging the outgoing control point must not move the incoming one. A mirrored
  // rule would smooth every anchor and lose the sharp corner where a curved wall meets a flat one.
  await dm.evaluate('setShapeHandle(__rigById(' + a + '), 0, "in", -40, 0); 0');
  const before = await dm.evaluate('__rigH(' + a + ', 0)');
  const hp = await dm.evaluate('selectedHandlePoints(__rigById(' + a + ')).find(p => p.part === "out")');
  await dm.evaluate('__rigDrag(' + hp.x + ',' + hp.y + ',' + (hp.x + 60) + ',' + hp.y + '); 0');
  const after = await dm.evaluate('__rigH(' + a + ', 0)');
  rig.check(Math.abs(after.ix - before.ix) < 0.01 && Math.abs(after.iy - before.iy) < 0.01,
            'dragging one curve handle moved the other, so a corner where a curved wall meets a ' +
            'flat one can never be kept sharp');
  rig.check(Math.abs(after.ox - before.ox) > 1,
            'dragging a curve handle moved nothing');

  // ══ D. A bent wall reshapes the fog, and it reaches the TV ══
  // RED BY DESIGN: written against the fix, never re-proved
  // ⚠ TWO NON-SHROUD ROOMS EXIST FROM HERE ON. flattenSharedWalls only runs for a revealed or
  // half room WITH another one on the map, and that path reads the curve too — a scenario of
  // shroud rooms alone never enters it.
  await dm.evaluate('__rigDrawRoom("reveal", 1950, 900, 2200, 1100); 0');
  await dm.evaluate('__rigDrawRoom("half", 1950, 1150, 2200, 1350); 0');
  const c = await dm.evaluate('__rigDrawShroud(600, 900, 900, 1150)');
  await dm.evaluate(lib.SETTLE);
  const clearBefore = await dm.evaluate('__rigFog(750, 840)');
  rig.check(clearBefore < 40,
            'ground just above the room was already fogged, so the bulge check below cannot ' +
            'prove anything (read ' + clearBefore + ')');

  await dm.evaluate('__rigDbl(750, 1000); 0');
  await dm.evaluate('__rigBend(750, 900, 750, 780); 0');
  // The revealed room gets a bend too, so the shared-wall band runs over a curve rather than a
  // straight line. It throws rather than failing a check when that path cannot read the curve.
  await dm.evaluate('__rigDbl(2075, 1000); __rigBend(2075, 900, 2075, 850); 0');
  await dm.evaluate(lib.SETTLE);
  await dm.waitFor('fogTransRafId === null', 30000, 'the fog to settle after the bend');
  const fogInBulge = await dm.evaluate('__rigFog(750, 840)');
  rig.check(fogInBulge > 180,
            'bending a wall outward left the ground inside the bulge clear (alpha ' + fogInBulge +
            '), so the curve is an outline the players never see');

  const player = await rig.player();
  await dm.evaluate(lib.SETTLE);
  await player.waitFor('fogCoverT === 0', 30000, 'the Player cover to lift');
  await player.waitFor(lib.TV_FOG + '(750, 840) > 120', 30000,
                       'the curved wall to reach the Player');
  rig.check(await player.evaluate(lib.TV_FOG + '(750, 840)') > 120,
            'the bulge of a bent wall never reached the TV, so the players see a straight wall ' +
            'where the DM drew a curve');

  // ══ E. A door on a bent wall rides the curve ══
  // RED BY DESIGN: written against the fix, never re-proved
  const d = await dm.evaluate('__rigDrawShroud(1400, 900, 1700, 1150)');
  await dm.evaluate('__rigById(' + d + ').doors = [{ edge: 0, t: 0.5 }]; 0');
  const doorFlat = await dm.evaluate('doorPoint(__rigById(' + d + '), { edge: 0, t: 0.5 })');
  await dm.evaluate('__rigDbl(1550, 1000); 0');
  await dm.evaluate('__rigBend(1550, 900, 1550, 800); 0');
  const doorBent = await dm.evaluate('doorPoint(__rigById(' + d + '), { edge: 0, t: 0.5 })');
  rig.check(doorBent.y < doorFlat.y - 20,
            'a door on a wall that was bent stayed on the straight line between its corners ' +
            '(y ' + doorBent.y.toFixed(1) + ' against ' + doorFlat.y.toFixed(1) + '), so the ' +
            'notch floats off the wall it marks');

  // ══ F. Join, Trim and Cut keep the curve, the radii and the doors ══
  // RED BY DESIGN: written against the fix, never re-proved
  // ⚠ ONE FRESH ROOM PER REPAIR. Running all three over one room leaves geometry nobody can
  // reason about, and a check written against the shape it started as passes or fails by luck.
  const bendTop = async (id, x1, y1, x2) => {
    await dm.evaluate('__rigDbl(' + ((x1 + x2) / 2) + ',' + (y1 + 60) + '); 0');
    await dm.evaluate('__rigBend(' + ((x1 + x2) / 2) + ',' + y1 + ',' +
                      ((x1 + x2) / 2) + ',' + (y1 - 90) + '); 0');
    await dm.evaluate('__rigClick(1800, 1430); 0');
  };
  const detailOf = async (id) => dm.evaluate(
    '(() => { const p = __rigById(' + id + ');' +
    ' if (!p) return { gone: true };' +
    ' return { bent: !!(p.handles && p.handles.some(h => h && (h.ox||h.oy||h.ix||h.iy))),' +
    '          maxR: p.cornerRadii ? Math.max(...p.cornerRadii.map(v => v || 0)) : 0,' +
    '          doors: p.doors ? p.doors.length : 0 }; })()');

  // JOIN: the rectangle lands on the room's RIGHT side, clear of the bent top wall, of the
  // rounded bottom-left corner and of the door on the bottom wall.
  const rJoin = await dm.evaluate('__rigDrawShroud(1000, 900, 1250, 1100)');
  await bendTop(rJoin, 1000, 900, 1250);
  await dm.evaluate('__rigById(' + rJoin + ').cornerRadii = [null, null, null, 18];' +
                    ' __rigById(' + rJoin + ').doors = [{ edge: 2, t: 0.5 }]; 0');
  await dm.evaluate('__rigOpRect("join", 1200, 950, 1350, 1050); 0');
  const afterJoin = await detailOf(rJoin);
  rig.check(afterJoin.bent,
            'a Join flattened a curved wall it never touched, which is the drop this reverses');
  rig.check(afterJoin.maxR > 10,
            'a Join dropped the corner radius on a corner it never touched (max ' +
            afterJoin.maxR + ', was 18)');
  rig.check(afterJoin.doors === 1,
            'a Join dropped a door whose wall survived it: ' + afterJoin.doors + ' of 1 left');

  // TRIM: a bite out of the bottom-left, clear of the bent top wall and of the door above it.
  const rTrim = await dm.evaluate('__rigDrawShroud(1000, 1150, 1250, 1350)');
  await bendTop(rTrim, 1000, 1150, 1250);
  // ⚠ THE RADIUS GOES ON A CORNER THE BEND DOES NOT TOUCH. Bending the top wall clears the radius
  // on its own two corners by design, so a check written there measures that rule, not the Trim.
  await dm.evaluate('__rigById(' + rTrim + ').cornerRadii = [null, null, 14, null];' +
                    ' __rigById(' + rTrim + ').doors = [{ edge: 1, t: 0.25 }]; 0');
  await dm.evaluate('__rigOpRect("trim", 960, 1300, 1060, 1400); 0');
  const afterTrim = await detailOf(rTrim);
  rig.check(afterTrim.bent, 'a Trim flattened a curved wall it never reached');
  rig.check(afterTrim.maxR > 10,
            'a Trim dropped the corner radius on a corner it never reached (max ' +
            afterTrim.maxR + ')');
  rig.check(afterTrim.doors === 1,
            'a Trim dropped a door whose wall survived it: ' + afterTrim.doors + ' of 1 left');

  // CUT: straight through the room, below the bent top wall. Both halves keep what they own.
  const rCut = await dm.evaluate('__rigDrawShroud(300, 1150, 600, 1400)');
  await bendTop(rCut, 300, 1150, 600);
  const cutBefore = await dm.evaluate('polygons.length');
  await dm.evaluate('__rigCut([[250, 1320], [650, 1320]]); 0');
  const cutAfter = await dm.evaluate('polygons.length');
  rig.check(cutAfter > cutBefore,
            'the Cut did not split the room (' + cutBefore + ' rooms before, ' + cutAfter +
            ' after), so the check below is empty');
  rig.check((await detailOf(rCut)).bent,
            'a Cut flattened the curve on the piece that kept the bent wall');

  // ══ G. A door whose wall a repair removed is dropped, and the DM is told ══
  // RED BY DESIGN: written against the fix, never re-proved
  const e = await dm.evaluate('__rigDrawShroud(300, 300, 520, 520)');
  await dm.evaluate('__rigById(' + e + ').doors = [{ edge: 0, t: 0.5 }]; 0');
  // A Trim that takes the whole top wall away: the door has no wall left to sit on.
  await dm.evaluate('__rigOpRect("trim", 260, 260, 560, 400); 0');
  const notice = await dm.evaluate('__rigNotice()');
  const doorsLeft = await dm.evaluate(
    '(() => { const p = __rigById(' + e + '); return p && p.doors ? p.doors.length : 0; })()');
  rig.check(doorsLeft === 0,
            'the door on a wall the repair removed is still recorded, on a wall that is gone');
  rig.check(!!notice && /door/i.test(notice),
            'a door was removed with its wall and the DM was told nothing (notice: ' +
            JSON.stringify(notice) + ')');

  // ══ H. A bent corner keeps its radius, and a click in a bulge finds the room ══
  // RED BY DESIGN: written against the fix, never re-proved
  const f = await dm.evaluate('__rigDrawShroud(1950, 300, 2250, 600)');
  await dm.evaluate('__rigById(' + f + ').cornerRadii = [30, 30, null, null]; 0');
  await dm.evaluate('__rigDbl(2100, 450); 0');
  await dm.evaluate('__rigBend(2100, 300, 2100, 200); 0');
  const radii = await dm.evaluate('__rigById(' + f + ').cornerRadii');
  rig.check(radii[0] === 30 && radii[1] === 30,
            'a bent corner lost its radius, so a room cannot carry a curve and its rounding at ' +
            'once: ' + JSON.stringify(radii));

  // THE CARD TAKES A NEW ONE TOO, filleted against the curve rather than the chord to the far
  // vertex — see computeFillet in fogGeometry.js.
  const v0f = await dm.evaluate('__rigById(' + f + ').vertices[0]');
  await dm.evaluate('__rigClick(' + v0f.x + ',' + v0f.y + '); 0');
  rig.check(await dm.evaluate('document.getElementById("rp-radius-num").disabled') === false,
            'the corner radius field was disabled on a bent corner, so the DM cannot round one');
  await dm.evaluate('document.getElementById("rp-radius-num").value = 18;' +
                    ' document.getElementById("rp-radius-num")' +
                    '.dispatchEvent(new Event("input", { bubbles: true })); 0');
  rig.check(await dm.evaluate('(__rigById(' + f + ').cornerRadii || [])[0]') === 18,
            'a radius typed on a bent corner was not stored');

  await dm.evaluate('__rigClick(1800, 1350); 0');
  await dm.evaluate('__rigClick(2100, 240); 0');
  rig.check(await dm.evaluate('selectedPolygonId') === f,
            'a click inside the bulge of a bent wall found no room, so the curve leaves a dead ' +
            'strip the DM can see but not press');

  rig.note('zoom ' + zoom.toFixed(3) + ', tolerance ' + tol.toFixed(2) + ' map units');
};
