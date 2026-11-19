'use strict';
// effectsRow.js — Effects mode's row: a well of its own Select and the shape button with its list, a divider, the
// material field (a button and its chevron on one grey field), then the size field of the shape, with no divider
// between them. No Snap or Straight walls here. The material field opens a palette of the materials that exist in
// Ground, Cloud and Marks sections, over a "Find a material" field. The size field steps one grid square (5 ft) at a
// time: drag its arrows, type, scroll, or [ ]; it stops at both ends. Its chevron lists the sizes largest first, "By
// hand" last for the shapes that have it. The buttons in #material-row are the back end that holds each
// material's name, glyph and id; a pick calls setMaterial (toolbar.js), or setPickedMaterial from a popup.

const SIZE_SCRUB_PX = 14;   // pointer travel for one step while scrubbing

function initEffectsRow() {
  const pal = document.createElement('div');
  pal.id = 'mat-pal';
  pal.hidden = true;
  pal.innerHTML = '<input id="mat-find" placeholder="' + t('Find a material') + '" spellcheck="false" autocomplete="off"><div id="mat-grid"></div>';
  document.getElementById('context-row').appendChild(pal);
  pal.querySelector('#mat-find').addEventListener('input', _renderPalette);
  pal.addEventListener('mousedown', e => e.stopPropagation());
  document.addEventListener('mousedown', e => { if (!pal.hidden && !e.target.closest('#mat-pick, #fxp-mat')) pal.hidden = true; });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !pal.hidden) { pal.hidden = true; e.stopImmediatePropagation(); }
  }, true);
  _buildShapeWell();
  refreshMaterialButton();
}

// The well: the row's own Select, then one button wearing the effect shape in hand with the Room button's arrow,
// whose list holds all seven shapes and their keys. A click on the shape arms it at the current size (effectsTool.js).
function _buildShapeWell() {
  const box = document.getElementById('fx-shapes');
  if (!box) return;
  box.innerHTML = '<span class="fx-track"><button type="button" class="mode-btn" data-fxshape="select" title="' + t('Select (V)') + '">' +
    document.getElementById('btn-select').querySelector('svg').outerHTML + '</button>' +
    '<button type="button" class="mode-btn fx-shape"></button>' +
    '<button type="button" class="tb-chev fx-chev" title="' + t('Shapes') + '">' + uiIcon('chev', 8, 2.2) + '</button></span>';
  box.querySelector('[data-fxshape="select"]').onclick = e => { e.currentTarget.blur(); setShape('select'); reportPaneTool(); };
  const shapeBtn = box.querySelector('.fx-shape');
  shapeBtn.onclick = e => { e.currentTarget.blur(); effectsToolArm(effectsShape); };
  shapeBtn.oncontextmenu = e => { e.preventDefault(); openFxShapeList(); };
  box.querySelector('.fx-chev').onclick = e => {
    e.stopPropagation();
    if (_tbOpen === 'fxshape') _tbCloseList(); else openFxShapeList();
  };
  refreshFxShapeWell();
}

// The seven effect shapes and their keys, over the well: its arrow, a right-click on its shape or on the bar's Effects.
function openFxShapeList() {
  const box = document.getElementById('fx-shapes');
  if (!box || !box.querySelector('.fx-chev')) return;
  const rows = FX_SHAPE_ORDER.map(s => ['btn-' + s, _fxShapeName(s), SHAPE_ROWS[s][1], false,
    document.getElementById('btn-' + s).querySelector('svg').outerHTML]);
  openBarList('fxshape', box, box.querySelector('.fx-chev'), rows, 'btn-' + effectsShape, id => effectsToolArm(id.slice(4)));
}

function _fxShapeName(s) { return t(s === 'rect' ? 'Square' : SHAPE_ROWS[s][0]); }

