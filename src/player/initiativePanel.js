'use strict';
// initiativePanel.js — the fight's turn order on the TV: two sheets of slots in pools of haze rising from
// the TV's edge, one upright in the bottom-left corner and one turned 180° in the top-right, for the two
// long sides of the table. initiativeTv.js sends the slots; the haze follows the map's fog theme.
// One window-sized canvas of its own, in the Player window or the two-map shell. It never touches the map
// canvases or doRender, and its frame loop runs only while the panel is shown.

// Everything is laid out in a reference TV 1080 units high, so names are 2.7% of the window's height
// whatever its size or the map's zoom; INP_S scales every other size from that.
const INP_REF_H = 1080, INP_U = 0.027 * INP_REF_H, INP_S = INP_U / 38;
const INP_K = 0.5;          // haze pixels per reference unit: the haze is soft, so half resolution does
const INP_TS = 256;
const INP_FPS_MS = 33;
const INP_FONT = 'Alegreya, Georgia, "Times New Roman", serif';
const INP_NAME_FONT = '700 ' + INP_U + 'px ' + INP_FONT;
const INP_NUM_FONT = '500 ' + (30 * INP_S) + 'px ' + INP_FONT;
// ⚠ Monsters are red in every fog theme, by the DM's call; everything else on the panel takes the theme.
const INP_MONSTER_RED = [222, 46, 38];
// How each theme's haze moves: speed scales the drift, rise lifts it away from the reader's edge, edge
// names the rim treatment, fx the particles.
const INP_BEHAVE = {
  default: { speed: 1, rise: 0.15, edge: 'pale', fx: null },
  blood: { speed: 0.2, rise: 0, edge: 'dark', fx: null },
  fire: { speed: 1.1, rise: 1, edge: 'burn', fx: 'embers' },
  ice: { speed: 0.07, rise: 0, edge: 'frost', fx: 'glints' },
  toxic: { speed: 1.6, rise: 0.7, edge: 'acid', fx: 'fumes' },
};

let _inp = null;   // { canvas, ctx, slots, raf, last, geo, masks, copies, drawn, themes, namePx, still }
let _inpTex = null;

const _inpMix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const _inpLum = c => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
const _inpRgba = (c, a) => 'rgba(' + c.map(v => Math.round(Math.max(0, Math.min(255, v)))).join(',') + ',' + (a == null ? 1 : a) + ')';
const _inpSs = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const _inpBump = (x, c, w) => Math.exp(-((x - c) / w) * ((x - c) / w));
const _inpCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };
function _inpRng(seed) { let s = (seed * 2654435761) >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; }; }
// Blood's heartbeat, the theme shader's heart2: a double beat every 4.2 s.
const _inpHeart = t => { const ph = ((t % 4.2) + 4.2) % 4.2; return Math.exp(-Math.pow((ph - 0.15) / 0.06, 2)) + 0.75 * Math.exp(-Math.pow((ph - 0.48) / 0.07, 2)); };

// The colours, from the theme's own record: hex is the fog, rim its living edge, doorLight the door glow.
function _inpPalette(id) {
  const th = typeof fogThemeRecord === 'function' ? fogThemeRecord(id) : null;
  const hex = th ? th.hex : '#1a1a2e', fog = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const door = (th ? th.doorLight : [0.804, 0.824, 0.961]).map(v => v * 255), rim = (th ? th.rim : [0.6, 0.64, 0.85]).map(v => v * 255);
  // Blood's rim is black (a dark edge); the panel takes its light from the door glow instead.
  const accent = _inpLum(rim) > 0.15 ? rim : door.map(v => v * 0.85);
  const lit = fog.map(v => v * 1.55), grey = c => Array(3).fill(_inpLum(c) * 255);
  // Every theme's core gets the same darkness, so legibility never depends on the theme.
  const dense = fog.map(v => v * Math.min(1.6, 0.17 / _inpLum(fog)));
  const wisp = _inpMix(lit, accent, 0.35);
  return {
    body: _inpMix(_inpMix(dense, grey(dense), 0.35), accent, 0.04),
    deep: fog.map(v => v * 0.6), black: fog.map(v => v * 0.25),
    wisp: _inpMix(wisp, grey(wisp), 0.4),
    pale: _inpMix(_inpMix(accent, [255, 255, 255], 0.2), grey(accent), 0.3),
    smoke: _inpMix(fog.map(v => v * 2.2), [70, 64, 60], 0.5),
    accent, door, hot: _inpMix(door, [255, 235, 170], 0.45),
    name: _inpMix([255, 255, 255], door, 0.16), num: _inpMix(accent, [255, 255, 255], 0.35), halo: fog.map(v => v * 0.28),
  };
}

