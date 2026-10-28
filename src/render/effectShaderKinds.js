'use strict';
// effectShaderKinds.js — the one-pass fragment shaders of the effects that are not flames: 'ward'
// (Area: a bezel of edge lines, crawling ticks and glyphs) and 'rough' (Difficult terrain: heaving
// relief under crawling shadow pools). Ported from `.claude/private/design/item-187/materials-lab-5.html`,
// modes 0 and 3, which the DM picked.
//
// ⚠ THE LAB DREW IN PIXELS WITH A 36PX CELL. Every length is divided by k = uG/36 on the way in, so
// the look keeps its size against the map grid and the prototype's numbers stay as picked.

const _FX_KIND_COMMON = `
precision highp float;
varying vec2 vMap;
uniform vec2 uVerts[${MAX_FX_VERTS}];
uniform float uBreak[${MAX_FX_VERTS}];
uniform int uCount;
uniform float uTime, uG, uPerim;
uniform vec3 uTint;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a*noise(p); p = mat2(.8,-.6,.6,.8)*p*2.03; a *= .5; } return s; }

// One edge of the shape: nearest distance, the crossing-parity flip, and the arc length along the outer ring.
void segStep(vec2 p, vec2 a, vec2 b, bool outer, inout float best, inout float s, inout float bestO, inout float per, inout float acc){
  vec2 e = b - a, w = p - a; float len = length(e);
  float t = clamp(dot(w, e) / max(len * len, 1e-6), 0., 1.);
  float dd = length(w - e * t);
  best = min(best, dd);
  if (outer){
    if (dd < bestO){ bestO = dd; per = acc + t * len; }
    acc += len;
  }
  bool c1 = p.y >= a.y, c2 = p.y < b.y, c3 = e.x*w.y > e.y*w.x;
  if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
}
// Signed distance to the shape (negative inside) over every ring, and 'per', the arc length along the
// OUTER ring at the nearest outer edge. ⚠ EACH RING CLOSES AT ITS OWN FIRST POINT (uBreak), as in effectShader.js.
float sdPolyP(vec2 p, out float per){
  float best = 1e12, s = 1., bestO = 1e12, acc = 0.; per = 0.;
  bool outer = true;
  vec2 ringStart = uVerts[0], vprev = uVerts[0];
  for (int i = 1; i < ${MAX_FX_VERTS}; i++){
    if (i >= uCount) break;
    vec2 va = uVerts[i];
    if (uBreak[i] > .5){ segStep(p, vprev, ringStart, outer, best, s, bestO, per, acc); outer = false; ringStart = va; }
    else segStep(p, vprev, va, outer, best, s, bestO, per, acc);
    vprev = va;
  }
  segStep(p, vprev, ringStart, outer, best, s, bestO, per, acc);
  return s * best;
}

vec4 col = vec4(0.);
void over(vec3 c, float a){ a = clamp(a, 0., 1.); col = col*(1.-a) + vec4(c*a, a); }
float band(float x, float w){ return 1. - smoothstep(w - .7, w + .7, abs(x)); }
float segD(vec2 p, vec2 a, vec2 b, out float h){ vec2 pa = p - a, ba = b - a; h = clamp(dot(pa, ba)/dot(ba, ba), 0., 1.); return length(pa - ba*h); }

// A glowing line with a dark line under it, so it reads on snow and on stone alike.
void edgeLine(float x, float w, float a, vec3 c){
  over(vec3(.02, .03, .07), band(x, w + 1.) * .45 * a);
  over(c, band(x, w) * a);
  over(c, exp(-x * x / 18.) * .22 * a);
}
`;

