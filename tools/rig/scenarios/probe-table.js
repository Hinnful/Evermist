'use strict';

// probe-table.js - THROWAWAY. THE DM'S REAL TABLE FLOW, which none of the other probes tested:
// one map up, the Player window already open and showing it, then press Two maps to add a second.
// Samples the app's own _diagFps in every window across that transition.
// Delete it once the transition is settled.

const FILE_A = process.env.EV_FILE_A;
const FILE_B = process.env.EV_FILE_B;
const SAMPLES = +(process.env.EV_SAMPLES || 26);
const GAP = +(process.env.EV_GAP || 400);
// EV_W / EV_H size the generated still maps. Tiny maps make the texture work trivial and leave
// every other step of the transition exactly as it was.
const STILL_W = +(process.env.EV_W || 3800);
const STILL_H = +(process.env.EV_H || 2100);

async function realFile(rig, abs) {
  const fs = require('fs');
  const b = fs.readFileSync(abs);
  const name = require('path').basename(abs);
  const type = /\.mp4$/i.test(name) ? 'video/mp4' : /\.webm$/i.test(name) ? 'video/webm'
             : /\.png$/i.test(name) ? 'image/png' : 'image/jpeg';
  rig.note('using ' + name + ' (' + (b.length / 1048576).toFixed(1) + ' MB)');
  return { name, type, base64: b.toString('base64') };
}

