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


// ── Dropdown UI state (module-local; only sceneManager.js touches these) ──────
let smSelectedIds = new Set();   // ids checked for bulk actions
let smDragId = null;             // id of the card being dragged
let smDragEl = null;             // its DOM node (moved directly so the drag survives)
let smPending = null;            // deferred delete: { items:[{id,index,meta}], ids:[…] }
let smUndoTimer = null;

// ── Checkbox / trash glyphs (built once, injected by string) ──────────────────
const SM_CHECK = '<svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="#8fb6ff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 4.5l2 2 4-4"/></svg>';
const SM_DASH  = '<svg width="8" height="2" viewBox="0 0 8 2" fill="none" stroke="#8fb6ff" stroke-width="2" stroke-linecap="round"><line x1="0.5" y1="1" x2="7.5" y2="1"/></svg>';
const SM_TRASH = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>';

function smIsOpen() {
  const dd = document.getElementById('scene-dd');
  return !!dd && dd.classList.contains('open');
}

function openDropdown() {
  const dd = document.getElementById('scene-dd');
  if (!dd) return;
  if (typeof doAutoSave === 'function') doAutoSave(); // persist current fog before a possible switch
  dd.classList.add('open');
  document.getElementById('scene-dd-menu').style.display = '';
  renderSceneManager();
}

function closeDropdown() {
  const dd = document.getElementById('scene-dd');
  if (!dd) return;
  dd.classList.remove('open');
  document.getElementById('scene-dd-menu').style.display = 'none';
  if (smSelectedIds.size) { smSelectedIds.clear(); renderSceneManager(); }
}

function toggleDropdown() { smIsOpen() ? closeDropdown() : openDropdown(); }

// Back-compat aliases — scenes.js error-recovery calls these names.
function openSceneManager() { openDropdown(); }
function closeSceneManager() { closeDropdown(); }

function initSceneManagerUI() {
  const dd = document.getElementById('scene-dd');
  if (!dd) return;
  const fileInput = document.getElementById('file-input');

  document.getElementById('scene-dd-toggle').onclick = toggleDropdown;
  document.getElementById('scene-dd-add').onclick = () => fileInput.click();

  // "+" merges New Scene + Import: image/video → new scene, .zip → restore backup.
  fileInput.onchange = e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const isZip = /\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed';
    if (isZip) {
      if (window.electronAPI && f.path && typeof restoreFromZipPath === 'function') {
        openDropdown();
        restoreFromZipPath(f.path);
      } else {
        alert('Importing a .zip backup needs the desktop app.');
      }
    } else {
      openDropdown();
      createNewScene(f);
    }
  };

  // Header: select-all checkbox + bulk actions
  document.getElementById('scene-dd-selall').onclick = () => {
    if (allScenes.length && smSelectedIds.size === allScenes.length) smSelectedIds.clear();
    else smSelectedIds = new Set(allScenes.map(s => s.id));
    renderSceneManager();
  };
  document.getElementById('scene-dd-bulk-export').onclick = () => {
    const ids = [...smSelectedIds];
    if (ids.length && typeof doExport === 'function') doExport(ids);
  };
  document.getElementById('scene-dd-bulk-delete').onclick = () => {
    if (smSelectedIds.size) deleteScenesWithUndo([...smSelectedIds]);
  };

  // Undo toast
  document.querySelector('#scene-undo-toast .undo-btn').onclick = undoDelete;

  // Allow drops in the gaps between cards
  document.getElementById('sm-list').addEventListener('dragover', e => e.preventDefault());

  // Close on outside click; finalise any pending delete before the window unloads
  document.addEventListener('mousedown', e => {
    if (smIsOpen() && !dd.contains(e.target)) closeDropdown();
  });
  window.addEventListener('beforeunload', commitPendingDelete);
}

function updateTriggerName() {
  const el = document.getElementById('scene-dd-name');
  if (el) el.textContent = currentScene ? currentScene.name : (allScenes.length ? 'Select a scene' : 'No scenes');
}

function renderSceneManager() {
  updateTriggerName();

  const dd   = document.getElementById('scene-dd');
  const list = document.getElementById('sm-list');
  if (!dd || !list) return;

  // sync thumbnail blob URLs with the current scene set
  const ids = new Set(allScenes.map(s => s.id));
  for (const [id, url] of thumbURLs) {
    if (!ids.has(id)) { URL.revokeObjectURL(url); thumbURLs.delete(id); }
  }
  for (const s of allScenes) {
    if (!thumbURLs.has(s.id) && s.thumbnail) thumbURLs.set(s.id, URL.createObjectURL(s.thumbnail));
  }

  const selecting = smSelectedIds.size > 0;
  dd.classList.toggle('selecting', selecting);

  const countEl = document.getElementById('scene-dd-count');
  if (countEl) countEl.textContent = selecting
    ? `${smSelectedIds.size} selected`
    : `${allScenes.length} scene${allScenes.length === 1 ? '' : 's'}`;

  const selall = document.getElementById('scene-dd-selall');
  if (selall) {
    const all = selecting && smSelectedIds.size === allScenes.length;
    selall.classList.toggle('checked', all);
    selall.classList.toggle('indeterminate', selecting && !all);
    selall.innerHTML = all ? SM_CHECK : (selecting ? SM_DASH : '');
  }

  list.innerHTML = '';
  if (!allScenes.length) {
    list.innerHTML = '<div id="sm-empty">No scenes yet — click + to add one</div>';
    return;
  }
  for (const s of allScenes) list.appendChild(buildSceneCard(s));
}

