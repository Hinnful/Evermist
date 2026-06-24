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

// Remove #scene-fade.dark after enforcing a minimum visible duration (SCENE_FADE_MIN_MS).
// Defers one RAF frame so PixiJS has rendered the fogged scene before the cover lifts.
function revealPlayer() {
  const holdMs = Math.max(0, SCENE_FADE_MIN_MS - (Date.now() - _sceneFadeStart));
  setTimeout(() => requestAnimationFrame(() =>
    document.getElementById('scene-fade').classList.remove('dark')), holdMs);
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
    gridConfig:    captureGridConfig(),
  };
  baseFogCanvas.toBlob(blob => {
    if (!blob || currentScene !== scene) return;
    scene.polygons      = snap.polygons;
    scene.nextPolygonId = snap.nextPolygonId;
    scene.baseFogBlob   = blob;
    scene.gridConfig    = snap.gridConfig;
    sceneStore.saveScene(scene).catch(console.error);
  }, 'image/png');
}