let _fxWorn = '';   // the shape the well's button last wore
function refreshFxShapeWell() {
  const box = document.getElementById('fx-shapes');
  const btn = box && box.querySelector('.fx-shape');
  if (!btn) return;
  const fx = placeMode === 'effects';
  box.querySelector('[data-fxshape="select"]').classList.toggle('active', fx && shape === 'select');
  btn.classList.toggle('active', fx && shape === effectsShape);
  if (_fxWorn === effectsShape) return;
  _fxWorn = effectsShape;
  btn.dataset.fxshape = effectsShape;
  const key = SHAPE_ROWS[effectsShape][1];
  btn.title = _fxShapeName(effectsShape) + (key ? ' (' + key + ')' : '');
  btn.innerHTML = document.getElementById('btn-' + effectsShape).querySelector('svg').outerHTML;
}

// The materials that exist, read off the back-end buttons: [id, name, glyph].
function effectsMaterials() {
  return Array.from(document.querySelectorAll('#material-row [data-material]')).map(b =>
    [b.dataset.material, b.title.split(' - ')[0], b.querySelector('svg').outerHTML]);
}

function refreshMaterialButton() {
  const box = document.getElementById('mat-pick');
  if (!box) return;
  const m = effectsMaterials().find(x => x[0] === currentMaterial) || effectsMaterials()[0];
  if (!m) return;
  box.innerHTML = '<button type="button" class="mt-btn mt-named" title="' + t(m[1]) + ' - ' + t('click for every material') + '" style="color:' + effectsMaterialColor(m[0]) + '">' + m[2] + '<span></span></button>' +
    '<button type="button" class="tb-chev mt-chev" title="' + t('Every material') + '">' + uiIcon('chev', 8, 2.2) + '</button>';
  box.querySelector('.mt-btn span').textContent = t(m[1]);
  box.querySelectorAll('button').forEach(b => b.onclick = e => { e.stopPropagation(); toggleMaterialPalette(); });
}

// The palette opens above whichever field asked: the row's, or a picked effect's or light's popup (`host`,
// effectPopup.js), which ticks that shape's material, `on`, and sets that shape alone, Light included.
// `noLight` greys Light: an effect of several pieces cannot turn into one.
function toggleMaterialPalette(host, on, noLight) {
  const pal = document.getElementById('mat-pal');
  const to = host || document.getElementById('context-row');
  if (!pal.hidden && pal.parentNode === to) { pal.hidden = true; return; }
  to.appendChild(pal);
  pal.dataset.picked = host ? '1' : '';
  pal.dataset.on = on || '';
  pal.dataset.nolight = noLight ? '1' : '';
  pal.hidden = false;
  const find = pal.querySelector('#mat-find');
  find.value = '';
  _renderPalette();
  find.focus();
}

// The palette's sections in order, each a material's `group`; Light is a mark.
const MAT_SECTIONS = [['ground', 'Ground'], ['cloud', 'Cloud'], ['marks', 'Marks']];
function _materialGroup(id) { return id === 'light' ? 'marks' : effectMaterial(id).group; }

// The materials under their section headings. Search runs across all three, and a section with no match hides its heading.
function _renderPalette() {
  const pal = document.getElementById('mat-pal');
  const q = pal.querySelector('#mat-find').value.trim().toLowerCase();
  const grid = pal.querySelector('#mat-grid');
  grid.innerHTML = '';
  const shown = effectsMaterials().filter(m => !q || t(m[1]).toLowerCase().indexOf(q) >= 0 || m[1].toLowerCase().indexOf(q) >= 0);
  for (const [group, title] of MAT_SECTIONS) {
    const inGroup = shown.filter(m => _materialGroup(m[0]) === group);
    if (!inGroup.length) continue;
    const head = document.createElement('div');
    head.className = 'mt-sec';
    head.dataset.group = group;
    head.textContent = t(title);
    grid.appendChild(head);
    for (const [id, name, glyph] of inGroup) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mt-tile' + (id === (pal.dataset.on || currentMaterial) ? ' on' : '');
      b.dataset.material = id;
      b.innerHTML = '<span style="color:' + effectsMaterialColor(id) + '">' + glyph + '</span><span></span>';
      b.lastChild.textContent = t(name);
      b.onclick = () => { if (pal.dataset.picked) setPickedMaterial(id); else setMaterial(id); pal.hidden = true; };
      if (id === 'light' && pal.dataset.nolight) { b.disabled = true; b.title = t('An effect of several pieces cannot become a light'); }
      grid.appendChild(b);
    }
  }
  if (!shown.length) {
    const none = document.createElement('div');
    none.className = 'mt-none';
    none.textContent = t('No material called "{q}"', { q: pal.querySelector('#mat-find').value });
    grid.appendChild(none);
  }
}

