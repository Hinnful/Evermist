'use strict';
// playerFogPass.js — the Player's fog: one full-screen GPU pass and the textures it samples. The
// shaders are playerFogShader.js, a fog change's order texture playerFogTrans.js. renderer.js owns
// the context it draws into.

// ⚠ FULL-SCREEN, NEVER MAP-SIZED. The DM's fog is map-sized sprites (dmFogLayer.js); the Player
// needs fog past the map edge too, and two layers meeting at that edge is the seam. One pass covers
// the window and masks only inside the map rect, so there is no edge for a seam to sit on.

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
let pixiPFogShaders  = null;   // theme id -> its shader, all sharing one uniform group
let pixiPFogShadersOut = null; // the same programs with their own uFade, for the fading-out pass
let pixiPFogOutMesh  = null;   // the outgoing theme, drawn above the main mesh while it fades
let pixiPFogOutId    = null;
let pixiPFogFadeAt   = 0;
let pixiPFogDrawn    = false;  // a frame has been drawn since init: only then does a theme change fade
const PLAYER_FOG_THEME_FADE_MS = 500;
// A map switch swaps the theme under the closed cover instead: the incoming theme washes over the
// outgoing one in its own hide (uSwap), above it in the stack.
const PLAYER_FOG_THEME_SWAP_MS = 1800;
let pixiPFogSwapAt   = 0;      // when the swap began; 0 = none
let pixiPFogDeriv    = null;   // a WebGL1 context has fwidth (a theme's constant-width lines), probed once
let pixiPFogUniforms = null;
// The fog's colours, in groups of their own so the outgoing mesh can keep the old theme's through a
// swap: the live one, and the one the outgoing mesh reads (a copy of the live one, or frozen).
let pixiPFogColors    = null;
let pixiPFogOutColors = null;

function pixiNewFogColors() {
  return new PIXI.UniformGroup({
    uCloudC: new Float32Array(9),
    uBase:   new Float32Array([0, 0, 0]),
    uTint:   new Float32Array([0, 0, 0]),
    uRim:    new Float32Array([0, 0, 0]),
    uTintA:  0,
  });
}

function pixiCopyFogColors(from, to) {
  to.uCloudC.set(from.uCloudC); to.uBase.set(from.uBase); to.uTint.set(from.uTint); to.uRim.set(from.uRim);
  to.uTintA = from.uTintA;
}
let pixiPFogThemeId  = null;
let pixiPFogCloudBT  = null;
let pixiPFogCloudSrc = null;
let pixiPFogMaskBT   = null;
let pixiPFogMaskCvs  = null;   // fogBlurCanvas, or its clamped proxy
let pixiPFogMaskSrc  = null;
let pixiPFogNear     = null;   // the three blurred canvases, before packing
let pixiPFogNearCvs  = null;   // the three packed into r, g, b: what the shader samples
let pixiPFogNearBT   = null;
let pixiPFogNearPrevCvs = null;
let pixiPFogNearPrevBT = null; // the outgoing set while a change runs; null = none
let pixiPFogNearTmp  = null;   // the mask as black with its alpha, padded with fog

function pixiPlayerFogReady() { return !!pixiPFogMesh; }

function pixiSizePlayerFogQuad(w, h) {
  if (!pixiPFogGeom) return;
  pixiPFogGeom.getBuffer('aPos').update(new Float32Array([0, 0, w, 0, w, h, 0, h]));
}

