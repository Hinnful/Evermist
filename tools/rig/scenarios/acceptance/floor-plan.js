'use strict';

// floor-plan.js — THE FLOOR-PLAN FEATURE, whole.
//
// THE GOAL OF THIS FEATURE: a Dungeon Alchemist map arrives with its .dd2vtt beside it, and the
// DM gets the whole dungeon already divided into rooms — each one shrouded, ready to reveal as
// the party walks in — with the grid already sitting on the map's own squares. Nothing is drawn
// by hand that the export already knows. Every check below serves that sentence.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks directly beneath it, in order.
//
//   A. An import whose map came with a plan takes its Grid Size FROM the plan, by dividing
//      pixels by squares — so a resolution mismatch corrects itself.
//   B. The derived size is stored on the scene, and can never fall outside the control's range.
//   C. A plan that cannot be read behaves exactly like no plan at all.
//   D. A map that arrives on its own starts on the default grid and offers no Draw Rooms.
//   E. The offer is a NOTICE, not a dialog: it names the room and door counts and the map, carries
//      one CTA and one close, blocks nothing, and does not outlive its scene.
//   F. Draw Rooms draws the plan's rooms onto the loaded map, scaled to it, each one shrouded
//      and named.
//   G. Draw Rooms is wipe-and-rebuild: one undo step back to what was there, and no selection
//      left pointing at a room that no longer exists.
//   H. Replacing rooms that already exist asks first. Drawing onto an empty map does not.
//   I. Draw Rooms pressed later leaves a hand-tuned grid alone.
//   J. A plan with no door anywhere is rock, not rooms: nothing is drawn and nothing is offered.
//   K. Draw Rooms also places the doorways: an opening two rooms share becomes a door, an opening
//      on an outside wall does not, pressing it twice stacks nothing, the doors are saved with the
//      scene, and the notch reaches the Player.
//
// ⚠ THE DISK LOOKUP IS STUBBED, AND NOTHING ELSE IS. DOM.setFileInputFiles does not populate a
// file input in an Electron renderer, so an import has to go through a File built in-page — and
// such a File has no path on disk, so findPlanForFile can never find anything. Replacing THAT ONE
// call (a plain function declaration, so it is a window property) puts the real import path, the
// real kernel and the real grid wiring under test. What it cannot speak to is whether a real
// Dungeon Alchemist export's numbers are read correctly; that stays the DM's own hand test.
//
// ⚠ THE KERNEL'S COORDINATES ARE IN THE EXPORT'S OWN PIXEL SPACE. The two-room plan below is
// written for a 1000px-wide export and the map here is 1400px, so every room must arrive 1.4×
// larger than the kernel's own numbers. A file that checked the kernel's coordinates directly
// would pass with vttScaleRooms deleted.
//
// ⚠ NEVER PASS AN ASYNC EXPRESSION TO waitFor. It wraps what it is given in `!!(…)`, so a promise
// is truthy on the first poll and the wait returns instantly. Anything reading IndexedDB is
// polled from Node here instead.
//
// ⚠ THE MAP IS ANIMATED, AND EVERY ACCEPTANCE FILE'S IS. Animated is the only kind the DM
// ever uses, so a suite running on still PNGs proved the app worked in a case that never
// happens. `tableMap` (tools/rig/fixtures.js) records the clip once per run and caches it by
// size. Do not swap it back to `stillMap`; smoke.js is the one file that wants both.

const MAP_W = 1400, MAP_H = 900;
const SCALE = MAP_W / 1000;     // the two-room plan's own export was 1000px across

