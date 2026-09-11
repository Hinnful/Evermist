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
//        size · opacity · thickness · colour. Offset has NO field: calibration sets the phase,
//        because a number typed into a box cannot be aimed at a line on the map.
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
//   K. The grid can be fitted by dragging the shape it is made of on the map, and the fit
//      reaches the controls, the scene and the Player.
//        the button wears the panel's own outline and lights while armed - arming captures the
//        map and puts its count HUD on the map - a square box comes out square whatever the drag
//        was - the cell is that box divided by its count - the count corrects it - dragging inside
//        the box slides the phase and leaves the cell alone - dragging its far corner resizes the
//        cell and leaves the count alone - a handle well clear of the box re-solves the cell
//        without moving the phase - a resize too small for one cell is refused rather than clamped
//        - a hex grid draws a HEXAGON round the cell centre and puts a cell centre exactly on the
//        point pressed, odd columns and rows included - Done, the Calibrate icon, Escape and
//        picking a tool each hand the map back, they give back the tab arming shut unless the DM
//        picked another one meanwhile, and the DM's own grid switch is never touched
//      (the room card getting out of the way is room-card.js's section A, with the rooms)
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
    ' offYSlider: +document.getElementById("grid-offset-y").value,' +
    ' opSlider: +document.getElementById("grid-opacity").value,' +
    ' opChip: +document.getElementById("grid-opacity-num").value,' +
    ' thickSlider: +document.getElementById("grid-thickness").value,' +
    ' thickChip: +document.getElementById("grid-thickness-num").value,' +
    ' colorInput: document.getElementById("grid-color").value })');

  const storedGrid = id => dm.evaluate('(async () => { const sc = await sceneStore.loadScene(' +
    JSON.stringify(id) + '); return sc && sc.gridConfig ? sc.gridConfig : null; })()');

  // Polled, bounded, and it never throws: a miss has to become a named failure below rather than
  // an exception that abandons the rest of the file.
  // ⚠ THE BOUND COVERS THREE THINGS, not just the 5s debounce in scheduleAutoSave: the save then
  // encodes the whole fog canvas to a blob and writes it to IndexedDB. A budget sized to the
  // debounce alone passes here and times out on a CI runner that has just built three installers.
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
    'globalThis.__rigPaint = (target) => {',
    "  // ⚠ A CANVAS OR AN ID. The Player's grid canvas is OFFSCREEN - PixiJS shows it as a",
    '  // sprite under the fog mesh - so it has no id to look up and is passed by reference.',
    "  const c = (typeof target === 'string') ? document.getElementById(target) : target;",
    "  if (!c || !c.width || !c.height) return { err: 'no canvas ' + target };",
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
    "  if (!gapRow) return { err: 'nothing painted', rowsRead: 0 };",
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
  await fire('grid-offset-y', 47);
  g = await liveGrid();
  rig.check(g.offX === 31 && g.offY === 47,
            'the offset sliders did not drive the globals: ' + JSON.stringify(g));

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
  // Back to something measurable for the paint checks below.
  await fire('grid-size-num', DEFAULT);
  await fire('grid-offset-x', 0);
  await fire('grid-offset-y', 0);
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
  await fire('grid-offset-x', 35);
  const shifted = await dmPaint();
  rig.note('offset 35 painted: ' + JSON.stringify(shifted));
  rig.check(!shifted.err && shifted.firstX !== beforeOffset.firstX,
            'an X offset of 35 moved nothing on the canvas: the first line is still at ' +
            shifted.firstX);
  rig.check(!shifted.err && Math.abs(shifted.cell - beforeOffset.cell) <= 2,
            'an X offset changed the cell size as well as the position: ' + shifted.cell +
            ' against ' + beforeOffset.cell);
  await fire('grid-offset-x', 0);

  // ── E. A grid belongs to its scene ────────────────────────────────────────
  const beta = await importAs('Beta');
  rig.note('scenes: Alpha=' + alpha + ' Beta=' + beta);

  await fire('grid-size', 45);
  rig.check(await waitStored(beta, 45, 25000),
            'a grid size set on a scene never reached the store, so nothing could survive a switch');

  await switchTo(alpha);
  const onAlpha = await liveGrid();
  rig.check(onAlpha.size === DEFAULT,
            "Beta's grid size followed the switch onto Alpha: " + onAlpha.size);

  await fire('grid-size', 123);
  rig.check(await waitStored(alpha, 123, 25000), "Alpha's grid size never reached the store");

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
  rig.check(await waitStored(alpha, DEFAULT, 25000),
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

  // ⚠ THE CANVAS IS NOT WHAT THE TABLE SEES. It is offscreen and keeps its last paint; the
  // sprite's visibility is what puts it on the TV, and switching the grid off hides the sprite
  // rather than clearing the canvas. Reading the canvas alone reports a grid nobody can see.
  const playerPaint = async () => {
    await player.evaluate('gridDirty = true; viewportDirty = true; scheduleRender(); 0');
    await rig.sleep(400);
    const shown = await player.evaluate('!!(pixiPGridSpr && pixiPGridSpr.visible)');
    if (!shown) return { err: 'the grid sprite is hidden, so nothing reaches the TV' };
    return player.evaluate('__rigPaint(playerGridCanvas)');
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

  // -- K. Fitting the grid by dragging on the map ----------------------------
  // A real drag, in MAP coordinates, on the elements the app listens on: mousedown and mousemove
  // reach #canvas-container, and the release is the WINDOW handler, which is what lets a square
  // dragged off the map's edge still commit.
  const clientAt = (mx, my) => dm.evaluate(
    '(() => { const r = container.getBoundingClientRect();' +
    ' return { x: r.left + panX + (' + mx + ') * zoom, y: r.top + panY + (' + my + ') * zoom }; })()');

  const mouseAt = async (type, mx, my, onWindow) => {
    const p = await clientAt(mx, my);
    await dm.evaluate('(() => { ' + (onWindow ? 'window' : 'container') +
      '.dispatchEvent(new MouseEvent(' + JSON.stringify(type) +
      ', { bubbles: true, button: 0, clientX: ' + p.x + ', clientY: ' + p.y + ' })); return 0; })()');
  };

  // The DM's own on/off goes OFF first: calibration has to show a grid to aim at without touching
  // gridEnabled, which reaches the TV, and putting that value back is its own check below.
  await dm.evaluate('gridEnabled = false; gridDirty = true; scheduleRender(); 0');
  await fire('grid-size', 100);

  // ⚠ The button has to carry .cp-btn-outline, not .cp-btn alone. .cp-btn sets metrics only, so a
  // button missing the identity class renders as the browser's own grey box AND loses its armed
  // state, since the blue fill is defined on .cp-btn-outline.active. Both read as a styling slip
  // and neither shows up in any behaviour check.
  const skin = (on) => dm.evaluate('(() => { const b = document.getElementById("cp-grid-calibrate"),' +
    ' r = document.getElementById("cp-grid-reset"), c = getComputedStyle(b);' +
    ' return { bg: c.backgroundColor, border: c.borderTopColor, w: parseFloat(c.borderTopWidth),' +
    '   same: c.borderTopColor === getComputedStyle(r).borderTopColor, lit: b.classList.contains("active") };' +
    ' })()');
  const rest = await skin();
  rig.note('Calibrate at rest: ' + JSON.stringify(rest));
  // ⚠ Compared against the reset beside it, never against 1.5: the pane carries --ui-zoom and
  // getComputedStyle reports the border already divided by it.
  rig.check(rest.w > 0.5 && rest.same,
            'the Calibrate button does not wear the outline every other panel button wears: ' +
            JSON.stringify(rest));

  await dm.evaluate('document.getElementById("cp-grid-calibrate").click(); 0');
  const litSkin = await skin();
  rig.check(litSkin.lit === true && litSkin.bg !== rest.bg,
            'arming did not light the Calibrate button, so nothing on screen says the map is held: ' +
            JSON.stringify(litSkin));

  const armed = await dm.evaluate('({ on: gridCalArmed,' +
    ' hud: getComputedStyle(document.getElementById("gridcal-hud")).display,' +
    ' hudW: document.getElementById("gridcal-hud").getBoundingClientRect().width,' +
    ' rooms: getComputedStyle(document.getElementById("ctx-rooms")).display,' +
    ' panel: document.getElementById("sidebar-right").hidden })');
  rig.check(armed.on === true, 'the Calibrate button did not arm calibration');
  rig.check(armed.hud !== 'none', 'arming calibration did not put its count HUD on the map');
  // #context-row is hidden for the length of calibration, so a HUD parked inside it would be
  // invisible while still reporting a display.
  rig.check(armed.hudW > 0, 'the calibration HUD reports a display but occupies no box');
  rig.check(armed.rooms === 'none',
            'the room tools kept their option strip while calibration held the map');
  rig.check(armed.panel === true,
            'arming calibration left the control panel over the map it has to be dragged on');

  const armedPaint = await dmPaint();
  rig.note('DM painted while armed with the grid off: ' + JSON.stringify(armedPaint));
  rig.check(!armedPaint.err,
            'calibration draws no grid to aim at while the DM has the grid switched off: ' +
            JSON.stringify(armedPaint));
  rig.check(await dm.evaluate('gridEnabled === false'),
            'calibration switched gridEnabled on, which would put a grid in front of the players');

  // 420 across and 210 down. The box must come out SQUARE, and at a 100px cell the count guesses 4.
  await mouseAt('mousemove', 300, 200);
  await mouseAt('mousedown', 300, 200);
  await mouseAt('mousemove', 720, 410);
  await mouseAt('mouseup', 720, 410, true);

  const span = await dm.evaluate('gridCalSpan && ({ ax: gridCalSpan.ax, ay: gridCalSpan.ay,' +
    ' w: gridCalSpan.bx - gridCalSpan.ax, h: gridCalSpan.by - gridCalSpan.ay, n: gridCalSpan.n })');
  rig.note('calibration square: ' + JSON.stringify(span));
  rig.check(!!span, 'a drag across the map committed no calibration square');
  if (span) {
    rig.check(Math.abs(span.w - span.h) < 0.5,
              'the calibration box came out a rectangle, so the square it draws is a lie: ' +
              JSON.stringify(span));
    rig.check(Math.abs(span.w - 420) < 4,
              'the square did not follow the axis that was dragged furthest: ' + span.w);
    rig.check(span.n === 4,
              'the cell count was not guessed from the size already set: ' + span.n);
    let fit = await liveGrid();
    rig.check(Math.abs(fit.size - span.w / span.n) < 0.01,
              'the drag did not set the cell to the square divided by its count: ' + fit.size);
    rig.check(Math.abs(fit.offX - (span.ax % fit.size)) < 0.01 &&
              Math.abs(fit.offY - (span.ay % fit.size)) < 0.01,
              'the drag did not put a grid line through the corner it started at: ' +
              JSON.stringify(fit));
    rig.check(Math.abs(fit.sizeChip - fit.size) < 0.6 && Math.abs(fit.offXSlider - fit.offX) < 0.6,
              'the fit never reached the Grid pane, so its numbers disagree with the grid: ' +
              JSON.stringify(fit));

    // The count is a guess, so correcting it has to re-divide the same square.
    await dm.evaluate('document.getElementById("gridcal-count-inc").click(); 0');
    const bumped = await dm.evaluate('gridCalSpan.n');
    fit = await liveGrid();
    rig.check(bumped === 5, 'the stepper did not raise the cell count: ' + bumped);
    rig.check(Math.abs(fit.size - span.w / 5) < 0.01,
              'raising the count did not re-divide the square: ' + fit.size);

    // The square is an object once it exists. A grab inside it slides it, and the cell size must
    // survive the slide untouched - a move that re-divides would undo the count just corrected.
    // ⚠ A DRAG'S TOLERANCE IS ONE CLIENT PIXEL IN MAP UNITS, never a flat number. mouseAt rounds
    // to a whole client pixel, so a 17px map drag arrives as 17.5 at a zoom of 0.855 - which is a
    // real 0.54px miss on a check written against the number aimed at. It killed a release gate on
    // a 1008x681 runner while passing here.
    const px = 2 / (await dm.evaluate('zoom'));
    const beforeMove = await liveGrid();
    const mid = { x: span.ax + span.w / 2, y: span.ay + span.h / 2 };
    await mouseAt('mousemove', mid.x, mid.y);
    const overBody = await dm.evaluate('gridCalHitPart({ x: ' + mid.x + ', y: ' + mid.y + '})');
    rig.check(overBody === 'move',
              'the pointer inside the square did not offer to move it: ' + overBody);
    await mouseAt('mousedown', mid.x, mid.y);
    await mouseAt('mousemove', mid.x + 17, mid.y + 11);
    await mouseAt('mouseup', mid.x + 17, mid.y + 11, true);
    const moved = await dm.evaluate('({ ax: gridCalSpan.ax, ay: gridCalSpan.ay, n: gridCalSpan.n,' +
      ' w: gridCalSpan.bx - gridCalSpan.ax })');
    const afterMove = await liveGrid();
    rig.note('after the move: ' + JSON.stringify({ ax: moved.ax, size: afterMove.size }));
    rig.check(Math.abs(moved.ax - (span.ax + 17)) < px && Math.abs(moved.ay - (span.ay + 11)) < px,
              'dragging inside the square did not carry it with the pointer: ' +
              JSON.stringify(moved));
    rig.check(Math.abs(afterMove.size - beforeMove.size) < 0.01,
              'moving the square changed the cell size, which only its own size may do: ' +
              afterMove.size);
    rig.check(Math.abs(afterMove.offX - (moved.ax % afterMove.size)) < 0.01 &&
              Math.abs(afterMove.offY - (moved.ay % afterMove.size)) < 0.01,
              'moving the square did not carry the grid phase with it: ' + JSON.stringify(afterMove));
    rig.check(Math.abs(afterMove.offXSlider - afterMove.offX) < 0.6,
              'a moved square never reached the grid controls: ' + JSON.stringify(afterMove));

    // ...and a grab on its far corner resizes it, which is the other half: the count holds and
    // the cell size follows the new side.
    const corner = { x: moved.ax + moved.w, y: moved.ay + moved.w };
    await mouseAt('mousemove', corner.x, corner.y);
    const overCorner = await dm.evaluate(
      'gridCalHitPart({ x: ' + corner.x + ', y: ' + corner.y + '})');
    rig.check(overCorner === 'resize',
              'the pointer on the far corner did not offer to resize the square: ' + overCorner);
    await mouseAt('mousedown', corner.x, corner.y);
    await mouseAt('mousemove', corner.x + 50, corner.y + 50);
    await mouseAt('mouseup', corner.x + 50, corner.y + 50, true);
    const resized = await dm.evaluate('({ n: gridCalSpan.n, w: gridCalSpan.bx - gridCalSpan.ax })');
    const afterResize = await liveGrid();
    rig.note('after the resize: ' + JSON.stringify(Object.assign({}, resized,
                                                                 { size: afterResize.size })));
    rig.check(resized.n === moved.n,
              'resizing the square changed the count, which only the stepper may do: ' + resized.n);
    rig.check(Math.abs(resized.w - (moved.w + 50)) < px,
              'the far corner did not follow the pointer: ' + resized.w);
    rig.check(Math.abs(afterResize.size - resized.w / resized.n) < 0.01,
              'resizing the square did not re-divide it into the same count: ' + afterResize.size);

    // ⚠ A resize dragged back onto the anchor used to CLAMP to the control's floor, which paints a
    // 10px lattice over the whole map on every frame of the drag. It is refused instead.
    const tiny = { x: moved.ax + 8, y: moved.ay + 8 };
    await mouseAt('mousemove', moved.ax + resized.w, moved.ay + resized.w);
    await mouseAt('mousedown', moved.ax + resized.w, moved.ay + resized.w);
    await mouseAt('mousemove', tiny.x, tiny.y);
    await mouseAt('mouseup', tiny.x, tiny.y, true);
    const floored = await liveGrid();
    rig.note('after a resize onto the anchor: ' + JSON.stringify({ size: floored.size }));
    rig.check(Math.abs(floored.size - afterResize.size) < 0.01,
              'a resize that cannot fit one cell was clamped rather than refused, so the map is ' +
              'now drawn at ' + floored.size + 'px per cell');

    // Every later check reads the square as it now stands, not as it was dragged.
    span.ax = moved.ax; span.ay = moved.ay; span.w = resized.w;

    fit = afterResize;
    // Correcting at a distance: 8 cells out, dragged 40px further, solves to 5px more per cell.
    const cellNow = fit.size;
    const hx = span.ax + 8 * cellNow, hy = span.ay;
    await mouseAt('mousemove', hx, hy);
    const hovered = await dm.evaluate(
      'gridCalRefine && ({ n: gridCalRefine.n, m: gridCalRefine.m })');
    rig.check(!!hovered && hovered.n === 8 && hovered.m === 0,
              'no correction handle offered itself on an intersection clear of the square: ' +
              JSON.stringify(hovered));
    await mouseAt('mousedown', hx, hy);
    await mouseAt('mousemove', hx + 40, hy);
    await mouseAt('mouseup', hx + 40, hy, true);
    const solved = await liveGrid();
    rig.note('after the correction: ' + JSON.stringify({ size: solved.size, offX: solved.offX }));
    rig.check(Math.abs(solved.size - (cellNow + 5)) < 0.4,
              'dragging the correction handle 40px over 8 cells did not add 5px to the cell: ' +
              solved.size);
    rig.check(Math.abs(solved.offX - (span.ax % solved.size)) < 0.01,
              'the correction moved the phase, which must stay where the square put it: ' +
              JSON.stringify(solved));

    const sawFit = await waitPlayer('gridSize', solved.size, 30000);
    rig.check(sawFit === solved.size,
              'a grid fitted by dragging never reached the Player: it reads ' + sawFit);
  }

  // Four ways out, and each has to put the DM's own grid switch back.
  await dm.evaluate('document.getElementById("cp-grid-calibrate").click(); 0');
  const left = await dm.evaluate('({ on: gridCalArmed, enabled: gridEnabled,' +
    ' hud: getComputedStyle(document.getElementById("gridcal-hud")).display,' +
    ' held: !!document.getElementById("gridcal-hold-canvas") })');
  rig.check(left.on === false, 'the Calibrate button did not leave calibration');
  rig.check(left.hud === 'none', 'the calibration HUD stayed on the map after leaving');
  rig.check(left.enabled === false,
            'leaving calibration left the grid switched on, which the DM had switched off');
  rig.check(left.held === false,
            'the held map frame stayed in the canvas stack after leaving calibration');

  await dm.evaluate('document.getElementById("cp-grid-calibrate").click(); 0');
  await dm.evaluate(
    'document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); 0');
  rig.check(await dm.evaluate('gridCalArmed === false'), 'Escape did not leave calibration');

  await dm.evaluate('document.getElementById("cp-grid-calibrate").click(); 0');
  await dm.evaluate('setShape("rect"); 0');
  rig.check(await dm.evaluate('gridCalArmed === false'),
            'picking a tool did not hand the map back from calibration');

  // Done on the HUD is the only way out that is visible while the map is held, and every way out
  // has to reopen the tab arming shut - the DM did not close it.
  await dm.evaluate('_cpSelectTab("grid"); 0');
  await dm.evaluate('document.getElementById("cp-grid-calibrate").click(); 0');
  rig.check(await dm.evaluate('document.getElementById("sidebar-right").hidden === true'),
            'arming left the control panel over the map a second time round');
  await dm.evaluate('document.getElementById("gridcal-done").click(); 0');
  const back = await dm.evaluate('({ armed: gridCalArmed, tab: _cpActiveTab(),' +
    ' hidden: document.getElementById("sidebar-right").hidden })');
  rig.check(back.armed === false, 'Done on the calibration HUD did not hand the map back');
  rig.check(back.hidden === false && back.tab === 'grid',
            'Done left the panel shut on a tab the DM never closed: ' + JSON.stringify(back));

  // ⚠ #cp-tabbar NEVER HIDES, so a tab the DM picks while armed is a real click and it has to win
  // over the one arming shut.
  await dm.evaluate('document.getElementById("cp-grid-calibrate").click(); 0');
  await dm.evaluate('_cpSelectTab("fog"); 0');
  await dm.evaluate('document.getElementById("gridcal-done").click(); 0');
  const chosen = await dm.evaluate('_cpActiveTab()');
  rig.check(chosen === 'fog',
            'Done threw away the tab the DM picked while calibrating and forced back the old one: ' +
            chosen);
  await dm.evaluate('_cpSelectTab("grid"); 0');

  // A hex grid calibrates too. The gesture draws the shape the grid is made of: the press is a
  // CELL CENTRE and the drag is a circumradius, because that is what gridSize means for a hex.
  await dm.evaluate('document.getElementById("btn-grid-hflat").click(); 0');
  await fire('grid-size', 100);
  await dm.evaluate('document.getElementById("cp-grid-calibrate").click(); 0');
  rig.check(await dm.evaluate('gridCalArmed === true'),
            'calibration refused a hex grid, which it now measures with a hexagon');

  // ⚠ THE CHECK IS "A CELL CENTRE LANDS ON THE PRESS", never gridCalWrite's own arithmetic. An
  // assertion that restates the formula agrees with it however wrong it is - and a hex lattice
  // STAGGERS alternate columns and rows, so the phase is only right for half the anchors. This
  // walks drawGridLines' own centre formula and reports the nearest one.
  const missAt = (ax, ay) => dm.evaluate([
    '(() => {',
    '  const R = gridSize, flat = gridMode === "hex-flat";',
    '  const A = R * (flat ? 1.5 : Math.sqrt(3)), B = R * (flat ? Math.sqrt(3) : 1.5);',
    '  let best = Infinity;',
    '  for (let c = -80; c <= 80; c++) for (let r = -80; r <= 80; r++) {',
    '    const cx = gridOffsetX + c * A + (flat ? 0 : (r & 1) * A / 2);',
    '    const cy = gridOffsetY + r * B + (flat ? (c & 1) * B / 2 : 0);',
    '    best = Math.min(best, Math.hypot(cx - ' + ax + ', cy - ' + ay + '));',
    '  }',
    '  return best;',
    '})()'].join(''));

  // Both anchors drag 320 out. At a 100px cell the count guesses 3, so the cell solves to 106.67.
  // ⚠ 560 is the one that matters: it falls in an ODD column, where the stagger applies. 400 falls
  // in an even one and passes with the stagger ignored entirely.
  for (const [mode, btn] of [['hex-flat', 'btn-grid-hflat'], ['hex-pointy', 'btn-grid-hptop']]) {
    for (const [ax, ay] of [[400, 400], [560, 400], [400, 560]]) {
      if (await dm.evaluate('gridCalArmed')) {
        await dm.evaluate('document.getElementById("gridcal-done").click(); 0');
      }
      await dm.evaluate('document.getElementById("' + btn + '").click(); 0');
      await fire('grid-size', 100);
      await dm.evaluate('document.getElementById("cp-grid-calibrate").click(); 0');
      await mouseAt('mousemove', ax, ay);
      await mouseAt('mousedown', ax, ay);
      await mouseAt('mousemove', ax + 320, ay);
      await mouseAt('mouseup', ax + 320, ay, true);
      // ⚠ EVERY NUMBER BELOW COMES OFF THE COMMITTED SPAN, never off the drag that was aimed. A
      // synthetic mouse event lands on a whole client pixel, about 1.1 map px at this zoom, which
      // sinks a tight tolerance while saying nothing about the maths under test.
      const got = await dm.evaluate('({ isHex: gridCalIsHex(), n: gridCalSpan && gridCalSpan.n,' +
        ' verts: gridCalSpan ? gridCalHexVerts(gridCalSpan).length : 0, size: gridSize,' +
        ' ax: gridCalSpan && gridCalSpan.ax, ay: gridCalSpan && gridCalSpan.ay,' +
        ' reach: gridCalSpan ? gridCalSpanReach(gridCalSpan) : 0 })');
      const miss = await missAt(got.ax, got.ay);
      rig.note(mode + ' at (' + ax + ',' + ay + '): ' + JSON.stringify(got) +
               ' nearest centre off by ' + miss.toFixed(4) + 'px');
      rig.check(got.isHex === true && got.verts === 6,
                'the ' + mode + ' gesture did not draw a hexagon: ' + JSON.stringify(got));
      rig.check(got.n === 3,
                'the hex count was not guessed from the size already set: ' + got.n);
      rig.check(Math.abs(got.size - got.reach / got.n) < 0.01,
                'the hex drag did not set the cell to the radius divided by its count: ' +
                got.size + ' against ' + (got.reach / got.n));
      rig.check(miss < 0.01,
                'no ' + mode + ' cell centre landed on the point pressed at (' +
                got.ax.toFixed(1) + ',' + got.ay.toFixed(1) + '): the nearest is ' +
                miss.toFixed(2) + 'px away, so the lattice sits off the map');
    }
  }
  await dm.evaluate('document.getElementById("gridcal-done").click(); 0');
  await dm.evaluate('document.getElementById("btn-grid-sq").click(); 0');
};
