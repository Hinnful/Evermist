'use strict';

// memProbe.js — memory-footprint probe. Activated ONLY when ?memprobe=1 is present
// (injected by main.js under `npm run memprobe`). Inert under plain `npm start` and in
// the shipped .exe.
//
// The question it answers: what does ONE large map cost at rest? Not a leak hunt — the
// symptom is instant and static, so there is no soak here and no trend tracking.
//
// Why the readings are shaped this way:
//   • performance.memory is the JS HEAP ONLY. Canvas backing stores, GPU textures and
//     the video decoder are native allocations outside it, which is essentially all of
//     this app's footprint. It is recorded as a footnote, never as the answer.
//   • app.getAppMetrics() in the main process gives per-process workingSetSize — the
//     number Task Manager shows, so it is the one a user's report can be checked against.
//   • The canvas inventory is self-accounting: walk the known references, sum w×h×4. It
//     is deterministic, so it is what a predicted budget reconciles against.
//
// Cross-run comparison on this machine is worthless (DECISIONS.md). Every figure worth
// trusting comes from two samples inside ONE run with the state changed in between, which
// is why the sequencer below does everything in a single instance.

var _mpActive     = false;
var _mpSampleNum  = 0;
var _mpNoFlush    = false;   // stub pixiFlushTexturePool() — minimize suspect 1
var _mpNoSave     = false;   // stub doAutoSave()           — minimize suspect 2

function initMemProbe() {
  var sp = new URLSearchParams(window.location.search);
  if (sp.get('memprobe') !== '1') return;
  _mpActive  = true;
  _mpNoFlush = sp.get('memprobeNoFlush') === '1';
  _mpNoSave  = sp.get('memprobeNoSave')  === '1';

  // Route through the existing diag surface — overlay plus the disk log via the
  // diag-append-line IPC. No second debug surface.
  if (typeof _diagToggle === 'function' && typeof _diagActive !== 'undefined' && !_diagActive) {
    _diagToggle();
  }

  _mpLog('memprobe: init mode=' + (isPlayer ? 'player' : 'dm') +
    ' noFlush=' + _mpNoFlush + ' noSave=' + _mpNoSave);

  _mpApplyStubs();

  if (isPlayer) {
    // The Player is driven entirely by the DM's postMessages, so it has no sequence of
    // its own. It samples on a slow tick; the DM's log carries the ordering.
    _mpSample('player-idle');
    setInterval(function() { _mpSample('player-tick'); }, 20000);
    return;
  }

  _mpRunSequence();
}

// ── Stub levers ───────────────────────────────────────────────────────────────
// Both minimize suspects are called from the inline blob's window-visibility handler,
// which resolves them by name at call time. Replacing the global here is therefore
// enough — no wiring change in index.html.
function _mpApplyStubs() {
  if (_mpNoFlush && typeof pixiFlushTexturePool === 'function') {
    var _realFlush = pixiFlushTexturePool;
    window.pixiFlushTexturePool = function() { _mpLog('memprobe: pixiFlushTexturePool STUBBED'); };
    pixiFlushTexturePool = window.pixiFlushTexturePool;
    void _realFlush;
  }
  if (_mpNoSave && typeof doAutoSave === 'function') {
    var _realSave = doAutoSave;
    window.doAutoSave = function() { _mpLog('memprobe: doAutoSave STUBBED'); };
    doAutoSave = window.doAutoSave;
    void _realSave;
  }
}

function _mpLog(msg) {
  if (typeof _diagAppend === 'function') _diagAppend(msg);
  else if (window.console) console.log(msg);
}

function _mpSleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

// ── Canvas inventory ──────────────────────────────────────────────────────────
// Every long-lived canvas this renderer holds. Bytes are w×h×4: Chromium's 2D backing
// store is RGBA8 regardless of what was drawn into it.

