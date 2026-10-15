'use strict';
// DM-only UI control wiring: toolbar, sliders, fog colour, anim presets, the scene and backup
// modals, and player controls. Called once from index.html in DM mode.
// ─── Fog paint direction ──────────────────────────────────────────────────────
// The fog-mode segment is pick-exactly-one, so ONE helper owns both `tool` and the highlight.
function setPaintDirection(dir) {
  tool = dir;
  paneBroadcast('paint-direction', { dir });
  refreshFogTrio();
}

// The old fog trio (#ctx-rooms) is the back end behind the row's fog clouds and the selected
// room's own clouds. Pressed with Select in hand and a room selected it sets that room's fog, and
// with a drawing tool or the Brush in hand it sets what gets drawn next. The row's clouds never
// take the first meaning: their click only ever sets the direction (fogBar.js).
function fogTrioRoom() {
  if (shape !== 'select' || placeMode !== 'rooms') return null;
  const linked = paneSelectedRoom();
  if (linked || selectedPolygonId == null) return linked;
  return polygons.find(p => p.id === selectedPolygonId) || null;
}

function refreshFogTrio() {
  const room = fogTrioRoom();
  const lit = room ? room.mode : tool;
  ['reveal', 'half', 'shroud'].forEach(d => {
    const el = document.getElementById('btn-' + d);
    if (el) el.classList.toggle('active', d === lit);
  });
  refreshPaintAvailability();
}

function pressFogTrio(dir) {
  const room = fogTrioRoom();
  if (!room) { setPaintDirection(dir); return; }
  if (paneRoomEdit('mode', { mode: dir })) return;
  setPolygonMode(room.id, dir);
  refreshFogTrio();   // in place — setPolygonMode deliberately doesn't refresh
}

// Half is shape-tools only: the brush paints into a cleared-or-opaque fog canvas with no third
// value, so the button greys while the brush is picked and a live half falls back to shroud.
// The whole trio greys under Merge and Cut out, which take their fog from the rooms they hit.
// A selected room's own fog is none of these, so the trio is whole while it shows one.
function refreshPaintAvailability() {
  const opPicked = shapeOp !== 'new' && !fogTrioRoom();
  ['reveal', 'half', 'shroud'].forEach(d => {
    const el = document.getElementById('btn-' + d);
    if (el) el.disabled = opPicked;
  });
  const btn = document.getElementById('btn-half');
  if (!btn) return;
  const brushPicked = shape === 'brush';
  btn.disabled = opPicked || brushPicked;
  if (brushPicked && tool === 'half') { setPaintDirection('shroud'); return; }
  refreshFogBar();   // the row's clouds grey and light from the same two values
}

// What a drawn shape does when no key is held: 'new' makes one, 'join' merges, 'trim' cuts out, 'split'
// divides along its edge. ONE helper owns the value and the highlight. There is no 'new' button; the
// lit repair icon is the way back (repairBar.js).
function setShapeOp(op) {
  shapeOp = op;
  paneBroadcast('shape-op', { op });
  ['join', 'trim'].forEach(k => {
    const el = document.getElementById('btn-op-' + k);
    if (el) el.classList.toggle('active', k === op);
  });
  refreshPaintAvailability();
  refreshShapeButton();     // on the world map an armed repair is what the Shape button wears
  refreshRepairIcon();      // and on the scene bar the repair icon wears it
  updateContextPanels();    // and its options row shows while one is armed
  if (worldMapOpen) worldMapToolSync();   // an armed repair changes what the world map's next shape does
}

