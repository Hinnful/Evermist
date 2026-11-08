'use strict';
// controlPanel.js — the dock's Map settings pane: Grid, Weather and Fog, Rooms and lights, and
// Settings' module text card.
//
// ⚠ A UI LAYER over the existing fog and grid wiring, never new logic. Every control drives the
// hidden input or button in #cp-legacy, so state mutation, scene persistence and player sync
// behave exactly as before. Called once from initToolbar(), DM only.

let _cpGridPicker = null;

function initControlPanel() {
  if (typeof isPlayer !== 'undefined' && isPlayer) return;
  if (!document.getElementById('dock-pane-scene')) return;

  _cpInitFogTheme();
  _cpInitWeather();
  _cpInitGrid();
  _cpInitRooms();
  _cpInitLights();
  _cpInitCards();
  _cpInitClamps();
  _cpInitCompress();
  _cpGridPicker = _cpMakePicker('grid', 'grid-color');
  _cpInitFields();
  _cpInitResets();
  _cpInitPlayerPoll();
  _cpInitCalibrate();

  refreshFogThemeUI();
  refreshWeatherUI();
  refreshGridControlUI();
  refreshPlayerControlUI();
  refreshRoomsControlUI();
  refreshLightsControlUI();
}

const _cpEl = id => document.getElementById(id);
const _cpOn = id => { const el = _cpEl(id); return !!el && el.classList.contains('active'); };
const _cpSwitch = (id, on) => { const el = _cpEl(id); if (el) el.setAttribute('aria-checked', on ? 'true' : 'false'); };
const _cpPick = (rowId, attr, val) => document.querySelectorAll('#' + rowId + ' [' + attr + ']')
  .forEach(b => b.classList.toggle('active', b.getAttribute(attr) === String(val)));

