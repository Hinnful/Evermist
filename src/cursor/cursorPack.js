'use strict';
// cursorPack.js — Evermist's pointers: each kind drawn at 1x and 2x into a PNG and written on :root as
// `--cur-<kind>`. Every CSS cursor rule reads one of those, and JS sets `cursorFor(kind)`.
// ⚠ A plain script with no app dependency: splash.html and stage.html load it alone.

const CURSOR_SIZE = 1.1;
const CURSOR_NAVY = '#0d1a35';

// The box each kind is drawn in, in CSS px, with its hotspot: the dart's tip, or the centre.
const CURSOR_BOX = {
  arrow: [19, 23, 2, 2], pointer: [19, 23, 2, 2],
  move: [25, 28, 2, 2], grab: [25, 28, 2, 2], grabbing: [25, 28, 2, 2], rotate: [25, 28, 2, 2],
  text: [14, 26, 7, 13], crosshair: [28, 28, 13, 13],
  ew: [28, 28, 13, 13], ns: [28, 28, 13, 13], nwse: [28, 28, 13, 13], nesw: [28, 28, 13, 13], col: [28, 28, 13, 13],
};
// What a window that cannot show the picture falls back to.
const CURSOR_KEYWORD = {
  arrow: 'default', pointer: 'pointer', text: 'text', crosshair: 'crosshair', move: 'move', grab: 'grab',
  grabbing: 'grabbing', rotate: 'grab', ew: 'ew-resize', ns: 'ns-resize', nwse: 'nwse-resize', nesw: 'nesw-resize',
  col: 'col-resize',
};
const CURSOR_KINDS = Object.keys(CURSOR_BOX);

function _cpPoly(pts) {
  const p = new Path2D();
  pts.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])));
  p.closePath();
  return p;
}
const _cpRot = (q, a) => [q[0] * Math.cos(a) - q[1] * Math.sin(a), q[0] * Math.sin(a) + q[1] * Math.cos(a)];
const _cpRpoly = (pts, a) => _cpPoly(pts.map(q => _cpRot(q, a)));
const _cpDeg = d => d * Math.PI / 180;

function _cpShapes() {
  const dbl = a => _cpRpoly([[10, 0], [5.4, -4], [5.4, -1.1], [-5.4, -1.1], [-5.4, -4], [-10, 0], [-5.4, 4], [-5.4, 1.1], [5.4, 1.1], [5.4, 4]], a);
  const cross = new Path2D();
  [0, 1, 2, 3].forEach(i => cross.addPath(_cpRpoly([[-0.9, -3], [0.9, -3], [0.9, -9.5], [-0.9, -9.5]], i * Math.PI / 2)));
  const rotPts = [], a0 = -50, a1 = 220;
  for (let d = a0; d <= a1; d += 10) rotPts.push([Math.cos(_cpDeg(d)) * 4.6, Math.sin(_cpDeg(d)) * 4.6]);
  for (let d = a1; d >= a0; d -= 10) rotPts.push([Math.cos(_cpDeg(d)) * 2.9, Math.sin(_cpDeg(d)) * 2.9]);
  const e = _cpDeg(a0), c = [Math.cos(e) * 3.75, Math.sin(e) * 3.75], t = [Math.sin(e), -Math.cos(e)], n = [Math.cos(e), Math.sin(e)];
  const rotate = _cpPoly(rotPts);
  rotate.addPath(_cpPoly([[c[0] + n[0] * 2.5, c[1] + n[1] * 2.5], [c[0] + t[0] * 3.1, c[1] + t[1] * 3.1], [c[0] - n[0] * 2.5, c[1] - n[1] * 2.5]]));
  return {
    arrow: _cpRpoly([[0, 0], [6.2, 15], [0, 11.4], [-6.2, 15]], _cpDeg(-24)),
    ibeam: _cpPoly([[-3.2, -8.5], [3.2, -8.5], [3.2, -7.2], [0.8, -7.2], [0.8, 7.2], [3.2, 7.2], [3.2, 8.5], [-3.2, 8.5], [-3.2, 7.2], [-0.8, 7.2], [-0.8, -7.2], [-3.2, -7.2]]),
    cross,
    ew: dbl(0), ns: dbl(Math.PI / 2), nwse: dbl(Math.PI / 4), nesw: dbl(-Math.PI / 4),
    bar: _cpPoly([[-1, -8.5], [1, -8.5], [1, 8.5], [-1, 8.5]]),
    four: _cpPoly([[0, -5.4], [2.2, -2.8], [0.8, -2.8], [0.8, -0.8], [2.8, -0.8], [2.8, -2.2], [5.4, 0], [2.8, 2.2], [2.8, 0.8], [0.8, 0.8], [0.8, 2.8], [2.2, 2.8], [0, 5.4], [-2.2, 2.8], [-0.8, 2.8], [-0.8, 0.8], [-2.8, 0.8], [-2.8, 2.2], [-5.4, 0], [-2.8, -2.2], [-2.8, -0.8], [-0.8, -0.8], [-0.8, -2.8], [-2.2, -2.8]]),
    hand: new Path2D('M-3 5 C-4.6 3.8 -5.8 1.8 -5.5 0.3 C-5.3 -0.8 -4 -0.8 -3.4 0.3 L-3 1 L-3.1 -3.9 C-3.1 -5 -1.6 -5 -1.6 -3.9 L-1.5 -0.6 L-1.4 -5.1 C-1.4 -6.2 0.1 -6.2 0.1 -5.1 L0.2 -0.6 L0.5 -4.5 C0.6 -5.6 2 -5.5 2 -4.4 L1.8 -0.4 L2.4 -3.1 C2.6 -4.1 3.9 -3.9 3.7 -2.8 L3.3 1.6 C3.1 3.6 2 4.9 0.6 5.3 Z'),
    fist: new Path2D('M-3.4 4.9 C-4.6 3.8 -4.9 1.8 -4.6 0.1 C-4.4 -1.5 -3.4 -2.6 -2.3 -2.4 C-1.7 -3.5 -0.4 -3.5 0 -2.7 C0.6 -3.5 1.9 -3.3 2.1 -2.4 C3 -2.9 4 -2.1 3.8 -0.9 L3.5 2 C3.3 3.9 2.1 5.1 0.5 5.3 Z'),
    fistLines: new Path2D('M-2.3 -2.4 Q-2.1 -1.2 -2.3 -0.4 M0 -2.7 Q0.2 -1.5 0 -0.6 M2.1 -2.4 Q2.3 -1.3 2.1 -0.5'),
    rotate,
  };
}

