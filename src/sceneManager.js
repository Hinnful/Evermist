'use strict';

// ─── Scene management ─────────────────────────────────────────────────────────

let switchGeneration = 0;     // monotone counter; each switchScene call captures its
                               // own generation and aborts if a newer call has started

const thumbURLs = new Map(); // scene id → blob URL for thumbnail display

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function generateThumbnail(bitmap, w, h) {
  const W = 400, H = Math.round(W * h / w);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  c.getContext('2d').drawImage(bitmap, 0, 0, W, H);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
}


function renderSceneManager() {
  const ids = new Set(allScenes.map(s => s.id));
  for (const [id, url] of thumbURLs) {
    if (!ids.has(id)) { URL.revokeObjectURL(url); thumbURLs.delete(id); }
  }
  for (const s of allScenes) {
    if (!thumbURLs.has(s.id) && s.thumbnail) thumbURLs.set(s.id, URL.createObjectURL(s.thumbnail));
  }
  const grid = document.getElementById('sm-grid');
  if (!grid) return;
  if (!allScenes.length) {
    grid.innerHTML = '<div id="sm-empty">No scenes yet — click + New Scene to add one</div>';
    return;
  }
  grid.innerHTML = '';
  for (const s of allScenes) {
    const isActive = currentScene && currentScene.id === s.id;
    const card = document.createElement('div');
    card.className = 'sm-card' + (isActive ? ' active' : '');
    card.dataset.id = s.id;
    const thumbSrc = thumbURLs.get(s.id) || '';
    const overlayInner = isActive
      ? '<span class="sm-card-overlay-label">Current</span>'
      : '<button class="sm-card-load-btn" tabindex="-1">Load</button>';
    card.innerHTML =
      '<div class="sm-card-thumb-wrap">' +
        '<img class="sm-card-thumb" src="' + escHtml(thumbSrc) + '" alt="">' +
        '<div class="sm-card-overlay">' + overlayInner + '</div>' +
      '</div>' +
      '<button class="sm-card-rename" title="Rename scene"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' +
      '<button class="sm-card-del" title="Delete scene"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>' +
      '<div class="sm-card-footer"><div class="sm-card-name"></div></div>';
    card.querySelector('.sm-card-name').textContent = s.name;
    card.onclick = e => {
      if (e.target.closest('.sm-card-del') || e.target.closest('.sm-card-rename')) return;
      closeSceneManager();
      switchScene(s.id).catch(err => console.error('switchScene failed:', err));
    };
    card.querySelector('.sm-card-rename').onclick = e => { e.stopPropagation(); startRenameScene(s.id); };
    card.querySelector('.sm-card-del').onclick = e => { e.stopPropagation(); confirmDeleteScene(s.id); };
    grid.appendChild(card);
  }
}

function openSceneManager() {
  doAutoSave(); // persist current fog state before user might switch
  document.getElementById('scene-manager-backdrop').style.display = '';
  document.getElementById('scene-manager').style.display = '';
  renderSceneManager();
}

function closeSceneManager() {
  document.getElementById('scene-manager-backdrop').style.display = 'none';
  document.getElementById('scene-manager').style.display = 'none';
}

async function initScenes() {
  try { await sceneStore.initSceneDB(); }
  catch (err) { console.warn('IndexedDB unavailable, scene persistence disabled:', err); return; }
  allScenes = await sceneStore.listScenes();
  allScenes.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  renderSceneManager();
  const lastId = localStorage.getItem('evermist-current-scene-id');
  if (lastId && allScenes.find(s => s.id === lastId)) await switchScene(lastId);
}