// ─── Textures, built once ────────────────────────────────────────────────────

// Tileable value-noise fBm in 0..1, for the haze's ragged edge.
function _inpNoise(fx, fy, oct, seed) {
  const size = INP_TS, out = new Float32Array(size * size), rnd = _inpRng(seed);
  let amp = 1;
  for (let o = 0; o < oct; o++) {
    const cx = fx << o, cy = fy << o, grid = new Float32Array(cx * cy);
    for (let i = 0; i < grid.length; i++) grid[i] = rnd();
    for (let y = 0; y < size; y++) {
      const gy = y / size * cy, y0 = Math.floor(gy), ty = gy - y0, sy = ty * ty * (3 - 2 * ty), y1 = (y0 + 1) % cy;
      for (let x = 0; x < size; x++) {
        const gx = x / size * cx, x0 = Math.floor(gx), tx = gx - x0, sx = tx * tx * (3 - 2 * tx), x1 = (x0 + 1) % cx;
        const a = grid[y0 * cx + x0], b = grid[y0 * cx + x1], c = grid[y1 * cx + x0], d = grid[y1 * cx + x1];
        const top = a + (b - a) * sx;
        out[y * size + x] += amp * (top + (c + (d - c) * sx - top) * sy);
      }
    }
    amp *= 0.5;
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of out) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo);
  return out;
}

// A tileable cloud: soft round blobs at three sizes, stretched by sx, sy, then given contrast.
function _inpBlobs(sx, sy, seed, a0, a1, sizes) {
  const size = INP_TS, c = _inpCanvas(size, size), g = c.getContext('2d'), rnd = _inpRng(seed);
  (sizes || [[26, 34, 80, 0.32], [110, 12, 30, 0.22], [320, 4, 11, 0.14]]).forEach(([n, r0, r1, a]) => {
    for (let i = 0; i < n; i++) {
      const x = rnd() * size, y = rnd() * size, r = r0 + (r1 - r0) * rnd(), al = a * (0.5 + rnd());
      for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
        const cx = x + ox, cy = y + oy;
        if (cx + r * sx < 0 || cx - r * sx > size || cy + r * sy < 0 || cy - r * sy > size) continue;
        g.save(); g.translate(cx, cy); g.scale(sx, sy);
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
        gr.addColorStop(0, 'rgba(255,255,255,' + al + ')'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(-r, -r, r * 2, r * 2); g.restore();
      }
    }
  });
  const img = g.getImageData(0, 0, size, size), d = img.data;
  for (let i = 3; i < d.length; i += 4) { d[i - 3] = d[i - 2] = d[i - 1] = 255; d[i] = 255 * _inpSs(a0, a1, d[i] / 255); }
  g.putImageData(img, 0, 0);
  return c;
}

// Frost: little ferns, a stem with side branches at ±60°, so no arm ever turns a right angle.
function _inpFrost(seed) {
  const size = INP_TS, c = _inpCanvas(size, size), g = c.getContext('2d'), rnd = _inpRng(seed);
  g.strokeStyle = '#fff'; g.lineCap = 'round';
  const fern = (x, y, ang, len, depth) => {
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    g.globalAlpha = 0.35 + 0.4 * depth; g.lineWidth = 0.5 + 0.5 * depth;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x2 + ox, y2 + oy); g.stroke(); }
    if (depth <= 0) return;
    for (let k = 1; k <= 3; k++) {
      const f = k / 4, bx = x + (x2 - x) * f, by = y + (y2 - y) * f;
      fern(bx, by, ang + Math.PI / 3, len * 0.42 * (1 - f * 0.4), depth - 1);
      fern(bx, by, ang - Math.PI / 3, len * 0.42 * (1 - f * 0.4), depth - 1);
    }
  };
  for (let i = 0; i < 46; i++) fern(rnd() * size, rnd() * size, Math.floor(rnd() * 6) * Math.PI / 3 + (rnd() - 0.5) * 0.2, 9 + rnd() * 16, 1 + (rnd() < 0.5 ? 1 : 0));
  return c;
}