function _mpCanvasInventory() {
  var items = [];
  function add(label, c) {
    if (!c || !c.width || !c.height) return;
    items.push({ label: label, w: c.width, h: c.height, bytes: c.width * c.height * 4 });
  }

  // Map masters and the GPU-texture source.
  add('mapOffscreen', typeof mapOffscreen !== 'undefined' ? mapOffscreen : null);
  add('playerMapTexCanvas', typeof playerMapTexCanvas !== 'undefined' ? playerMapTexCanvas : null);

  // Fog pipeline, all at 1/FOG_SCALE.
  add('fogDataCanvas',       typeof fogDataCanvas       !== 'undefined' ? fogDataCanvas       : null);
  add('baseFogCanvas',       typeof baseFogCanvas       !== 'undefined' ? baseFogCanvas       : null);
  add('fogBlurCanvas',       typeof fogBlurCanvas       !== 'undefined' ? fogBlurCanvas       : null);
  add('fogEffectCanvas',     typeof fogEffectCanvas     !== 'undefined' ? fogEffectCanvas     : null);
  add('fogTransBlendCanvas', typeof fogTransBlendCanvas !== 'undefined' ? fogTransBlendCanvas : null);
  add('fogTransPrev',        typeof fogTransPrev        !== 'undefined' ? fogTransPrev        : null);
  add('fogTransBlurPrev',    typeof fogTransBlurPrev    !== 'undefined' ? fogTransBlurPrev    : null);
  add('_fogScratch',         typeof _fogScratch         !== 'undefined' ? _fogScratch         : null);

  // Cloud texture set — 16 frames plus the blend target.
  if (typeof cloudFrames !== 'undefined' && cloudFrames && cloudFrames.length) {
    var cf = cloudFrames[0];
    items.push({
      label: 'cloudFrames×' + cloudFrames.length,
      w: cf.width, h: cf.height,
      bytes: cloudFrames.length * cf.width * cf.height * 4,
    });
  }
  add('cloudBlendCanvas', typeof cloudBlendCanvas !== 'undefined' ? cloudBlendCanvas : null);

  // Viewport-sized DOM canvases. Small next to the map, but they scale with the TV.
  ['map-canvas', 'fog-canvas', 'grid-canvas', 'cursor-canvas', 'minimap-canvas', 'pixi-canvas']
    .forEach(function(id) { add('#' + id, document.getElementById(id)); });

  return items;
}

// ── Undo/redo accounting ──────────────────────────────────────────────────────
// UNDO_MAX_BYTES is one budget across both stacks. They are still counted separately, so
// a regression that caps only one of them shows up as a split rather than hiding in a sum.

function _mpUndoBytes() {
  function sum(stack) {
    if (typeof stack === 'undefined' || !stack) return { n: 0, bytes: 0 };
    var b = 0;
    for (var i = 0; i < stack.length; i++) {
      var f = stack[i].baseFog;
      if (f) b += f.width * f.height * 4;
    }
    return { n: stack.length, bytes: b };
  }
  return {
    undo: sum(typeof undoStack !== 'undefined' ? undoStack : null),
    redo: sum(typeof redoStack !== 'undefined' ? redoStack : null),
  };
}

// ── PixiJS texture accounting ─────────────────────────────────────────────────
// Walks the BaseTextures this app creates by name rather than the global cache, so the
// numbers map onto the budget table line for line. Deduped by uid: the mask sprite shares
// the blur texture, and counting it twice would invent 13 MB that does not exist.

function _mpPixiTextures() {
  var seen = {}, items = [], total = 0;
  function add(label, bt) {
    if (!bt || !bt.width || !bt.height) return;
    var uid = bt.uid != null ? bt.uid : label;
    if (seen[uid]) { items.push({ label: label, shares: seen[uid] }); return; }
    seen[uid] = label;
    var bytes = bt.width * bt.height * 4;
    total += bytes;
    items.push({ label: label, w: bt.width, h: bt.height, bytes: bytes });
  }

  if (typeof pixiMapTexture !== 'undefined' && pixiMapTexture) add('map', pixiMapTexture.baseTexture);
  if (typeof pixiFogBlurBT  !== 'undefined') add('fogBlur',  pixiFogBlurBT);
  if (typeof pixiFogDataBT  !== 'undefined') add('fogData',  pixiFogDataBT);
  if (typeof pixiFogCloudBT !== 'undefined') add('fogCloud', pixiFogCloudBT);
  if (typeof pixiFogTransBT !== 'undefined') add('fogTrans', pixiFogTransBT);

  // The renderer's RenderTexture pool — the sprite mask allocates here, and it is what
  // pixiFlushTexturePool() releases on minimize.
  var pool = { count: 0, bytes: 0 };
  try {
    var tp = pixiApp && pixiApp.renderer && pixiApp.renderer.texturePool;
    var map = tp && (tp.texturePool || tp._texturePool);
    if (map) {
      Object.keys(map).forEach(function(k) {
        var arr = map[k];
        if (!arr || !arr.length) return;
        for (var i = 0; i < arr.length; i++) {
          var t = arr[i];
          if (t && t.width && t.height) { pool.count++; pool.bytes += t.width * t.height * 4; }
        }
      });
    }
  } catch (_) {}

  return { items: items, total: total, pool: pool };
}

