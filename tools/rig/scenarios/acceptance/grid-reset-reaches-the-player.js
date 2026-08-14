'use strict';

// grid-reset-reaches-the-player.js — Reset is a grid control like any other, so the TV has to
// follow it. Nothing has ever watched a Player window receive one.
//
// Criteria, each with its check directly beneath.
//
//   A grid size the DM dials in reaches the Player.
//     → the Player's own grid size follows 137, and it paints lines 137 map-units apart
//   The rest of the grid look reaches it too.
//     → offset, colour, opacity, thickness and grid type all arrive
//   Grid Reset reaches the Player like every other grid control.
//     → after Reset the Player reads 70, no offset, white, 25%, 1px, square
//   The Player PAINTS the reset grid rather than merely holding it.
//     → the spacing measured off #player-grid-canvas is the default size, not the old one
//   Reset leaves the grid switched on.
//     → the Player is still drawing a grid at all afterwards
//
// ⚠ THE FULLSCREEN PLAYER COVERS THE DM, so the two windows are driven in turns. Nothing here
// needs the DM to paint: every grid control is driven through its real handler, and the delivery
// (sendToPlayer, from scheduleAutoSync's timer) needs no frame. The DM's timers are throttled
// while it is occluded, so every wait below is generous rather than tight.
//
// ⚠ SET THE SIZE WHILE THE GRID IS STILL SQUARE. drawGridLines paints hexes in either hex mode, so
// a spacing measured across one row is only a cell size in square mode. The grid type is checked
// through the Player's own global instead.
//
// ⚠ THE GRID IS OFF BY DEFAULT (state.js), and a Player that is not drawing a grid would pass a
// "the reset grid arrived" check with an empty canvas. It is switched on first, and that it stays
// on is its own criterion.

const path = require('path');

const MAP_W = 1400, MAP_H = 900;
const DIALLED = 137;      // far from the default, and not a multiple of it
const DEFAULT = 70;

