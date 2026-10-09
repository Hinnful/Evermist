'use strict';
// controlPanel.js — the dock's Scene control pane: Fog, Rooms, Grid, Player and My seat.
//
// ⚠ A UI LAYER over the existing fog and grid wiring, never new logic. Every control drives the
// hidden input or button in #cp-legacy, so state mutation, scene persistence and player sync
// behave exactly as before. Called once from initToolbar(), DM only.

let _cpFogPicker = null;
let _cpGridPicker = null;

function initControlPanel() {
  if (typeof isPlayer !== 'undefined' && isPlayer) return;
  if (!document.getElementById('dock-pane-scene')) return;

  _cpInitMovement();
  _cpInitGrid();
  _cpInitRooms();
  _cpInitLights();
  _cpInitScrubs();
  _cpInitCompress();
  _cpFogPicker  = _cpMakePicker('fog',  'fog-color');
  _cpGridPicker = _cpMakePicker('grid', 'grid-color');
  _cpInitFields();
  _cpInitResets();
  _cpInitAdvPanel();
  _cpInitPlayer();
  _cpInitCalibrate();

  refreshFogControlUI();
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

// ─── Fog movement: a preset dropdown, then the eye ────────────────────────────
const _CP_PRESET_OF = { slow: 'calm', medium: 'default', fast: 'fast' };
const _CP_MOVE_LABEL = { slow: 'Slow drift', medium: 'Medium drift', fast: 'Fast drift', advanced: 'Custom' };

function _cpInitMovement() {
  const btnAdv = () => _cpEl('btn-anim-advanced');
  const closeAdv = () => { if (_cpOn('btn-anim-advanced')) btnAdv().click(); };
  document.querySelectorAll('#cp-pop-move [data-anim]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.anim;
      dockClosePop();
      if (mode === 'advanced') { if (!_cpOn('btn-anim-advanced')) btnAdv().click(); }
      else { closeAdv(); _cpEl('anim-preset-' + _CP_PRESET_OF[mode]).click(); }
      setAnimModeUI();
    });
  });
  _cpEl('cp-move-eye').addEventListener('click', () => _cpEl('btn-anim').click());
  // The A key clicks the legacy button too, so the pane follows the button rather than the eye.
  _cpEl('btn-anim').addEventListener('click', setAnimModeUI);
}

function _cpMoveMode() {
  if (_cpOn('btn-anim-advanced')) return 'advanced';
  const preset = document.querySelector('.anim-preset-btn.active');
  if (!preset) return 'advanced';   // dialled in by hand
  return preset.id.endsWith('calm') ? 'slow' : preset.id.endsWith('default') ? 'medium' : 'fast';
}

function setAnimModeUI() {
  const lbl = _cpEl('cp-move-lbl');
  if (!lbl) return;
  const mode = _cpMoveMode(), on = _cpOn('btn-anim');
  lbl.textContent = t(_CP_MOVE_LABEL[mode]);
  document.querySelectorAll('#cp-pop-move [data-anim]').forEach(b => b.classList.toggle('on', b.dataset.anim === mode));
  _cpEl('cp-move-row').classList.toggle('hidden', !on);
  _cpSetEye('cp-move-eye', on, 'Fog movement (A)');
  _cpUpdateAdvVisibility();
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
  _cpPaintField('cp-fog-field', 'fog-color', 'fog-tint-alpha');
  _cpPaintField('cp-grid-field', 'grid-color', 'grid-opacity');
}