// ── Context fields ────────────────────────────────────────────────────────────
// A figure without these is not comparable to another figure: the texture size is
// display-dependent, and opening the Player re-textures mid-run.

function _mpContext() {
  var di = (typeof displayInfo !== 'undefined' && displayInfo) ? displayInfo : null;
  var texW = 0, texH = 0;
  if (typeof pixiMapTexture !== 'undefined' && pixiMapTexture && pixiMapTexture.baseTexture) {
    texW = pixiMapTexture.baseTexture.width;
    texH = pixiMapTexture.baseTexture.height;
  }
  return {
    mode:     (typeof isPlayer !== 'undefined' && isPlayer) ? 'player' : 'dm',
    scene:    (typeof currentScene !== 'undefined' && currentScene) ? (currentScene.name || currentScene.id) : '—',
    mapType:  (typeof mapVideo !== 'undefined' && mapVideo) ? 'video' : 'image',
    mapW:     typeof mapWidth  !== 'undefined' ? mapWidth  : 0,
    mapH:     typeof mapHeight !== 'undefined' ? mapHeight : 0,
    display:  di ? (di.w + 'x' + di.h + '@' + di.scaleFactor + 'x') : 'null',
    maxTex:   (typeof pixiGetMaxTexSize === 'function') ? pixiGetMaxTexSize() : 0,
    texture:  texW ? (texW + 'x' + texH) : 'none',
    // Recorded as a FIELD, never as a gate. A hidden renderer's working set does not read
    // zero, and gating here would block the very sample the minimize test needs.
    hidden:   document.hidden,
    polygons: (typeof polygons !== 'undefined' && polygons) ? polygons.length : 0,
    zoom:     (typeof zoom !== 'undefined') ? Number(zoom).toFixed(3) : '—',
  };
}

// ── One sample ────────────────────────────────────────────────────────────────

function _mpSample(label) {
  if (!_mpActive) return Promise.resolve(null);
  var n = ++_mpSampleNum;
  var ctx  = _mpContext();
  var inv  = _mpCanvasInventory();
  var pix  = _mpPixiTextures();
  var un   = _mpUndoBytes();
  var canvasTotal = inv.reduce(function(s, i) { return s + i.bytes; }, 0);

  function mb(b) { return (b / 1048576).toFixed(1); }

  var head = 'MEMPROBE#' + n + ' [' + label + '] ' + ctx.mode +
    ' scene="' + ctx.scene + '" ' + ctx.mapType + ' ' + ctx.mapW + 'x' + ctx.mapH +
    ' disp=' + ctx.display + ' maxTex=' + ctx.maxTex + ' tex=' + ctx.texture +
    ' hidden=' + ctx.hidden + ' polys=' + ctx.polygons + ' zoom=' + ctx.zoom;
  _mpLog(head);

  inv.forEach(function(i) {
    _mpLog('  canvas ' + i.label + ' ' + i.w + 'x' + i.h + ' = ' + mb(i.bytes) + 'MB');
  });
  _mpLog('  canvasTotal = ' + mb(canvasTotal) + 'MB');

  pix.items.forEach(function(i) {
    _mpLog('  gputex ' + i.label + (i.shares
      ? ' (shares ' + i.shares + ')'
      : ' ' + i.w + 'x' + i.h + ' = ' + mb(i.bytes) + 'MB'));
  });
  _mpLog('  gputexTotal = ' + mb(pix.total) + 'MB  pool=' + pix.pool.count +
    ' rt = ' + mb(pix.pool.bytes) + 'MB');

  _mpLog('  undo n=' + un.undo.n + ' ' + mb(un.undo.bytes) + 'MB  redo n=' +
    un.redo.n + ' ' + mb(un.redo.bytes) + 'MB');

  // JS heap last and labelled, so it is never mistaken for the footprint.
  if (performance && performance.memory) {
    _mpLog('  jsHeap(ONLY-HEAP) = ' + mb(performance.memory.usedJSHeapSize) + 'MB');
  }

  if (!window.electronAPI || !window.electronAPI.memMetrics) {
    _mpLog('  workingSet: unavailable (no electronAPI)');
    return Promise.resolve(null);
  }
  return window.electronAPI.memMetrics().then(function(rows) {
    var sum = 0;
    rows.forEach(function(r) {
      sum += r.workingSetKB;
      _mpLog('  ws ' + r.type + (r.name ? '/' + r.name : '') + ' pid=' + r.pid +
        ' = ' + (r.workingSetKB / 1024).toFixed(1) + 'MB (peak ' +
        (r.peakWorkingSetKB / 1024).toFixed(1) + 'MB)');
    });
    _mpLog('  wsTOTAL = ' + (sum / 1024).toFixed(1) + 'MB across ' + rows.length + ' processes');
    _mpLog('MEMPROBE#' + n + ' end');
    return sum;
  }).catch(function(e) {
    _mpLog('  workingSet: failed ' + e);
    return null;
  });
}

