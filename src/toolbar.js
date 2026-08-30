'use strict';
// DM-only UI control wiring: toolbar, sliders, fog colour, anim presets, the poly context panel,
// the scene and backup modals, player controls and the UI-scale slider. Called once from
// index.html in DM mode.
// ─── Fog paint direction ──────────────────────────────────────────────────────
// The fog-mode segment is pick-exactly-one, so ONE helper owns both `tool` and the highlight.
function setPaintDirection(dir) {
  tool = dir;
  ['reveal', 'half', 'shroud'].forEach(d => {
    const el = document.getElementById('btn-' + d);
    if (el) el.classList.toggle('active', d === dir);
  });
}

// Half is shape-tools only: the brush paints into a cleared-or-opaque fog canvas with no third
// value. While the brush is picked the button is disabled and a live half direction falls back to
// shroud, because more fog is the safer accident.
function refreshHalfAvailability() {
  const btn = document.getElementById('btn-half');
  if (!btn) return;
  const brushPicked = shape === 'brush';
  btn.disabled = brushPicked;
  if (brushPicked && tool === 'half') setPaintDirection('shroud');
}

// ─── Placement mode ───────────────────────────────────────────────────────────
// Which array the next rectangle or circle lands in. Like setPaintDirection, ONE helper owns both
// the value and the highlight.
function setPlaceMode(m) {
  if (placeMode !== m) {
    // ⚠ THE SELECTION IS SCOPED TO THE MODE. Ids are numbered per list, so one left over from the
    // other list resolves against whichever shape shares the number.
    selectedPolygonId = null;
    selectedVertexIndex = -1;
    activePolygon = null;
  }
  placeMode = m;
  ['rooms', 'effects'].forEach(k => {
    const el = document.getElementById('btn-place-' + k);
    if (el) el.classList.toggle('active', k === m);
  });
  // The BRUSH is the only tool with no meaning here: it paints fog into the stencil, and an effect
  // has none. ⚠ Never widen this to "anything but rect and circle": that kicks the DM off Select
  // on every mode change, and Select is the tool this app is used with.
  if (m === 'effects' && shape === 'brush') setShape('rect');
  refreshBrushAvailability();
  // The row above the bar is mode-driven too: the fog trio belongs to rooms, the material
  // picker and corner radius to effects.
  updateContextPanels();
  drawCursor(lastScreenX, lastScreenY);   // the shape preview takes the mode's colour
}

// Like refreshHalfAvailability: a control that can do nothing here is greyed rather than left live
// and silently ignored.
function refreshBrushAvailability() {
  const btn = document.getElementById('btn-brush');
  if (btn) btn.disabled = placeMode === 'effects';
  // Doors belong to rooms, so the tool has nothing to act on in Effects mode.
  const door = document.getElementById('btn-door');
  if (door) door.disabled = placeMode === 'effects';
}

// ─── Materials ────────────────────────────────────────────────────────────────
// What the next effect is made of. Pick-exactly-one like the fog trio, so ONE helper owns both the
// value and the highlight.
//
// Picking a material with an effect SELECTED changes that effect, which is the only way to restyle
// one. The write is the full edit path — undo, repaint, push, save — because it is a real edit to
// a stored shape, not a toolbar preference.
//
// Reads the row's markup, so a new material is one button in index.html plus one EFFECT_MATERIALS
// entry and nothing here.
//
// ⚠ The button carries a PLAIN SVG GLYPH like every other button on this bar. A painted swatch of
// the real material draws a box inside the button's selected box inside the row's pill.
function initMaterialPicker() {
  document.querySelectorAll('#material-row [data-material]').forEach(btn => {
    btn.onclick = () => setMaterial(btn.dataset.material);
  });
  setMaterial(currentMaterial);   // the highlight starts where the value does
}

function setMaterial(m) {
  if (isPlayer || !EFFECT_MATERIALS[m]) return;
  currentMaterial = m;
  document.querySelectorAll('#material-row [data-material]').forEach(b =>
    b.classList.toggle('active', b.dataset.material === m));

  if (placeMode !== 'effects' || selectedPolygonId == null) return;
  const e = effects.find(x => x.id === selectedPolygonId);
  if (!e || e.material === m) return;
  pushUndo();
  e.material = m;
  effectsChanged();
  scheduleAutoSync();   // rides the Auto/Manual gate exactly as a fog edit does
  scheduleAutoSave();
}

