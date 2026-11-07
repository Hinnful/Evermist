'use strict';
// playerFogShader.js - the Player's fog shaders, as source. Data only; playerFogPass.js compiles them.

const PLAYER_FOG_VERT = `
precision highp float;
attribute vec2 aPos;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
varying vec2 vScreen;
void main() {
  vScreen = aPos;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aPos, 1.0)).xy, 0.0, 1.0);
}
`;

// A WebGL2 context takes no derivatives in ESSL 1.00 shaders, so there these same sources are
// compiled as ESSL 3.00: the prefixes below rename what 3.00 renamed. WebGL1 keeps ESSL 1.00 and the
// extension (playerFogPass.js).
const PLAYER_FOG_ES3_VERT = '#version 300 es\n#define attribute in\n#define varying out\n';
const PLAYER_FOG_ES3_FRAG = '#version 300 es\nprecision highp float;\nout vec4 fogOut;\n#define gl_FragColor fogOut\n#define texture2D texture\n#define varying in\n';

// WARNING: The cloud texture is sampled with REPEAT wrap, never fract(uv): a wrapped sample keeps its
// derivatives across the tile edge, and fract() puts a hard line there under linear filtering.
// highp, not mediump: mediump loses whole pixels past ~2000 and the cloud UVs step.
// WARNING: KEEP THE SOURCE ASCII, comments included - a driver may reject the rest, and the cost is a
// black Player screen with no error the app can show.
// WARNING: ONE PROGRAM PER THEME, the theme baked in as a constant: one program holding every theme ran at
// 1 fps, because the driver runs every branch that samples a texture. A theme's code stays in its own
// branch, and the mask is never sampled in a loop (the edge effects read uNear, three blurs packed in r, g, b).
const PLAYER_FOG_HEAD = `
precision highp float;
varying vec2 vScreen;
uniform sampler2D uCloud;
uniform sampler2D uMask;
uniform sampler2D uMaskPrev;
uniform sampler2D uNear;
uniform sampler2D uNearPrev;
uniform sampler2D uOrder;
uniform sampler2D uRank;
uniform sampler2D uDoor;
uniform vec4  uCloudM[3];
uniform vec2  uCloudO[3];
uniform float uCloudA[3];
uniform vec3  uCloudC[3];
uniform vec2  uMaskM;
uniform vec2  uMaskO;
uniform vec2  uMaskLim;
uniform vec3  uBase;
uniform vec3  uTint;
uniform vec3  uRim;
uniform vec3  uDoorCol;
uniform float uTintA;
uniform float uCover;
uniform float uFade;
uniform float uHasPrev;
uniform float uNow;
uniform vec2  uDur;
uniform vec2  uRes;
uniform vec2  uPatM;
uniform vec2  uPatO;
uniform float uTile;
uniform float uTime;
uniform float uCoverDir;   // 1 while the cover closes, 0 while it opens: each way is the theme's own
uniform float uSwap;       // a map switch's theme swap, 0..1 under the closed cover; -1 = none

// Local progress, set per pixel at the top of main(): gT of a fog change (1 = the new fog shows),
// gC of the scene-switch cover (1 = closed). gFront is the glow of the moving front (a theme's
// fogStep raises it). gN blends the near copies: gT where the mask itself changes, else gS, the change's
// clock with no front shape, so a neighbour's edge effects never trace the front's outline.
float gT;
float gS;
float gN;
float gC;
float gFront;

float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), u.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), u.x), u.y); }
float fbm3(vec2 p) { return (noise(p) * .5 + noise(p * 2.03 + 3.1) * .25 + noise(p * 4.01 + 7.7) * .125) / .875; }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float efbm(vec2 p) { float v = 0., a = .5; for (int i = 0; i < 5; i++) { v += a * vn(p); p = p * 2.03 + vec2(11., 7.); a *= .5; } return v; }

// How much fog sits at a mask UV: the current mask, or the outgoing one where a change is still travelling.
float maskRaw(vec2 m) {
  float cur = texture2D(uMask, m).a;
  return mix(cur, mix(texture2D(uMaskPrev, m).a, cur, gT), uHasPrev);
}
// The three blurred copies (r small, g medium, b wide; white = clear), blended like the mask.
vec3 nearRaw(vec2 m) {
  vec3 cur = texture2D(uNear, m).rgb;
  return mix(cur, mix(texture2D(uNearPrev, m).rgb, cur, gN), uHasPrev);
}
// The cover must reach every mask read, uNear included, or rooms show through a closed cover.
float maskAt(vec2 m) { return min(1.0, maskRaw(m) + gC); }

// How thick the clouds are at a screen pixel: the three passes' alpha, as the main loop sums it.
float heightAt(vec2 sp) {
  float h = 0.;
  for (int i = 0; i < 3; i++) {
    vec2 uv = vec2(uCloudM[i].x * sp.x + uCloudM[i].y * sp.y, uCloudM[i].z * sp.x + uCloudM[i].w * sp.y) - uCloudO[i];
    h += texture2D(uCloud, uv).a * uCloudA[i];
  }
  return h;
}

// The same thickness at k times the clouds' frequency, shifted by c in cloud UV. WARNING: Scale the UV,
// never the screen point: heightAt(sp * k) leaves the pan offset unscaled, so the pattern slides
// against the map whenever the view moves.
float heightAtK(vec2 sp, float k, vec2 c) {
  float h = 0.;
  for (int i = 0; i < 3; i++) {
    vec2 uv = vec2(uCloudM[i].x * sp.x + uCloudM[i].y * sp.y, uCloudM[i].z * sp.x + uCloudM[i].w * sp.y) - uCloudO[i];
    h += texture2D(uCloud, uv * k + c).a * uCloudA[i];
  }
  return h;
}
`;

