'use strict';
// playerFogPass.js — the Player's fog: one full-screen GPU pass, its shaders and the textures it
// samples. renderer.js owns the context it draws into.

// ⚠ FULL-SCREEN, NEVER MAP-SIZED. The DM's fog is map-sized sprites (dmFogLayer.js); the Player
// needs fog past the map edge too, and two layers meeting at that edge is the seam. One pass covers
// the window and masks only inside the map rect, so there is no edge for a seam to sit on.

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

// ⚠ The cloud texture is sampled with REPEAT wrap, never fract(uv): a wrapped sample keeps its
// derivatives across the tile edge, and fract() puts a hard line there under linear filtering.
// highp, not mediump: mediump loses whole pixels past ~2000 and the cloud UVs step.
// ⚠ KEEP THE SOURCE ASCII, comments included - a driver may reject the rest, and the cost is a
// black Player screen with no error the app can show.
// ⚠ ONE PROGRAM PER THEME, the theme baked in as a constant: one program holding every theme ran at
// 1 fps, because the driver runs every branch that samples a texture. A theme's code stays in its own
// branch, and the mask is never sampled in a loop (the edge effects read uNear1..3, pre-blurred).
const PLAYER_FOG_HEAD = `
precision highp float;
varying vec2 vScreen;
uniform sampler2D uCloud;
uniform sampler2D uMask;
uniform sampler2D uMaskPrev;
uniform sampler2D uNear1;
uniform sampler2D uNear2;
uniform sampler2D uNear3;
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
uniform float uTintA;
uniform float uCover;
uniform float uTransT;
uniform float uHasPrev;
uniform vec2  uRes;
uniform vec2  uPScale;
uniform float uTile;
uniform float uTime;

float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), u.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), u.x), u.y); }
float fbm3(vec2 p) { return (noise(p) * .5 + noise(p * 2.03 + 3.1) * .25 + noise(p * 4.01 + 7.7) * .125) / .875; }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float efbm(vec2 p) { float v = 0., a = .5; for (int i = 0; i < 5; i++) { v += a * vn(p); p = p * 2.03 + vec2(11., 7.); a *= .5; } return v; }

// How much fog sits at a mask UV: the current mask, the outgoing one mid-crossfade, and the cover.
float maskAt(vec2 m) {
  float cur = texture2D(uMask, m).a;
  float a = mix(cur, mix(texture2D(uMaskPrev, m).a, cur, uTransT), uHasPrev);
  return min(1.0, a + uCover);
}

// How thick the clouds are at a screen pixel: the three passes' alpha, as the main loop sums it.
float heightAt(vec2 sp) {
  float h = 0.;
  for (int i = 0; i < 3; i++) {
    vec2 uv = vec2(uCloudM[i].x * sp.x + uCloudM[i].y * sp.y, uCloudM[i].z * sp.x + uCloudM[i].w * sp.y) - uCloudO[i];
    h += texture2D(uCloud, uv).a * uCloudA[i];
  }
  return h;
}
`;

