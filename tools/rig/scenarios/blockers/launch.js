'use strict';

// launch.js — THE APP STARTS. The one blocker a machine with no GPU and no display can answer.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   A. The DM window loads and finishes starting, with the preload's bridge to the main process in it.
//   B. The window's own page, renderer and scene library are up.
//   (No console error is the run's own check: run.js fails any scenario that logs one.)

const lib = require('../../lib');

module.exports = async function launch(rig) {
  const dm = rig.dm;

  // ── A. The DM window loads and finishes starting ──────────────────────────
  // RED ON: pixiApp set to null and sceneStore.listScenes made to throw before the checks — 2026-11-05
  const up = await dm.evaluate(`({
    ready: typeof _cpGridPicker !== 'undefined' && !!_cpGridPicker,
    bridge: !!window.electronAPI && Object.keys(window.electronAPI).length > 0,
    page: location.pathname.endsWith('index.html'),
  })`);
  rig.check(up.page, 'the DM window is not on index.html: ' + JSON.stringify(up));
  rig.check(up.ready, 'the DM window never finished starting its control panel');
  rig.check(up.bridge, 'the preload did not run, so the window has no way to reach the main process');

  // ── B. The renderer and the library are up ────────────────────────────────
  const parts = await dm.evaluate(`(async () => ({
    renderer: !!pixiApp,
    library: Array.isArray(await sceneStore.listScenes()),
    dock: !!document.getElementById('dock-tab-music'),
  }))()`, 30000);
  rig.check(parts.renderer, 'the renderer did not start, so no map could be drawn');
  rig.check(parts.library, 'the scene library did not open, so no map could be kept');
  rig.check(parts.dock, 'the dock is not on the page');
  await lib.settle(dm, '!viewportDirty', 10000);
};