function _inpDot(r, stops) {
  const c = _inpCanvas(r * 2, r * 2), g = c.getContext('2d'), gr = g.createRadialGradient(r, r, 0, r, r, r);
  stops.forEach(([o, a]) => gr.addColorStop(o, 'rgba(255,255,255,' + a + ')'));
  g.fillStyle = gr; g.fillRect(0, 0, r * 2, r * 2);
  return c;
}

function _inpTextures() {
  if (_inpTex) return _inpTex;
  _inpTex = {
    edge: _inpNoise(5, 5, 4, 3), fine: _inpNoise(12, 12, 3, 8),
    cloud: _inpBlobs(1, 1, 7, 0.2, 0.85), wisp: _inpBlobs(2.6, 0.55, 19, 0.3, 0.9), rise: _inpBlobs(1.7, 0.8, 23, 0.25, 0.85),
    fineTex: _inpBlobs(1, 1, 31, 0.15, 0.9, [[260, 3, 9, 0.4]]), frost: _inpFrost(41),
    dot: _inpDot(24, [[0, 1], [0.35, 0.55], [1, 0]]), puff: _inpDot(24, [[0, 0.55], [0.55, 0.3], [1, 0]]),
  };
  return _inpTex;
}
const _inpAt = (f, x, y) => f[((y * INP_K | 0) & 255) * INP_TS + ((x * INP_K | 0) & 255)];

// ─── The sheet: slots laid out in the bottom-left corner of the reference TV ──

// A monster's line is its word, in the DM's language, then the count when monsters act back to back.
const _inpMonsterText = s => (s.word || 'Monster') + (s.count > 1 ? ' ×' + s.count : '');

function _inpSlotW(ctx, s) {
  ctx.font = INP_NAME_FONT;
  return ctx.measureText(s.name != null ? s.name : _inpMonsterText(s)).width;
}

function _inpSheet(ctx, slots) {
  const row = 48 * INP_S, gapCol = 40 * INP_S, bottom = INP_REF_H - 76 * INP_S, x0 = 84 * INP_S;
  const { cols, per } = initiativeColumns(slots.length), top = bottom - row * per, items = [];
  let x = x0;
  for (let c = 0; c < cols; c++) {
    const part = slots.slice(c * per, (c + 1) * per), numR = x + 34 * INP_S, ix = numR + 18 * INP_S;
    part.forEach((s, i) => items.push({ s, numR, ix, y: top + row * (i + 0.5) }));
    x = ix + Math.max(0, ...part.map(s => _inpSlotW(ctx, s))) + gapCol;
  }
  return { items, cols, box: [x0, top, x - gapCol, bottom] };
}

