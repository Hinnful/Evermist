'use strict';

// grid-belongs-to-the-scene.js — the grid is per-scene, and an import does not inherit the fit.
//
// Criteria, each with its check directly beneath.
//
//   A grid size set on a scene is still there after switching away and back.
//     → set 123 on Alpha, switch to Beta, switch back, the live grid still reads 123
//   One scene's grid never lands on another.
//     → Beta keeps 45 while Alpha holds 123, in both directions
//   Grid Reset puts the grid back to 70 and that survives a switch.
//     → reset on Alpha, switch away and back, the live grid reads 70
//   A freshly imported map does not inherit the previous map's cell size or offset.
//     → import with 45 and offset 30 live, the new scene stores 70 / 0
//   A freshly imported map does keep the look the DM dialled in.
//     → colour, opacity, thickness and grid type carry onto the new scene
//
// ⚠ DRIVE THE SWITCH THROUGH switchScene(), NEVER THE DROPDOWN. openDropdown() calls
// doAutoSave() before it renders, so a switch made by clicking a card persists the outgoing
// grid on its way past and this whole file would pass without the fix under it.
//
// ⚠ NEVER PASS AN ASYNC EXPRESSION TO session.waitFor. It wraps what it is given in `!!(…)`,
// so a promise is truthy on the first poll and the wait returns immediately. Anything that has
// to read IndexedDB is polled from Node here instead.