function buildSceneCard(s) {
  const isActive   = currentScene && currentScene.id === s.id;
  const isSelected = smSelectedIds.has(s.id);

  const card = document.createElement('div');
  card.className = 'sm-card' + (isActive ? ' active' : '') + (isSelected ? ' selected' : '');
  card.dataset.id = s.id;
  card.draggable = true;

  card.innerHTML =
    '<div class="sm-thumb">' +
      '<div class="sm-scrim"></div>' +
      '<div class="sm-cb' + (isSelected ? ' checked' : '') + '">' + (isSelected ? SM_CHECK : '') + '</div>' +
      '<div class="sm-botrow">' +
        '<input class="sm-name" spellcheck="false">' +
        '<button class="sm-trash" title="Delete scene">' + SM_TRASH + '</button>' +
      '</div>' +
    '</div>';

  const thumbURL = thumbURLs.get(s.id);
  if (thumbURL) card.querySelector('.sm-thumb').style.backgroundImage = 'url("' + thumbURL + '")';

  const nameEl = card.querySelector('.sm-name');
  nameEl.value = s.name;

  // checkbox → toggle selection
  card.querySelector('.sm-cb').onclick = e => { e.stopPropagation(); toggleSelect(s.id); };

  // trash → delete with undo
  const trash = card.querySelector('.sm-trash');
  trash.onmousedown = e => e.stopPropagation();
  trash.onclick = e => { e.stopPropagation(); deleteScenesWithUndo([s.id]); };

  // inline rename — clicking the name edits it (no rename button)
  let orig = s.name;
  nameEl.onmousedown = e => e.stopPropagation();
  nameEl.onclick     = e => e.stopPropagation();
  nameEl.onfocus     = () => { orig = s.name; nameEl.select(); };
  nameEl.oninput     = () => { s.name = nameEl.value; };
  nameEl.onkeydown   = e => {
    e.stopPropagation();
    if (e.key === 'Enter')  { e.preventDefault(); nameEl.blur(); }
    else if (e.key === 'Escape') { s.name = orig; nameEl.value = orig; nameEl.blur(); }
  };
  nameEl.onblur = () => commitSceneName(s, nameEl);

  // card click → select (in selection mode) or switch scene
  card.onclick = e => {
    if (e.target.closest('.sm-name') || e.target.closest('.sm-trash') || e.target.closest('.sm-cb')) return;
    if (smSelectedIds.size > 0) { toggleSelect(s.id); return; }
    if (!isActive) switchScene(s.id).catch(err => console.error('switchScene failed:', err));
  };

  // drag to reorder (never starts from the name input)
  card.ondragstart = e => {
    if (e.target && e.target.tagName === 'INPUT') { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'move';
    smDragId = s.id; smDragEl = card;
    card.classList.add('dragging');
  };
  card.ondragover = e => {
    e.preventDefault();
    if (!smDragEl || smDragId === s.id) return;
    const r = card.getBoundingClientRect();
    const before = (e.clientY - r.top) < r.height / 2;
    card.parentNode.insertBefore(smDragEl, before ? card : card.nextSibling);
  };
  card.ondragend = () => {
    if (smDragEl) smDragEl.classList.remove('dragging');
    commitDragOrder();
    smDragId = null; smDragEl = null;
  };

  return card;
}

function toggleSelect(id) {
  if (smSelectedIds.has(id)) smSelectedIds.delete(id);
  else smSelectedIds.add(id);
  renderSceneManager();
}

function commitSceneName(s, input) {
  const v = (input.value || '').trim() || 'Untitled';
  s.name = v; input.value = v;
  if (currentScene && currentScene.id === s.id) currentScene.name = v;
  sceneStore.loadScene(s.id).then(sc => { if (sc) { sc.name = v; sceneStore.saveScene(sc); } });
  updateTriggerName();
}

function commitDragOrder() {
  const list = document.getElementById('sm-list');
  if (!list) return;
  const order = [...list.querySelectorAll('.sm-card')].map(el => el.dataset.id);
  allScenes.sort((a, b) => order.indexOf(String(a.id)) - order.indexOf(String(b.id)));
  allScenes.forEach((s, i) => { s.sortOrder = i; });
  persistSceneOrder();
}

function persistSceneOrder() {
  for (const s of allScenes) {
    sceneStore.loadScene(s.id).then(sc => {
      if (sc && sc.sortOrder !== s.sortOrder) { sc.sortOrder = s.sortOrder; sceneStore.saveScene(sc); }
    });
  }
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

  // normalizeRoomFields backfills `name` on scenes saved before rooms had names
  // (roomPanel.js). Both spreads are additive — a field whitelist here would drop cornerRadii.
  polygons      = normalizeRoomFields(scene.polygons || []).map(p => ({ ...p, vertices: p.vertices.map(v => ({ ...v })) }));
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
  // Selection was cleared above, so close the room card rather than leaving it floating
  // over the new scene with the previous scene's room in it.
  if (typeof resetRoomLabelCache === 'function') resetRoomLabelCache();
  if (typeof refreshRoomPanel === 'function') refreshRoomPanel();
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

// ── Delete with undo ──────────────────────────────────────────────────────────
// The card/bulk trash removes scenes from the list immediately but DEFERS the real
// IndexedDB deletion ~4s so Undo can cancel it. A new delete finalises the previous
// one; closing the app finalises via the beforeunload listener in initSceneManagerUI.
function deleteScenesWithUndo(ids) {
  const items = ids
    .map(id => ({ id, index: allScenes.findIndex(s => s.id === id), meta: allScenes.find(s => s.id === id) }))
    .filter(x => x.index !== -1 && x.meta)
    .sort((a, b) => a.index - b.index);
  if (!items.length) return;

  commitPendingDelete(); // finalise anything still pending from a previous delete

  const idset = new Set(items.map(x => x.id));
  allScenes = allScenes.filter(s => !idset.has(s.id));
  smSelectedIds.clear();

  // If the loaded scene was among those deleted, switch away (data stays in IDB
  // until the delete is committed, so Undo can still bring it back).
  if (currentScene && idset.has(currentScene.id)) handleCurrentDeleted();

  smPending = { items, ids: items.map(x => x.id) };
  showUndoToast(items.length === 1 ? `"${items[0].meta.name}" removed` : `${items.length} scenes removed`);
  clearTimeout(smUndoTimer);
  smUndoTimer = setTimeout(commitPendingDelete, 4200);
  renderSceneManager();
}

function handleCurrentDeleted() {
  currentScene = null;
  cleanupVideo();
  if (mapBitmap) { try { mapBitmap.close(); } catch (e) {} }
  mapBitmap = null; mapOffscreen = null; mapWidth = 0; mapHeight = 0;
  polygons = []; nextPolygonId = 1;
  selectedPolygonId = null; selectedVertexIndex = -1;
  if (typeof resetRoomLabelCache === 'function') resetRoomLabelCache();
  if (typeof refreshRoomPanel === 'function') refreshRoomPanel();
  landing.style.display = '';
  if (!isPlayer) container.style.cursor = 'default';
  localStorage.removeItem('evermist-current-scene-id');
  if (allScenes.length) switchScene(allScenes[0].id).catch(err => console.error('switchScene failed:', err));
}

function undoDelete() {
  if (!smPending) return;
  clearTimeout(smUndoTimer);
  for (const it of smPending.items) {
    allScenes.splice(Math.min(it.index, allScenes.length), 0, it.meta);
  }
  allScenes.forEach((s, i) => { s.sortOrder = i; });
  persistSceneOrder();
  smPending = null;
  hideUndoToast();
  renderSceneManager();
}

function commitPendingDelete() {
  if (!smPending) return;
  const ids = smPending.ids;
  smPending = null;
  clearTimeout(smUndoTimer);
  hideUndoToast();
  for (const id of ids) {
    sceneStore.deleteScene(id).catch(() => {});
    if (window.electronAPI) window.electronAPI.deleteVideoFile(id).catch(() => {});
    if (thumbURLs.has(id)) { URL.revokeObjectURL(thumbURLs.get(id)); thumbURLs.delete(id); }
  }
}

function showUndoToast(msg) {
  const t = document.getElementById('scene-undo-toast');
  if (!t) return;
  t.querySelector('.undo-msg').textContent = msg;
  t.style.display = '';
  const bar = t.querySelector('.undo-bar');
  bar.style.animation = 'none';
  void bar.offsetWidth; // reflow so the 4s timer bar restarts on each delete
  bar.style.animation = 'smUndoTimer 4s linear forwards';
}

function hideUndoToast() {
  const t = document.getElementById('scene-undo-toast');
  if (t) t.style.display = 'none';
}

if (typeof module !== 'undefined') module.exports = { escHtml };
