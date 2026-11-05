'use strict';
// fire.js - the Fire fog theme: rising smoke, lit orange from below, edged with a thin burning line and a
// charred band, with sparks climbing through it and a few rare flames.
// A heat shimmer wavers the fog's own clouds and patterns (shaderWarp), deep in the fog only.

(typeof registerFogTheme === 'function' ? registerFogTheme : require('./fogThemes').registerFogTheme)({
  id: 'fire',
  label: 'Fire',
  swatch: '#33190f',
  hex: '#33190f',
  tint: 0.20,
  anim: { speed: 0.60, drift: 0.6, morph: 0.25, warpStr: 0.10, warpRad: 0.06, pulse: 0.18 },
  // The clouds climb instead of drifting sideways (fogAnim.js).
  rise: true,
  passCol: [[0.7, 0.62, 0.58], [0.45, 0.38, 0.35], [1.0, 0.65, 0.4]],
  rim: [1, 0.5, 0.15],
  shaderFns: `
vec3 ramp(float t, vec3 r0, vec3 r1, vec3 r2, vec3 r3, vec3 r4, vec3 r5, float warm) { t = clamp(t, 0., 1.);
  vec3 c = mix(r0, r1, smoothstep(0., .22, t)); c = mix(c, r2, smoothstep(.18, .5, t)); c = mix(c, r3, smoothstep(.5, .78, t));
  return mix(c, mix(r4, r5, warm), smoothstep(.78, 1., t)); }
vec3 fireRamp(float t) { return ramp(t, vec3(.06, 0., 0.), vec3(.62, .05, 0.), vec3(1., .30, .03), vec3(1., .64, .14), vec3(1., .84, .42), vec3(1., .97, .85), .30); }
const float G = .075;
vec3 fxDrift(vec2 q, float drift, vec3 sc) { vec3 acc = vec3(0.);
  for (int L = 0; L < 2; L++) { float CS = G * (L == 0 ? .45 : .32); vec2 base0 = floor(q / CS + float(L) * .5);
    for (int j = 0; j < 4; j++) { vec2 cell = base0 + vec2(0., float(j)); float r1 = h21(cell + float(L) * 4.1), r2 = h21(cell + 7.7), r3 = h21(cell + 2.9);
      float age = fract(uTime * (.55 + .6 * r3) + r1); vec2 born = (cell - float(L) * .5 + .5 + (vec2(r1, r3) - .5) * .8) * CS;
      vec2 pos = born + vec2(sin(age * 5. + r1 * 20.) * G * .1, -age * G * 1.1); float tw = .55 + .45 * step(.4, fract(uTime * 9. + r2 * 13.));
      acc += drift * step(.72, r2) * smoothstep(G * .02, 0., length(q - pos)) * (1. - age) * tw * sc * 3.; } }
  return acc; }
float fxSteam(vec2 q) { float s1 = efbm(q * (1.2 / G) + vec2(sin(uTime * .2) * .4, uTime * .45)); float s2 = efbm(q * (2.5 / G) + vec2(uTime * .1, uTime * .85) + s1 * 1.5);
  return smoothstep(.42, .85, s1 * .55 + s2 * .55); }
float toonF(vec2 q0, float g) { vec2 q = vec2(q0.x / (g * .6), q0.y / (g * 1.15)); q.y += uTime * 1.2; q.x += (noise(vec2(q.x * .7, q.y * .35 - uTime * .5)) - .5) * .9;
  float f = fbm3(q + vec2(0., fbm3(q * .5 + 3. + uTime * .6) * 1.4)); return smoothstep(.6, .98, f); }
`,
  // Screen-px offset of the fog's sampling, fading to nothing toward a room's edge so the edge stays put.
  shaderWarp: `
  { float z = hd * smoothstep(.5, .98, m3); vec2 q0 = p0 * 28.;
    shim = (vec2(noise(q0 + vec2(0., uTime * 2.2)), noise(q0 + vec2(7., uTime * 2.6))) - .5) * 9. * uRes.y / 1080. * z; }
  `,
  shader: `
    vec2 pp = vec2(p.x, -p.y);
    col = mix(col, vec3(.05, .045, .04), .25 + fxSteam(p) * .4);
    float thin = 1. - smoothstep(.75, 1.25, dens);
    float hs = smoothstep(.55, .8, fbm3(pp * 5. + vec2(t * .05, -t * .12))); float fk = .7 + .3 * noise(pp * 12. + t * 2.);
    col += fireRamp(.45) * hs * (.4 + .6 * thin) * hd * .5 * fk;
    float ln = edgeZ * smoothstep(.12, .28, a) * smoothstep(.55, .35, a); float fl = .55 + .45 * noise(pp * 80. + vec2(0., -t * 3.));
    edgeGlow = ln * fl; edgeCol = fireRamp(.72);
    col = mix(col, vec3(.04, .015, .01), edgeZ * smoothstep(.55, .75, a) * smoothstep(1., .85, a) * .85);
    col += fxDrift(p, .45, vec3(1., .66, .28)) * hd;
    float fh = smoothstep(.7, .84, fbm3(pp * 3.5 + vec2(t * .02, -t * .04) + 21.)); float tf = toonF(p, .028) * fh;
    vec3 fc = mix(vec3(0.), fireRamp(.42) * .55, smoothstep(.1, .15, tf)); fc = mix(fc, fireRamp(.695) * .775, smoothstep(.38, .42, tf)); fc = mix(fc, fireRamp(.97), smoothstep(.66, .7, tf));
    col += fc * hd * 1.1;
  `,
  trans: {
    dur: [2600, 2600],
    front: [1, 0.5, 0.1],
    tint: 0,
    rank: (u, v, n, f, dir, w) => n,
    glsl: `
float screenRank(vec2 sp, float n, float dir) { return n; }
// Burns like paper: ragged holes open, and close again, along a thin edge line.
float fogStep(float rk, float e, vec2 sp, float dir) {
  vec2 p0 = sp * uPatM - uPatO;
  float r = clamp(rk + rag(p0, 34., .22) + (noise(p0 * 120.) - .5) * .05, 0., 1.);
  float w = .025; float x = e * (1. + 2. * w + .14) - w - .07; float g = smoothstep(r - w, r + w, x);
  gFront = max(gFront, lineAt(x - r, 2.4) * .9);
  return g; }
`,
  },
});