// Writes a legacy input and fires its own event, so the app's handler is the one that takes the value.
function _cpFire(id, value) {
  const el = _cpEl(id);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function _cpInitCalibrate() {
  const btn = _cpEl('cp-grid-calibrate');
  if (!btn) return;
  // The gesture draws the shape the grid is made of, so every grid type calibrates. Switched OFF
  // is not a type: gridMode keeps its value and renderGrid shows the grid for the gesture anyway.
  btn.addEventListener('click', () => {
    // ⚠ armGridCalibration runs inside the column, whose dock is its own hidden one; the column
    // reports back (`pane-calibrate`, panes.js) and that report holds the DM's pane.
    if (typeof panesActive !== 'undefined' && panesActive) {
      paneForward('calibrate', { on: !paneScope().gridCalArmed });
      return;
    }
    armGridCalibration(!gridCalArmed);
  });
  initGridCalibrate();
}

// ─── Fog theme: one icon per theme, in its door-light colour ─────────────────
function _cpInitFogTheme() {
  document.querySelectorAll('#cp-fogtheme-row [data-fogtheme]').forEach(btn => {
    const c = fogThemeRecord(btn.dataset.fogtheme).doorLight.map(v => Math.round(v * 255));
    btn.querySelector('svg').style.color = 'rgb(' + c.join(',') + ')';
    btn.addEventListener('click', () => setFogTheme(btn.dataset.fogtheme));
  });
}

// `id` is the selected column's theme in two-map mode, where the shell holds none of its own.
function refreshFogThemeUI(id) {
  _cpPick('cp-fogtheme-row', 'data-fogtheme', fogThemeRecord(id === undefined ? fogTheme : id).id);
}

// ─── Weather: one icon per preset ────────────────────────────────────────────
function _cpInitWeather() {
  document.querySelectorAll('#cp-wx-row [data-wx]').forEach(btn => {
    btn.addEventListener('click', () => chooseWeather(btn.dataset.wx));
  });
}

// `id` is the selected column's preset in two-map mode, where the shell holds none of its own.
function refreshWeatherUI(id) {
  _cpPick('cp-wx-row', 'data-wx', weatherNormalize(id === undefined ? weatherId : id));
}

// ─── Grid: the switch on the title, type, cells, line, colour, opacity ───────
const _CP_GRID_SIZE = { min: 10, max: 400 };

function _cpInitGrid() {
  const TYPE_TO_BTN = { square: 'btn-grid-sq', 'hex-pointy': 'btn-grid-hptop' };
  document.querySelectorAll('#cp-gridtype-row [data-gtype]').forEach(btn => {
    btn.addEventListener('click', () => {
      _cpEl(TYPE_TO_BTN[btn.dataset.gtype]).click();       // sets gridMode
      if (!_cpOn('btn-grid')) _cpEl('btn-grid').click();  // picking a type turns the grid on
      setGridTypeUI();
    });
  });
  _cpEl('cp-grid-switch').addEventListener('click', () => _cpEl('btn-grid').click());
  _cpEl('btn-grid').addEventListener('click', setGridTypeUI);

  const size = _cpEl('grid-size-num');
  const step = d => {
    const v = Math.max(_CP_GRID_SIZE.min, Math.min(_CP_GRID_SIZE.max, (parseInt(size.value) || Math.round(gridSize)) + d));
    _cpFire('grid-size-num', v);
  };
  _cpEl('cp-grid-dec').addEventListener('click', () => step(-1));
  _cpEl('cp-grid-inc').addEventListener('click', () => step(1));

  document.querySelectorAll('#cp-gridline-row [data-lstyle]').forEach(btn => {
    btn.addEventListener('click', () => setGridLineStyle(btn.dataset.lstyle));
  });
  document.querySelectorAll('#cp-gridwidth-row [data-lw]').forEach(btn => {
    btn.addEventListener('click', () => _cpFire('grid-thickness', btn.dataset.lw));
  });
  document.querySelectorAll('#cp-grid-swatches [data-color]').forEach(btn => {
    btn.addEventListener('click', () => { _cpFire('grid-color', btn.dataset.color); refreshGridControlUI(); });
  });
  _cpEl('cp-grid-opacity').addEventListener('input', e => _cpFire('grid-opacity', e.target.value));
}

// "31 × 22 squares", from the open map (the selected column's in two-map mode). Hidden with no map.
function _cpPaintGridCount() {
  const el = _cpEl('cp-grid-count');
  if (!el) return;
  const s = paneScope(), w = s.mapWidth, h = s.mapHeight;
  el.hidden = !(w > 0 && h > 0 && gridSize > 0);
  if (el.hidden) return;
  el.textContent = gridMode === 'square'
    ? t('{c} × {r} squares', { c: Math.round(w / gridSize), r: Math.round(h / gridSize) })
    : t('{c} × {r} hexes', { c: Math.round(w / (gridSize * Math.sqrt(3))), r: Math.round(h / (1.5 * gridSize)) });
}

function setGridTypeUI() {
  const row = _cpEl('cp-gridtype-row');
  if (!row) return;
  const m = document.querySelector('.grid-mode-btn.active');
  const type = m && m.id.endsWith('hptop') ? 'hex-pointy' : 'square';
  row.querySelectorAll('[data-gtype]').forEach(b => b.classList.toggle('active', b.dataset.gtype === type));
  const on = _cpOn('btn-grid');
  _cpEl('cp-grid-body').classList.toggle('dk-dim', !on);
  _cpSwitch('cp-grid-switch', on);
  _cpPaintGridCount();
}

// ─── Settings: shrink big maps ────────────────────────────────────────────────
// mapConvert.js owns the setting; this sets it and paints the result.
function _cpInitCompress() {
  const compress = _cpEl('sm-compress');
  if (!compress || typeof compressSize !== 'function') return;
  const paint = () => {
    const v = compressSize().value;
    compress.querySelectorAll('.cp-segtab').forEach(b => b.classList.toggle('active', b.dataset.size === v));
  };
  compress.addEventListener('click', e => {
    const b = e.target.closest('.cp-segtab');
    if (!b) return;
    setCompressSize(b.dataset.size);
    paint();
  });
  paint();
}

// ─── Rooms and lights: two switches and the floor plan card ──────────────────
function _cpInitRooms() {
  _cpEl('cp-labels-row').addEventListener('click', () => toggleRoomLabels());
}

function _cpInitLights() {
  _cpEl('cp-lights-row').addEventListener('click', () => {
    if (paneForward('lights-toggle')) { setTimeout(refreshLightsControlUI, 120); return; }
    toggleLightsHidden();
  });
  _cpEl('btn-lights-redraw').addEventListener('click', () => {
    if (!paneForward('lights-plan')) drawPlanLights();
  });
}

// The file cards and lines: a trash that asks, and a head or line that acts as a button from the keyboard too.
function _cpInitCards() {
  document.querySelectorAll('#dock .dk-card-head, #dock .dk-file').forEach(head => head.addEventListener('keydown', e => {
    if (e.target === head && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); head.click(); }
  }));
  _cpEl('cp-plan-remove').addEventListener('click', e => {
    e.stopPropagation();
    confirmDialog({
      title: 'Remove the floor plan?',
      message: 'Rooms and lights already drawn stay. Load it again any time.',
      confirmLabel: 'Remove',
      onConfirm: () => {
        if (paneForward('plan-remove')) { setTimeout(refreshFloorPlanUI, 300); return; }
        removeFloorPlan();
      },
    });
  });
  _cpEl('cp-src-module').addEventListener('click', () => openModuleTextModal());
  _cpEl('cp-module-card').addEventListener('click', () => openModuleTextModal());
  _cpEl('cp-module-clear').addEventListener('click', e => {
    e.stopPropagation();
    confirmDialog({
      title: 'Remove the module text?',
      message: t('The room names stop dropping down from “{name}”. Names already on rooms stay. Load it again any time.',
                 { name: mtLoadedSourceName() }),
      confirmLabel: 'Remove',
      onConfirm: mtClearStored,
    });
  });
}