// The haze rises out of the corner: densest at the TV's edge, its ragged top the fog's own edge. Four
// masks from it, in the haze's own pixels: the core behind the names, the fringe, the edge line, and a
// band just inside the edge. Also where the particles are born.
function _inpMasks(G) {
  const T = _inpTextures(), S = INP_S, H = INP_REF_H;
  const rx = G.box[2] * 1.15 + 50 * S, ry = (H - G.box[1]) * 1.45 + 60 * S;
  const box = [0, Math.max(0, H - ry * 1.6), rx * 1.6, H];
  const w = Math.ceil((box[2] - box[0]) * INP_K), h = Math.ceil((box[3] - box[1]) * INP_K);
  const cans = [0, 1, 2, 3].map(() => _inpCanvas(w, h)), imgs = cans.map(c => c.getContext('2d').createImageData(w, h));
  const edgePts = [], rimPts = [];
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const x = (px + 0.5) / INP_K, y = box[1] + (py + 0.5) / INP_K;
    const d = Math.cbrt(Math.pow(x / rx, 3) + Math.pow((H - y) / ry, 3)) + (_inpAt(T.edge, x, y) - 0.5) * 0.45 + (_inpAt(T.fine, x, y) - 0.5) * 0.1;
    const patch = _inpSs(0.3, 0.75, _inpAt(T.edge, x + 333, y + 91));
    const v = [1 - _inpSs(0.5, 1.0, d), _inpBump(d, 0.92, 0.2) * patch, _inpBump(d, 0.97, 0.045) * (0.55 + 0.45 * _inpAt(T.fine, x + 50, y)), _inpBump(d, 0.85, 0.1)];
    if ((px + py * 3) % 4 === 0) { if (v[2] > 0.55) edgePts.push([x, y]); if (v[0] > 0.3 && v[0] < 0.75) rimPts.push([x, y]); }
    const i = (py * w + px) * 4;
    for (let k = 0; k < 4; k++) { const dd = imgs[k].data; dd[i] = dd[i + 1] = dd[i + 2] = 255; dd[i + 3] = Math.round(255 * Math.max(0, Math.min(1, v[k]))); }
  }
  cans.forEach((c, k) => c.getContext('2d').putImageData(imgs[k], 0, 0));
  const pick = (arr, n, seed) => { const r = _inpRng(seed), o = []; for (let i = 0; i < n && arr.length; i++) o.push(arr[Math.floor(r() * arr.length)]); return o; };
  return { box, w, h, M: cans[0], R: cans[1], E: cans[2], I: cans[3], edgePts: pick(edgePts, 70, 5), rimPts: pick(rimPts.length ? rimPts : edgePts, 40, 9) };
}

// ─── One copy of the haze in one theme ────────────────────────────────────────

function _inpCopy(id, m) {
  const T = _inpTextures(), P = _inpPalette(id), scr = _inpCanvas(m.w, m.h), hz = _inpCanvas(m.w, m.h), g = scr.getContext('2d');
  const tint = (tex, col) => { const c = _inpCanvas(tex.width, tex.height), cg = c.getContext('2d');
    cg.drawImage(tex, 0, 0); cg.globalCompositeOperation = 'source-in'; cg.fillStyle = _inpRgba(col); cg.fillRect(0, 0, c.width, c.height); return c; };
  const pat = (tex, col) => g.createPattern(tint(tex, col), 'repeat');
  return {
    id, P, B: INP_BEHAVE[id] || INP_BEHAVE.default, scr, g, hz, hg: hz.getContext('2d'), text: null,
    PAT: { deep: pat(T.cloud, P.deep), black: pat(T.cloud, P.black), cloud: pat(T.cloud, P.wisp), pale: pat(T.cloud, P.pale),
      wisp: pat(T.wisp, P.pale), rise: pat(T.rise, P.pale), smoke: pat(T.rise, P.smoke), lit: pat(T.rise, P.door),
      flick: pat(T.fineTex, P.hot), acid: pat(T.fineTex, P.door), frost: pat(T.frost, P.pale) },
    SPR: { hot: tint(T.dot, P.hot), pale: tint(T.dot, P.pale), fume: tint(T.puff, _inpMix(P.door, P.pale, 0.55)) },
  };
}

function _inpLayer(g, pat, b, ox, oy, s, a) {
  const per = INP_TS * s;
  pat.setTransform(new DOMMatrix([s, 0, 0, s, ((ox % per) + per) % per, ((oy % per) + per) % per]));
  g.globalAlpha = a; g.fillStyle = pat; g.fillRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
}
const _inpFill = (g, b, c, a) => { g.globalAlpha = a; g.fillStyle = c; g.fillRect(b[0], b[1], b[2] - b[0], b[3] - b[1]); };

// One masked layer: paint in reference units, cut by the mask, add to the copy's haze.
function _inpPass(cp, m, mask, paint) {
  const g = cp.g;
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.clearRect(0, 0, m.w, m.h);
  g.setTransform(INP_K, 0, 0, INP_K, 0, -m.box[1] * INP_K);
  paint(g, m.box);
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'destination-in'; g.drawImage(mask, 0, 0);
  g.globalCompositeOperation = 'source-over';
  cp.hg.drawImage(cp.scr, 0, 0);
}

