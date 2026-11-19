// presetGeometry.js — pure kernel for effect presets: the sizes each shape offers, and the outline
// a size makes. Its two shape helpers come from fogGeometry.js; under Node, by require.

'use strict';

var circleVertices, coneVertices;
if (typeof module !== 'undefined' && module.exports) {
  ({ circleVertices, coneVertices } = require('../fog/fogGeometry'));
}

// Sizes follow the grid: one step is one square, 5 ft, from each shape's smallest to its largest.
// `s` is a square's side, a circle's radius, a cone's, line's or wall's length and a ring's width
// across; `w` is the line's width (one square), the wall's and the ring's thickness (1 ft). Shape and
// size only, never a spell (PRODUCT.md).
const GRID_FT = 5;
const PRESET_RANGE = { rect: [5, 30], circle: [5, 60], cone: [5, 90], line: [5, 120], wall: [5, 60], ring: [10, 60] };
const PRESET_WIDTH = { line: 5, wall: 1, ring: 1 };
// A shape with a hand tool can be drawn by drag at any size; line, wall and ring take a length alone.
const PRESET_HAS_HAND = { rect: true, circle: true, cone: true };

const EFFECT_PRESETS = {};
for (const kind of Object.keys(PRESET_RANGE)) {
  EFFECT_PRESETS[kind] = [];
  for (let s = PRESET_RANGE[kind][0]; s <= PRESET_RANGE[kind][1]; s += GRID_FT) {
    EFFECT_PRESETS[kind].push({ s, w: PRESET_WIDTH[kind] || 0 });
  }
}

// A preset's outline in map px. A circle, square or ring is centred on `origin`; a cone, line or wall
// starts at it and points along `angle`. `pxPerFt` is read once, at placement, so a later grid
// change leaves a placed effect alone.
function presetRings(kind, s, w, origin, angle, pxPerFt) {
  const S = s * pxPerFt, ux = Math.cos(angle || 0), uy = Math.sin(angle || 0);
  const at = (a, b) => ({ x: origin.x + ux * a - uy * b, y: origin.y + uy * a + ux * b });
  if (kind === 'circle') return { vertices: circleVertices(origin, { x: origin.x + S, y: origin.y }) };
  if (kind === 'rect') return { vertices: [at(-S / 2, -S / 2), at(S / 2, -S / 2), at(S / 2, S / 2), at(-S / 2, S / 2)] };
  if (kind === 'cone') return { vertices: coneVertices(origin, at(S, 0)) };
  if (kind === 'line' || kind === 'wall') {
    const h = w * pxPerFt / 2;
    return { vertices: [at(0, -h), at(S, -h), at(S, h), at(0, h)] };
  }
  if (kind === 'ring') {
    const outer = circleVertices(origin, { x: origin.x + S / 2, y: origin.y });
    const inner = circleVertices(origin, { x: origin.x + S / 2 - w * pxPerFt, y: origin.y });
    return { vertices: outer, holes: [inner.reverse()] };
  }
  return null;
}

const PRESET_LABELS = { circle: '{s} ft radius', rect: '{s} × {s} ft', cone: '{s} ft cone',
  line: '{s} × {w} ft line', wall: '{s} ft wall', ring: '{s} ft ring' };

// `word(template, values)` fills it in the interface language: t() in the window.
function presetLabel(kind, s, w, word) {
  return PRESET_LABELS[kind] ? word(PRESET_LABELS[kind], { s: s, w: w }) : '';
}

// A size as the list names it: "20 ft · 4 squares". `plural(n, one, other)` is t.plural in the window.
function presetSizeText(s, word, plural) {
  const n = s / GRID_FT;
  return word('{s} ft', { s: s }) + ' · ' + plural(n, '{n} square', '{n} squares', { n: n });
}

// The next index along a list, stopping at both ends. A shape with a hand tool has one step below the
// smallest size, index -1, which means "by hand".
function stepPresetIndex(i, n, dir, hasHand) {
  return Math.max(hasHand ? -1 : 0, Math.min(n - 1, i + dir));
}

// The preset of `kind` nearest `size` feet, or null for a shape with no sizes (the Polygon).
function presetForSize(kind, size) {
  const list = EFFECT_PRESETS[kind];
  if (!list) return null;
  let best = list[0];
  for (const z of list) if (Math.abs(z.s - size) < Math.abs(best.s - size)) best = z;
  return { kind: kind, s: best.s, w: best.w };
}

// ─── A placed preset, read back and resized ──────────────────────────────────
// A placed effect carries `preset: { kind, s, origin, angle, n }`. The outline itself says where it stands
// now and at what scale, so a moved effect resizes where it is and a later grid change leaves it alone.

// Where the preset's origin sits on an outline: a square's, circle's or ring's centre, a cone's apex, the
// middle of a line's or wall's starting end.
function presetOriginOf(kind, verts) {
  if (kind === 'cone') return { x: verts[0].x, y: verts[0].y };
  if (kind === 'line' || kind === 'wall') return { x: (verts[0].x + verts[3].x) / 2, y: (verts[0].y + verts[3].y) / 2 };
  let x = 0, y = 0;
  for (const v of verts) { x += v.x; y += v.y; }
  return { x: x / verts.length, y: y / verts.length };
}

function _presetReach(verts, o) {
  let r = 0;
  for (const v of verts) r = Math.max(r, Math.hypot(v.x - o.x, v.y - o.y));
  return r;
}

// The preset an effect or light still is, or null when it reads as By hand: none stored, a vertex count that
// no longer matches `n`, or an outline that is no longer the preset's (an edit by a build that kept the field).
// Every value read from the record goes through Number().
function effectPresetOf(rec) {
  const p = rec && rec.preset;
  if (!p || !EFFECT_PRESETS[p.kind] || !Array.isArray(rec.vertices) || rec.vertices.length !== Number(p.n)) return null;
  const s = Number(p.s), angle = Number(p.angle) || 0;
  const z = EFFECT_PRESETS[p.kind].find(x => x.s === s);
  if (!z || rec.handles) return null;
  const origin = presetOriginOf(p.kind, rec.vertices);
  const unit = presetRings(p.kind, s, z.w, origin, angle, 1);
  const pxPerFt = _presetReach(rec.vertices, origin) / _presetReach(unit.vertices, origin);
  if (!(pxPerFt > 0)) return null;
  const want = presetRings(p.kind, s, z.w, origin, angle, pxPerFt);
  const tol = Math.max(0.5, pxPerFt * 0.05);
  if (want.vertices.some((v, i) => Math.hypot(v.x - rec.vertices[i].x, v.y - rec.vertices[i].y) > tol)) return null;
  return { kind: p.kind, s, angle, origin, pxPerFt };
}

// The outline at size `s` and the preset that goes with it, or null when the record is By hand or `s` is not
// one of its shape's sizes. A square, circle or ring grows about its centre, a cone, line or wall along its
// length from its origin; a line's, wall's and ring's width stays.
function presetResized(rec, s) {
  const p = effectPresetOf(rec);
  const z = p && EFFECT_PRESETS[p.kind].find(x => x.s === s);
  if (!z) return null;
  const r = presetRings(p.kind, s, z.w, p.origin, p.angle, p.pxPerFt);
  return { vertices: r.vertices, holes: r.holes || null,
           preset: { kind: p.kind, s, origin: p.origin, angle: p.angle, n: r.vertices.length } };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { effectPresetOf, presetResized, presetOriginOf, EFFECT_PRESETS, GRID_FT, PRESET_HAS_HAND, presetRings, presetLabel, presetSizeText, stepPresetIndex, presetForSize };
}