// ─── Placement mode ───────────────────────────────────────────────────────────
// Which array the next rectangle or circle lands in. Like setPaintDirection, ONE helper owns both
// the value and the highlight.
function setPlaceMode(m) {
  paneBroadcast('place-mode', { mode: m });
  if (placeMode !== m) {
    // ⚠ THE SELECTION IS SCOPED TO THE MODE. Ids are numbered per list, so one left over from the
    // other list resolves against whichever shape shares the number.
    clearShapeSelection();
    activePolygon = null;
  }
  placeMode = m;
  document.body.classList.toggle('mode-fx', m === 'effects');   // the sliding thumb under the mode in force
  if (m !== 'effects') presetArmed = null;   // a size is an effect's or a light's; Rooms draws by hand
  ['rooms', 'effects'].forEach(k => {
    const el = document.getElementById('btn-place-' + k);
    if (el) el.classList.toggle('active', k === m);
  });
  // ⚠ ONLY WHEN THE CURRENT TOOL IS NOT IN THE MODE BEING ENTERED. Select is in both lists, so
  // an unconditional restore would kick the DM off the tool this app is mostly used with.
  if (!shapeInMode(shape, m)) {
    const want = m === 'effects' ? effectsShape : roomsShape;
    setShape(shapeInMode(want, m) ? want : 'poly');
  }
  refreshModeTools();
  // The strip above is mode-driven too: the fog trio to rooms, the materials to effects.
  updateContextPanels();
  drawCursor(lastScreenX, lastScreenY);   // the shape preview takes the mode's colour
}

// ⚠ A TOOL A MODE CANNOT USE IS ABSENT, NOT GREYED. The bar sizes itself to whichever set is up
// and stays centred. Half is the one control left that greys.
const MODE_SHAPES = {
  rooms:   ['select', 'poly', 'rect', 'circle', 'brush', 'door', 'cut'],
  effects: ['select', 'poly', 'rect', 'circle', 'cone', 'line', 'wall', 'ring', 'cut'],
};

// The shape each mode last drew with, so a mode switch puts the DM back where they were.
function modeShape(m) { return m === 'effects' ? effectsShape : roomsShape; }
function setModeShape(m, s) { if (m === 'effects') effectsShape = s; else roomsShape = s; }
function shapeInMode(s, m) { return MODE_SHAPES[m].indexOf(s) >= 0; }

// Rooms-only controls. The brush needs fog to paint, a door needs a wall and the fog clouds set
// what they do, so none has anything to act on in Effects. The repairs work on either list.
const ROOMS_ONLY = ['btn-brush', 'btn-door'];
function refreshModeTools() {
  const fx = placeMode === 'effects';
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  ROOMS_ONLY.forEach(id => show(id, placeMode === 'rooms'));
  ['btn-cone', 'btn-line', 'btn-wall', 'btn-ring'].forEach(id => show(id, fx));
  refreshShapeButton();
}

// ─── Materials ────────────────────────────────────────────────────────────────
// What the next effect is made of. Pick-exactly-one, so ONE helper owns the value and the
// highlight. Picking one with an effect SELECTED edits that effect, and takes the full path -
// undo, repaint, push, save - because it is a real edit to a stored shape.
//
// ⚠ The buttons in #material-row are the back end: their glyph, name and data-material feed the one
// material button and its palette (effectsRow.js), which is all the DM sees.
function initMaterialPicker() {
  document.querySelectorAll('#material-row [data-material]').forEach(btn => {
    btn.onclick = () => setMaterial(btn.dataset.material);
  });
  setMaterial(currentMaterial);   // the highlight starts where the value does
}

function setMaterial(m) {
  if (isPlayer || (m !== 'light' && !EFFECT_MATERIALS[m])) return;
  currentMaterial = m;
  if (typeof refreshMaterialButton === 'function') refreshMaterialButton();
  if (paneForward('material', { material: m })) {
    document.querySelectorAll('#material-row [data-material]').forEach(b =>
      b.classList.toggle('active', b.dataset.material === m));
    return;
  }
  document.querySelectorAll('#material-row [data-material]').forEach(b =>
    b.classList.toggle('active', b.dataset.material === m));

  if (m === 'light' || placeMode !== 'effects' || selectedPolygonId == null) return;
  const e = effects.find(x => x.id === selectedPolygonId);
  if (!e || e.material === m) return;
  pushUndo();
  e.material = m;
  effectsChanged();
  scheduleAutoSync();   // rides the Auto/Manual gate exactly as a fog edit does
  scheduleAutoSave();
}

