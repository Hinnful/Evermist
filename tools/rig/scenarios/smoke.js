'use strict';

// smoke.js — the fast always-run set. Four blocks:
//
//   1. The animated-map compression feature: load order, the size control's placement and
//      persistence, the one-per-run explainer, and the control's own geometry.
//   2. The map render path across real scenes — that the DM holds NO map sprite for an animated
//      map (its map is the composited DOM <video>) and DOES hold one for a still, in both switch
//      directions. Both scenes are generated at runtime, so this no longer skips itself.
//   3. An imported map reaches disk through the app's real save-video-blob IPC, inside the rig's
//      own profile and not the DM's real library.
//   4. A zip export and restore survives a round trip through the real archiver/yauzl IPC.
//
// ⚠ THE EXPORT'S SAVE DIALOG IS THE ONE SEAM THE RIG CANNOT CROSS. doExport opens a native
// showSaveDialog, and `window.electronAPI` cannot be stubbed. Block 4 therefore builds the same
// payload doExport builds and hands it to the real createBackupZip; the RESTORE side runs the
// app's own restoreFromZipPath untouched. Export changes still need the DM's own hand test.

const lib = require('../lib');
const fs = require('fs');
const path = require('path');

// Bounded wait that never fails on its own: it turns "the sleep was too short" into a real
// measurement rather than a false failure. The assertion that follows is still the one that
// decides.
async function settle(session, expr, ms) {
  try { await session.waitFor(expr, ms, expr); } catch (_) {}
}

