'use strict';
// scenes.js — scene auto-save + fog state persistence helpers
// Loaded before the inline script; functions reference inline-script globals lazily.

// Async fog-canvas → Blob. Resolves to null if no canvas.
function fogToBlob() {
  return new Promise(resolve => {
    if (!baseFogCanvas) { resolve(null); return; }
    baseFogCanvas.toBlob(blob => resolve(blob || null), 'image/png');
  });
}

// Load baseFog from a scene record into the initialised fogDataCanvas / baseFogCanvas pair. Handles
// both Blob and legacy data-URL storage, and fills solid navy if neither is present.
// ⚠ The canvases are taken at the call: a decode that lands after a newer switch made its own would
// otherwise draw this map's fog into that map's, and its next save would keep the blend.
function loadFogFromScene(scene) {
  const targets = [fogDataCtx, baseFogCtx];
  return new Promise(resolve => {
    const fill = () => {
      for (const ctx of targets) {
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }
      resolve();
    };
    const src = scene.baseFogBlob
      ? URL.createObjectURL(scene.baseFogBlob)
      : (scene.baseFogPNG || null);
    if (!src) { fill(); return; }
    const img = new Image();
    img.onload = () => {
      for (const ctx of targets) ctx.drawImage(img, 0, 0, ctx.canvas.width, ctx.canvas.height);
      if (scene.baseFogBlob) URL.revokeObjectURL(src);
      resolve();
    };
    img.onerror = () => {
      if (scene.baseFogBlob) URL.revokeObjectURL(src);
      fill();
    };
    img.src = src;
  });
}

// End the switch: clear the fog off the new map, once it has sat fully closed for its minimum.
// Defers one RAF frame so PixiJS has rendered the fogged scene before anything clears.
// What the players watch is openFogFromCover(), mirroring the close. The class removals are
// bookkeeping: .dark marks a switch in progress and .blind the first-map fill.
// ⚠ A swap of the fog's theme under the cover runs its course first, so the hold lasts at least that
// long; the wait gives up after a few seconds rather than keep the TV shut.
function revealPlayer() {
  const holdMs = Math.max(0, SCENE_FADE_MIN_MS - (Date.now() - _sceneFadeStart));
  const giveUp = Date.now() + holdMs + 4000;
  // The held theme swaps in two frames on, once the new map's upload is behind it.
  requestAnimationFrame(() => requestAnimationFrame(releasePlayerFogTheme));
  const open = () => {
    const swapping = playerFogThemeHeld() || pixiPlayerFogSwapping() || (fogThemePending && fogThemePending !== fogTheme);
    if (swapping && Date.now() < giveUp) { setTimeout(open, 50); return; }
    if (typeof onPlayerMapShown === 'function') onPlayerMapShown();
    requestAnimationFrame(() => {
      const fade = document.getElementById('scene-fade');
      fade.classList.remove('dark');
      fade.classList.remove('blind');
      openFogFromCover();
    });
  };
  setTimeout(open, holdMs);
}

// Called from the switchScene catch block: shows the error, then reloads the previously-active
// scene once. ⚠ The recovery does NOT wait on the dialog, or a DM who never dismisses it is
// stranded on a broken scene.
function onSwitchSceneError(prevId, isRecovery, err) {
  const willRecover = prevId && !isRecovery;
  messageDialog({
    title: 'Map would not load',
    message: (err && err.message ? err.message : t('The map file is missing or damaged.'))
           + (willRecover ? '\n\n' + t('Evermist is going back to the last map that worked.') : ''),
  });
  if (willRecover) {
    setTimeout(() => switchScene(prevId, true).catch(err2 => {
      console.error('Scene recovery also failed:', err2);
      sceneListChanged();
    }), 0);
  } else {
    sceneListChanged();
  }
}

function scheduleAutoSave() {
  if (!currentScene) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(doAutoSave, 5000);
}

// The open scene's fog settings in the shape a scene record stores them.
// ⚠ The record the map was opened with, untouched: the theme drives the look now, and the previous
// release (/rollback) still reads its colour from here.
function captureFogSettings() {
  return fogSettingsKept || undefined;
}

