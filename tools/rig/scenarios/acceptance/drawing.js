'use strict';

// drawing.js — THE DRAWING FEATURE, whole.
//
// THE GOAL OF THIS FEATURE: the DM draws a shape with any tool, in any fog mode, and the
// players see the result on the TV. Every check below serves that sentence or does not belong.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks directly beneath it, in order.
//
//   A. Every drawing tool the mode offers is reachable, answers to its key, and makes one
//      shape. Three of the four shapes are reached through the flyout the shape button's right
//      click opens, and that button picks the shape it is showing. A key for a shape the mode
//      does not offer does nothing at all.
//        brush · rectangle · polygon · circle on the Rooms bar, cone on the Effects one, the
//        cone measured rather than counted because its geometry IS the tool: apex where the
//        press landed, as wide at the far end as it is long, 53.13° at the point, and a
//        shallow bow on the far edge.
//   B. The polygon tool closes the way the DM closes it.
//        clicking the first vertex · crossing an earlier line · and it keeps only the loop
//   C. A polygon that is not a shape yet is thrown away rather than committed.
//        under three vertices · Escape · switching tool mid-draw
//   D. The two drawing aids place vertices where the DM aimed.
//        snap to grid, and that it does nothing on a hex grid · straighten walls, and that it
//        leaves a wall nowhere near an axis alone · straighten rounding a cone to 15° without
//        changing how far it reaches
//   E. Every fog mode reaches the ground it covers, and half is absolute.
//   F. Half is not offered where it has no meaning, and neither is the brush.
//   G. A drawn shape leaves the DM ready to draw the next one.
//   H. Effects mode draws effects, not rooms, and the two lists never mix.
//   I. ALL THREE FOG MODES REACH THE TV. This is the half of the goal nothing used to check.
//   J. The bar shows the mode, and picking a tool never moves the bar.
//        each mode carries only its own tools and greys none of them · the strip above shows
//        the picked tool's group and nothing else · Select and Split leave the strip blank
//        WITHOUT the bar moving · the two helpers keep their state across a mode switch ·
//        switching mode on Select leaves the DM on Select
//
// ⚠ ROOMS DO NOT CROSS TO THE PLAYER, AND MUST NOT (CLAUDE.md). What crosses is the fog a room
// paints. Every TV check here reads the FOG over the ground a shape covers, never a room.
//
// ⚠ THE COMBINATION SWEEP RUNS ON THE DM, THE DELIVERY CHECK ON THE TV. Five tools times three
// fog modes is fifteen combinations, and all fifteen cross in one message — so checking each on
// the TV would test the same delivery fifteen times. The TV is checked once per distinct
// OUTCOME instead: cleared, hidden, and half. Nothing is lost and the run stays short.
//
// ⚠ THE MAP STARTS FULLY FOGGED, so a shroud shape over untouched ground changes nothing and
// its check passes without the app doing anything. Ground is revealed first wherever a shroud
// or half shape is about to be measured.
//
// ⚠ THE MAP IS ANIMATED, AND EVERY ACCEPTANCE FILE'S IS. Animated is the only kind the DM
// ever uses, so a suite running on still PNGs proved the app worked in a case that never
// happens. `tableMap` (tools/rig/fixtures.js) records the clip once per run and caches it by
// size. Do not swap it back to `stillMap`; smoke.js is the one file that wants both.

const MAP_W = 2400, MAP_H = 1500;

// A wide clearing across the top of the map. Every shroud and half check is drawn inside it.
const CLEAR = { x: 1200, y: 400, r: 620 };

