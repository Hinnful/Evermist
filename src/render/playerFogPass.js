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
const PLAYER_FOG_FRAG = `
precision highp float;
varying vec2 vScreen;
uniform sampler2D uCloud;
uniform sampler2D uMask;
uniform sampler2D uMaskPrev;
uniform vec4  uCloudM[3];
uniform vec2  uCloudO[3];
uniform float uCloudA[3];
uniform vec2  uMaskM;
uniform vec2  uMaskO;
uniform vec2  uMaskLim;
uniform vec3  uBase;
uniform vec3  uTint;
uniform float uTintA;
uniform float uCover;
uniform float uTransT;
uniform float uHasPrev;

void main() {
  vec3 col = uBase;
  for (int i = 0; i < 3; i++) {
    vec2 uv = vec2(uCloudM[i].x * vScreen.x + uCloudM[i].y * vScreen.y,
                   uCloudM[i].z * vScreen.x + uCloudM[i].w * vScreen.y) - uCloudO[i];
    // c.rgb arrives PREMULTIPLIED - a plain mix() double-multiplies and washes the clouds out.
    vec4 c = texture2D(uCloud, uv);
    col = c.rgb * uCloudA[i] + col * (1.0 - c.a * uCloudA[i]);
  }
  col = mix(col, uTint, uTintA);

  // Outside the map the fog stays solid; inside, the mask alpha is the reveal.
  float a = 1.0;
  vec2 muv = vScreen * uMaskM - uMaskO;
  if (muv.x >= 0.0 && muv.y >= 0.0 && muv.x <= uMaskLim.x && muv.y <= uMaskLim.y) {
    float cur = texture2D(uMask, muv).a;
    a = mix(cur, mix(texture2D(uMaskPrev, muv).a, cur, uTransT), uHasPrev);
    a = min(1.0, a + uCover);
  }
  gl_FragColor = vec4(col * a, a);
}
`;

let pixiPFogMesh     = null;
let pixiPFogGeom     = null;
let pixiPFogShader   = null;
let pixiPFogCloudBT  = null;
let pixiPFogCloudSrc = null;
let pixiPFogMaskBT   = null;
let pixiPFogPrevBT   = null;
let pixiPFogMaskCvs  = null;   // fogBlurCanvas, or its clamped proxy
let pixiPFogMaskSrc  = null;
let pixiPFogPrevCvs  = null;
let pixiPFogPrevSrc  = null;

function pixiPlayerFogReady() { return !!pixiPFogMesh; }

function pixiSizePlayerFogQuad(w, h) {
  if (!pixiPFogGeom) return;
  pixiPFogGeom.getBuffer('aPos').update(new Float32Array([0, 0, w, 0, w, h, 0, h]));
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

  pixiPFogShader = PIXI.Shader.from(PLAYER_FOG_VERT, PLAYER_FOG_FRAG, {
    uCloud:    new PIXI.Texture(pixiPFogCloudBT),
    uMask:     new PIXI.Texture(pixiPFogMaskBT),
    uMaskPrev: new PIXI.Texture(pixiPFogPrevBT),
    uCloudM:   new Float32Array(12),
    uCloudO:   new Float32Array(6),
    uCloudA:   new Float32Array(3),
    uMaskM:    new Float32Array([1, 1]),
    uMaskO:    new Float32Array([0, 0]),
    uMaskLim:  new Float32Array([1, 1]),
    uBase:     new Float32Array([0, 0, 0]),
    uTint:     new Float32Array([0, 0, 0]),
    uTintA:    0,
    uCover:    0,
    uTransT:   1,
    uHasPrev:  0,
  });

  pixiPFogMesh = new PIXI.Mesh(pixiPFogGeom, pixiPFogShader);
  // screen, not renderer.width: the quad uses the same CSS pixels as panX/panY/zoom.
  pixiSizePlayerFogQuad(pixiApp.renderer.screen.width, pixiApp.renderer.screen.height);
  pixiScreenLayer.addChild(pixiPFogMesh);   // appended: always above the grid sprite
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
}

// The cross-faded cloud frame was repainted; drift alone needs no upload.
function pixiUploadPlayerFogCloud() {
  if (pixiPFogCloudBT) pixiPFogCloudBT.update();
}

// The outgoing mask of a reveal or shroud crossfade. Null unbinds it and drops uHasPrev to 0.
function pixiSetPlayerFogPrevMask(cvs) {
  if (!pixiPFogShader) return;
  if (!cvs) {
    if (pixiPFogPrevBT && pixiPFogPrevBT !== pixiPFogMaskBT) pixiPFogPrevBT.destroy();
    pixiPFogPrevSrc = null;
    pixiPFogPrevCvs = pixiPFogMaskCvs;
    pixiPFogPrevBT  = pixiPFogMaskBT;
    pixiPFogShader.uniforms.uMaskPrev = new PIXI.Texture(pixiPFogMaskBT);
    return;
  }
  if (pixiPFogPrevSrc !== cvs) {
    if (pixiPFogPrevBT && pixiPFogPrevBT !== pixiPFogMaskBT) pixiPFogPrevBT.destroy();
    pixiPFogPrevSrc = cvs;
    pixiPFogPrevCvs = pixiClampCanvas(cvs) || cvs;
    pixiPFogPrevBT  = PIXI.BaseTexture.from(pixiPFogPrevCvs, { scaleMode: PIXI.SCALE_MODES.LINEAR });
    pixiPFogShader.uniforms.uMaskPrev = new PIXI.Texture(pixiPFogPrevBT);
    return;
  }
  if (pixiPFogPrevCvs !== pixiPFogPrevSrc) pixiRefreshProxy(pixiPFogPrevCvs, pixiPFogPrevSrc);
  pixiPFogPrevBT.update();
}

// Every per-frame number the shader reads. `u` is built in fog.js, which owns the cloud transform.
function pixiUpdatePlayerFog(u) {
  if (!pixiPFogShader) return;
  const q = pixiPFogShader.uniforms;
  q.uCloudM.set(u.cloudM);
  q.uCloudO.set(u.cloudO);
  q.uCloudA.set(u.cloudA);
  q.uMaskM.set(u.maskM);
  q.uMaskO.set(u.maskO);
  q.uMaskLim.set(u.maskLim);
  q.uBase.set(u.base);
  q.uTint.set(u.tint);
  q.uTintA   = u.tintA;
  q.uCover   = u.cover;
  q.uTransT  = u.transT;
  q.uHasPrev = u.hasPrev;
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
