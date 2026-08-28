'use strict';

// grid.js — THE GRID FEATURE, whole.
//
// THE GOAL OF THIS FEATURE: the DM lays a grid over the map so distances can be counted at the
// table, dials it until its squares sit on the map's own squares, and the players see the same
// lattice on the TV. A grid belongs to the map it was fitted to, so it follows the scene and
// never leaks onto the next one. Every check below serves that sentence.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks directly beneath it, in order.
//
//   A. Every grid dial answers from both its slider and its number chip, and the two agree.
//        size · offset X and Y · opacity · thickness · colour
//   B. A number typed outside a dial's range is clamped, and nonsense reads as the floor.
//   C. The grid switches on and off, the three types are exclusive, and picking a type in the
//      panel switches the grid on.
//   D. The type reaches the canvas: a square grid lines up row to row, a hex grid staggers.
//   E. A grid belongs to its scene. It survives a switch away and back, and never lands on
//      another scene.
//   F. Grid Reset returns every dial to its default, leaves the grid switched ON, and persists.
//   G. A freshly imported map starts on the default fit, and keeps the look the DM dialled in.
//   H. Everything the DM dials in reaches the Player, and the Player paints it at that size.
//   I. Grid Reset reaches the Player, and the Player paints the reset grid.
//   J. The grid the players see sits at a weight the table can read against the map.
//
// ⚠ DRIVE A SCENE SWITCH THROUGH switchScene(), NEVER THE DROPDOWN. openDropdown() calls
// doAutoSave() before it renders, so a switch made by clicking a card persists the outgoing grid
// on its way past — and section E would pass with the per-scene grid broken underneath it.
//
// ⚠ THE GRID IS OFF BY DEFAULT (state.js), and a Player drawing no grid would pass "the reset
// grid arrived" with an empty canvas. It is switched on before anything is measured, and that it
// stays on is its own criterion.
//
// ⚠ SET A SIZE WHILE THE GRID IS STILL SQUARE. drawGridLines paints hexagons in either hex mode,
// so a spacing measured across one row is only a cell size in square mode.
//
// ⚠ NEVER PASS AN ASYNC EXPRESSION TO waitFor. It wraps what it is given in `!!(…)`, so a promise
// is truthy on the first poll and the wait returns instantly. Anything reading IndexedDB is
// polled from Node here instead.
//
// ⚠ THE MAP IS ANIMATED, AND EVERY ACCEPTANCE FILE'S IS. Animated is the only kind the DM
// ever uses, so a suite running on still PNGs proved the app worked in a case that never
// happens. `tableMap` (tools/rig/fixtures.js) records the clip once per run and caches it by
// size. Do not swap it back to `stillMap`; smoke.js is the one file that wants both.

const path = require('path');

const MAP_W = 1400, MAP_H = 900;
const DIALLED = 137;            // far from the default, and not a multiple of it
const DEFAULT = 70;

