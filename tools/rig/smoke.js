'use strict';

// The app's smoke test: loads the REAL index.html the way the app does, then asserts on the live
// page. There is no DevTools here (the menu is stripped), so this is the only way to assert on a
// running page. Two blocks:
//
//   1. The animated-map compression feature — load order, the switch's placement and persistence,
//      the one-per-run explainer, and the switch's own geometry.
//   2. The map render path across real scenes — that the DM holds NO map sprite for an animated
//      map (its map is the composited DOM <video>) and DOES hold one for a still, in both switch
//      directions. Block 2 needs saved scenes and skips itself when the library is empty.
//
//   npx electron tools/rig/smoke.js
//
// ⚠ SEED FOR BACKLOG ITEM 7, NOT ITEM 7. The real rig attaches over --remote-debugging-port with
// an isolated --user-data-dir, drives the BUILT .exe, and watches both windows. This loads the
// repo's index.html in one plain window. Grow it into that rather than writing a fifth throwaway
// — the vehicle has already been built and discarded four times.
//
// Traps this file encodes, each of which cost a round to find:
//   - backgroundThrottling MUST be false, or Chromium suspends rAF once the window is occluded
//     and the harness hangs forever with no error at all.
//   - An element inside display:none has ZERO-sized rects, so a spacing or centring assertion
//     against it passes by accident. Open the panel first, then measure.
//   - Electron's own CSP dev warning arrives as a console ERROR and is not the app's. So does any
//     IPC this harness's main does not register. Both are filtered below; do not widen that
//     filter without reading what it swallows.

const { app, BrowserWindow } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
app.commandLine.appendSwitch('disable-features', 'BackgroundVideoTrackOptimization');

// ⚠ THE HARNESS RUNS IN ITS OWN userData, NOT THE APP'S. Electron resolves the profile from the
// directory holding package.json, and this script's directory has none — so the scene library here
// starts empty and the app's real one is never written to. That isolation is deliberate: block 2
// switches scenes, and switching autosaves the outgoing one.
//
// Which is why block 2 needs a map handed to it:
//   npx electron tools/rig/smoke.js --import "C:\path\to\map.webm"
// It imports that file through the app's own createNewScene, so the run also covers the real
// import path end to end — conversion included.
const importArg = process.argv.indexOf('--import');
const IMPORT_MAP = importArg !== -1 ? process.argv[importArg + 1] : null;

const errors = [];

// ⚠ NEVER LEAVE A WINDOW OPEN. An uncaught rejection in the run below used to leave Electron alive
// with a window on screen and no output, so the only way out was closing it by hand. The watchdog
// and the try/catch around main() are both here so a failure always exits.
const HARD_TIMEOUT_MS = 300000;
const watchdog = setTimeout(() => {
  console.log('FAIL harness timed out after ' + (HARD_TIMEOUT_MS / 1000) + 's');
  app.exit(1);
}, HARD_TIMEOUT_MS);
watchdog.unref && watchdog.unref();

