'use strict';
// controlPanel.js — DM-only tabbed Fog / Grid / Player control panel UI.
//
// ⚠ A UI LAYER over the existing fog and grid wiring, never new logic. Every control drives the
// pre-existing hidden input or button, so state mutation, scene persistence and player sync behave
// exactly as before. What lives here is presentation: tab switching, the two HSV colour pickers,
// the animation-mode and grid-type icon rows, the slider fill and knob overlays, and the floating
// Advanced Settings panel.
//
// refreshFogControlUI() and refreshGridControlUI() are called from the scene-restore paths, so the
// panel tracks the active scene on a switch.
//
// Called once from initToolbar(), DM only.

let _cpFogPicker = null;
let _cpGridPicker = null;

function initControlPanel() {
  if (typeof isPlayer !== 'undefined' && isPlayer) return;
  if (!document.getElementById('sidebar-right')) return;

  _cpInitTabs();
  _cpInitAnimRow();
  _cpInitGridTypeRow();
  _cpInitFancySliders();
  _cpFogPicker  = _cpMakePicker('fog',  'fog-color');
  _cpGridPicker = _cpMakePicker('grid', 'grid-color');
  _cpInitResets();
  _cpInitAdvPanel();
  _cpInitPlayer();

  refreshFogControlUI();
  refreshGridControlUI();
  refreshPlayerControlUI();
}

// ─── Colour maths (HSV ⇄ hex) ─────────────────────────────────────────────────
function _cpHexToRgb(hex) {
  hex = String(hex || '').replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  if (hex.length !== 6) hex = '000000';
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function _cpRgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx];
}
function _cpHsvToRgb(h, s, v) {
  const i = Math.floor(h / 60) % 6, f = h / 60 - Math.floor(h / 60);
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i]
    .map(x => Math.round(x * 255));
}
function _cpHsvToHex(h, s, v) {
  return '#' + _cpHsvToRgb(h, s, v).map(x => x.toString(16).padStart(2, '0')).join('');
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function _cpInitTabs() {
  document.querySelectorAll('.cp-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      document.querySelectorAll('.cp-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.cp-pane').forEach(p => { p.hidden = p.id !== 'cp-pane-' + name; });
      _cpUpdateAdvVisibility();
      if (name === 'fog'  && _cpFogPicker)  _cpFogPicker.refresh();
      if (name === 'grid' && _cpGridPicker) _cpGridPicker.refresh();
      if (name === 'player') refreshPlayerControlUI();
    });
  });
}

function _cpActiveTab() {
  const t = document.querySelector('.cp-tab.active');
  return t ? t.dataset.tab : 'fog';
}

