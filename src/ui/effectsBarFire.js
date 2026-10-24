'use strict';
// effectsBarFire.js — the toolbar burns while Effects mode is on: a band of the real fire effect on the bar's own
// border, which takes the material's colour (effectsTool.js), drawn with the app's own two fragment passes and the
// current material's record. A UI decoration, so it has a small canvas and WebGL context of its own (not the map's PixiJS one), sized to the bar plus a margin, under
// the bar and out of the pointer's way. The DM window only.
// ⚠ IT RUNS ITS LOOP ONLY WHILE THE MODE IS ON OR FADING. Off, there is no frame request and no draw.

const BF_PAD = 2;          // the band's reach either side of the bar's border, px: it reads as the stroke
const BF_CELL = 8;         // the grid cell its flames are sized by, px: small, so the fire stays on the border
const BF_MARGIN = 64;      // canvas room around the bar for flames and smoke
const BF_FADE_MS = 250;
const BF_FRAME_MS = 33;    // a decoration needs no more than ~30 frames a second
const BF_VERT = 'attribute vec2 aVertexPosition; uniform vec2 uRes; varying vec2 vMap; void main(){ vMap=aVertexPosition; vec2 c=aVertexPosition/uRes*2.0-1.0; gl_Position=vec4(c.x,-c.y,0.,1.); }';

// Light has no record in EFFECT_MATERIALS (it is a light, not an effect), so the band gets a soft one of its
// own: the fire's passes with a pale-yellow ramp, no toon, no smoke, a low flicker.
const BF_LIGHT = {
  warm: 0.6,
  ramp: new Float32Array([0.10, 0.08, 0.02,  0.45, 0.38, 0.12,  0.85, 0.72, 0.35,  1.0, 0.88, 0.55,  1.0, 0.95, 0.75,  1.0, 0.99, 0.92]),
  look: { heightMul: 0.55, diss: 0.5, smoke: 0, haze: 0, spark: 0,
          sparkCol: [1.0, 0.95, 0.7], smokeCol: [0, 0, 0],
          steam: 0, steamCol: [0, 0, 0], liquid: 0, bub: 0, bubSize: 0,
          toon: 0, core: 0.3, spill: 0.2, flicker: 0.15, scorch: 0, drift: 0.5 },
};

let _bf = null;            // { cv, gl, light, dark, buf } once built
let _bfBroken = false;
let _bfHeat = 0;           // 0..1, eased toward _bfOn
let _bfOn = false;
let _bfRaf = 0;
let _bfLast = 0, _bfDrawn = 0;

function initEffectsBarFire() {
  if (isPlayer || isPane) return;
  refreshEffectsBarFire();
}

// Called with the mode's state; starts the loop on the way in and lets it stop itself on the way out.
function refreshEffectsBarFire() {
  if (isPlayer || isPane) return;
  _bfOn = placeMode === 'effects' && !worldMapOpen;
  if ((_bfOn || _bfHeat > 0) && !_bfRaf && !_bfBroken) {
    _bfLast = performance.now();
    _bfRaf = requestAnimationFrame(_bfFrame);
  }
}

function _bfProgram(gl, frag) {
  const mk = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
  };
  const vs = mk(gl.VERTEX_SHADER, BF_VERT), fs = mk(gl.FRAGMENT_SHADER, frag);
  if (!vs || !fs) return null;
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, name);
  }
  return { p, u, a: gl.getAttribLocation(p, 'aVertexPosition') };
}

function _bfBuild() {
  const row = document.getElementById('bar-row');
  if (!row) return null;
  const cv = document.createElement('canvas');
  cv.id = 'bar-fire';
  const gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true });
  const light = gl && _bfProgram(gl, _FX_FRAG_LIGHT), dark = gl && _bfProgram(gl, _FX_FRAG_DARK);
  if (!light || !dark) { _bfBroken = true; return null; }
  cv.addEventListener('webglcontextlost', e => { e.preventDefault(); cv.remove(); _bf = null; });
  row.insertBefore(cv, row.firstChild);
  return { cv, gl, light, dark, buf: gl.createBuffer() };
}

function _bfRoundRect(x, y, w, h, r, n) {
  const out = [], cs = [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]];
  for (const [cx, cy, a0] of cs) {
    for (let i = 0; i <= n; i++) { const a = a0 + i / n * Math.PI / 2; out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }); }
  }
  return out;
}

