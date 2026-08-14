'use strict';

// grid-from-the-floor-plan.js — a map that arrives with its .dd2vtt sets Grid Size itself.
//
// Criteria, each with its check directly beneath.
//
//   An import whose map came with a floor plan gets its Grid Size from the plan.
//     → a 1400px map against a 10-square-wide plan lands on 140, in the global, slider and chip
//   The derived size is stored on the scene, not left on a debounce.
//     → the scene record reads 140 immediately after the import
//   It divides pixels by squares, so a resolution mismatch self-corrects.
//     → the same plan against the same map ignores the plan's own pixels_per_grid of 100
//   The size can never fall outside what the control holds.
//     → a 2-square plan clamps to 400, a 500-square plan clamps to 10
//   Draw Rooms pressed later leaves a hand-tuned grid alone.
//     → set 111 by hand, draw the rooms, the grid is still 111
//   A map with no plan, or an unreadable one, behaves exactly as today.
//     → the import lands on the default 70 and the derivation answers null
//
// ⚠ THE DISK LOOKUP IS STUBBED, AND NOTHING ELSE IS. DOM.setFileInputFiles does not populate a
// file input in an Electron renderer, so an import has to go through a File built in-page — and
// such a File has no path on disk, so findPlanForFile can never find anything. Replacing THAT ONE
// call (a plain function declaration, so it is a window property) puts the real import path,
// the real kernel and the real grid wiring under test. What it cannot speak to is whether a real
// Dungeon Alchemist export's numbers are read correctly; that stays the DM's own hand test.