// ─── The size field ───────────────────────────────────────────────────────────

// The shape the size field speaks for: the one in hand, or with Select the well's shape, at the last size.
function effectsSizeKind() {
  if (placeMode !== 'effects') return null;
  const k = shape === 'select' ? effectsShape : shape;
  return EFFECT_PRESETS[k] ? k : null;
}
function _sizeList() { const k = effectsSizeKind(); return k ? EFFECT_PRESETS[k] : null; }

// A size picked with Select in hand arms the well's shape at it, ready to place.
function _sizeSet(z) {
  const kind = effectsSizeKind();
  if (shape !== kind) setShape(kind);
  setPreset(z ? { kind, ...z } : null);
  reportPaneTool();
}
function _sizeStep(dir, stayArmed) {
  if (shape === 'select') effectsToolArm(effectsShape);
  stepPreset(dir, stayArmed);
}

// Built once per shape, then only updated, so a scrub or a typed number keeps its element.
function refreshPresetRow() {
  const row = document.getElementById('ctx-presets');
  if (!row) return;
  const list = _sizeList();
  if (!list) { row.innerHTML = ''; row.dataset.kind = ''; return; }
  const kind = effectsSizeKind();
  if (row.dataset.kind !== kind) _buildSizeField(row, kind);
  const field = row.querySelector('.sz-field');
  const armed = presetArmed && presetArmed.kind === kind ? presetArmed : shape === 'select' ? presetForSize(kind, effectsSize) : null;
  field.classList.toggle('hand', !armed);
  if (armed) {
    const input = field.querySelector('.sz-in');
    if (document.activeElement !== input) input.value = armed.s;
  }
}

function _buildSizeField(row, kind) {
  row.dataset.kind = kind;
  const hasHand = !!PRESET_HAS_HAND[kind];
  const hand = document.getElementById('btn-' + kind).innerHTML.replace('<svg', '<svg stroke-dasharray="2.6 2.4"');
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
  const wheelSt = wheelState();
  let wheelAcc = 0;
  field.onwheel = e => {
    e.preventDefault();
    const r = wheelSteps(classifyWheel(e, wheelSt, e.timeStamp), e.deltaY, wheelAcc);
    wheelAcc = r.acc;
    for (let i = 0; i < Math.abs(r.steps); i++) _sizeStep(r.steps > 0 ? 1 : -1, true);
  };
  field.querySelector('.sz-scrub').onmousedown = e => {
    e.preventDefault();
    let x0 = e.clientX;
    const move = ev => {
      if (Math.abs(ev.clientX - x0) < SIZE_SCRUB_PX) return;
      _sizeStep(ev.clientX > x0 ? 1 : -1);
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
  _sizeSet(list.find(z => z.s === s));
}

function _openSizeList(chev, hasHand, handGlyph) {
  const list = _sizeList();
  if (!list) return;
  const kind = effectsSizeKind();
  const cur = presetArmed && presetArmed.kind === kind ? String(presetArmed.s) : shape === 'select' ? String(presetForSize(kind, effectsSize).s) : 'hand';
  const rows = list.slice().reverse().map(z => [String(z.s), presetSizeText(z.s, t, t.plural), '', false, '']);
  if (hasHand) rows.push(['hand', t('By hand'), '', false, handGlyph]);
  openBarList('sizes', chev, chev, rows, cur, id => _sizeSet(id === 'hand' ? null : list.find(z => String(z.s) === id)));
}
