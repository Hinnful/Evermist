'use strict';
// effectPopup.js — a picked effect's or light's own controls, on the map just above it, as a room's clouds and
// door are (roomSwitcher.js): its material field and its size field. The material opens the row's palette over
// this popup and sets that shape alone through setPickedMaterial, Light moving it between the two lists. Size resizes
// a placed effect at its own origin (presetGeometry.js's presetResized), one undo step a change. One drawn,
// reshaped or combined by hand reads "By hand" and its size is greyed. On the single map only. doRender calls
// refreshEffectPopup.

const FXP_SCRUB_PX = 14;   // pointer travel for one step while scrubbing, as in the row

function initEffectPopup() {
  const el = document.getElementById('fx-pop');
  if (!el) return;
  el.innerHTML = '<span class="tb-group" id="fxp-mat"><button type="button" class="mt-btn mt-named"><span class="fxp-glyph"></span><span class="fxp-name"></span></button>' +
    '<button type="button" class="tb-chev mt-chev" title="' + t('Every material') + '">' + uiIcon('chev', 8, 2.2) + '</button></span>' +
    '<span id="fxp-size"><span class="sz-field">' +
    '<span class="sz-scrub">' + uiIcon('scrub', 14, 1.7) + '</span>' +
    '<input class="sz-in" spellcheck="false" autocomplete="off"><span class="sz-unit">' + t('ft') + '</span>' +
    '<span class="sz-hand"></span>' +
    '<button type="button" class="tb-chev sz-chev" title="' + t('The usual sizes') + '">' + uiIcon('chev', 8, 2.2) + '</button></span></span>';
  el.addEventListener('mousedown', e => e.stopPropagation());
  el.querySelector('.sz-hand').textContent = t('By hand');
  el.querySelectorAll('#fxp-mat button').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const rec = _fxpRec();
    if (rec) toggleMaterialPalette(el, rec.light ? 'light' : rec.material);
  });
  const field = el.querySelector('.sz-field'), input = field.querySelector('.sz-in');
  input.onchange = () => {
    const n = parseFloat(String(input.value).replace(',', '.'));
    const list = _fxpSizes();
    if (!list || !isFinite(n)) { _fxpKey = ''; refreshEffectPopup(); return; }
    _fxpResize(Math.max(list[0].s, Math.min(list[list.length - 1].s, Math.round(n / GRID_FT) * GRID_FT)));
  };
  input.onkeydown = e => { if (e.key === 'Enter') input.blur(); };
  const wheelSt = wheelState();
  let wheelAcc = 0;
  field.onwheel = e => {
    e.preventDefault();
    const r = wheelSteps(classifyWheel(e, wheelSt, e.timeStamp), e.deltaY, wheelAcc);
    wheelAcc = r.acc;
    for (let i = 0; i < Math.abs(r.steps); i++) _fxpStep(r.steps > 0 ? 1 : -1);
  };
  field.querySelector('.sz-scrub').onmousedown = e => {
    e.preventDefault();
    let x0 = e.clientX;
    const move = ev => {
      if (Math.abs(ev.clientX - x0) < FXP_SCRUB_PX) return;
      _fxpStep(ev.clientX > x0 ? 1 : -1);
      x0 = ev.clientX;
    };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  };
  const chev = field.querySelector('.sz-chev');
  chev.onclick = e => {
    e.stopPropagation();
    const list = _fxpSizes(), p = effectPresetOf(_fxpRec());
    if (!list || _tbOpen === 'fxp-sizes') { _tbCloseList(); return; }
    const rows = list.slice().reverse().map(z => [String(z.s), presetSizeText(z.s, t, t.plural), '', false, '']);
    openBarList('fxp-sizes', chev, chev, rows, String(p.s), id => _fxpResize(Number(id)));
  };
}