// White with a navy edge and a soft shadow; `lit` is the clickable blue.
function _cpFlat(ctx, path, box, lit) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.42)'; ctx.shadowBlur = 2.2; ctx.shadowOffsetX = 0.6; ctx.shadowOffsetY = 1;
  const g = ctx.createLinearGradient(box[0], box[1], box[2], box[3]);
  if (lit) { g.addColorStop(0, '#8fbaf2'); g.addColorStop(1, '#3f73c9'); } else { g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#e1eaf6'); }
  ctx.fillStyle = g; ctx.fill(path); ctx.restore();
  ctx.lineJoin = 'round'; ctx.strokeStyle = CURSOR_NAVY; ctx.lineWidth = 0.9; ctx.stroke(path);
}

function _cpDraw(ctx, kind, S) {
  const ABOX = [0, 0, 9, 15], C8 = [-8, -8, 8, 8];
  const badge = (b, extra) => {
    _cpFlat(ctx, S.arrow, ABOX);
    ctx.save(); ctx.translate(12, 15.5); _cpFlat(ctx, b, [-5, -5, 5, 5]);
    if (extra) { ctx.strokeStyle = CURSOR_NAVY; ctx.lineWidth = 0.55; ctx.lineCap = 'round'; ctx.stroke(extra); }
    ctx.restore();
  };
  if (kind === 'arrow') _cpFlat(ctx, S.arrow, ABOX);
  else if (kind === 'pointer') _cpFlat(ctx, S.arrow, ABOX, true);
  else if (kind === 'text') _cpFlat(ctx, S.ibeam, [-3, -8, 3, 8]);
  else if (kind === 'crosshair') _cpFlat(ctx, S.cross, [-9, -9, 9, 9]);
  else if (kind === 'move') badge(S.four);
  else if (kind === 'grab') badge(S.hand);
  else if (kind === 'grabbing') badge(S.fist, S.fistLines);
  else if (kind === 'rotate') badge(S.rotate);
  else if (kind === 'col') { _cpFlat(ctx, S.ew, C8); _cpFlat(ctx, S.bar, [-1, -8, 1, 8]); }
  else _cpFlat(ctx, S[kind], C8);
}

function _cpImage(kind, scale, S) {
  const [w, h, hx, hy] = CURSOR_BOX[kind];
  const c = document.createElement('canvas');
  c.width = w * scale; c.height = h * scale;
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  ctx.translate(hx, hy);
  ctx.scale(CURSOR_SIZE, CURSOR_SIZE);
  _cpDraw(ctx, kind, S);
  return c.toDataURL('image/png');
}

// kind → { x1, x2, value }. The plain image-set is tried first, then the prefixed one, then one 1x image.
const CURSOR_IMAGES = {};
let cursorPackForm = '';

function _cpBuild() {
  const S = _cpShapes(), root = document.documentElement;
  for (const kind of CURSOR_KINDS) {
    const [, , hx, hy] = CURSOR_BOX[kind];
    const x1 = _cpImage(kind, 1, S), x2 = _cpImage(kind, 2, S);
    const tail = ' ' + hx + ' ' + hy + ', ' + CURSOR_KEYWORD[kind];
    const forms = [
      ['image-set', 'image-set(url("' + x1 + '") 1x, url("' + x2 + '") 2x)' + tail],
      ['-webkit-image-set', '-webkit-image-set(url("' + x1 + '") 1x, url("' + x2 + '") 2x)' + tail],
      ['url', 'url("' + x1 + '")' + tail],
    ];
    const [form, value] = forms.find(f => CSS.supports('cursor', f[1])) || forms[2];
    cursorPackForm = form;
    CURSOR_IMAGES[kind] = { x1, x2, value };
    root.style.setProperty('--cur-' + kind, value);
  }
}

function cursorFor(kind) { return 'var(--cur-' + kind + ')'; }

// The kind a computed cursor shows, 'none', or null for one outside the pack.
const _cpKindCache = new Map();
function cursorKindOf(computed) {
  if (computed === 'none') return 'none';
  if (_cpKindCache.has(computed)) return _cpKindCache.get(computed);
  const kind = CURSOR_KINDS.find(k => computed.includes(CURSOR_IMAGES[k].x1)) || null;
  _cpKindCache.set(computed, kind);
  return kind;
}

_cpBuild();