const PLAYER_FOG_MAIN = `
void main() {
  vec2 sp = vScreen;
  gFront = 0.;
  vec2 muv = sp * uMaskM - uMaskO;
  bool inMap = muv.x >= 0.0 && muv.y >= 0.0 && muv.x <= uMaskLim.x && muv.y <= uMaskLim.y;
  // A fog change travels on a clock of its own per pixel: uOrder (NEAREST) holds its start in ms on a
  // 16-bit clock (g, b) and its direction (a: 255 reveal, 128 hide, 0 none); uRank (LINEAR, so the
  // holes' edges are smooth) holds its rank. No change here shows the new fog.
  gT = 1.0; gN = 1.0;
  float dMask = 0.;
  if (inMap && uHasPrev > .5) {
    fogClock(muv, sp, uNow);
    dMask = abs(texture2D(uMask, muv).a - texture2D(uMaskPrev, muv).a);
    gN = mix(gS, gT, smoothstep(.15, .5, dMask));
  }
  // The cover closes and opens in the theme's own hide and reveal, anchored to the SCREEN so the map swap under it moves nothing.
  gC = 0.;
  if (uCover > .001) {
    vec2 sc = sp / uRes.y;
    float nC = clamp((fbm3(sc * 2.2 + 3.7) * .85 + .15 * noise(sc * 14.) - .3) / .4, 0., 1.);
    gC = uCoverDir > .5 ? fogStep(screenRank(sp, nC, -1.), uCover, sp, -1.) : 1. - fogStep(screenRank(sp, nC, 1.), 1. - uCover, sp, 1.);
  }
  float fg0 = 1.0;
  float fgRaw = 1.0;   // the fog with no cover over it
  float m = 1.0; float m2 = 1.0; float m3 = 1.0;
  vec2 dl = vec2(0.);
  if (inMap) {
    dl = texture2D(uDoor, muv).rg;
    fgRaw = maskRaw(muv);
    fg0 = min(1.0, fgRaw + gC);
    vec3 nr = nearRaw(muv);
    m  = min(1., 1.0 - nr.g + gC);
    m2 = min(1., 1.0 - nr.r + gC);
    m3 = min(1., 1.0 - nr.b + gC);
    // Clear ground with no fog within the widest blur has nothing to draw: skip the clouds.
    if (fg0 < 0.004 && m3 < 0.004 && uHasPrev < 0.5 && gC < 0.004) { gl_FragColor = vec4(0.0); return; }
  }
  // Effects follow the fog, so a cover closing or opening fades them in step with it.
  float hd = max(smoothstep(.6, 1., fgRaw), smoothstep(0., .35, gC));
  // Patterns are anchored to the map, one unit about a screen height at 1:1. uPatM/uPatO are pinned
  // across a map switch like the clouds, so the pattern never jumps under the closed cover.
  vec2 p0 = sp * uPatM - uPatO;
  // A theme's warp sets shim (screen px) to move the fog's own sampling; the mask is never shifted.
  vec2 shim = vec2(0.);
  SHIM_WARP
  vec2 sw = sp + shim;
  vec2 p = p0 + shim * uPatM;
  float t = uTime;
  vec3 col = uBase; float dens = 0.;
  for (int i = 0; i < 3; i++) {
    vec2 uv = vec2(uCloudM[i].x * sw.x + uCloudM[i].y * sw.y, uCloudM[i].z * sw.x + uCloudM[i].w * sw.y) - uCloudO[i];
    // c.rgb arrives PREMULTIPLIED - a plain mix() double-multiplies and washes the clouds out.
    vec4 c = texture2D(uCloud, uv);
    col = c.rgb * uCloudC[i] * uCloudA[i] + col * (1.0 - c.a * uCloudA[i]);
    dens += c.a * uCloudA[i];
  }
  float cl = dot(col, vec3(.299, .587, .114));
  // Volume: the cloud lit from the top left, crests catching light and thin parts sinking darker.
  vec2 lo = normalize(vec2(-1., -1.3)) * uTile * .03;
  float h1 = heightAt(sw + lo);
  float lit0 = clamp((dens - h1) * 7., -1., 1.);
  float bank = smoothstep(.8, 1.5, dens);
  col *= (.6 + .6 * bank) * (1. + .5 * lit0);
  col = mix(col, uTint, uTintA);
  // Darker against the walls: the ring of fog thins near a room's edge, and the colour shades down there.
  float wall = clamp(1. - min(m, m2 * 1.2), 0., 1.) * hd;
  // edgeZ: only where the fog changes, so a half room's even 50 % does not count as an edge.
  float edgeZ = smoothstep(.04, .15, abs(fg0 - m2)) * (1. - gC);
  col *= mix(1., .45, wall);
  col += uTint * .12 * (1. - wall) * hd * smoothstep(.9, 1.3, dens);
  // The living edge: the fog's own thickness nudges where the edge sits, so it curls as the clouds drift.
  float a = 1.0; float rimS = 0.;
  if (inMap) {
    vec2 w = (vec2(heightAtK(sp, 1.8, vec2(.37, .81)), heightAtK(sp, 1.8, vec2(.63, .29))) - 1.15) * .018 * uRes.y * uMaskM;
    float aC = texture2D(uMask, muv + w).a, aP = texture2D(uMaskPrev, muv + w).a;
    a = mix(aC, mix(aP, aC, gT), uHasPrev);
    // The rim is shaped on each mask and then blended: shaped on the blend, a whole room passes through it mid-reveal.
    float rC = smoothstep(.1, .4, aC) * smoothstep(.78, .4, aC), rP = smoothstep(.1, .4, aP) * smoothstep(.78, .4, aP);
    rimS = mix(rC, mix(rP, rC, gT), uHasPrev);
  }
  float aF = min(1., a + gC);
  float rim = rimS * (.65 + .35 * sin(t * .6 + dens * 7.)) * (1. - gC);
  float edgeGlow = 0.; vec3 edgeCol = vec3(0.);
  if (uTheme == THEME_INDEX) {
`;