function initToolbar() {
  // Scene manager UI (dropdown, drag-reorder, bulk ops, undo, "+" = new/import)
  // is wired in sceneManager.js — it owns the scene concern.
  initSceneManagerUI();

  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files || []);
    if (!dropped.length) return;
    // A floor plan dropped ON ITS OWN attaches to the open scene, for the case where it got
    // separated from its map. Nothing to attach it to means nothing happens.
    const plans = dropped.filter(f => /\.dd2vtt$/i.test(f.name));
    const maps  = dropped.filter(f => !/\.dd2vtt$/i.test(f.name));
    if (plans.length && !maps.length) {
      plans[0].text().then(text => attachPlanText(text).then(ok => { if (ok) offerStoredFloorPlan(); }))
        .catch(() => {});
      return;
    }
    // A plan dropped alongside its map needs nothing — the import finds it on disk — so it is
    // dropped from the list rather than reported as a failure. The loop is sceneManager's.
    if (maps.some(isImportableMapFile) || maps.length > 1) importMapFiles(maps);
  });

  document.getElementById('btn-reveal').onclick = () => setPaintDirection('reveal');
  document.getElementById('btn-half').onclick   = () => setPaintDirection('half');
  document.getElementById('btn-shroud').onclick = () => setPaintDirection('shroud');
  document.getElementById('btn-brush').onclick  = () => setShape('brush');
  document.getElementById('btn-rect').onclick   = () => setShape('rect');
  document.getElementById('btn-poly').onclick   = () => setShape('poly');
  document.getElementById('btn-circle').onclick = () => setShape('circle');
  document.getElementById('btn-cone').onclick   = () => setShape('cone');
  document.getElementById('btn-select').onclick = () => setShape('select');
  document.getElementById('btn-door').onclick   = () => setShape('door');
  document.getElementById('btn-place-rooms').onclick   = () => setPlaceMode('rooms');
  document.getElementById('btn-place-effects').onclick = () => setPlaceMode('effects');
  document.getElementById('btn-legend').onclick = () => toggleLegend();
  initMaterialPicker();
  refreshHalfAvailability();  // Select is the tool at load, so half starts live
  refreshBrushAvailability();
  document.getElementById('btn-snap').onclick = function() {
    snapToGrid = !snapToGrid;
    this.classList.toggle('active', snapToGrid);
  };
  document.getElementById('btn-axislock').onclick = function() {
    axisLock = !axisLock;
    this.classList.toggle('active', axisLock);
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

  // Draws the rooms from the floor plan the map came with. Enabled only where this scene
  // has one; refreshFloorPlanButton() owns that, on every scene switch.
  document.getElementById('btn-floorplan').onclick = () => drawStoredFloorPlan();

  // Grid
  const gridBtn       = document.getElementById('btn-grid');
  const gridSizeInput = document.getElementById('grid-size');
  // ⚠ EVERY HANDLER BELOW ENDS IN commitGridChange() — render, Player push and scene save in one
  // call. A grid control ending any other way loses its value on the next scene switch.
  gridBtn.onclick = function(e) {
    e.stopPropagation();
    gridEnabled = !gridEnabled;
    this.classList.toggle('active', gridEnabled);
    commitGridChange();
  };
  gridSizeInput.oninput = e => {
    gridSize = parseInt(e.target.value);
    document.getElementById('grid-size-num').value = gridSize;
    commitGridChange();
  };
  document.getElementById('grid-size-num').oninput = e => {
    const v = Math.max(10, Math.min(400, parseInt(e.target.value) || 10));
    gridSize = v; gridSizeInput.value = v;
    commitGridChange();
  };
  document.getElementById('grid-offset-x').oninput = e => {
    gridOffsetX = parseInt(e.target.value);
    document.getElementById('grid-offset-x-num').value = gridOffsetX;
    commitGridChange();
  };
  document.getElementById('grid-offset-x-num').oninput = e => {
    const v = Math.max(0, Math.min(400, parseInt(e.target.value) || 0));
    gridOffsetX = v; document.getElementById('grid-offset-x').value = v;
    commitGridChange();
  };
  document.getElementById('grid-offset-y').oninput = e => {
    gridOffsetY = parseInt(e.target.value);
    document.getElementById('grid-offset-y-num').value = gridOffsetY;
    commitGridChange();
  };
  document.getElementById('grid-offset-y-num').oninput = e => {
    const v = Math.max(0, Math.min(400, parseInt(e.target.value) || 0));
    gridOffsetY = v; document.getElementById('grid-offset-y').value = v;
    commitGridChange();
  };
  (['sq', 'hflat', 'hptop']).forEach(m => {
    document.getElementById('btn-grid-' + m).onclick = () => {
      gridMode = m === 'sq' ? 'square' : m === 'hflat' ? 'hex-flat' : 'hex-pointy';
      document.querySelectorAll('.grid-mode-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('btn-grid-' + m).classList.add('active');
      commitGridChange();
    };
  });
  document.getElementById('grid-color').oninput = e => {
    gridColor = e.target.value;
    commitGridChange();
  };
  document.getElementById('grid-opacity').oninput = e => {
    gridOpacity = parseInt(e.target.value) / 100;
    document.getElementById('grid-opacity-num').value = e.target.value;
    commitGridChange();
  };
  document.getElementById('grid-opacity-num').oninput = e => {
    const v = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
    gridOpacity = v / 100; document.getElementById('grid-opacity').value = v;
    commitGridChange();
  };
  document.getElementById('grid-thickness').oninput = e => {
    gridLineWidth = parseInt(e.target.value);
    document.getElementById('grid-thickness-num').value = gridLineWidth;
    commitGridChange();
  };
  document.getElementById('grid-thickness-num').oninput = e => {
    const v = Math.max(1, Math.min(10, parseInt(e.target.value) || 1));
    gridLineWidth = v; document.getElementById('grid-thickness').value = v;
    commitGridChange();
  };
  document.getElementById('btn-grid-reset').onclick = () => {
    gridSize      = GRID_DEFAULT_SIZE;
    gridOffsetX   = 0;
    gridOffsetY   = 0;
    gridColor     = '#ffffff';
    gridOpacity   = 0.25;
    gridMode      = 'square';
    gridLineWidth = 1;
    document.getElementById('grid-size').value          = GRID_DEFAULT_SIZE;
    document.getElementById('grid-size-num').value      = GRID_DEFAULT_SIZE;
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
    commitGridChange();
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
    // Send the REGION the DM can read, never the DM's zoom: the Player refits it, so a bigger TV
    // shows the same map rather than more of it. Same helper as a manual Send.
    const v = dmVisibleRegion();
    playerWindow.postMessage({ type: 'view-snap', ...v }, '*');
    // ⚠ minimapView.zoom is ALWAYS in Player-canvas terms, so convert before handing it over.
    // Passing the DM's own zoom leaves the dotted TV frame wrong until the next drag.
    // playerScreenW/H are the Player's window size, which is exactly its render size, so the frame
    // is exact.
    const playerZoom = zoomToFitRegion(v.viewW, v.viewH, playerScreenW, playerScreenH);
    minimapSetView({ mapCX: v.mapCX, mapCY: v.mapCY, zoom: playerZoom ?? v.zoom });
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
    if (msg.type === 'PLAYER_FULLSCREEN') {
      playerIsFullscreen = !!msg.fullScreen;
      if (typeof refreshPlayerControlUI === 'function') refreshPlayerControlUI();
      return;
    }
    if (msg.type === 'PLAYER_VIEW') {
      minimapSyncFromPlayer(msg);
    }
  });

  document.getElementById('btn-player').onclick = () => {
    // Toggle: a second press closes the Player again. window.open() on an already-open
    // named window just re-navigates it, so without this the button looked dead.
    if (playerWindow && !playerWindow.closed) {
      const dying = playerWindow;
      playerWindow.close();
      playerWindow = null;
      if (typeof refreshPlayerControlUI === 'function') refreshPlayerControlUI();
      prewarmPlayerAfter(dying);   // the next press should be as fast as this one was
      return;
    }
    revealPlayerWindow();
  };

  // Off the boot path: warming it while the DM comes up trades one wait for another.
  setTimeout(prewarmPlayer, 2000);

  // ⚠ WRAPPED, never assigned bare: a bare handler receives the click event, which lands in
  // sendToPlayer's fogOnly parameter and is truthy, so the button would send fog without the view.
  document.getElementById('btn-send').onclick = () => sendToPlayer();

  // The selected room's card (name, description, fog pill, corners, delete) → roomPanel.js.
  if (typeof initRoomPanel === 'function') initRoomPanel();

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

  // Tabbed Fog/Grid/Player control-panel UI (drives the wiring above). Runs after
  // all legacy controls are wired so its buttons can delegate to them.
  if (typeof initControlPanel === 'function') initControlPanel();
}
