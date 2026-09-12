'use strict';

// rooms-with-holes.js — A POLYGON WITH A HOLE IN IT.
//
// THE GOAL OF THIS FEATURE: a Cut or a Trim landing wholly inside a room leaves a hole on that
// room rather than being refused. The hole is part of the record: it moves, saves, undoes and
// takes vertex handles like the outer outline.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks directly beneath it, in order.
//
//   A. A Trim landing wholly inside a room makes a hole, not a second room.
//        the room keeps its id and its area · the middle stays shrouded · the rest clears
//   B. That fog reaches the Player.
//   C. The hole survives a save and a reload.
//   D. Dragging the room carries the hole with it.
//   E. A hole's wall has handles: dragging one reshapes it, and ONE undo takes it back.
//   F. A shape DRAWN inside the hole becomes a separate room, and stays put when the keep moves.
//   G. A Cut straight through a courtyard gives each half its own share of it.
//   H. An effect carrying a hole renders as a ring of flame on both screens, and the ember grid
//      does not relight inside the hole. The hole is made the way the DM makes it: Cut out is
//      armed from its own button on the Effects bar.
//   I. A door can be marked on an inner wall, so a keep has a gate onto its courtyard, and the
//      notch opens a gap in it. Which SIDE the notch reaches further into is settled by a unit
//      test on doorEdgeFrame - a notch straddles its wall, so no fog sample here separates them.
//
// ⚠ ROOMS DO NOT CROSS TO THE PLAYER (CLAUDE.md). What crosses is the fog they paint, so the TV
// checks read fog over ground. EFFECTS do cross, as the records themselves.
//
// ⚠ THE MAP STARTS FULLY FOGGED, and the keep is a REVEAL room inside it — the point of a hole is
// ground left dark inside ground opened up, so a shroud room here would pass for free.
//
// ⚠ CLIENT COORDINATES ARE INTEGERS, so a map coordinate makes the round trip with up to 1/zoom
// of error. Every geometric check carries a tolerance derived from the live zoom.

const MAP_W = 2400, MAP_H = 1500;

