'use strict';
// ice.js - the Ice fog theme: pale blue, nearly still, edged with a band of faint glowing honeycomb
// (large cells), a frozen core, soft glints, crystal growth and a slow light sweep.

(typeof registerFogTheme === 'function' ? registerFogTheme : require('./fogThemes').registerFogTheme)({
  id: 'ice',
  label: 'Ice',
  swatch: '#22344a',
  hex: '#22344a',
  tint: 0.20,
  // The frozen core is the near-still motion; the warp stays Default's.
  anim: { speed: 0.08, drift: 0.03, morph: 0.02, warpStr: 0.10, warpRad: 0.06, pulse: 0.05 },
  passCol: [[1, 1, 1], [1.35, 1.45, 1.6], [0.85, 0.95, 1.1]],
  rim: [0.75, 0.9, 1],
  doorLight: [0.843, 0.941, 1],
  shaderFns: `
vec3 hexVor(vec2 x) { vec2 n = floor(x), f = fract(x); float d1 = 8., d2 = 8.; vec2 id = vec2(0.);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 g = vec2(float(i), float(j));
    vec2 o = .5 + .3 * (h22(n + g) - .5) + vec2(mod(n.y + g.y, 2.) * .5 - .25, 0.); vec2 r = g + o - f; float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = n + g + o; } else if (d < d2) d2 = d; }
  return vec3(id, sqrt(d2) - sqrt(d1)); }
`,
  shader: `
    vec2 wq = vec2(heightAtK(sp, 1.3, vec2(.71, .17)), heightAtK(sp, 1.3, vec2(.09, .54))) * .5;
    vec3 hA = hexVor(p * 16. + wq);
    float brk = smoothstep(.3, .65, fbm3(p * 3. + t * .03));
    float side = smoothstep(0., .04, fg0 - m) * smoothstep(.35, .6, fg0);
    float reach = .6 + .9 * fbm3(p * 4. + 2.);
    float deep = smoothstep(.02, .1, abs(m3 - m)) * smoothstep(.55, .75, fbm3(p * 2.5 + 9.));
    float band = max(smoothstep(.02, .14, abs(m - m2) * reach), deep * .7) * side;
    float ln = smoothstep(.07, 0., hA.z) * (.45 + .55 * h12(hA.xy)) * band * brk;
    float lit = smoothstep(.55, 1., sin(t * .3 + h12(hA.xy + 5.) * 6.283));
    ln *= 1. + 1.4 * lit;
    float cellIn = smoothstep(.02, .25, hA.z) * band * brk * lit * .12;
    float sw = exp(-pow(fract(dot(p, vec2(.85, .5)) * .5 - t * .05) - .5, 2.) * 70.);
    float sh = .7 + .3 * sin(t * .9 + fbm3(p * 2.) * 14.);
    float iceLn = edgeZ * smoothstep(.12, .28, a) * smoothstep(.55, .35, a);
    edgeGlow = ln * sh * (1. + 1.8 * sw) + iceLn * .55 + cellIn;
    edgeCol = vec3(.72, .86, 1.) * .75;
    vec3 iv = hexVor(p * 9. + wq * .6 + 3.);
    float cr = smoothstep(.04, 0., iv.z) * smoothstep(.45, .7, fbm3(p * 1.8 + 7.));
    col = mix(col, vec3(.8, .92, 1.), cr * sh * (.25 + .5 * sw) * hd);
    vec2 gg = p * 60.; vec2 gid = floor(gg); vec2 gf = fract(gg) - .5; float ghh = h12(gid);
    float tw = pow(max(0., sin(t * .8 + ghh * 60.)), 12.) * step(.988, ghh) * hd;
    col += vec3(.82, .92, 1.) * tw * smoothstep(.3, 0., length(gf)) * .35;
  `,
  trans: {
    dur: [3000, 2600],
    front: [0.396, 0.473, 0.55],
    tint: 0,
    rank: (u, v, n, f, dir, w) => (dir > 0 ? 1 - w : w) * .9 + .1 * n,
    glsl: `
// A map switch has no room: frost closes in from the screen edges and thaws from the centre.
float screenRank(vec2 sp, float n, float dir) { vec2 q = sp / uRes; float w = clamp(min(min(q.x, 1. - q.x), min(q.y, 1. - q.y)) * 2.6, 0., 1.); return (dir > 0. ? 1. - w : w) * .9 + .1 * n; }
// Encroaching ice: spiky crystal fingers run ahead along ridges, a thin rim on the front, fresh veins behind it.
float fogStep(float rk, float e, vec2 sp, float dir) {
  vec2 p0 = sp * uPatM - uPatO;
  vec2 wq = (vec2(fbm3(p0 * 4.), fbm3(p0 * 4. + 7.)) - .5) * .6;
  float spikes = pow(ridge(p0 * 14. + wq * 6.), 4.) * .24 + pow(ridge(p0 * 33. + wq * 9. + 3.), 4.) * .12;
  float r = .36 + rk * .64 - spikes;
  float x = e * 1.02 - .01; float g = smoothstep(r - .006, r + .006, x);
  // Only where fog is: the line is px wide, so beside a sharp edge it spills onto clear ground.
  gFront = max(gFront, lineAt(x - r, 2.) * .85 * smoothstep(0., .5, dir > 0. ? 1. - g : g));
  float behind = dir > 0. ? r - x : x - r;
  float veins = pow(ridge(p0 * 52. + wq * 12.), 9.);
  // The last pixels to freeze never get .24 behind the front, so the veins also thaw on the clock.
  gFront = max(gFront, veins * step(0., behind) * (1. - smoothstep(0., .24, behind)) * (1. - smoothstep(.55, .9, e)) * .45);
  return g; }
`,
  },
});
