'use strict';
// DM-only UI control wiring: toolbar, tool/fog/grid sliders, fog color,
// anim presets, poly context panel, scene/backup modals, player controls,
// section toggles, UI-scale slider. Called once from index.html (DM mode only),
// at the same point the original inline block used to run.
function initToolbar() {
  const fileInput = document.getElementById('file-input');

  // Scene manager modal
  document.getElementById('btn-scenes').onclick = () => openSceneManager();
  document.getElementById('btn-backup-export').onclick = () => openExportModal();
  document.getElementById('btn-backup-restore').onclick = () => doRestore();
  document.getElementById('btn-sm-close').onclick = () => closeSceneManager();
  document.getElementById('scene-manager-backdrop').onclick = () => closeSceneManager();
  document.getElementById('btn-sm-new').onclick = () => { fileInput.click(); };
  fileInput.onchange = e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    createNewScene(f);
  };

  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && (f.type.startsWith('image/') || f.type.startsWith('video/') || /\.(jpe?g|png|gif|bmp|webp|svg|mp4|webm)$/i.test(f.name))) createNewScene(f);
  });

  document.getElementById('btn-reveal').onclick = function() {
    tool = 'reveal'; this.classList.add('active');
    document.getElementById('btn-shroud').classList.remove('active');
  };
  document.getElementById('btn-shroud').onclick = function() {
    tool = 'shroud'; this.classList.add('active');
    document.getElementById('btn-reveal').classList.remove('active');
  };
  document.getElementById('btn-brush').onclick  = () => setShape('brush');
  document.getElementById('btn-rect').onclick   = () => setShape('rect');
  document.getElementById('btn-poly').onclick   = () => setShape('poly');
  document.getElementById('btn-circle').onclick = () => setShape('circle');
  document.getElementById('btn-select').onclick = () => setShape('select');
  document.getElementById('btn-legend').onclick = () => toggleLegend();
  document.getElementById('btn-snap').onclick = function() {
    snapToGrid = !snapToGrid;
    this.classList.toggle('active', snapToGrid);
  };

  const brushSizeInput = document.getElementById('brush-size');
  const brushSizeLabel = document.getElementById('brush-size-label');
  brushSizeInput.oninput = e => {
    brushSize = parseInt(e.target.value);
    brushSizeLabel.textContent = brushSize;
  };

  document.getElementById('btn-fill-fog').onclick = () => {
    if (!fogDataCtx) return;
    pushUndo();
    activePolygon = null; selectedPolygonId = null;
    shroudAllFog();
    startFogTransition(true);
    rebuildFogEffect();
    fogDirty = true;
    scheduleRender();
    scheduleAutoSync();
  };
  document.getElementById('btn-clear-fog').onclick = () => {
    if (!fogDataCtx) return;
    pushUndo();
    activePolygon = null; selectedPolygonId = null;
    revealAllFog();
    startFogTransition(false);
    rebuildFogEffect();
    fogDirty = true;
    scheduleRender();
    scheduleAutoSync();
  };

  // Grid
  const gridBtn       = document.getElementById('btn-grid');
  const gridSizeInput = document.getElementById('grid-size');
  gridBtn.onclick = function(e) {
    e.stopPropagation();
    gridEnabled = !gridEnabled;
    this.classList.toggle('active', gridEnabled);
    scheduleAutoSync();
    gridDirty = true;
    scheduleRender();
  };
  document.getElementById('section-grid-hdr').addEventListener('click', function(e) {
    if (e.target.closest('#btn-grid')) return;
    document.getElementById('section-grid').classList.toggle('open');
  });
  gridSizeInput.oninput = e => {
    gridSize = parseInt(e.target.value);
    document.getElementById('grid-size-num').value = gridSize;
    if (gridEnabled) { gridDirty = true; scheduleRender(); }
    scheduleAutoSync();
  };
  document.getElementById('grid-size-num').oninput = e => {
    const v = Math.max(10, Math.min(400, parseInt(e.target.value) || 10));
    gridSize = v; gridSizeInput.value = v;
    if (gridEnabled) { gridDirty = true; scheduleRender(); }
    scheduleAutoSync();
  };
  document.getElementById('grid-offset-x').oninput = e => {
    gridOffsetX = parseInt(e.target.value);
    document.getElementById('grid-offset-x-num').value = gridOffsetX;
    if (gridEnabled) { gridDirty = true; scheduleRender(); }
    scheduleAutoSync();
  };
  document.getElementById('grid-offset-x-num').oninput = e => {
    const v = Math.max(0, Math.min(400, parseInt(e.target.value) || 0));
    gridOffsetX = v; document.getElementById('grid-offset-x').value = v;
    if (gridEnabled) { gridDirty = true; scheduleRender(); }
    scheduleAutoSync();
  };
  document.getElementById('grid-offset-y').oninput = e => {
    gridOffsetY = parseInt(e.target.value);
    document.getElementById('grid-offset-y-num').value = gridOffsetY;
    if (gridEnabled) { gridDirty = true; scheduleRender(); }
    scheduleAutoSync();
  };
  document.getElementById('grid-offset-y-num').oninput = e => {
    const v = Math.max(0, Math.min(400, parseInt(e.target.value) || 0));
    gridOffsetY = v; document.getElementById('grid-offset-y').value = v;
    if (gridEnabled) { gridDirty = true; scheduleRender(); }
    scheduleAutoSync();
  };
  (['sq', 'hflat', 'hptop']).forEach(m => {
    document.getElementById('btn-grid-' + m).onclick = () => {
      gridMode = m === 'sq' ? 'square' : m === 'hflat' ? 'hex-flat' : 'hex-pointy';
      document.querySelectorAll('.grid-mode-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('btn-grid-' + m).classList.add('active');
      if (gridEnabled) { gridDirty = true; scheduleRender(); }
      scheduleAutoSync();
    };
  });
  document.getElementById('grid-color').oninput = e => {
    gridColor = e.target.value;
    if (gridEnabled) { gridDirty = true; scheduleRender(); }
    scheduleAutoSync();
  };
  document.getElementById('grid-opacity').oninput = e => {
    gridOpacity = parseInt(e.target.value) / 100;
    document.getElementById('grid-opacity-num').value = e.target.value;
    if (gridEnabled) { gridDirty = true; scheduleRender(); }
    scheduleAutoSync();
  };
  document.getElementById('grid-opacity-num').oninput = e => {
    const v = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
    gridOpacity = v / 100; document.getElementById('grid-opacity').value = v;
    if (gridEnabled) { gridDirty = true; scheduleRender(); }
    scheduleAutoSync();
  };
  document.getElementById('grid-thickness').oninput = e => {
    gridLineWidth = parseInt(e.target.value);
    document.getElementById('grid-thickness-num').value = gridLineWidth;
    if (gridEnabled) { gridDirty = true; scheduleRender(); }
    scheduleAutoSync();
  };
  document.getElementById('grid-thickness-num').oninput = e => {
    const v = Math.max(1, Math.min(10, parseInt(e.target.value) || 1));
    gridLineWidth = v; document.getElementById('grid-thickness').value = v;
    if (gridEnabled) { gridDirty = true; scheduleRender(); }
    scheduleAutoSync();
  };
  document.getElementById('btn-grid-reset').onclick = () => {
    gridSize      = 70;
    gridOffsetX   = 0;
    gridOffsetY   = 0;
    gridColor     = '#ffffff';
    gridOpacity   = 0.25;
    gridMode      = 'square';
    gridLineWidth = 1;
    document.getElementById('grid-size').value          = 70;
    document.getElementById('grid-size-num').value      = 70;
    document.getElementById('grid-offset-x').value      = 0;
    document.getElementById('grid-offset-x-num').value  = 0;
    document.getElementById('grid-offset-y').value      = 0;
    document.getElementById('grid-offset-y-num').value  = 0;
    document.getElementById('grid-color').value         = '#ffffff';
    document.getElementById('grid-opacity').value       = 25;
    document.getElementById('grid-opacity-num').value   = 25;
    document.getElementById('grid-thickness').value     = 1;
    document.getElementById('grid-thickness-num').value = 1;
    document.querySelectorAll('.grid-mode-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('btn-grid-sq').classList.add('active');
    if (gridEnabled) { gridDirty = true; scheduleRender(); }
  };

  function setAutoSync(enabled) {
    autoSync = enabled;
    const btn = document.getElementById('btn-auto-sync');
    btn.classList.toggle('active', autoSync);
    btn.textContent = autoSync ? 'Auto' : 'Manual';
    localStorage.setItem('evermist-auto-sync', autoSync ? '1' : '0');
  }
  document.getElementById('btn-auto-sync').onclick = () => setAutoSync(!autoSync);
  setAutoSync(localStorage.getItem('evermist-auto-sync') !== '0');

  function toggleFogAnim() {
    fogAnimEnabled = !fogAnimEnabled;
    document.getElementById('btn-anim').classList.toggle('active', fogAnimEnabled);
    if (fogAnimEnabled) startFogAnim(); else stopFogAnim();
    syncAnimToPlayer();
  }
  document.getElementById('btn-anim').onclick = function(e) {
    e.stopPropagation();
    toggleFogAnim();
  };
  fogAnimEnabled = true;
  document.getElementById('btn-anim').classList.add('active');
  startFogAnim();

  // ─── Fog animation presets & advanced sliders ────────────────────────────
  const ANIM_PRESETS = {
    calm:    { speed: 40,  drift: 0.3,  morph: 0.12, warpStr: 0.08, warpRad: 0.05, pulse: 0.10 },
    default: { speed: 60,  drift: 0.5,  morph: 0.20, warpStr: 0.10, warpRad: 0.06, pulse: 0.15 },
    fast:    { speed: 100, drift: 1.0,  morph: 0.35, warpStr: 0.15, warpRad: 0.08, pulse: 0.30 },
  };
  let activePreset = 'default';

  function applyAnimPreset(name) {
    const p = ANIM_PRESETS[name];
    if (!p) return;
    activePreset = name;
    document.querySelectorAll('.anim-preset-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('anim-preset-' + name);
    if (btn) btn.classList.add('active');

    const warpChanged = cloudWarpStrength !== p.warpStr || cloudWarpRadius !== p.warpRad;

    fogAnimSpeed = p.speed / 100;
    driftScale = p.drift;
    cloudFrameSpeed = p.morph;
    cloudWarpStrength = p.warpStr;
    cloudWarpRadius = p.warpRad;
    alphaPulseAmp = p.pulse;

    updateAnimSliders();
    if (warpChanged) {
      regenCloudFrames();
    } else {
      syncAnimToPlayer();
    }

    if (!fogAnimEnabled) {
      fogAnimEnabled = true;
      document.getElementById('btn-anim').classList.add('active');
      startFogAnim();
    }
  }

  function clearPresetHighlight() {
    activePreset = null;
    document.querySelectorAll('.anim-preset-btn').forEach(b => b.classList.remove('active'));
  }

  // Wire preset buttons
  Object.keys(ANIM_PRESETS).forEach(name => {
    document.getElementById('anim-preset-' + name).onclick = () => applyAnimPreset(name);
  });

  // Advanced toggle
  document.getElementById('btn-anim-advanced').onclick = function() {
    const panel = document.getElementById('anim-advanced-panel');
    const showing = panel.style.display !== 'none';
    panel.style.display = showing ? 'none' : 'block';
    this.classList.toggle('active', !showing);
  };

  // Wire speed slider (linear, not log)
  function wireSpeedSlider() {
    const slider = document.getElementById('anim-speed');
    const num = document.getElementById('anim-speed-num');
    slider.oninput = function() {
      fogAnimSpeed = +this.value / 100;
      num.value = this.value;
      clearPresetHighlight();
      syncAnimToPlayer();
    };
    num.onchange = function() {
      const v = Math.max(0, Math.min(300, Math.round(+this.value)));
      this.value = v;
      slider.value = v;
      fogAnimSpeed = v / 100;
      clearPresetHighlight();
      syncAnimToPlayer();
    };
  }
  wireSpeedSlider();

  // Wire FPS cap slider (linear, video-only setting — not a fog-anim param)
  (function wireFpsSlider() {
    const slider = document.getElementById('video-fps');
    const num    = document.getElementById('video-fps-num');
    slider.oninput = function() {
      const v = Math.max(5, Math.min(60, +this.value));
      num.value = v;
      videoFrameIntervalMs = fpsToFrameInterval(v);
      syncAnimToPlayer();
    };
    num.onchange = function() {
      const v = Math.max(5, Math.min(60, Math.round(+this.value)));
      this.value = v;
      slider.value = v;
      videoFrameIntervalMs = fpsToFrameInterval(v);
      syncAnimToPlayer();
    };
  })();

  // Wire log-scale sliders with bidirectional numeric input
  function wireAnimSlider(sliderId, numId, baseVal, apply, isWarp) {
    const slider = document.getElementById(sliderId);
    const num = document.getElementById(numId);
    slider.oninput = function() {
      const v = animLogScale(+this.value, baseVal);
      num.value = v.toFixed(2);
      apply(v);
      clearPresetHighlight();
      if (!isWarp) syncAnimToPlayer();
    };
    num.onchange = function() {
      const v = Math.max(0, +this.value);
      this.value = v.toFixed(2);
      slider.value = Math.round(animSliderFromVal(v, baseVal));
      apply(v);
      clearPresetHighlight();
      if (isWarp) regenCloudFrames();
      else syncAnimToPlayer();
    };
    if (isWarp) slider.addEventListener('mouseup', regenCloudFrames);
  }

  wireAnimSlider('anim-drift', 'anim-drift-num', ANIM_DEFAULTS.drift, v => { driftScale = v; });
  wireAnimSlider('anim-morph-speed', 'anim-morph-num', ANIM_DEFAULTS.morphSpeed, v => { cloudFrameSpeed = v; });
  wireAnimSlider('anim-alpha-amp', 'anim-alpha-amp-num', ANIM_DEFAULTS.pulse, v => { alphaPulseAmp = v; });
  wireAnimSlider('anim-warp-str', 'anim-warp-num', ANIM_DEFAULTS.warpStr, v => { cloudWarpStrength = v; }, true);
  wireAnimSlider('anim-warp-rad', 'anim-warp-rad-num', ANIM_DEFAULTS.warpRad, v => { cloudWarpRadius = v; }, true);

  initFogControls();

  // Reset button — resets to current preset (or Default if none)
  document.getElementById('btn-anim-reset').onclick = function() {
    applyAnimPreset(activePreset || 'default');
  };

  document.getElementById('btn-fullscreen-player').onclick = () => {
    if (!playerWindow || playerWindow.closed) return;
    playerWindow.postMessage({ type: 'fullscreen' }, '*');
  };

  document.getElementById('btn-sync-view').onclick = () => {
    if (!playerWindow || playerWindow.closed) return;
    const { w: vpW, h: vpH } = getViewportSize();
    const v = {
      mapCX: (vpW / 2 - panX) / zoom,
      mapCY: (vpH / 2 - panY) / zoom,
      zoom,
    };
    playerWindow.postMessage({ type: 'view-snap', ...v }, '*');
    minimapSetView(v);
  };

  window.addEventListener('message', e => {
    if (!playerWindow || e.source !== playerWindow) return;
    const msg = e.data;
    if (!msg) return;
    if (msg.type === 'PLAYER_READY' || msg.type === 'need-map') {
      if (msg.screenW && msg.screenH) {
        playerScreenW = msg.screenW;
        playerScreenH = msg.screenH;
        minimapRefreshAspect();
      }
      onPlayerResyncRequest();
      syncAnimToPlayer(true);
      if (playerWindow && !playerWindow.closed) {
        playerWindow.postMessage({ type: 'player-lock', locked: minimapLocked }, '*');
      }
      return;
    }
    if (msg.type === 'PLAYER_SCREEN') {
      if (msg.screenW && msg.screenH) {
        playerScreenW = msg.screenW;
        playerScreenH = msg.screenH;
        minimapRefreshAspect();
      }
      return;
    }
    if (msg.type === 'PLAYER_MODE') {
      playerFollowMode = msg.mode === 'follow';
      updatePlayerModeIndicator();
      if (msg.mode === 'freelook' && msg.mapCX != null) {
        minimapSyncFromPlayer(msg);
      }
      return;
    }
    if (msg.type === 'PLAYER_VIEW') {
      minimapSyncFromPlayer(msg);
    }
  });

  document.getElementById('btn-player').onclick = () => {
    const sp = new URLSearchParams(window.location.search);
    const stress = sp.get('stress') === '1';
    const stressMs = sp.get('stressMs');
    let url = window.location.href.split('?')[0] + '?mode=player';
    if (stress) url += '&stress=1';
    if (stressMs) url += '&stressMs=' + encodeURIComponent(stressMs);
    playerWindow = window.open(url, 'evermist-player', 'toolbar=no,menubar=no,scrollbars=no');
  };

  document.getElementById('btn-send').onclick = sendToPlayer;

  // Section expand/collapse
  document.getElementById('fog-section-hdr').addEventListener('click', function(e) {
    if (e.target.closest('#btn-anim')) return;
    document.getElementById('section-fog').classList.toggle('open');
  });
  // Polygon context panel
  document.getElementById('poly-ctx-reveal').onclick = () => {
    const poly = polygons.find(p => p.id === selectedPolygonId);
    if (poly && poly.mode !== 'reveal') toggleSelectedPolygon();
  };
  document.getElementById('poly-ctx-shroud').onclick = () => {
    const poly = polygons.find(p => p.id === selectedPolygonId);
    if (poly && poly.mode !== 'shroud') toggleSelectedPolygon();
  };
  document.getElementById('poly-ctx-delete').onclick = () => {
    if (selectedPolygonId != null) deleteSelectedPolygon();
  };
  document.getElementById('poly-ctx-rmode').onclick = () => {
    const poly = polygons.find(p => p.id === selectedPolygonId);
    if (!poly) return;
    if (polyCtxRadiusMode === 'all') {
      polyCtxRadiusMode = 'vertex';
      if (!poly.cornerRadii) poly.cornerRadii = new Array(poly.vertices.length).fill(null);
    } else {
      polyCtxRadiusMode = 'all';
    }
    drawCursor(lastScreenX, lastScreenY);
  };
  document.getElementById('poly-ctx-del-vertex').onclick = () => {
    const poly = polygons.find(p => p.id === selectedPolygonId);
    if (!poly || selectedVertexIndex < 0 || poly.vertices.length <= 3) return;
    pushUndo();
    poly.vertices.splice(selectedVertexIndex, 1);
    if (poly.cornerRadii) poly.cornerRadii.splice(selectedVertexIndex, 1);
    selectedVertexIndex = -1;
    rebuildFogFromPolygons();
    startFogTransition();
    rebuildFogEffect();
    fogDirty = true;
    scheduleRender();
    scheduleAutoSync();
    drawCursor(lastScreenX, lastScreenY);
  };
  (() => {
    let radiusUndoPushed = false;
    const radiusInput = document.getElementById('poly-ctx-radius');
    const radiusVal   = document.getElementById('poly-ctx-radius-val');
    radiusInput.addEventListener('mousedown', () => { radiusUndoPushed = false; });
    radiusInput.oninput = function() {
      const poly = polygons.find(p => p.id === selectedPolygonId);
      if (!poly) return;
      if (!radiusUndoPushed) { pushUndo(); radiusUndoPushed = true; }
      const val = parseInt(this.value);
      radiusVal.textContent = val;
      if (polyCtxRadiusMode === 'vertex' && selectedVertexIndex >= 0 && poly.cornerRadii) {
        poly.cornerRadii[selectedVertexIndex] = val;
      } else {
        poly.cornerRadius = val;
      }
      rebuildFogFromPolygons();
      rebuildFogEffect();
      fogDirty = true;
      scheduleRender();
      drawCursor(lastScreenX, lastScreenY);
    };
    radiusInput.addEventListener('change', () => { radiusUndoPushed = false; scheduleAutoSync(); });
  })();

  updateContextPanels(); // init: brush is default tool, show panel immediately

  // UI scale slider — persists to localStorage
  (function() {
    const slider = document.getElementById('ui-scale');
    const apply  = v => document.documentElement.style.setProperty('--ui-zoom', v / 100);
    const saved  = localStorage.getItem('evermist-ui-zoom');
    if (saved) { slider.value = saved; apply(saved); }
    slider.oninput  = () => apply(slider.value);
    slider.onchange = () => localStorage.setItem('evermist-ui-zoom', slider.value);
  })();
}
