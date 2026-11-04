'use strict';
// controlPanel.js — the dock's Scene control pane: Weather and fog, Rooms, Grid and Player.
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
  _cpInitScrubs();
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

function _cpSetEye(id, shown, what) {
  const eye = _cpEl(id);
  if (!eye) return;
  eye.classList.toggle('off', !shown);
  eye.title = t(shown ? '{what}: shown, click to hide' : '{what}: hidden, click to show', { what: t(what) });
}

function _cpInitCalibrate() {
  const btn = _cpEl('cp-grid-calibrate');
  if (!btn) return;
  // The gesture draws the shape the grid is made of, so every grid type calibrates. Switched OFF
  // is not a type: gridMode keeps its value and renderGrid shows the grid for the gesture anyway.
  btn.addEventListener('click', () => {
    // ⚠ THE DM'S PANE HAS TO GO TOO: armGridCalibration runs inside the column, where the
    // dock it shuts is that column's own hidden one.
    if (typeof panesActive !== 'undefined' && panesActive) {
      const on = !paneScope().gridCalArmed;
      paneForward('calibrate', { on });
      dockHoldForCalibration(on);
      return;
    }
    armGridCalibration(!gridCalArmed);
  });
  initGridCalibrate();
}

// ─── Fog theme: one dropdown, built like Weather's ───────────────────────────
function _cpInitFogTheme() {
  document.querySelectorAll('#cp-pop-fogtheme [data-fogtheme]').forEach(btn => {
    btn.addEventListener('click', () => { dockClosePop(); setFogTheme(btn.dataset.fogtheme); });
  });
}

// `id` is the selected column's theme in two-map mode, where the shell holds none of its own.
function refreshFogThemeUI(id) {
  const lbl = _cpEl('cp-fogtheme-lbl');
  if (!lbl) return;
  const rec = fogThemeRecord(id === undefined ? fogTheme : id);
  lbl.textContent = t(rec.label);
  _cpEl('cp-fogtheme-sw').style.background = rec.swatch;
  document.querySelectorAll('#cp-pop-fogtheme [data-fogtheme]').forEach(b => b.classList.toggle('on', b.dataset.fogtheme === rec.id));
}

// ─── Weather: a preset dropdown under the title ──────────────────────────────
const _CP_WX_LABEL = { none: 'No weather', rain: 'Rain', storm: 'Storm', snowfall: 'Snowfall', blizzard: 'Blizzard', fair: 'Fair weather' };

function _cpInitWeather() {
  document.querySelectorAll('#cp-pop-wx [data-wx]').forEach(btn => {
    btn.addEventListener('click', () => { dockClosePop(); chooseWeather(btn.dataset.wx); });
  });
}

// `id` is the selected column's preset in two-map mode, where the shell holds none of its own.
function refreshWeatherUI(id) {
  const lbl = _cpEl('cp-wx-lbl');
  if (!lbl) return;
  const w = weatherNormalize(id === undefined ? weatherId : id);
  lbl.textContent = t(_CP_WX_LABEL[w]);
  const src = document.querySelector('#cp-pop-wx [data-wx="' + w + '"] .ic');
  if (src) _cpEl('cp-wx-ic').innerHTML = src.innerHTML;
  document.querySelectorAll('#cp-pop-wx [data-wx]').forEach(b => b.classList.toggle('on', b.dataset.wx === w));
}

// ─── Grid: the eye on the title, the type, the cells ─────────────────────────
function _cpInitGrid() {
  const TYPE_TO_BTN = { square: 'btn-grid-sq', 'hex-pointy': 'btn-grid-hptop' };
  document.querySelectorAll('#cp-gridtype-row [data-gtype]').forEach(btn => {
    btn.addEventListener('click', () => {
      _cpEl(TYPE_TO_BTN[btn.dataset.gtype]).click();       // sets gridMode
      if (!_cpOn('btn-grid')) _cpEl('btn-grid').click();  // picking a type turns the grid on
      setGridTypeUI();
    });
  });
  _cpEl('cp-grid-eye').addEventListener('click', () => _cpEl('btn-grid').click());
  _cpEl('btn-grid').addEventListener('click', setGridTypeUI);
}