async function createNewScene(file) {
  if (!isVideoFile(file)) showMapProgress('Loading map…');
  if (currentScene) doAutoSave();
  cleanupVideo();
  const name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim() || 'New Scene';
  const maxOrder = allScenes.length > 0 ? Math.max(...allScenes.map(s => s.sortOrder ?? 0)) : -1;
  const isVid = isVideoFile(file);
  const onLoaded = async (bitmap, blob) => {
    const thumb = await generateThumbnail(bitmap, mapWidth, mapHeight);
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);

    let mapBlob = undefined;
    let mapPath = undefined;
    if (isVid && window.electronAPI) {
      showMapProgress('Saving video map…');
      const mimeType = file.type || (file.name.endsWith('.mp4') ? 'video/mp4' : 'video/webm');
      const ext = mimeType === 'video/mp4' ? '.mp4' : '.webm';
      await window.electronAPI.saveVideoFile(file.path, id, mimeType);
      hideMapProgress();
      mapPath = 'maps/' + id + ext;
    } else {
      mapBlob = isVid ? mapVideoBlob : blob;
    }

    const scene = {
      id, name,
      mapBlob, mapPath,
      mapType:       isVid ? 'video' : 'image',
      mapWidth, mapHeight,
      polygons:      [],
      nextPolygonId: 1,
      baseFogBlob:   await fogToBlob(),
      gridConfig:    captureGridConfig(),
      thumbnail:     thumb,
      createdAt:     Date.now(),
      sortOrder:     maxOrder + 1,
    };
    allScenes.push({ id, name, thumbnail: thumb, sortOrder: scene.sortOrder, createdAt: scene.createdAt });
    await sceneStore.saveScene(scene);
    hideMapProgress();
    // Reload through the proven scene-switch path. The direct drop-load path leaves the
    // PixiJS fog/video uninitialised until a manual switch (map renders fully revealed,
    // shroud has no effect, video frozen). switchScene() rebuilds everything correctly.
    currentScene = null;
    await switchScene(id);
  };
  if (isVid) loadVideoFromFile(file, onLoaded);
  else loadMapFromFile(file, onLoaded);
}

async function replaceSceneMap(file) {
  if (!currentScene) { createNewScene(file); return; }
  cleanupVideo();
  const isVid = isVideoFile(file);
  const onLoaded = async (bitmap, blob) => {
    if (isVid && window.electronAPI) {
      // Delete old video file if this scene had one
      if (currentScene.mapPath) {
        window.electronAPI.deleteVideoFile(currentScene.id).catch(() => {});
      }
      showMapProgress('Saving video map…');
      const mimeType = file.type || (file.name.endsWith('.mp4') ? 'video/mp4' : 'video/webm');
      const ext = mimeType === 'video/mp4' ? '.mp4' : '.webm';
      await window.electronAPI.saveVideoFile(file.path, currentScene.id, mimeType);
      hideMapProgress();
      currentScene.mapPath = 'maps/' + currentScene.id + ext;
      currentScene.mapBlob = undefined;
    } else {
      currentScene.mapBlob = isVid ? mapVideoBlob : blob;
      currentScene.mapPath = undefined;
    }
    currentScene.mapType    = isVid ? 'video' : 'image';
    currentScene.mapWidth   = mapWidth;
    currentScene.mapHeight  = mapHeight;
    currentScene.baseFogBlob = await fogToBlob();
    const thumb = await generateThumbnail(bitmap, mapWidth, mapHeight);
    currentScene.thumbnail = thumb;
    const meta = allScenes.find(s => s.id === currentScene.id);
    if (meta) meta.thumbnail = thumb;
    await sceneStore.saveScene(currentScene);
    renderSceneManager();
    // Reload through the proven scene-switch path (see createNewScene): the direct
    // drop-load path leaves PixiJS fog/video uninitialised until a manual switch.
    const sid = currentScene.id;
    currentScene = null;
    await switchScene(sid);
  };
  if (isVid) loadVideoFromFile(file, onLoaded);
  else loadMapFromFile(file, onLoaded);
}

