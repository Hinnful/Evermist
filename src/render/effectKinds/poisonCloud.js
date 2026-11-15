'use strict';
// poisonCloud.js — Poison cloud, the 'miasma' kind: pale airy lumpy murk, bubble rings breaking into wisps, a paler
// haze on its own drift, a thick heart, faint patches and the Rolling edge. Ported from
// `.claude/private/design/item-294-poison/` round 6 (`airB`, edge 0), in lab pixels on a 36px cell (effectShaderKinds.js).

_FX_KIND_FRAG.miasma = _FX_KIND_COMMON + `
const vec3 PA = vec3(.08, .15, .05);
const vec3 PB = vec3(.28, .46, .14);
const vec3 PC = vec3(.60, .80, .36);
const vec3 PE = vec3(.56, .88, .38);
const vec3 PINK = vec3(.01, .04, .01);
void prim(float x, float se){ over(PINK, band(x, 2.4 * se) * .55); over(PE, band(x, .9 * se) * .95); }
// Soft round bumps at two sizes, each swelling and sinking on its own timer, summed so neighbours merge.
float puffH(vec2 q, float t){
  float hsum = 0.;
  for (int L = 0; L < 2; L++){
    float size = L == 0 ? 88. : 46.;
    vec2 qq = q + float(L) * 31.;
    vec2 i = floor(qq / size);
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
      vec2 c = i + vec2(float(x), float(y));
      float h = hash(c + float(L) * 11.);
      vec2 ce = (c + .5 + .6 * (h22(c + float(L) * 11. + 3.) - .5)) * size;
      float r = size * (.42 + .16 * h) * (.85 + .15 * sin(t * .35 + h * 40.));
      vec2 v = qq - ce;
      hsum += (L == 0 ? 1. : .55) * exp(-dot(v, v) / (r * r));
    }
  }
  return hsum + (sN(q * .03 + t * .03) - .5) * .06;
}
vec3 airC(vec3 c, float k){ float l = dot(c, vec3(.3, .55, .15)); return mix(c, vec3(l) * vec3(.92, 1.05, .9), .25 * k) * (1. + .15 * k); }
void bloomCell(vec2 c, float L, float size, float t, out vec2 ce, out float ph){
  float h = hash(c + L * 13.);
  ph = fract(t * (.09 + .04 * h) + h * 7.);
  ce = (c + .25 + .5 * h22(c + L * 5.)) * size;
}
// Rings of gas swelling out from points: a lit lip on the light side, shade on the far side, a glow where one starts.
void bloomRings(vec2 q, float t, out float ring, out float shade, out float core){
  ring = 0.; shade = 0.; core = 0.;
  for (int L = 0; L < 2; L++){
    float size = L == 0 ? 74. : 52.;
    vec2 qq = q + float(L) * 37.;
    vec2 i = floor(qq / size);
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
      vec2 c = i + vec2(float(x), float(y)); vec2 ce; float ph;
      bloomCell(c, float(L), size, t, ce, ph);
      vec2 v = qq - ce;
      float r = ph * size * .8;
      float dist = length(v) + (sN(v * .05 + c * 3.) - .5) * 22. * ph;
      float fade = smoothstep(0., .15, ph) * (1. - ph) * (1. - ph);
      float disk = smoothstep(r + 4., r - 8. - 18. * ph, dist);
      float lip = smoothstep(r - 24. * ph - 4., r - 2., dist) * disk;
      float side = dot(v / max(length(v), 1.), normalize(vec2(-.6, -.7)));
      ring = max(ring, (disk * .4 + lip * max(side, 0.) * 1.2) * fade);
      shade = max(shade, lip * max(-side, 0.) * 1.3 * fade);
      core = max(core, exp(-dot(v, v) / (90. + 500. * ph)) * smoothstep(.45, 0., ph) * smoothstep(0., .05, ph));
    }
  }
}

void main(){
  K = uG / 36.;
  vec2 p = vMap / K;
  float t = uTime;
  float d = sdLab(p);
  if (d > 34.) discard;
  float sw = fit(40., .12), se = fit(8., .4);
  vec2 q = p - drift(t) * 2.;
  float n = sN(q * .01 + 2.);
  float H = puffH(q * 1.1, t), hx = puffH(q * 1.1 + vec2(4., 0.), t), hy = puffH(q * 1.1 + vec2(0., 4.), t);
  float hn = smoothstep(.25, 1.2, H);
  float roll = sN(p * .02 - drift(t) * .22 + n * 1.5);
  float dd = d + (roll - .5) * 22. * fit(60., .1);
  float m = smoothstep(1.5 * sw, -2.5 * sw, dd);
  float o = cellsF(q, t, 115., .1, 60., 48.) * .5 * smoothstep(-20., -46., dd);
  vec3 nrm = normalize(vec3(-(hx - H) * 5., -(hy - H) * 5., 1.));
  float dif = dot(nrm, normalize(vec3(-.55, -.65, .55)));
  vec3 c = mix(PA * 1.3, PB, smoothstep(.1, .7, dif));
  c = mix(c, PC, smoothstep(.55, 1., dif) * .55);
  c = airC(c, 1.);
  float depth = smoothstep(-4. * sw, -34. * sw, dd);
  float a = mix(.66, .9, depth) * (.9 + .1 * hn);
  over(c, m * a * (1. - o * .82));
  over(airC(PC, 1.), o * (1. - o) * 4. * .14 * m);
  float ring, shade, core; bloomRings(q, t, ring, shade, core);
  float wisp = smoothstep(.3, .62, sN(q * .045 + vec2(t * .05, -t * .04)));
  ring *= mix(.55, 1., wisp);
  over(PA * .8, shade * .55 * m);
  over(PC * 1.12, min(ring * 1.35, 1.) * m * (1. - o * .6));
  // The haze drifts on a slower, offset path of its own, rebased so it starts where the body does.
  vec2 q2 = p - (drift(t * .8 + 40.) - drift(40.)) * 3.5;
  float hz = sN(q2 * .009 + 5.) * .65 + sN(q2 * .022 + 9.) * .35;
  over(airC(PC, 1.4), smoothstep(.45, .8, hz) * .38 * m);
  over(PE, exp(-(dd + 3. * se) * (dd + 3. * se) / (30. * se * se)) * .18);
  prim(dd + 1.5 * se, se);
  if (col.a <= .001) discard;
  gl_FragColor = col;
}`;