function setGridTypeUI() {
  const row = _cpEl('cp-gridtype-row');
  if (!row) return;
  const m = document.querySelector('.grid-mode-btn.active');
  const type = m && m.id.endsWith('hptop') ? 'hex-pointy' : 'square';
  row.querySelectorAll('[data-gtype]').forEach(b => b.classList.toggle('active', b.dataset.gtype === type));
  const on = _cpOn('btn-grid');
  _cpEl('cp-grid-body').classList.toggle('dk-dim', !on);
  _cpSetEye('cp-grid-eye', on, 'Grid (G)');
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

// ─── Rooms: the names eye and the two sources ─────────────────────────────────
function _cpInitRooms() {
  _cpEl('cp-labels-eye').addEventListener('click', () => toggleRoomLabels());
  _cpEl('cp-src-module').addEventListener('click', () => openModuleTextModal());
  _cpEl('cp-module-clear').addEventListener('click', () => confirmDialog({
    title: 'Remove the module text?',
    message: t('The room names stop dropping down from “{name}”. Names already on rooms stay. Load it again any time.',
               { name: mtLoadedSourceName() }),
    confirmLabel: 'Remove',
    onConfirm: mtClearStored,
  }));
}

// ─── Lights: one eye for every light in the scene ────────────────────────────
function _cpInitLights() {
  _cpEl('cp-lights-eye').addEventListener('click', () => {
    if (paneForward('lights-toggle')) { setTimeout(refreshLightsControlUI, 120); return; }
    toggleLightsHidden();
  });
  _cpEl('btn-lights-redraw').addEventListener('click', () => {
    if (!paneForward('lights-plan')) drawPlanLights();
  });
}

function refreshLightsControlUI() {
  if (!_cpEl('cp-lights-eye')) return;
  _cpSetEye('cp-lights-eye', !paneScope().lightsHidden, 'Lights');
  const n = typeof planLightCount === 'function' ? paneScope().planLights : 0;
  const src = _cpEl('cp-src-lights');
  src.disabled = !(panesActive || currentScene);
  src.classList.toggle('none', !n);
  src.querySelector('.nm').textContent = n ? t.plural(n, 'Floor plan · {n} light', 'Floor plan · {n} lights') : t('Load floor plan…');
  _cpEl('btn-lights-redraw').disabled = !n;
}

// From toggleRoomLabels, refreshFloorPlanUI and every module-text load or removal.
function refreshRoomsControlUI() {
  if (!_cpEl('cp-labels-eye')) return;
  _cpSetEye('cp-labels-eye', showRoomLabels, 'Room names on my map (L)');
  const rooms = typeof floorPlanRoomCount === 'function' ? floorPlanRoomCount() : 0;
  _cpEl('cp-src-plan').classList.toggle('none', !rooms);
  _cpEl('cp-src-plan').querySelector('.nm').textContent =
    rooms ? t.plural(rooms, 'Floor plan · {n} room', 'Floor plan · {n} rooms') : t('Load floor plan…');
  const name = typeof mtLoadedSourceName === 'function' ? mtLoadedSourceName() : null;
  const mod = _cpEl('cp-src-module');
  mod.classList.toggle('none', !name);
  mod.querySelector('.nm').textContent = name || t('Load module text…');
  _cpEl('cp-module-clear').hidden = !name;
  mod.querySelector('.mt').textContent = name ? String(mtEntries.length) : '';
}

// ─── Scrub fields ─────────────────────────────────────────────────────────────
// A number you drag by its leading icon, Figma's way. It writes the field and fires the field's
// own input event (or `data-fire`'s, for a field that takes its value on change), so the app's
// handler is the one that takes the value.
function _cpInitScrubs() {
  document.querySelectorAll('#dock [data-scrub]').forEach(pre => {
    const input = _cpEl(pre.dataset.scrub);
    const min = +pre.dataset.min, max = +pre.dataset.max, per = +pre.dataset.per || 2;
    pre.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      const x0 = e.clientX, v0 = parseFloat(input.value) || min;
      const move = m => {
        const v = Math.max(min, Math.min(max, Math.round(v0 + (m.clientX - x0) / per)));
        if (String(v) === input.value) return;
        input.value = v;
        input.dispatchEvent(new Event(pre.dataset.fire || 'input', { bubbles: true }));
      };
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  });
  // A typed value is clamped on the way out, as the handler clamped what it took.
  [['grid-size-num', 10, 400], ['grid-thickness-num', 1, 10], ['fog-half-alpha-num', 0, 100], ['fog-feather-num', 0, 24]].forEach(([id, lo, hi]) => {
    const el = _cpEl(id);
    el.addEventListener('change', () => { el.value = Math.max(lo, Math.min(hi, parseInt(el.value) || lo)); });
    el.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') el.blur(); });
  });
}

// ─── Colour fields: what the picker holds, shown in the pane ─────────────────
function _cpPaintField(fieldId, colorId, alphaId) {
  const f = _cpEl(fieldId);
  if (!f) return;
  const hex = (_cpEl(colorId).value || '#000000').toUpperCase();
  f.querySelector('.cp-swatch').style.background = hex;
  f.querySelector('.cp-hex').textContent = hex.slice(1);
  f.querySelector('.cp-alphanum').textContent = _cpEl(alphaId).value;
}

function _cpPaintFields() {
  _cpPaintField('cp-grid-field', 'grid-color', 'grid-opacity');
}

function _cpInitFields() {
  // The picker writes the hidden inputs in #cp-legacy, so the field listens for them by id.
  const FEEDS = ['grid-color', 'grid-opacity', 'grid-opacity-num'];
  ['input', 'change'].forEach(ev => document.addEventListener(ev, e => {
    if (FEEDS.includes(e.target.id)) _cpPaintFields();
  }));
  document.addEventListener('dockpop', e => {
    if (e.detail === 'cp-pop-grid') _cpGridPicker.refresh();
  });
}

// ─── Reset buttons ────────────────────────────────────────────────────────────
// ⚠ Both ASK FIRST: the reset is an icon on the section title, so the question is the only
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
    ask('Grid type, size, colour and opacity go back to their defaults.', () => {
      _cpEl('btn-grid-reset').click(); // resets grid globals + legacy DOM
      refreshGridControlUI();
    });
  });

  // Weather, fog theme and feather go back together. Fog's half-shroud is not reset: it persists.
  _cpEl('cp-fog-reset').addEventListener('click', () => {
    ask('Weather goes back to No weather, and the fog theme and feather go back to Default and 12.', () => {
      const fire = (id, val) => { const el = _cpEl(id); if (el) { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); } };
      fire('fog-feather', 12);
      // ⚠ fog-half-alpha is NOT reset here: it persists, and a reset would overwrite a value
      // dialled in across sittings.
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