module.exports = async function smoke(rig) {
  const dm = rig.dm;

  // ── Block 1: the compression feature ───────────────────────────────────────
  const result = await dm.evaluate(`(async function () {
    const fails = [];

    if (typeof fitInsideBox !== 'function') fails.push('fitInsideBox missing');
    if (typeof convertVideoForImport !== 'function') fails.push('convertVideoForImport missing');
    if (typeof compressSize !== 'function') fails.push('compressSize missing');
    if (typeof compressBox !== 'function') fails.push('compressBox missing');
    if (typeof setCompressSize !== 'function') fails.push('setCompressSize missing');
    if (typeof MAP_CONVERT_BITRATE === 'undefined') fails.push('MAP_CONVERT_BITRATE missing');
    if (typeof vttScaleRooms !== 'function') fails.push('vttScaleRooms missing');
    if (!MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.640033')) fails.push('no H.264 recorder in the app runtime');

    // Every earlier shape must be gone — any one left behind is a second source of truth.
    if (typeof askShrinkAnimated !== 'undefined') fails.push('the per-import question survives');
    if (typeof shrinkAnimatedEnabled !== 'undefined') fails.push('the first build\\'s setting survives');
    if (typeof toggleCompressBigVideos !== 'undefined') fails.push('the on/off switch survives');
    if (document.getElementById('cp-shrink-anim')) fails.push('the Player-tab toggle is still in the markup');

    // ─── Where the control lives ───────────────────────────────────────────
    const sw = document.getElementById('sm-compress');
    if (!sw) fails.push('#sm-compress missing from the scene library');
    if (sw && !sw.closest('#sm-panel')) fails.push('the control is not in the scene library popup');
    if (sw && sw.closest('#sm-list')) fails.push('the control is inside the scrolling scene list');
    if (sw && !sw.closest('#sm-head')) fails.push('the control is not in the library header');
    const tab = size => sw.querySelector('.cp-segtab[data-size="' + size + '"]');
    const labels = sw ? [...sw.querySelectorAll('.cp-segtab')].map(b => b.textContent.trim()) : [];
    // RED ON: the 2K choice relabelled 1440p (index.html #sm-compress) — 2026-09-27
    if (labels.join('|') !== 'Off|1080p|2K|4K') fails.push('the choices read ' + labels.join(' · '));
    const label = (document.querySelector('.sm-compress-lbl') || {}).textContent.trim();
    const tip = sw ? (sw.getAttribute('title') || '') : '';

    // ─── Default OFF ───────────────────────────────────────────────────────
    localStorage.removeItem('evermist.compressBigVideos');
    if (compressBox()) fails.push('the setting defaults to on');

    // ─── First size explains itself, once per run ───────────────────────────
    const anchor = () => document.getElementById('cd-anchor');
    const shownNow = () => { const a = anchor(); return !!a && a.style.display === 'flex'; };
    const lit = () => [...sw.querySelectorAll('.cp-segtab.active')].map(b => b.dataset.size).join(',');

    tab('1').click();
    await new Promise(r => setTimeout(r, 120));
    const box4k = compressBox();
    const explained = shownNow();
    const dlg = {
      title: (document.getElementById('cd-title') || {}).textContent,
      msg: (document.getElementById('cd-msg') || {}).textContent || '',
      button: (document.getElementById('cd-ok') || {}).textContent,
      // A statement, so the cancel button is hidden by .cd-solo — there is nothing to decline.
      solo: !!anchor() && anchor().classList.contains('cd-solo'),
    };
    if (!box4k || box4k.w !== 3840 || box4k.h !== 2160) fails.push('4K did not set a 3840x2160 box: ' + JSON.stringify(box4k));
    if (lit() !== '1') fails.push('4K did not paint itself as the one lit choice: ' + lit());
    // An older build reads '1' as on, so a rollback keeps 4K.
    if (localStorage.getItem('evermist.compressBigVideos') !== '1') fails.push('4K is not stored as the switch\\'s old on value');
    if (!explained) fails.push('turning it on for the first time explained nothing');
    if (!dlg.solo) fails.push('the explainer is a question, not a statement');
    if (dlg.msg.indexOf('3840×2160') === -1) fails.push('the explainer omits the box size');
    if (dlg.msg.indexOf('low-end') === -1) fails.push('the explainer omits who it is for');
    if (dlg.msg.length > 250) fails.push('the explainer is too long: ' + dlg.msg.length + ' chars');

    // The imports shrink against the box the DM picked, exercised against the real sizes.
    const same = fitInsideBox(1920, 1080, box4k.w, box4k.h);
    if (same.changed) fails.push('a 1920x1080 map claimed it needed shrinking');
    const shrink = fitInsideBox(6150, 2850, box4k.w, box4k.h);
    if (!shrink.changed || shrink.w !== 3840) fails.push('6150x2850 did not fit to 3840: ' + JSON.stringify(shrink));

    // The pill shares the header row with the buttons, so it sits on their centre line and at
    // their height. It is a standing SETTING, not an action, so it leads the row: the run of
    // controls after it has to read find → new group → add maps, in that order.
    // ⚠ The menu is display:none until opened, so the header has NO layout and every rect reads
    // zero — which passes a centring check by accident. Open it first.
    openDropdown();
    await new Promise(r => setTimeout(r, 250));
    const addBtn = document.getElementById('sm-add').getBoundingClientRect();
    const swBox = sw.getBoundingClientRect();
    const head = document.getElementById('sm-head');
    const order = [
      ['compression', document.querySelector('.sm-compress-lbl').getBoundingClientRect().x],
      ['sizes', swBox.x],
      ['find', document.getElementById('sm-search').getBoundingClientRect().x],
      ['new group', document.getElementById('sm-new-group').getBoundingClientRect().x],
      ['add maps', addBtn.x],
    ];
    const gaps = {
      drift: (swBox.y + swBox.height / 2) - (addBtn.y + addBtn.height / 2),
      tall: swBox.height - addBtn.height,
      overflow: head.scrollWidth - head.clientWidth,
      reads: order.map(o => o[0]).join(' → '),
    };
    if (Math.abs(gaps.drift) > 0.6) fails.push('the sizes are off the header centre line by ' + gaps.drift.toFixed(2) + 'px');
    if (Math.abs(gaps.tall) > 0.6) fails.push('the sizes pill and Add maps differ in height by ' + gaps.tall.toFixed(2) + 'px');
    if (gaps.overflow > 0) fails.push('the header overflows its row by ' + gaps.overflow + 'px');
    for (let i = 1; i < order.length; i++) {
      if (order[i][1] <= order[i - 1][1]) {
        fails.push('the header reads out of order: ' + order[i][0] + ' is not to the right of ' + order[i - 1][0]);
      }
    }
    // Labels or glyphs, never one of each on two buttons doing the same kind of thing.
    if (document.querySelectorAll('#sm-add svg, #sm-new-group svg').length)
      fails.push('New group and Add maps carry both an icon and a label');

    document.getElementById('cd-ok').click();
    await new Promise(r => setTimeout(r, 60));

    // Another size, then off, then on again in the SAME run — none of it re-explains.
    tab('1440').click();
    await new Promise(r => setTimeout(r, 80));
    const box2k = compressBox();
    const explainedOnSwap = shownNow();
    tab('0').click();
    await new Promise(r => setTimeout(r, 80));
    const offAgain = !compressBox() && lit() === '0';
    const explainedOnOff = shownNow();
    tab('1080').click();
    await new Promise(r => setTimeout(r, 120));
    const box1080 = compressBox();
    const explainedTwice = shownNow();
    if (!box2k || box2k.w !== 2560 || box2k.h !== 1440) fails.push('2K did not set a 2560x1440 box: ' + JSON.stringify(box2k));
    if (explainedOnSwap) fails.push('changing size while on showed the explainer');
    if (!offAgain) fails.push('Off would not turn it off');
    if (explainedOnOff) fails.push('turning it OFF showed the explainer');
    if (!box1080 || box1080.w !== 1920 || box1080.h !== 1080) fails.push('1080p did not set a 1920x1080 box: ' + JSON.stringify(box1080));
    if (explainedTwice) fails.push('it explained itself a second time in one run');

    closeDropdown();
    return { fails, shrink, label, tip, labels, dlg, offAgain, explainedTwice,
             gaps: { drift: +gaps.drift.toFixed(2), overflow: gaps.overflow, reads: gaps.reads } };
  })()`);

  for (const f of result.fails) rig.check(false, f);
  rig.check(result.fails.length === 0, 'the compression block reported ' + result.fails.length + ' failures');
  rig.note('header reads ' + result.gaps.reads + ' — sizes centre-line drift ' + result.gaps.drift +
           ', overflow ' + result.gaps.overflow);
  rig.note('label: ' + JSON.stringify(result.label) + '   choices: ' + result.labels.join(' · ') +
           '   tooltip: ' + JSON.stringify(result.tip));
  rig.note('explainer: ' + JSON.stringify(result.dlg.title) + '  button=' + JSON.stringify(result.dlg.button) +
           '  ' + result.dlg.msg.length + ' chars, statement=' + result.dlg.solo);
  rig.note('off by default, then 4K/2K/off/1080p: off again=' + result.offAgain + '   re-explained: ' + result.explainedTwice);
  rig.note('6150x2850 -> ' + result.shrink.w + 'x' + result.shrink.h);

  // ── The two maps every later block needs ───────────────────────────────────
  // Generated in-page and cached on disk, so nothing binary lives in the repo and no real map
  // has to be pointed at. The animated one is deliberately WIDER than the 4K box, so the import
  // exercises the shrink for real rather than only its arithmetic.
  const still = await rig.fixtures.stillMap(dm, rig.fixtureDir, { w: 2000, h: 1200, name: 'rig-still.png' });
  const anim = await rig.fixtures.animatedMap(dm, rig.fixtureDir,
    { w: 4096, h: 2160, seconds: 5, name: 'rig-anim-big.mp4' });
  rig.note('fixtures: ' + still.name + ' ' + still.w + 'x' + still.h + ' ' + Math.round(still.bytes / 1024) + ' KB, ' +
           anim.name + ' ' + anim.w + 'x' + anim.h + ' ' + Math.round(anim.bytes / 1024) + ' KB');

  const importFixture = async (fixture, readyExpr, timeoutMs) => {
    const expr = await rig.fixtures.asFileExpr(dm, fixture);
    // createNewScene now settles only once the map is on screen or refused, so a batch can run
    // one map at a time — but the poll stays: it names the state this block needs, and it is
    // what turns a refused import into a timeout that says which fixture.
    await dm.evaluate('createNewScene(' + expr + ')', timeoutMs);
    await dm.waitFor(readyExpr, timeoutMs, 'the import of ' + fixture.name);
  };

  await importFixture(still, 'currentScene && currentScene.mapType === "image"', 120000);
  await dm.evaluate('localStorage.setItem("evermist.compressBigVideos", "1"); 0');
  await importFixture(anim, 'currentScene && currentScene.mapType === "video" && !!currentScene.mapPath', 300000);

  // ── Block 3: the import actually reached disk, through the real IPC ────────
  const saved = await dm.evaluate(`(async () => ({
    id: currentScene.id, name: currentScene.name, mapPath: currentScene.mapPath,
    w: currentScene.mapWidth, h: currentScene.mapHeight,
    abs: await window.electronAPI.getVideoFilePath(currentScene.id),
  }))()`);
  rig.note('imported animated map: ' + saved.w + 'x' + saved.h + ' at ' + saved.mapPath);
  rig.check(!!saved.mapPath, 'the imported animated map has no mapPath — it stayed an in-memory blob');
  rig.check(!!saved.abs && fs.existsSync(saved.abs) && fs.statSync(saved.abs).size > 0,
            'the animated map was never written to disk by save-video-blob');
  // The whole point of the isolated --user-data-dir: a rig run must never touch the real library.
  // ⚠ REAL PATHS: a Mac's temp dir is /var, a symlink the app resolves to /private/var.
  const real = p => fs.realpathSync(p).toLowerCase();
  rig.check(!!saved.abs && real(saved.abs).startsWith(real(rig.profileDir)),
            'the map was saved outside the rig profile, at ' + saved.abs);
  // Compression was on and the source is wider than the box, so the stored map must be 3840 wide.
  rig.check(saved.w === 3840, 'the oversized import was not shrunk to 3840 wide: ' + saved.w + 'x' + saved.h);

  // ── Block 2: the map render path over real scenes ──────────────────────────
  //
  // The DM's animated map is the composited DOM <video>, so this view holds no map sprite at all
  // (video.js bindVideoFrameTexture). A still map DOES need one. BOTH DIRECTIONS MATTER: going
  // still → animated has to destroy the outgoing sprite or the previous map stays on the layer
  // under the video, and animated → still has to build one or the map never appears.
  const ids = await dm.evaluate(`(async () => {
    const out = [];
    for (const s of await sceneStore.listScenes()) {
      const sc = await sceneStore.loadScene(s.id);
      if (sc) out.push({ id: sc.id, name: sc.name, mapType: sc.mapType });
    }
    return out;
  })()`);
  const vid = ids.find(s => s.mapType === 'video');
  const img = ids.find(s => s.mapType === 'image');
  rig.check(!!vid && !!img, 'the two generated scenes are not both in the library: ' + JSON.stringify(ids));

  const STATE = `({
    sprite: !!pixiMapSprite, texture: !!pixiMapTexture,
    domVideo: videoDOMActive, offscreen: !!mapOffscreen,
    loopAlive: videoRVFCId != null,
    playing: !!mapVideo && !mapVideo.paused && mapVideo.readyState >= 3,
    w: mapWidth, h: mapHeight,
  })`;

  await dm.evaluate('switchScene(' + JSON.stringify(vid.id) + ')', 120000);
  // ⚠ READ THE STATE IN THE POLL. A machine that decodes 4K in software stalls and resumes twice a
  // second, so a read taken after a settle can land on a stall the app is already recovering from.
  const v1 = (await lib.poll(async () => {
    const s = await dm.evaluate(STATE);
    return s.domVideo && s.playing ? s : null;
  }, 30000)) || await dm.evaluate(STATE);
  rig.note('animated "' + vid.name + '" ' + v1.w + 'x' + v1.h + ': sprite=' + v1.sprite +
           ' domVideo=' + v1.domVideo + ' playing=' + v1.playing + ' loop=' + v1.loopAlive);
  rig.check(!v1.sprite && !v1.texture, 'DM still holds a map sprite for an animated map');
  rig.check(v1.domVideo, 'the DOM video did not activate — the DM would show nothing');
  rig.check(v1.playing, 'the animated map is not playing');
  rig.check(v1.offscreen, 'mapOffscreen was dropped — the minimap and Player delivery read it');
  rig.check(v1.loopAlive, 'the frame loop is dead, so the stall watchdog has no signal');

  await dm.evaluate('switchScene(' + JSON.stringify(img.id) + ')', 120000);
  await settle(dm, '!!pixiMapSprite && !videoDOMActive', 30000);
  const i1 = await dm.evaluate(STATE);
  rig.note('still "' + img.name + '": sprite=' + i1.sprite + ' domVideo=' + i1.domVideo);
  rig.check(i1.sprite, 'a still map has no sprite — it would not render at all');
  rig.check(!i1.domVideo, 'the DOM video stayed active on a still map');

  // Back to animated: the outgoing still's sprite MUST be gone.
  await dm.evaluate('switchScene(' + JSON.stringify(vid.id) + ')', 120000);
  await settle(dm, 'videoDOMActive && !!mapVideo && !mapVideo.paused && mapVideo.readyState >= 3', 30000);
  const v2 = await dm.evaluate(STATE);
  rig.note('still -> animated: sprite=' + v2.sprite + ' playing=' + v2.playing);
  rig.check(!v2.sprite, "the outgoing still map's sprite survived under the video");
  rig.check(v2.playing, 'the animated map did not resume on the second switch');

  // ── The animated map PLAYS ON THE TV, not just on the DM ──────────────────
  //
  // The DM hands the video to the browser's compositor; the PLAYER cannot. It redraws its map
  // picture from the video into a canvas every frame and re-uploads it to the GPU
  // (pixiUpdateMapTexture). Break that pump and the TV shows one frozen frame of a map that is
  // playing perfectly on the DM's own screen, which is invisible to every check above.
  //
  // ⚠ THE FOG IS NOT IN THE PixiJS STAGE ON THE PLAYER. It is a Canvas-2D layer on top, so
  // extracting the stage gives the map picture alone and a fully shrouded map still reads.
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen && !!pixiApp', 60000, 'the Player to receive the map');
  const stageSum = () => player.evaluate(`(() => {
    const w = pixiApp.renderer.width, h = pixiApp.renderer.height;
    const rt = PIXI.RenderTexture.create({ width: w, height: h });
    pixiApp.renderer.render(pixiApp.stage, { renderTexture: rt, clear: true });
    const px = pixiApp.renderer.extract.pixels(rt);
    rt.destroy(true);
    // Sparse sum: enough of the picture to move when the picture moves, cheap enough to take
    // twice inside one second.
    let sum = 0;
    for (let i = 0; i < px.length; i += 4 * 89) sum += px[i] + px[i + 1] + px[i + 2];
    return sum;
  })()`);
  // ⚠ POLLED TO A DEADLINE, NEVER TWO SAMPLES. Two readings a fixed gap apart can land on the
  // same frame for reasons that are not a bug — a `stalled` event, a decoder hiccup, the OS
  // throttling an off-screen window for one moment. This gate runs on every commit, so a flake
  // here stops work on a working app. A picture that changes ONCE inside the window is proof; only
  // one that never changes is a failure.
  // ⚠ THE FIRST SAMPLE RACES THE FIRST RENDER TOO: `pixiApp` existing does not mean a frame has
  // been drawn to it yet, so a sample taken the instant it appears can legitimately read zero.
  // Poll for the first nonzero paint the same way the "did it move" check polls for a change.
  let samples = 0;
  const firstPaint = await lib.poll(async () => {
    samples++;
    const v = await stageSum();
    return v > 0 ? { v } : null;
  }, 6000, 250);
  rig.check(firstPaint !== null,
            'the Player painted nothing at all in six seconds, so the check below means nothing');
  const first = firstPaint ? firstPaint.v : 0;
  const changed = await lib.poll(async () => {
    samples++;
    const now = await stageSum();
    return now !== first ? { now } : null;
  }, 6000, 250);
  const moved = changed ? changed.now : null;
  rig.note('the Player map picture: ' + first + ' then ' + (moved == null ? 'unchanged' : moved) +
           ' over ' + samples + ' samples');
  rig.check(moved !== null,
            'the animated map is frozen on the TV: the map picture never changed over ' + samples +
            ' samples in six seconds (' + first + '), while the DM plays it normally');

  // ── Block 4: a backup zip round trip, through the real archiver and yauzl ──
  const zipPath = path.join(rig.outDir, 'roundtrip.zip');
  const exported = await dm.evaluate(`(async () => {
    // The same payload doExport builds, using the app's own helpers. The metadata list mirrors
    // backup.js and is a WHITELIST there too — floorPlan has to survive it.
    const scenesData = [];
    for (const meta of allScenes) {
      const scene = await sceneStore.loadScene(meta.id);
      if (!scene) continue;
      const mapExt = mapExtFromScene(scene);
      const mapBuffer = scene.mapType !== 'video' ? await blobToArrayBuffer(scene.mapBlob) : null;
      let fogBuffer = null;
      if (scene.baseFogBlob) fogBuffer = await blobToArrayBuffer(scene.baseFogBlob);
      else if (scene.baseFogPNG) fogBuffer = await dataURLToArrayBuffer(scene.baseFogPNG);
      const thumbBuffer = await blobToArrayBuffer(scene.thumbnail);
      const mapMimeType = scene.mapBlob ? (scene.mapBlob.type || 'image/jpeg')
                                        : (mapExt === '.mp4' ? 'video/mp4' : 'video/webm');
      scenesData.push({
        id: scene.id, mapType: scene.mapType || 'image', mapExt,
        metadata: {
          id: scene.id, name: scene.name, mapType: scene.mapType || 'image',
          mapWidth: scene.mapWidth, mapHeight: scene.mapHeight, mapMimeType, mapExt,
          polygons: scene.polygons || [], nextPolygonId: scene.nextPolygonId || 1,
          floorPlan: scene.floorPlan, gridConfig: scene.gridConfig || {},
          fogSettings: scene.fogSettings, createdAt: scene.createdAt || 0,
          sortOrder: scene.sortOrder || 0,
        },
        mapBuffer, fogBuffer, thumbBuffer,
      });
    }
    await window.electronAPI.createBackupZip(${JSON.stringify(zipPath)}, scenesData,
      typeof mtBackupPayload === 'function' ? mtBackupPayload() : null);
    return { count: scenesData.length, before: allScenes.length };
  })()`, 300000);
  rig.check(fs.existsSync(zipPath) && fs.statSync(zipPath).size > 0,
            'create-backup-zip produced no file at ' + zipPath);
  rig.note('exported ' + exported.count + ' scenes -> ' + Math.round(fs.statSync(zipPath).size / 1024) + ' KB zip');

  const restored = await dm.evaluate(`(async () => {
    await restoreFromZipPath(${JSON.stringify(zipPath)});
    const names = allScenes.map(s => s.name);
    const out = [];
    for (const meta of allScenes) {
      const sc = await sceneStore.loadScene(meta.id);
      out.push({ id: sc.id, name: sc.name, mapType: sc.mapType, w: sc.mapWidth, h: sc.mapHeight,
                 abs: sc.mapType === 'video' ? await window.electronAPI.getVideoFilePath(sc.id) : null,
                 hasFog: !!sc.baseFogBlob, hasThumb: !!sc.thumbnail });
    }
    return { names, scenes: out };
  })()`, 300000);

  rig.check(restored.scenes.length === exported.before + exported.count,
            'restore did not add ' + exported.count + ' scenes: library is now ' + restored.scenes.length);
  // The copies land beside the originals under a de-duplicated name, which is what tells us the
  // manifest, the names and the extraction all came back rather than half of them.
  const copies = restored.scenes.filter(s => / \(2\)$/.test(s.name));
  rig.check(copies.length === exported.count,
            'the restored scenes are not named as copies: ' + JSON.stringify(restored.names));
  const copiedVideo = copies.find(s => s.mapType === 'video');
  rig.check(!!copiedVideo && copiedVideo.w === saved.w && copiedVideo.h === saved.h,
            'the restored animated map came back at the wrong size: ' + JSON.stringify(copiedVideo));
  rig.check(!!copiedVideo && !!copiedVideo.abs && fs.existsSync(copiedVideo.abs) &&
            fs.statSync(copiedVideo.abs).size === fs.statSync(saved.abs).size,
            'the restored animated map is not on disk at its original size');
  const copiedStill = copies.find(s => s.mapType === 'image');
  rig.check(!!copiedStill && copiedStill.hasFog && copiedStill.hasThumb,
            'the restored still map lost its fog or its thumbnail');
  rig.note('round trip: ' + restored.names.join(', '));
};
