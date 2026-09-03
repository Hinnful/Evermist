'use strict';

// room-repair.js — REPAIRING A ROOM THAT IS ALREADY ON THE MAP.
//
// THE GOAL OF THIS FEATURE: the floor-plan import leaves rooms that are nearly right, and the DM
// fixes them on the map in one gesture each. Two rooms the plan split wrongly become one. One
// room covering two chambers becomes two. A notch or an alcove is one shape dragged once.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks directly beneath it, in order.
//
//   A. Trim takes a notch out of a room, and the fog loses the notch with it.
//        the outline gains corners · the notch clears · the rest of the room stays shrouded
//   B. Trim splits one room into two.
//   C. Join makes one room out of two, and takes the MOST HIDDEN fog mode of the two.
//   D. Cut makes two rooms whose edges touch exactly, with no strip lost between them.
//   E. A refusal changes nothing, says so, and spends no undo.
//   F. A shape drawn over nothing does nothing. Join and Trim never create a room.
//   G. The modes work in Effects mode too; the Cut tool does not, and greys.
//   H. EVERY ONE OF THOSE REACHES THE TV. A repaired room the players still see in its old
//      shape is the failure this feature exists to prevent.
//
// ⚠ ROOMS DO NOT CROSS TO THE PLAYER (CLAUDE.md). What crosses is the fog they paint, so the TV
// checks here read fog over ground, never a room.
//
// ⚠ THE MAP STARTS FULLY FOGGED, and every room below is a SHROUD room inside a revealed
// clearing — on untouched map a shroud room changes no fog and every check passes for free.
//
// ⚠ THE FOG TRIO IS DISABLED WHILE JOIN OR TRIM IS PICKED, so the draw helper puts the mode back
// to New before it clicks Shroud. Clicking a disabled button does nothing and the room would
// arrive in whatever state was last picked.
//
// ⚠ A CUT PATH FINISHES ON A DOUBLE-CLICK, not on closing a ring, so __rigCut clicks each point
// and then dispatches the dblclick itself. Without that last event nothing commits and every
// check below reads the room unchanged.
//
// ⚠ CLIENT COORDINATES ARE INTEGERS, so a map coordinate makes the round trip with up to 1/zoom
// of error. Every geometric check carries a tolerance derived from the live zoom.

const MAP_W = 2400, MAP_H = 1500;
const CLEAR = { x: 1200, y: 700, r: 950 };

const HELPERS = `
globalThis.__rigMouse = (type, mx, my) => {
  const r = container.getBoundingClientRect();
  container.dispatchEvent(new MouseEvent(type, {
    clientX: mx * zoom + panX + r.left, clientY: my * zoom + panY + r.top,
    bubbles: true, cancelable: true, button: 0,
  }));
};
globalThis.__rigDrag = (x1, y1, x2, y2) => {
  __rigMouse('mousedown', x1, y1);
  __rigMouse('mousemove', (x1+x2)/2, (y1+y2)/2);
  __rigMouse('mousemove', x2, y2);
  __rigMouse('mouseup', x2, y2);
};
globalThis.__rigClick = (mx, my) => { __rigMouse('mousedown', mx, my); __rigMouse('mouseup', mx, my); };
globalThis.__rigKey = (k) => document.dispatchEvent(
  new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
globalThis.__rigFog = (mx, my) => fogDataCtx.getImageData(
  Math.round(mx / FOG_SCALE), Math.round(my / FOG_SCALE), 1, 1).data[3];
globalThis.__rigById = (id) => polygons.find(p => p.id === id);
globalThis.__rigArea = (v) => {
  let s = 0;
  for (let i = 0, n = v.length; i < n; i++) { const a = v[i], b = v[(i+1)%n]; s += a.x*b.y - b.x*a.y; }
  return Math.abs(s) / 2;
};
// A shroud room, by id. Drawing leaves nothing selected on purpose, so the id comes from the list.
globalThis.__rigDrawShroud = (x1, y1, x2, y2) => {
  setShapeOp('new');
  setShape('rect');
  document.getElementById('btn-shroud').click();
  __rigDrag(x1, y1, x2, y2);
  setShape('select');
  return polygons[polygons.length - 1].id;
};
// A rectangle drawn in Join or Trim mode. Returns nothing: neither mode makes a record.
globalThis.__rigOpRect = (op, x1, y1, x2, y2) => {
  setShapeOp(op);
  setShape('rect');
  __rigDrag(x1, y1, x2, y2);
  setShapeOp('new');
  setShape('select');
  return 0;
};
// A cut path: one click per point, then the double-click that finishes it.
globalThis.__rigCut = (pts) => {
  setShape('cut');
  for (const p of pts) __rigClick(p[0], p[1]);
  container.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  setShape('select');
  return 0;
};
globalThis.__rigDialog = () => {
  const el = document.getElementById('cd-msg');
  const root = document.getElementById('cd-anchor');
  const up = !!(root && root.style.display === 'flex');
  return { up: up, text: el ? el.textContent : '' };
};
globalThis.__rigDismiss = () => {
  const ok = document.getElementById('cd-ok');
  if (ok) ok.click();
  return 0;
};
0`;

