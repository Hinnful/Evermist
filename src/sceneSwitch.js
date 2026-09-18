// sceneSwitch.js — one scene leaving the screen and the next arriving.
//
// ⚠ EVERY PATH INTO A LOADED MAP COMES THROUGH HERE. A direct load leaves the PixiJS fog and the
// video uninitialised, so the map renders fully revealed and shroud does nothing.

async function switchScene(id, _isRecovery = false) {
  if (currentScene && currentScene.id === id) return;
  const myGen = ++switchGeneration;
  // ⚠ AWAITED, or a switch BACK reads the store before these edits land. DECISIONS.md
  if (currentScene) await doAutoSave();
  const prevId = currentScene ? currentScene.id : null;
  currentScene = null;
  cleanupVideo();
  // Abort the outgoing crossfade, so its tick cannot run against orphaned snapshots. The drifting
  // anim loop is idempotent - leave it running.
  stopFogTransition();
  if (!isPlayer && playerWindow && !playerWindow.closed) {
    playerWindow.postMessage({ type: 'scene-transition', phase: 'out' }, '*');
    _sceneOutPostedAt = Date.now();
  }
  try {
  const scene = await sceneStore.loadScene(id);
  if (myGen !== switchGeneration) return;
  if (!scene) throw new Error('Scene not found.');

  // The destination fog colour, AS SOON AS IT IS KNOWN, so the Player reaches it while the fog is
  // still closing. ⚠ Must beat applyFogSettingsFromScene, which would land it a frame later.
  if (!isPlayer && playerWindow && !playerWindow.closed) {
    const destHex = scene.fogSettings && scene.fogSettings.pickedHex;
    if (destHex) playerWindow.postMessage({ type: 'scene-transition', phase: 'tint', pickedHex: destHex }, '*');
  }

  if (mapBitmap) { mapBitmap.close(); mapBitmap = null; }
  mapWidth   = scene.mapWidth;
  mapHeight  = scene.mapHeight;

  // Lazy migration: move legacy IDB video blob to filesystem on first access
  if (scene.mapType === 'video' && scene.mapBlob && !scene.mapPath && window.electronAPI) {
    showMapProgress('Moving the animated map to disk…');
    const ab = await scene.mapBlob.arrayBuffer();
    if (myGen !== switchGeneration) return;
    const mime = scene.mapBlob.type || 'video/webm';
    const ext = mime === 'video/mp4' ? '.mp4' : '.webm';
    await window.electronAPI.saveVideoBlob(scene.id, ab, mime);
    if (myGen !== switchGeneration) return;
    scene.mapPath = 'maps/' + scene.id + ext;
    scene.mapBlob = undefined;
    await sceneStore.saveScene(scene);
    if (myGen !== switchGeneration) return;
    hideMapProgress();
  }

  if (scene.mapType === 'video') {
    if (scene.mapPath && window.electronAPI) {
      const absPath = await window.electronAPI.getVideoFilePath(scene.id);
      if (myGen !== switchGeneration) return;
      if (!absPath) throw new Error('The video file is missing. It may have been moved or deleted.');
      mapVideoUrl = 'file:///' + absPath.replace(/\\/g, '/');
    } else if (scene.mapBlob) {
      mapVideoUrl = URL.createObjectURL(scene.mapBlob);
    } else {
      throw new Error('Video data not found for this scene.');
    }
    const video = document.createElement('video');
    video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'auto';
    video.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;pointer-events:none;';
    document.body.appendChild(video);
    await new Promise((resolve, reject) => {
      let settled = false;
      video.onerror = () => {
        if (settled) return;
        settled = true;
        video.onerror = null; video.oncanplay = null;
        video.pause(); video.src = '';
        if (video.parentNode) video.parentNode.removeChild(video);
        cleanupVideo();
        reject(new Error('Video load failed'));
      };
      video.oncanplay = function() {
        if (settled) return;
        settled = true;
        video.onerror = null; video.oncanplay = null;
        resolve();
      };
      video.src = mapVideoUrl;
    });
    if (myGen !== switchGeneration) {
      video.pause(); video.src = '';
      if (video.parentNode) video.parentNode.removeChild(video);
      return;
    }
    // Seek to near-zero and wait for decoded frame before extracting
    await new Promise(resolve => {
      video.onseeked = function() { video.onseeked = null; resolve(); };
      video.currentTime = 0.001;
      setTimeout(() => { if (video.onseeked) { video.onseeked = null; resolve(); } }, 2000);
    });
    if (myGen !== switchGeneration) {
      video.pause(); video.src = '';
      if (video.parentNode) video.parentNode.removeChild(video);
      return;
    }
    const extractCanvas = document.createElement('canvas');
    extractCanvas.width = mapWidth; extractCanvas.height = mapHeight;
    extractCanvas.getContext('2d').drawImage(video, 0, 0, mapWidth, mapHeight);
    mapOffscreen = extractCanvas;
    bindVideoFrameTexture(extractCanvas, mapWidth, mapHeight);
    mapVideo = video;
    attachVideoListeners(video);
    mapVideoBlob = scene.mapBlob || null;

    // Fog canvases (needs mapWidth/mapHeight, already set above)
    fogDataCanvas = document.createElement('canvas');
    fogDataCanvas.width  = Math.ceil(mapWidth  / FOG_SCALE);
    fogDataCanvas.height = Math.ceil(mapHeight / FOG_SCALE);
    fogDataCtx = fogDataCanvas.getContext('2d');
    baseFogCanvas = document.createElement('canvas');
    baseFogCanvas.width  = fogDataCanvas.width;
    baseFogCanvas.height = fogDataCanvas.height;
    baseFogCtx = baseFogCanvas.getContext('2d');

    await loadFogFromScene(scene);
    if (myGen !== switchGeneration) return;
  } else {
    // Fog canvases created before bitmap await — only needs mapWidth/mapHeight
    fogDataCanvas = document.createElement('canvas');
    fogDataCanvas.width  = Math.ceil(mapWidth  / FOG_SCALE);
    fogDataCanvas.height = Math.ceil(mapHeight / FOG_SCALE);
    fogDataCtx = fogDataCanvas.getContext('2d');
    baseFogCanvas = document.createElement('canvas');
    baseFogCanvas.width  = fogDataCanvas.width;
    baseFogCanvas.height = fogDataCanvas.height;
    baseFogCtx = baseFogCanvas.getContext('2d');

    // Decode map bitmap and fog simultaneously
    const [bitmap] = await Promise.all([
      createImageBitmap(scene.mapBlob),
      loadFogFromScene(scene),
    ]);
    if (myGen !== switchGeneration) { bitmap.close(); return; }

    mapOffscreen = document.createElement('canvas');
    mapOffscreen.width  = mapWidth;
    mapOffscreen.height = mapHeight;
    mapOffscreen.getContext('2d').drawImage(bitmap, 0, 0);
    pixiSetMap(prepareTextureCanvas(mapOffscreen, mapWidth, mapHeight), mapWidth, mapHeight);
    bitmap.close();
    mapBitmap = null;
  }

  // Progressive render (DM only): show map immediately while fog rebuilds below.
  // fogDataCanvas/baseFogCanvas are already filled so the render pipeline is safe.
  if (!isPlayer) {
    fitToScreen();
    minimapSeedView();
    viewportDirty = true; gridDirty = true; fogDirty = true;
    scheduleRender();
    landing.style.display = 'none';
    container.style.cursor = 'crosshair';
  }

  // normalizeRoomFields backfills `name` on scenes saved before rooms had names (roomPanel.js),
  // copyShapeRings spreads additively, and decodeShapeFromSave gives a held room its mode back.
  polygons      = normalizeRoomFields(scene.polygons || [])
                    .map(p => decodeShapeFromSave(copyShapeRings(p)));
  nextPolygonId = scene.nextPolygonId || 1;
  clearShapeSelection();
  activePolygon = null;
  // Same additive spread the rooms above take: a field whitelist drops cornerRadii from every
  // saved effect on load. A scene predating effects carries none, clearing the outgoing scene's.
  setEffects(scene.effects || []);
  nextEffectId = scene.nextEffectId || 1;
  if (scene.gridConfig) applyGridConfig(scene.gridConfig);

  rebuildFogFromPolygons();
  if (!cloudPattern) generateCloudFrames(512, CLOUD_FRAME_COUNT);
  rebuildFogEffect();
  if (!isPlayer) { pixiInitFog(fogDataCanvas, fogBlurCanvas, cloudBlendCanvas, mapWidth, mapHeight); pixiFlushTexturePool(); }

  if (!isPlayer) restoreSceneFogSettings(scene); // fog.js

  undoStack = []; redoStack = [];
  playerMapSent = false;
  currentScene = scene;
  // ⚠ A column must not write this: the parent restores from it at startup, so column B's map
  // would be the one that came back.
  if (!isPane) localStorage.setItem('evermist-current-scene-id', id);
  landing.style.display = 'none';
  if (!isPlayer) container.style.cursor = 'crosshair';
  fitToScreen();
  // ⚠ cursorDirty TOO: the room outlines and labels live on the overlay canvas, and nothing else
  // marks it. Without it the new scene's rooms stay unpainted until the first mouse move.
  viewportDirty = true; gridDirty = true; fogDirty = true; cursorDirty = true;
  scheduleRender();
  renderSceneManager();
  // Selection was cleared above, so close the room card rather than leaving it floating
  // over the new scene with the previous scene's room in it.
  if (typeof resetRoomLabelCache === 'function') resetRoomLabelCache();
  if (typeof refreshRoomPanel === 'function') refreshRoomPanel();
  // Draw Rooms belongs to the scene, not the session: it enables only where this
  // particular map came with a floor plan.
  if (typeof refreshFloorPlanUI === 'function') refreshFloorPlanUI();
  if (mapVideo) mapVideo.play().then(() => startVideoLoop()).catch(() => {});
  // ⚠ HOLD THE PAYLOAD until the Player's fog has closed over the outgoing map. The Player rewrites
  // its map size and camera the moment this lands, and under a half-closed cover that shows the
  // swap. A cached scene loads well inside the close, so the race is the common case.
  if (autoSync) {
    const closedIn = _sceneOutPostedAt
      ? Math.max(0, FOG_SCENE_COVER_MS - (Date.now() - _sceneOutPostedAt))
      : 0;
    setTimeout(() => sendToPlayer(false, true), Math.max(150, closedIn));
  }
  onSceneLoaded(); // viewport.js: flush pending player resync if Player asked while loading
  reportPaneMapSize();   // panes.js: the parent sizes the columns from the two maps' shapes
  } catch (err) {
    if (myGen !== switchGeneration) return;
    mapOffscreen = null;
    fogDataCanvas = null; fogDataCtx = null;
    baseFogCanvas = null; baseFogCtx = null;
    cleanupVideo();
    onSwitchSceneError(prevId, _isRecovery, err); // scenes.js
  }
}
