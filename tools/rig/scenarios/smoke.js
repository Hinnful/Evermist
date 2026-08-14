'use strict';

// smoke.js — the fast always-run set. Four blocks:
//
//   1. The animated-map compression feature: load order, the switch's placement and persistence,
//      the one-per-run explainer, and the switch's own geometry.
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

    closeDropdown();
    return { fails, shrink, label, tip, dlg, onAfterFirst, offAgain, onAgain, explainedTwice,
             knob: { above: +above.toFixed(2), below: +below.toFixed(2), right: +right.toFixed(2) },
             gaps: { top: +gaps.top.toFixed(2), bottom: +gaps.bottom.toFixed(2), right: +gaps.right.toFixed(2) } };
  })()`);

  for (const f of result.fails) rig.check(false, f);
  rig.check(result.fails.length === 0, 'the compression block reported ' + result.fails.length + ' failures');
  rig.note('knob inside its track — above ' + result.knob.above + ', below ' + result.knob.below +
           ', right clearance ' + result.knob.right);
  rig.note('switch to footer edges — top ' + result.gaps.top + ', bottom ' + result.gaps.bottom +
           ', right ' + result.gaps.right);
  rig.note('switch label: ' + JSON.stringify(result.label) + '   tooltip: ' + JSON.stringify(result.tip));
  rig.note('explainer: ' + JSON.stringify(result.dlg.title) + '  button=' + JSON.stringify(result.dlg.button) +
           '  ' + result.dlg.msg.length + ' chars, statement=' + result.dlg.solo);
  rig.note('off by default, then on/off/on: ' + result.onAfterFirst + '/' + result.offAgain + '/' +
           result.onAgain + '   re-explained: ' + result.explainedTwice);
  rig.note('6150x2850 -> ' + result.shrink.w + 'x' + result.shrink.h);

  // ── The two maps every later block needs ───────────────────────────────────
  // Generated in-page and cached on disk, so nothing binary lives in the repo and no real map
  // has to be pointed at. The animated one is deliberately WIDER than MAP_BOX_W, so the import
  // exercises the shrink for real rather than only its arithmetic.
  const still = await rig.fixtures.stillMap(dm, rig.fixtureDir, { w: 2000, h: 1200, name: 'rig-still.png' });
  const anim = await rig.fixtures.animatedMap(dm, rig.fixtureDir,
    { w: 4096, h: 2160, seconds: 2, name: 'rig-anim-big.mp4' });
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
  rig.check(!!saved.abs && saved.abs.toLowerCase().startsWith(rig.profileDir.toLowerCase()),
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
  await settle(dm, 'videoDOMActive && !!mapVideo && !mapVideo.paused && mapVideo.readyState >= 3', 30000);
  const v1 = await dm.evaluate(STATE);
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