const HELPERS = `
globalThis.__rigMouse = (type, mx, my, onWindow) => {
  const r = container.getBoundingClientRect();
  const ev = new MouseEvent(type, {
    clientX: mx * zoom + panX + r.left, clientY: my * zoom + panY + r.top,
    bubbles: true, cancelable: true, button: 0,
  });
  (onWindow ? window : container).dispatchEvent(ev);
};
globalThis.__rigDrag = (x1, y1, x2, y2) => {
  __rigMouse('mousedown', x1, y1); __rigMouse('mousemove', (x1+x2)/2, (y1+y2)/2);
  __rigMouse('mousemove', x2, y2); __rigMouse('mouseup', x2, y2);
};
// A polygon is built from CLICKS, not a drag: each mousedown places one vertex.
globalThis.__rigClick = (mx, my) => { __rigMouse('mousedown', mx, my); __rigMouse('mouseup', mx, my); };
globalThis.__rigKey = (k) => document.dispatchEvent(
  new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
// Alpha of the DM's own fog data over one map point. 255 hidden, 0 clear.
globalThis.__rigFog = (mx, my) => fogDataCtx.getImageData(
  Math.round(mx / FOG_SCALE), Math.round(my / FOG_SCALE), 1, 1).data[3];
globalThis.__rigLast = () => polygons[polygons.length - 1];
// A cone's own measurements, read off the COMMITTED VERTICES rather than off the drag: the press
// and release land on whole screen pixels, so the map-space length is never exactly what was
// asked for and every check has to be relative to the shape itself.
// ⚠ THE CORNERS ARE THE FIRST AND LAST VERTEX. The far edge is a shallow arc, so everything
// between them is arc; measuring v[1] to v[2] would measure one segment of the bulge and every
// check would run against the wrong number.
globalThis.__rigCone = (v) => {
  const c1 = v[1], c2 = v[v.length - 1];
  const mid = { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 };
  const a = Math.atan2(c1.y - v[0].y, c1.x - v[0].x);
  const b = Math.atan2(c2.y - v[0].y, c2.x - v[0].x);
  let spread = Math.abs(a - b);
  if (spread > Math.PI) spread = 2 * Math.PI - spread;
  const length = Math.hypot(mid.x - v[0].x, mid.y - v[0].y);
  // How far the far edge bulges past the straight line between the corners, as a fraction of the
  // length. Zero means the edge came out flat.
  // ⚠ MEASURED ALONG THE AXIS FROM THE CHORD, not as distance from the apex. A triangle's own
  // corners sit 11.8% further from the apex than the middle of a shallow arc does, so a
  // furthest-from-the-apex reading returns 11.8% for a FLAT edge and cannot fail.
  // ⚠ AND SCANNED, not indexed. Indexing the middle of the arc reads undefined on a three-vertex
  // cone, so the check threw instead of reporting the flat edge it exists to catch.
  const ax = (mid.x - v[0].x) / length, ay = (mid.y - v[0].y) / length;
  let sagitta = 0;
  for (let i = 1; i < v.length; i++) {
    const d = (v[i].x - mid.x) * ax + (v[i].y - mid.y) * ay;
    if (d > sagitta) sagitta = d;
  }
  return {
    apex: v[0], n: v.length, length,
    width: Math.hypot(c1.x - c2.x, c1.y - c2.y),
    spreadDeg: spread * 180 / Math.PI,
    headingDeg: Math.atan2(mid.y - v[0].y, mid.x - v[0].x) * 180 / Math.PI,
    bulge: sagitta / length,
  };
};
0`;

// The same reading on the Player. Its fogDataCanvas is the map it was sent.
const TV_FOG = `((mx, my) => fogDataCtx.getImageData(
  Math.round(mx / FOG_SCALE), Math.round(my / FOG_SCALE), 1, 1).data[3])`;