const PLAYER_FOG_MAIN = `
void main() {
  vec2 sp = vScreen;
  vec2 muv = sp * uMaskM - uMaskO;
  bool inMap = muv.x >= 0.0 && muv.y >= 0.0 && muv.x <= uMaskLim.x && muv.y <= uMaskLim.y;
  float fg0 = 1.0;
  float m = 1.0; float m2 = 1.0; float m3 = 1.0;
  if (inMap) {
    fg0 = maskAt(muv);
    m  = 1.0 - texture2D(uNear2, muv).r;
    m2 = 1.0 - texture2D(uNear1, muv).r;
    m3 = 1.0 - texture2D(uNear3, muv).r;
    // Clear ground with no fog within the widest blur has nothing to draw: skip the clouds.
    if (fg0 < 0.004 && m3 < 0.004 && uHasPrev < 0.5 && uCover < 0.004) { gl_FragColor = vec4(0.0); return; }
  }
  // Patterns are anchored to the map, one unit about a screen height at 1:1.
  vec2 p = muv * uPScale;
  float t = uTime;
  vec3 col = uBase; float dens = 0.;
  for (int i = 0; i < 3; i++) {
    vec2 uv = vec2(uCloudM[i].x * sp.x + uCloudM[i].y * sp.y, uCloudM[i].z * sp.x + uCloudM[i].w * sp.y) - uCloudO[i];
    // c.rgb arrives PREMULTIPLIED - a plain mix() double-multiplies and washes the clouds out.
    vec4 c = texture2D(uCloud, uv);
    col = c.rgb * uCloudC[i] * uCloudA[i] + col * (1.0 - c.a * uCloudA[i]);
    dens += c.a * uCloudA[i];
  }
  // Volume: the cloud lit from the top left, crests catching light and thin parts sinking darker.
  vec2 lo = normalize(vec2(-1., -1.3)) * uTile * .03;
  float h1 = heightAt(sp + lo);
  float lit0 = clamp((dens - h1) * 7., -1., 1.);
  float bank = smoothstep(.8, 1.5, dens);
  col *= (.6 + .6 * bank) * (1. + .5 * lit0);
  col = mix(col, uTint, uTintA);
  // Darker against the walls: the ring of fog thins near a room's edge, and the colour shades down there.
  float hd = smoothstep(.6, 1., fg0);
  float wall = clamp(1. - min(m, m2 * 1.2), 0., 1.) * hd;
  // edgeZ: only where the fog changes, so a half room's even 50 % does not count as an edge.
  float edgeZ = smoothstep(.04, .15, abs(fg0 - m2));
  col *= mix(1., .45, wall);
  col += uTint * .12 * (1. - wall) * hd * smoothstep(.9, 1.3, dens);
  // The living edge: the fog's own thickness nudges where the edge sits, so it curls as the clouds drift.
  float a = 1.0;
  if (inMap) {
    vec2 w = (vec2(heightAt(sp * 1.8 + vec2(910., 370.)), heightAt(sp * 1.8 + vec2(130., 710.))) - 1.15) * .018 * uRes.y * uMaskM;
    a = maskAt(muv + w);
  }
  float rim = smoothstep(.1, .4, a) * smoothstep(.78, .4, a) * (.65 + .35 * sin(t * .6 + dens * 7.));
  float edgeGlow = 0.; vec3 edgeCol = vec3(0.);
  if (uTheme == THEME_INDEX) {
`;

const PLAYER_FOG_TAIL = `
  }
  gl_FragColor = vec4(col * a + uRim * rim * .22 + edgeCol * edgeGlow, a);
}
`;

// One fragment source per theme: the shared base, the theme's helpers and its own branch.
function playerFogFrag(rec, index) {
  return PLAYER_FOG_HEAD.replace('precision highp float;', 'precision highp float;\nconst int uTheme = ' + index + ';')
    + (rec.shaderFns || '')
    + PLAYER_FOG_MAIN.replace('THEME_INDEX', String(index))
    + rec.shader
    + PLAYER_FOG_TAIL;
}

// The cloud tile on the Player is room-sized: this fraction of the old map-sized tile.
const PLAYER_FOG_CLOUD_SIZE = 0.3;
// The near-fog copies: the reveal mask blurred small, medium and wide (px at the capped size), so
// an edge effect reads how much fog sits around a pixel with one sample. Capped to the pixel count
// of 960x540, so a 10000x6000 map costs no more to blur than a TV picture.
const PLAYER_FOG_NEAR_BLUR = [6, 13, 30];
const PLAYER_FOG_NEAR_AREA = 960 * 540;
const PLAYER_FOG_NEAR_PAD = 96;