// ─── HSV colour picker ────────────────────────────────────────────────────────
// Drives the hidden `<input type="color">` by setting its value and dispatching 'input', so the
// existing wiring runs unchanged. The alpha slider is the pre-existing tint input; this only
// paints the gradient and hex field to match.
function _cpMakePicker(type, colorInputId) {
  const root = document.querySelector('.cp-picker[data-picker="' + type + '"]');
  if (!root) return null;
  const canvas = root.querySelector('.cp-sv-canvas');
  const ctx    = canvas.getContext('2d');
  const cursor = root.querySelector('.cp-sv-cursor');
  const hueEl  = root.querySelector('.cp-hue');
  const alphaEl = root.querySelector('.cp-alpha');
  const swatch = root.querySelector('.cp-swatch');
  const hexEl  = root.querySelector('.cp-hex');
  const p = { h: 0, s: 0, v: 0 };
  let dragging = false;
  let svBox = null; // canvas box, captured at drag start (see pick())

  function drawSV() {
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = 'hsl(' + p.h + ',100%,50%)';
    ctx.fillRect(0, 0, w, h);
    let g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  function syncVisual() {
    drawSV();
    cursor.style.left = (p.s * 100) + '%';
    cursor.style.top  = ((1 - p.v) * 100) + '%';
    if (document.activeElement !== hueEl) hueEl.value = Math.round(p.h);
    const hex = _cpHsvToHex(p.h, p.s, p.v);
    swatch.style.background = hex;
    if (document.activeElement !== hexEl) hexEl.value = hex.slice(1).toUpperCase();
    if (alphaEl) {
      // Transparent → selected colour over a checkerboard, so the track reflects the pick and
      // stays visible on pure black. ⚠ Two offset 45° linear-gradients, never a conic gradient,
      // which fringes colour at the track edges on this Chromium.
      const rgb = _cpHexToRgb(hex).join(',');
      const checker = 'linear-gradient(45deg, #2b2b2b 25%, transparent 25%, transparent 75%, #2b2b2b 75%)';
      alphaEl.style.backgroundImage =
        'linear-gradient(to right, rgba(' + rgb + ',0), rgb(' + rgb + ')), ' + checker + ', ' + checker;
      alphaEl.style.backgroundSize = 'auto, 10px 10px, 10px 10px';
      alphaEl.style.backgroundPosition = '0 0, 0 0, 5px 5px';
    }
  }
  function commit() {
    const hex = _cpHsvToHex(p.h, p.s, p.v);
    const inp = document.getElementById(colorInputId);
    if (inp) { inp.value = hex; inp.dispatchEvent(new Event('input', { bubbles: true })); }
    syncVisual();
  }
  function pick(e) {
    // The SV canvas sits under an ancestor CSS `zoom`, which this Chromium folds into
    // getBoundingClientRect, so the box shares the pointer's space. Captured at drag start:
    // reading it every mousemove forces a layout.
    if (e.type === 'mousedown') svBox = canvas.getBoundingClientRect();
    if (!svBox || !svBox.width) return;
    p.s = Math.max(0, Math.min(1, (e.clientX - svBox.left) / svBox.width));
    p.v = Math.max(0, Math.min(1, 1 - (e.clientY - svBox.top) / svBox.height));
    commit();
  }

  canvas.addEventListener('mousedown', e => { dragging = true; pick(e); e.preventDefault(); });
  window.addEventListener('mousemove', e => { if (dragging) pick(e); });
  window.addEventListener('mouseup',   () => { dragging = false; });
  hueEl.addEventListener('input', () => { p.h = +hueEl.value; commit(); });
  hexEl.addEventListener('change', () => {
    let v = hexEl.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
    if (v.length === 3) v = v.split('').map(c => c + c).join('');
    if (v.length === 6) { const hsv = _cpRgbToHsv.apply(null, _cpHexToRgb(v)); p.h = hsv[0]; p.s = hsv[1]; p.v = hsv[2]; commit(); }
    else syncVisual();
  });
  hexEl.addEventListener('keydown', e => { if (e.key === 'Enter') hexEl.blur(); });

  return {
    refresh() {
      const inp = document.getElementById(colorInputId);
      const hsv = _cpRgbToHsv.apply(null, _cpHexToRgb(inp ? inp.value : '#000000'));
      p.h = hsv[0]; p.s = hsv[1]; p.v = hsv[2];
      syncVisual();
    },
  };
}

// ─── Animation-mode icon row (Off / Slow / Medium / Fast / Advanced) ──────────
function _cpInitAnimRow() {
  const row = document.getElementById('cp-anim-row');
  if (!row) return;
  const btnAnim = () => document.getElementById('btn-anim');
  const btnAdv  = () => document.getElementById('btn-anim-advanced');
  const closeAdv = () => { if (btnAdv().classList.contains('active')) btnAdv().click(); };

  row.querySelectorAll('[data-anim]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.anim;
      const animOn = btnAnim().classList.contains('active');
      if (mode === 'off') { closeAdv(); if (animOn) btnAnim().click(); }
      else if (mode === 'advanced') { btnAdv().click(); }
      else { closeAdv(); document.getElementById('anim-preset-' + (mode === 'slow' ? 'calm' : mode === 'medium' ? 'default' : 'fast')).click(); }
      setAnimModeUI();
    });
  });
}

function setAnimModeUI() {
  const row = document.getElementById('cp-anim-row');
  if (!row) return;
  const animOn = document.getElementById('btn-anim').classList.contains('active');
  const advOn  = document.getElementById('btn-anim-advanced').classList.contains('active');
  let active = 'off';
  if (advOn) active = 'advanced';
  else if (animOn) {
    const preset = document.querySelector('.anim-preset-btn.active');
    if (preset) active = preset.id.endsWith('calm') ? 'slow' : preset.id.endsWith('default') ? 'medium' : 'fast';
    else active = null; // enabled with custom (non-preset) settings
  }
  row.querySelectorAll('[data-anim]').forEach(b => b.classList.toggle('active', b.dataset.anim === active));
  _cpUpdateAdvVisibility();
}