// ── Self-sequencing run ───────────────────────────────────────────────────────
// There is no human at the keyboard: no remote-debugging port, no menu. The actions are
// the ones stress.js already drives — switchScene, open the Player, toggle a polygon
// through the Select-tool path — run at fast pace rather than table pace. The pace is the
// only difference; this is not a soak.

async function _mpRunSequence() {
  await _mpSleep(3000);              // let init settle
  await _mpSample('01-idle-startup');

  var metas = [];
  try { metas = await sceneStore.listScenes(); } catch (_) {}

  // Largest of each kind, by stored pixel area where the metadata carries it, else by
  // stored blob size. Falls back to first-of-kind so a thin metadata record still runs.
  function pick(type) {
    var best = null, bestScore = -1;
    for (var i = 0; i < metas.length; i++) {
      var m = metas[i];
      var isVideo = m.mapType === 'video';
      if ((type === 'video') !== isVideo) continue;
      var score = (m.mapWidth && m.mapHeight) ? m.mapWidth * m.mapHeight : (m.mapSize || 0);
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return best;
  }

  var img = pick('image');
  var vid = pick('video');
  _mpLog('memprobe: scenes=' + metas.length +
    ' largestImage=' + (img ? '"' + img.name + '"' : 'none') +
    ' largestVideo=' + (vid ? '"' + vid.name + '"' : 'none'));

  if (img) {
    _mpLog('memprobe: switching to image scene "' + img.name + '"');
    await switchScene(img.id);
    await _mpSleep(4000);
    await _mpSample('02-image-loaded-dm-only');
  }

  // Opening the Player re-textures the DM mid-run (onDisplayInfoUpdated). Samples either
  // side of this line are under DIFFERENT texture sizes — do not average across it.
  _mpLog('memprobe: opening Player');
  document.getElementById('btn-player').click();
  await _mpSleep(9000);
  await _mpSample('03-image-player-open');

  // Reveals: the Select-tool path, same call the DM makes at the table.
  if (typeof polygons !== 'undefined' && polygons.length && typeof toggleSelectedPolygon === 'function') {
    for (var r = 0; r < 4; r++) {
      selectedPolygonId = polygons[r % polygons.length].id;
      toggleSelectedPolygon();
      await _mpSleep(2500);
    }
    await _mpSample('04-image-after-4-reveals');
  } else {
    _mpLog('memprobe: no polygons in image scene — skipping reveals');
  }

  if (vid) {
    _mpLog('memprobe: switching to video scene "' + vid.name + '"');
    await switchScene(vid.id);
    await _mpSleep(12000);
    await _mpSample('05-video-loaded-both-windows');

    if (typeof polygons !== 'undefined' && polygons.length && typeof toggleSelectedPolygon === 'function') {
      for (var v = 0; v < 4; v++) {
        selectedPolygonId = polygons[v % polygons.length].id;
        toggleSelectedPolygon();
        await _mpSleep(2500);
      }
      await _mpSample('06-video-after-4-reveals');
    }
  }

  await _mpRunVideoBranch();
  await _mpRunMinimizeBranch();
}

// ── Video branch ──────────────────────────────────────────────────────────────
// Animated maps are the ones that get played, so they have to be measured even when no
// scene record points at a video file. This drives the same load switchScene does — a
// <video> streaming from a file:// URL, never an in-memory copy of the clip — against the
// largest map on disk.
//
// It writes NOTHING to IndexedDB. currentScene is set in memory only, so sendToPlayer can
// take its video branch, and doAutoSave is stubbed for the duration so that in-memory
// record can never reach the store.
async function _mpRunVideoBranch() {
  if (!window.electronAPI || !window.electronAPI.listMapFiles) {
    _mpLog('memprobe: no listMapFiles — skipping video branch');
    return;
  }
  var files = await window.electronAPI.listMapFiles();
  if (!files || !files.length) { _mpLog('memprobe: no video maps on disk'); return; }
  // Largest by default. ?memprobeSmall=1 picks the smallest instead, so a before/after
  // comparison can be run without tying the machine up on the 12900×11700 test map.
  files.sort(function(a, b) { return b.size - a.size; });
  var pick = (new URLSearchParams(window.location.search).get('memprobeSmall') === '1')
    ? files[files.length - 1] : files[0];
  _mpLog('memprobe: video maps on disk=' + files.length +
    ' largest=' + pick.id + '.' + pick.ext + ' ' + (pick.size / 1048576).toFixed(1) + 'MB');

  var _savedAutoSave = (typeof doAutoSave === 'function') ? doAutoSave : null;
  window.doAutoSave = function() {};
  doAutoSave = window.doAutoSave;

  try {
    var absPath = await window.electronAPI.getVideoFilePath(pick.id);
    if (!absPath) { _mpLog('memprobe: getVideoFilePath returned nothing'); return; }

    cleanupVideo();
    stopFogTransition();
    mapVideoUrl = 'file:///' + absPath.replace(/\\/g, '/');

    var video = document.createElement('video');
    video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'auto';
    video.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;pointer-events:none;';
    document.body.appendChild(video);

    var ok = await new Promise(function(resolve) {
      var settled = false;
      video.onerror   = function() { if (!settled) { settled = true; resolve(false); } };
      video.oncanplay = function() { if (!settled) { settled = true; resolve(true);  } };
      setTimeout(function() { if (!settled) { settled = true; resolve(false); } }, 30000);
      video.src = mapVideoUrl;
    });
    if (!ok) {
      _mpLog('memprobe: video failed to load');
      video.pause(); video.src = '';
      if (video.parentNode) video.parentNode.removeChild(video);
      return;
    }

    await new Promise(function(resolve) {
      video.onseeked = function() { video.onseeked = null; resolve(); };
      video.currentTime = 0.001;
      setTimeout(function() { if (video.onseeked) { video.onseeked = null; resolve(); } }, 4000);
    });

    mapWidth = video.videoWidth; mapHeight = video.videoHeight;
    var extract = document.createElement('canvas');
    extract.width = mapWidth; extract.height = mapHeight;
    extract.getContext('2d').drawImage(video, 0, 0, mapWidth, mapHeight);
    if (mapBitmap) { mapBitmap.close(); mapBitmap = null; }
    mapOffscreen = extract;
    pixiSetMap(prepareTextureCanvas(extract, mapWidth, mapHeight), mapWidth, mapHeight);
    pixiHideMap();
    mapVideo = video;
    attachVideoListeners(video);

    fogDataCanvas = document.createElement('canvas');
    fogDataCanvas.width  = Math.ceil(mapWidth  / FOG_SCALE);
    fogDataCanvas.height = Math.ceil(mapHeight / FOG_SCALE);
    fogDataCtx = fogDataCanvas.getContext('2d');
    fogDataCtx.fillStyle = '#1a1a2e';
    fogDataCtx.fillRect(0, 0, fogDataCanvas.width, fogDataCanvas.height);
    baseFogCanvas = document.createElement('canvas');
    baseFogCanvas.width  = fogDataCanvas.width;
    baseFogCanvas.height = fogDataCanvas.height;
    baseFogCtx = baseFogCanvas.getContext('2d');
    baseFogCtx.fillStyle = '#1a1a2e';
    baseFogCtx.fillRect(0, 0, baseFogCanvas.width, baseFogCanvas.height);

    polygons = []; activePolygon = null; selectedPolygonId = null; nextPolygonId = 1;
    playerMapSent = false;
    rebuildFogEffect();
    pixiInitFog(fogDataCanvas, fogBlurCanvas, cloudBlendCanvas, mapWidth, mapHeight);
    pixiFlushTexturePool();
    pixiUpdateFogBlurTexture();
    fitToScreen();
    viewportDirty = true; fogDirty = true;
    scheduleRender();
    await video.play().then(function() { startVideoLoop(); }).catch(function() {});

    await _mpSleep(10000);
    await _mpSample('10-video-dm-playing');

    // In-memory only — never saved. Gives sendToPlayer its file:// video branch, which is
    // what the Player uses at the table.
    currentScene = { id: pick.id, name: 'memprobe-video', mapPath: 'maps/' + pick.id + '.' + pick.ext, mapType: 'video' };
    sendToPlayer();
    await _mpSleep(15000);
    await _mpSample('11-video-both-windows');

    // Reveals on the video path. The scene carries no saved rooms, so draw two the way the
    // Rectangle tool does, then toggle them through the Select tool's own call.
    _mpAddRect(mapWidth * 0.10, mapHeight * 0.10, mapWidth * 0.40, mapHeight * 0.45);
    _mpAddRect(mapWidth * 0.55, mapHeight * 0.50, mapWidth * 0.85, mapHeight * 0.90);
    for (var i = 0; i < 4 && polygons.length; i++) {
      selectedPolygonId = polygons[i % polygons.length].id;
      toggleSelectedPolygon();
      await _mpSleep(3000);
    }
    await _mpSample('12-video-after-reveals');

    currentScene = null;
  } catch (e) {
    _mpLog('memprobe: video branch failed ' + e);
  } finally {
    if (_savedAutoSave) { window.doAutoSave = _savedAutoSave; doAutoSave = _savedAutoSave; }
  }
}

// Mirrors the shape the Rectangle tool commits (tools.js), minus the undo push and the
// cursor redraw — the probe wants the room, not the gesture.
function _mpAddRect(x1, y1, x2, y2) {
  var pid = nextPolygonId++;
  polygons.push({
    id: pid,
    vertices: [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }],
    mode: 'shroud',
    cornerRadius: 0,
    name: 'memprobe ' + pid,
  });
}

