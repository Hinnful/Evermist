'use strict';
// colorPicker.js — the Fog tab's colour picker: the square, the hue strip, the hex field, and the
// HSV maths behind them.

// Drives the hidden `<input type="color">` by setting its value and dispatching 'input', so the
// existing wiring runs unchanged. The alpha slider is the tint input; this only paints to match.
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
      // ⚠ Two offset 45° linear-gradients for the checkerboard, never a conic gradient, which
      // fringes colour at the track edges on this Chromium.
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