module.exports = async function gridResetReachesThePlayer(rig) {
  const dm = rig.dm;

  const still = await rig.fixtures.stillMap(dm, rig.fixtureDir,
    { w: MAP_W, h: MAP_H, name: 'rig-gridreset-still.png' });
  const expr = await rig.fixtures.asFileExpr(dm, still);
  await dm.evaluate('createNewScene(' + expr + ')', 120000);
  await dm.waitFor('currentScene && currentScene.mapType === "image" && mapWidth === ' + MAP_W,
                   120000, 'the generated map to load on the DM');

  // Auto-sync is what carries a grid change to the Player. It is on by default; asserted rather
  // than assumed, because with it off this whole file would pass by never delivering anything.
  rig.check(await dm.evaluate('autoSync === true'),
            'auto-sync is off, so no grid change could reach the Player and every check below ' +
            'would be measuring the Player\'s own defaults');

  // The grid, switched on through its real button.
  await dm.evaluate('document.getElementById("btn-grid").click(); 0');
  rig.check(await dm.evaluate('gridEnabled === true'), 'the grid button did not switch the grid on');

  const player = await rig.player();
  await player.waitFor('!!mapOffscreen && !!fogDataCanvas', 45000, 'the Player to receive the map');
  await player.waitFor('fogCoverT === 0', 45000, 'the scene cover to lift on the Player');
  rig.note('DM occluded by the fullscreen Player: document.hidden=' +
           await dm.evaluate('document.hidden'));

  const playerGrid = () => player.evaluate('({ on: gridEnabled, size: gridSize, offX: gridOffsetX,' +
    ' offY: gridOffsetY, color: gridColor, opacity: +gridOpacity.toFixed(2), mode: gridMode,' +
    ' width: gridLineWidth })');

  // The spacing the Player actually PAINTS, read straight off its grid canvas. One row, the
  // leading edge of each line, the median gap — so a stray line or the map's own edge cannot
  // move the answer. Divided back through the camera, it is a cell size in map units.
  const paintedSpacing = () => player.evaluate(`(() => {
    const c = document.getElementById('player-grid-canvas');
    if (!c || !c.width || !c.height) return { err: 'the Player has no grid canvas' };
    const y = Math.floor(c.height / 2);
    const d = c.getContext('2d').getImageData(0, y, c.width, 1).data;
    const starts = [];
    let run = false;
    for (let x = 0; x < c.width; x++) {
      const on = d[x * 4 + 3] > 8;
      if (on && !run) starts.push(x);
      run = on;
    }
    const gaps = [];
    for (let i = 1; i < starts.length; i++) gaps.push(starts[i] - starts[i - 1]);
    gaps.sort((a, b) => a - b);
    const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
    return { lines: starts.length, gapPx: median, zoom, cell: zoom ? +(median / zoom).toFixed(1) : 0 };
  })()`);

  // Bounded, never throws: a miss has to land as the named check below rather than an exception
  // that abandons the rest of the file.
  const waitPlayerSize = async (want, ms) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const seen = await player.evaluate('gridSize');
      if (seen === want || Date.now() > deadline) return seen;
      await rig.sleep(250);
    }
  };

  const repaint = async () => {
    await player.evaluate('gridDirty = true; viewportDirty = true; scheduleRender(); 0');
    await rig.sleep(400);
  };

  const fire = ids => dm.evaluate('(() => {' +
    ' const set = (id, v) => { const el = document.getElementById(id); el.value = v;' +
    '   el.dispatchEvent(new Event("input", { bubbles: true })); };' +
    ids + ' return 0; })()');

  // ── A size dialled in on the DM reaches the Player, and gets painted ────────
  await fire('set("grid-size", ' + DIALLED + ');');
  const sawDialled = await waitPlayerSize(DIALLED, 30000);
  rig.check(sawDialled === DIALLED,
            'a grid size set on the DM never reached the Player: it reads ' + sawDialled);
  await repaint();
  const dialledPaint = await paintedSpacing();
  rig.note('Player painted at ' + DIALLED + ': ' + JSON.stringify(dialledPaint));
  rig.check(!dialledPaint.err && dialledPaint.lines >= 3,
            'the Player is painting no grid at all, so the spacing below means nothing: ' +
            JSON.stringify(dialledPaint));
  rig.check(Math.abs(dialledPaint.cell - DIALLED) <= 2,
            'the Player is painting a grid at the wrong cell size: ' + dialledPaint.cell +
            ' map units, expected ' + DIALLED);

  // ── The rest of the look, then Reset ────────────────────────────────────────
  await fire('set("grid-offset-x", 33); set("grid-offset-y", 44); set("grid-color", "#ff3366");' +
             ' set("grid-opacity", 60); set("grid-thickness", 3);');
  await dm.evaluate('document.getElementById("btn-grid-hflat").click(); 0');

  const deadline = Date.now() + 30000;
  let dialled = null;
  for (;;) {
    dialled = await playerGrid();
    if (dialled.mode === 'hex-flat' && dialled.color === '#ff3366' && dialled.width === 3) break;
    if (Date.now() > deadline) break;
    await rig.sleep(250);
  }
  rig.note('Player holds the dialled-in look: ' + JSON.stringify(dialled));
  rig.check(dialled.offX === 33 && dialled.offY === 44,
            'the grid offset never reached the Player: ' + JSON.stringify(dialled));
  rig.check(dialled.color === '#ff3366' && dialled.opacity === 0.6 && dialled.width === 3,
            'the grid colour, opacity or thickness never reached the Player: ' + JSON.stringify(dialled));
  rig.check(dialled.mode === 'hex-flat',
            'the grid type never reached the Player: ' + dialled.mode);

  await dm.evaluate('document.getElementById("btn-grid-reset").click(); 0');
  const sawReset = await waitPlayerSize(DEFAULT, 30000);
  const reset = await playerGrid();
  rig.note('Player after Grid Reset: ' + JSON.stringify(reset));
  rig.check(sawReset === DEFAULT,
            'Grid Reset never reached the Player — the TV keeps the old cell size: it reads ' + sawReset);
  rig.check(reset.offX === 0 && reset.offY === 0,
            'the reset offset never reached the Player: ' + JSON.stringify(reset));
  rig.check(reset.color === '#ffffff' && reset.opacity === 0.25 && reset.width === 1,
            'the reset colour, opacity or thickness never reached the Player: ' + JSON.stringify(reset));
  rig.check(reset.mode === 'square', 'the reset grid type never reached the Player: ' + reset.mode);

  // ── The Player paints the reset grid, and is still drawing one at all ───────
  rig.check(reset.on === true,
            'Reset switched the grid off on the Player, so the table lost it entirely');
  await repaint();
  const resetPaint = await paintedSpacing();
  rig.note('Player painted after Reset: ' + JSON.stringify(resetPaint));
  rig.check(!resetPaint.err && resetPaint.lines >= 3,
            'the Player stopped painting a grid after Reset: ' + JSON.stringify(resetPaint));
  rig.check(Math.abs(resetPaint.cell - DEFAULT) <= 2,
            'the Player is still painting the old grid after Reset: ' + resetPaint.cell +
            ' map units, expected ' + DEFAULT);

  const shot = path.join(rig.outDir, 'player-grid-reset.png');
  await player.screenshot(shot);
  rig.note('Player screenshot: ' + shot);
  rig.byEye('whether the reset grid in ' + shot + ' sits at a weight the table can read without ' +
            'fighting the map — line strength is a look call, not a pixel one');
};