module.exports = async function gridFeature(rig) {
  const dm = rig.dm;

  // ── Helpers ────────────────────────────────────────────────────────────────
  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir,
    { w: MAP_W, h: MAP_H });
  const expr = await rig.fixtures.asFileExpr(dm, map);
  // One fixture, several scenes: rename the same bytes so each import gets its own scene name.
  const named = n => '(f => new File([f], ' + JSON.stringify(n) + ', { type: f.type }))(' + expr + ')';

  const importAs = async name => {
    await dm.evaluate('createNewScene(' + named(name + '.mp4') + ')', 120000);
    await dm.waitFor('currentScene && currentScene.name === ' + JSON.stringify(name), 120000,
                     'the import of ' + name);
    return dm.evaluate('currentScene.id');
  };

  const switchTo = async id => {
    await dm.evaluate('switchScene(' + JSON.stringify(id) + ')', 120000);
    await dm.waitFor('currentScene && currentScene.id === ' + JSON.stringify(id), 60000,
                     'the switch to ' + id);
  };

  // Fires a control's real handler, exactly as a drag or a keystroke does.
  const fire = (id, v) => dm.evaluate('(() => { const el = document.getElementById(' +
    JSON.stringify(id) + '); el.value = ' + JSON.stringify(String(v)) + ';' +
    ' el.dispatchEvent(new Event("input", { bubbles: true })); return 0; })()');

  const liveGrid = () => dm.evaluate('({ on: gridEnabled, size: gridSize, offX: gridOffsetX,' +
    ' offY: gridOffsetY, color: gridColor, opacity: +gridOpacity.toFixed(2), mode: gridMode,' +
    ' width: gridLineWidth,' +
    ' sizeSlider: +document.getElementById("grid-size").value,' +
    ' sizeChip: +document.getElementById("grid-size-num").value,' +
    ' offXSlider: +document.getElementById("grid-offset-x").value,' +
    ' offXChip: +document.getElementById("grid-offset-x-num").value,' +
    ' offYChip: +document.getElementById("grid-offset-y-num").value,' +
    ' opSlider: +document.getElementById("grid-opacity").value,' +
    ' opChip: +document.getElementById("grid-opacity-num").value,' +
    ' thickSlider: +document.getElementById("grid-thickness").value,' +
    ' thickChip: +document.getElementById("grid-thickness-num").value,' +
    ' colorInput: document.getElementById("grid-color").value })');

  const storedGrid = id => dm.evaluate('(async () => { const sc = await sceneStore.loadScene(' +
    JSON.stringify(id) + '); return sc && sc.gridConfig ? sc.gridConfig : null; })()');

  // Polled, bounded, and it never throws: a miss has to become a named failure below rather than
  // an exception that abandons the rest of the file. The store is written from a debounce.
  const waitStored = async (id, size, ms) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const cfg = await storedGrid(id);
      if (cfg && cfg.cellSize === size) return true;
      if (Date.now() > deadline) return false;
      await rig.sleep(200);
    }
  };

  // What a canvas actually PAINTS. Several rows, the leading edge of every run of ink in each, as
  // a signature per row. A square grid repeats ONE signature across nearly every row it is
  // measured on; hexagons give a different one almost every row. The answer is `modal`, the size
  // of the largest group of identical rows — not the count of distinct ones, because a row next
  // to a horizontal grid line picks up faint anti-aliasing and reads as its own signature. The
  // median gap across one row, divided back through the camera, is a cell size in map units.
  const READ_PAINT = [
    'globalThis.__rigPaint = (canvasId) => {',
    '  const c = document.getElementById(canvasId);',
    "  if (!c || !c.width || !c.height) return { err: 'no canvas ' + canvasId };",
    "  const ctx = c.getContext('2d');",
    '  const rows = [], sigs = new Map();',
    '  let gapRow = null;',
    '  for (let i = 1; i <= 12; i++) {',
    '    const y = Math.floor(c.height * i / 13);',
    '    const d = ctx.getImageData(0, y, c.width, 1).data;',
    '    const starts = [];',
    '    let run = false, ink = 0;',
    '    for (let x = 0; x < c.width; x++) {',
    '      const on = d[x * 4 + 3] > 8;',
    '      if (on) ink++;',
    '      if (on && !run) starts.push(x);',
    '      run = on;',
    '    }',
    '    // A row lying along a horizontal grid line is solid ink and says nothing about spacing.',
    '    if (ink > c.width * 0.5 || starts.length < 3) continue;',
    '    rows.push(starts.length);',
    "    const sig = starts.join(',');",
    '    sigs.set(sig, (sigs.get(sig) || 0) + 1);',
    '    if (!gapRow) gapRow = starts;',
    '  }',
    "  if (!gapRow) return { err: 'nothing painted on ' + canvasId, rowsRead: 0 };",
    '  const gaps = [];',
    '  for (let i = 1; i < gapRow.length; i++) gaps.push(gapRow[i] - gapRow[i - 1]);',
    '  gaps.sort((a, b) => a - b);',
    '  const median = gaps[Math.floor(gaps.length / 2)];',
    '  return {',
    '    rowsRead: rows.length, modal: Math.max(...sigs.values()), distinct: sigs.size,',
    '    lines: gapRow.length, firstX: gapRow[0],',
    '    gapPx: median, zoom, cell: zoom ? +(median / zoom).toFixed(1) : 0,',
    '  };',
    '};',
    '0',
  ].join('\n');
  await dm.evaluate(READ_PAINT);

  const dmPaint = async () => {
    await dm.evaluate('gridDirty = true; viewportDirty = true; scheduleRender(); 0');
    await rig.sleep(400);
    return dm.evaluate('__rigPaint("grid-canvas")');
  };

  const alpha = await importAs('Alpha');
  await dm.waitFor('mapWidth === ' + MAP_W, 60000, 'the map to load on the DM');
  await dm.evaluate('document.getElementById("btn-grid").click(); 0');
  rig.check(await dm.evaluate('gridEnabled === true'), 'the grid button did not switch the grid on');

  // ── A. Every dial answers from its slider AND its number chip ──────────────
  await fire('grid-size', 210);
  let g = await liveGrid();
  rig.check(g.size === 210 && g.sizeChip === 210,
            'the size slider did not drive the global and its chip: ' + JSON.stringify(g));
  await fire('grid-size-num', 96);
  g = await liveGrid();
  rig.check(g.size === 96 && g.sizeSlider === 96,
            'a size typed into the chip did not drive the global and the slider: ' + JSON.stringify(g));

  await fire('grid-offset-x', 31);
  await fire('grid-offset-y-num', 47);
  g = await liveGrid();
  rig.check(g.offX === 31 && g.offXChip === 31,
            'the X offset slider did not drive the global and its chip: ' + JSON.stringify(g));
  rig.check(g.offY === 47 && g.offYChip === 47,
            'a Y offset typed into the chip did not take: ' + JSON.stringify(g));

  await fire('grid-opacity-num', 72);
  await fire('grid-thickness', 6);
  await fire('grid-color', '#ff3366');
  g = await liveGrid();
  rig.check(g.opacity === 0.72 && g.opSlider === 72,
            'an opacity typed into the chip did not take: ' + JSON.stringify(g));
  rig.check(g.width === 6 && g.thickChip === 6,
            'the thickness slider did not drive the global and its chip: ' + JSON.stringify(g));
  rig.check(g.color === '#ff3366', 'the colour picker did not drive the grid colour: ' + g.color);

  // ── B. Out-of-range numbers are clamped ───────────────────────────────────
  await fire('grid-size-num', 9999);
  let seen = await dm.evaluate('gridSize');
  rig.check(seen === 400, 'a size typed over the maximum was taken rather than clamped to 400: ' + seen);
  await fire('grid-size-num', 1);
  seen = await dm.evaluate('gridSize');
  rig.check(seen === 10, 'a size typed under the minimum was taken rather than clamped to 10: ' + seen);
  await fire('grid-size-num', 'nonsense');
  seen = await dm.evaluate('gridSize');
  rig.check(seen === 10, 'a chip holding nonsense left the grid size off its floor: ' + seen);
  await fire('grid-opacity-num', 400);
  seen = await dm.evaluate('gridOpacity');
  rig.check(seen === 1, 'an opacity typed over 100 was not clamped: ' + seen);
  await fire('grid-thickness-num', 99);
  seen = await dm.evaluate('gridLineWidth');
  rig.check(seen === 10, 'a thickness typed over the maximum was not clamped to 10: ' + seen);
  await fire('grid-offset-x-num', -50);
  seen = await dm.evaluate('gridOffsetX');
  rig.check(seen === 0, 'a negative offset was taken rather than clamped to 0: ' + seen);

  // Back to something measurable for the paint checks below.
  await fire('grid-size-num', DEFAULT);
  await fire('grid-offset-x-num', 0);
  await fire('grid-offset-y-num', 0);
  await fire('grid-thickness-num', 1);
  await fire('grid-opacity-num', 90);       // strong ink, so a scanline reads cleanly
  await fire('grid-color', '#ffffff');

  // ── C. On/off, and the three types are exclusive ──────────────────────────
  const typeState = () => dm.evaluate([
    '(() => {',
    "  const active = [...document.querySelectorAll('.grid-mode-btn')]",
    "    .filter(b => b.classList.contains('active')).map(b => b.id);",
    "  const seg = [...document.querySelectorAll('#cp-gridtype-row [data-gtype]')]",
    "    .filter(b => b.classList.contains('active')).map(b => b.dataset.gtype);",
    '  return { mode: gridMode, on: gridEnabled, active, seg };',
    '})()',
  ].join('\n'));

  for (const [btn, mode] of [['btn-grid-hflat', 'hex-flat'], ['btn-grid-hptop', 'hex-pointy'],
                             ['btn-grid-sq', 'square']]) {
    await dm.evaluate('document.getElementById(' + JSON.stringify(btn) + ').click(); 0');
    const t = await typeState();
    rig.check(t.mode === mode, btn + ' did not set the grid type to ' + mode + ': ' + t.mode);
    rig.check(t.active.length === 1 && t.active[0] === btn,
              'more than one grid type reads as chosen: ' + JSON.stringify(t.active));
  }

  await dm.evaluate('document.getElementById("btn-grid").click(); 0');
  const offState = await typeState();
  rig.check(offState.on === false, 'the grid button did not switch the grid off');
  const offPaint = await dmPaint();
  rig.check(!!offPaint.err,
            'the DM is still painting a grid after it was switched off: ' + JSON.stringify(offPaint));

  // The DM's real control is the panel's segment; the buttons above are the hidden legacy row.
  const seg = t => dm.evaluate('(() => { const b = document.querySelector(' +
    JSON.stringify('#cp-gridtype-row [data-gtype="' + t + '"]') + ');' +
    ' if (!b) return "missing"; b.click(); return "clicked"; })()');
  const segHex = await seg('hex-flat');
  if (rig.check(segHex === 'clicked', 'the panel has no hex-flat grid-type button to press')) {
    const back = await typeState();
    rig.check(back.on === true && back.mode === 'hex-flat',
              'picking a grid type in the panel did not switch the grid on: ' + JSON.stringify(back));
    rig.check(back.seg.length === 1 && back.seg[0] === 'hex-flat',
              'the panel segment shows the wrong type chosen: ' + JSON.stringify(back.seg));
    await seg('off');
    rig.check(await dm.evaluate('gridEnabled') === false,
              "the panel segment's Off did not switch the grid off");
    await seg('square');
  }

  // ── D. The type reaches the canvas ────────────────────────────────────────
  await dm.evaluate('document.getElementById("btn-grid-sq").click(); 0');
  const sq = await dmPaint();
  rig.note('square painted: ' + JSON.stringify(sq));
  rig.check(!sq.err && sq.rowsRead >= 4,
            'the DM painted no readable square grid, so every paint check below is empty: ' +
            JSON.stringify(sq));
  rig.check(!sq.err && sq.modal >= sq.rowsRead - 2,
            'a square grid painted different vertical lines row to row, so it is not a square ' +
            'lattice: its commonest row repeats only ' + sq.modal + ' times out of ' + sq.rowsRead);
  rig.check(Math.abs(sq.cell - DEFAULT) <= 2,
            'the DM painted the square grid at the wrong cell size: ' + sq.cell + ' map units');

  await dm.evaluate('document.getElementById("btn-grid-hflat").click(); 0');
  const hex = await dmPaint();
  rig.note('hex-flat painted: ' + JSON.stringify(hex));
  rig.check(!hex.err && hex.modal < hex.rowsRead / 2,
            'a hex grid painted the same vertical lines on nearly every row, which is a square ' +
            'lattice wearing a hex label: ' + JSON.stringify(hex));

  await dm.evaluate('document.getElementById("btn-grid-hptop").click(); 0');
  const pointy = await dmPaint();
  // A pointy-top hexagon has two vertical edges, so more of its rows repeat than a flat-top's.
  // The margin is still wide: 4 of 12 here against 11 of 12 for a square lattice.
  rig.check(!pointy.err && pointy.modal < pointy.rowsRead / 2,
            'the pointy-top hex grid painted a square lattice: ' + JSON.stringify(pointy));
  await dm.evaluate('document.getElementById("btn-grid-sq").click(); 0');

  // An offset moves the lattice rather than resizing it.
  const beforeOffset = await dmPaint();
  await fire('grid-offset-x-num', 35);
  const shifted = await dmPaint();
  rig.note('offset 35 painted: ' + JSON.stringify(shifted));
  rig.check(!shifted.err && shifted.firstX !== beforeOffset.firstX,
            'an X offset of 35 moved nothing on the canvas: the first line is still at ' +
            shifted.firstX);
  rig.check(!shifted.err && Math.abs(shifted.cell - beforeOffset.cell) <= 2,
            'an X offset changed the cell size as well as the position: ' + shifted.cell +
            ' against ' + beforeOffset.cell);
  await fire('grid-offset-x-num', 0);

  // ── E. A grid belongs to its scene ────────────────────────────────────────
  const beta = await importAs('Beta');
  rig.note('scenes: Alpha=' + alpha + ' Beta=' + beta);

  await fire('grid-size', 45);
  rig.check(await waitStored(beta, 45, 9000),
            'a grid size set on a scene never reached the store, so nothing could survive a switch');

  await switchTo(alpha);
  const onAlpha = await liveGrid();
  rig.check(onAlpha.size === DEFAULT,
            "Beta's grid size followed the switch onto Alpha: " + onAlpha.size);

  await fire('grid-size', 123);
  rig.check(await waitStored(alpha, 123, 9000), "Alpha's grid size never reached the store");

  await switchTo(beta);
  const backOnBeta = await liveGrid();
  rig.check(backOnBeta.size === 45, 'Beta came back with the wrong grid size: ' + backOnBeta.size);
  rig.check(backOnBeta.sizeChip === 45 && backOnBeta.sizeSlider === 45,
            'the restored grid size did not reach the slider and its chip: ' +
            JSON.stringify(backOnBeta));

  await switchTo(alpha);
  const backOnAlpha = await liveGrid();
  rig.check(backOnAlpha.size === 123, 'Alpha came back with the wrong grid size: ' + backOnAlpha.size);

  // ── F. Grid Reset ─────────────────────────────────────────────────────────
  await fire('grid-offset-x', 30);
  await fire('grid-opacity', 60);
  await fire('grid-thickness', 4);
  await fire('grid-color', '#ff3366');
  await dm.evaluate('document.getElementById("btn-grid-hflat").click(); 0');
  await dm.evaluate('document.getElementById("btn-grid-reset").click(); 0');
  const reset = await liveGrid();
  rig.note('after Grid Reset: ' + JSON.stringify(reset));
  rig.check(reset.size === DEFAULT && reset.offX === 0 && reset.offY === 0,
            'Reset did not put the size and offset back to their defaults: ' + JSON.stringify(reset));
  rig.check(reset.color === '#ffffff' && reset.opacity === 0.25 && reset.width === 1,
            'Reset did not put the colour, opacity and thickness back: ' + JSON.stringify(reset));
  rig.check(reset.mode === 'square', 'Reset left the grid on a hex type: ' + reset.mode);
  rig.check(reset.on === true, 'Reset switched the grid off, so the DM lost it entirely');
  rig.check(reset.sizeSlider === DEFAULT && reset.sizeChip === DEFAULT &&
            reset.opChip === 25 && reset.thickChip === 1 && reset.colorInput === '#ffffff',
            'Reset left a control showing the old value: ' + JSON.stringify(reset));
  rig.check(await waitStored(alpha, DEFAULT, 9000),
            'Reset never reached the store, so the old size comes back on the next switch');
  await switchTo(beta);
  await switchTo(alpha);
  seen = await dm.evaluate('gridSize');
  rig.check(seen === DEFAULT, 'the reset grid did not survive a switch: ' + seen);

  // ── G. A new import starts on the default fit, keeping the look ───────────
  await switchTo(beta);
  await fire('grid-size', 45);
  await fire('grid-offset-x', 30);
  await fire('grid-color', '#ff3366');
  await fire('grid-opacity', 60);
  await fire('grid-thickness', 3);
  await dm.evaluate('document.getElementById("btn-grid-hflat").click(); 0');
  const beforeImport = await liveGrid();
  rig.check(beforeImport.size === 45 && beforeImport.offX === 30 && beforeImport.mode === 'hex-flat',
            'the pre-import grid state did not take: ' + JSON.stringify(beforeImport));

  const gamma = await importAs('Gamma');
  const gcfg = await storedGrid(gamma);
  rig.note('the imported scene stored: ' + JSON.stringify(gcfg));
  rig.check(!!gcfg && gcfg.cellSize === DEFAULT,
            "a new import inherited the previous map's cell size: " + (gcfg && gcfg.cellSize));
  rig.check(!!gcfg && gcfg.offsetX === 0 && gcfg.offsetY === 0,
            "a new import inherited the previous map's grid offset: " + JSON.stringify(gcfg));
  rig.check(!!gcfg && gcfg.color === '#ff3366' && Math.round(gcfg.opacity * 100) === 60 &&
            gcfg.lineWidth === 3 && gcfg.mode === 'hex-flat',
            'a new import dropped the grid look the DM had dialled in: ' + JSON.stringify(gcfg));
  const onGamma = await liveGrid();
  rig.check(onGamma.size === DEFAULT && onGamma.sizeChip === DEFAULT,
            'the imported map is on screen with the old grid size: ' + JSON.stringify(onGamma));

  // ── H. Everything reaches the Player, and the Player paints it ────────────
  // Auto-sync is what carries a grid change across. It is on by default; asserted rather than
  // assumed, because with it off every check below would be reading the Player's own defaults.
  rig.check(await dm.evaluate('autoSync === true'),
            'auto-sync is off, so no grid change could reach the Player and every check below ' +
            "would be measuring the Player's own defaults");
  await dm.evaluate('document.getElementById("btn-grid-sq").click(); 0');
  await fire('grid-color', '#ffffff');
  await fire('grid-opacity', 90);
  await fire('grid-thickness', 1);

  const player = await rig.player();
  await player.waitFor('!!mapOffscreen && !!fogDataCanvas', 45000, 'the Player to receive the map');
  await player.waitFor('fogCoverT === 0', 45000, 'the scene cover to lift on the Player');
  // Both windows must keep painting with neither in front (KEEP_PAINTING in run.js). A DM that
  // reports itself hidden here is being given no frames, and every reading is a zero.
  rig.check(await dm.evaluate('document.hidden') === false,
            'the DM reports itself hidden while the Player is open, so it is being given no ' +
            'frames and every measurement below would read zero');
  await player.evaluate(READ_PAINT);

  const playerGrid = () => player.evaluate('({ on: gridEnabled, size: gridSize,' +
    ' offX: gridOffsetX, offY: gridOffsetY, color: gridColor, opacity: +gridOpacity.toFixed(2),' +
    ' mode: gridMode, width: gridLineWidth })');

  const playerPaint = async () => {
    await player.evaluate('gridDirty = true; viewportDirty = true; scheduleRender(); 0');
    await rig.sleep(400);
    return player.evaluate('__rigPaint("player-grid-canvas")');
  };

  // Bounded, never throws: a miss lands as the named check below.
  const waitPlayer = async (expr, want, ms) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const got = await player.evaluate(expr);
      if (got === want || Date.now() > deadline) return got;
      await rig.sleep(250);
    }
  };

  await fire('grid-size', DIALLED);
  const sawDialled = await waitPlayer('gridSize', DIALLED, 30000);
  rig.check(sawDialled === DIALLED,
            'a grid size set on the DM never reached the Player: it reads ' + sawDialled);
  const dialledPaint = await playerPaint();
  rig.note('Player painted at ' + DIALLED + ': ' + JSON.stringify(dialledPaint));
  rig.check(!dialledPaint.err && dialledPaint.lines >= 3,
            'the Player is painting no grid at all, so the spacing below means nothing: ' +
            JSON.stringify(dialledPaint));
  rig.check(!dialledPaint.err && Math.abs(dialledPaint.cell - DIALLED) <= 2,
            'the Player is painting a grid at the wrong cell size: ' + dialledPaint.cell +
            ' map units, expected ' + DIALLED);

  await fire('grid-offset-x', 33);
  await fire('grid-offset-y', 44);
  await fire('grid-color', '#ff3366');
  await fire('grid-opacity', 60);
  await fire('grid-thickness', 3);
  await dm.evaluate('document.getElementById("btn-grid-hflat").click(); 0');
  await waitPlayer('gridMode', 'hex-flat', 30000);
  const dialled = await playerGrid();
  rig.note('Player holds the dialled-in look: ' + JSON.stringify(dialled));
  rig.check(dialled.offX === 33 && dialled.offY === 44,
            'the grid offset never reached the Player: ' + JSON.stringify(dialled));
  rig.check(dialled.color === '#ff3366' && dialled.opacity === 0.6 && dialled.width === 3,
            'the grid colour, opacity or thickness never reached the Player: ' +
            JSON.stringify(dialled));
  rig.check(dialled.mode === 'hex-flat', 'the grid type never reached the Player: ' + dialled.mode);

  // Switched off on the DM means nothing on the TV.
  await dm.evaluate('document.getElementById("btn-grid").click(); 0');
  const sawOff = await waitPlayer('gridEnabled', false, 30000);
  rig.check(sawOff === false, 'the grid was switched off on the DM and the TV kept drawing one');
  const offOnTV = await playerPaint();
  rig.check(!!offOnTV.err,
            'the Player is still painting a grid after the DM switched it off: ' +
            JSON.stringify(offOnTV));
  await dm.evaluate('document.getElementById("btn-grid").click(); 0');
  await waitPlayer('gridEnabled', true, 30000);

  // ── I. Grid Reset reaches the Player, and it paints the reset grid ────────
  await dm.evaluate('document.getElementById("btn-grid-reset").click(); 0');
  const sawReset = await waitPlayer('gridSize', DEFAULT, 30000);
  const pReset = await playerGrid();
  rig.note('Player after Grid Reset: ' + JSON.stringify(pReset));
  rig.check(sawReset === DEFAULT,
            'Grid Reset never reached the Player — the TV keeps the old cell size: it reads ' +
            sawReset);
  rig.check(pReset.offX === 0 && pReset.offY === 0,
            'the reset offset never reached the Player: ' + JSON.stringify(pReset));
  rig.check(pReset.color === '#ffffff' && pReset.opacity === 0.25 && pReset.width === 1,
            'the reset colour, opacity or thickness never reached the Player: ' +
            JSON.stringify(pReset));
  rig.check(pReset.mode === 'square', 'the reset grid type never reached the Player: ' + pReset.mode);
  rig.check(pReset.on === true,
            'Reset switched the grid off on the Player, so the table lost it entirely');

  const resetPaint = await playerPaint();
  rig.note('Player painted after Reset: ' + JSON.stringify(resetPaint));
  rig.check(!resetPaint.err && resetPaint.lines >= 3,
            'the Player stopped painting a grid after Reset: ' + JSON.stringify(resetPaint));
  rig.check(!resetPaint.err && Math.abs(resetPaint.cell - DEFAULT) <= 2,
            'the Player is still painting the old grid after Reset: ' + resetPaint.cell +
            ' map units, expected ' + DEFAULT);

  // ── J. The look at the table ──────────────────────────────────────────────
  const shot = path.join(rig.outDir, 'player-grid.png');
  await player.screenshot(shot);
  rig.note('Player screenshot: ' + shot);
  rig.byEye('whether the grid in ' + shot + ' sits at a weight the table can read without ' +
            'fighting the map — line strength is a look call, not a pixel one');
};