function refreshLightsControlUI() {
  if (!_cpEl('cp-lights-switch')) return;
  _cpSwitch('cp-lights-switch', !paneScope().lightsHidden);
  _cpPaintPlan();
}

// The load row with no plan, the card with one; read from the selected column in two-map mode.
function _cpPaintPlan() {
  const s = paneScope(), rooms = s.planRooms, lights = s.planLights;
  const src = _cpEl('cp-src-plan');
  src.hidden = !!s.hasPlan;
  src.disabled = !(panesActive || currentScene);
  _cpEl('cp-plan-card').hidden = !s.hasPlan;
  // A plan stored before its file name was kept reads "Floor plan".
  const nm = _cpEl('cp-plan-name'), file = s.planName;
  nm.textContent = file ? file.replace(/\.dd2vtt$/i, '') : t('Floor plan');
  nm.title = file || '';
  _cpEl('cp-plan-meta').textContent = t('{rooms} · {lights}', {
    rooms: t.plural(rooms, '{n} room', '{n} rooms'),
    lights: lights ? t.plural(lights, '{n} light', '{n} lights') : t('no lights'),
  });
  _cpEl('btn-floorplan').disabled = !rooms;
  _cpEl('btn-lights-redraw').disabled = !lights;
}

// From toggleRoomLabels, refreshFloorPlanUI and every module-text load or removal.
function refreshRoomsControlUI() {
  if (!_cpEl('cp-labels-switch')) return;
  _cpSwitch('cp-labels-switch', showRoomLabels);
  _cpPaintPlan();
  _cpPaintGridCount();
  const name = typeof mtLoadedSourceName === 'function' ? mtLoadedSourceName() : null;
  _cpEl('cp-src-module').hidden = !!name;
  _cpEl('cp-module-card').hidden = !name;
  _cpEl('cp-module-name').textContent = name || '';
}