const TV_FOG = `((mx, my) => fogDataCtx.getImageData(
  Math.round(mx / FOG_SCALE), Math.round(my / FOG_SCALE), 1, 1).data[3])`;

const SETTLE = 'rebuildFogFromPolygons(); rebuildFogEffect(); fogDirty = true;' +
               ' scheduleRender(); sendToPlayer(); 0';

module.exports = async function roomRepair(rig) {
  const dm = rig.dm;

  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H });
  await dm.evaluate('createNewScene(' + (await rig.fixtures.asFileExpr(dm, map)) + ')', 120000);
  await dm.waitFor('currentScene && currentScene.mapType === "video" && mapWidth === ' + MAP_W,
                   120000, 'the map to load on the DM');
  await dm.evaluate(HELPERS);
  await dm.evaluate('revealCircle(' + CLEAR.x + ',' + CLEAR.y + ',' + CLEAR.r + ');' +
                    'rebuildFogEffect(); fogDirty = true; scheduleRender(); 0');
  await dm.waitFor('fogCoverT === 0 && fogTransRafId === null', 30000, 'the clearing to open');
  const tol = 3 / (await dm.evaluate('zoom'));

  rig.check(await dm.evaluate('typeof polygonClipping !== "undefined"'),
            'the clipping library did not load, so every check below would be reading a dead ' +
            'tool rather than a broken one');

  // ══ A. Trim takes a notch out of a room, and the fog loses the notch with it ══
  const a = await dm.evaluate('__rigDrawShroud(500, 300, 800, 600)');
  await dm.evaluate(SETTLE);
  const aBefore = await dm.evaluate('({ n: __rigById(' + a + ').vertices.length,' +
                                    '   area: __rigArea(__rigById(' + a + ').vertices) })');
  const IN_NOTCH = { x: 650, y: 350 }, IN_ROOM = { x: 550, y: 550 };
  const notchFogBefore = await dm.evaluate('__rigFog(' + IN_NOTCH.x + ',' + IN_NOTCH.y + ')');
  rig.check(notchFogBefore > 200,
            'the ground the notch will open had no fog on it to begin with (alpha ' +
            notchFogBefore + '), so trimming it proves nothing');

  // The fog trio has nothing to say under Trim, and a live button that does nothing is the
  // silent refusal this feature is not allowed to have.
  await dm.evaluate('setShapeOp("trim"); 0');
  rig.check(await dm.evaluate('document.getElementById("btn-shroud").disabled === true &&' +
                              ' document.getElementById("btn-reveal").disabled === true'),
            'the fog trio stayed live while Trim was picked, so the DM can pick a fog state ' +
            'that the operation ignores');
  await dm.evaluate('setShapeOp("new"); 0');
  rig.check(await dm.evaluate('document.getElementById("btn-shroud").disabled === false'),
            'the fog trio stayed greyed after Trim was dropped');

  await dm.evaluate('__rigOpRect("trim", 600, 250, 700, 400)');
  await dm.evaluate(SETTLE);
  const aAfter = await dm.evaluate(
    '(() => { const p = __rigById(' + a + ');' +
    ' return p ? { n: p.vertices.length, area: __rigArea(p.vertices) } : null; })()');
  rig.check(!!aAfter, 'the trimmed room is gone entirely — a notch is not a deletion');
  rig.note('the notched room went from ' + aBefore.n + ' corners to ' + aAfter.n +
           ', and ' + Math.round(aBefore.area) + ' to ' + Math.round(aAfter.area) + ' units²');
  rig.check(aAfter.n > aBefore.n,
            'the room still has ' + aAfter.n + ' corners, so its outline never changed and the ' +
            'DM would still be placing vertices by hand');
  rig.check(Math.abs((aBefore.area - aAfter.area) - 10000) < 200 * tol,
            'the notch took ' + Math.round(aBefore.area - aAfter.area) + ' units² out of the ' +
            'room instead of the 10,000 the drawn rectangle covers');

  const notchFog = await dm.evaluate('__rigFog(' + IN_NOTCH.x + ',' + IN_NOTCH.y + ')');
  const roomFog  = await dm.evaluate('__rigFog(' + IN_ROOM.x + ',' + IN_ROOM.y + ')');
  rig.note('fog after the notch — inside it ' + notchFog + ', rest of the room ' + roomFog);
  rig.check(notchFog < 60,
            'the notch is cut out of the outline but the fog the players see is still there ' +
            '(alpha ' + notchFog + ')');
  rig.check(roomFog > 200,
            'trimming a notch cleared the whole room (alpha ' + roomFog + ') instead of the ' +
            'notch alone');

  // ══ B. Trim splits one room into two ══
  const b = await dm.evaluate('__rigDrawShroud(1000, 300, 1400, 600)');
  const bCountBefore = await dm.evaluate('polygons.length');
  const bNextId = await dm.evaluate('nextPolygonId');
  await dm.evaluate('__rigOpRect("trim", 1180, 250, 1220, 650)');
  await dm.evaluate(SETTLE);
  const bCount = await dm.evaluate('polygons.length');
  rig.check(bCount === bCountBefore + 1,
            'a strip trimmed clean across a room left ' + bCount + ' rooms where there should ' +
            'be ' + (bCountBefore + 1) + ' — the split produced one piece, not two');
  rig.check(await dm.evaluate('!!__rigById(' + b + ')'),
            'the split threw away the room\'s id, so its name and notes went with it');
  // ⚠ SCOPED BY ID, never by area. The cut in block D produces halves of the same size, so an
  // area filter over the whole list would count four and pass for the wrong reason.
  const bHalves = await dm.evaluate(
    'polygons.filter(p => (p.id === ' + b + ' || p.id >= ' + bNextId + ') &&' +
    '                     __rigArea(p.vertices) > 40000 && __rigArea(p.vertices) < 70000).length');
  rig.check(bHalves === 2,
            'the two halves of the split room measure wrong — found ' + bHalves + ' of the ' +
            'expected size');
  rig.check(await dm.evaluate('__rigFog(1200, 450)') < 60,
            'the trimmed strip is still fogged, so the split is in the outline only');

  // ══ C. Join makes one room out of two, and takes the MOST HIDDEN mode ══
  // ⚠ ONE ROOM IS PUT INTO REVEAL FIRST. A join that keeps the earliest contributor's mode would
  // hand the table ground that was shrouded a moment earlier, and two shroud rooms hide that.
  const c1 = await dm.evaluate('__rigDrawShroud(500, 900, 700, 1100)');
  const c2 = await dm.evaluate('__rigDrawShroud(800, 900, 1000, 1100)');
  await dm.evaluate('__rigClick(600, 1000); __rigKey("t"); __rigKey("t"); 0');
  rig.check(await dm.evaluate('__rigById(' + c1 + ').mode') === 'reveal',
            'the first room is not in Reveal mode, so the fog-mode check below means nothing');
  const cCountBefore = await dm.evaluate('polygons.length');
  await dm.evaluate('__rigOpRect("join", 650, 950, 850, 1050)');
  await dm.evaluate(SETTLE);
  rig.check(await dm.evaluate('polygons.length') === cCountBefore - 1,
            'joining two rooms did not leave one — the DM still has two rooms to edge-match ' +
            'by hand');
  rig.check(await dm.evaluate('!!__rigById(' + c1 + ')') &&
            await dm.evaluate('!__rigById(' + c2 + ')'),
            'the join kept the wrong room: the result must take the slot of the EARLIER one, ' +
            'because array order is fog compositing precedence');
  const cMode = await dm.evaluate('__rigById(' + c1 + ').mode');
  rig.note('joined a Reveal room to a Shroud room and got ' + cMode);
  rig.check(cMode === 'shroud',
            'the joined room came out ' + cMode + ' — a join must take the most hidden mode of ' +
            'its parts, or it uncovers ground on the TV nobody asked to uncover');
  const cArea = await dm.evaluate('__rigArea(__rigById(' + c1 + ').vertices)');
  rig.check(cArea > 2 * 200 * 200,
            'the joined room measures ' + Math.round(cArea) + ' units², less than the two ' +
            'rooms it was made of');
  rig.check(await dm.evaluate('__rigFog(750, 1000)') > 200,
            'the bridge between the two joined rooms is not fogged, so the join left a gap the ' +
            'players can see through');

  // ══ D. Cut makes two rooms whose edges touch exactly ══
  const d = await dm.evaluate('__rigDrawShroud(1500, 900, 1900, 1200)');
  const dArea = await dm.evaluate('__rigArea(__rigById(' + d + ').vertices)');
  const dCountBefore = await dm.evaluate('polygons.length');
  const dNextId = await dm.evaluate('nextPolygonId');
  await dm.evaluate('__rigCut([[1450, 1050], [1950, 1050]])');
  await dm.evaluate(SETTLE);
  rig.check(await dm.evaluate('__rigDialog().up') === false,
            'the cut was refused: ' + (await dm.evaluate('__rigDialog().text')));
  const dCount = await dm.evaluate('polygons.length');
  rig.check(dCount === dCountBefore + 1,
            'a cut straight across a room left ' + dCount + ' rooms instead of ' +
            (dCountBefore + 1));
  const dPieces = await dm.evaluate(
    'polygons.filter(p => p.id === ' + d + ' || p.id >= ' + dNextId + ')' +
    '        .map(p => p.vertices)');
  rig.check(dPieces.length === 2,
            'the cut room came out as ' + dPieces.length + ' piece(s) instead of 2');
  if (dPieces.length === 2) {
    const sum = dPieces.reduce((s, v) => {
      let t = 0;
      for (let i = 0, n = v.length; i < n; i++) {
        const p = v[i], q = v[(i + 1) % n];
        t += p.x * q.y - q.x * p.y;
      }
      return s + Math.abs(t) / 2;
    }, 0);
    rig.note('the cut pieces add back to ' + Math.round(sum) + ' of ' + Math.round(dArea));
    // The pieces are cut from the STORED ring, so this is exact arithmetic, not a measurement.
    rig.check(Math.abs(sum - dArea) < 1,
              'the two pieces add up to ' + Math.round(sum) + ' against the room\'s ' +
              Math.round(dArea) + ' — a cut is ZERO WIDTH, and a gap here is a fogged line ' +
              'across open rock on the TV');
    const shared = dPieces[0].filter(p =>
      dPieces[1].some(q => Math.hypot(p.x - q.x, p.y - q.y) < 0.001)).length;
    rig.check(shared === 2,
              'the pieces share ' + shared + ' points instead of the 2 the cut put on both, so ' +
              'their edges do not touch exactly');
  }
  // Sampled ON the cut, and against 120 rather than 200: two fills meeting on a shared edge
  // each antialias it, so a sound seam lands near 190. A real GAP reads under 60.
  const dSeam = await dm.evaluate('__rigFog(1700, 1050)');
  rig.note('fog on the cut itself reads ' + dSeam);
  rig.check(dSeam > 120,
            'the cut opened a seam in the fog (alpha ' + dSeam + ') where the two rooms meet, ' +
            'so the players see a line of clear ground across a room the DM only split');

  // ══ E. A refusal changes nothing, says so, and spends no undo ══
  const e = await dm.evaluate('__rigDrawShroud(1600, 300, 2000, 650)');
  await dm.evaluate(SETTLE);
  const eSnapshot = await dm.evaluate('JSON.stringify(polygons)');
  const eUndo = await dm.evaluate('undoStack.length');
  await dm.evaluate('__rigOpRect("trim", 1700, 400, 1900, 550)');
  const refusal = await dm.evaluate('__rigDialog()');
  rig.check(refusal.up && refusal.text.length > 0,
            'a trim that would leave a hole in a room went through silently — the DM gets a ' +
            'room whose middle the fog no longer knows about');
  rig.note('the refusal said: ' + refusal.text);
  rig.check(await dm.evaluate('JSON.stringify(polygons)') === eSnapshot,
            'the refused trim edited the rooms anyway');
  rig.check(await dm.evaluate('undoStack.length') === eUndo,
            'the refused trim left an undo entry behind, so the DM\'s next Ctrl+Z does nothing ' +
            'visible');
  await dm.evaluate('__rigDismiss(); 0');
  rig.check(await dm.evaluate('__rigDialog().up') === false, 'the refusal dialog would not close');

  // ══ F. A shape drawn over nothing does nothing ══
  const fCount = await dm.evaluate('polygons.length');
  const fUndo  = await dm.evaluate('undoStack.length');
  await dm.evaluate('__rigOpRect("join", 300, 1250, 420, 1350)');   // bare map
  await dm.evaluate('__rigOpRect("trim", 300, 1250, 420, 1350)');
  rig.check(await dm.evaluate('polygons.length') === fCount,
            'a Join or Trim drawn over bare map created a room — neither mode ever makes one');
  rig.check(await dm.evaluate('undoStack.length') === fUndo,
            'a shape drawn over nothing spent an undo step');
  rig.check(await dm.evaluate('__rigById(' + e + ').vertices.length') === 4,
            'the room under test was reshaped by a drag that landed nowhere near it');

  // ══ G. The modes work in Effects mode; the Cut tool does not ══
  await dm.evaluate('setPlaceMode("effects"); 0');
  rig.check(await dm.evaluate('document.getElementById("btn-cut").disabled === true'),
            'the Cut tool stayed live in Effects mode, where there is no room to cut');
  await dm.evaluate('setShapeOp("new"); setShape("rect");' +
                    ' __rigDrag(400, 400, 500, 500); __rigDrag(560, 400, 660, 500); 0');
  const gBefore = await dm.evaluate('effects.length');
  rig.check(gBefore >= 2, 'the two effects to join were not drawn');
  await dm.evaluate('__rigOpRect("join", 470, 430, 590, 470)');
  rig.check(await dm.evaluate('effects.length') === gBefore - 1,
            'joining two effects did not leave one, so the modes read the placement mode for ' +
            'rooms only');
  await dm.evaluate('setPlaceMode("rooms"); 0');
  rig.check(await dm.evaluate('document.getElementById("btn-cut").disabled === false'),
            'the Cut tool stayed greyed back in Rooms mode');

  // ══ H. Every one of those reaches the TV ══
  rig.check(await dm.evaluate('autoSync === true'),
            'auto-sync is off, so no repair could reach the Player and the checks below would ' +
            'be reading the TV\'s own starting state');
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen && !!fogDataCanvas', 45000, 'the Player to receive the map');
  await player.waitFor('fogCoverT === 0', 45000, 'the scene cover to lift on the Player');

  // One room in clean ground, repaired while the Player is watching.
  const h = await dm.evaluate('__rigDrawShroud(1000, 1200, 1400, 1420)');
  const KEPT = { x: 1060, y: 1300 }, TRIMMED = { x: 1300, y: 1300 };
  await dm.evaluate(SETTLE);
  try {
    await player.waitFor(TV_FOG + '(' + KEPT.x + ',' + KEPT.y + ') > 200', 30000,
                         'the new room to reach the Player');
  } catch (_) { /* asserted below */ }
  rig.check(await player.evaluate(TV_FOG + '(' + KEPT.x + ',' + KEPT.y + ')') > 200,
            'the room to repair never reached the TV, so the repair check below means nothing');

  await dm.evaluate('__rigOpRect("trim", 1220, 1150, 1450, 1450)');
  await dm.evaluate(SETTLE);
  try {
    await player.waitFor(TV_FOG + '(' + TRIMMED.x + ',' + TRIMMED.y + ') < 60', 30000,
                         'the trim to reach the Player');
  } catch (_) { /* asserted below */ }
  const tv = await player.evaluate(
    '({ kept: ' + TV_FOG + '(' + KEPT.x + ',' + KEPT.y + '),' +
    '   gone: ' + TV_FOG + '(' + TRIMMED.x + ',' + TRIMMED.y + ') })');
  rig.note('TV after the trim — kept side ' + tv.kept + ', trimmed side ' + tv.gone);
  rig.check(tv.gone < 60,
            'the trimmed part of the room is still hidden on the TV (alpha ' + tv.gone +
            '), so the table loses ground the DM uncovered');
  rig.check(tv.kept > 200,
            'trimming part of a room cleared the whole thing on the TV (alpha ' + tv.kept + ')');

  // And a cut reaches it too: the seam must not show as a fogged line.
  // ⚠ THE BAND AT y=750 IS THE ONLY ONE LEFT CLEAR by the blocks above, and the path has to stay
  // in it. A cut is refused WHOLE when any room it crosses has more than two crossings, so a path
  // drawn across the notched room from block A takes four crossings there and kills this cut.
  const seam = await dm.evaluate('__rigDrawShroud(400, 650, 900, 850)');
  await dm.evaluate(SETTLE);
  await dm.evaluate('__rigCut([[350, 750], [950, 750]])');
  await dm.evaluate(SETTLE);
  rig.check(await dm.evaluate('__rigDialog().up') === false,
            'the second cut was refused: ' + (await dm.evaluate('__rigDialog().text')));
  try {
    await player.waitFor(TV_FOG + '(650, 750) > 120', 30000, 'the cut to reach the Player');
  } catch (_) { /* asserted below */ }
  const tvSeam = await player.evaluate(TV_FOG + '(650, 750)');
  rig.note('the TV reads ' + tvSeam + ' on the cut');
  rig.check(tvSeam > 120,
            'the TV shows a hole along the cut (alpha ' + tvSeam + '), so the players see a ' +
            'line of clear ground where the DM only split a room');
  rig.check(await dm.evaluate('polygons.filter(p => p.id === ' + seam + ').length') === 1,
            'the cut room lost its own id');
};