function _cpInitFields() {
  // The picker writes the hidden inputs in #cp-legacy, so the field listens for them by id.
  const FEEDS = ['fog-color', 'fog-tint-alpha', 'fog-tint-alpha-num', 'grid-color', 'grid-opacity', 'grid-opacity-num'];
  ['input', 'change'].forEach(ev => document.addEventListener(ev, e => {
    if (FEEDS.includes(e.target.id)) _cpPaintFields();
  }));
  document.addEventListener('dockpop', e => {
    if (e.detail === 'cp-pop-fog') _cpFogPicker.refresh();
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

  // Fog has no single legacy reset — compose one: default colour + tint + feather + Default preset.
  _cpEl('cp-fog-reset').addEventListener('click', () => {
    ask('Fog colour, tint, feather and animation go back to their defaults.', () => {
      const fire = (id, val) => { const el = _cpEl(id); if (el) { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); } };
      fire('fog-color', '#3a3a8c');
      fire('fog-tint-alpha', 18);
      fire('fog-feather', 12);
      // ⚠ fog-half-alpha is NOT reset here: it persists, and a reset would overwrite a value
      // dialled in across sittings.
      _cpEl('anim-preset-default').click();
      refreshFogControlUI();
    });
  });
}

// ─── Custom movement: the dials, beside the dock ─────────────────────────────
function _cpInitAdvPanel() {
  _cpEl('cp-adv-close').addEventListener('click', () => {
    if (_cpOn('btn-anim-advanced')) _cpEl('btn-anim-advanced').click();
    setAnimModeUI();
  });
  document.addEventListener('dockpane', _cpUpdateAdvVisibility);
  window.addEventListener('resize', _cpUpdateAdvVisibility);
}

const _CP_DIALS = ['anim-speed', 'anim-morph-speed', 'anim-drift', 'anim-warp-str', 'anim-warp-rad', 'anim-alpha-amp'];
const _CP_DIAL_NUM = { 'anim-morph-speed': 'anim-morph-num', 'anim-warp-str': 'anim-warp-num' };

function _cpUpdateAdvVisibility() {
  const panel = _cpEl('anim-advanced-panel');
  if (!panel) return;
  const show = _cpOn('btn-anim-advanced') && dockActivePane() === 'scene';
  panel.hidden = !show;
  if (!show) return;
  dockPlacePop(panel, _cpEl('cp-move-row'));
  _cpSyncFancy(_CP_DIALS);
}

// ─── Slider fill/knob overlays ────────────────────────────────────────────────
// The <input type="range"> sits transparent over the wrapper and keeps its own value and wiring;
// these divs draw the visible track fill and knob. Bound on first sight.
function _cpSyncFancy(ids) {
  ids.forEach(id => {
    const range = _cpEl(id);
    const wrap = range && range.closest('.cp-slider');
    if (!wrap) return;
    if (!range._cpSync) {
      range._cpSync = () => {
        const min = +range.min || 0, max = +range.max || 100;
        const pct = max > min ? ((+range.value - min) / (max - min)) * 100 : 0;
        wrap.querySelector('.cp-slider-fill').style.width = pct + '%';
        wrap.querySelector('.cp-slider-knob').style.left = pct + '%';
      };
      range.addEventListener('input', range._cpSync);
      const num = _cpEl(_CP_DIAL_NUM[id] || id + '-num');
      if (num) ['input', 'change'].forEach(ev => num.addEventListener(ev, range._cpSync));
    }
    range._cpSync();
  });
}

// ─── Player ───────────────────────────────────────────────────────────────────
// Every visible control is a proxy that forwards its click to the hidden button in #cp-legacy, so
// the existing handlers and the Player protocol are untouched. Nothing here mutates player state.
function _cpInitPlayer() {
  const proxy = (fromId, toId) => {
    const el = _cpEl(fromId);
    if (!el) return;
    el.addEventListener('click', () => {
      const target = _cpEl(toId);
      if (target) target.click();
      refreshPlayerControlUI();
    });
  };
  proxy('cp-player-lock',       'btn-minimap-lock');
  proxy('cp-player-fullscreen', 'btn-fullscreen-player');
  proxy('cp-player-syncview',   'btn-sync-view');
  proxy('cp-player-send',       'btn-send');
  proxy('cp-player-golive',     'btn-player');

  // Auto / Manual is one legacy toggle behind two segments — only click it when the
  // pressed segment isn't already the live one, so the toggle can't be flipped away.
  document.querySelectorAll('#cp-pane-player [data-sync]').forEach(btn => {
    btn.addEventListener('click', () => {
      const wantAuto = btn.dataset.sync === 'auto';
      if (wantAuto !== _cpOn('btn-auto-sync')) _cpEl('btn-auto-sync').click();
      refreshPlayerControlUI();
    });
  });

  // My seat turns the laptop map only; the TV never sees it.
  document.querySelectorAll('#cp-sec-seat [data-seat]').forEach(btn => {
    btn.addEventListener('click', () => { setSeatTurn(+btn.dataset.seat); refreshPlayerControlUI(); });
  });

  // A Player window can close without telling us, so poll. Read-only.
  setInterval(refreshPlayerControlUI, 1000);
}

// ─── Reflection hooks (called from scene-restore paths) ───────────────────────
function refreshFogControlUI() {
  if (_cpFogPicker) _cpFogPicker.refresh();
  _cpPaintFields();
  _cpSyncFancy(_CP_DIALS);
  setAnimModeUI();
}

function refreshGridControlUI() {
  if (_cpGridPicker) _cpGridPicker.refresh();
  _cpPaintFields();
  setGridTypeUI();
}

// Mirrors player state onto the pane and the minimap. Reads only — the legacy buttons remain
// the source of truth (their .active classes are set by minimap.js / toolbar.js).
function refreshPlayerControlUI() {
  if (!_cpEl('cp-pane-player')) return;

  const locked = _cpOn('btn-minimap-lock');
  const lock = _cpEl('cp-player-lock');
  if (lock) {
    lock.classList.toggle('active', locked);
    lock.title = locked
      ? 'Minimap locked. Click to unlock'
      : "Lock the minimap so a stray drag can't move the view";
  }
  const panel = _cpEl('minimap-panel');
  if (panel) panel.classList.toggle('minimap-locked', locked);

  // Auto / Manual — Send is dimmed (still clickable) while Auto makes it redundant.
  const auto = _cpOn('btn-auto-sync');
  document.querySelectorAll('#cp-pane-player [data-sync]').forEach(b => {
    b.classList.toggle('active', (b.dataset.sync === 'auto') === auto);
  });
  const send = _cpEl('cp-player-send');
  if (send) send.classList.toggle('cp-dim', auto);
  document.querySelectorAll('#cp-sec-seat [data-seat]').forEach(b => b.classList.toggle('active', +b.dataset.seat === seatTurn));

  // One Player screen serves both columns, so in two-map mode these describe the shell.
  const scope = typeof paneScope === 'function' ? paneScope() : {};
  const live = (typeof panesActive !== 'undefined' && panesActive)
    ? stageIsOpen()
    : (!!scope.playerWindow && !scope.playerWindow.closed);

  // Fullscreen is a toggle, so it wears the on tint. A closed Player is never fullscreen
  // whatever the last report said.
  const fullscreen = live && !!scope.playerIsFullscreen;
  const fs = _cpEl('cp-player-fullscreen');
  if (fs) {
    fs.classList.toggle('active', fullscreen);
    fs.title = fullscreen
      ? 'Player window is fullscreen. Click to leave'
      : 'Fullscreen the Player window';
  }

  const go = _cpEl('cp-player-golive');
  if (go) {
    go.classList.toggle('live', live);
    go.title = live ? 'Close the Player window' : 'Open the Player window';
  }
  const lbl = _cpEl('cp-golive-lbl');
  if (lbl) lbl.textContent = live ? 'Close Window' : 'Open Window';
  const dot = _cpEl('dock-live');
  if (dot) dot.classList.toggle('on', live);
}