async function _sameBlob(a, b) {
  if (!(b instanceof Blob) || a.size !== b.size) return false;
  const [x, y] = (await Promise.all([a.arrayBuffer(), b.arrayBuffer()])).map(v => new Uint8Array(v));
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

// Every save still writing. A teardown's null still lets one land (see doAutoSave), so a detach that must not
// be written over, an import's, awaits these.
const _autoSavesInFlight = new Set();
function autoSavesSettled() { return Promise.all([..._autoSavesInFlight]); }

// Non-blocking auto-save: captures a snapshot of current state synchronously,
// then encodes fog asynchronously via toBlob so the main thread is never blocked.
// ⚠ RESOLVES WHEN THE WRITE IS DONE, not when it is queued. Closing a column removes the frame,
// and a fog encode still in flight there dies with it - two-column mode awaits this first.
function doAutoSave() {
  if (!currentScene || !baseFogCanvas) return Promise.resolve();
  clearTimeout(autoSaveTimer);
  const scene = currentScene;
  esAssignUids(polygons); esAssignUids(effects);
  const fogEdited = fogEditedSinceSave;
  fogEditedSinceSave = false;
  const snap = {
    // encodeShapeForSave is what makes an older build fail closed on a held room.
    polygons:      polygons.map(p => encodeShapeForSave(copyShapeRings(p))),
    nextPolygonId,
    pictureBlobs:  picturesReferenced(polygons, pictureBlobs),
    // Effects belong to the scene the same way rooms do, through the same additive copy.
    effects:       effects.map(copyShapeRings),
    nextEffectId,
    lights:        lightsSceneFields(),
    gridConfig:    captureGridConfig(),
    tvFit:         tvFit.step ? { step: tvFit.step, turn: tvFit.turn } : undefined,
    fogSettings:   captureFogSettings(),
    weather:       weatherId,
    fogTheme,
  };
  const run = new Promise(resolve => {
    baseFogCanvas.toBlob(async blob => {
      // ⚠ A null currentScene means a teardown asked for this flush, so it still counts.
      if (!blob || (currentScene !== null && currentScene !== scene)) { fogEditedSinceSave = fogEditedSinceSave || fogEdited; resolve(); return; }
      // Every undo step raises the flag, room names and notes included. A picture that did not change
      // keeps its edit time, or an import keeps this machine's fog over the other's newer reveals.
      const fogChanged = fogEdited && !(await _sameBlob(blob, scene.baseFogBlob).catch(() => false));
      scene.polygons      = snap.polygons;
      scene.nextPolygonId = snap.nextPolygonId;
      scene.pictureBlobs  = snap.pictureBlobs;
      scene.effects       = snap.effects;
      scene.nextEffectId  = snap.nextEffectId;
      Object.assign(scene, snap.lights);
      scene.baseFogBlob   = blob;
      scene.gridConfig    = snap.gridConfig;
      scene.fogSettings   = snap.fogSettings;
      // Absent means none, so a map without weather keeps the record the previous release wrote. A value
      // this build cannot read (a newer release's, after /rollback) stays until the DM picks another.
      if (snap.weather !== weatherNormalize(scene.weather)) { if (snap.weather !== 'none') scene.weather = snap.weather; else delete scene.weather; }
      // The same for the fog theme: absent is Default, which the previous release never reads.
      if (snap.fogTheme !== fogThemeNormalize(scene.fogTheme)) { if (snap.fogTheme !== 'default') scene.fogTheme = snap.fogTheme; else delete scene.fogTheme; }
      if (snap.tvFit) scene.tvFit = snap.tvFit; else delete scene.tvFit;
      // Never snapshotted: an edit made while the fog encodes would be overwritten with the old text.
      if (typeof scene.notes !== 'string') scene.notes = '';
      // ⚠ Settles even when the store throws: an import and a switch wait on this.
      Promise.resolve().then(() => sceneStore.saveScene(scene, { fogEdited: fogChanged })).catch(console.error).then(resolve, resolve);
    }, 'image/png');
  });
  _autoSavesInFlight.add(run);
  run.then(() => _autoSavesInFlight.delete(run));
  return run;
}