// ── Minimize ──────────────────────────────────────────────────────────────────
async function _mpRunMinimizeBranch() {
  // The window-visibility IPC is what actually fires on Windows OS-minimize;
  // visibilitychange does not. Nothing in the page can minimize its own OS window, so
  // this fires the same renderer path the IPC does and logs it as such. The OS-level
  // working-set movement is measured separately, by hand, against these figures.
  _mpLog('memprobe: minimize simulation — invoking the same renderer path the IPC drives');
  await _mpSample('07-before-minimize');

  if (typeof doAutoSave === 'function') doAutoSave();
  // Ticker pause only. The texture-pool flush that used to sit here was removed from the
  // real handler once the pool measured empty in every sample; simulating a call the app
  // no longer makes would make this branch measure the wrong thing.
  if (typeof pixiApp !== 'undefined' && pixiApp) pixiApp.ticker.stop();
  await _mpSleep(4000);
  await _mpSample('08-while-minimized');

  if (typeof pixiApp !== 'undefined' && pixiApp) pixiApp.ticker.start();
  viewportDirty = true;
  if (typeof scheduleRender === 'function') scheduleRender();
  await _mpSleep(4000);
  await _mpSample('09-after-restore');

  _mpLog('memprobe: SEQUENCE COMPLETE — window is now usable; minimize by hand to compare');
}
