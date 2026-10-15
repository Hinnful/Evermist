'use strict';
// effectsRow.js — Effects mode's row: one material button with a chevron, then the size field of the
// picked shape, with no divider between them. The material button opens a palette of the materials that
// exist, over a "Find a material" field. The size field steps one grid square (5 ft) at a time: drag its
// arrows, type, scroll, or [ ]; it stops at both ends. Its chevron lists the sizes largest first, "By
// hand" last for the shapes that have it. The buttons in #material-row are the back end that holds each
// material's name, glyph and id; setMaterial (toolbar.js) is what a pick calls.

const FX_MATERIAL_TINT = { fire: '#ff8a3d', acid: '#9be33a', light: '#ffe9a8' };
const SIZE_SCRUB_PX = 14;   // pointer travel for one step while scrubbing

function initEffectsRow() {
  const pal = document.createElement('div');
  pal.id = 'mat-pal';
  pal.hidden = true;
  pal.innerHTML = '<input id="mat-find" placeholder="' + t('Find a material') + '" spellcheck="false" autocomplete="off"><div id="mat-grid"></div>';
  document.getElementById('context-row').appendChild(pal);
  pal.querySelector('#mat-find').addEventListener('input', _renderPalette);
  pal.addEventListener('mousedown', e => e.stopPropagation());
  document.addEventListener('mousedown', e => { if (!pal.hidden && !e.target.closest('#mat-pick')) pal.hidden = true; });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !pal.hidden) { pal.hidden = true; e.stopImmediatePropagation(); }
  }, true);
  refreshMaterialButton();
}

// The materials that exist, read off the back-end buttons: [id, name, glyph].
function _materials() {
  return Array.from(document.querySelectorAll('#material-row [data-material]')).map(b =>
    [b.dataset.material, b.title.split(' - ')[0], b.querySelector('svg').outerHTML]);
}

function refreshMaterialButton() {
  const box = document.getElementById('mat-pick');
  if (!box) return;
  const m = _materials().find(x => x[0] === currentMaterial) || _materials()[0];
  if (!m) return;
  box.innerHTML = '<button type="button" class="mt-btn" title="' + t(m[1]) + ' - ' + t('click for every material') + '" style="color:' + FX_MATERIAL_TINT[m[0]] + '">' + m[2] + '</button>' +
    '<button type="button" class="tb-chev mt-chev" title="' + t('Every material') + '">' + uiIcon('chev', 8, 2.2) + '</button>';
  box.querySelectorAll('button').forEach(b => b.onclick = e => { e.stopPropagation(); _togglePalette(); });
}

function _togglePalette() {
  const pal = document.getElementById('mat-pal');
  pal.hidden = !pal.hidden;
  if (pal.hidden) return;
  const find = pal.querySelector('#mat-find');
  find.value = '';
  _renderPalette();
  find.focus();
}

function _renderPalette() {
  const pal = document.getElementById('mat-pal');
  const q = pal.querySelector('#mat-find').value.trim().toLowerCase();
  const grid = pal.querySelector('#mat-grid');
  grid.innerHTML = '';
  const shown = _materials().filter(m => !q || t(m[1]).toLowerCase().indexOf(q) >= 0 || m[1].toLowerCase().indexOf(q) >= 0);
  for (const [id, name, glyph] of shown) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mt-tile' + (id === currentMaterial ? ' on' : '');
    b.dataset.material = id;
    b.innerHTML = '<span style="color:' + FX_MATERIAL_TINT[id] + '">' + glyph + '</span><span></span>';
    b.lastChild.textContent = t(name);
    b.onclick = () => { setMaterial(id); pal.hidden = true; };
    grid.appendChild(b);
  }
  if (!shown.length) {
    const none = document.createElement('div');
    none.className = 'mt-none';
    none.textContent = t('No material called "{q}"', { q: pal.querySelector('#mat-find').value });
    grid.appendChild(none);
  }
}

// ─── The size field ───────────────────────────────────────────────────────────