// One frame of one copy's haze at time t. The masks give the shape; the theme decides colour and motion.
function _inpHaze(cp, m, t) {
  const { P, B, PAT } = cp, b = m.box, sp = t * B.speed;
  const up = v => -t * B.speed * v * B.rise;
  const br = 0.88 + 0.12 * Math.sin(t * 2 * Math.PI / 7), hb = _inpHeart(t);
  const flick = 0.78 + 0.12 * Math.sin(t * 13.1) + 0.1 * Math.sin(t * 7.3 + 1.7);
  cp.hg.setTransform(1, 0, 0, 1, 0, 0); cp.hg.clearRect(0, 0, m.w, m.h);
  // The core: denser fog behind the names, with the theme's own glow inside it.
  _inpPass(cp, m, m.M, g => {
    _inpFill(g, b, _inpRgba(B.edge === 'burn' ? _inpMix(P.body, [18, 12, 10], 0.45) : P.body), B.edge === 'dark' ? 0.95 : 0.9);
    _inpLayer(g, PAT.deep, b, sp * 7, sp * 2.5 + up(6), 3.4, 0.45);
    if (B.edge === 'dark') _inpLayer(g, PAT.black, b, sp * 2, 0, 3.0, 0.4);
    else if (B.edge === 'burn') { _inpLayer(g, PAT.smoke, b, sp * 3, up(16), 2.4, 0.3); _inpLayer(g, PAT.lit, b, -sp * 4, up(22) + 70, 2.0, 0.14 * flick); }
    else _inpLayer(g, PAT.cloud, b, -sp * 6 + 120, -sp * 2 + 40 + up(10), 2.4, 0.3 * br);
    if (B.edge === 'acid') _inpLayer(g, PAT.cloud, b, sp * 8 + 30, sp * 3 + up(6), 1.9, 0.22);
    if (B.edge === 'pale' || B.edge === 'acid') _inpLayer(g, PAT.wisp, b, sp * 12, 10 + up(5), 2.8, 0.12);
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, R = Math.max(b[2] - b[0], b[3] - b[1]) * 0.45;
    if (B.edge === 'dark') { const gr = g.createRadialGradient(cx, cy, 0, cx, cy, R); gr.addColorStop(0, _inpRgba(P.door, 0.34 * hb)); gr.addColorStop(1, _inpRgba(P.door, 0)); _inpFill(g, b, gr, 1); }
    if (B.edge === 'burn' || B.edge === 'acid') {
      const gr = g.createLinearGradient(0, INP_REF_H, 0, b[1]), a = B.edge === 'burn' ? 0.12 * flick : 0.13 * (0.75 + 0.25 * Math.sin(t * 1.4));
      gr.addColorStop(0, _inpRgba(P.door, a)); gr.addColorStop(1, _inpRgba(P.door, 0)); _inpFill(g, b, gr, 1);
      if (B.edge === 'acid') _inpLayer(g, PAT.acid, b, sp * 3, up(4), 1.6, 0.12);
    }
    if (B.edge === 'frost') _inpLayer(g, PAT.frost, b, 11, 7, 1.7, 0.1);
  });
  const ia = { pale: 0.3, dark: 0.6, burn: 0.4, frost: 0, acid: 0.3 }[B.edge];
  if (ia) _inpPass(cp, m, m.I, g => _inpFill(g, b, _inpRgba(B.edge === 'burn' ? [14, 8, 6] : P.black), ia));
  // The fringe: what the haze does where it meets the map's own fog.
  _inpPass(cp, m, m.R, g => {
    if (B.edge === 'pale') { _inpLayer(g, PAT.pale, b, -sp * 9, sp * 3 + up(8), 2.2, 0.42 * br); _inpLayer(g, PAT.wisp, b, sp * 15 + 60, 30 + up(6), 2.0, 0.45); }
    else if (B.edge === 'dark') { _inpFill(g, b, _inpRgba(P.black), 0.55); _inpLayer(g, PAT.black, b, sp * 4, 0, 2.6, 0.8); _inpLayer(g, PAT.deep, b, -sp * 3, 10, 2.0, 0.5); }
    else if (B.edge === 'burn') { _inpLayer(g, PAT.smoke, b, sp * 3, up(18), 2.2, 0.6); _inpLayer(g, PAT.lit, b, -sp * 2, up(24) + 40, 1.8, 0.16 * flick); }
    else if (B.edge === 'frost') {
      // Frost creeps on real time, not the near-still fog speed.
      _inpLayer(g, PAT.pale, b, t * 2.2, t * 0.8, 3.0, 0.22); _inpLayer(g, PAT.frost, b, 0, 0, 2.0, 0.9);
      g.globalCompositeOperation = 'destination-in'; _inpLayer(g, PAT.cloud, b, t * 4, -t * 1.5, 3.4, 1); g.globalCompositeOperation = 'source-over';
      _inpLayer(g, PAT.frost, b, 37, 91, 1.4, 0.35);
      const sw = ((t / 11) % 1) * 1.8 - 0.4, gr = g.createLinearGradient(b[0], b[3], b[2], b[1]);
      [[sw - 0.12, 0], [sw, 0.55], [sw + 0.12, 0]].forEach(([o, a]) => { if (o >= 0 && o <= 1) gr.addColorStop(o, _inpRgba(P.pale, a)); });
      g.globalCompositeOperation = 'source-atop'; _inpFill(g, b, gr, 1);
    } else { _inpLayer(g, PAT.rise, b, sp * 6, up(14), 1.9, 0.36); _inpLayer(g, PAT.cloud, b, -sp * 7, up(9) + 50, 2.3, 0.22); }
  });
  const lineA = { pale: 0.3, dark: 0.12 * hb, burn: 0.95 * flick, frost: 0.55, acid: 0.65 }[B.edge];
  _inpPass(cp, m, m.E, g => {
    if (B.edge === 'burn') { _inpLayer(g, PAT.flick, b, sp * 20, up(40), 1.2, lineA); _inpFill(g, b, _inpRgba(P.door), 0.4 * flick); }
    else if (B.edge === 'acid') _inpLayer(g, PAT.acid, b, sp * 25, up(30), 1.1, lineA * (0.8 + 0.2 * Math.sin(t * 9)));
    else if (B.edge === 'frost') { _inpLayer(g, PAT.frost, b, 5, 5, 1.2, lineA); _inpFill(g, b, _inpRgba(P.pale), 0.2); }
    else if (B.edge === 'dark') _inpFill(g, b, _inpRgba(P.door), lineA);
    else _inpLayer(g, PAT.pale, b, -sp * 9, sp * 3, 1.6, lineA);
  });
  // A darker pool behind the words in the theme's own dark, so names and monsters read with no band behind a row.
  _inpPass(cp, m, m.M, g => _inpFill(g, b, _inpRgba(P.black), 0.35));
  _inpPass(cp, m, m.I, g => _inpFill(g, b, _inpRgba(P.black), 0.55));
  if (B.fx) _inpParticles(cp, m, t);
}