async function switchScene(id, _isRecovery = false) {
  if (currentScene && currentScene.id === id) return;
  const myGen = ++switchGeneration;
  if (currentScene) doAutoSave();
  const prevId = currentScene ? currentScene.id : null;
  currentScene = null;
  cleanupVideo();
  // Abort any in-flight reveal/shroud crossfade from the outgoing scene so its
  // tick can't keep running against orphaned snapshot canvases. The drifting
  // anim loop is persistent + idempotent — leave it running across the switch.
  stopFogTransition();
  if (!isPlayer && playerWindow && !playerWindow.closed) {
    const destMeta = allScenes.find(s => s.id === id);
    playerWindow.postMessage({ type: 'scene-transition', phase: 'out', sceneName: destMeta ? destMeta.name : null }, '*');
  }
  try {
  const scene = await sceneStore.loadScene(id);
  if (myGen !== switchGeneration) return;
  if (!scene) throw new Error('Scene not found.');

  if (mapBitmap) { mapBitmap.close(); mapBitmap = null; }
  mapWidth   = scene.mapWidth;
  mapHeight  = scene.mapHeight;

  // Lazy migration: move legacy IDB video blob to filesystem on first access
  if (scene.mapType === 'video' && scene.mapBlob && !scene.mapPath && window.electronAPI) {
    showMapProgress('Migrating video to disk…');
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
      if (!absPath) throw new Error('Video file missing — it may have been moved or deleted.');
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
    pixiSetMap(prepareTextureCanvas(extractCanvas, mapWidth, mapHeight), mapWidth, mapHeight);
    pixiHideMap();
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

  polygons      = (scene.polygons || []).map(p => ({ ...p, vertices: p.vertices.map(v => ({ ...v })) }));
  nextPolygonId = scene.nextPolygonId || 1;
  selectedPolygonId   = null;
  selectedVertexIndex = -1;
  activePolygon = null;
  if (scene.gridConfig) applyGridConfig(scene.gridConfig);

  rebuildFogFromPolygons();
  if (!cloudPattern) generateCloudFrames(512, CLOUD_FRAME_COUNT);
  rebuildFogEffect();
  if (!isPlayer) { pixiInitFog(fogDataCanvas, fogBlurCanvas, cloudBlendCanvas, mapWidth, mapHeight); pixiFlushTexturePool(); }

  if (!isPlayer) restoreSceneFogSettings(scene); // fog.js

  undoStack = []; redoStack = [];
  playerMapSent = false;
  currentScene = scene;
  localStorage.setItem('evermist-current-scene-id', id);
  landing.style.display = 'none';
  if (!isPlayer) container.style.cursor = 'crosshair';
  fitToScreen();
  viewportDirty = true; gridDirty = true; fogDirty = true;
  scheduleRender();
  renderSceneManager();
  if (mapVideo) mapVideo.play().then(() => startVideoLoop()).catch(() => {});
  if (autoSync) setTimeout(() => sendToPlayer(false, true), 150);
  onSceneLoaded(); // viewport.js: flush pending player resync if Player asked while loading
  } catch (err) {
    if (myGen !== switchGeneration) return;
    mapOffscreen = null;
    fogDataCanvas = null; fogDataCtx = null;
    baseFogCanvas = null; baseFogCtx = null;
    cleanupVideo();
    onSwitchSceneError(prevId, _isRecovery, err); // scenes.js
  }
}

function startRenameScene(id) {
  const card = document.querySelector('.sm-card[data-id="' + id + '"]');
  if (!card) return;
  const nameEl = card.querySelector('.sm-card-name');
  const s = allScenes.find(x => x.id === id);
  if (!s) return;
  const input = document.createElement('input');
  input.className = 'sm-card-name-input';
  input.value = s.name;
  nameEl.replaceWith(input);
  input.focus(); input.select();
  const commit = () => {
    const newName = input.value.trim() || s.name;
    s.name = newName;
    if (currentScene && currentScene.id === id) currentScene.name = newName;
    sceneStore.loadScene(id).then(sc => { if (sc) { sc.name = newName; sceneStore.saveScene(sc); } });
    renderSceneManager();
  };
  input.onblur = commit;
  input.onkeydown = e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = s.name; input.blur(); }
  };
}

async function confirmDeleteScene(id) {
  const s = allScenes.find(x => x.id === id);
  if (!confirm('Delete scene "' + (s ? s.name : id) + '"? This cannot be undone.')) return;
  await sceneStore.deleteScene(id);
  if (window.electronAPI) {
    window.electronAPI.deleteVideoFile(id).catch(() => {});
  }
  allScenes = allScenes.filter(x => x.id !== id);
  if (thumbURLs.has(id)) { URL.revokeObjectURL(thumbURLs.get(id)); thumbURLs.delete(id); }
  if (currentScene && currentScene.id === id) {
    currentScene = null;
    cleanupVideo();
    mapBitmap = null; mapOffscreen = null; mapWidth = 0; mapHeight = 0;
    polygons = []; nextPolygonId = 1;
    landing.style.display = '';
    if (!isPlayer) container.style.cursor = 'default';
    if (allScenes.length) await switchScene(allScenes[0].id);
  }
  renderSceneManager();
}

async function moveScene(id, dir) {
  const idx = allScenes.findIndex(s => s.id === id);
  if (idx < 0) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= allScenes.length) return;
  [allScenes[idx], allScenes[newIdx]] = [allScenes[newIdx], allScenes[idx]];
  allScenes.forEach((s, i) => { s.sortOrder = i; });
  for (const s of allScenes) {
    sceneStore.loadScene(s.id).then(sc => { if (sc) { sc.sortOrder = s.sortOrder; sceneStore.saveScene(sc); } });
  }
  renderSceneManager();
}

if (typeof module !== 'undefined') module.exports = { escHtml };