// ─── Grid-type icon row (Off / Square / Hex-pointy / Hex-flat) ────────────────
function _cpInitGridTypeRow() {
  const row = document.getElementById('cp-gridtype-row');
  if (!row) return;
  const TYPE_TO_BTN = { square: 'btn-grid-sq', 'hex-pointy': 'btn-grid-hptop', 'hex-flat': 'btn-grid-hflat' };
  const btnGrid = () => document.getElementById('btn-grid');

  row.querySelectorAll('[data-gtype]').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.gtype;
      const gridOn = btnGrid().classList.contains('active');
      if (t === 'off') { if (gridOn) btnGrid().click(); }
      else {
        document.getElementById(TYPE_TO_BTN[t]).click();  // sets gridMode
        if (!btnGrid().classList.contains('active')) btnGrid().click(); // picking a type turns the grid on
      }
      setGridTypeUI();
    });
  });
}

function setGridTypeUI() {
  const row = document.getElementById('cp-gridtype-row');
  if (!row) return;
  const gridOn = document.getElementById('btn-grid').classList.contains('active');
  let active = 'off';
  if (gridOn) {
    const m = document.querySelector('.grid-mode-btn.active');
    active = !m ? 'square' : m.id.endsWith('sq') ? 'square' : m.id.endsWith('hptop') ? 'hex-pointy' : 'hex-flat';
  }
  row.querySelectorAll('[data-gtype]').forEach(b => b.classList.toggle('active', b.dataset.gtype === active));
}

// ─── Slider fill/knob overlays ────────────────────────────────────────────────
// The <input type="range"> sits transparent over the wrapper and keeps its own value and wiring;
// these divs draw the visible track fill and knob.
const _CP_FANCY = [
  ['grid-size', 'grid-size-num'],
  ['grid-thickness', 'grid-thickness-num'],
  ['anim-speed', 'anim-speed-num'],
  ['anim-morph-speed', 'anim-morph-num'],
  ['anim-drift', 'anim-drift-num'],
  ['anim-warp-str', 'anim-warp-num'],
  ['anim-warp-rad', 'anim-warp-rad-num'],
  ['anim-alpha-amp', 'anim-alpha-amp-num'],
  ['fog-feather', 'fog-feather-num'],
  ['fog-half-alpha', 'fog-half-alpha-num'],
];

function _cpFancy(range) {
  const wrap = range.closest('.cp-slider');
  if (!wrap) return;
  const fill = wrap.querySelector('.cp-slider-fill');
  const knob = wrap.querySelector('.cp-slider-knob');
  const sync = () => {
    const min = +range.min || 0, max = +range.max || 100;
    const pct = max > min ? ((+range.value - min) / (max - min)) * 100 : 0;
    if (fill) fill.style.width = pct + '%';
    if (knob) knob.style.left = pct + '%';
  };
  range.addEventListener('input', sync);
  range._cpSync = sync;
  sync();
}

function _cpInitFancySliders() {
  _CP_FANCY.forEach(([rid, nid]) => {
    const range = document.getElementById(rid);
    if (!range) return;
    _cpFancy(range);
    const num = document.getElementById(nid);
    if (num) ['input', 'change'].forEach(ev => num.addEventListener(ev, () => range._cpSync && range._cpSync()));
  });
}

function _cpSyncFancy(ids) {
  ids.forEach(id => { const el = document.getElementById(id); if (el && el._cpSync) el._cpSync(); });
}

// ─── Reset buttons ────────────────────────────────────────────────────────────
function _cpInitResets() {
  const gridReset = document.getElementById('cp-grid-reset');
  if (gridReset) gridReset.addEventListener('click', () => {
    document.getElementById('btn-grid-reset').click(); // resets grid globals + legacy DOM
    refreshGridControlUI();
  });

  // Fog has no single legacy reset — compose one: default colour + tint + feather + Default preset.
  const fogReset = document.getElementById('cp-fog-reset');
  if (fogReset) fogReset.addEventListener('click', () => {
    const fire = (id, val) => { const el = document.getElementById(id); if (el) { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); } };
    fire('fog-color', '#3a3a8c');
    fire('fog-tint-alpha', 18);
    fire('fog-feather', 12);
    // ⚠ fog-half-alpha is NOT reset here. It is the only dial in this panel that PERSISTS, so
    // resetting it overwrites a value dialled in across sittings.
    document.getElementById('anim-preset-default').click();
    refreshFogControlUI();
  });
}