let pixiPFogMesh     = null;
let pixiPFogGeom     = null;
let pixiPFogShader   = null;   // the theme in use
let pixiPFogShaders  = null;   // theme id -> its compiled shader, all on one uniform group
let pixiPFogUniforms = null;
let pixiPFogThemeId  = null;
let pixiPFogCloudBT  = null;
let pixiPFogCloudSrc = null;
let pixiPFogMaskBT   = null;
let pixiPFogPrevBT   = null;
let pixiPFogMaskCvs  = null;   // fogBlurCanvas, or its clamped proxy
let pixiPFogMaskSrc  = null;
let pixiPFogPrevCvs  = null;
let pixiPFogPrevSrc  = null;
let pixiPFogNear     = null;   // [{ cvs, bt }] x 3
let pixiPFogNearTmp  = null;   // the mask as black with its alpha, padded with fog

function pixiPlayerFogReady() { return !!pixiPFogMesh; }

function pixiSizePlayerFogQuad(w, h) {
  if (!pixiPFogGeom) return;
  pixiPFogGeom.getBuffer('aPos').update(new Float32Array([0, 0, w, 0, w, h, 0, h]));
}

// The three blurred copies: r is how CLEAR a pixel's surroundings are (white revealed), as the mask
// the edge code was tuned on. Ground outside the map is fog, so the copy is padded with it.
function pixiBuildPlayerFogNear(blurCvs) {
  const k = Math.min(1, Math.sqrt(PLAYER_FOG_NEAR_AREA / (blurCvs.width * blurCvs.height)));
  const w = Math.max(8, Math.round(blurCvs.width * k)), h = Math.max(8, Math.round(blurCvs.height * k));
  const pad = PLAYER_FOG_NEAR_PAD;
  if (!pixiPFogNear) {
    pixiPFogNear = PLAYER_FOG_NEAR_BLUR.map(() => ({ cvs: document.createElement('canvas'), bt: null }));
    pixiPFogNearTmp = document.createElement('canvas');
  }
  const tmp = pixiPFogNearTmp;
  if (tmp.width !== w + 2 * pad || tmp.height !== h + 2 * pad) { tmp.width = w + 2 * pad; tmp.height = h + 2 * pad; }
  const tc = tmp.getContext('2d');
  tc.globalCompositeOperation = 'source-over';
  tc.filter = 'none';
  tc.fillStyle = '#fff';
  tc.fillRect(0, 0, tmp.width, tmp.height);
  // The mask's alpha as black, over the white; the ring around it is fog.
  const lay = document.createElement('canvas');
  lay.width = w; lay.height = h;
  const lc = lay.getContext('2d');
  lc.drawImage(blurCvs, 0, 0, w, h);
  lc.globalCompositeOperation = 'source-in';
  lc.fillStyle = '#000';
  lc.fillRect(0, 0, w, h);
  tc.drawImage(lay, pad, pad);
  tc.fillStyle = '#000';
  tc.fillRect(0, 0, tmp.width, pad);
  tc.fillRect(0, tmp.height - pad, tmp.width, pad);
  tc.fillRect(0, 0, pad, tmp.height);
  tc.fillRect(tmp.width - pad, 0, pad, tmp.height);
  PLAYER_FOG_NEAR_BLUR.forEach((px, i) => {
    const n = pixiPFogNear[i];
    if (n.cvs.width !== w || n.cvs.height !== h) { n.cvs.width = w; n.cvs.height = h; if (n.bt) { n.bt.destroy(); n.bt = null; } }
    const c = n.cvs.getContext('2d');
    c.filter = 'none';
    c.fillStyle = '#fff';
    c.fillRect(0, 0, w, h);
    c.filter = 'blur(' + px + 'px)';
    c.drawImage(tmp, -pad, -pad);
    c.filter = 'none';
    if (!n.bt) {
      n.bt = PIXI.BaseTexture.from(n.cvs, { scaleMode: PIXI.SCALE_MODES.LINEAR });
      if (pixiPFogUniforms) pixiPFogUniforms.uniforms['uNear' + (i + 1)] = new PIXI.Texture(n.bt);
    } else n.bt.update();
  });
}

