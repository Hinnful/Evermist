'use strict';
// toxic.js - the Toxic fog theme: green fog that churns, gives off fumes, glows from below, bubbles
// and eats at itself in corroded patches, edged with a thin flickering acid-green line.

(typeof registerFogTheme === 'function' ? registerFogTheme : require('./fogThemes').registerFogTheme)({
  id: 'toxic',
  label: 'Toxic',
  swatch: '#22361a',
  hex: '#22361a',
  tint: 0.22,
  anim: { speed: 0.75, drift: 0.7, morph: 0.32, warpStr: 0.10, warpRad: 0.06, pulse: 0.22 },
  passCol: [[0.75, 0.85, 0.7], [1.1, 1.05, 0.5], [0.6, 0.85, 0.5]],
  rim: [0.5, 0.85, 0.2],
  shaderFns: `
vec3 ramp(float t, vec3 r0, vec3 r1, vec3 r2, vec3 r3, vec3 r4, vec3 r5, float warm) { t = clamp(t, 0., 1.);
  vec3 c = mix(r0, r1, smoothstep(0., .22, t)); c = mix(c, r2, smoothstep(.18, .5, t)); c = mix(c, r3, smoothstep(.5, .78, t));
  return mix(c, mix(r4, r5, warm), smoothstep(.78, 1., t)); }
vec3 acidRamp(float t) { return ramp(t, vec3(.04, .03, 0.), vec3(.25, .30, .02), vec3(.60, .80, .05), vec3(.85, 1., .2), vec3(.95, 1., .5), vec3(1., 1., .85), .45); }
const float G = .075;
vec3 fxBubbles(vec2 q0, float bub, float bubSize) { vec3 acc = vec3(0.);
  for (int L = 0; L < 2; L++) { float CS = G * (L == 0 ? .55 : .32); vec2 q = q0 + float(L) * vec2(17., 31.) * G; vec2 cell = floor(q / CS);
    float r1 = h21(cell + float(L) * 3.7), r2 = h21(cell + 7.3), r3 = h21(cell + 3.1);
    float on = step(1. - bub * .85, r2); float age = fract(uTime * (.22 + .3 * r3) + r1);
    vec2 c = (cell + .5) * CS + (vec2(r1, r3) - .5) * CS * .45; float R = CS * .5 * bubSize * (.4 + .6 * r1) * smoothstep(0., .85, age);
    float dist = length(q - c), alive = step(age, .9); float rim = smoothstep(G * .022, 0., abs(dist - R)) * alive;
    float body = smoothstep(R, R * .5, dist) * .22 * alive; float hl = smoothstep(R * .3, 0., length(q - c + vec2(R * .38))) * alive;
    float pop = smoothstep(.9, .925, age) * smoothstep(1., .94, age) * smoothstep(G * .03, 0., abs(dist - R * 1.35));
    acc += on * ((rim * .7 + body) * acidRamp(.62) + (hl * .25 + pop * .6) * acidRamp(.7)); }
  return acc; }
float fxSteam(vec2 q) { float s1 = efbm(q * (1.2 / G) + vec2(sin(uTime * .2) * .4, uTime * .45)); float s2 = efbm(q * (2.5 / G) + vec2(uTime * .1, uTime * .85) + s1 * 1.5);
  return smoothstep(.42, .85, s1 * .55 + s2 * .55); }
`,
  shader: `
    vec2 pp = vec2(p.x, -p.y);
    float f = fxSteam(p * 1.4); col = mix(col, vec3(.6, .72, .35), f * .3 * hd);
    float hol = 1. - smoothstep(.9, 1.4, dens);
    float g = smoothstep(.45, .75, fbm3(pp * 3.5 + vec2(t * .05, -t * .04))) * (.5 + .5 * hol) * (.75 + .25 * sin(t * .9 + fbm3(pp * 3.) * 6.));
    col += vec3(.35, .9, .1) * g * .45 * hd;
    float ln = edgeZ * smoothstep(.12, .28, a) * smoothstep(.55, .35, a); float fl = .55 + .45 * noise(pp * 80. + vec2(0., -t * 1.5));
    edgeGlow = ln * fl * .45; edgeCol = vec3(.55, 1., .15) * .8;
    col = mix(col, vec3(.04, .07, .02), edgeZ * smoothstep(.55, .75, a) * smoothstep(1., .85, a) * .5);
    float hn = fbm3(pp * 20. + vec2(0., t * .02)) + .1 * noise(pp * 70.); float ht = .86 - .08 * smoothstep(.6, .75, fbm3(pp * 2. + 31.));
    float hole = smoothstep(ht, ht + .015, hn) * hd; float hr = smoothstep(ht - .04, ht, hn) * hd - hole;
    col = mix(col, vec3(.015, .02, .01), hole); col += vec3(.75, 1., .15) * hr * .6;
    col += fxBubbles(p, .1, .45) * .7 * smoothstep(.15, .3, cl) * hd;
  `,
  trans: {
    dur: [2800, 2800],
    front: [0.22, 0.4, 0.06],
    tint: 0,
    rank: (u, v, n, f, dir, w) => .6 * n + .4 * f,
    glsl: `
float screenRank(vec2 sp, float n, float dir) { return .6 * n + .4 * noise(sp / uRes.y * 20.); }
// Rust: the fog is eaten through in ragged, pitted holes, edged with a thin acid-green line.
float fogStep(float rk, float e, vec2 sp, float dir) {
  vec2 p0 = sp * uPatM - uPatO;
  float r = clamp(rk + rag(p0, 26., .5) + (noise(p0 * 90.) - .5) * .12, 0., 1.);
  float x = e * 1.5 - .25; float g = smoothstep(r - .02, r + .02, x);
  // Only where fog is: the line is px wide, so beside a sharp edge it spills onto clear ground.
  gFront = max(gFront, lineAt(x - r, 2.2) * .9 * smoothstep(0., .5, dir > 0. ? 1. - g : g));
  return g; }
`,
  },
});