module.exports = async function floorPlanFeature(rig) {
  const dm = rig.dm;

  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir,
    { w: MAP_W, h: MAP_H });
  await rig.fixtures.asFileExpr(dm, map);   // leaves __rigB64 in the page

  await dm.evaluate(`(() => {
    globalThis.__rigFile = name => {
      const bin = atob(globalThis.__rigB64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new File([u8], name, { type: 'video/mp4' });
    };

    // ONE ROOM, 6x4 squares, with a door in its top wall so the run is not read as solid rock.
    // pixels_per_grid is deliberately 100 while the map is 1400 wide: the two disagree unless
    // the derivation divides pixels by squares.
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

    // TWO ROOMS sharing a middle wall, each with its own door. Two is the least that can tell
    // "the rooms were drawn" from "one polygon covering the building".
    globalThis.__rigTwoRooms = JSON.stringify({
      format: 0.3,
      resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 10, y: 8 }, pixels_per_grid: 100 },
      line_of_sight: [
        [{ x: 1, y: 1 }, { x: 2, y: 1 }], [{ x: 3, y: 1 }, { x: 5, y: 1 }],
        [{ x: 5, y: 1 }, { x: 9, y: 1 }],
        [{ x: 9, y: 1 }, { x: 9, y: 6 }],
        [{ x: 9, y: 6 }, { x: 1, y: 6 }],
        [{ x: 1, y: 6 }, { x: 1, y: 1 }],
        [{ x: 5, y: 1 }, { x: 5, y: 3 }], [{ x: 5, y: 4 }, { x: 5, y: 6 }],
      ],
      portals: [{ bounds: [{ x: 2, y: 1 }, { x: 3, y: 1 }] },
                { bounds: [{ x: 5, y: 3 }, { x: 5, y: 4 }] }],
    });

    // The same building with every wall intact and no portal anywhere: a doorless loop, which
    // the kernel refuses as rock.
    globalThis.__rigDoorless = JSON.stringify({
      format: 0.3,
      resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 10, y: 8 }, pixels_per_grid: 100 },
      line_of_sight: [
        [{ x: 1, y: 1 }, { x: 9, y: 1 }], [{ x: 9, y: 1 }, { x: 9, y: 6 }],
        [{ x: 9, y: 6 }, { x: 1, y: 6 }], [{ x: 1, y: 6 }, { x: 1, y: 1 }],
      ],
      portals: [],
    });

    // The one stub. null = a map that arrived on its own.
    globalThis.__rigPlanText = null;
    window.findPlanForFile = async () => globalThis.__rigPlanText;
    findPlanForFile = window.findPlanForFile;
    0
  })()`);

  const importAs = async name => {
    await dm.evaluate('createNewScene(__rigFile(' + JSON.stringify(name + '.mp4') + '))', 120000);
    await dm.waitFor('currentScene && currentScene.name === ' + JSON.stringify(name), 120000,
                     'the import of ' + name);
    return dm.evaluate('currentScene.id');
  };

  const state = () => dm.evaluate(`({
    size: gridSize, offX: gridOffsetX,
    slider: +document.getElementById('grid-size').value,
    chip: +document.getElementById('grid-size-num').value,
    rooms: polygons.length,
    planBtn: !document.getElementById('btn-floorplan').disabled,
    selected: selectedPolygonId,
    undoDepth: undoStack.length,
    notice: (() => { const n = document.getElementById('fp-notice');
                     return !!n && n.style.display === 'flex'; })(),
    noticeText: (document.getElementById('fp-notice-msg') || {}).textContent || '',
    dialog: (() => { const a = document.getElementById('cd-anchor');
                     return !!a && a.style.display === 'flex'; })(),
    dialogTitle: (document.getElementById('cd-title') || {}).textContent || '',
  })`);

  const roomBoxes = () => dm.evaluate(`polygons.map(p => ({
    name: p.name, mode: p.mode,
    x1: Math.min(...p.vertices.map(v => v.x)), x2: Math.max(...p.vertices.map(v => v.x)),
    y1: Math.min(...p.vertices.map(v => v.y)), y2: Math.max(...p.vertices.map(v => v.y)),
  }))`);

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

  const drawRooms = async () => {
    await dm.evaluate('document.getElementById("btn-floorplan").click(); 0');
    await rig.sleep(400);
  };

  // ── A. The grid comes from the plan ────────────────────────────────────────
  await dm.evaluate('globalThis.__rigPlanText = __rigPlan(10); 0');
  const withPlan = await importAs('Watcherhouse');
  const derived = await state();
  rig.note('imported against a 10-square plan: size=' + derived.size + ' rooms=' + derived.rooms +
           ' notice=' + derived.notice);
  rig.check(derived.size === 140,
            'the import did not take its grid from the plan (1400px / 10 squares = 140): ' +
            derived.size);
  rig.check(derived.slider === 140 && derived.chip === 140,
            'the derived grid never reached the slider and its chip: ' +
            derived.slider + '/' + derived.chip);
  rig.check(derived.offX === 0,
            'the derivation moved the grid offset, which stays a manual nudge: ' + derived.offX);
  rig.check(derived.planBtn, 'Draw Rooms is disabled on a scene that has a plan');

  // ── B. Stored on the scene, and clamped to the control's range ─────────────
  rig.check(await storedSize(withPlan, 140) === 140,
            'the derived grid was not saved onto the scene, so it is gone on the next switch');

  const derive = planText => dm.evaluate('(() => { currentScene.floorPlan = ' + planText + ';' +
    ' return applyPlanGridSize(); })()');
  const wide = await derive('__rigPlan(2)');       // 1400 / 2 = 700
  rig.check(wide === 400, "a grid over the control's range was not clamped to 400: " + wide);
  const narrow = await derive('__rigPlan(500)');   // 1400 / 500 = 2.8
  rig.check(narrow === 10, "a grid under the control's range was not clamped to 10: " + narrow);
  const clamped = await state();
  rig.check(clamped.size === 10 && clamped.slider === 10,
            'the clamped value and the slider disagree: ' + clamped.size + '/' + clamped.slider);

  // ── C. An unreadable plan is no plan ──────────────────────────────────────
  const torn = await derive(JSON.stringify('{ "resolution": '));
  rig.check(torn === null, 'a truncated plan produced a grid size: ' + torn);
  const empty = await derive('null');
  rig.check(empty === null, 'a scene with no plan produced a grid size: ' + empty);
  await dm.evaluate('currentScene.floorPlan = JSON.stringify("{ broken"); refreshFloorPlanUI(); 0');
  rig.check(!(await state()).planBtn,
            'Draw Rooms is offered for a plan that cannot be parsed, so pressing it does nothing');

  // ── D. A map that arrives on its own ──────────────────────────────────────
  await dm.evaluate('globalThis.__rigPlanText = null; 0');
  const noPlan = await importAs('Bare Field');
  const bare = await state();
  rig.note('imported with no plan: size=' + bare.size + ' planBtn=' + bare.planBtn);
  rig.check(bare.size === 70, 'a map with no plan did not start on the default 70: ' + bare.size);
  rig.check(!bare.planBtn, 'Draw Rooms is enabled on a scene with no plan');
  rig.check(!bare.notice, 'the floor-plan notice appeared for a map with no plan');
  rig.check(await storedSize(noPlan, 70) === 70, 'the plan-less scene stored the wrong grid');

  // ── E. The offer is a notice, not a dialog ────────────────────────────────
  await dm.evaluate('globalThis.__rigPlanText = globalThis.__rigTwoRooms; 0');
  await importAs('Two Halls');
  const offered = await state();
  rig.note('notice: ' + JSON.stringify(offered.noticeText));
  rig.check(offered.notice, 'the floor-plan notice never appeared for an import that had a plan');
  rig.check(offered.noticeText.indexOf('2 rooms') !== -1,
            'the notice does not say how many rooms were found: ' + JSON.stringify(offered.noticeText));
  // One doorway between the two rooms; the plan's other portal is on an outside wall.
  rig.check(offered.noticeText.indexOf('1 door') !== -1,
            'the notice does not say how many doors come with the rooms: ' +
            JSON.stringify(offered.noticeText));
  rig.check(offered.noticeText.indexOf('Two Halls') !== -1,
            'the notice does not name the map it is talking about: ' + JSON.stringify(offered.noticeText));
  rig.check(!offered.dialog,
            'the offer came up as a dialog, which blocks panning the very map it is about');
  rig.check(offered.rooms === 0,
            'the import drew the rooms instead of offering them: ' + offered.rooms);

  const noticeShape = await dm.evaluate(`(() => {
    const n = document.getElementById('fp-notice');
    if (!n) return { err: 'no notice' };
    const s = getComputedStyle(n);
    return {
      ctas: n.querySelectorAll('.fp-cta').length,
      closes: n.querySelectorAll('.fp-x').length,
      // A backdrop is a full-viewport fixed layer. The notice must not be one.
      covers: s.position === 'fixed' && n.clientWidth >= window.innerWidth * 0.95,
    };
  })()`);
  rig.check(noticeShape.ctas === 1 && noticeShape.closes === 1,
            'the notice does not carry exactly one CTA and one close: ' + JSON.stringify(noticeShape));
  rig.check(noticeShape.covers === false,
            'the notice covers the viewport like a backdrop, so the map underneath cannot be ' +
            'panned or zoomed');

  // Escape dismisses it, and it does not reach the map shortcuts on the way out.
  await dm.evaluate(`(() => { const n = document.getElementById('fp-notice');
    n.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return 0; })()`);
  rig.check(!(await state()).notice, 'Escape did not dismiss the floor-plan notice');

  // And an offer about one scene must not outlive it.
  await dm.evaluate('offerStoredFloorPlan(); 0');
  rig.check((await state()).notice, 'the notice could not be raised again for the open scene');
  await dm.evaluate('switchScene(' + JSON.stringify(noPlan) + ')', 120000);
  await dm.waitFor('currentScene && currentScene.id === ' + JSON.stringify(noPlan), 60000,
                   'the switch away from the offered scene');
  rig.check(!(await state()).notice,
            'the notice survived a scene switch, so it is talking about a map that is gone');

  // ── F. Draw Rooms draws the plan's rooms onto THIS map ────────────────────
  const twoHalls = await dm.evaluate('allScenes.find(s => s.name === "Two Halls").id');
  await dm.evaluate('switchScene(' + JSON.stringify(twoHalls) + ')', 120000);
  await dm.waitFor('currentScene && currentScene.name === "Two Halls"', 60000, 'the switch back');
  await drawRooms();
  const drawn = await state();
  const boxes = await roomBoxes();
  rig.note('drawn rooms: ' + JSON.stringify(boxes));
  rig.check(drawn.rooms === 2,
            "Draw Rooms did not draw the plan's two rooms: " + drawn.rooms);
  // ⚠ COUNTED BEFORE IT IS JUDGED. `[].every(...)` is true, so with nothing drawn the three
  // checks below would each report success and only the count above would go red — leaving a
  // report that reads as "the rooms were right, there were just none of them".
  rig.check(boxes.length > 0 && boxes.every(b => b.mode === 'shroud'),
            'a room from the plan did not arrive shrouded, so the map is not ready to reveal: ' +
            JSON.stringify(boxes.map(b => b.mode)));
  rig.check(boxes.length > 0 && boxes.map(b => b.name).join('|') === 'Room 1|Room 2',
            'the rooms are not numbered from 1 in the order they read down the map: ' +
            JSON.stringify(boxes.map(b => b.name)));
  rig.check(boxes.length > 0 &&
            boxes.every(b => b.x1 >= 0 && b.y1 >= 0 && b.x2 <= MAP_W && b.y2 <= MAP_H),
            'a room landed outside the map it was drawn onto: ' + JSON.stringify(boxes));
  // The plan's own export was 1000px across and this map is 1400, so every room is 1.4× the
  // kernel's numbers. Left room: x 100..500 in plan space.
  const left = boxes.find(b => b.x1 < MAP_W / 2);
  rig.check(!!left && Math.abs(left.x1 - 100 * SCALE) <= 2 && Math.abs(left.x2 - 500 * SCALE) <= 2,
            'the rooms were not scaled from the plan\'s pixel space onto this map: the left room ' +
            'spans ' + JSON.stringify(left) + ', expected x ' + (100 * SCALE) + '..' + (500 * SCALE));

  // ── G. Wipe-and-rebuild ───────────────────────────────────────────────────
  // Cut back to ONE room first, and cut it back by hand rather than through undo: with two rooms
  // either side of the draw, "the previous rooms came back" and "nothing happened at all" read
  // the same. The state is written directly so the undo depth measured below belongs to the draw.
  await dm.evaluate('polygons = [polygons[0]]; selectedPolygonId = polygons[0].id;' +
    ' rebuildFogFromPolygons(); refreshRoomPanel(); 0');
  const beforeUndo = (await state()).undoDepth;
  await drawRooms();
  // Rooms exist, so this is the replacement question — section H is what asserts it appears.
  await dm.evaluate('(() => { const b = document.getElementById("cd-ok");' +
    ' if (b) b.click(); return 0; })()');
  await rig.sleep(400);
  const again = await state();
  rig.check(again.rooms === 2,
            'replacing one room with the plan did not draw its two: ' + again.rooms);
  rig.check(again.selected === null,
            'the wipe left a room selected that no longer exists, so the room card is open on a ' +
            'ghost: ' + again.selected);
  rig.check(again.undoDepth === beforeUndo + 1,
            'Draw Rooms did not push exactly one undo step: ' + beforeUndo + ' → ' + again.undoDepth);
  await dm.evaluate('undo(); 0');
  await rig.sleep(400);
  rig.check((await state()).rooms === 1,
            'undo after Draw Rooms did not put the one previous room back: ' +
            (await state()).rooms);

  // ── H. Replacing rooms asks; drawing onto an empty map does not ───────────
  await drawRooms();
  const asked = await state();
  rig.note('asked before replacing: ' + JSON.stringify(asked.dialogTitle));
  rig.check(asked.dialog && asked.dialogTitle.indexOf('Replace') !== -1,
            'Draw Rooms replaced rooms that were already there without asking: ' +
            JSON.stringify(asked));
  await dm.evaluate('(() => { const b = document.getElementById("cd-cancel");' +
    ' if (b) b.click(); return 0; })()');
  await rig.sleep(400);
  rig.check((await state()).rooms === 1,
            'keeping the existing room deleted it anyway: ' + (await state()).rooms);

  await dm.evaluate('polygons = []; selectedPolygonId = null;' +
    ' rebuildFogFromPolygons(); refreshRoomPanel(); 0');
  await drawRooms();
  const fresh = await state();
  rig.check(!fresh.dialog,
            'Draw Rooms asked before drawing onto a map with no rooms on it: ' +
            JSON.stringify(fresh.dialogTitle));
  rig.check(fresh.rooms === 2, 'Draw Rooms onto an empty map drew nothing: ' + fresh.rooms);

  // ── I. A hand-tuned grid survives Draw Rooms ──────────────────────────────
  await dm.evaluate('(() => { const s = document.getElementById("grid-size"); s.value = 111;' +
    ' s.dispatchEvent(new Event("input", { bubbles: true })); return 0; })()');
  await dm.evaluate('pushUndo(); polygons = []; rebuildFogFromPolygons(); 0');
  await drawRooms();
  const afterDraw = await state();
  rig.check(afterDraw.size === 111,
            'Draw Rooms overwrote the grid the DM had set by hand: ' + afterDraw.size);
  rig.check(afterDraw.rooms === 2, 'Draw Rooms produced no rooms on the hand-tuned scene');
  rig.check(await storedSize(twoHalls, 111) === 111, 'the hand-set grid was not saved');

  // ── J. A doorless plan is rock ────────────────────────────────────────────
  await dm.evaluate('currentScene.floorPlan = globalThis.__rigDoorless; refreshFloorPlanUI(); 0');
  const doorless = await state();
  rig.check(!doorless.planBtn,
            'Draw Rooms is offered for a plan with no door anywhere, and pressing it can only ' +
            'do nothing');
  await dm.evaluate('offerStoredFloorPlan(); 0');
  rig.check(!(await state()).notice,
            'a doorless plan raised the offer, so the DM is told rooms were found that were not');
  await dm.evaluate('drawStoredFloorPlan(); 0');
  await rig.sleep(300);
  rig.check((await state()).rooms === 2,
            'a doorless plan wiped the rooms that were already drawn: ' + (await state()).rooms);

  // ── K. Draw Rooms places the doorways too ─────────────────────────────────
  // Back to the two-room plan on its own grid, so a cell boundary falls where the plan's own
  // squares do and the door's coordinates below are arithmetic rather than a guess.
  await dm.evaluate('(() => { const s = document.getElementById("grid-size"); s.value = 140;' +
    ' s.dispatchEvent(new Event("input", { bubbles: true }));' +
    ' currentScene.floorPlan = globalThis.__rigTwoRooms; refreshFloorPlanUI();' +
    ' pushUndo(); polygons = []; rebuildFogFromPolygons(); return 0; })()');
  await drawRooms();

  // Every door on the map, in map pixels, whichever room stores it.
  const doorPts = () => dm.evaluate(`polygons.flatMap(p => (p.doors || []).map(d => {
    const c = doorPoint(p.vertices, d);
    return { room: p.name, x: Math.round(c.x), y: Math.round(c.y) };
  }))`);

  const placed = await doorPts();
  rig.note('doors from the plan: ' + JSON.stringify(placed));
  // The shared wall runs down x=5 in plan space, the doorway spans y 3..4, and the map is 1.4×
  // the plan's own export: 700, 490.
  rig.check(placed.length === 1,
            'Draw Rooms did not place the one doorway the two rooms share: ' +
            JSON.stringify(placed));
  rig.check(placed.length === 1 && Math.abs(placed[0].x - 700) <= 2 &&
            Math.abs(placed[0].y - 490) <= 2,
            'the derived door did not land on the shared wall at 700,490: ' +
            JSON.stringify(placed));
  // The plan's other portal sits at 350,140 — the left room's outside wall, and nothing else's.
  // A window and an outside entrance look identical in the file, so neither is guessed at.
  rig.check(!placed.some(d => Math.abs(d.x - 350) <= 70 && Math.abs(d.y - 140) <= 70),
            'an opening on an outside wall was turned into a door, which would mark every ' +
            'window on the map: ' + JSON.stringify(placed));
  rig.check((await state()).rooms === 2, 'the rooms themselves were lost: ' + (await state()).rooms);

  // Pressed again: the same plan, the same cell, and still one door.
  await drawRooms();
  await dm.evaluate('(() => { const b = document.getElementById("cd-ok");' +
    ' if (b) b.click(); return 0; })()');
  await rig.sleep(400);
  const twice = await doorPts();
  rig.check(twice.length === 1,
            'Draw Rooms pressed twice stacked doors on the same cell: ' + JSON.stringify(twice));

  // Saved with the scene, or the DM re-marks every doorway on the next switch.
  await dm.evaluate('switchScene(' + JSON.stringify(noPlan) + ')', 120000);
  await dm.waitFor('currentScene && currentScene.id === ' + JSON.stringify(noPlan), 60000,
                   'the switch away from the drawn doors');
  await dm.evaluate('switchScene(' + JSON.stringify(twoHalls) + ')', 120000);
  await dm.waitFor('currentScene && currentScene.name === "Two Halls"', 60000,
                   'the switch back to the drawn doors');
  const survived = await doorPts();
  rig.check(survived.length === 1 && Math.abs(survived[0].x - 700) <= 2 &&
            Math.abs(survived[0].y - 490) <= 2,
            'the derived door did not survive a scene switch: ' + JSON.stringify(survived));

  // ⚠ THE DEPTH IS WIDENED FIRST. At the default 10% the notch is under four pixels on the
  // Player's fog canvas, so a sample either side of the wall would be reading the feather.
  // ⚠ THE LEFT ROOM IS FOUND BY ITS LEFTMOST VERTEX, never by vertices[0]. That is wherever the
  // kernel's face walk happened to start the ring, so a room spanning 140..700 can report 700 —
  // and the find would then match nothing and kill the run with a TypeError, not a named FAIL.
  await dm.evaluate('doorDepthPct = 60;' +
    ' polygons.find(p => Math.min(...p.vertices.map(v => v.x)) < 400).mode = "reveal";' +
    ' rebuildFogFromPolygons(); rebuildFogEffect(); fogDirty = true;' +
    ' scheduleRender(); scheduleAutoSync(); 0');

  const player = await rig.player();
  await player.waitFor('!!fogDataCanvas', 45000, 'the Player to receive the map');
  await player.waitFor('fogCoverT === 0', 45000, 'the scene cover to lift on the Player');
  const SAMPLE = `((mx, my) => fogDataCtx.getImageData(
    Math.round(mx / FOG_SCALE), Math.round(my / FOG_SCALE), 1, 1).data[3])`;
  // 42px past the shared wall, inside the still-shrouded right room: at the doorway and well
  // clear of it. The second point is what says the right room is dark at all, so the clear
  // reading at the doorway is a hole rather than a room that was never shrouded.
  try { await player.waitFor(SAMPLE + '(742, 490) < 60', 30000, 'the notch to reach the Player'); }
  catch (_) {}
  const atDoor = await player.evaluate(SAMPLE + '(742, 490)');
  const awayFromDoor = await player.evaluate(SAMPLE + '(742, 250)');
  rig.note('Player fog inside the shrouded room — at the doorway ' + atDoor +
           ', away from it ' + awayFromDoor);
  rig.check(awayFromDoor > 200,
            'the shrouded room reads clear on the Player away from the door, so the sample at ' +
            'the door proves nothing: alpha ' + awayFromDoor);
  rig.check(atDoor < 60,
            'the derived door carved no notch on the Player, so the TV shows an unbroken wall ' +
            'where the doorway is: alpha ' + atDoor);

  rig.byEye('a real Dungeon Alchemist export plus its sibling .dd2vtt, imported so the derived ' +
            "Grid Size can be held against the map's own squares and the rooms against its own " +
            'walls — synthetic fixtures have validated a wrong parser here before, and the disk ' +
            'lookup is stubbed in this file');
};