// One program per theme, compiled and drawn once into a throwaway target, so the driver has them
// ready before play: it compiles a program on its first draw, which stalls for seconds.
function pixiWarmPlayerFogThemes() {
  if (!pixiApp || !pixiPFogMesh) return;
  const rt = PIXI.RenderTexture.create({ width: 16, height: 16 });
  const active = pixiPFogMesh.shader;
  try {
    for (const id of Object.keys(pixiPFogShaders)) {
      pixiPFogMesh.shader = pixiPFogShaders[id];
      pixiApp.renderer.render(pixiPFogMesh, { renderTexture: rt, clear: true });
    }
  } catch (e) { console.error('[fog theme warm-up]', e); }
  pixiPFogMesh.shader = active;
  rt.destroy(true);
}

// blurCvs is the reveal mask (alpha = how fogged); cloudCvs is the 512² cross-faded cloud frame.
function pixiInitPlayerFog(blurCvs, cloudCvs) {
  if (!pixiApp || !pixiScreenLayer || !blurCvs || !cloudCvs) return;
  pixiDestroyPlayerFog();

  pixiPFogCloudSrc = cloudCvs;
  pixiPFogCloudBT = PIXI.BaseTexture.from(cloudCvs, {
    scaleMode: PIXI.SCALE_MODES.LINEAR,
    wrapMode:  PIXI.WRAP_MODES.REPEAT,
  });

  pixiPFogMaskSrc = blurCvs;
  pixiPFogMaskCvs = pixiClampCanvas(blurCvs) || blurCvs;
  pixiPFogMaskBT  = PIXI.BaseTexture.from(pixiPFogMaskCvs, { scaleMode: PIXI.SCALE_MODES.LINEAR });

  // Bound to the mask itself until a transition supplies its own: a sampler with no texture
  // reads as black and would reveal the whole map.
  pixiPFogPrevSrc = null;
  pixiPFogPrevCvs = pixiPFogMaskCvs;
  pixiPFogPrevBT  = pixiPFogMaskBT;

  pixiPFogGeom = new PIXI.Geometry()
    .addAttribute('aPos', new PIXI.Buffer(new Float32Array(8), false, false), 2)
    .addIndex([0, 1, 2, 0, 2, 3]);

  pixiPFogUniforms = new PIXI.UniformGroup({
    uCloud:    new PIXI.Texture(pixiPFogCloudBT),
    uMask:     new PIXI.Texture(pixiPFogMaskBT),
    uMaskPrev: new PIXI.Texture(pixiPFogPrevBT),
    uNear1:    PIXI.Texture.WHITE,
    uNear2:    PIXI.Texture.WHITE,
    uNear3:    PIXI.Texture.WHITE,
    uCloudM:   new Float32Array(12),
    uCloudO:   new Float32Array(6),
    uCloudA:   new Float32Array(3),
    uCloudC:   new Float32Array(9),
    uMaskM:    new Float32Array([1, 1]),
    uMaskO:    new Float32Array([0, 0]),
    uMaskLim:  new Float32Array([1, 1]),
    uBase:     new Float32Array([0, 0, 0]),
    uTint:     new Float32Array([0, 0, 0]),
    uRim:      new Float32Array([0, 0, 0]),
    uTintA:    0,
    uCover:    0,
    uTransT:   1,
    uHasPrev:  0,
    uRes:      new Float32Array([1, 1]),
    uPScale:   new Float32Array([1, 1]),
    uTile:     1,
    uTime:     0,
  });
  pixiBuildPlayerFogNear(blurCvs);

  pixiPFogShaders = {};
  FOG_THEMES.forEach((rec, i) => {
    pixiPFogShaders[rec.id] = PIXI.Shader.from(PLAYER_FOG_VERT, playerFogFrag(rec, i), pixiPFogUniforms);
  });
  pixiPFogThemeId = fogThemeNormalize(fogTheme);
  pixiPFogShader = pixiPFogShaders[pixiPFogThemeId];

  pixiPFogMesh = new PIXI.Mesh(pixiPFogGeom, pixiPFogShader);
  // screen, not renderer.width: the quad uses the same CSS pixels as panX/panY/zoom.
  pixiSizePlayerFogQuad(pixiApp.renderer.screen.width, pixiApp.renderer.screen.height);
  pixiScreenLayer.addChild(pixiPFogMesh);   // appended: always above the grid sprite
  pixiWarmPlayerFogThemes();
}