// ─── Floating Advanced Settings panel ─────────────────────────────────────────
function _cpInitAdvPanel() {
  const close = document.getElementById('cp-adv-close');
  if (close) close.addEventListener('click', () => {
    if (document.getElementById('btn-anim-advanced').classList.contains('active')) document.getElementById('btn-anim-advanced').click();
    setAnimModeUI();
  });
  window.addEventListener('resize', _cpPositionAdvPanel);
  const uiScale = document.getElementById('ui-scale');
  if (uiScale) uiScale.addEventListener('input', _cpPositionAdvPanel);
}

function _cpUpdateAdvVisibility() {
  const panel = document.getElementById('anim-advanced-panel');
  if (!panel) return;
  const advOn = document.getElementById('btn-anim-advanced').classList.contains('active');
  const show = advOn && _cpActiveTab() === 'fog';
  panel.style.display = show ? 'block' : 'none';
  if (show) { _cpPositionAdvPanel(); _cpSyncFancy(['anim-speed', 'anim-morph-speed', 'anim-drift', 'anim-warp-str', 'anim-warp-rad', 'anim-alpha-amp', 'fog-feather', 'fog-half-alpha']); }
}

// Place the panel just left of the sidebar, measured off the sidebar's own box rather than a
// hard-coded width, which goes stale when the CSS changes.
const _CP_ADV_W = 270;   // #anim-advanced-panel CSS width (px)
const _CP_ADV_GAP = 8;   // gap between panel and sidebar (px)
function _cpPositionAdvPanel() {
  const panel = document.getElementById('anim-advanced-panel');
  if (!panel || panel.style.display === 'none') return;
  const sidebar = document.getElementById('sidebar-right');
  if (!sidebar) return;
  const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1.2;
  const box = sidebar.getBoundingClientRect();
  // The panel's own `zoom` means its style.left/top are in pre-zoom coordinates → divide by z.
  panel.style.left = ((box.left - _CP_ADV_GAP) / z - _CP_ADV_W) + 'px';
  panel.style.top  = (box.top / z) + 'px';
}

