'use strict';
// blood.js - the Blood fog theme: heavy crimson fog, thick and slow, with a wet sheen, dried patches,
// even-width blood vessels, a dim heartbeat in a few separate places and a thin dark edge.

(typeof registerFogTheme === 'function' ? registerFogTheme : require('./fogThemes').registerFogTheme)({
  id: 'blood',
  label: 'Blood',
  swatch: '#2a0c10',
  hex: '#2a0c10',
  tint: 0.18,
  anim: { speed: 0.48, drift: 0.32, morph: 0.15, warpStr: 0.10, warpRad: 0.06, pulse: 0.0 },
  passCol: [[0.7, 0.5, 0.5], [0.45, 0.2, 0.2], [0.9, 0.5, 0.5]],
  // Black: the dark edge is the whole edge, and a pale rim beside it read as a doubled one.
  rim: [0, 0, 0],
  doorLight: [0.902, 0.157, 0.118],
  shaderFns: `
float vline(vec2 x, float w) { float e = .03; float n = noise(x);
  vec2 g = vec2(noise(x + vec2(e, 0.)) - noise(x - vec2(e, 0.)), noise(x + vec2(0., e)) - noise(x - vec2(0., e))) / (2. * e);
  return smoothstep(w, 0., abs(n - .5) / max(length(g), .05)); }
float heart2(float s) { float ph = mod(s, 4.2); return exp(-pow((ph - .15) / .06, 2.)) + .75 * exp(-pow((ph - .48) / .07, 2.)); }
`,
  shader: `
    vec2 hc = p * 2.2, hid = floor(hc); vec2 hctr = .3 + .4 * h22(hid + 3.);
    float hdist = length(fract(hc) - hctr) + .12 * (fbm3(p * 8.) - .5);
    float hv = smoothstep(.24, .04, hdist) * step(.45, h12(hid + 9.));
    float beat = heart2(t + h12(hid) * 9.) * hv;
    float hs1 = heightAt(sp + normalize(vec2(-1., -1.3)) * uTile * .015);
    float hlit = clamp((dens - hs1) * 6., 0., 1.);
    float sh = pow(hlit, 1.5) * smoothstep(.85, 1.35, dens);
    col += (vec3(.95, .45, .45) * sh * .5 + vec3(1., .8, .8) * pow(hlit, 6.) * .35) * hd;
    float pf = fbm3(p * 7. + 3.7) + .15 * (fbm3(p * 30.) - .5);
    float pt = smoothstep(.68, .71, pf); float rp = smoothstep(.66, .69, pf) - pt;
    float crack = smoothstep(.04, 0., abs(fbm3(p * 40.) - .5));
    col = mix(col, vec3(.08, .02, .015), pt * .8 * hd);
    col = mix(col, vec3(.28, .03, .03), pt * crack * .6 * hd);
    col = mix(col, vec3(.15, .02, .02), rp * .5 * hd);
    vec2 wq = vec2(fbm3(p * 3. + t * .02), fbm3(p * 3. + 5. - t * .015)) * 1.4;
    float v1 = vline(p * 14. + wq, .032), v2 = vline(p * 22. + wq * 1.5 + 13., .028) * .8, v3 = vline(p * 36. + wq * 2. + 7., .024) * .55;
    float ves = max(max(v1, v2), v3) * (.8 + .2 * beat);
    col = mix(col, vec3(.26, .01, .03), ves * hd * .8);
    col += vec3(.5, .03, .05) * max(v1, v2) * hd * (.1 + .12 * beat);
    col += vec3(.5, .04, .06) * beat * .13 * hd;
    col *= 1. - .06 * (hv - beat) * hd;
    col = mix(col, vec3(.06, 0., .01), edgeZ * smoothstep(.45, .7, a) * smoothstep(1., .85, a) * .9);
  `,
  trans: {
    dur: [3200, 3200],
    front: [0.16, 0, 0.015],
    tint: 1,
    rank: (u, v, n, f, dir, w, vn) => .5 * v + .3 * vn(u * 11, v * 2.2 + 7) + .1 * vn(u * 31, v * 5 + 2) + .2 * n,
    glsl: `
float screenRank(vec2 sp, float n, float dir) { vec2 q = sp / uRes; return clamp((.5 * q.y + .3 * noise(vec2(q.x * 11., q.y * 2.2 + 7.)) + .1 * noise(vec2(q.x * 31., q.y * 5. + 2.)) + .2 * n) / 1.05, 0., 1.); }
// Runs like liquid: the fog drips down in long drops and blots and soaks away, drying dark at the edge.
float fogStep(float rk, float e, vec2 sp, float dir) {
  vec2 p0 = sp * uPatM - uPatO;
  float blot = (fbm3(vec2(p0.x * 24., p0.y * 9.) + 4.) - .5) * .26;
  float r = clamp(rk + blot + rag(p0, 40., .08), 0., 1.);
  float x = e * 1.34 - .17; float g = smoothstep(r - .035, r + .035, x);
  // Reveal only: hiding, the dark front dims the arriving fog below its own colour before it has covered.
  gFront = max(gFront, (1. - smoothstep(0., .07, abs(x - r))) * .8 * step(0., dir));
  return g; }
`,
  },
});