// ⚠ REBUILDS WHEN EITHER CANVAS IS REPLACED, not only when repainted: rebuildFogBlur makes a
// fresh canvas when the map's size changes, and a texture bound to the old one shows stale reveals.
function pixiSyncPlayerFog(blurCvs, cloudCvs) {
  if (!blurCvs || !cloudCvs) return;
  if (!pixiPFogMesh || pixiPFogMaskSrc !== blurCvs || pixiPFogCloudSrc !== cloudCvs) {
    pixiInitPlayerFog(blurCvs, cloudCvs);
    return;
  }
  if (pixiPFogMaskCvs !== pixiPFogMaskSrc) pixiRefreshProxy(pixiPFogMaskCvs, pixiPFogMaskSrc);
  pixiPFogMaskBT.update();
  pixiBuildPlayerFogNear(blurCvs);
}

// The cross-faded cloud frame was repainted; drift alone needs no upload.
function pixiUploadPlayerFogCloud() {
  if (pixiPFogCloudBT) pixiPFogCloudBT.update();
}

// The outgoing mask of a reveal or shroud crossfade. Null unbinds it and drops uHasPrev to 0.
function pixiSetPlayerFogPrevMask(cvs) {
  if (!pixiPFogShader) return;
  const q = pixiPFogUniforms.uniforms;
  if (!cvs) {
    if (pixiPFogPrevBT && pixiPFogPrevBT !== pixiPFogMaskBT) pixiPFogPrevBT.destroy();
    pixiPFogPrevSrc = null;
    pixiPFogPrevCvs = pixiPFogMaskCvs;
    pixiPFogPrevBT  = pixiPFogMaskBT;
    q.uMaskPrev = new PIXI.Texture(pixiPFogMaskBT);
    return;
  }
  if (pixiPFogPrevSrc !== cvs) {
    if (pixiPFogPrevBT && pixiPFogPrevBT !== pixiPFogMaskBT) pixiPFogPrevBT.destroy();
    pixiPFogPrevSrc = cvs;
    pixiPFogPrevCvs = pixiClampCanvas(cvs) || cvs;
    pixiPFogPrevBT  = PIXI.BaseTexture.from(pixiPFogPrevCvs, { scaleMode: PIXI.SCALE_MODES.LINEAR });
    q.uMaskPrev = new PIXI.Texture(pixiPFogPrevBT);
    return;
  }
  if (pixiPFogPrevCvs !== pixiPFogPrevSrc) pixiRefreshProxy(pixiPFogPrevCvs, pixiPFogPrevSrc);
  pixiPFogPrevBT.update();
}

// Every per-frame number the shader reads. `u` is built in fog.js, which owns the cloud transform.
function pixiUpdatePlayerFog(u) {
  if (!pixiPFogShader) return;
  const id = fogThemeNormalize(u.theme);
  if (id !== pixiPFogThemeId) {
    pixiPFogThemeId = id;
    pixiPFogShader = pixiPFogShaders[id];
    pixiPFogMesh.shader = pixiPFogShader;
  }
  const q = pixiPFogUniforms.uniforms;
  q.uCloudM.set(u.cloudM);
  q.uCloudO.set(u.cloudO);
  q.uCloudA.set(u.cloudA);
  q.uCloudC.set(u.cloudC);
  q.uMaskM.set(u.maskM);
  q.uMaskO.set(u.maskO);
  q.uMaskLim.set(u.maskLim);
  q.uBase.set(u.base);
  q.uTint.set(u.tint);
  q.uRim.set(u.rim);
  q.uRes.set(u.res);
  q.uPScale.set(u.pScale);
  q.uTintA   = u.tintA;
  q.uCover   = u.cover;
  q.uTransT  = u.transT;
  q.uHasPrev = u.hasPrev;
  q.uTile    = u.tile;
  q.uTime    = u.time;
}