// The picked effect or light the popup is for, while Select is in hand in Effects mode on the single map.
function _fxpRec() {
  if (isPlayer || worldMapOpen || gridCalArmed || isPane || panesActive || placeMode !== 'effects') return null;
  if (shape !== 'select' || selectedPolygonId == null || pickedExtras().length) return null;
  return findActiveShape();
}

// The sizes of the picked effect's shape, or null when it reads as By hand.
function _fxpSizes() {
  const p = effectPresetOf(_fxpRec());
  return p ? EFFECT_PRESETS[p.kind] : null;
}

function _fxpStep(dir) {
  const list = _fxpSizes(), p = effectPresetOf(_fxpRec());
  if (!list) return;
  const i = list.findIndex(z => z.s === p.s);
  _fxpResize(list[Math.max(0, Math.min(list.length - 1, i + dir))].s);
}

// One undo step: the outline rebuilt at size `s`, its corners' rounding kept (the count does not change).
function _fxpResize(s) {
  const rec = _fxpRec(), out = rec && presetResized(rec, s);
  if (!out || out.preset.s === Number(rec.preset.s)) { _fxpKey = ''; refreshEffectPopup(); return; }
  pushUndo();
  rec.vertices = out.vertices;
  setShapeHoles(rec, out.holes);
  rec.preset = out.preset;
  shapeListChanged('effects');
  persistShapeEdit();
  scheduleRender();
  drawCursor(lastScreenX, lastScreenY);
}

// Placed over the effect's top edge, centred on it and kept in the map area the dock leaves; under it when there is no space
// above. A drag of the effect puts it away until the drop.
let _fxpKey = '';
function refreshEffectPopup() {
  const el = document.getElementById('fx-pop');
  if (!el) return;
  const rec = _fxpRec();
  if (!rec || selectDragging()) {
    el.style.display = 'none';
    _fxpKey = '';
    const pal = document.getElementById('mat-pal');
    if (pal && pal.parentNode === el) pal.hidden = true;
    return;
  }
  let l = Infinity, r = -Infinity, top = Infinity, bottom = -Infinity;
  for (const v of rec.vertices) {
    const sc = toScreen(v.x, v.y), c = viewToClient(sc.sx, sc.sy);
    l = Math.min(l, c.x); r = Math.max(r, c.x); top = Math.min(top, c.y); bottom = Math.max(bottom, c.y);
  }
  const p = effectPresetOf(rec), mat = rec.light ? 'light' : String(rec.material);
  const key = [rec.id, mat, p ? p.s : 'hand', l, r, top, bottom, innerWidth, innerHeight, dockMapInset()].join('|');
  if (key === _fxpKey && el.style.display === 'flex') return;
  _fxpKey = key;
  const m = effectsMaterials().find(x => x[0] === mat);
  const btn = el.querySelector('#fxp-mat .mt-btn');
  btn.style.color = m ? effectsMaterialColor(mat) : '';
  btn.querySelector('.fxp-glyph').innerHTML = m ? m[2] : '';
  btn.querySelector('.fxp-name').textContent = m ? t(m[1]) : '';
  btn.title = t('Every material');
  const field = el.querySelector('.sz-field');
  field.classList.toggle('off', !p);
  field.title = t(p ? 'Size in feet - drag the arrows, type, or scroll; one step is one grid square'
                    : 'Drawn or reshaped by hand, so it has no size to change');
  const input = field.querySelector('.sz-in');
  input.disabled = !p;
  field.querySelector('.sz-chev').disabled = !p;
  if (p && document.activeElement !== input) input.value = String(Number(p.s));
  el.style.display = 'flex';
  const box = el.getBoundingClientRect(), mg = 8;
  const left = Math.max(mg, Math.min(innerWidth - dockMapInset() - box.width - mg, (l + r) / 2 - box.width / 2));
  let y = top - box.height - mg;
  if (y < mg) y = bottom + mg;
  y = Math.max(mg, Math.min(innerHeight - box.height - mg, y));
  const st = _rpScreenToStyle(el, left, y);
  el.style.left = st.left + 'px';
  el.style.top = st.top + 'px';
}
