// scenes.js — scene auto-save + fog state persistence helpers
// Loaded before the inline script; functions reference inline-script globals lazily.

// Async fog-canvas → Blob. Resolves to null if no canvas.
function fogToBlob() {
  return new Promise(resolve => {
    if (!baseFogCanvas) { resolve(null); return; }
    baseFogCanvas.toBlob(blob => resolve(blob || null), 'image/png');
  });
}

// Load baseFog from a scene record into the already-initialised fogDataCanvas /
// baseFogCanvas pair. Handles Blob storage (new) and data-URL strings (legacy).
// Fills solid navy if neither is present.
function loadFogFromScene(scene) {
  return new Promise(resolve => {
    const fill = () => {
      fogDataCtx.fillStyle = '#1a1a2e';
      fogDataCtx.fillRect(0, 0, fogDataCanvas.width, fogDataCanvas.height);
      baseFogCtx.fillStyle = '#1a1a2e';
      baseFogCtx.fillRect(0, 0, baseFogCanvas.width, baseFogCanvas.height);
      resolve();
    };
    const src = scene.baseFogBlob
      ? URL.createObjectURL(scene.baseFogBlob)
      : (scene.baseFogPNG || null);
    if (!src) { fill(); return; }
    const img = new Image();
    img.onload = () => {
      fogDataCtx.drawImage(img, 0, 0, fogDataCanvas.width, fogDataCanvas.height);
      baseFogCtx.drawImage(img, 0, 0, baseFogCanvas.width, baseFogCanvas.height);
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

// End the switch: clear the fog off the new map, once it has sat fully closed for
// SCENE_FADE_MIN_MS. Defers one RAF frame so PixiJS has rendered the fogged scene before
// anything starts clearing.
// What the players watch is openFogFromCover() — the fog itself thinning off the map over
// FOG_SCENE_UNCOVER_MS, mirroring the close that started the switch. The two class removals
// are bookkeeping: .dark is the "switch in progress" marker and .blind the first-map fill.
function revealPlayer() {
  const holdMs = Math.max(0, SCENE_FADE_MIN_MS - (Date.now() - _sceneFadeStart));
  setTimeout(() => requestAnimationFrame(() => {
    const fade = document.getElementById('scene-fade');
    fade.classList.remove('dark');
    fade.classList.remove('blind');
    openFogFromCover();
  }), holdMs);
}

// Called from the switchScene catch block. Shows the error, then reloads the
// previously-active scene (once only — isRecovery guards against loops).
// The recovery does NOT wait on the dialog: messageDialog answers asynchronously, so a DM
// who never dismisses it would otherwise be stranded on a broken scene.
function onSwitchSceneError(prevId, isRecovery, err) {
  const willRecover = prevId && !isRecovery;
  messageDialog({
    title: 'Scene would not load',
    message: (err && err.message ? err.message : 'The map file is missing or damaged.')
           + (willRecover ? '\n\nEvermist is going back to the last scene that worked.' : ''),
  });
  if (willRecover) {
    setTimeout(() => switchScene(prevId, true).catch(err2 => {
      console.error('Scene recovery also failed:', err2);
      renderSceneManager();
    }), 0);
  } else {
    renderSceneManager();
  }
}

function scheduleAutoSave() {
  if (!currentScene) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(doAutoSave, 5000);
}

// Non-blocking auto-save: captures a snapshot of current state synchronously,
// then encodes fog asynchronously via toBlob so the main thread is never blocked.
function doAutoSave() {
  if (!currentScene || !baseFogCanvas) return;
  clearTimeout(autoSaveTimer);
  const scene = currentScene;
  const snap = {
    polygons:      polygons.map(p => ({ ...p, vertices: p.vertices.map(v => ({ ...v })) })),
    nextPolygonId,
    // Effects belong to the scene the same way rooms do. Additive spread, never a field
    // whitelist: one would drop cornerRadii from every saved effect on the next load.
    effects:       effects.map(e => ({ ...e, vertices: e.vertices.map(v => ({ ...v })) })),
    nextEffectId,
    gridConfig:    captureGridConfig(),
    fogSettings:   {
      pickedHex: fogPickedHex,
      tintAlpha: FOG_TINT_ALPHA,
      anim: {
        enabled:  fogAnimEnabled,
        speed:    fogAnimSpeed,
        drift:    driftScale,
        morph:    cloudFrameSpeed,
        warpStr:  cloudWarpStrength,
        warpRad:  cloudWarpRadius,
        pulse:    alphaPulseAmp,
      },
    },
  };
  baseFogCanvas.toBlob(blob => {
    if (!blob || currentScene !== scene) return;
    scene.polygons      = snap.polygons;
    scene.nextPolygonId = snap.nextPolygonId;
    scene.effects       = snap.effects;
    scene.nextEffectId  = snap.nextEffectId;
    scene.baseFogBlob   = blob;
    scene.gridConfig    = snap.gridConfig;
    scene.fogSettings   = snap.fogSettings;
    sceneStore.saveScene(scene).catch(console.error);
  }, 'image/png');
}