module.exports = async function gridFromTheFloorPlan(rig) {
  const dm = rig.dm;

  const still = await rig.fixtures.stillMap(dm, rig.fixtureDir,
    { w: 1400, h: 900, name: 'rig-plan-still.png' });
  await rig.fixtures.asFileExpr(dm, still);   // leaves __rigB64 in the page

  await dm.evaluate(`(() => {
    globalThis.__rigFile = name => {
      const bin = atob(globalThis.__rigB64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new File([u8], name, { type: 'image/png' });
    };
    // One room, 6x4 squares, with a door in its top wall so the run is not read as solid rock.
    // pixels_per_grid is deliberately 100 while the map is 1400 wide: the two disagree unless the
    // derivation divides pixels by squares.
    globalThis.__rigPlan = squaresX => JSON.stringify({
      format: 0.3,
      resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: squaresX, y: 14 }, pixels_per_grid: 100 },
      line_of_sight: [
        [{ x: 1, y: 1 }, { x: 4, y: 1 }],
        [{ x: 5, y: 1 }, { x: 7, y: 1 }],
        [{ x: 7, y: 1 }, { x: 7, y: 5 }],
        [{ x: 7, y: 5 }, { x: 1, y: 5 }],
        [{ x: 1, y: 5 }, { x: 1, y: 1 }],
      ],
      portals: [{ bounds: [{ x: 4, y: 1 }, { x: 5, y: 1 }] }],
    });
    // The one stub. null = a map that arrived on its own.
    globalThis.__rigPlanText = null;
    window.findPlanForFile = async () => globalThis.__rigPlanText;
    findPlanForFile = window.findPlanForFile;
    0
  })()`);

  const liveGrid = () => dm.evaluate('({ size: gridSize, offX: gridOffsetX,' +
    ' slider: +document.getElementById("grid-size").value,' +
    ' chip: +document.getElementById("grid-size-num").value,' +
    ' rooms: polygons.length, planBtn: !document.getElementById("btn-floorplan").disabled,' +
    ' notice: (() => { const n = document.getElementById("fp-notice");' +
    '   return !!n && n.style.display === "flex"; })() })');

  // Polled, because the store is written from a toBlob callback. Bounded, and it answers with
  // whatever it last saw rather than throwing, so a miss becomes a named failure below.
  const storedSize = async (id, want) => {
    const deadline = Date.now() + 9000;
    for (;;) {
      const seen = await dm.evaluate('(async () => { const sc = await sceneStore.loadScene(' +
        JSON.stringify(id) + '); return sc && sc.gridConfig ? sc.gridConfig.cellSize : null; })()');
      if (seen === want || Date.now() > deadline) return seen;
      await rig.sleep(200);
    }
  };

  const importAs = async name => {
    await dm.evaluate('createNewScene(__rigFile(' + JSON.stringify(name + '.png') + '))', 120000);
    await dm.waitFor('currentScene && currentScene.name === ' + JSON.stringify(name), 120000,
                     'the import of ' + name);
    return dm.evaluate('currentScene.id');
  };

  // ── A map that arrives with a 10-square-wide plan ────────────────────────────
  await dm.evaluate('globalThis.__rigPlanText = __rigPlan(10); 0');
  const withPlan = await importAs('Watcherhouse');
  const derived = await liveGrid();
  rig.note('imported against a 10-square plan: ' + JSON.stringify(derived));
  rig.check(derived.size === 140,
            'the import did not take its grid from the plan (1400px / 10 squares = 140): ' + derived.size);
  rig.check(derived.slider === 140 && derived.chip === 140,
            'the derived grid never reached the slider and its chip: ' + JSON.stringify(derived));
  rig.check(derived.offX === 0, 'the derivation moved the grid offset, which stays manual: ' + derived.offX);
  rig.check(derived.planBtn, 'Draw Rooms is disabled on a scene that has a plan');
  rig.check(derived.notice, 'the floor-plan notice never appeared for a single import');
  const storedDerived = await storedSize(withPlan, 140);
  rig.check(storedDerived === 140,
            'the derived grid was not saved onto the scene: stored ' + storedDerived);

  // ── Draw Rooms, pressed later, must not touch a hand-set grid ────────────────
  await dm.evaluate('(() => { const s = document.getElementById("grid-size"); s.value = 111;' +
    ' s.dispatchEvent(new Event("input", { bubbles: true })); return 0; })()');
  await dm.evaluate('document.getElementById("btn-floorplan").click(); 0');
  await dm.waitFor('polygons.length > 0', 20000, 'the rooms to be drawn from the plan');
  const afterDraw = await liveGrid();
  rig.note('after Draw Rooms: ' + JSON.stringify(afterDraw));
  rig.check(afterDraw.size === 111,
            'Draw Rooms overwrote the grid the DM had set by hand: ' + afterDraw.size);
  rig.check(afterDraw.rooms > 0, 'Draw Rooms produced no rooms, so the plan under this test is wrong');
  const storedHand = await storedSize(withPlan, 111);
  rig.check(storedHand === 111, 'the hand-set grid was not saved: stored ' + storedHand);

  // ── The clamp, at both ends ──────────────────────────────────────────────────
  const derive = planText => dm.evaluate('(() => { currentScene.floorPlan = ' + planText + ';' +
    ' return applyPlanGridSize(); })()');
  const wide = await derive('__rigPlan(2)');     // 1400 / 2 = 700
  rig.check(wide === 400, 'a grid over the control\'s range was not clamped to 400: ' + wide);
  const narrow = await derive('__rigPlan(500)'); // 1400 / 500 = 2.8
  rig.check(narrow === 10, 'a grid under the control\'s range was not clamped to 10: ' + narrow);
  const stillClamped = await liveGrid();
  rig.check(stillClamped.size === 10 && stillClamped.slider === 10,
            'the clamped value and the slider disagree: ' + JSON.stringify(stillClamped));

  // ── A plan that cannot be read answers null, exactly like no plan ────────────
  const torn = await derive(JSON.stringify('{ "resolution": '));
  rig.check(torn === null, 'a truncated plan produced a grid size: ' + torn);
  const empty = await derive('null');
  rig.check(empty === null, 'a scene with no plan produced a grid size: ' + empty);

  // ── A map that arrives on its own ────────────────────────────────────────────
  await dm.evaluate('globalThis.__rigPlanText = null; 0');
  const noPlan = await importAs('Bare Field');
  const bare = await liveGrid();
  rig.note('imported with no plan: ' + JSON.stringify(bare));
  rig.check(bare.size === 70, 'a map with no plan did not start on the default 70: ' + bare.size);
  rig.check(!bare.planBtn, 'Draw Rooms is enabled on a scene with no plan');
  rig.check(!bare.notice, 'the floor-plan notice appeared for a map with no plan');
  const storedBare = await storedSize(noPlan, 70);
  rig.check(storedBare === 70, 'the plan-less scene stored the wrong grid: ' + storedBare);

  rig.byEye('a real Dungeon Alchemist export plus its sibling .dd2vtt, imported so the derived ' +
            'Grid Size can be held against the map\'s own squares — synthetic fixtures have ' +
            'validated a wrong parser here before, and the disk lookup is stubbed in this file');
};
