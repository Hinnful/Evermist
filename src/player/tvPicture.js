'use strict';
// tvPicture.js — a room picture on the TV: centred, the map dimmed behind it. Runs in the Player
// window and in the two-map shell, which covers both halves. roomPictures.js sends it.
// It comes and goes in patches of cloud noise on a canvas over the hidden img, which takes back
// over once whole. A CSS mask swapped per frame flashes the bare picture while each one decodes.

const TV_PIC_IN_S = 1.9, TV_PIC_OUT_S = 1.0, TV_PIC_EDGE = 0.28, TV_PIC_GRID = 96;
let _tvPicShown = null;   // the <img> coming in or up
let _tvPicLast = 0;

function _tvPicHash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function _tvPicNoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let xf = x - xi, yf = y - yi;
  xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf);
  const a = _tvPicHash(xi, yi, s), b = _tvPicHash(xi + 1, yi, s);
  const c = _tvPicHash(xi, yi + 1, s), d = _tvPicHash(xi + 1, yi + 1, s);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

// Per picture: the noise field once, in 0..1 with its contrast stretched.
function _tvPicField(img, seed) {
  const gw = TV_PIC_GRID;
  const gh = Math.max(8, Math.min(200, Math.round(gw * (img.naturalHeight || 10) / (img.naturalWidth || 16))));
  const f = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let v = 0, a = .5, k = 1, n = 0;
    for (let o = 0; o < 4; o++) { v += a * _tvPicNoise(x / gw * 4 * k, y / gw * 4 * k, seed + o * 17); n += a; a *= .5; k *= 2; }
    f[y * gw + x] = Math.min(1, Math.max(0, (v / n - .5) * 1.8 + .5));
  }
  const cv = document.createElement('canvas');
  cv.width = gw; cv.height = gh;
  return { f, cv, g: cv.getContext('2d'), data: new ImageData(gw, gh) };
}

function _tvPicDraw(s, t) {
  const e = t * (1 + TV_PIC_EDGE), d = s.field.data.data, f = s.field.f;
  for (let i = 0; i < f.length; i++) {
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255;
    d[i * 4 + 3] = Math.min(1, Math.max(0, (e - f[i]) / TV_PIC_EDGE)) * 255;
  }
  s.field.g.putImageData(s.field.data, 0, 0);
  const img = s.img, cv = img._cv, r = img.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) {
    cv.width = w; cv.height = h;
    cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
  }
  const g = cv.getContext('2d');
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
  g.globalCompositeOperation = 'destination-in';
  g.imageSmoothingEnabled = true;
  g.drawImage(s.field.cv, 0, 0, w, h);
}

function _tvPicEnd(img) {
  img._tv = null;
  img.style.visibility = '';
  img._cv.style.display = 'none';
}

function _tvPicFrame(now) {
  const dt = Math.min(0.05, (now - (_tvPicLast || now)) / 1000);
  _tvPicLast = now;
  let busy = false;
  for (const img of _tvPicLayer().querySelectorAll('img')) {
    const s = img._tv;
    if (!s) continue;
    s.t = s.in ? Math.min(1, s.t + dt / TV_PIC_IN_S) : Math.max(0, s.t - dt / TV_PIC_OUT_S);
    if (s.in && s.t === 1) _tvPicEnd(img);
    else if (!s.in && s.t === 0) {
      _tvPicEnd(img);
      img.removeAttribute('src');
      URL.revokeObjectURL(s.url);
    } else {
      _tvPicDraw(s, s.t < .5 ? 2 * s.t * s.t : 1 - Math.pow(2 - 2 * s.t, 2) / 2);
      busy = true;
    }
  }
  if (busy) requestAnimationFrame(_tvPicFrame); else _tvPicLast = 0;
}

function _tvPicRun(img, s) {
  img._tv = s;
  img.style.visibility = 'hidden';
  img._cv.style.display = '';
  _tvPicDraw(s, 0);
  if (!_tvPicLast) { _tvPicLast = performance.now(); requestAnimationFrame(_tvPicFrame); }
}

function _tvPicLayer() {
  let el = document.getElementById('tv-picture');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'tv-picture';
  for (let i = 0; i < 2; i++) {
    const img = document.createElement('img'), cv = document.createElement('canvas');
    cv.style.display = 'none';
    img._cv = cv;
    el.append(img, cv);
  }
  document.body.appendChild(el);
  return el;
}

// A whole picture has no state left, so its way out starts from a full mask.
function _tvPicRetire(img) {
  if (!img.src) return;
  if (!img.naturalWidth) { URL.revokeObjectURL(img.src); img.removeAttribute('src'); return; }
  const s = img._tv || { t: 1, url: img.src, field: _tvPicField(img, (Math.random() * 1e6) | 0), img };
  s.in = false;
  _tvPicRun(img, s);
}

// A null blob takes the picture down. A new one comes in while the old one goes.
function applyTvPicture(blob) {
  const el = _tvPicLayer();
  const old = _tvPicShown;
  if (!blob) {
    el.classList.remove('up');
    if (old) _tvPicRetire(old);
    _tvPicShown = null;
    return;
  }
  const [a, b] = el.querySelectorAll('img');
  const img = old === a ? b : a;
  if (img.src) URL.revokeObjectURL(img.src);
  img._tv = null;
  img._cv.style.display = 'none';
  img.style.visibility = 'hidden';
  _tvPicShown = img;
  const url = URL.createObjectURL(blob);
  img.onload = () => {
    if (_tvPicShown !== img) return;
    el.classList.add('up');
    _tvPicRun(img, { t: 0, in: true, url, field: _tvPicField(img, (Math.random() * 1e6) | 0), img });
    if (old) _tvPicRetire(old);
  };
  img.src = url;
}
