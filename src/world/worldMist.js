'use strict';
// worldMist.js — the mist over the world map: a veil and two drifting wisp textures that thin out inside
// the places, with the backdrop's own colour coming back there. One svg, built once so the drift is never
// restarted; a redraw only swaps the place shapes inside its masks. The TV never sees it.

const WMIST_CLEAR = 0.9;         // how much of the mist a place clears
const WMIST_INNER = 0.7;         // how much of the picture's own colour returns inside a place
const WMIST_SOFT = 20;           // the soft edge of a place, as a blur's deviation
const WMIST_REACH = 1500;        // how far past the layout the mist runs
const WMIST_TILE = 256;

let _wmistSvg = null;
let _wmistRef = null;
let _wmistLast = null;           // the places and scenes of the last draw, for a picture that moves alone

// Wrapped value noise, three octaves, as light wisps on a clear ground: the texture tiles with no seam.
function _wmistTile(seed) {
  const c = document.createElement('canvas');
  c.width = c.height = WMIST_TILE;
  const g = c.getContext('2d'), im = g.createImageData(WMIST_TILE, WMIST_TILE);
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const oct = [8, 16, 32].map(n => ({ n, v: Array.from({ length: n * n }, rnd) }));
  const smooth = x => x * x * (3 - 2 * x);
  for (let y = 0; y < WMIST_TILE; y++) {
    for (let x = 0; x < WMIST_TILE; x++) {
      let v = 0, w = 0, amp = 1;
      for (const o of oct) {
        const fx = x / WMIST_TILE * o.n, fy = y / WMIST_TILE * o.n, ix = Math.floor(fx), iy = Math.floor(fy);
        const tx = smooth(fx - ix), ty = smooth(fy - iy);
        const at = (a, b) => o.v[(b % o.n) * o.n + (a % o.n)];
        const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx;
        const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx;
        v += (top + (bottom - top) * ty) * amp;
        w += amp;
        amp *= 0.5;
      }
      const a = Math.max(0, Math.min(1, (v / w - 0.42) * 2.2)), i = (y * WMIST_TILE + x) * 4;
      im.data[i] = 196; im.data[i + 1] = 206; im.data[i + 2] = 224; im.data[i + 3] = Math.round(a * 120);
    }
  }
  g.putImageData(im, 0, 0);
  return c.toDataURL();
}

function worldMistInit() {
  _wmistSvg = document.getElementById('wm-mist');
  if (!_wmistSvg) return;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const drift = to => calm ? '' : '<animateTransform attributeName="patternTransform" type="translate" from="0 0" to="' + to + '" dur="' + (to.startsWith('1100') ? 80 : 110) + 's" repeatCount="indefinite"/>';
  _wmistSvg.innerHTML =
    '<defs>' +
      '<pattern id="wmist-a" patternUnits="userSpaceOnUse" width="1100" height="1100"><image href="' + _wmistTile(12345) + '" width="1100" height="1100" preserveAspectRatio="none"/>' + drift('1100 0') + '</pattern>' +
      '<pattern id="wmist-b" patternUnits="userSpaceOnUse" width="700" height="700"><image href="' + _wmistTile(777) + '" width="700" height="700" preserveAspectRatio="none"/>' + drift('-700 700') + '</pattern>' +
      '<filter id="wmist-soft" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="' + WMIST_SOFT + '"/></filter>' +
      '<mask id="wmist-inner" maskUnits="userSpaceOnUse"><g filter="url(#wmist-soft)" fill="#fff" class="wmist-inner-places"></g></mask>' +
      '<mask id="wmist-veil" maskUnits="userSpaceOnUse"><rect class="wmist-all" fill="#fff"/>' +
        '<g filter="url(#wmist-soft)" fill="#000" fill-opacity="' + WMIST_CLEAR + '" class="wmist-clear-places"></g></mask>' +
    '</defs>' +
    '<image class="wmist-picture" mask="url(#wmist-inner)" preserveAspectRatio="none"/>' +
    '<g mask="url(#wmist-veil)"><rect class="wmist-veil wmist-all"/><rect class="wmist-all" fill="url(#wmist-a)"/><rect class="wmist-all" fill="url(#wmist-b)" opacity="0.8"/></g>';
  const q = s => _wmistSvg.querySelector(s);
  _wmistRef = {
    inner: q('.wmist-inner-places'), clear: q('.wmist-clear-places'), picture: q('.wmist-picture'),
    soft: q('#wmist-soft'), masks: [q('#wmist-inner'), q('#wmist-veil')], all: _wmistSvg.querySelectorAll('.wmist-all'),
  };
}

// The backdrop's own colour, laid over the greyed one and shown only inside the places.
function worldMistPicture() {
  if (!_wmistRef) return;
  const p = worldBackgroundPicture(), img = _wmistRef.picture;
  img.style.display = p ? '' : 'none';
  if (p) {
    img.setAttribute('href', p.url);
    for (const [k, v] of Object.entries({ x: p.x, y: p.y, width: p.w, height: p.h, opacity: p.alpha * WMIST_INNER })) img.setAttribute(k, v);
  }
  if (_wmistLast) worldMistDraw(_wmistLast.places, _wmistLast.scenes);
}

function _wmistSet(el, box) {
  for (const [k, v] of Object.entries({ x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 })) el.setAttribute(k, v);
}

// Every place's outline is cut into both masks. The mist covers the picture and nothing beyond it; with no picture
// it covers the layout with room to spare.
function worldMistDraw(places, scenes) {
  if (!_wmistRef) return;
  _wmistLast = { places, scenes };
  const rings = places.map(p => wmOutline(p.rec));
  const points = [].concat(...rings, scenes.map(s => s.worldPos).filter(Boolean));
  const pic = worldBackgroundPicture();
  if (pic) points.push({ x: pic.x, y: pic.y }, { x: pic.x + pic.w, y: pic.y + pic.h });
  if (!points.length) points.push({ x: 0, y: 0 });
  const span = pts => {
    const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const p of pts) { b.x0 = Math.min(b.x0, p.x); b.y0 = Math.min(b.y0, p.y); b.x1 = Math.max(b.x1, p.x); b.y1 = Math.max(b.y1, p.y); }
    return b;
  };
  const reach = span(points), near = span([].concat(...rings, [{ x: 0, y: 0 }]));
  const grow = (b, d) => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d });
  const shapes = rings.map(r => '<polygon points="' + r.map(v => Math.round(v.x) + ',' + Math.round(v.y)).join(' ') + '"/>').join('');
  _wmistRef.inner.innerHTML = _wmistRef.clear.innerHTML = shapes;
  const big = pic ? { x0: pic.x, y0: pic.y, x1: pic.x + pic.w, y1: pic.y + pic.h } : grow(reach, WMIST_REACH);
  for (const m of _wmistRef.masks) _wmistSet(m, big);
  for (const r of _wmistRef.all) _wmistSet(r, big);
  _wmistSet(_wmistRef.soft, grow(near, WMIST_SOFT * 4));
}