// Particles are a pure function of time, each with a fixed birth place and phase, so a still frame is fine.
function _inpParticles(cp, m, t) {
  const g = cp.hg, { P, B, SPR } = cp, S = INP_S;
  g.setTransform(INP_K, 0, 0, INP_K, 0, -m.box[1] * INP_K);
  if (B.fx === 'embers') {
    g.globalCompositeOperation = 'lighter';
    const r = _inpRng(77);
    for (let i = 0; i < 34 && m.edgePts.length; i++) {
      const p = m.edgePts[i % m.edgePts.length], life = 2.4 + r() * 2, age = ((t / life + r()) % 1);
      const x = p[0] + (Math.sin(age * 5 + i) * 10 + (r() - 0.5) * 20) * S, y = p[1] - age * (70 + r() * 90) * S;
      const tw = 0.55 + 0.45 * (Math.sin(t * 17 + i * 3) > -0.3 ? 1 : 0), s = (5 + r() * 6) * S;
      g.globalAlpha = (1 - age) * _inpSs(0, 0.08, age) * tw; g.drawImage(SPR.hot, x - s, y - s, s * 2, s * 2);
    }
  } else if (B.fx === 'fumes') {
    const r = _inpRng(55);
    for (let i = 0; i < 16 && m.edgePts.length; i++) {
      // Puffs swell close to the edge and burst, so they never drift over the map.
      const p = m.edgePts[(i * 5) % m.edgePts.length], life = 2.2 + r() * 1.6, age = ((t / life + r()) % 1);
      const x = p[0] + Math.sin(age * 3 + i) * 8 * S, y = p[1] - age * (18 + r() * 24) * S, s = (7 + age * 14) * S;
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 0.6 * _inpSs(0, 0.15, age) * (1 - _inpSs(0.6, 1, age));
      [[0, -0.2, 1.1], [-0.3, 0.15, 0.85], [0.32, 0.12, 0.8]].forEach(([dx, dy, k]) => g.drawImage(SPR.fume, x + dx * s - s * k, y + dy * s - s * k, s * 2 * k, s * 2 * k));
    }
    g.lineWidth = 2.2 * S; g.strokeStyle = _inpRgba(P.door); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 12 && m.rimPts.length; i++) {
      const p = m.rimPts[(i * 3) % m.rimPts.length], life = 1.6 + r() * 1.8, age = ((t / life + r()) % 1);
      const R0 = (4 + r() * 6) * S, pop = age > 0.82, R = pop ? R0 * (1 + (age - 0.82) * 4) : R0 * _inpSs(0, 0.8, age);
      g.globalAlpha = pop ? 0.6 * (1 - (age - 0.82) / 0.18) : 0.45;
      g.beginPath(); g.arc(p[0], p[1], Math.max(0.5, R), 0, Math.PI * 2); g.stroke();
    }
  } else if (B.fx === 'glints') {
    g.globalCompositeOperation = 'lighter'; g.strokeStyle = _inpRgba(P.pale); g.lineWidth = 1.6 * S;
    const r = _inpRng(33);
    for (let i = 0; i < 16 && m.edgePts.length; i++) {
      const p = m.edgePts[(i * 4 + 1) % m.edgePts.length], ph = r() * 6.283, sp = 0.5 + r() * 0.5, L = (7 + r() * 6) * S;
      const a = Math.pow(Math.max(0, Math.sin(t * sp + ph)), 14);
      if (a < 0.02) continue;
      g.globalAlpha = a;
      for (let k = 0; k < 3; k++) { const an = k * Math.PI / 3; g.beginPath(); g.moveTo(p[0] - Math.cos(an) * L, p[1] - Math.sin(an) * L); g.lineTo(p[0] + Math.cos(an) * L, p[1] + Math.sin(an) * L); g.stroke(); }
      g.drawImage(SPR.pale, p[0] - 6 * S, p[1] - 6 * S, 12 * S, 12 * S);
    }
  }
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
}