// One pass over the band: rings are points in canvas px, the first the outer outline and the second the hole.
function _bfPass(prog, rings, t, w, h) {
  const gl = _bf.gl, u = prog.u, g = BF_CELL;
  const light = currentMaterial === 'light', m = light ? BF_LIGHT : effectMaterial(currentMaterial), L = m.look;
  const vs = new Float32Array(MAX_FX_VERTS * 2), br = new Float32Array(MAX_FX_VERTS);
  let i = 0, cx = 0, cy = 0, x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
  for (const ring of rings) {
    br[i] = 1;
    for (const q of ring) {
      vs[i * 2] = q.x; vs[i * 2 + 1] = q.y; i++;
      cx += q.x; cy += q.y;
      x1 = Math.min(x1, q.x); y1 = Math.min(y1, q.y); x2 = Math.max(x2, q.x); y2 = Math.max(y2, q.y);
    }
  }
  x1 -= g * 0.9; x2 += g * 0.9; y2 += g * 0.9; y1 -= g * 2.7;
  gl.useProgram(prog.p);
  gl.bindBuffer(gl.ARRAY_BUFFER, _bf.buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([x1, y1, x2, y1, x2, y2, x1, y1, x2, y2, x1, y2]), gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(prog.a);
  gl.vertexAttribPointer(prog.a, 2, gl.FLOAT, false, 0, 0);
  const f1 = (k, x) => { if (u[k]) gl.uniform1f(u[k], x); };
  const f3 = (k, x) => { if (u[k]) gl.uniform3fv(u[k], x); };
  gl.uniform2f(u.uRes, w, h);
  gl.uniform2fv(u.uVerts, vs);
  gl.uniform1fv(u.uBreak, br);
  gl.uniform1i(u.uCount, i);
  f1('uTime', t); f1('uHeight', Math.max(8, Math.min(140, g * 0.55 * L.heightMul))); f1('uSpeed', FX_LOOK.speed);
  f1('uAlong', 2.2 / Math.max(24, g)); f1('uDiss', L.diss); f1('uWarm', m.warm);
  if (u.uRamp) gl.uniform3fv(u.uRamp, light ? m.ramp : effectRamp(currentMaterial));
  f1('uFill', FX_LOOK.fill); f1('uG', g); f1('uSpark', L.spark); f1('uSmoke', L.smoke); f1('uHaze', L.haze);
  gl.uniform2f(u.uCentroid, cx / i, cy / i);
  f3('uSparkCol', L.sparkCol); f3('uSmokeCol', L.smokeCol); f3('uSteamCol', L.steamCol);
  for (const k of ['steam', 'liquid', 'bub', 'bubSize', 'toon', 'core', 'spill', 'flicker', 'scorch', 'drift']) {
    f1('u' + k[0].toUpperCase() + k.slice(1), L[k]);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function _bfDraw(now) {
  const bar = document.getElementById('toolbar-bottom'), row = document.getElementById('bar-row');
  if (!bar || !row) return;
  if (!_bf) _bf = _bfBuild();
  if (!_bf) return;
  const b = bar.getBoundingClientRect(), rr = row.getBoundingClientRect();
  if (!b.width) return;
  const cssW = b.width + BF_MARGIN * 2, cssH = b.height + BF_MARGIN * 2, dpr = window.devicePixelRatio || 1;
  const { cv, gl } = _bf;
  const px = Math.round(cssW * dpr), py = Math.round(cssH * dpr);
  if (cv.width !== px || cv.height !== py) { cv.width = px; cv.height = py; }
  // Placed from the bar's own rect each frame, so ui-zoom, the two-map layout and a resize all follow it.
  cv.style.left = (b.left - rr.left - BF_MARGIN) + 'px';
  cv.style.top = (b.top - rr.top - BF_MARGIN) + 'px';
  cv.style.width = cssW + 'px';
  cv.style.height = cssH + 'px';
  cv.style.opacity = String(_bfHeat);
  const z = b.width / bar.offsetWidth || 1;
  const rad = (parseFloat(getComputedStyle(bar).borderTopLeftRadius) || 8) * z;
  const x = BF_MARGIN, y = BF_MARGIN;
  const rings = [
    _bfRoundRect(x - BF_PAD, y - BF_PAD, b.width + BF_PAD * 2, b.height + BF_PAD * 2, rad + BF_PAD, 5),
    _bfRoundRect(x + BF_PAD, y + BF_PAD, b.width - BF_PAD * 2, b.height - BF_PAD * 2, Math.max(2, rad - BF_PAD), 5),
  ];
  gl.viewport(0, 0, cv.width, cv.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  _bfPass(_bf.light, rings, now / 1000, cssW, cssH);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  _bfPass(_bf.dark, rings, now / 1000, cssW, cssH);
}

function _bfFrame(now) {
  _bfRaf = 0;
  const dt = Math.max(0, now - _bfLast);
  _bfLast = now;
  _bfHeat = Math.max(0, Math.min(1, _bfHeat + (_bfOn ? dt : -dt) / BF_FADE_MS));
  if (!_bfOn && _bfHeat === 0) {
    if (_bf) _bf.cv.style.display = 'none';
    return;   // faded out: no further frame is asked for
  }
  if (now - _bfDrawn >= BF_FRAME_MS || _bfHeat < 1) { _bfDrawn = now; _bfDraw(now); }
  if (_bf) _bf.cv.style.display = 'block';
  _bfRaf = requestAnimationFrame(_bfFrame);
}