// Reveal all and Hide all act on the whole map, every room included, through one path whoever asks:
// the bar's eyes (fogBar.js) and the hidden Scene control buttons. Undo and the transition ride along.
function revealAllMap() {
  if (paneForward('reveal-all')) return;
  revealAllRooms();
}
function hideAllMap() {
  if (paneForward('shroud-all')) return;
  shroudAllRooms();
}

function initToolbar() {
  // The scene list, the delete's undo and Two maps wire themselves.
  sceneListInit();
  sceneDeleteInit();
  twoMapsInit();

  initDragDrop();

  document.getElementById('btn-reveal').onclick = () => pressFogTrio('reveal');
  document.getElementById('btn-half').onclick   = () => pressFogTrio('half');
  document.getElementById('btn-shroud').onclick = () => pressFogTrio('shroud');
  document.getElementById('btn-brush').onclick  = () => setShape('brush');
  document.getElementById('btn-select').onclick = () => setShape('select');
  document.getElementById('btn-door').onclick    = () => setShape('door');
  // On the scene bar the hidden Split button arms Ctrl with the Polygon (repairKeys.js); the world map
  // keeps Split as a tool of its own.
  document.getElementById('btn-cut').onclick     = () => {
    if (worldMapOpen) { setShape('cut'); return; }
    setShape(shapeMenuItems().indexOf('poly') >= 0 ? 'poly' : modeShape(placeMode));
    setShapeOp('split');
  };
  // The four shapes and the button that stands for them are shapeMenu.js's; it owns the flyout.
  // Pressing a lit repair disarms it, which is the only way back to 'new' now.
  document.getElementById('btn-op-join').onclick = () => setShapeOp(shapeOp === 'join' ? 'new' : 'join');
  document.getElementById('btn-op-trim').onclick = () => setShapeOp(shapeOp === 'trim' ? 'new' : 'trim');
  document.getElementById('btn-place-rooms').onclick   = () => setPlaceMode('rooms');
  document.getElementById('btn-place-effects').onclick = () => setPlaceMode('effects');
  document.getElementById('btn-help').onclick = () => toggleLegend();
  initMaterialPicker();
  setShapeOp(shapeOp);        // the highlight starts where the value does
  refreshPaintAvailability(); // Select is the tool at load, so half starts live
  refreshModeTools();
  document.getElementById('btn-snap').onclick = function() {
    snapToGrid = !snapToGrid;
    this.classList.toggle('active', snapToGrid);
    paneBroadcast('snap', { on: snapToGrid });
  };
  document.getElementById('btn-axislock').onclick = function() {
    axisLock = !axisLock;
    this.classList.toggle('active', axisLock);
    paneBroadcast('axislock', { on: axisLock });
  };

  const brushSizeInput = document.getElementById('brush-size');
  const brushSizeLabel = document.getElementById('brush-size-label');
  brushSizeInput.oninput = e => {
    brushSize = parseInt(e.target.value);
    brushSizeLabel.textContent = brushSize;
    paneBroadcast('brush-size', { size: brushSize });
  };

  document.getElementById('btn-fill-fog').onclick = hideAllMap;
  document.getElementById('btn-clear-fog').onclick = revealAllMap;

  // Draws the rooms from the floor plan the map came with. Enabled only where this scene
  // has one; refreshFloorPlanButton() owns that, on every scene switch.
  document.getElementById('btn-floorplan').onclick = () => {
    if (paneForward('floorplan')) return;
    drawStoredFloorPlan();
  };
  const planInput = document.getElementById('cp-plan-input');
  document.getElementById('cp-src-plan').onclick = () => planInput.click();
  planInput.onchange = () => { loadPlanFile(planInput.files[0]); planInput.value = ''; };
  const lightsInput = document.getElementById('cp-lights-plan-input');
  document.getElementById('cp-src-lights').onclick = () => lightsInput.click();
  lightsInput.onchange = () => {
    const f = lightsInput.files[0];
    lightsInput.value = '';
    if (!paneForward('lights-file', { file: f })) loadPlanLights(f);
  };

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
  // No offset FIELD any more - calibration sets the phase, and a typed number cannot be aimed.
  document.getElementById('grid-offset-x').oninput = e => {
    gridOffsetX = parseInt(e.target.value);
    commitGridChange();
  };
  document.getElementById('grid-offset-y').oninput = e => {
    gridOffsetY = parseInt(e.target.value);
    commitGridChange();
  };
  (['sq', 'hptop']).forEach(m => {
    document.getElementById('btn-grid-' + m).onclick = () => {
      gridMode = m === 'sq' ? 'square' : 'hex-pointy';
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
    document.getElementById('grid-offset-y').value      = 0;
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
    // ⚠ MANUAL CANCELS A PUSH ALREADY QUEUED. scheduleAutoSync debounces by 300ms, so a reveal
    // made just after the switch used to ride out on the timer the previous edit armed.
    if (!enabled) clearTimeout(autoSyncTimer);
    paneBroadcast('auto-sync', { on: enabled });
    const btn = document.getElementById('btn-auto-sync');
    btn.classList.toggle('active', autoSync);
    btn.textContent = autoSync ? 'Auto' : 'Manual';
    localStorage.setItem('evermist-auto-sync', autoSync ? '1' : '0');
  }
  document.getElementById('btn-auto-sync').onclick = () => setAutoSync(!autoSync);
  setAutoSync(localStorage.getItem('evermist-auto-sync') !== '0');

  initFogControls();

  document.getElementById('btn-fullscreen-player').onclick = () => {
    if (panesActive) { stageFullscreen(); return; }
    if (!playerWindow || playerWindow.closed) return;
    playerWindow.postMessage({ type: 'fullscreen' }, '*');
  };

  document.getElementById('btn-sync-view').onclick = () => {
    if (paneForward('sync-view')) return;
    if (!playerWindow || playerWindow.closed) return;
    // Send the REGION the DM can read, never the DM's zoom: the Player refits it, so a bigger TV
    // shows the same map rather than more of it. Same helper as a manual Send.
    const v = dmVisibleRegion();
    playerWindow.postMessage({ type: 'view-snap', ...v }, '*');
    // ⚠ minimapView.zoom is ALWAYS in Player-canvas terms, so convert before handing it over.
    // Passing the DM's own zoom leaves the dotted TV frame wrong until the next drag.
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
      galleryResend();
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
    // One Player screen serves both columns, so this button owns the shell rather than a column.
    if (panesActive) { toggleStageWindow(); return; }
    togglePlayerWindow();
  };

  // Off the boot path: warming it while the DM comes up trades one wait for another.
  if (!appInBackground) setTimeout(prewarmPlayer, 2000);

  // ⚠ WRAPPED, never assigned bare: a bare handler receives the click event, which lands in
  // sendToPlayer's fogOnly parameter and is truthy, so the button would send fog without the view.
  document.getElementById('btn-send').onclick = () => {
    if (paneForward('send')) return;
    sendToPlayer();
  };

  // The Room tab → roomCard.js.
  if (typeof initRoomPanel === 'function') initRoomPanel();
  initCornerField();
  initRoomSwitcher();   // the selected room's own clouds and door → roomSwitcher.js
  initPlayersView();    // hold H: the map as the TV shows it → playersView.js
  initRepairKeys();     // Shift, Alt and Ctrl while a shape is drawn → repairKeys.js
  if (!isPane) { initFogBar(); initRepairBar(); initEffectsRow(); }   // the bar and its row, which a column does not show

  updateContextPanels(); // init: Select is the tool at load, so the strip starts blank

  // Tabbed Fog/Grid/Player control-panel UI (drives the wiring above). Runs after
  // all legacy controls are wired so its buttons can delegate to them.
  if (typeof initControlPanel === 'function') initControlPanel();
}