// ─── The words ───────────────────────────────────────────────────────────────

// The names, numbers and monster words of one copy, at device resolution over the haze's box. Drawn only when the
// slots, the theme or the window's size change.
function _inpWords(cp, G, m, D) {
  const c = _inpCanvas(Math.ceil(m.box[2] * D), Math.ceil((m.box[3] - m.box[1]) * D)), g = c.getContext('2d'), P = cp.P, S = INP_S;
  g.setTransform(D, 0, 0, D, 0, -m.box[1] * D);
  g.textBaseline = 'middle';
  const glyphs = (shadow, blur) => {
    g.shadowColor = shadow; g.shadowBlur = blur * D;
    G.items.forEach(it => {
      g.font = INP_NUM_FONT; g.textAlign = 'right'; g.fillStyle = _inpRgba(P.num, 0.82); g.fillText(String(it.s.n), it.numR, it.y);
      g.textAlign = 'left';
      g.font = INP_NAME_FONT;
      g.fillStyle = it.s.name != null ? _inpRgba(P.name) : _inpRgba(INP_MONSTER_RED);
      g.fillText(it.s.name != null ? it.s.name : _inpMonsterText(it.s), it.ix, it.y + 1);
    });
  };
  glyphs(_inpRgba(P.accent, 0.08), 11 * S);
  glyphs(_inpRgba(P.halo, 0.85), 5 * S);
  glyphs(null, 0);
  return c;
}

// ─── On screen ───────────────────────────────────────────────────────────────