// The keep, and the courtyard cut out of its middle. Far enough apart that the fog feather on
// each wall cannot reach the sample points between them.
const KEEP = { x1: 300, y1: 250, x2: 1100, y2: 900 };
const YARD = { x1: 550, y1: 450, x2: 850, y2: 700 };
const IN_YARD = { x: 700, y: 575 };            // middle of the courtyard
const IN_KEEP = { x: 400, y: 350 };            // keep ground, well clear of both walls

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
// Everything a criterion asks about one room, read in one round trip.
globalThis.__rigShape = (id) => {
  const p = (polygons.concat(effects)).find(s => s.id === id);
  if (!p) return null;
  return { n: p.vertices.length, area: __rigArea(p.vertices), mode: p.mode,
           holes: (p.holes || []).length,
           holeArea: (p.holes || []).map(h => __rigArea(h)),
           holeBox: (p.holes || []).map(h => ({
             x0: Math.min.apply(null, h.map(v => v.x)), x1: Math.max.apply(null, h.map(v => v.x)),
             y0: Math.min.apply(null, h.map(v => v.y)), y1: Math.max.apply(null, h.map(v => v.y)),
           })),
           box: { x0: Math.min.apply(null, p.vertices.map(v => v.x)),
                  x1: Math.max.apply(null, p.vertices.map(v => v.x)),
                  y0: Math.min.apply(null, p.vertices.map(v => v.y)),
                  y1: Math.max.apply(null, p.vertices.map(v => v.y)) } };
};
globalThis.__rigDrawRoom = (mode, x1, y1, x2, y2) => {
  setShapeOp('new');
  setShape('rect');
  document.getElementById('btn-' + mode).click();
  __rigDrag(x1, y1, x2, y2);
  setShape('select');
  return polygons[polygons.length - 1].id;
};
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
  const root = document.getElementById('cd-anchor');
  const el = document.getElementById('cd-msg');
  return { up: !!(root && root.style.display === 'flex'), text: el ? el.textContent : '' };
};
0`;

const TV_FOG = `((mx, my) => fogDataCtx.getImageData(
  Math.round(mx / FOG_SCALE), Math.round(my / FOG_SCALE), 1, 1).data[3])`;

const SETTLE = 'rebuildFogFromPolygons(); rebuildFogEffect(); fogDirty = true;' +
               ' scheduleRender(); sendToPlayer(); 0';

module.exports = async function roomsWithHoles(rig) {
  const dm = rig.dm;

  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H });
  await dm.evaluate('createNewScene(' + (await rig.fixtures.asFileExpr(dm, map)) + ')', 120000);
  await dm.waitFor('currentScene && currentScene.mapType === "video" && mapWidth === ' + MAP_W,
                   120000, 'the map to load on the DM');
  await dm.evaluate(HELPERS);
  await dm.waitFor('fogCoverT === 0 && fogTransRafId === null', 30000, 'the scene cover to lift');
  const zoom = await dm.evaluate('zoom');
  const tol = 3 / zoom;

  rig.check(await dm.evaluate('typeof polygonClipping !== "undefined"'),
            'the clipping library did not load, so every check below would be reading a dead ' +
            'tool rather than a broken one');

  // ══ A. A Trim landing wholly inside a room makes a hole, not a second room ══
  const keep = await dm.evaluate('__rigDrawRoom("reveal", ' +
    KEEP.x1 + ',' + KEEP.y1 + ',' + KEEP.x2 + ',' + KEEP.y2 + ')');
  await dm.evaluate(SETTLE);
  const before = await dm.evaluate('__rigShape(' + keep + ')');
  rig.check(before.mode === 'reveal' && before.holes === 0,
            'the keep did not start as a plain revealed room, so the checks below prove nothing');
  rig.check(await dm.evaluate('__rigFog(' + IN_YARD.x + ',' + IN_YARD.y + ')') < 60,
            'the ground the courtyard will cover is still fogged before the trim, so a hole ' +
            'there would be indistinguishable from doing nothing');

  const roomsBefore = await dm.evaluate('polygons.length');
  await dm.evaluate('__rigOpRect("trim", ' + YARD.x1 + ',' + YARD.y1 + ',' +
                    YARD.x2 + ',' + YARD.y2 + ')');
  await dm.evaluate(SETTLE);
  rig.check(await dm.evaluate('__rigDialog().up') === false,
            'the trim was refused: ' + (await dm.evaluate('__rigDialog().text')));
  rig.check(await dm.evaluate('polygons.length') === roomsBefore,
            'a trim inside a room made a second room — a courtyard is a hole on the keep, and ' +
            'a second record would sit in the room card as a room of its own');

  const after = await dm.evaluate('__rigShape(' + keep + ')');
  rig.check(!!after, 'the trim deleted the keep instead of holing it');
  rig.note('the keep carries ' + after.holes + ' hole(s), ' +
           Math.round(after.holeArea[0] || 0) + ' units² against the drawn ' +
           (YARD.x2 - YARD.x1) * (YARD.y2 - YARD.y1));
  rig.check(after.holes === 1,
            'the keep came back with ' + after.holes + ' holes instead of 1');
  rig.check(Math.abs(after.area - before.area) < 200 * tol,
            'the keep\'s outer outline changed by ' + Math.round(after.area - before.area) +
            ' units² — a hole is taken out of the middle, never off the edge');
  rig.check(Math.abs(after.holeArea[0] - (YARD.x2 - YARD.x1) * (YARD.y2 - YARD.y1)) < 400 * tol,
            'the courtyard measures ' + Math.round(after.holeArea[0]) + ' units² instead of the ' +
            ((YARD.x2 - YARD.x1) * (YARD.y2 - YARD.y1)) + ' the DM drew');

  const yardFog = await dm.evaluate('__rigFog(' + IN_YARD.x + ',' + IN_YARD.y + ')');
  const keepFog = await dm.evaluate('__rigFog(' + IN_KEEP.x + ',' + IN_KEEP.y + ')');
  rig.note('fog after the trim — courtyard ' + yardFog + ', keep ground ' + keepFog);
  rig.check(yardFog > 200,
            'the courtyard is clear (alpha ' + yardFog + '), so the hole is in the outline only ' +
            'and the players see straight into it');
  rig.check(keepFog < 60,
            'the keep around the courtyard is still fogged (alpha ' + keepFog + '), so the ' +
            'reveal never happened');
  rig.byEye('the fog around the courtyard is feathered like any other wall, not a hard edge');

  // ══ B. That fog reaches the Player ══
  rig.check(await dm.evaluate('autoSync === true'),
            'auto-sync is off, so nothing below could reach the Player');
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen && !!fogDataCanvas', 45000, 'the Player to receive the map');
  await player.waitFor('fogCoverT === 0', 45000, 'the scene cover to lift on the Player');
  await dm.evaluate(SETTLE);
  try {
    await player.waitFor(TV_FOG + '(' + IN_KEEP.x + ',' + IN_KEEP.y + ') < 60', 30000,
                         'the keep to reach the Player');
  } catch (_) { /* asserted below */ }
  const tv = await player.evaluate(
    '({ yard: ' + TV_FOG + '(' + IN_YARD.x + ',' + IN_YARD.y + '),' +
    '   keep: ' + TV_FOG + '(' + IN_KEEP.x + ',' + IN_KEEP.y + ') })');
  rig.note('TV — courtyard ' + tv.yard + ', keep ground ' + tv.keep);
  rig.check(tv.keep < 60,
            'the revealed keep never reached the TV (alpha ' + tv.keep + '), so the courtyard ' +
            'check below means nothing');
  rig.check(tv.yard > 200,
            'the courtyard is open on the TV (alpha ' + tv.yard + ') — the players can see the ' +
            'ground the DM left dark');

  // ══ C. The hole survives a save and a reload ══
  // ⚠ THE SWITCH GOES AWAY AND BACK. Reading the record after an auto-save proves the write, not
  // the read, and the downgrade encoding rewrites `mode` on the way to disk.
  const keepScene = await dm.evaluate('currentScene.id');
  await dm.evaluate('doAutoSave()', 60000);
  await dm.evaluate('createNewScene((f => new File([f], "elsewhere.mp4", { type: f.type }))(' +
                    (await rig.fixtures.asFileExpr(dm, map)) + '))', 120000);
  await dm.waitFor('currentScene && currentScene.id !== ' + JSON.stringify(keepScene), 120000,
                   'the second scene to open');
  await dm.evaluate('switchScene(' + JSON.stringify(keepScene) + ')', 120000);
  await dm.waitFor('currentScene && currentScene.id === ' + JSON.stringify(keepScene), 60000,
                   'the keep\'s scene to come back');
  await dm.waitFor('fogCoverT === 0 && fogTransRafId === null', 30000, 'the cover to lift again');
  const reloaded = await dm.evaluate('__rigShape(' + keep + ')');
  rig.check(!!reloaded && reloaded.holes === 1,
            'the courtyard did not survive the reload — the keep came back with ' +
            ((reloaded && reloaded.holes) || 0) + ' holes');
  rig.check(!!reloaded && reloaded.mode === 'reveal',
            'the keep came back as "' + ((reloaded && reloaded.mode) || 'gone') + '" instead of ' +
            'reveal, so the downgrade encoding was written and never read back');
  await dm.evaluate(SETTLE);
  rig.check(await dm.evaluate('__rigFog(' + IN_YARD.x + ',' + IN_YARD.y + ')') > 200,
            'the reloaded keep paints no courtyard, so the field survived and the fog did not');

  // ══ D. Dragging the room carries the hole with it ══
  const DX = 220, DY = 120;
  await dm.evaluate('setShape("select"); __rigClick(' + IN_KEEP.x + ',' + IN_KEEP.y + '); 0');
  rig.check(await dm.evaluate('selectedPolygonId') === keep,
            'clicking the keep did not select it, so the drag below would move nothing');
  await dm.evaluate('__rigDrag(' + IN_KEEP.x + ',' + IN_KEEP.y + ',' +
                    (IN_KEEP.x + DX) + ',' + (IN_KEEP.y + DY) + ')');
  await dm.evaluate(SETTLE);
  const moved = await dm.evaluate('__rigShape(' + keep + ')');
  rig.check(moved.holes === 1, 'the drag dropped the courtyard entirely');
  const movedBy = { x: moved.box.x0 - reloaded.box.x0, y: moved.box.y0 - reloaded.box.y0 };
  const holeBy  = { x: moved.holeBox[0].x0 - reloaded.holeBox[0].x0,
                    y: moved.holeBox[0].y0 - reloaded.holeBox[0].y0 };
  rig.note('the keep moved ' + Math.round(movedBy.x) + ',' + Math.round(movedBy.y) +
           ' and the courtyard ' + Math.round(holeBy.x) + ',' + Math.round(holeBy.y));
  rig.check(Math.abs(movedBy.x) > 50 && Math.abs(movedBy.y) > 20,
            'the keep barely moved, so the courtyard matching it proves nothing');
  rig.check(Math.abs(holeBy.x - movedBy.x) < 2 * tol && Math.abs(holeBy.y - movedBy.y) < 2 * tol,
            'the courtyard lagged the keep by ' + Math.round(holeBy.x - movedBy.x) + ',' +
            Math.round(holeBy.y - movedBy.y) + ' — a hole is part of the shape, not a second one');
  rig.check(await dm.evaluate('__rigFog(' +
              (IN_YARD.x + DX) + ',' + (IN_YARD.y + DY) + ')') > 200,
            'the courtyard\'s fog stayed where the keep used to be');

  // ══ E. A hole's wall has handles, and one undo takes a drag back ══
  // The courtyard's left wall, at the midpoint of its new position.
  const wall = { x: YARD.x1 + DX, y: (YARD.y1 + YARD.y2) / 2 + DY };
  const eBefore = await dm.evaluate('__rigShape(' + keep + ')');
  const eUndo = await dm.evaluate('undoStack.length');
  await dm.evaluate('setShape("select"); __rigClick(' +
                    (IN_KEEP.x + DX) + ',' + (IN_KEEP.y + DY) + '); 0');
  const handles = await dm.evaluate(
    '(() => { const p = __rigById(' + keep + ');' +
    '  return { flat: flatVertexCount(p), outer: p.vertices.length,' +
    '           edge: findEdgeAt(p, ' + wall.x + ',' + wall.y + ') }; })()');
  rig.note('the keep offers ' + handles.flat + ' handles over ' + handles.outer +
           ' outer points, and the courtyard wall is edge ' + handles.edge);
  rig.check(handles.flat >= handles.outer + 3,
            'the keep offers ' + handles.flat + ' handles for ' + handles.outer + ' outer ' +
            'points, so the courtyard\'s wall carries none and cannot be grabbed');
  rig.check(handles.edge >= handles.outer,
            'the click on the courtyard wall answered edge ' + handles.edge + ', which is on ' +
            'the outer outline — the inner wall is not reachable');

  await dm.evaluate('__rigDrag(' + wall.x + ',' + wall.y + ',' +
                    (wall.x - 90) + ',' + wall.y + ')');
  await dm.evaluate(SETTLE);
  const eDragged = await dm.evaluate('__rigShape(' + keep + ')');
  rig.note('the courtyard went from ' + Math.round(eBefore.holeArea[0]) + ' to ' +
           Math.round(eDragged.holeArea[0]) + ' units²');
  rig.check(eDragged.holes === 1 && eDragged.holeArea[0] > eBefore.holeArea[0] + 10000,
            'dragging the courtyard\'s wall did not widen it — it measures ' +
            Math.round(eDragged.holeArea[0]) + ' against ' + Math.round(eBefore.holeArea[0]));
  rig.check(Math.abs(eDragged.area - eBefore.area) < 200 * tol,
            'dragging an inner wall reshaped the keep\'s outer outline too');

  await dm.evaluate('undo(); 0');
  await dm.evaluate(SETTLE);
  const eUndone = await dm.evaluate('__rigShape(' + keep + ')');
  rig.check(eUndone.holes === 1 &&
            Math.abs(eUndone.holeArea[0] - eBefore.holeArea[0]) < 400 * tol,
            'one undo did not put the courtyard back — it measures ' +
            Math.round(eUndone.holeArea[0]) + ' against the ' +
            Math.round(eBefore.holeArea[0]) + ' before the drag');
  rig.check(await dm.evaluate('undoStack.length') === eUndo,
            'a wall drag on a hole spent ' +
            ((await dm.evaluate('undoStack.length')) - eUndo + 1) + ' undo steps instead of one');

  // ══ F. A shape DRAWN inside the hole is a separate room, and stays put ══
  // ⚠ THE GESTURE DECIDES. A cut makes a hole; drawing makes a room, even in the middle of one.
  const yardNow = (await dm.evaluate('__rigShape(' + keep + ')')).holeBox[0];
  const well = { x1: Math.round(yardNow.x0 + 60), y1: Math.round(yardNow.y0 + 50),
                 x2: Math.round(yardNow.x0 + 160), y2: Math.round(yardNow.y0 + 130) };
  const fCount = await dm.evaluate('polygons.length');
  const wellId = await dm.evaluate('__rigDrawRoom("shroud", ' +
    well.x1 + ',' + well.y1 + ',' + well.x2 + ',' + well.y2 + ')');
  await dm.evaluate(SETTLE);
  rig.check(await dm.evaluate('polygons.length') === fCount + 1,
            'a shape drawn inside the courtyard made no room — drawing always makes one');
  const wellBefore = await dm.evaluate('__rigShape(' + wellId + ')');
  rig.check(wellBefore.holes === 0,
            'the room drawn in the courtyard came out with a hole of its own');
  rig.check((await dm.evaluate('__rigShape(' + keep + ')')).holes === 1,
            'drawing inside the courtyard changed the keep\'s holes');

  await dm.evaluate('setShape("select"); __rigClick(' +
                    (IN_KEEP.x + DX) + ',' + (IN_KEEP.y + DY) + '); 0');
  await dm.evaluate('__rigDrag(' + (IN_KEEP.x + DX) + ',' + (IN_KEEP.y + DY) + ',' +
                    (IN_KEEP.x + DX + 140) + ',' + (IN_KEEP.y + DY) + ')');
  await dm.evaluate(SETTLE);
  const wellAfter = await dm.evaluate('__rigShape(' + wellId + ')');
  rig.check(Math.abs(wellAfter.box.x0 - wellBefore.box.x0) < 2 * tol,
            'the room standing in the courtyard moved ' +
            Math.round(wellAfter.box.x0 - wellBefore.box.x0) + ' with the keep — it is its own ' +
            'room and stays where the DM put it');

  // ══ G. A Cut through a courtyard gives each half its own share of it ══
  // ⚠ ON CLEAR GROUND. A cut is refused WHOLE when any room it crosses is crossed more than
  // twice, so a path drawn over the blocks above would take four crossings and kill this one.
  const HALL = { x1: 300, y1: 1120, x2: 900, y2: 1420 };
  const YARD2 = { x1: 450, y1: 1200, x2: 750, y2: 1340 };
  const hall = await dm.evaluate('__rigDrawRoom("reveal", ' +
    HALL.x1 + ',' + HALL.y1 + ',' + HALL.x2 + ',' + HALL.y2 + ')');
  await dm.evaluate('__rigOpRect("trim", ' + YARD2.x1 + ',' + YARD2.y1 + ',' +
                    YARD2.x2 + ',' + YARD2.y2 + ')');
  await dm.evaluate(SETTLE);
  rig.check((await dm.evaluate('__rigShape(' + hall + ')')).holes === 1,
            'the second keep never got its courtyard, so the cut below proves nothing');

  const gCount = await dm.evaluate('polygons.length');
  const gNextId = await dm.evaluate('nextPolygonId');
  await dm.evaluate('__rigCut([[600, 1080], [600, 1460]])');
  await dm.evaluate(SETTLE);
  rig.check(await dm.evaluate('__rigDialog().up') === false,
            'the cut through the courtyard was refused: ' +
            (await dm.evaluate('__rigDialog().text')));
  rig.check(await dm.evaluate('polygons.length') === gCount + 1,
            'the cut left ' + (await dm.evaluate('polygons.length')) + ' rooms instead of ' +
            (gCount + 1));
  const halves = await dm.evaluate(
    'polygons.filter(p => p.id === ' + hall + ' || p.id >= ' + gNextId + ')' +
    '        .map(p => __rigShape(p.id))');
  rig.note('the cut halves carry ' + halves.map(h => h.holes).join(' and ') + ' hole(s)');
  rig.check(halves.length === 2 && halves.every(h => h.holes === 1),
            'a half of the cut keep lost its share of the courtyard');
  for (const h of halves) {
    if (!h.holes) continue;
    // ⚠ THE HOLE HAS TO SIT INSIDE ITS OWN HALF. A whole ring handed to one piece pokes out
    // through that piece's wall, and the fog then paints on the far side of it.
    rig.check(h.holeBox[0].x0 >= h.box.x0 - 2 * tol && h.holeBox[0].x1 <= h.box.x1 + 2 * tol,
              'a half of the keep has a courtyard reaching outside it: hole x ' +
              Math.round(h.holeBox[0].x0) + '–' + Math.round(h.holeBox[0].x1) + ' against room x ' +
              Math.round(h.box.x0) + '–' + Math.round(h.box.x1));
  }
  const gYard = await dm.evaluate(
    '({ left: __rigFog(500, 1270), right: __rigFog(700, 1270), room: __rigFog(350, 1270) })');
  rig.note('fog after the cut — courtyard left ' + gYard.left + ', right ' + gYard.right +
           ', room ground ' + gYard.room);
  rig.check(gYard.left > 200 && gYard.right > 200,
            'the cut opened the courtyard on one or both sides (left ' + gYard.left +
            ', right ' + gYard.right + ')');
  rig.check(gYard.room < 60,
            'the cut re-fogged the keep itself (alpha ' + gYard.room + ')');

  // ══ H. An effect carrying a hole renders as a ring on both screens ══
  // ⚠ ARMED FROM THE BAR. Cut out is on the Effects bar, so this is the DM's own gesture and
  // the block covers the shader and the ember clip behind it.
  const FX = { x1: 1500, y1: 300, x2: 2100, y2: 850 };
  const FX_HOLE = { x1: 1700, y1: 470, x2: 1900, y2: 680 };
  const FX_MID = { x: Math.round((FX_HOLE.x1 + FX_HOLE.x2) / 2),
                   y: Math.round((FX_HOLE.y1 + FX_HOLE.y2) / 2) };
  await dm.evaluate('setPlaceMode("effects"); setShapeOp("new"); setShape("rect");' +
                    '__rigDrag(' + FX.x1 + ',' + FX.y1 + ',' + FX.x2 + ',' + FX.y2 + ');' +
                    'setShape("select"); 0');
  const fxId = await dm.evaluate('effects[effects.length - 1].id');
  rig.check(await dm.evaluate('(() => { const b = document.getElementById("btn-op-trim");' +
                              ' return !!b && getComputedStyle(b).display !== "none"; })()'),
            'Cut out is not on the bar in Effects mode, so no DM gesture can put a hole in an ' +
            'effect and everything below is script-only');
  await dm.evaluate('document.getElementById("btn-op-trim").click(); setShape("rect");' +
                    ' __rigDrag(' + FX_HOLE.x1 + ',' + FX_HOLE.y1 + ',' +
                    FX_HOLE.x2 + ',' + FX_HOLE.y2 + ');' +
                    ' document.getElementById("btn-op-trim").click(); setShape("select"); 0');
  await dm.evaluate('effectsChanged(); scheduleRender(); sendToPlayer(); 0');
  rig.check(await dm.evaluate('__rigDialog().up') === false,
            'the trim on the effect was refused: ' + (await dm.evaluate('__rigDialog().text')));
  const fx = await dm.evaluate('__rigShape(' + fxId + ')');
  rig.check(await dm.evaluate('effects.length') === 1,
            'trimming the middle out of an effect left ' + (await dm.evaluate('effects.length')) +
            ' effects instead of one bagel-shaped burn');
  rig.check(fx.holes === 1,
            'the effect came back with ' + fx.holes + ' holes instead of 1');

  // The shader walks each ring separately, so a point in the hole must read as OUTSIDE the shape.
  // ⚠ Read through the app's own hit test, which is the same crossing-parity rule the shader runs.
  rig.check(await dm.evaluate(
              '!pointInShape(' + FX_MID.x + ',' + FX_MID.y + ', effects[0])'),
            'the middle of the bagel still reads as inside the effect, so the fire fills the ' +
            'hole instead of licking its edge');
  rig.check(await dm.evaluate(
              'pointInShape(' + (FX.x1 + 60) + ',' + (FX.y1 + 60) + ', effects[0])'),
            'the effect\'s own ground reads as outside it, so the hole inverted the whole shape');

  // The shader's ring breaks, which is what closes each ring at its own first point.
  // ⚠ READ OFF _fxInstances, not the display list. The meshes are built on the next ticker frame,
  // so children[0] is whatever was there before, or nothing at all.
  const FX_UNIFORMS = '(() => { const i = _fxInstances.get(' + fxId + ');' +
    ' if (!i) return null; const u = i.meshLight.shader.uniforms;' +
    ' let n = 0; for (let k = 0; k < u.uCount; k++) if (u.uBreak[k] > 0.5) n++;' +
    ' return { count: u.uCount, breaks: n, first: u.uBreak[0] }; })()';
  // ⚠ POLLED, NEVER READ ONCE. _loadFxGeometry runs on the next ticker frame, so a single read
  // catches the geometry from before the trim about as often as the geometry after it.
  const FX_LOADED = '(() => { const u = ' + FX_UNIFORMS + '; return !!u && u.breaks === 2; })()';
  try {
    await dm.waitFor(FX_LOADED, 30000, 'the fire to reload with its hole');
  } catch (_) { /* asserted below */ }
  const breaks = await dm.evaluate(FX_UNIFORMS) || { count: 0, breaks: 0, first: 0 };
  rig.note('the fire shader holds ' + breaks.count + ' points across ' + breaks.breaks + ' rings');
  rig.check(breaks.breaks === 2 && breaks.first > 0.5,
            'the shader was handed ' + breaks.breaks + ' ring start(s) for a shape with two, so ' +
            'it closes the outline into the hole and back');
  rig.check(breaks.count > 6 && breaks.count <= 64,
            'the shader holds ' + breaks.count + ' points — either a ring was decimated away or ' +
            'the uniform cap was blown');

  // The ember grid clips to the same shape. Inside the hole it must be the plain grid.
  await dm.evaluate('if (!gridEnabled) document.getElementById("btn-grid").click();' +
                    ' gridDirty = true; scheduleRender(); 0');
  rig.byEye('the flames lick inward from the courtyard wall as well as the outer wall');
  rig.byEye('the ember grid stops at the hole, and the plain grid shows through it');

  const fxTv = await player.evaluate(
    '(() => { const e = effects.find(x => x.id === ' + fxId + ');' +
    '  return e ? { holes: (e.holes || []).length, n: e.vertices.length } : null; })()');
  rig.check(!!fxTv && fxTv.holes === 1,
            'the effect reached the TV with ' + ((fxTv && fxTv.holes) || 0) + ' holes, so the ' +
            'players watch a solid burn while the DM sees a bagel');
  try {
    await player.waitFor(FX_LOADED, 30000, 'the fire to reload with its hole on the Player');
  } catch (_) { /* asserted below */ }
  const fxTvBreaks = await player.evaluate(FX_UNIFORMS);
  rig.check(!!fxTvBreaks && fxTvBreaks.breaks === 2,
            'the Player\'s fire shader holds ' + ((fxTvBreaks && fxTvBreaks.breaks) || 0) +
            ' ring start(s) instead of 2, so the players watch a solid burn');

  await dm.evaluate('setPlaceMode("rooms"); setShape("select"); 0');

  // ══ I. A door can be marked on an inner wall ══
  // ⚠ THE NOTCH IS DEEPENED FIRST. At the default 10% it is thinner than the fog feather, so a
  // sample either side of the wall would read the blur rather than the door.
  const CELL = 50;
  await dm.evaluate('(() => { const s = document.getElementById("grid-size"); s.value = ' + CELL +
                    '; s.dispatchEvent(new Event("input", { bubbles: true })); return 0; })()');
  rig.check(await dm.evaluate('gridSize') === CELL && await dm.evaluate('gridMode') === 'square',
            'the grid is not the square ' + CELL + 'px one the door below is cut from');

  const GATE = { x1: 1050, y1: 1120, x2: 1450, y2: 1420 };
  const GYARD = { x1: 1150, y1: 1200, x2: 1350, y2: 1340 };
  const gate = await dm.evaluate('__rigDrawRoom("reveal", ' +
    GATE.x1 + ',' + GATE.y1 + ',' + GATE.x2 + ',' + GATE.y2 + ')');
  await dm.evaluate('__rigOpRect("trim", ' + GYARD.x1 + ',' + GYARD.y1 + ',' +
                    GYARD.x2 + ',' + GYARD.y2 + ')');
  await dm.evaluate('doorDepthPct = 60; 0');
  await dm.evaluate(SETTLE);
  const gateShape = await dm.evaluate('__rigShape(' + gate + ')');
  rig.check(gateShape.holes === 1, 'the gatehouse never got its courtyard');

  const GATE_X = Math.round((GYARD.x1 + GYARD.x2) / 2);
  await dm.evaluate('setShape("door"); __rigClick(' + GATE_X + ',' + GYARD.y1 + '); 0');
  await dm.evaluate('setShape("select"); 0');
  await dm.evaluate(SETTLE);
  const marked = await dm.evaluate(
    '(() => { const p = __rigById(' + gate + ');' +
    '  const ds = p.doors || [];' +
    '  return { count: ds.length, edge: ds.length ? ds[0].edge : -1, outer: p.vertices.length,' +
    '           pt: ds.length ? doorPoint(p, ds[0]) : null }; })()');
  rig.note('the gate landed on edge ' + marked.edge + ' of ' + marked.outer + ' outer points, at ' +
           (marked.pt ? Math.round(marked.pt.x) + ',' + Math.round(marked.pt.y) : 'nowhere'));
  rig.check(marked.count === 1,
            'clicking the courtyard wall opened ' + marked.count + ' doors instead of one');
  rig.check(marked.edge >= marked.outer,
            'the gate went to edge ' + marked.edge + ', which is on the outer wall — the DM ' +
            'aimed at the courtyard and the click landed on the far side of the keep');
  rig.check(!!marked.pt && Math.abs(marked.pt.y - GYARD.y1) < 4 * tol,
            'the gate sits at y ' + (marked.pt ? Math.round(marked.pt.y) : '?') + ' instead of ' +
            'on the courtyard wall at ' + GYARD.y1);

  // ⚠ HELD AGAINST THE SAME WALL AWAY FROM THE GATE, never against a number. Both readings sit
  // the same distance inside the courtyard, so only the notch can separate them.
  const notch = await dm.evaluate(
    '({ gate: __rigFog(' + GATE_X + ',' + (GYARD.y1 + 10) + '),' +
    '   wall: __rigFog(' + (GYARD.x1 + 20) + ',' + (GYARD.y1 + 10) + '),' +
    '   deep: __rigFog(' + GATE_X + ',' + Math.round((GYARD.y1 + GYARD.y2) / 2) + ') })');
  rig.note('fog inside the courtyard — at the gate ' + notch.gate + ', along the same wall ' +
           notch.wall + ', middle ' + notch.deep);
  rig.check(notch.gate < notch.wall - 40,
            'the gate cleared no more of the courtyard than the plain wall beside it (gate ' +
            notch.gate + ', wall ' + notch.wall + '), so the players see a sealed courtyard ' +
            'where the DM marked a way through');
  rig.check(notch.deep > 200,
            'the gate opened the whole courtyard (alpha ' + notch.deep + ') instead of one cell');
};
