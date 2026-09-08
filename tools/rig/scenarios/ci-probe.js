'use strict';

// ci-probe.js — THROWAWAY, and it answers one question: can the rig run on a GitHub Actions
// runner at all? Item 72 wants the regression set gating a release from CI, and every estimate of
// that work is a guess until this comes back. Delete this file once it has an answer.
//
// It lives in scenarios/ and not scenarios/acceptance/, so it never joins the regression set.
//
// Three unknowns, ordered by which kills a run earliest:
//   1. A runner has no GPU. PixiJS is the only map render path there is, so no WebGL means no
//      app — and it fails at DM_READY with nothing saying why.
//   2. The runner's virtual display is smaller than the DM window, and sizePlayerToScreen sizes
//      the Player renderer off `screen`. Every Player measurement would read a size the table
//      never sees.
//   3. One run has a 15-minute cap. Software rendering plus realtime MediaRecorder fixtures
//      could blow it, so every phase below is timed and printed.

module.exports = async function ciProbe(rig) {
  const dm = rig.dm;
  const t0 = Date.now();
  const since = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';

  rig.note('boot to first evaluate: ' + since());

  // ── 1. WebGL, asked of a bare canvas ──────────────────────────────────────
  // Deliberately NOT the app's own context. If PixiJS is down, this separates "the runner has no
  // WebGL" from "PixiJS refused a context it could have had", and those are different fixes.
  const gl = await dm.evaluate(`(() => {
    const c = document.createElement('canvas');
    const ctx = c.getContext('webgl2') || c.getContext('webgl');
    if (!ctx) return { ok: false };
    const dbg = ctx.getExtension('WEBGL_debug_renderer_info');
    return {
      ok: true,
      version: ctx.getParameter(ctx.VERSION),
      vendor: dbg ? ctx.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : '(masked)',
      renderer: dbg ? ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '(masked)',
      maxTexture: ctx.getParameter(ctx.MAX_TEXTURE_SIZE),
    };
  })()`);

  rig.note(gl && gl.ok
    ? 'WebGL: ' + gl.version + ' | ' + gl.vendor + ' / ' + gl.renderer +
      ' | MAX_TEXTURE_SIZE ' + gl.maxTexture
    : 'WebGL: NOT AVAILABLE');
  rig.check(gl && gl.ok,
    'the runner gives no WebGL context, so PixiJS cannot render and no scenario can run there');

  // A software rasteriser can cap textures below what a real map needs. The app accepts maps up
  // to 10000x6000, so a 4096 cap would fail scenarios for a reason that is not a bug.
  if (gl && gl.ok) {
    rig.check(gl.maxTexture >= 8192,
      'MAX_TEXTURE_SIZE is ' + gl.maxTexture + ', below the map sizes the app accepts');
  }

  // ── 2. The app's own renderer ─────────────────────────────────────────────
  // Bare identifier: the app's scripts use top-level const, which is not a property of window.
  const pixi = await dm.evaluate(`(() => {
    if (typeof pixiApp === 'undefined' || !pixiApp || !pixiApp.renderer) return { up: false };
    const r = pixiApp.renderer;
    return { up: true, type: r.type, w: r.width, h: r.height, maxFPS: pixiApp.ticker.maxFPS };
  })()`);

  rig.note(pixi.up
    ? 'pixiApp: up, renderer type ' + pixi.type + ' at ' + pixi.w + 'x' + pixi.h +
      ', ticker cap ' + pixi.maxFPS
    : 'pixiApp: MISSING');
  rig.check(pixi.up, 'pixiApp never came up, so every map and fog measurement reads nothing');

  // ── 3. Geometry, which decides whether Player checks mean anything ────────
  const geom = await dm.evaluate(`({
    screenW: screen.width, screenH: screen.height,
    innerW: innerWidth, innerH: innerHeight, dpr: devicePixelRatio,
  })`);
  rig.note('DM window ' + geom.innerW + 'x' + geom.innerH + ' on a ' +
           geom.screenW + 'x' + geom.screenH + ' screen, dpr ' + geom.dpr);

  const tPlayer = Date.now();
  const player = await rig.player();
  const pg = await player.evaluate('({ w: innerWidth, h: innerHeight, hidden: document.hidden })');
  rig.note('Player window ' + pg.w + 'x' + pg.h + ', document.hidden ' + pg.hidden +
           ', opened in ' + ((Date.now() - tPlayer) / 1000).toFixed(1) + 's');
  rig.check(!pg.hidden,
    'the Player window reports itself hidden on the runner, so it paints nothing and every ' +
    'Player-side check reads zero');

  // ── 4. The slowest thing any scenario does ────────────────────────────────
  // Every acceptance scenario imports an animated map, and the fixture is RECORDED at realtime
  // by MediaRecorder inside the app. That is the one phase software rendering could stretch past
  // the run's own cap, so it is measured rather than assumed.
  const tRec = Date.now();
  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: 1600, h: 1000 });
  rig.note('recorded a 1600x1000 animated fixture in ' +
           ((Date.now() - tRec) / 1000).toFixed(1) + 's (' + map.bytes + ' bytes)');

  const tLoad = Date.now();
  const fileExpr = await rig.fixtures.asFileExpr(dm, map);
  await dm.evaluate('createNewScene(' + fileExpr + ')', 120000);
  await dm.waitFor('currentScene && currentScene.mapType === "video" && mapWidth === 1600',
                   120000, 'the map to load on the DM');
  rig.note('imported and loaded it in ' + ((Date.now() - tLoad) / 1000).toFixed(1) + 's');

  rig.check(await dm.evaluate('mapWidth === 1600 && mapHeight === 1000'),
    'the animated map did not load on the runner, so no acceptance scenario can start there');

  // The whole run is capped at 900s and regression is 19 scenarios, each booting its own app.
  // This one does what the heaviest of them does before its first assertion.
  rig.note('TOTAL for one scenario: ' + since() + ' against a 900s cap on the whole run.');
};