module.exports = async function gridBelongsToTheScene(rig) {
  const dm = rig.dm;

  const still = await rig.fixtures.stillMap(dm, rig.fixtureDir,
    { w: 1400, h: 900, name: 'rig-grid-still.png' });
  const expr = await rig.fixtures.asFileExpr(dm, still);
  // One fixture, three scenes: rename the same bytes so each import gets its own scene name.
  const named = n => '(f => new File([f], ' + JSON.stringify(n) + ', { type: f.type }))(' + expr + ')';

  const importAs = async name => {
    await dm.evaluate('createNewScene(' + named(name + '.png') + ')', 120000);
    await dm.waitFor('currentScene && currentScene.name === ' + JSON.stringify(name), 120000,
                     'the import of ' + name);
    return dm.evaluate('currentScene.id');
  };

  const storedGrid = id => dm.evaluate('(async () => { const sc = await sceneStore.loadScene(' +
    JSON.stringify(id) + '); return sc && sc.gridConfig ? sc.gridConfig : null; })()');

  // Polled from here, bounded, and it never throws: a miss has to become a named failure below
  // rather than an exception that abandons the rest of the file.
  const waitStored = async (id, size, ms) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const cfg = await storedGrid(id);
      if (cfg && cfg.cellSize === size) return true;
      if (Date.now() > deadline) return false;
      await rig.sleep(200);
    }
  };

  // Through the real control, so the wiring under it is what is being tested.
  const setGridSize = v => dm.evaluate('(() => {' +
    ' const s = document.getElementById("grid-size"); s.value = ' + v + ';' +
    ' s.dispatchEvent(new Event("input", { bubbles: true }));' +
    ' return { live: gridSize, chip: +document.getElementById("grid-size-num").value }; })()');

  const liveGrid = () => dm.evaluate('({ size: gridSize, offX: gridOffsetX, offY: gridOffsetY,' +
    ' color: gridColor, opacity: gridOpacity, mode: gridMode, width: gridLineWidth,' +
    ' chip: +document.getElementById("grid-size-num").value,' +
    ' slider: +document.getElementById("grid-size").value })');

  const switchTo = async id => {
    await dm.evaluate('switchScene(' + JSON.stringify(id) + ')', 120000);
    await dm.waitFor('currentScene && currentScene.id === ' + JSON.stringify(id), 60000,
                     'the switch to ' + id);
  };

  const alpha = await importAs('Alpha');
  const beta  = await importAs('Beta');
  rig.note('scenes: Alpha=' + alpha + ' Beta=' + beta);

  // ── Beta is current. Give it its own grid. ────────────────────────────────────
  const set45 = await setGridSize(45);
  rig.check(set45.live === 45 && set45.chip === 45,
            'the size slider did not drive the global and its number chip: ' + JSON.stringify(set45));
  const beta45 = await waitStored(beta, 45, 9000);
  rig.check(beta45, 'a grid size set on a scene never reached the store, so nothing could survive a switch');

  // ── Away and back: Beta's 45 must not follow, Alpha's own value must return. ──
  await switchTo(alpha);
  const onAlpha = await liveGrid();
  rig.check(onAlpha.size === 70, "Beta's grid size followed the switch onto Alpha: " + onAlpha.size);

  const set123 = await setGridSize(123);
  rig.check(set123.live === 123, 'the slider would not set 123: ' + JSON.stringify(set123));
  const alpha123 = await waitStored(alpha, 123, 9000);
  rig.check(alpha123, "Alpha's grid size never reached the store");

  await switchTo(beta);
  const backOnBeta = await liveGrid();
  rig.check(backOnBeta.size === 45, 'Beta came back with the wrong grid size: ' + backOnBeta.size);
  rig.check(backOnBeta.chip === 45 && backOnBeta.slider === 45,
            'the restored grid size did not reach the slider and its chip: ' + JSON.stringify(backOnBeta));

  await switchTo(alpha);
  const backOnAlpha = await liveGrid();
  rig.check(backOnAlpha.size === 123, 'Alpha came back with the wrong grid size: ' + backOnAlpha.size);

  // ── Reset lands on 70 and persists. ───────────────────────────────────────────
  await dm.evaluate('document.getElementById("btn-grid-reset").click(); 0');
  const afterReset = await liveGrid();
  rig.check(afterReset.size === 70, 'Reset did not put the grid back to 70: ' + afterReset.size);
  const alphaReset = await waitStored(alpha, 70, 9000);
  rig.check(alphaReset, 'Reset never reached the store, so the old size comes back on the next switch');
  await switchTo(beta);
  await switchTo(alpha);
  const afterResetSwitch = await liveGrid();
  rig.check(afterResetSwitch.size === 70, 'the reset grid did not survive a switch: ' + afterResetSwitch.size);

  // ── A new import starts on the default fit, keeping the look. ─────────────────
  await switchTo(beta);
  await dm.evaluate('(() => {' +
    ' const fire = (id, v) => { const el = document.getElementById(id); el.value = v;' +
    '   el.dispatchEvent(new Event("input", { bubbles: true })); };' +
    ' fire("grid-size", 45); fire("grid-offset-x", 30);' +
    ' fire("grid-color", "#ff3366"); fire("grid-opacity", 60); fire("grid-thickness", 3);' +
    ' document.getElementById("btn-grid-hflat").click(); 0 })()');
  const beforeImport = await liveGrid();
  rig.check(beforeImport.size === 45 && beforeImport.offX === 30 && beforeImport.mode === 'hex-flat',
            'the pre-import grid state did not take: ' + JSON.stringify(beforeImport));

  const gamma = await importAs('Gamma');
  const gcfg = await storedGrid(gamma);
  rig.note('the imported scene stored: ' + JSON.stringify(gcfg));
  rig.check(!!gcfg && gcfg.cellSize === 70,
            "a new import inherited the previous map's cell size: " + (gcfg && gcfg.cellSize));
  rig.check(!!gcfg && gcfg.offsetX === 0 && gcfg.offsetY === 0,
            "a new import inherited the previous map's grid offset: " + JSON.stringify(gcfg));
  rig.check(!!gcfg && gcfg.color === '#ff3366' && Math.round(gcfg.opacity * 100) === 60 &&
            gcfg.lineWidth === 3 && gcfg.mode === 'hex-flat',
            'a new import dropped the grid look the DM had dialled in: ' + JSON.stringify(gcfg));
  const onGamma = await liveGrid();
  rig.check(onGamma.size === 70 && onGamma.chip === 70,
            'the imported map is on screen with the old grid size: ' + JSON.stringify(onGamma));
};