// The Player's grid, still drawn in Canvas-2D but shown INSIDE the Pixi canvas beneath the fog
// mesh. A DOM layer above the Pixi canvas would put grid lines over unexplored ground.
let pixiPGridSpr = null;
let pixiPGridBT  = null;
let pixiPGridCvs = null;

function pixiSetPlayerGrid(cvs) {
  if (!pixiApp || !pixiScreenLayer || !cvs || pixiPGridCvs === cvs) return;
  pixiDestroyPlayerGrid();
  pixiPGridCvs = cvs;
  pixiPGridBT  = PIXI.BaseTexture.from(cvs, { scaleMode: PIXI.SCALE_MODES.NEAREST });
  pixiPGridSpr = new PIXI.Sprite(new PIXI.Texture(pixiPGridBT));
  pixiScreenLayer.addChildAt(pixiPGridSpr, 0);   // index 0: under the fog mesh, always
}

// ⚠ Only where renderPlayerGrid actually repaints. This uploads a screen-sized texture, so calling
// it per frame costs more than the fog pass itself.
// ⚠ THE SIZE FIRST. syncSize resizes this canvas in place and BaseTexture.update() does not
// re-read it, so a stale texture stretches the sprite and the grid slides against the map.
function pixiUploadPlayerGrid() {
  if (!pixiPGridBT) return;
  if (pixiPGridBT.realWidth  !== pixiPGridCvs.width ||
      pixiPGridBT.realHeight !== pixiPGridCvs.height) {
    pixiPGridBT.setRealSize(pixiPGridCvs.width, pixiPGridCvs.height);
  }
  if (pixiPGridSpr) {
    pixiPGridSpr.width = pixiPGridCvs.width;
    pixiPGridSpr.height = pixiPGridCvs.height;
    pixiPGridSpr.visible = true;
  }
  pixiPGridBT.update();
}

// The grid switched off. Hiding beats uploading a blank canvas, and keeps the texture for later.
function pixiHidePlayerGrid() {
  if (pixiPGridSpr) pixiPGridSpr.visible = false;
}

function pixiDestroyPlayerGrid() {
  if (pixiPGridSpr) {
    if (pixiScreenLayer) pixiScreenLayer.removeChild(pixiPGridSpr);
    pixiPGridSpr.destroy();
    pixiPGridSpr = null;
  }
  if (pixiPGridBT) { pixiPGridBT.destroy(); pixiPGridBT = null; }
  pixiPGridCvs = null;
}

function pixiDestroyPlayerFog() {
  if (pixiPFogMesh) {
    if (pixiScreenLayer) pixiScreenLayer.removeChild(pixiPFogMesh);
    pixiPFogMesh.destroy();
    pixiPFogMesh = null;
  }
  if (pixiPFogPrevBT && pixiPFogPrevBT !== pixiPFogMaskBT) pixiPFogPrevBT.destroy();
  if (pixiPFogMaskBT)  pixiPFogMaskBT.destroy();
  if (pixiPFogCloudBT) pixiPFogCloudBT.destroy();
  pixiPFogGeom = null; pixiPFogShader = null;
  pixiPFogCloudBT = null; pixiPFogCloudSrc = null;
  pixiPFogMaskBT = null; pixiPFogPrevBT = null;
  pixiPFogMaskCvs = null; pixiPFogMaskSrc = null;
  pixiPFogPrevCvs = null; pixiPFogPrevSrc = null;
}