const _FX_FRAG_WARD = _FX_KIND_COMMON + `
// One small glyph in an 11x7 cell, picked by the cell index.
float glyphD(vec2 q, float ci){
  float h1 = hash(vec2(ci, 1.)), h2 = hash(vec2(ci, 2.)), h3 = hash(vec2(ci, 3.)), h4 = hash(vec2(ci, 4.));
  float hh, gd = 9.;
  if (h1 > .3) gd = min(gd, segD(q, vec2(2. + h2 * 6., .5), vec2(2. + h2 * 6., 6.5), hh));
  else gd = min(gd, abs(length(q - vec2(5.5, 3.5)) - 2.5));
  if (h3 > .5) gd = min(gd, segD(q, vec2(1.5, h3 > .75 ? .5 : 6.5), vec2(9., h3 > .75 ? 6.5 : .5), hh));
  if (h4 > .55) gd = min(gd, segD(q, vec2(2.5, h2 > .5 ? .5 : 6.5), vec2(8.5, h2 > .5 ? .5 : 6.5), hh));
  return gd;
}

void main(){
  float k = uG / 36.;
  vec2 p = vMap / k;
  float t = uTime;
  float per;
  float d = sdPolyP(vMap, per) / k;
  per /= k;
  if (d > 6.) discard;
  float perim = uPerim / k;
  float inside = smoothstep(.6, -.6, d);
  float depth = -d;
  vec3 tint = uTint;

  over(tint, .05 * inside);
  edgeLine(d + 1.5, .9, 1., tint);
  edgeLine(d + 11., .5, .55, tint);
  float P = perim / max(floor(perim / 9.), 1.), u = per - t * 4.;
  float idx = floor(u / P), f = fract(u / P), slot = mod(idx, 6.);
  if (slot < .5){
    vec2 q = vec2((f * P - P * .5) * 1.25 + 5.5, depth - 3.2);
    float sh = .35 + .65 * pow(.5 + .5 * sin(u * .035 - t * 1.2), 3.);
    over(tint, band(glyphD(q, idx), .55) * step(-1., q.y) * step(q.y, 8.) * sh);
  } else if (slot > 1.5 && slot < 4.5){
    float lo = slot > 2.5 && slot < 3.5 ? 8.5 : 7.;
    float zone = smoothstep(2.4, 3.2, depth) * (1. - smoothstep(lo - .4, lo + .4, depth));
    over(tint, band((f - .5) * P, .45) * zone * .65);
  }
  if (col.a <= .001) discard;
  gl_FragColor = col;
}`;

const _FX_FRAG_ROUGH = _FX_KIND_COMMON + `
float ragged(vec2 p, float d, float amp){ return d + (fbm(p * .05 + 7.) - .5) * amp; }
void relief(vec2 p, float t, vec2 off, float la, float m, float kk){
  vec2 lp = p + off;
  float h0 = fbm(lp * .035), hx = fbm((lp + vec2(1., 0.)) * .035), hy = fbm((lp + vec2(0., 1.)) * .035);
  vec3 nrm = normalize(vec3((h0 - hx) * 30., (h0 - hy) * 30., 1.));
  float lit = dot(nrm, normalize(vec3(cos(la), sin(la), .9)));
  over(vec3(.05, .04, .06), (.06 + smoothstep(.93, .7, lit) * .38) * m * kk);
  over(vec3(1., .97, .9), smoothstep(.97, 1., lit) * .35 * m * kk);
}

void main(){
  float k = uG / 36.;
  vec2 p = vMap / k;
  float t = uTime;
  float per;
  float d = sdPolyP(vMap, per) / k;
  if (d > 12.) discard;
  vec3 ink = vec3(.08, .06, .05);
  float dd = ragged(p, d, 12.); float m = smoothstep(.6, -.6, dd);
  vec3 shade = vec3(.03, .02, .05);
  relief(p, t, vec2(fbm(p * .01 + t * .12), fbm(p * .01 + 5. - t * .1)) * 16., 2.3, m, .9);
  vec2 wq = p * .014 + vec2(fbm(p * .008 + t * .07), fbm(p * .008 + 3. - t * .06)) * 1.8;
  float n = fbm(wq + vec2(t * .03, 0.));
  over(shade, smoothstep(.5, .42, n) * .5 * m);
  over(shade, smoothstep(.42, .34, n) * .25 * m);
  over(ink, band(dd + 1., 1.2) * .4);
  if (col.a <= .001) discard;
  gl_FragColor = col;
}`;

// The fragment source each non-flame kind draws with; a flame draws the two passes in effectShader.js.
const _FX_KIND_FRAG = { ward: _FX_FRAG_WARD, rough: _FX_FRAG_ROUGH };
