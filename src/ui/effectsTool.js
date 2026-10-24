'use strict';
// effectsTool.js — the Effects switch on the bar, the Room button's twin. A click or E turns Effects mode on
// with the last effect shape armed at the last size. In the mode, a click or E with Select in hand arms the
// next effect, and with an effect armed turns the mode off (Fog, Select). While it is on the button wears the
// blue tint, the options row stays up with every tool, Brush and Room grey in place and do nothing, and the
// bar burns (effectsBarFire.js). The button wears the current material's glyph, in its colour while off. The
// shapes are the row's well (effectsRow.js).
// Esc: an armed effect goes back to Select, then Select leaves the mode (input.js).

const FX_SHAPE_ORDER = ['rect', 'circle', 'cone', 'line', 'wall', 'ring', 'poly'];

// Picks `s` in Effects mode and arms it at the last size; the Polygon has no size and just takes the tool.
function effectsToolArm(s) {
  setShape(s);
  const p = presetForSize(s, effectsSize);
  if (p) setPreset(p);
  reportPaneTool();
}

function effectsToolEnter(s) {
  if (isPlayer || worldMapOpen) return;
  setPlaceMode('effects');
  effectsToolArm(s || effectsShape);
}

function effectsToolLeave() {
  if (isPlayer || worldMapOpen) return;
  setShape('select');   // first: Select is in both modes, so leaving never swaps the Room button's shape
  setPlaceMode('rooms');
  reportPaneTool();
}

// After a placement the tool is Select, so the click that reaches for the next effect must not leave the mode.
function effectsToolToggle() {
  if (placeMode !== 'effects') effectsToolEnter();
  else if (shape === 'select') effectsToolArm(effectsShape);
  else effectsToolLeave();
}

// The material's colour on the bar: its edge colour, and the light's own outline colour.
function effectsMaterialColor(m) { return m === 'light' ? LIGHT_RGB : effectEdgeColor(m); }

// Brush and Room (and Room's arrow) grey while Effects is the mode; the tips say why.
function refreshEffectsTool() {
  const fx = placeMode === 'effects';
  const btn = document.getElementById('btn-effects');
  if (!btn) return;
  btn.classList.toggle('fx-on', fx);
  btn.title = t(!fx ? 'Effects (E) - fire, acid, light and more on the map. Its options appear above'
    : shape === 'select' ? 'Effects (E) - place another effect' : 'Effects (E) - click again to leave Effects');
  const label = btn.querySelector('.tb-shape-label');
  if (label) label.textContent = t('Effects');
  const src = document.querySelector('#material-row [data-material="' + currentMaterial + '"] svg');
  const glyph = btn.querySelector('.tb-shape-glyph');
  if (src && glyph) {
    glyph.innerHTML = src.outerHTML;
    glyph.style.color = fx ? '' : effectsMaterialColor(currentMaterial);
  }
  // The bar's border and the picked shape in the well wear the material's colour while the mode is on.
  const col = effectsMaterialColor(currentMaterial);
  const bar = document.getElementById('toolbar-bottom');
  if (bar) bar.style.borderColor = fx ? col + '99' : '';
  const well = document.getElementById('fx-shapes');
  if (well) well.style.setProperty('--fx-col', col);
  const off = [document.getElementById('btn-brush'), document.getElementById('btn-shape'),
               document.querySelector('#tb-grp-shape .tb-chev')];
  off.forEach(el => {
    if (!el) return;
    el.classList.toggle('tb-off', fx);
    el.setAttribute('aria-disabled', fx ? 'true' : 'false');
  });
  const brush = document.getElementById('btn-brush');
  if (brush) brush.title = t(fx ? 'Brush - leave Effects to paint fog' : 'Brush (B) - paint to reveal or hide');
  const chev = document.querySelector('#tb-grp-shape .tb-chev');
  if (chev) chev.title = t(fx ? 'Room - leave Effects to draw a room' : 'Shapes');
  refreshFxShapeWell();
  refreshEffectsBarFire();
}

function initEffectsTool() {
  document.getElementById('btn-effects').onclick = effectsToolToggle;
  refreshEffectsTool();
}