// ─── The cell size field ──────────────────────────────────────────────────────
// A typed value is clamped on the way out, as the handler clamped what it took.
function _cpInitClamps() {
  [['grid-size-num', _CP_GRID_SIZE.min, _CP_GRID_SIZE.max]].forEach(([id, lo, hi]) => {
    const el = _cpEl(id);
    el.addEventListener('change', () => { el.value = Math.max(lo, Math.min(hi, parseInt(el.value) || lo)); });
    el.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') el.blur(); });
  });
}

// ─── The grid's look, painted from the legacy inputs the picker and handlers write ─
function _cpPaintFields() {
  if (!_cpEl('cp-grid-swatches')) return;
  const hex = (_cpEl('grid-color').value || '').toLowerCase();
  let matched = false;
  document.querySelectorAll('#cp-grid-swatches [data-color]').forEach(b => {
    const on = b.dataset.color === hex;
    matched = matched || on;
    b.classList.toggle('on', on);
  });
  _cpEl('cp-grid-custom').classList.toggle('on', !matched);
  const pct = Math.max(0, Math.min(100, parseInt(_cpEl('grid-opacity').value) || 0));
  const slider = _cpEl('cp-grid-opacity');
  slider.value = pct;
  slider.parentNode.querySelector('.cp-slider-fill').style.width = pct + '%';
  slider.parentNode.querySelector('.cp-slider-knob').style.left = pct + '%';
  _cpEl('cp-grid-opacity-val').textContent = pct + '%';
  _cpPick('cp-gridline-row', 'data-lstyle', gridLineStyle);
  _cpPick('cp-gridwidth-row', 'data-lw', gridLineWidth);   // a width that is none of 1/2/4 lights nothing
  _cpPaintGridCount();
}

function _cpInitFields() {
  // The picker and the handlers write the hidden inputs, so the pane listens for them by id.
  const FEEDS = ['grid-color', 'grid-opacity', 'grid-opacity-num', 'grid-thickness', 'grid-size', 'grid-size-num'];
  ['input', 'change'].forEach(ev => document.addEventListener(ev, e => {
    if (FEEDS.includes(e.target.id)) _cpPaintFields();
  }));
  document.addEventListener('dockpop', e => {
    if (e.detail === 'cp-pop-grid') _cpGridPicker.refresh();
  });
}

// ─── Reset buttons ────────────────────────────────────────────────────────────
// ⚠ Both ASK FIRST: the reset is a word on the section title, so the question is the only
// warning there is. confirmDialog answers asynchronously.
function _cpInitResets() {
  const ask = (message, run) => confirmDialog({
    title: 'Reset settings?',
    message: message,
    confirmLabel: 'Reset',
    danger: true,
    onConfirm: run,
  });

  _cpEl('cp-grid-reset').addEventListener('click', () => {
    ask('Grid type, size, line style, thickness, colour and opacity go back to their defaults.', () => {
      _cpEl('btn-grid-reset').click(); // resets grid globals + legacy DOM
      refreshGridControlUI();
    });
  });

  _cpEl('cp-fog-reset').addEventListener('click', () => {
    ask('Weather goes back to No weather, and the fog theme goes back to Default.', () => {
      setFogTheme('default');
      chooseWeather('none');
    });
  });
}

// A Player window can close without telling us, so poll. Read-only.
function _cpInitPlayerPoll() { setInterval(refreshPlayerControlUI, 1000); }

// ─── Reflection hooks (called from scene-restore paths) ───────────────────────
function refreshGridControlUI() {
  if (_cpGridPicker) _cpGridPicker.refresh();
  _cpPaintFields();
  setGridTypeUI();
}

// Mirrors player state onto the minimap. Reads only — the legacy buttons remain
// the source of truth (their .active classes are set by minimap.js / toolbar.js).
function refreshPlayerControlUI() {
  tvRefresh();
}