// ─── Player tab ───────────────────────────────────────────────────────────────
// Every visible control is a proxy that forwards its click to the hidden button in #cp-legacy, so
// the existing handlers and the Player protocol are untouched. Nothing here mutates player state.
function _cpInitPlayer() {
  const pane = document.getElementById('cp-pane-player');
  if (!pane) return;

  const proxy = (fromId, toId) => {
    const el = document.getElementById(fromId);
    if (!el) return;
    el.addEventListener('click', () => {
      const target = document.getElementById(toId);
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
  pane.querySelectorAll('[data-sync]').forEach(btn => {
    btn.addEventListener('click', () => {
      const legacy = document.getElementById('btn-auto-sync');
      if (!legacy) return;
      const wantAuto = btn.dataset.sync === 'auto';
      if (wantAuto !== legacy.classList.contains('active')) legacy.click();
      refreshPlayerControlUI();
    });
  });

  _cpInitZoom();

  // The Player window can close without telling us (no event on a cross-window close),
  // so poll while the tab is on screen. Read-only; no-ops when the pane is hidden.
  setInterval(() => { if (!pane.hidden) refreshPlayerControlUI(); }, 1000);
}

// Player-zoom stepper: − / + step by one wheel notch, the field takes a typed percentage. Both go
// through minimapSetZoom(), the same path as wheel-zooming the minimap.
function _cpInitZoom() {
  const field = document.getElementById('cp-zoom-num');
  const dec = document.getElementById('cp-zoom-dec');
  const inc = document.getElementById('cp-zoom-inc');
  if (!field || typeof minimapNudgeZoom !== 'function') return;

  if (dec) dec.addEventListener('click', () => { minimapNudgeZoom(-1); refreshPlayerZoomUI(); });
  if (inc) inc.addEventListener('click', () => { minimapNudgeZoom(1);  refreshPlayerZoomUI(); });

  const commit = () => {
    const pct = parseFloat(field.value.replace(/[^0-9.]/g, ''));
    if (isFinite(pct) && pct > 0) minimapSetZoom(pct / 100);
    field.blur();
    refreshPlayerZoomUI();  // snaps the field back to the clamped value
  };
  field.addEventListener('change', commit);
  field.addEventListener('keydown', e => {
    if (e.key === 'Enter') { commit(); return; }
    // Arrow keys step like the buttons rather than editing the text.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      minimapNudgeZoom(e.key === 'ArrowUp' ? 1 : -1);
      refreshPlayerZoomUI();
    }
  });
}

// Writes the live zoom into the field. Called from minimap.js's _markDirty() so wheel,
// drag, Sync View and Player free-look all keep it current. Skipped mid-typing.
function refreshPlayerZoomUI() {
  const field = document.getElementById('cp-zoom-num');
  if (!field || typeof minimapGetZoom !== 'function') return;
  if (document.activeElement === field) return;
  field.value = String(Math.round(minimapGetZoom() * 100));
}

// ─── Reflection hooks (called from scene-restore paths) ───────────────────────
function refreshFogControlUI() {
  if (_cpFogPicker) _cpFogPicker.refresh();
  _cpSyncFancy(['anim-speed', 'anim-morph-speed', 'anim-drift', 'anim-warp-str', 'anim-warp-rad', 'anim-alpha-amp', 'fog-feather', 'fog-half-alpha']);
  setAnimModeUI();
}

function refreshGridControlUI() {
  if (_cpGridPicker) _cpGridPicker.refresh();
  _cpSyncFancy(['grid-size', 'grid-thickness']);
  setGridTypeUI();
}

// Mirrors player state onto the Player tab. Reads only — the legacy buttons remain
// the source of truth (their .active classes are set by minimap.js / toolbar.js).
function refreshPlayerControlUI() {
  const pane = document.getElementById('cp-pane-player');
  if (!pane) return;
  const legacyActive = id => {
    const el = document.getElementById(id);
    return !!el && el.classList.contains('active');
  };

  // Lock — closed padlock + blue box when locked; the preview loses its grab cursor.
  const locked = legacyActive('btn-minimap-lock');
  const lock = document.getElementById('cp-player-lock');
  if (lock) {
    lock.classList.toggle('active', locked);
    lock.title = locked
      ? 'Minimap locked. Click to unlock'
      : "Lock the minimap so a stray drag can't move the view";
  }
  const panel = document.getElementById('minimap-panel');
  if (panel) panel.classList.toggle('minimap-locked', locked);

  // Auto / Manual — Send is dimmed (still clickable) while Auto makes it redundant.
  const auto = legacyActive('btn-auto-sync');
  pane.querySelectorAll('[data-sync]').forEach(b => {
    b.classList.toggle('active', (b.dataset.sync === 'auto') === auto);
  });
  const send = document.getElementById('cp-player-send');
  if (send) send.classList.toggle('cp-dim', auto);

  // Go-live button — the blue outline + fill is the whole live indicator, and the label
  // swaps to Close so the toggle is discoverable. No dot: the fill already says it.
  const live = typeof playerWindow !== 'undefined' && !!playerWindow && !playerWindow.closed;

  // Fullscreen is a toggle, so it wears the on/off box. The state comes from the Player relaying
  // main.js, and a closed Player is never fullscreen whatever the last report said.
  const fullscreen = live && typeof playerIsFullscreen !== 'undefined' && playerIsFullscreen;
  const fs = document.getElementById('cp-player-fullscreen');
  if (fs) {
    fs.classList.toggle('active', fullscreen);
    fs.title = fullscreen
      ? 'Player window is fullscreen. Click to leave'
      : 'Fullscreen the Player window';
  }

  const go = document.getElementById('cp-player-golive');
  if (go) {
    go.classList.toggle('live', live);
    go.title = live ? 'Close the Player window' : 'Open the Player window';
  }
  const lbl = document.getElementById('cp-golive-lbl');
  if (lbl) lbl.textContent = live ? 'Close Window' : 'Open Window';

  refreshPlayerZoomUI();
}