module.exports = async function probeTable(rig) {
  const dm = rig.dm;
  if (!FILE_A || !FILE_B) { rig.check(false, 'set EV_FILE_A and EV_FILE_B'); return; }

  // EV_STILL swaps both maps for generated stills of the same pixel size: if the sag is the video
  // decoder priming, it goes away here, and if it does not, the decoder is not the cause.
  const still = process.env.EV_STILL === '1';
  const load = async function (abs, tag) {
    const src = still
      ? await rig.fixtures.stillMap(dm, rig.fixtureDir,
          { w: STILL_W, h: STILL_H, name: 'rig-table-still-' + STILL_W + 'x' + STILL_H + '-' + tag + '.png' })
      : await realFile(rig, abs);
    const expr = await rig.fixtures.asFileExpr(dm, src);
    await dm.evaluate('createNewScene(' + expr + ')', 600000);
    await dm.waitFor('currentScene && mapWidth > 0', 600000, 'the map to load');
    await dm.waitFor('fogCoverT === 0', 60000, 'the scene cover to lift');
    return dm.evaluate('({ id: currentScene.id, w: mapWidth })');
  };

  const recA = await load(FILE_A, 'a');
  const recB = await load(FILE_B, 'b');

  // Back to map A, and reveal some ground so the map is actually visible through the fog.
  await dm.evaluate('switchScene(' + JSON.stringify(recA.id) + '); 0');
  await dm.waitFor('currentScene && mapWidth === ' + recA.w, 600000, 'map A back on the DM');
  await dm.waitFor('fogCoverT === 0', 60000, 'the cover to lift');
  await dm.evaluate(`(() => {
    const r = Math.min(mapWidth, mapHeight) * 0.3;
    revealCircle(mapWidth * 0.4, mapHeight * 0.5, r);
    rebuildFogEffect(); fogDirty = true; scheduleRender(); scheduleAutoSync(); return 0;
  })()`);

  // THE STARTING STATE: one map, Player window open and showing it. This is the table.
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen', 120000, 'the Player to show map A');
  await rig.sleep(2500);
  rig.note((still ? 'still maps ' + STILL_W + 'x' + STILL_H : 'real map files') +
           ' | settled: one map up, Player open. DM fps=' + await dm.evaluate('_diagFps') +
           '  Player fps=' + await player.evaluate('_diagFps'));

  // THE MOMENT UNDER TEST: press Two maps with the Player already live.
  // Time every app function the DM runs during the transition, so the repeating work can be named.
  await dm.evaluate(`globalThis.__fn = {};
    globalThis.__wrap = function (names) {
      for (var i = 0; i < names.length; i++) {
        var n = names[i], f = globalThis[n];
        if (typeof f !== 'function' || f.__probed) continue;
        (function (n, f) {
          var rec = globalThis.__fn[n] = { calls: 0, ms: 0, max: 0 };
          var w = function () {
            var s = performance.now();
            try { return f.apply(this, arguments); }
            finally { var d = performance.now() - s; rec.calls++; rec.ms += d; if (d > rec.max) rec.max = d; }
          };
          w.__probed = true; globalThis[n] = w;
        })(n, f);
      }
    }; 0`);
  await dm.evaluate(`__wrap(['doRender','pumpEffects','drawMinimap','renderGrid','drawCursor',
    'fogAnimTick','syncSize','applyPaneSplit','renderSceneManager','buildSceneCard','sendStageSplit',
    'bindStageHalves','paneAdoptSelectedSettings','showFogSettings','updateTriggerName',
    'refreshTwoMapsButton','smSizeNameFields','drawGridLines','drawPolyOutline','drawRoomLabels',
    'refreshRoomPanel','minimapSeedView','scheduleRender','pumpDirtyRender','teardownParentMap',
    'buildPaneRow','enterPanes','toggleStageWindow','doAutoSave','renderSceneManagerGroups']); 0`);

  // ⚠ THE COLUMNS AND HALVES DO NOT EXIST AT PRESS TIME, so they are armed from INSIDE the DM
  // page: an in-page poll costs nothing on the wire, where a CDP poll would wait on the very
  // thread being measured.
  // EV_NOARM=1 skips the in-page armer entirely, so its own effect on the transition can be seen.
  if (process.env.EV_NOARM !== '1') await dm.evaluate(`
    globalThis.__kids = {};
    globalThis.__armKid = function (key, w) {
      if (!w || globalThis.__kids[key] || typeof w.doRender !== 'function') return;
      globalThis.__kids[key] = w;
      w.eval(\`
        globalThis.__fn = {}; globalThis.__gapT0 = performance.now(); globalThis.__gaps = [];
        globalThis.__wrap = function (names) {
          for (var i = 0; i < names.length; i++) {
            var n = names[i], f = globalThis[n];
            if (typeof f !== 'function' || f.__probed) continue;
            (function (n, f) {
              var rec = globalThis.__fn[n] = { calls: 0, ms: 0, max: 0 };
              var w2 = function () {
                var s = performance.now();
                try { return f.apply(this, arguments); }
                finally { var d = performance.now() - s; rec.calls++; rec.ms += d; if (d > rec.max) rec.max = d; }
              };
              w2.__probed = true; globalThis[n] = w2;
            })(n, f);
          }
        };
        __wrap(['doRender','pumpEffects','fogAnimTick','renderFog','renderGrid','renderPlayerGrid',
                'drawCursor','drawMinimap','rebuildFogEffect','rebuildFogBlur','rebuildFogFromPolygons',
                'generateCloudFrames','pixiSetMap','prepareTextureCanvas','initPixiRenderer',
                'pixiInitFog','pixiInitPlayerFog','pixiSyncPlayerFog','switchScene','loadFogFromScene',
                'sendToPlayer','syncSize','fitToScreen','drawChasm','initPlayer','initPane',
                'refreshPlayerMapRegion','initPlayerMapRegionTexture','startVideoLoop','cleanupVideo',
                'drawLoadingFog','renderSceneManager','applyPolygonToFog','cloneCanvas']);
        (function () { var last = performance.now();
          (function tick() { var n = performance.now();
            globalThis.__gaps.push([Math.round(n - globalThis.__gapT0), +(n - last).toFixed(1)]);
            last = n; requestAnimationFrame(tick); })(); })();
      \`);
    };
    (function poll() {
      try {
        if (typeof panes !== 'undefined') for (const id of ['A','B']) {
          const f = panes[id] && panes[id].frame;
          globalThis.__armKid('col' + id, f && f.contentWindow);
        }
        const sh = (typeof _stageWindow !== 'undefined' && _stageWindow) || null;
        if (sh) {
          globalThis.__armKid('shell', sh);
          if (sh.stageFrameWindow) for (const id of ['A','B'])
            globalThis.__armKid('half' + id, sh.stageFrameWindow(id));
        }
      } catch (e) {}
      setTimeout(poll, 40);
    })();
    0`);

  // The DM window survives the whole transition, so its own paint clock is the honest witness.
  await dm.evaluate(`globalThis.__gapT0 = performance.now(); globalThis.__gaps = [];
    (function () { var last = performance.now();
      (function tick() { var n = performance.now();
        globalThis.__gaps.push([Math.round(n - globalThis.__gapT0), +(n - last).toFixed(1)]);
        last = n; requestAnimationFrame(tick); })(); })(); 0`);
  const t0 = Date.now();
  await dm.evaluate('globalThis.__gapT0 = performance.now(); globalThis.__gaps.length = 0;' +
                    ' document.getElementById("btn-two-maps").click(); 0');
  const pressedAt = t0;
  await rig.sleep(12000);

  // One frames-per-second figure per whole second, from the DM's own record.
  const profile = await dm.evaluate(`(() => {
    const b = [];
    for (let i = 0; i < 12; i++) b.push(0);
    for (const [at] of globalThis.__gaps) { const s = Math.floor(at / 1000); if (s < 12) b[s]++; }
    const long = globalThis.__gaps.filter(g => g[1] > 150).map(g => g[1] + 'ms@' + g[0]);
    return { fps: b, longFrames: long.slice(0, 14), count: globalThis.__gaps.length };
  })()`);
  rig.note('DM frames per second, unpolled: ' + profile.fps.join(' '));
  rig.note('DM frames over 150ms: ' + (profile.longFrames.join(', ') || 'none'));
  const fns = await dm.evaluate(`(() => Object.keys(globalThis.__fn)
    .map(k => ({ name: k, ...globalThis.__fn[k] }))
    .filter(r => r.ms >= 1)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 10)
    .map(r => r.name + ' ' + Math.round(r.ms) + 'ms/' + r.calls + ' calls, worst ' +
              Math.round(r.max) + 'ms'))()`);
  rig.note('DM time by function across the transition:');
  for (const line of fns) rig.note('    ' + line);

  const kids = process.env.EV_NOARM === '1' ? {} : await dm.evaluate(`(() => {
    const out = {};
    for (const key of Object.keys(globalThis.__kids)) {
      const w = globalThis.__kids[key];
      try {
        out[key] = w.eval(\`(() => {
          const b = []; for (let i = 0; i < 12; i++) b.push(0);
          for (const [at] of globalThis.__gaps) { const s = Math.floor(at / 1000); if (s < 12) b[s]++; }
          const top = Object.keys(globalThis.__fn)
            .map(k => ({ name: k, ...globalThis.__fn[k] }))
            .filter(r => r.ms >= 2).sort((a, b2) => b2.ms - a.ms).slice(0, 6)
            .map(r => r.name + ' ' + Math.round(r.ms) + 'ms/' + r.calls + ' worst ' + Math.round(r.max) + 'ms');
          return { fps: b, top };
        })()\`);
      } catch (e) { out[key] = { error: String(e && e.message) }; }
    }
    return out;
  })()`);
  for (const key of Object.keys(kids)) {
    const k = kids[key];
    if (k.error) { rig.note(key + ': ' + k.error); continue; }
    rig.note(key + ' fps/sec: ' + k.fps.join(' '));
    for (const line of k.top) rig.note('        ' + line);
  }


  // ⚠ NOTHING IS POLLED WHILE THE TRANSITION RUNS. Five evaluate round trips per sample is work
  // of its own, and during a sag each one waits on the very thread being measured. The DM records
  // its own frame gaps and is read once, afterwards.
  const paneA = await rig.pane('A');
  const paneB = await rig.pane('B');

  // ── Where the seconds went ────────────────────────────────────────────────
  // Navigation timing is the browser's own record of loading and compiling a document. It covers
  // the window BEFORE any app function exists, which is exactly what the function profiler missed.
  const TIMING = `(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const res = performance.getEntriesByType('resource').filter(r => r.initiatorType === 'script');
    const total = res.reduce((a, r) => a + r.duration, 0);
    const top = res.slice().sort((a, b) => b.duration - a.duration).slice(0, 4)
      .map(r => r.name.split('/').pop() + '=' + Math.round(r.duration) + 'ms');
    return { origin: Math.round(performance.timeOrigin),
             interactive: Math.round(nav.domInteractive || 0),
             dcl: Math.round(nav.domContentLoadedEventEnd || 0),
             load: Math.round(nav.loadEventEnd || 0),
             scripts: res.length, scriptMs: Math.round(total), top };
  })()`;

  const readTiming = async function (label, evaluator) {
    let t = null;
    try { t = await evaluator(); } catch (e) { rig.note(label + ': unreadable'); return; }
    if (!t) { rig.note(label + ': no timing'); return; }
    const began = t.origin - pressedAt;
    rig.note(label.padEnd(8) + ' began +' + began + 'ms, interactive +' + (began + t.interactive) +
             'ms, load done +' + (began + t.load) + 'ms   (' + t.scripts + ' scripts, ' +
             t.scriptMs + 'ms in script fetch+eval)');
    rig.note('         slowest: ' + t.top.join('  '));
  };

  rig.note('');
  rig.note('=== document loading, all times relative to the Two maps press ===');
  await readTiming('colA', () => paneA.evaluate(TIMING));
  await readTiming('colB', () => paneB.evaluate(TIMING));
  await readTiming('shell', () => dm.evaluate('_stageWindow.eval(' + JSON.stringify(TIMING) + ')'));
  await readTiming('halfA', () => dm.evaluate(
    '_stageWindow.stageFrameWindow("A").eval(' + JSON.stringify(TIMING) + ')'));
  await readTiming('halfB', () => dm.evaluate(
    '_stageWindow.stageFrameWindow("B").eval(' + JSON.stringify(TIMING) + ')'));

  rig.check(await dm.evaluate('panesActive'), 'two-map mode never came up');
};