// The front's glow only where the fog really changes: a change's own pixels, or what the cover has not covered.
// A map switch's swap then washes the incoming theme over the outgoing one (uSwap), in its own hide.
const PLAYER_FOG_TAIL = `
  }
  // Light from a door (uDoor: r the glow, g the notch). It tints and lifts the fog past a lit notch and
  // never thins it, so nothing past the door shows. Each half needs clear ground and fog together,
  // read from the near copies, so it comes and goes with the fog's own change.
  float dG = min(1., dl.r * 2.4) * smoothstep(0., .2, 1. - m) * (1. - gC);
  col = mix(col, uDoorCol, dG * .5) + uDoorCol * dG * .2;
  float dB = dl.g * smoothstep(.03, .2, m) * (1. - aF) * (1. - gC);
  if (gFront > .001) {
    float chg = 1.;
    if (uCover > .001) chg = 1. - fgRaw;
    // Only where the fog really comes or goes: a neighbour's feather thickening a little draws no front.
    if (uHasPrev > .5 && inMap) chg = smoothstep(.25, .6, dMask);
    gFront *= chg;
  }
  float swF = 1.;
  if (uSwap >= 0.) {
    vec2 scS = sp / uRes.y;
    float nS = clamp((fbm3(scS * 2.2 + 3.7) * .85 + .15 * noise(scS * 14.) - .3) / .4, 0., 1.);
    gFront = 0.;
    swF = fogStep(screenRank(sp, nS, -1.), uSwap, sp, -1.);
  }
  col = mix(col, FRONT_COL, gFront * FRONT_TINT);
  gl_FragColor = vec4(col * aF + uRim * rim * .22 + edgeCol * edgeGlow * (1. - gC) + FRONT_COL * gFront * (1. - FRONT_TINT)
    + uDoorCol * dB * .22, aF) * uFade * swF;
}
`;

