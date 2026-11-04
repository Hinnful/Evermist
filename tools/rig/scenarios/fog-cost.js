'use strict';

// fog-cost.js - what the fog costs on the Player, for the fog themes release gate (backlog item 254).
// Not a pass/fail scenario and not in the regression set: it notes frame rate and memory, and the
// person reading the run compares them. Run by name: `npm run rig -- fog-cost`.
//
// The whole map is hidden (Hide all), so the fog covers every Player pixel: the worst case for a
// per-pixel fog pass. Each theme the app offers is measured in turn, inside one run, because a
// cross-run comparison on this machine is worthless (docs/DECISIONS.md).

const lib = require('../lib');

const FPS_MS = 4000;

async function playerFps(player) {
  return player.evaluate(`new Promise(r => { let n = 0; const s = performance.now();
    (function f() { n++; if (performance.now() - s < ${FPS_MS}) requestAnimationFrame(f);
      else r(Math.round(n * 1000 / (performance.now() - s))); })(); })`);
}

async function memoryMB(dm) {
  return dm.evaluate(`window.electronAPI.memMetrics().then(ms => {
    const total = ms.reduce((t, m) => t + m.workingSetKB, 0), gpu = ms.filter(m => m.type === 'GPU')
      .reduce((t, m) => t + m.workingSetKB, 0);
    return { totalMB: Math.round(total / 1024), gpuMB: Math.round(gpu / 1024) }; })`);
}

module.exports = async function fogCost(rig) {
  const dm = rig.dm;
  await lib.openMap(rig);
  const player = await rig.player();
  await dm.evaluate('document.getElementById("btn-fill-fog").click(); 0');
  await lib.settle(player, 'typeof fogCoverT === "undefined" || fogCoverT === 0', 30000);
  await lib.hold(4000, 'the cloud frames and the fill crossfade settle before measuring');

  // The theme list, when the app has one; today's app measures its single fog look.
  const themes = await dm.evaluate('typeof FOG_THEMES !== "undefined" ? FOG_THEMES.map(t => t.id) : ["today"]');
  for (const id of themes) {
    if (id !== 'today') {
      await dm.evaluate('setFogTheme(' + JSON.stringify(id) + '); 0');
      await lib.hold(4000, 'the theme reaches the Player and its colour ease finishes');
    }
    const fps = await playerFps(player);
    const mem = await memoryMB(dm);
    rig.note('fog ' + id + ': Player ' + fps + ' fps, memory ' + mem.totalMB + ' MB total, GPU process '
      + mem.gpuMB + ' MB');
  }
};