function _sizeList() { return placeMode === 'effects' ? EFFECT_PRESETS[shape] : null; }

// Built once per shape, then only updated, so a scrub or a typed number keeps its element.
function refreshPresetRow() {
  const row = document.getElementById('ctx-presets');
  if (!row) return;
  const list = _sizeList();
  if (!list) { row.innerHTML = ''; row.dataset.kind = ''; return; }
  if (row.dataset.kind !== shape) _buildSizeField(row);
  const field = row.querySelector('.sz-field');
  const armed = presetArmed && presetArmed.kind === shape ? presetArmed : null;
  field.classList.toggle('hand', !armed);
  if (armed) {
    const input = field.querySelector('.sz-in');
    if (document.activeElement !== input) input.value = armed.s;
  }
}

function _buildSizeField(row) {
  row.dataset.kind = shape;
  const hasHand = !!PRESET_HAS_HAND[shape];
  const hand = document.getElementById('btn-' + shape).innerHTML.replace('<svg', '<svg stroke-dasharray="2.6 2.4"');
  row.innerHTML = '<span id="fx-sizes"><span class="sz-field" title="' + t(hasHand
      ? 'Size in feet - drag the arrows, type, or scroll; one step is one grid square. Below the smallest: draw it by hand'
      : 'Size in feet - drag the arrows, type, or scroll; one step is one grid square') + '">' +
    '<span class="sz-scrub">' + uiIcon('scrub', 14, 1.7) + '</span>' +
    '<span class="sz-handv">' + hand + '</span>' +
    '<input class="sz-in" spellcheck="false" autocomplete="off"><span class="sz-unit">ft</span>' +
    '<button type="button" class="tb-chev sz-chev" title="' + t('The usual sizes') + '">' + uiIcon('chev', 8, 2.2) + '</button></span></span>';
  const field = row.querySelector('.sz-field');
  const input = field.querySelector('.sz-in');
  input.onchange = () => _typeSize(input);
  input.onkeydown = e => { if (e.key === 'Enter') input.blur(); };
  field.onwheel = e => { e.preventDefault(); stepPreset(e.deltaY < 0 ? 1 : -1); };
  field.querySelector('.sz-scrub').onmousedown = e => {
    e.preventDefault();
    let x0 = e.clientX;
    const move = ev => {
      if (Math.abs(ev.clientX - x0) < SIZE_SCRUB_PX) return;
      stepPreset(ev.clientX > x0 ? 1 : -1);
      x0 = ev.clientX;
    };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  };
  const chev = field.querySelector('.sz-chev');
  chev.onclick = e => {
    e.stopPropagation();
    if (_tbOpen === 'sizes') { _tbCloseList(); return; }
    _openSizeList(chev, hasHand, hand);
  };
}

// A typed size lands on the nearest grid square inside the shape's range.
function _typeSize(input) {
  const list = _sizeList();
  const n = parseFloat(String(input.value).replace(',', '.'));
  if (!list || !isFinite(n)) { refreshPresetRow(); return; }
  const lo = list[0].s, hi = list[list.length - 1].s;
  const s = Math.max(lo, Math.min(hi, Math.round(n / GRID_FT) * GRID_FT));
  setPreset({ kind: shape, ...list.find(z => z.s === s) });
  reportPaneTool();
}

function _openSizeList(chev, hasHand, handGlyph) {
  const list = _sizeList();
  if (!list) return;
  const cur = presetArmed && presetArmed.kind === shape ? String(presetArmed.s) : 'hand';
  const rows = list.slice().reverse().map(z => [String(z.s), presetSizeText(z.s, t, t.plural), '', false, '']);
  if (hasHand) rows.push(['hand', t('By hand'), '', false, handGlyph]);
  openBarList('sizes', chev, chev, rows, cur, id => {
    if (id === 'hand') setPreset(null);
    else setPreset({ kind: shape, ...list.find(z => String(z.s) === id) });
    reportPaneTool();
  });
}