function die(err) {
  console.log('FAIL harness threw: ' + (err && err.stack ? err.stack : err));
  app.exit(1);
}
process.on('unhandledRejection', die);
process.on('uncaughtException', die);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    // Hidden: backgroundThrottling:false keeps rAF and decode running without a visible surface,
    // so the harness no longer throws a window in front of whatever you are doing. Use shot.js
    // when something has to be looked at.
    width: 1400, height: 900, show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      // Only for --import, and only so the page can read the map off disk to build a File. The
      // default run keeps the app's real security posture.
      webSecurity: !IMPORT_MAP,
      // ⚠ NO PRELOAD ON AN --import RUN, DELIBERATELY. This harness runs its OWN main process, so
      // none of the app's IPC handlers exist — with the preload present, window.electronAPI is
      // truthy, the import tries to save the map through `save-video-blob`, and the whole scene
      // load fails on a missing handler. Without it the app takes its no-Electron path and keeps
      // the map as an in-memory blob, which exercises the render path faithfully. Reaching the
      // disk-save path needs the REAL main process, which is backlog item 7.
      preload: IMPORT_MAP ? undefined : path.join(ROOT, 'preload.js'),
    },
  });
  win.setMenu(null);

  // Two known noises belong to the HARNESS, not the app: Electron's CSP dev warning (absent
  // once packaged) and the app-version IPC this harness's main does not register.
  const NOISE = /Electron Security Warning|electronjs\.org|unsafe-eval|unnecessary security|Content Security|once the app is packaged|This warning will not show up|app-version/;
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && !NOISE.test(message)) errors.push(message);
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    console.log('FAIL renderer gone: ' + JSON.stringify(d));
    app.exit(1);
  });

  await win.loadFile(path.join(ROOT, 'index.html'));
  // Let the init chain finish (initControlPanel is called last, from toolbar.js).
  await new Promise(r => setTimeout(r, 2500));

  const result = await win.webContents.executeJavaScript(`(async function () {
    const fails = [];

    if (typeof fitInsideBox !== 'function') fails.push('fitInsideBox missing');
    if (typeof convertVideoForImport !== 'function') fails.push('convertVideoForImport missing');
    if (typeof compressBigVideosEnabled !== 'function') fails.push('compressBigVideosEnabled missing');
    if (typeof toggleCompressBigVideos !== 'function') fails.push('toggleCompressBigVideos missing');
    if (typeof MAP_BOX_W === 'undefined' || MAP_BOX_W !== 3840) fails.push('MAP_BOX_W wrong: ' + MAP_BOX_W);
    if (typeof MAP_BOX_H === 'undefined' || MAP_BOX_H !== 2160) fails.push('MAP_BOX_H wrong: ' + MAP_BOX_H);
    if (typeof MAP_CONVERT_BITRATE === 'undefined') fails.push('MAP_CONVERT_BITRATE missing');
    if (typeof vttScaleRooms !== 'function') fails.push('vttScaleRooms missing');
    if (!MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.640033')) fails.push('no H.264 recorder in the app runtime');

    // Both earlier shapes must be gone — either one left behind is a second source of truth.
    if (typeof askShrinkAnimated !== 'undefined') fails.push('the per-import question survives');
    if (typeof shrinkAnimatedEnabled !== 'undefined') fails.push('the first build\\'s setting survives');
    if (document.getElementById('cp-shrink-anim')) fails.push('the Player-tab toggle is still in the markup');
    localStorage.removeItem('evermist.shrinkAnimatedMaps');   // residue from an earlier harness run

    // The already-fits path, exercised against the real constants.
    const same = fitInsideBox(1920, 1080, MAP_BOX_W, MAP_BOX_H);
    if (same.changed) fails.push('a 1920x1080 map claimed it needed shrinking');
    const shrink = fitInsideBox(6150, 2850, MAP_BOX_W, MAP_BOX_H);
    if (!shrink.changed || shrink.w !== 3840) fails.push('6150x2850 did not fit to 3840: ' + JSON.stringify(shrink));

    // ─── Where the switch lives ────────────────────────────────────────────
    const sw = document.getElementById('sm-compress');
    if (!sw) fails.push('#sm-compress missing from the scene dropdown');
    if (sw && !sw.closest('#scene-dd')) fails.push('the switch is not in the scene dropdown');
    if (sw && sw.closest('#sm-list')) fails.push('the switch is inside the scrolling scene list');
    if (sw && !sw.closest('#scene-dd-foot')) fails.push('the switch is not in the dropdown footer');
    const label = sw ? sw.querySelector('.sm-switch-lbl').textContent.trim() : null;
    const tip = sw ? (sw.getAttribute('title') || '') : '';
    if (tip.indexOf('3840') === -1) fails.push('the tooltip does not say what size it fits');

    // ─── Default OFF ───────────────────────────────────────────────────────
    localStorage.removeItem('evermist.compressBigVideos');
    if (compressBigVideosEnabled()) fails.push('the setting defaults to on');

    // ─── First switch-on explains itself, once per run ──────────────────────
    const anchor = () => document.getElementById('cd-anchor');
    const shownNow = () => { const a = anchor(); return !!a && a.style.display === 'flex'; };

    sw.click();
    await new Promise(r => setTimeout(r, 120));
    const onAfterFirst = compressBigVideosEnabled();
    const classOn = sw.classList.contains('on');
    const explained = shownNow();
    const dlg = {
      title: (document.getElementById('cd-title') || {}).textContent,
      msg: (document.getElementById('cd-msg') || {}).textContent || '',
      button: (document.getElementById('cd-ok') || {}).textContent,
      // A statement, so the cancel button is hidden by .cd-solo — there is nothing to decline.
      solo: !!anchor() && anchor().classList.contains('cd-solo'),
    };
    if (!onAfterFirst) fails.push('the switch did not turn on');
    if (!classOn) fails.push('the switch did not paint itself on');
    if (localStorage.getItem('evermist.compressBigVideos') !== '1') fails.push('the setting is not persisted');
    if (!explained) fails.push('turning it on for the first time explained nothing');
    if (!dlg.solo) fails.push('the explainer is a question, not a statement');
    if (dlg.msg.indexOf('3840×2160') === -1) fails.push('the explainer omits the box size');
    if (dlg.msg.indexOf('low-end') === -1) fails.push('the explainer omits who it is for');
    if (dlg.msg.length > 250) fails.push('the explainer is too long: ' + dlg.msg.length + ' chars');

    // The knob has to be centred in its track under the dropdown's zoom, which is what a
    // border-width-derived offset got wrong. Measured, not eyeballed.
    // ⚠ The menu is display:none until opened, so the footer has NO layout and every rect reads
    // zero — which passes a centring check by accident. Open it first.
    openDropdown();
    await new Promise(r => setTimeout(r, 250));
    const tr = sw.querySelector('.sm-switch-track').getBoundingClientRect();
    const kn = sw.querySelector('.sm-switch-knob').getBoundingClientRect();
    const above = kn.y - tr.y, below = (tr.y + tr.height) - (kn.y + kn.height);
    const right = (tr.x + tr.width) - (kn.x + kn.width);   // measured with the switch ON
    if (Math.abs(above - below) > 0.4) fails.push('knob off centre: ' + above.toFixed(2) + ' above, ' + below.toFixed(2) + ' below');
    if (right < 0.5) fails.push('the on-state knob overshoots its track: ' + right.toFixed(2) + 'px clearance');

    // And the ring of space around the switch has to be even on all three outer sides.
    const ft = document.getElementById('scene-dd-foot').getBoundingClientRect();
    const gaps = {
      top: tr.y - ft.y,
      bottom: (ft.y + ft.height) - (tr.y + tr.height),
      right: (ft.x + ft.width) - (tr.x + tr.width),
    };
    const spread = Math.max(gaps.top, gaps.bottom, gaps.right) - Math.min(gaps.top, gaps.bottom, gaps.right);
    if (spread > 0.6) fails.push('uneven padding around the switch: top ' + gaps.top.toFixed(2) +
      ', bottom ' + gaps.bottom.toFixed(2) + ', right ' + gaps.right.toFixed(2));

    document.getElementById('cd-ok').click();
    await new Promise(r => setTimeout(r, 60));

    // Off, then on again in the SAME run — the second arming must not re-explain.
    sw.click();
    await new Promise(r => setTimeout(r, 80));
    const offAgain = !compressBigVideosEnabled();
    const explainedOnOff = shownNow();
    sw.click();
    await new Promise(r => setTimeout(r, 120));
    const onAgain = compressBigVideosEnabled();
    const explainedTwice = shownNow();
    if (!offAgain) fails.push('the switch would not turn off');
    if (explainedOnOff) fails.push('turning it OFF showed the explainer');
    if (!onAgain) fails.push('the switch would not turn back on');
    if (explainedTwice) fails.push('it explained itself a second time in one run');

    return { fails, shrink, label, tip, dlg, onAfterFirst, offAgain, onAgain, explainedTwice,
             knob: { above: +above.toFixed(2), below: +below.toFixed(2), right: +right.toFixed(2) },
             gaps: { top: +gaps.top.toFixed(2), bottom: +gaps.bottom.toFixed(2), right: +gaps.right.toFixed(2) } };
  })()`);

  console.log('knob inside its track — above ' + result.knob.above + ', below ' + result.knob.below +
              ', right clearance ' + result.knob.right);
  console.log('switch to footer edges — top ' + result.gaps.top + ', bottom ' + result.gaps.bottom +
              ', right ' + result.gaps.right);
  console.log('switch label: ' + JSON.stringify(result.label));
  console.log('tooltip: ' + JSON.stringify(result.tip));
  console.log('explainer: ' + JSON.stringify(result.dlg.title) + '  button=' + JSON.stringify(result.dlg.button) +
              '  ' + result.dlg.msg.length + ' chars, statement=' + result.dlg.solo);
  console.log('off by default, then on/off/on: ' + result.onAfterFirst + '/' + result.offAgain + '/' + result.onAgain +
              '   re-explained: ' + result.explainedTwice);
  console.log('6150x2850 -> ' + result.shrink.w + 'x' + result.shrink.h);

  // ─── Optional: import a real map first, through the app's own path ───────────
  if (IMPORT_MAP) {
    const url = 'file:///' + IMPORT_MAP.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^C%3A/i, 'C:');
    const name = path.basename(IMPORT_MAP);
    console.log('importing ' + name + ' with compression ON…');
    const imported = await win.webContents.executeJavaScript(`(async function () {
      const t0 = performance.now();
      // The setting's own storage, not the switch: block 1 left it in whatever state its last
      // click produced, and localStorage is what compressBigVideosEnabled actually reads.
      localStorage.setItem('evermist.compressBigVideos', '1');
      const res = await fetch(${JSON.stringify(url)});
      if (!res.ok) return { err: 'could not read the map: ' + res.status };
      const blob = await res.blob();
      const file = new File([blob], ${JSON.stringify(name)}, { type: 'video/webm' });
      await createNewScene(file);
      // createNewScene resolves once its onLoaded has run; give the switch it kicks off time to land.
      await new Promise(r => setTimeout(r, 4000));
      return {
        seconds: +((performance.now() - t0) / 1000).toFixed(1),
        srcMB: +(blob.size / 1048576).toFixed(1),
        scene: currentScene ? {
          name: currentScene.name, w: currentScene.mapWidth, h: currentScene.mapHeight,
          mapPath: currentScene.mapPath || null, type: currentScene.mapType,
        } : null,
      };
    })()`, true);
    if (imported.err) { console.log('FAIL ' + imported.err); app.exit(1); return; }
    console.log('  imported in ' + imported.seconds + 's from a ' + imported.srcMB + ' MB source');
    console.log('  stored as ' + JSON.stringify(imported.scene));
  }

  // ─── Block 2: the map render path over real scenes ───────────────────────────
  //
  // The DM's animated map is the composited DOM <video>, so this view holds no map sprite at all
  // (video.js bindVideoFrameTexture). A still map DOES need one. BOTH DIRECTIONS MATTER: going
  // still → animated has to destroy the outgoing sprite or the previous map stays on the layer
  // under the video, and animated → still has to build one or the map never appears.
  const render = await win.webContents.executeJavaScript(`(async function () {
    const fails = [];
    const notes = [];
    const scenes = await sceneStore.listScenes();
    const full = [];
    for (const s of scenes) { const sc = await sceneStore.loadScene(s.id); if (sc) full.push(sc); }
    const vid = full.find(s => s.mapType === 'video');
    const img = full.find(s => s.mapType === 'image');
    if (!vid) return { skipped: 'no animated scene saved — block 2 did not run', fails, notes };

    const settle = ms => new Promise(r => setTimeout(r, ms));
    const state = () => ({
      sprite: !!pixiMapSprite, texture: !!pixiMapTexture,
      domVideo: videoDOMActive, offscreen: !!mapOffscreen,
      loopAlive: videoRVFCId != null,
      playing: !!mapVideo && !mapVideo.paused && mapVideo.readyState >= 3,
      w: mapWidth, h: mapHeight,
    });

    await switchScene(vid.id);
    await settle(3000);
    const v1 = state();
    notes.push('animated "' + vid.name + '" ' + v1.w + 'x' + v1.h + ': sprite=' + v1.sprite +
               ' domVideo=' + v1.domVideo + ' playing=' + v1.playing + ' loop=' + v1.loopAlive);
    if (v1.sprite || v1.texture) fails.push('DM still holds a map sprite for an animated map');
    if (!v1.domVideo) fails.push('the DOM video did not activate — the DM would show nothing');
    if (!v1.playing) fails.push('the animated map is not playing');
    if (!v1.offscreen) fails.push('mapOffscreen was dropped — the minimap and Player delivery read it');
    if (!v1.loopAlive) fails.push('the frame loop is dead, so the stall watchdog has no signal');

    if (img) {
      await switchScene(img.id);
      await settle(2500);
      const i1 = state();
      notes.push('still "' + img.name + '": sprite=' + i1.sprite + ' domVideo=' + i1.domVideo);
      if (!i1.sprite) fails.push('a still map has no sprite — it would not render at all');
      if (i1.domVideo) fails.push('the DOM video stayed active on a still map');

      // Back to animated: the outgoing still's sprite MUST be gone.
      await switchScene(vid.id);
      await settle(3000);
      const v2 = state();
      notes.push('still -> animated: sprite=' + v2.sprite + ' playing=' + v2.playing);
      if (v2.sprite) fails.push('the outgoing still map\\'s sprite survived under the video');
      if (!v2.playing) fails.push('the animated map did not resume on the second switch');
    } else {
      notes.push('no still scene saved — the two-direction check did not run');
    }
    return { fails, notes };
  })()`);

  if (render.skipped) console.log('SKIPPED ' + render.skipped);
  for (const n of render.notes || []) console.log('  ' + n);

  // Proof the DM still SHOWS the animated map. The assertions above say the sprite is gone and the
  // DOM video is active; only a capture says the result is not a black rectangle.
  const shotArg = process.argv.indexOf('--shot');
  if (shotArg !== -1 && process.argv[shotArg + 1] && !render.skipped) {
    await win.webContents.executeJavaScript(`(async function () {
      const vid = (await sceneStore.listScenes()).map(s => s.id);
      // Land on the animated scene, whichever order block 2 left things in.
      for (const id of vid) { const s = await sceneStore.loadScene(id);
        if (s && s.mapType === 'video' && (!currentScene || currentScene.id !== id)) { await switchScene(id); break; } }
    })()`);
    await new Promise(r => setTimeout(r, 3500));
    const img = await win.webContents.capturePage();
    require('fs').writeFileSync(process.argv[shotArg + 1], img.toPNG());
    console.log('  wrote ' + process.argv[shotArg + 1]);
  }

  if (errors.length) console.log('CONSOLE ERRORS:\n  ' + errors.join('\n  '));

  const bad = result.fails
    .concat(render.fails || [])
    .concat(errors.length ? ['console errors during the run'] : []);
  console.log(bad.length ? 'FAIL ' + bad.join('; ') : 'PASS');
  clearTimeout(watchdog);
  app.exit(bad.length ? 1 : 0);
}).catch(die);