module.exports = async function drawing(rig) {
  const dm = rig.dm;

  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir,
    { w: MAP_W, h: MAP_H });
  await dm.evaluate('createNewScene(' + (await rig.fixtures.asFileExpr(dm, map)) + ')', 120000);
  await dm.waitFor('currentScene && currentScene.mapType === "video" && mapWidth === ' + MAP_W,
                   120000, 'the map to load on the DM');
  await dm.evaluate(HELPERS);

  // ══ A. Every tool the mode offers is reachable, and a key for one it does not is inert ══
  // The four shapes stand behind one button and are reached through its flyout, so `where`
  // says which container each tool must actually be in. A tool the mode does not offer is
  // ABSENT, so `display` is read too — an id that resolves proves nothing on its own.
  const checkTool = async (t) => {
    const placed = await dm.evaluate(
      '(() => { const b = document.getElementById("' + t.id + '");' +
      ' return { there: !!b, placed: !!(b && b.closest("' + t.where + '")),' +
      '   offered: !!b && getComputedStyle(b).display !== "none" }; })()');
    rig.check(placed.there && placed.placed && placed.offered,
              t.id + ' is not offered inside ' + t.where + ': ' + JSON.stringify(placed));

    // Picked by its button, then by its key from a different tool — a key that only "works"
    // because the tool was already selected proves nothing.
    await dm.evaluate('document.getElementById("' + t.id + '").click(); 0');
    rig.check(await dm.evaluate('shape') === t.shape,
              'clicking ' + t.id + ' did not pick the ' + t.shape + ' tool');
    await dm.evaluate('setShape("select"); __rigKey("' + t.key + '"); 0');
    rig.check(await dm.evaluate('shape') === t.shape,
              'the ' + t.key.toUpperCase() + ' key did not pick the ' + t.shape + ' tool');
  };
  const TOOLS = [
    { id: 'btn-brush',  shape: 'brush',  key: 'b', where: '#toolbar-bottom' },
    { id: 'btn-rect',   shape: 'rect',   key: 'e', where: '#shape-menu' },
    { id: 'btn-poly',   shape: 'poly',   key: 'p', where: '#shape-menu' },
    { id: 'btn-circle', shape: 'circle', key: 'c', where: '#shape-menu' },
  ];
  for (const t of TOOLS) await checkTool(t);

  // The Cone is an EFFECTS tool. No room is ever cone-shaped, so Rooms does not list it.
  await dm.evaluate('setPlaceMode("effects"); 0');
  await checkTool({ id: 'btn-cone', shape: 'cone', key: 'o', where: '#shape-menu' });
  // A key for a shape the mode does not offer does NOTHING — no mode switch, no fallback, no
  // message. The bar has no button for it there either, so the key must match the bar.
  await dm.evaluate('setShape("select"); __rigKey("b"); 0');
  rig.check(await dm.evaluate('shape') === 'select',
            'B in Effects mode picked the Brush, which that bar does not carry');
  await dm.evaluate('setPlaceMode("rooms"); setShape("select"); __rigKey("o"); 0');
  rig.check(await dm.evaluate('shape') === 'select',
            'O in Rooms mode picked the Cone, which that bar does not carry');

  // The flyout is the only way in for three of the four shapes, so the right click that opens it
  // is part of them being reachable at all.
  const opened = await dm.evaluate(
    '(() => { document.getElementById("btn-shape").dispatchEvent(new MouseEvent("contextmenu",' +
    ' { bubbles: true, cancelable: true, button: 2 }));' +
    ' return document.getElementById("shape-menu").classList.contains("open"); })()');
  rig.check(opened, 'right-clicking the shape button did not open the flyout, which is the only ' +
                    'way the DM reaches Rectangle, Circle and Polygon');
  const took = await dm.evaluate('document.getElementById("btn-circle").click();' +
    ' ({ shape, open: document.getElementById("shape-menu").classList.contains("open") })');
  rig.check(took.shape === 'circle' && !took.open,
            'picking Circle from the flyout did not both take and shut it: ' + JSON.stringify(took));

  // ⚠ THE BUTTON MUST PICK THE SHAPE IT IS SHOWING. It wears the last shape this mode drew with,
  // and a left click from any other tool - the Brush included - has to land on that same one.
  const glyph = await dm.evaluate('setShape("brush");' +
    ' document.getElementById("btn-shape").querySelector(".tb-shape-glyph").innerHTML');
  const after = await dm.evaluate('document.getElementById("btn-shape").click();' +
    ' ({ shape, glyph: document.getElementById("btn-" + shape).innerHTML })');
  rig.check(after.shape === 'circle' && after.glyph === glyph,
            'the shape button showed one shape and picked another - it landed on ' + after.shape +
            ' while wearing a different glyph');

  // Each tool draws once, in Reveal, over untouched map. One shape each, and the brush paints
  // fog without making one at all — that difference IS the brush.
  await dm.evaluate('document.getElementById("btn-reveal").click(); 0');
  rig.check(await dm.evaluate('tool') === 'reveal', 'the Reveal button did not take');

  await dm.evaluate('setShape("brush"); __rigDrag(200, 1200, 400, 1200); 0');
  rig.check(await dm.evaluate('polygons.length') === 0,
            'the brush created a room — it paints fog directly and makes no shape');
  // ⚠ ONLY THE PRESS POINT IS PAINTED AT ONCE. The rest of a stroke is queued in
  // pendingBrushOps and flushed by the render loop, so sampling the middle of the stroke before
  // that flush reads untouched fog and looks like a brush that does nothing.
  await dm.evaluate('scheduleRender(); 0');
  await dm.waitFor('pendingBrushOps.length === 0', 15000, 'the brush stroke to be painted');
  rig.check(await dm.evaluate('__rigFog(300, 1200)') < 60,
            'a brush stroke in Reveal did not clear the ground it crossed');

  await dm.evaluate('setShape("rect"); __rigDrag(600, 1150, 850, 1300); 0');
  rig.check(await dm.evaluate('polygons.length') === 1, 'the Rectangle tool made no room');
  await dm.evaluate('setShape("circle"); __rigDrag(1100, 1250, 1100, 1380); 0');
  rig.check(await dm.evaluate('polygons.length') === 2, 'the Circle tool made no room');
  // The cone is measured rather than counted, because its geometry IS the tool. A DM drawing a
  // triangle by hand would not get a 53.13° spread, and that number is the whole reason the
  // tool exists.
  const CONE = { x: 1500, y: 1250, len: 250 };
  await dm.evaluate('setShape("cone"); __rigDrag(' + CONE.x + ',' + CONE.y + ',' +
                    (CONE.x + CONE.len) + ',' + CONE.y + '); 0');
  rig.check(await dm.evaluate('polygons.length') === 3, 'the Cone tool made no room');
  const flat = await dm.evaluate('__rigCone(__rigLast().vertices)');
  rig.note('flat cone — length ' + flat.length.toFixed(1) + ', far width ' + flat.width.toFixed(1) +
           ', spread ' + flat.spreadDeg.toFixed(3) + '°, far-edge bow ' +
           (flat.bulge * 100).toFixed(1) + '% of the length');
  rig.check(flat.n > 3, 'the cone came out with ' + flat.n + ' vertices, so its far edge is flat');
  rig.check(Math.abs(flat.apex.x - CONE.x) < 2 && Math.abs(flat.apex.y - CONE.y) < 2,
            'the cone\'s point is not where the press landed, so it grew from the wrong end');
  rig.check(Math.abs(flat.headingDeg) < 0.5,
            'a cone dragged straight right came out pointing ' + flat.headingDeg.toFixed(2) + '°');
  rig.check(Math.abs(flat.width - flat.length) < 1e-6,
            'the cone is not as wide at its far end as it is long (' + flat.width.toFixed(2) +
            ' against ' + flat.length.toFixed(2) + '), so it is not a D&D cone');
  rig.check(Math.abs(flat.spreadDeg - 53.13010235415598) < 1e-6,
            'the cone opens at ' + flat.spreadDeg.toFixed(4) + '° rather than 53.1301°');
  // The far edge is an ARC, not a straight line. Bounded on both sides: no bow means a plain
  // triangle, and too much bow would make the cone cover ground a real one does not.
  rig.check(flat.bulge > 0.01, 'the cone\'s far edge came out flat rather than bowed');
  rig.check(flat.bulge < 0.2, 'the cone\'s far edge bows too far out (' +
            (flat.bulge * 100).toFixed(1) + '% of its length)');

  // ══ B. The polygon tool closes the way the DM closes it ══
  // B1 — clicking back on the first vertex. POLY_CLOSE_RADIUS is 12 SCREEN px, so the click
  // lands a little off the first vertex on purpose: an exact repeat would also pass if the
  // proximity test were gone.
  await dm.evaluate('setShape("poly"); 0');
  await dm.evaluate('__rigClick(200, 200); __rigClick(500, 200); __rigClick(500, 400); 0');
  rig.check(await dm.evaluate('!!activePolygon && activePolygon.vertices.length === 3'),
            'three clicks did not build a three-vertex polygon in progress');
  const nearFirst = await dm.evaluate('(() => { const z = zoom; return 200 + (POLY_CLOSE_RADIUS / z) * 0.5; })()');
  await dm.evaluate('__rigClick(' + nearFirst + ', 200); 0');
  rig.check(await dm.evaluate('activePolygon') === null,
            'clicking near the first vertex did not close the polygon');
  rig.check(await dm.evaluate('polygons.length') === 4,
            'closing on the first vertex did not commit a room');
  rig.check(await dm.evaluate('__rigLast().vertices.length') === 3,
            'closing on the first vertex added a duplicate vertex instead of joining up');

  // B2 — closing by crossing an earlier line. Four vertices in a hook, then a fifth click whose
  // segment crosses the first one. The shape closes on the crossing point, and THE TAIL BEFORE
  // THE CROSSING IS DROPPED — that is the half a vertex count alone would miss.
  await dm.evaluate('__rigClick(1900, 200); __rigClick(2200, 200);' +
                    ' __rigClick(2200, 500); __rigClick(2050, 500); 0');
  rig.check(await dm.evaluate('activePolygon.vertices.length') === 4,
            'the four-vertex hook was not built');
  await dm.evaluate('__rigClick(2050, 100); 0');   // crosses the 1900,200 → 2200,200 segment
  rig.check(await dm.evaluate('activePolygon') === null,
            'a segment crossing an earlier line did not close the polygon');
  rig.check(await dm.evaluate('polygons.length') === 5,
            'closing by self-intersection did not commit a room');
  const loop = await dm.evaluate('__rigLast().vertices');
  rig.note('self-intersect close kept ' + loop.length + ' vertices: ' +
           loop.map(v => Math.round(v.x) + ',' + Math.round(v.y)).join('  '));
  rig.check(loop.length === 4,
            'the self-intersect close kept ' + loop.length + ' vertices, not the 4 of the loop — ' +
            'the tail before the crossing was not dropped');
  rig.check(!loop.some(v => Math.abs(v.x - 1900) < 1 && Math.abs(v.y - 200) < 1),
            'the vertex before the crossing is still in the shape, so the tail was kept');

  // ══ C. A polygon that is not a shape yet is thrown away ══
  const before = await dm.evaluate('polygons.length');

  // C1 — under three vertices. Two clicks then a close attempt on the first: nothing to commit.
  await dm.evaluate('__rigClick(300, 900); __rigClick(400, 900); __rigClick(300, 900); 0');
  rig.check(await dm.evaluate('polygons.length') === before,
            'a two-vertex polygon was committed as a room');

  // C2 — Escape.
  await dm.evaluate('setShape("poly"); __rigClick(700, 900); __rigClick(900, 900);' +
                    ' __rigClick(900, 1000); 0');
  rig.check(await dm.evaluate('!!activePolygon'), 'the polygon under test was never started');
  await dm.evaluate('__rigKey("Escape"); 0');
  rig.check(await dm.evaluate('activePolygon') === null, 'Escape did not cancel the polygon');
  rig.check(await dm.evaluate('polygons.length') === before,
            'Escape committed the half-drawn polygon instead of discarding it');

  // C3 — switching tool mid-draw. The half-drawn shape must not survive to be finished later
  // by clicks meant for another tool.
  await dm.evaluate('__rigClick(700, 1000); __rigClick(900, 1000); __rigClick(900, 1100); 0');
  await dm.evaluate('setShape("rect"); 0');
  rig.check(await dm.evaluate('activePolygon') === null,
            'switching tool left the half-drawn polygon alive');
  rig.check(await dm.evaluate('polygons.length') === before,
            'switching tool committed the half-drawn polygon');

  // ══ D. The two drawing aids place vertices where the DM aimed ══
  // D1 — snap to grid. It needs the grid ON and SQUARE; both are asserted, because with the
  // grid off snapVertex returns the raw point and every check here would pass unsnapped.
  await dm.evaluate('(() => { if (!gridEnabled) document.getElementById("btn-grid").click();' +
                    ' return 0; })()');
  await dm.evaluate('(() => { const s = document.getElementById("grid-size");' +
                    ' s.value = 100; s.dispatchEvent(new Event("input", { bubbles: true }));' +
                    ' return 0; })()');
  await dm.evaluate('(() => { if (!snapToGrid) document.getElementById("btn-snap").click();' +
                    ' return 0; })()');
  const aids = await dm.evaluate('({ grid: gridEnabled, mode: gridMode, size: gridSize, snap: snapToGrid })');
  rig.check(aids.grid && aids.mode === 'square' && aids.snap,
            'snap to grid cannot be under test: ' + JSON.stringify(aids));

  await dm.evaluate('setShape("poly"); 0');
  await dm.evaluate('__rigClick(317, 723); __rigClick(688, 741); __rigClick(661, 1044); 0');
  const snapped = await dm.evaluate('activePolygon.vertices');
  rig.note('snapped vertices: ' + snapped.map(v => v.x + ',' + v.y).join('  '));
  rig.check(snapped.every(v => v.x % aids.size === 0 && v.y % aids.size === 0),
            'snap to grid left a vertex off the grid: ' +
            snapped.map(v => v.x + ',' + v.y).join(' '));
  await dm.evaluate('__rigKey("Escape"); 0');

  // D2 — snap does NOTHING on a hex grid. There are no intersections to snap to, so the raw
  // point has to survive; rounding it to a square lattice would move vertices the DM placed.
  await dm.evaluate('document.getElementById("btn-grid-hflat").click(); 0');
  rig.check(await dm.evaluate('gridMode') === 'hex-flat', 'the grid did not switch to hex');
  await dm.evaluate('setShape("poly"); __rigClick(317, 723); 0');
  const onHex = await dm.evaluate('activePolygon.vertices[0]');
  rig.check(Math.abs(onHex.x - 317) < 2 && Math.abs(onHex.y - 723) < 2,
            'a vertex was snapped to a square lattice on a HEX grid (landed ' +
            Math.round(onHex.x) + ',' + Math.round(onHex.y) + ')');
  await dm.evaluate('__rigKey("Escape"); document.getElementById("btn-grid-sq").click();' +
                    ' if (snapToGrid) document.getElementById("btn-snap").click(); 0');
  rig.check(await dm.evaluate('!snapToGrid && gridMode === "square"'),
            'the grid aids were not put back before the straighten checks');

  // D3 — straighten walls. A vertex placed a few px off horizontal from the previous one snaps
  // flat. AXIS_LOCK_PX is 12 SCREEN px, so the offset is chosen inside that in map units.
  await dm.evaluate('(() => { if (!axisLock) document.getElementById("btn-axislock").click();' +
                    ' return 0; })()');
  rig.check(await dm.evaluate('axisLock') === true, 'Straighten walls did not switch on');
  // ⚠ COMPARE AGAINST THE VERTEX THAT WAS ACTUALLY PLACED, NEVER THE ONE AIMED AT.
  // MouseEvent.clientX/Y truncate to whole screen pixels, so a map coordinate makes the round
  // trip with up to 1/zoom of error and no vertex lands exactly where the scenario asked. The
  // snap itself IS exact — it copies the previous vertex's y — so reading that vertex back and
  // comparing to it keeps the check tight instead of loosening it to swallow the error.
  const slack = await dm.evaluate('(AXIS_LOCK_PX / zoom) * 0.5');
  await dm.evaluate('setShape("poly"); __rigClick(400, 1300); 0');
  const v0 = await dm.evaluate('activePolygon.vertices[0]');
  await dm.evaluate('__rigClick(700, ' + (1300 + slack) + '); 0');
  const v1 = await dm.evaluate('activePolygon.vertices[1]');
  const tol = 2 / (await dm.evaluate('zoom'));
  rig.note('straighten — first vertex y ' + v0.y.toFixed(2) + ', second ' + v1.y.toFixed(2) +
           ' after being aimed ' + slack.toFixed(1) + ' below it');
  rig.check(v1.y === v0.y,
            'Straighten walls left a near-horizontal wall crooked: the second vertex sits at y ' +
            v1.y + ' while the first is at ' + v0.y);
  rig.check(Math.abs(v1.x - 700) < tol,
            'Straighten walls moved the vertex ALONG the wall as well as across it (x ' + v1.x +
            ' against the 700 it was aimed at)');

  // D4 — a vertex FAR off the axis is left alone. Without this, a straighten that flattened
  // every wall would pass D3 and look correct.
  await dm.evaluate('__rigClick(1000, 1000); 0');
  const v2 = await dm.evaluate('activePolygon.vertices[2]');
  rig.check(Math.abs(v2.y - v1.y) > 100,
            'Straighten walls flattened a wall that was nowhere near an axis: it was aimed 300 ' +
            'map units above the previous vertex and landed at y ' + v2.y);
  await dm.evaluate('__rigKey("Escape"); 0');

  // D5 — straighten rounds a CONE's direction to 15°, and rounding the direction must not
  // change how far the cone reaches. A cone is aimed by eye at the table, so the rounding is
  // what makes two cones at the same bearing actually match.
  const SLOPED = { x: 500, y: 600, dx: 300, dy: 110 };   // about 20°, which rounds down to 15
  await dm.evaluate('setShape("cone");' +
                    ' __rigDrag(' + SLOPED.x + ',' + SLOPED.y + ',' +
                    (SLOPED.x + SLOPED.dx) + ',' + (SLOPED.y + SLOPED.dy) + '); 0');
  const sloped = await dm.evaluate('__rigCone(__rigLast().vertices)');
  const rawDeg = Math.atan2(SLOPED.dy, SLOPED.dx) * 180 / Math.PI;
  rig.note('sloped cone — dragged at ' + rawDeg.toFixed(2) + '°, committed at ' +
           sloped.headingDeg.toFixed(4) + '°');
  rig.check(Math.abs(sloped.headingDeg - 15) < 1e-6,
            'Straighten walls did not round a ' + rawDeg.toFixed(1) + '° cone to 15°: it came out ' +
            'at ' + sloped.headingDeg.toFixed(4) + '°');
  rig.check(Math.abs(sloped.width - sloped.length) < 1e-6,
            'rounding the direction broke the width-equals-length rule (' +
            sloped.width.toFixed(2) + ' against ' + sloped.length.toFixed(2) + ')');
  rig.check(Math.abs(sloped.length - Math.hypot(SLOPED.dx, SLOPED.dy)) < 3,
            'rounding the direction also changed how far the cone reaches (' +
            sloped.length.toFixed(1) + ' against a drag of ' +
            Math.hypot(SLOPED.dx, SLOPED.dy).toFixed(1) + ')');
  await dm.evaluate('__rigKey("Escape");' +
                    ' if (axisLock) document.getElementById("btn-axislock").click(); 0');

  // ══ E. Every fog mode reaches the ground it covers, and half is absolute ══
  // The clearing every shroud and half shape is measured inside.
  await dm.evaluate('revealCircle(' + CLEAR.x + ',' + CLEAR.y + ',' + CLEAR.r + ');' +
                    'rebuildFogEffect(); fogDirty = true; scheduleRender(); 0');
  await dm.waitFor('fogCoverT === 0 && fogTransRafId === null', 30000, 'the clearing to open');

  const HALF = { x: 900, y: 300 }, SHROUD = { x: 1200, y: 300 }, REVEAL = { x: 1500, y: 300 };
  const box = (c, w, h) => [c.x - w, c.y - h, c.x + w, c.y + h];

  await dm.evaluate('document.getElementById("btn-shroud").click(); setShape("rect"); 0');
  await dm.evaluate('__rigDrag(' + box(SHROUD, 90, 90).join(',') + '); 0');
  rig.check(await dm.evaluate('__rigLast().mode') === 'shroud',
            'the room did not carry the Shroud mode picked on the toolbar');

  await dm.evaluate('document.getElementById("btn-half").click(); 0');
  rig.check(await dm.evaluate('tool') === 'half', 'the Half button did not take');
  await dm.evaluate('__rigDrag(' + box(HALF, 90, 90).join(',') + '); 0');
  rig.check(await dm.evaluate('__rigLast().mode') === 'half',
            'the room did not carry the Half mode picked on the toolbar');

  await dm.evaluate('document.getElementById("btn-reveal").click(); 0');
  await dm.evaluate('__rigDrag(' + box(REVEAL, 90, 90).join(',') + '); 0');
  rig.check(await dm.evaluate('__rigLast().mode') === 'reveal',
            'the room did not carry the Reveal mode picked on the toolbar');

  await dm.evaluate('rebuildFogFromPolygons(); rebuildFogEffect(); fogDirty = true;' +
                    ' scheduleRender(); scheduleAutoSync(); 0');
  await dm.waitFor('fogTransRafId === null', 30000, 'the fog to settle after the three modes');

  const halfWant = await dm.evaluate('Math.round(fogHalfAlpha * 255)');
  const dmFog = await dm.evaluate(
    '({ reveal: __rigFog(' + REVEAL.x + ',' + REVEAL.y + '),' +
    '   shroud: __rigFog(' + SHROUD.x + ',' + SHROUD.y + '),' +
    '   half:   __rigFog(' + HALF.x + ',' + HALF.y + ') })');
  rig.note('DM fog by mode — reveal ' + dmFog.reveal + ', half ' + dmFog.half +
           ' (want ~' + halfWant + '), shroud ' + dmFog.shroud);
  rig.check(dmFog.reveal < 40, 'a Reveal room left its ground fogged (alpha ' + dmFog.reveal + ')');
  rig.check(dmFog.shroud > 200, 'a Shroud room left its ground visible (alpha ' + dmFog.shroud + ')');
  // ABSOLUTE, not "somewhere between". A half room lands on exactly fogHalfAlpha whatever was
  // underneath it (fog.js), so a check for "between reveal and shroud" would also pass on fog
  // that merely faded — which is a different behaviour with the same shape.
  rig.check(Math.abs(dmFog.half - halfWant) <= 12,
            'a Half room did not land on the half value: alpha ' + dmFog.half +
            ' against the ' + halfWant + ' fogHalfAlpha asks for');

  // ══ F. Half is not offered where it has no meaning, and neither is the brush ══
  await dm.evaluate('document.getElementById("btn-half").click(); setShape("brush"); 0');
  rig.check(await dm.evaluate('document.getElementById("btn-half").disabled') === true,
            'the Half button is still live while the brush is picked, and the brush cannot paint half');
  rig.check(await dm.evaluate('tool') === 'shroud',
            'picking the brush on a live Half direction did not fall back to Shroud — more fog ' +
            'is the safe accident, and the highlight moving is what tells the DM it happened');

  await dm.evaluate('setPlaceMode("effects"); 0');
  rig.check(await dm.evaluate('shape') !== 'brush',
            'the brush survived into Effects mode, where it has nothing to paint');
  await dm.evaluate('setPlaceMode("rooms"); 0');

  // ══ G. A drawn shape leaves the DM ready to draw the next one ══
  await dm.evaluate('document.getElementById("btn-shroud").click(); setShape("rect"); 0');
  await dm.evaluate('__rigDrag(300, 1350, 500, 1450); 0');
  rig.check(await dm.evaluate('selectedPolygonId') === null,
            'the new room came out SELECTED, so its card opens over the map before the DM has ' +
            'drawn the next one');
  rig.check(/^Room \d+$/.test(await dm.evaluate('__rigLast().name') || ''),
            'the new room was not given a default name');

  // ══ H. Effects mode draws effects, not rooms, and the two lists never mix ══
  const roomsBefore = await dm.evaluate('polygons.length');
  const fogBefore = await dm.evaluate('__rigFog(1900, 900)');
  await dm.evaluate('setPlaceMode("effects"); setShape("rect"); 0');
  await dm.evaluate('__rigDrag(1800, 800, 2000, 1000); 0');
  rig.check(await dm.evaluate('effects.length') === 1, 'drawing in Effects mode made no effect');
  rig.check(await dm.evaluate('polygons.length') === roomsBefore,
            'drawing in Effects mode appended to the ROOMS list as well');
  rig.check(await dm.evaluate('__rigFog(1900, 900)') === fogBefore,
            'an effect painted fog. Effects mark ground, they never hide or reveal it');
  await dm.evaluate('setPlaceMode("rooms"); 0');

  // ══ I. All three fog modes reach the TV ══
  // The delivery check. Read from the Player's own fog data, which is what it was sent.
  rig.check(await dm.evaluate('autoSync === true'),
            'auto-sync is off, so nothing drawn above could reach the Player and every check ' +
            'below would be reading the TV\'s own starting state');
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen && !!fogDataCanvas', 45000, 'the Player to receive the map');
  await player.waitFor('fogCoverT === 0', 45000, 'the scene cover to lift on the Player');
  await dm.evaluate('sendToPlayer(); 0');

  try {
    await player.waitFor(TV_FOG + '(' + SHROUD.x + ',' + SHROUD.y + ') > 200', 30000,
                         'the drawn shapes to reach the Player');
  } catch (_) {}
  const tv = await player.evaluate(
    '({ reveal: ' + TV_FOG + '(' + REVEAL.x + ',' + REVEAL.y + '),' +
    '   shroud: ' + TV_FOG + '(' + SHROUD.x + ',' + SHROUD.y + '),' +
    '   half:   ' + TV_FOG + '(' + HALF.x + ',' + HALF.y + '),' +
    '   rooms:  (typeof polygons !== "undefined" && polygons) ? polygons.length : 0 })');
  rig.note('TV fog by mode — reveal ' + tv.reveal + ', half ' + tv.half + ', shroud ' + tv.shroud);
  rig.check(tv.reveal < 40,
            'a Reveal room is still fogged on the TV (alpha ' + tv.reveal + ') — the DM uncovered ' +
            'ground the players cannot see');
  rig.check(tv.shroud > 200,
            'a Shroud room is not hidden on the TV (alpha ' + tv.shroud + ') — the players can ' +
            'see ground the DM covered');
  rig.check(Math.abs(tv.half - halfWant) <= 12,
            'a Half room did not arrive at the half value on the TV: alpha ' + tv.half +
            ' against ' + halfWant);
  rig.check(tv.rooms === 0,
            'the TV is holding ' + tv.rooms + ' room(s). Rooms are DM-only and a room carries the ' +
            'name and notes the DM wrote for themselves');

  // ══ J. The bar shows the mode, and picking a tool never moves the bar ══
  // Every button that can appear on the bar, and whether it is drawn and whether it is greyed.
  const BAR = `(() => {
    const ids = ['btn-select', 'btn-shape', 'btn-brush', 'btn-door', 'btn-cut',
                 'btn-op-join', 'btn-op-trim', 'btn-cone'];
    const out = { shown: [], greyed: [] };
    for (const id of ids) {
      const b = document.getElementById(id);
      if (!b) continue;
      if (getComputedStyle(b).display !== 'none') out.shown.push(id);
      if (b.disabled) out.greyed.push(id);
    }
    return out;
  })()`;
  await dm.evaluate('setPlaceMode("rooms"); setShape("rect"); 0');
  const barRooms = await dm.evaluate(BAR);
  rig.check(barRooms.shown.join() ===
            'btn-select,btn-shape,btn-brush,btn-door,btn-cut,btn-op-join,btn-op-trim',
            'the Rooms bar is not Select, Shape, Brush, Door, Split, Merge, Cut out: ' +
            barRooms.shown.join(' '));
  rig.check(barRooms.greyed.length === 0,
            'the Rooms bar greys a tool instead of leaving it off: ' + barRooms.greyed.join(' '));
  await dm.evaluate('setPlaceMode("effects"); 0');
  const barFx = await dm.evaluate(BAR);
  rig.check(barFx.shown.join() === 'btn-select,btn-shape,btn-cone',
            'the Effects bar is not Select and Shape (with the Cone in its flyout): ' +
            barFx.shown.join(' '));
  rig.check(barFx.greyed.length === 0,
            'the Effects bar greys a tool instead of leaving it off: ' + barFx.greyed.join(' '));

  // The strip above carries the picked tool's group and nothing else.
  const STRIP = `(() => {
    const ids = ['ctx-rooms', 'ctx-effects', 'ctx-door', 'panel-brush-bottom'];
    const row = document.getElementById('context-row');
    return { groups: ids.filter(id => {
               const el = document.getElementById(id);
               return el && getComputedStyle(el).display !== 'none';
             }), row: getComputedStyle(row).visibility,
             rowH: Math.round(row.getBoundingClientRect().height),
             top: Math.round(document.getElementById('toolbar-bottom').getBoundingClientRect().top) };
  })()`;
  const stripFx = await dm.evaluate('setShape("rect"); ' + STRIP);
  rig.check(stripFx.groups.join() === 'ctx-effects',
            'a shape in Effects mode shows more than the materials group: ' + stripFx.groups.join(' '));
  await dm.evaluate('setPlaceMode("rooms"); 0');
  const stripShape = await dm.evaluate('setShape("rect"); ' + STRIP);
  rig.check(stripShape.groups.join() === 'ctx-rooms,panel-brush-bottom',
            'a shape in Rooms mode does not show the fog trio and the brush size together: ' +
            stripShape.groups.join(' '));
  const stripDoor = await dm.evaluate('setShape("door"); ' + STRIP);
  rig.check(stripDoor.groups.join() === 'ctx-door',
            'the Door tool shows more than the door fields: ' + stripDoor.groups.join(' '));

  const stripSelect = await dm.evaluate('setShape("select"); ' + STRIP);
  const stripSplit  = await dm.evaluate('setShape("cut"); ' + STRIP);
  rig.check(stripSelect.groups.length === 0 && stripSelect.row === 'hidden',
            'the strip is not blank and hidden on Select: ' + JSON.stringify(stripSelect));
  rig.check(stripSplit.groups.length === 0 && stripSplit.row === 'hidden',
            'the strip is not blank and hidden on Split: ' + JSON.stringify(stripSplit));
  // ⚠ THE BOX IS WHAT THIS GUARDS, and reading the bar's position does not guard it. #tools-wrapper
  // is fixed to the screen's bottom edge, so the bar sits the same distance up whether the strip
  // holds its box or leaves the layout entirely. A blank strip measuring 0 tall is the failure —
  // it means someone reached for `display: none`, and everything ABOVE the bar then jumps.
  rig.check(stripSelect.rowH > 0 && stripSplit.rowH > 0,
            'the blank strip gave up its layout box — select ' + stripSelect.rowH + 'px, split ' +
            stripSplit.rowH + 'px against ' + stripShape.rowH + 'px with a shape picked. Hide it ' +
            'with `visibility`, never `display`.');
  rig.check(stripSelect.top === stripShape.top && stripSplit.top === stripShape.top,
            'the bar MOVED when the strip went blank — shape ' + stripShape.top + ', select ' +
            stripSelect.top + ', split ' + stripSplit.top + '. The DM aims at a bar that is ' +
            'no longer where they last saw it.');

  // The helpers belong to neither mode, so a mode switch leaves them where the DM set them.
  await dm.evaluate('document.getElementById("btn-snap").click();' +
                    ' document.getElementById("btn-axislock").click(); 0');
  const helpersOn = await dm.evaluate('({ snap: snapToGrid, axis: axisLock })');
  await dm.evaluate('setPlaceMode("effects"); 0');
  const helpersFx = await dm.evaluate('({ snap: snapToGrid, axis: axisLock })');
  rig.check(helpersFx.snap === helpersOn.snap && helpersFx.axis === helpersOn.axis,
            'Snap or Straighten changed state on a mode switch, and neither belongs to a mode');

  // Select is in both modes' tool sets, so a mode switch must never replace it.
  await dm.evaluate('setPlaceMode("rooms"); setShape("select"); setPlaceMode("effects"); 0');
  rig.check(await dm.evaluate('shape') === 'select',
            'switching to Effects moved the DM off Select, which is the tool this app is ' +
            'mostly used with');
  await dm.evaluate('setPlaceMode("rooms"); 0');
  rig.check(await dm.evaluate('shape') === 'select',
            'switching back to Rooms moved the DM off Select');
};
