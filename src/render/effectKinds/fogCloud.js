'use strict';
// fogCloud.js — Fog cloud, the 'fogbank' kind: a rolling grey-white bank with a rolling edge and faint patches
// that let the map through, never holes. Ported from `.claude/private/design/item-294/` round 6 (`bankA`, mode 4),
// in lab pixels on a 36px cell (effectShaderKinds.js).

_FX_KIND_FRAG.fogbank = _FX_KIND_COMMON + `
const vec3 FA = vec3(.50, .56, .64);
const vec3 FB = vec3(.74, .79, .85);
const vec3 FC = vec3(.93, .96, 1.0);
const vec3 INK = vec3(.04, .06, .11);
void rim(float x, float se){ over(INK, band(x, 2.2 * se) * .5); over(vec3(.86, .92, 1.), band(x, .85 * se) * .9); }
float bankN(vec2 p, float t){
  vec2 q = p * .0075 + drift(t) * .03;
  vec2 w = vec2(sN(q * 1.2 + vec2(0., t * .025)), sN(q * 1.2 + vec2(5.2, -t * .025)));
  return sN(q + w * 1.3);
}

void main(){
  K = uG / 36.;
  vec2 p = vMap / K;
  float t = uTime;
  float d = sdLab(p);
  if (d > 30.) discard;
  float sw = fit(40., .12), se = fit(8., .4);
  float n = bankN(p, t);
  float nx = bankN(p + vec2(14., 0.), t), ny = bankN(p + vec2(0., 14.), t);
  float lit = ((nx - n) + (ny - n)) * 3.2;
  float roll = sN(p * .02 - drift(t) * .22 + n * 1.5);
  float dd = d + (roll - .5) * 22. * fit(60., .1);
  float m = smoothstep(2. * sw, -7. * sw, dd);
  vec3 c = mix(FA, FB, smoothstep(.3, .62, n));
  c = mix(c, FC, smoothstep(.0, .6, lit) * .7);
  c = mix(c, FA * .9, smoothstep(.0, -.5, lit) * .45);
  float o = cellsF(p + drift(t) * 4., t, 115., .1, 60., 48.) * .5 * smoothstep(-20., -46., dd);
  over(c, m * .92 * (1. - o * .82));
  over(FB, smoothstep(-12. * sw, -60. * sw, dd) * .2 * m * (1. - o));
  over(FC, o * (1. - o) * 4. * .15 * m);
  over(FC, exp(-(dd + 3. * se) * (dd + 3. * se) / (30. * se * se)) * .25);
  rim(dd + 1.5 * se, se);
  if (col.a <= .001) discard;
  gl_FragColor = col;
}`;
