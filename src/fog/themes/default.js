'use strict';
// default.js - the Default fog theme: the app's own fog, breathing slowly, with pale wisps over darker
// fog, edged with a soft pale line and a darker band inside it. Every theme gets Default's cloud warp, so a
// theme switch never rebuilds the cloud frames.

(typeof registerFogTheme === 'function' ? registerFogTheme : require('./fogThemes').registerFogTheme)({
  id: 'default',
  label: 'Default',
  swatch: '#1a1a2e',
  hex: '#1a1a2e',
  tint: 0.18,
  anim: { speed: 0.60, drift: 0.5, morph: 0.20, warpStr: 0.10, warpRad: 0.06, pulse: 0.15 },
  passCol: [[1, 1, 1], [1, 1, 1], [1, 1, 1]],
  rim: [0.6, 0.64, 0.85],
  shaderFns: '',
  shader: `
    float wv = .5 + .5 * sin(t * .35 + fbm3(p * 1.5 + t * .02) * 6.);
    col *= .82 + .36 * wv;
    col *= .72;
    float wp = smoothstep(.5, .82, efbm(p * 3.5 + vec2(t * .035, t * .012)));
    col = mix(col, vec3(.5, .53, .66), wp * .4 * hd);
    float dl = edgeZ * smoothstep(.1, .28, a) * smoothstep(.62, .36, a);
    float dfl = .6 + .4 * fbm3(p * 16. + vec2(t * .25, -t * .1));
    edgeGlow = dl * dfl * .55; edgeCol = vec3(.62, .66, .86) * .8;
    col = mix(col, col * .6, edgeZ * smoothstep(.55, .75, a) * smoothstep(1., .86, a) * .6);
  `,
  trans: {
    dur: [3000, 3000],
    front: [0.279, 0.297, 0.387],
    tint: 0,
    rank: (u, v, n, f, dir, w) => n,
    glsl: `
float screenRank(vec2 sp, float n, float dir) { return n; }
// Clouds part, blown by the wind: fuzzy, wispy edges that drift sideways as the holes open.
float fogStep(float rk, float e, vec2 sp, float dir) {
  vec2 p0 = sp * uPatM - uPatO;
  float wind = (fbm3(p0 * vec2(3., 5.) + vec2(uTime * .55, uTime * .12)) - .5) * .34 * (1. - e * .6);
  float fuzz = (fbm3(p0 * 20. + vec2(uTime * .3, 0.)) - .5) * .22 + (fbm3(p0 * 44. - vec2(uTime * .2, 0.)) - .5) * .07;
  float r = clamp(rk + wind + fuzz, 0., 1.);
  float x = e * 1.4 - .2; float g = smoothstep(r - .1, r + .1, x);
  gFront = max(gFront, lineAt(x - r, 3.2) * .5);
  return g; }
`,
  },
});