// The three blurred copies, packed into one texture (r small, g medium, b wide): how CLEAR a pixel's
// surroundings are (white revealed), as the mask the edge code was tuned on. Ground outside the map is
// fog, so the copy is padded with it. All canvas-to-canvas GPU work, no readback; per update: three
// blurs at <= 960x540, six fills and draws, one texture upload. Packs into `out`; true if it resized.
function pixiPackPlayerFogNear(blurCvs, out) {
  const k = Math.min(1, Math.sqrt(PLAYER_FOG_NEAR_AREA / (blurCvs.width * blurCvs.height)));
  const w = Math.max(8, Math.round(blurCvs.width * k)), h = Math.max(8, Math.round(blurCvs.height * k));
  const pad = PLAYER_FOG_NEAR_PAD;
  if (!pixiPFogNear) {
    pixiPFogNear = PLAYER_FOG_NEAR_BLUR.map(() => document.createElement('canvas'));
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
  const resized = out.width !== w || out.height !== h;
  if (resized) { out.width = w; out.height = h; }
  const oc = out.getContext('2d');
  oc.globalCompositeOperation = 'source-over';
  oc.fillStyle = '#000';
  oc.fillRect(0, 0, w, h);
  PLAYER_FOG_NEAR_BLUR.forEach((px, i) => {
    const cvs = pixiPFogNear[i];
    if (cvs.width !== w || cvs.height !== h) { cvs.width = w; cvs.height = h; }
    const c = cvs.getContext('2d');
    c.globalCompositeOperation = 'source-over';
    c.filter = 'none';
    c.fillStyle = '#fff';
    c.fillRect(0, 0, w, h);
    c.filter = 'blur(' + px + 'px)';
    c.drawImage(tmp, -pad, -pad);
    c.filter = 'none';
    // Keep only this blur's channel, then add it into the packed canvas.
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = i === 0 ? '#f00' : i === 1 ? '#0f0' : '#00f';
    c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'source-over';
    oc.globalCompositeOperation = 'lighter';
    oc.drawImage(cvs, 0, 0);
  });
  oc.globalCompositeOperation = 'source-over';
  return resized;
}

function pixiBuildPlayerFogNear(blurCvs) {
  if (!pixiPFogNearCvs) pixiPFogNearCvs = document.createElement('canvas');
  const out = pixiPFogNearCvs;
  const resized = pixiPackPlayerFogNear(blurCvs, out);
  if (resized && pixiPFogNearBT) { pixiPFogNearBT.destroy(); pixiPFogNearBT = null; }
  if (!pixiPFogNearBT) {
    pixiPFogNearBT = PIXI.BaseTexture.from(out, { scaleMode: PIXI.SCALE_MODES.LINEAR });
    if (pixiPFogUniforms) {
      pixiPFogUniforms.uniforms.uNear = new PIXI.Texture(pixiPFogNearBT);
      if (!pixiPFogNearPrevBT) pixiPFogUniforms.uniforms.uNearPrev = new PIXI.Texture(pixiPFogNearBT);
    }
  } else pixiPFogNearBT.update();
}

// The outgoing near copies, packed from the outgoing mask so they follow it through every bake.
function pixiSetPlayerFogNearPrev(prevCvs) {
  if (!pixiPFogUniforms || !prevCvs) return;
  if (!pixiPFogNearPrevCvs) pixiPFogNearPrevCvs = document.createElement('canvas');
  const resized = pixiPackPlayerFogNear(prevCvs, pixiPFogNearPrevCvs);
  if (resized && pixiPFogNearPrevBT) { pixiPFogNearPrevBT.destroy(); pixiPFogNearPrevBT = null; }
  if (!pixiPFogNearPrevBT) {
    pixiPFogNearPrevBT = PIXI.BaseTexture.from(pixiPFogNearPrevCvs, { scaleMode: PIXI.SCALE_MODES.LINEAR });
    pixiPFogUniforms.uniforms.uNearPrev = new PIXI.Texture(pixiPFogNearPrevBT);
  } else pixiPFogNearPrevBT.update();
}

// The outgoing near copies when no change is running: the packed near canvas still holds the outgoing
// state (call it before the new mask is built), so a copy replaces three blurs.
function pixiCopyPlayerFogNearPrev() {
  if (!pixiPFogUniforms || !pixiPFogNearCvs) return;
  if (!pixiPFogNearPrevCvs) pixiPFogNearPrevCvs = document.createElement('canvas');
  const src = pixiPFogNearCvs, dst = pixiPFogNearPrevCvs;
  const resized = dst.width !== src.width || dst.height !== src.height;
  if (resized) { dst.width = src.width; dst.height = src.height; }
  dst.getContext('2d').drawImage(src, 0, 0);
  if (resized && pixiPFogNearPrevBT) { pixiPFogNearPrevBT.destroy(); pixiPFogNearPrevBT = null; }
  if (!pixiPFogNearPrevBT) {
    pixiPFogNearPrevBT = PIXI.BaseTexture.from(dst, { scaleMode: PIXI.SCALE_MODES.LINEAR });
    pixiPFogUniforms.uniforms.uNearPrev = new PIXI.Texture(pixiPFogNearPrevBT);
  } else pixiPFogNearPrevBT.update();
}

function pixiDropPlayerFogNearPrev() {
  if (!pixiPFogNearPrevBT) return;
  pixiPFogNearPrevBT.destroy();
  pixiPFogNearPrevBT = null;
  if (pixiPFogUniforms && pixiPFogNearBT) pixiPFogUniforms.uniforms.uNearPrev = new PIXI.Texture(pixiPFogNearBT);
}

// Whether a WebGL1 fragment shader may use fwidth: the extension fetched, probed by compiling a tiny
// shader, so a driver that refuses gets lines of a fixed width instead of a Player that never compiles.
function pixiProbePlayerFogDerivatives() {
  if (pixiPFogDeriv !== null) return pixiPFogDeriv;
  pixiPFogDeriv = false;
  try {
    const gl = pixiApp.renderer.gl;
    gl.getExtension('OES_standard_derivatives');
    const sh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(sh, '#extension GL_OES_standard_derivatives : enable\nprecision mediump float;\n'
      + '#ifndef GL_OES_standard_derivatives\n#error none\n#endif\nvoid main() { gl_FragColor = vec4(fwidth(gl_FragCoord.x)); }');
    gl.compileShader(sh);
    pixiPFogDeriv = !!gl.getShaderParameter(sh, gl.COMPILE_STATUS);
    gl.deleteShader(sh);
  } catch (e) { pixiPFogDeriv = false; }
  return pixiPFogDeriv;
}

// ⚠ WebGL2 compiles the sources as ESSL 3.00, which has fwidth built in. On WebGL1 the #extension line
// goes on AFTER Pixi has prefixed its own precision and #define lines, or it is no longer first in
// the source and the driver rejects it.
function pixiPlayerFogProgram(rec, index) {
  if (pixiApp.renderer.context.webGLVersion === 2) {
    return PIXI.Program.from(PLAYER_FOG_ES3_VERT + PLAYER_FOG_VERT, PLAYER_FOG_ES3_FRAG + playerFogFrag(rec, index, true));
  }
  const deriv = pixiProbePlayerFogDerivatives();
  const prog = PIXI.Program.from(PLAYER_FOG_VERT, playerFogFrag(rec, index, deriv));
  if (deriv) prog.fragmentSrc = '#extension GL_OES_standard_derivatives : enable\n' + prog.fragmentSrc;
  return prog;
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

  // uMaskPrev is bound to the mask itself until a change supplies its own (playerFogTrans.js): a
  // sampler with no texture reads as black and would reveal the whole map.

  pixiPFogGeom = new PIXI.Geometry()
    .addAttribute('aPos', new PIXI.Buffer(new Float32Array(8), false, false), 2)
    .addIndex([0, 1, 2, 0, 2, 3]);

  pixiPFogUniforms = new PIXI.UniformGroup({
    uCloud:    new PIXI.Texture(pixiPFogCloudBT),
    uMask:     new PIXI.Texture(pixiPFogMaskBT),
    uMaskPrev: new PIXI.Texture(pixiPFogMaskBT),
    uNear:     PIXI.Texture.WHITE,
    uNearPrev: PIXI.Texture.WHITE,
    uOrder:    PIXI.Texture.WHITE,
    uRank:     PIXI.Texture.WHITE,
    uCloudM:   new Float32Array(12),
    uCloudO:   new Float32Array(6),
    uCloudA:   new Float32Array(3),
    uMaskM:    new Float32Array([1, 1]),
    uMaskO:    new Float32Array([0, 0]),
    uMaskLim:  new Float32Array([1, 1]),
    uCover:    0,
    uCoverDir: 0,
    uHasPrev:  0,
    uRes:      new Float32Array([1, 1]),
    uPatM:     new Float32Array([1, 1]),
    uPatO:     new Float32Array([0, 0]),
    uDur:      new Float32Array([1, 1]),
    uNow:      0,
    uTile:     1,
    uTime:     0,
  });
  pixiBuildPlayerFogNear(blurCvs);
  pixiPFogColors = pixiNewFogColors();
  pixiPFogOutColors = pixiNewFogColors();

  pixiPFogShaders = {}; pixiPFogShadersOut = {};
  pixiPFogDrawn = false;
  FOG_THEMES.forEach((rec, i) => {
    // Nested group: the per-frame uniforms stay shared, each shader owns its uFade.
    const prog = pixiPlayerFogProgram(rec, i);
    pixiPFogShaders[rec.id]    = new PIXI.Shader(prog, { uFade: 1, uSwap: -1, uShared: pixiPFogUniforms, uColors: pixiPFogColors });
    pixiPFogShadersOut[rec.id] = new PIXI.Shader(prog, { uFade: 1, uSwap: -1, uShared: pixiPFogUniforms, uColors: pixiPFogOutColors });
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
  pixiPlayerFogChangeLand(blurCvs);   // playerFogTrans.js: a change begun before this mask landed
}

// The cross-faded cloud frame was repainted; drift alone needs no upload.
function pixiUploadPlayerFogCloud() {
  if (pixiPFogCloudBT) pixiPFogCloudBT.update();
}

// The outgoing mask and near copies of a fog change are done with: the shader reads the live ones.
function pixiClearPlayerFogPrev() {
  if (!pixiPFogShader) return;
  pixiDropPlayerFogNearPrev();
  pixiPFogUniforms.uniforms.uMaskPrev = new PIXI.Texture(pixiPFogMaskBT);
}

// Every per-frame number the shader reads. `u` is built in fog.js, which owns the cloud transform.
function pixiUpdatePlayerFog(u) {
  if (!pixiPFogShader) return;
  const id = fogThemeNormalize(u.theme);
  if (id !== pixiPFogThemeId) {
    // The outgoing look keeps drawing and gives way to the new one: it fades out over it, or, under a
    // map switch's cover, the new one washes over it. A second change restarts it.
    if (pixiPFogDrawn) pixiStartPlayerFogThemeFade(pixiPFogThemeId, u.cover > .001);
    pixiPFogThemeId = id;
    pixiPFogShader = pixiPFogShaders[id];
    pixiPFogMesh.shader = pixiPFogShader;
  }
  pixiStepPlayerFogThemeFade();
  const q = pixiPFogUniforms.uniforms;
  q.uCloudM.set(u.cloudM);
  q.uCloudO.set(u.cloudO);
  q.uCloudA.set(u.cloudA);
  q.uMaskM.set(u.maskM);
  q.uMaskO.set(u.maskO);
  q.uMaskLim.set(u.maskLim);
  q.uRes.set(u.res);
  q.uPatM.set(u.patM);
  q.uPatO.set(u.patO);
  q.uDur.set(u.dur);
  q.uNow     = performance.now() % 65536;
  q.uCover   = u.cover;
  q.uCoverDir = u.coverDir;
  q.uHasPrev = u.hasPrev;
  q.uTile    = u.tile;
  q.uTime    = u.time;
  const c = pixiPFogColors.uniforms;
  c.uCloudC.set(u.cloudC); c.uBase.set(u.base); c.uTint.set(u.tint); c.uRim.set(u.rim); c.uTintA = u.tintA;
  // A crossfade's outgoing look takes the new colours with it; a swap's keeps the ones it froze.
  if (pixiPFogOutMesh && !pixiPFogSwapAt) pixiCopyFogColors(c, pixiPFogOutColors.uniforms);
  pixiPFogDrawn = true;
}

function pixiStartPlayerFogThemeFade(fromId, swap) {
  pixiPFogOutId = fromId;
  pixiPFogFadeAt = performance.now();
  pixiPFogSwapAt = swap ? pixiPFogFadeAt : 0;
  pixiResetPlayerFogSwap();
  if (!pixiPFogOutMesh) pixiPFogOutMesh = new PIXI.Mesh(pixiPFogGeom, pixiPFogShadersOut[fromId]);
  else pixiPFogOutMesh.shader = pixiPFogShadersOut[fromId];
  pixiPFogOutMesh.shader.uniforms.uFade = 1;
  // The live colours are still last frame's here: the outgoing theme keeps its own through the swap.
  if (swap) pixiCopyFogColors(pixiPFogColors.uniforms, pixiPFogOutColors.uniforms);
  // Appended last is drawn on top: the fading-out look over the new one, or under it for a swap.
  pixiScreenLayer.addChild(pixiPFogOutMesh);
  if (swap) pixiScreenLayer.addChild(pixiPFogMesh);
}

function pixiResetPlayerFogSwap() {
  if (pixiPFogShaders) for (const id of Object.keys(pixiPFogShaders)) pixiPFogShaders[id].uniforms.uSwap = -1;
}

// A swap is running, or the theme was changed and the shader has not seen it yet.
function pixiPlayerFogSwapping() {
  return pixiPFogSwapAt > 0 || (!!pixiPFogShader && pixiPFogThemeId !== fogThemeNormalize(fogTheme));
}

function pixiStopPlayerFogThemeFade() {
  pixiPFogSwapAt = 0;
  pixiResetPlayerFogSwap();
  if (!pixiPFogOutMesh) return;
  if (pixiScreenLayer) pixiScreenLayer.removeChild(pixiPFogOutMesh);
  pixiPFogOutMesh.destroy();
  pixiPFogOutMesh = null; pixiPFogOutId = null;
}

// The Player's drift renders every frame, so the fade needs no render of its own.
function pixiStepPlayerFogThemeFade() {
  if (!pixiPFogOutMesh) return;
  if (pixiPFogSwapAt) {
    const sk = (performance.now() - pixiPFogSwapAt) / PLAYER_FOG_THEME_SWAP_MS;
    if (sk >= 1) { pixiStopPlayerFogThemeFade(); return; }
    pixiPFogShader.uniforms.uSwap = sk * sk * (3 - 2 * sk);
    return;
  }
  const k = (performance.now() - pixiPFogFadeAt) / PLAYER_FOG_THEME_FADE_MS;
  if (k >= 1) { pixiStopPlayerFogThemeFade(); return; }
  pixiPFogOutMesh.shader.uniforms.uFade = 1 - k * k * (3 - 2 * k);
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
  pixiPlayerFogTransDestroy();   // before the textures it feeds go
  pixiStopPlayerFogThemeFade();
  pixiPFogDrawn = false;
  if (pixiPFogMesh) {
    if (pixiScreenLayer) pixiScreenLayer.removeChild(pixiPFogMesh);
    pixiPFogMesh.destroy();
    pixiPFogMesh = null;
  }
  if (pixiPFogMaskBT)  pixiPFogMaskBT.destroy();
  if (pixiPFogCloudBT) pixiPFogCloudBT.destroy();
  if (pixiPFogNearBT) { pixiPFogNearBT.destroy(); pixiPFogNearBT = null; }
  if (pixiPFogNearPrevBT) { pixiPFogNearPrevBT.destroy(); pixiPFogNearPrevBT = null; }
  pixiPFogGeom = null; pixiPFogShader = null; pixiPFogShaders = null; pixiPFogShadersOut = null;
  pixiPFogCloudBT = null; pixiPFogCloudSrc = null;
  pixiPFogMaskBT = null;
  pixiPFogMaskCvs = null; pixiPFogMaskSrc = null;
}