// Helpers every theme's fogStep may use. lineAt: a line of the same width in screen px wherever it
// falls (d is the signed progress gap, fwidth turns it into px); without derivatives a fixed width.
const PLAYER_FOG_TRANS_LIB = `
float rag(vec2 p0, float k, float a) { return (fbm3(p0 * k + fbm3(p0 * k * .3) * 1.7) - .5) * a; }
float ridge(vec2 q) { return 1. - abs(fbm3(q) * 2. - 1.); }
`;
const PLAYER_FOG_LINE_DERIV = `
float lineAt(float d, float px) { float fw = max(fwidth(d), 1e-5); return 1. - smoothstep(px * .45, px, abs(d) / fw); }
`;
const PLAYER_FOG_LINE_FIXED = `
float lineAt(float d, float px) { return 1. - smoothstep(px * .45, px, abs(d) / .004); }
`;

// The per-pixel clock of a fog change, shared by the fog pass and the bake below so the two never differ.
// Sets gT; needs muv inside the map and a change in flight.
const PLAYER_FOG_CLOCK = `
void fogClock(vec2 muv, vec2 sp, float now) {
  vec4 od = texture2D(uOrder, muv);
  float rk = texture2D(uRank, muv).r;
  float st = floor(od.g * 255. + .5) * 256. + floor(od.b * 255. + .5);
  bool rv = od.a > .75;
  float kk = clamp(mod(now - st + 65536., 65536.) / (rv ? uDur.x : uDur.y), 0., 1.);
  float ee = 1. - pow(1. - kk, rv ? 2.2 : 1.6);
  gT = od.a < .25 ? 1. : fogStep(rk, ee, sp, rv ? 1. : -1.);
  // Every theme's front passes a pixel near ee = rk; gS reaches 1 as the clock ends, so dropping the change pops nothing.
  gS = od.a < .25 ? 1. : smoothstep(rk - .25, min(rk + .25, 1.), ee);
  // A front fades out as its clock ends, so dropping the change pops nothing.
  gFront *= 1. - smoothstep(.85, 1., kk);
}
`;

// The bake: what the TV shows right now, from the theme's own fogStep, so a change starting over one still
// moving takes over from exactly that. uOldCur is the mask before the new one; a pixel a running change keeps
// (uTake clear) stays its outgoing self. uFull 0 bakes the grid for a read-back (r), 1 the outgoing mask the
// fog pass reads (a, premultiplied).
const PLAYER_FOG_BAKE_MAIN = `
uniform sampler2D uOldCur;
uniform sampler2D uTake;
uniform vec2 uGrid;
uniform float uBakeNow;
uniform float uFull;
void main() {
  vec2 muv = vScreen / uGrid;
  float prev = texture2D(uMaskPrev, muv).a, v = texture2D(uOldCur, muv).a;
  if (texture2D(uOrder, muv).a > .25) {
    gFront = 0.;
    fogClock(muv, (muv + uMaskO) / uMaskM, uBakeNow);
    v = texture2D(uTake, muv).a > .5 ? mix(prev, v, gT) : prev;
  }
  gl_FragColor = vec4(v, v, v, uFull > .5 ? v : 1.);
}
`;

function playerFogTransSrc(rec, deriv) {
  const tr = rec.trans;
  return (rec.shaderFns || '')
    + 'const vec3 FRONT_COL = vec3(' + tr.front.map(c => c.toFixed(3)).join(', ') + ');\nconst float FRONT_TINT = ' + tr.tint + '.;\n'
    + PLAYER_FOG_TRANS_LIB + (deriv ? PLAYER_FOG_LINE_DERIV : PLAYER_FOG_LINE_FIXED) + tr.glsl + PLAYER_FOG_CLOCK;
}

// One fragment source per theme: the shared base, the theme's helpers, its transition and its own
// branch. deriv: the context has derivatives (playerFogPass.js adds the #extension line on top).
function playerFogFrag(rec, index, deriv) {
  return PLAYER_FOG_HEAD.replace('precision highp float;', 'precision highp float;\nconst int uTheme = ' + index + ';')
    + playerFogTransSrc(rec, deriv)
    + PLAYER_FOG_MAIN.replace('THEME_INDEX', String(index)).replace('SHIM_WARP', rec.shaderWarp || '')
    + rec.shader
    + PLAYER_FOG_TAIL;
}

function playerFogBakeFrag(rec, deriv) {
  return PLAYER_FOG_HEAD + playerFogTransSrc(rec, deriv) + PLAYER_FOG_BAKE_MAIN;
}
