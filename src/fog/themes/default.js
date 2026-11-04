'use strict';
// default.js - the Default fog theme: the app's own fog, breathing slowly, with pale wisps over darker
// fog. Every theme gets Default's cloud warp, so a theme switch never rebuilds the cloud frames.

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
  `,
});