// This window's fog theme. A two-map half answers for its own column; the shell asks each half.
function initiativePanelTheme() {
  return typeof fogTheme === 'string' ? (fogThemePending || fogTheme) : 'default';
}

// The south copy sits over the left half, the north over the right, each in its own map's theme.
function _inpThemes() {
  if (typeof stageFrameWindow !== 'function') { const t = initiativePanelTheme(); return [t, t]; }
  return ['A', 'B'].map(id => {
    try { const w = stageFrameWindow(id); return (w && typeof w.initiativePanelTheme === 'function' && w.initiativePanelTheme()) || 'default'; } catch (_) { return 'default'; }
  });
}

function _inpEnsure() {
  if (_inp) return _inp;
  const canvas = document.createElement('canvas');
  canvas.id = 'initiative-tv';
  canvas.hidden = true;
  document.body.appendChild(canvas);
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  _inp = { canvas, ctx: canvas.getContext('2d'), slots: null, raf: 0, last: 0, geo: null, masks: null, copies: {},
    drawn: [], themes: [], namePx: 0, size: '', mq };
  window.addEventListener('resize', () => { if (_inp.slots) _inp.size = ''; });
  return _inp;
}

// The slots from the DM, or null to take the panel down.
function initiativePanelShow(slots) {
  if (!Array.isArray(slots) && !_inp) return;
  const s = _inpEnsure();
  if (!Array.isArray(slots)) {
    cancelAnimationFrame(s.raf);
    Object.assign(s, { slots: null, raf: 0, geo: null, masks: null, copies: {}, drawn: [], themes: [] });
    s.canvas.hidden = true;
    return;
  }
  s.slots = slots;
  s.geo = _inpSheet(s.ctx, slots);
  s.masks = slots.length ? _inpMasks(s.geo) : null;
  s.copies = {};
  s.size = '';
  s.drawn = [];
  s.themes = [];
  s.canvas.hidden = !slots.length;
  if (!s.raf && slots.length) { s.last = 0; s.raf = requestAnimationFrame(_inpFrame); }
}

function _inpFrame(now) {
  const s = _inp;
  if (!s.slots || !s.slots.length) { s.raf = 0; return; }
  s.raf = requestAnimationFrame(_inpFrame);
  const still = !!(s.mq && s.mq.matches), themes = _inpThemes();
  const W = window.innerWidth, H = window.innerHeight, dpr = window.devicePixelRatio || 1, size = W + 'x' + H + '@' + dpr;
  const changed = size !== s.size || themes[0] !== s.themes[0] || themes[1] !== s.themes[1];
  if (!changed && (still || now - s.last < INP_FPS_MS)) return;
  s.last = now;
  if (size !== s.size) {
    s.canvas.width = Math.round(W * dpr); s.canvas.height = Math.round(H * dpr);
    for (const cp of Object.values(s.copies)) cp.text = null;
  }
  s.size = size; s.themes = themes;
  const D = H / INP_REF_H * dpr, m = s.masks, t = still ? 0 : now / 1000;
  s.namePx = INP_U * H / INP_REF_H;
  for (const id of themes) {
    if (!s.copies[id]) s.copies[id] = _inpCopy(id, m);
    const cp = s.copies[id];
    if (!cp.text) { cp.text = _inpWords(cp, s.geo, m, D); s.drawn = s.geo.items.map(it => ({ n: it.s.n, name: it.s.name != null ? it.s.name : null, count: it.s.count || 0 })); }
    if (cp.at !== now) { _inpHaze(cp, m, t); cp.at = now; }
  }
  for (const k of Object.keys(s.copies)) if (!themes.includes(k)) delete s.copies[k];
  const ctx = s.ctx, cw = s.canvas.width, ch = s.canvas.height, bh = (m.box[3] - m.box[1]) * D;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cw, ch);
  themes.forEach((id, k) => {
    const cp = s.copies[id];
    ctx.setTransform(k ? -1 : 1, 0, 0, k ? -1 : 1, k ? cw : 0, k ? ch : 0);
    ctx.drawImage(cp.hz, 0, ch - bh, m.w / INP_K * D, m.h / INP_K * D);
    ctx.drawImage(cp.text, 0, ch - bh);
  });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
