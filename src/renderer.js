'use strict';

// ─── PixiJS Renderer ─────────────────────────────────────────────────────────
// Depends on window.PIXI (lib/pixi.min.js).

let pixiApp        = null;
let pixiMapSprite  = null;
let pixiMapTexture = null;

let pixiMapLayer     = null;
let pixiEffectsLayer = null;
let pixiFogLayer     = null;
let pixiGridLayer    = null;
let pixiToolLayer    = null;

// ⚠ PAN AND ZOOM LIVE ON pixiWorld, NOT ON THE STAGE. The Player's fog is drawn in SCREEN space
// and must escape that transform, which a child of a transformed stage cannot do.
let pixiWorld       = null;
let pixiScreenLayer = null;

function initPixiRenderer(containerEl) {
  if (pixiApp) destroyPixiRenderer();

  const cw = containerEl.clientWidth;
  const ch = containerEl.clientHeight;

  pixiApp = new PIXI.Application({
    width: cw,
    height: ch,
    backgroundAlpha: 0,
    antialias: false,
    preferWebGLVersion: 2,
    view: document.createElement('canvas'),
  });

  // The ticker auto-starts and presents the stage; nothing calls pixiApp.render(). It carries the
  // frame cap and is the ONLY clock — the dirty-flag loop rides it too. ⚠ Never cap the two loops
  // independently: same interval, different phase, and the Canvas-2D layers slip during a pan.
  pixiApp.ticker.maxFPS = APP_MAX_FPS;

  // Drive render.js's dirty-flag loop from this ticker ABOVE PixiJS's own render, so doRender
  // paints the Canvas-2D layers and sets the stage viewport in the tick that presents them.
  // Re-added on every renderer creation, since destroyPixiRenderer() takes the callbacks with it.
  if (typeof pumpDirtyRender === 'function') {
    pixiApp.ticker.add(pumpDirtyRender, null, PIXI.UPDATE_PRIORITY.HIGH);
  }

  const canvas = pixiApp.view;
  canvas.id = 'pixi-canvas';
  canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;';

  // Insert before fog-canvas (same z-position as map-canvas)
  const fogCanvasEl = containerEl.querySelector('#fog-canvas');
  if (fogCanvasEl) {
    containerEl.insertBefore(canvas, fogCanvasEl);
  } else {
    containerEl.appendChild(canvas);
  }

  // ⚠ The effects layer sits ABOVE the map and BELOW the fog. That ordering is the whole reason an
  // effect in an unexplored room is hidden on both screens with no stripping guard.
  pixiMapLayer     = new PIXI.Container();
  pixiEffectsLayer = new PIXI.Container();
  pixiFogLayer     = new PIXI.Container();
  pixiGridLayer    = new PIXI.Container();
  pixiToolLayer    = new PIXI.Container();

  pixiWorld = new PIXI.Container();
  pixiApp.stage.addChild(pixiWorld);
  pixiWorld.addChild(pixiMapLayer);
  pixiWorld.addChild(pixiEffectsLayer);
  pixiWorld.addChild(pixiFogLayer);
  pixiWorld.addChild(pixiGridLayer);
  pixiWorld.addChild(pixiToolLayer);

  // Above the world and outside its transform: the Player's fog covers the whole window.
  pixiScreenLayer = new PIXI.Container();
  pixiApp.stage.addChild(pixiScreenLayer);
}

function pixiSetMap(imageBitmap, width, height) {
  if (!pixiApp) return;

  if (pixiMapTexture) {
    pixiMapTexture.destroy(true);
    pixiMapTexture = null;
  }
  if (pixiMapSprite) {
    pixiMapLayer.removeChild(pixiMapSprite);
    pixiMapSprite.destroy();
    pixiMapSprite = null;
  }

  // Clamp oversized images to GPU MAX_TEXTURE_SIZE
  const max = pixiGetMaxTexSize();
  let texSource = imageBitmap;
  if (width > max || height > max) {
    const scale = Math.min(max / width, max / height);
    const cvs = document.createElement('canvas');
    cvs.width  = Math.floor(width  * scale);
    cvs.height = Math.floor(height * scale);
    const ctx = cvs.getContext('2d');
    ctx.drawImage(imageBitmap, 0, 0, cvs.width, cvs.height);
    texSource = cvs;
  }

  const baseTexture = PIXI.BaseTexture.from(texSource, {
    scaleMode: PIXI.SCALE_MODES.LINEAR,
  });
  pixiMapTexture = new PIXI.Texture(baseTexture);
  pixiMapSprite = new PIXI.Sprite(pixiMapTexture);
  pixiMapSprite.width  = width;
  pixiMapSprite.height = height;

  pixiMapLayer.addChild(pixiMapSprite);
}

// Drop the map sprite and its GPU texture without uploading a replacement.
//
// For the DM's ANIMATED maps, where the map is a CSS-composited <video> and the sprite would be
// created and hidden forever. pixiHideMap only sets visible=false, leaving the texture resident.
//
// ⚠ CLEARING IS NOT THE SAME AS SKIPPING pixiSetMap: switching from an image map to a video map
// must destroy the outgoing sprite, or the previous map stays under the video.
function pixiClearMap() {
  if (!pixiApp) return;
  if (pixiMapTexture) { pixiMapTexture.destroy(true); pixiMapTexture = null; }
  if (pixiMapSprite) {
    pixiMapLayer.removeChild(pixiMapSprite);
    pixiMapSprite.destroy();
    pixiMapSprite = null;
  }
}

// Place the map sprite on a MAP-SPACE rectangle instead of the whole map.
//
// The Player's animated-map texture is viewport-sized and carries only the region the camera is
// over, so the sprite travels with the camera rather than sitting at 0,0. Pan and zoom come from
// pixiWorld's transform, which the full-screen fog pass deliberately sits outside.
//
// ⚠ This file stays the only one that touches sprite internals.
function pixiSetMapRegion(x, y, w, h) {
  if (!pixiMapSprite) return;
  pixiMapSprite.position.set(x, y);
  pixiMapSprite.width  = w;
  pixiMapSprite.height = h;
}

function pixiSetViewport(z, px, py) {
  if (!pixiWorld) return;
  pixiWorld.position.set(px, py);
  pixiWorld.scale.set(z, z);
}

function pixiResize(width, height) {
  if (!pixiApp) return;
  pixiApp.renderer.resize(width, height);
  pixiSizePlayerFogQuad(width, height);
}

function pixiHideMap() {
  if (pixiMapSprite) pixiMapSprite.visible = false;
}

function pixiShowMap() {
  if (pixiMapSprite) pixiMapSprite.visible = true;
}

// Re-upload the map texture to the GPU, once the Player's video loop has drawn the frame into its
// source canvas. Player-only: the DM uses a DOM <video> element.
function pixiUpdateMapTexture() {
  if (pixiMapTexture && pixiMapTexture.baseTexture) pixiMapTexture.baseTexture.update();
}

// Player video playback: the map is a PixiJS sprite, so its texture is refreshed from the video
// every rendered frame. ⚠ Hooked to the PixiJS ticker, never the dirty-flag loop, which fires on
// demand and would leave the video frozen between viewport changes.
let _pixiVideoSyncFn = null;
function _pixiVideoTick() { if (_pixiVideoSyncFn) _pixiVideoSyncFn(); }
function pixiStartVideoTextureSync(fn) {
  pixiStopVideoTextureSync();
  if (!pixiApp || !fn) return;
  _pixiVideoSyncFn = fn;
  pixiApp.ticker.add(_pixiVideoTick);
}
function pixiStopVideoTextureSync() {
  if (pixiApp && _pixiVideoSyncFn) pixiApp.ticker.remove(_pixiVideoTick);
  _pixiVideoSyncFn = null;
}

// ─── Texture Size Clamping ──────────────────────────────────────────────────
// WebGL's MAX_TEXTURE_SIZE is a hard limit, so an oversized map or fog canvas needs a proxy.

let pixiMaxTexSize = 0;

function pixiGetMaxTexSize() {
  if (pixiMaxTexSize) return pixiMaxTexSize;
  if (!pixiApp) return 4096;
  const gl = pixiApp.renderer.gl;
  pixiMaxTexSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  return pixiMaxTexSize;
}

function pixiClampCanvas(src) {
  const max = pixiGetMaxTexSize();
  if (src.width <= max && src.height <= max) return null;
  const scale = Math.min(max / src.width, max / src.height);
  const proxy = document.createElement('canvas');
  proxy.width  = Math.floor(src.width  * scale);
  proxy.height = Math.floor(src.height * scale);
  const ctx = proxy.getContext('2d');
  ctx.drawImage(src, 0, 0, proxy.width, proxy.height);
  return proxy;
}

function pixiRefreshProxy(proxy, src) {
  const ctx = proxy.getContext('2d');
  ctx.clearRect(0, 0, proxy.width, proxy.height);
  ctx.drawImage(src, 0, 0, proxy.width, proxy.height);
}

// ─── Player fog: one full-screen GPU pass ────────────────────────────────────
// ⚠ FULL-SCREEN, NEVER MAP-SIZED. The DM's fog above is map-sized sprites; the Player needs fog
// past the map edge too, and two layers meeting at that edge is the seam. One pass covers the
// window and masks only inside the map rect, so there is no edge for a seam to sit on.

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
function pixiUploadPlayerGrid() {
  if (!pixiPGridBT) return;
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

// ─── PixiJS Fog Layer (DM only) ──────────────────────────────────────────────
// ⚠ MAP-SIZED, AND DM-ONLY. The Player's fog is the full-screen pass above; these sprites end at
// the map edge, which is exactly what the Player cannot use.
//
// Inside pixiFogLayer: [0] the prior fog snapshot that fades out during a transition, [1] the
// blurred fog canvas, [2] the cloud container masked to fog-opaque pixels.

let pixiFogBlurBT     = null; // BaseTexture from fogBlurCanvas
let pixiFogBlurTex    = null;
let pixiFogBlurSpr    = null;
let pixiFogBlurProxy  = null; // downscaled proxy when fogBlurCanvas exceeds MAX_TEXTURE_SIZE
let pixiFogBlurSrcCvs = null; // source canvas ref

let pixiFogCloudBT       = null; // BaseTexture from cloudBlendCanvas (512×512)
let pixiFogCloudTex      = null;
let pixiFogCloudSprs     = [];   // 3 TilingSprites, one per CLOUD_PASSES entry
let pixiFogCloudContainer = null;
let pixiFogCloudMaskSpr  = null; // standalone mask sprite (not in display list); shares pixiFogBlurTex
let pixiFogTintOverlay   = null; // PIXI.Graphics tint rect; re-filled by pixiUpdateFogTintColor()
let pixiFogBaseColorRect = null; // PIXI.Graphics base-color rect (first child in cloud container)

let pixiFogDataBT     = null;
let pixiFogDataTex    = null;
let pixiFogBrushSpr   = null;
let pixiFogDataProxy  = null;
let pixiFogDataSrcCvs = null;

let pixiFogTransBT    = null;
let pixiFogTransTex   = null;
let pixiFogTransSpr   = null;

// fogBlurCvs    — fogBlurCanvas (fog-scale, updated on mouseup)
// cloudBlendCvs — cloudBlendCanvas (512×512, cross-faded cloud frame, updated per anim tick)
function pixiInitFog(fogDataCvs, fogBlurCvs, cloudBlendCvs, mapW, mapH) {
  if (!pixiApp) return;
  pixiDestroyFog();

  {
    // DM: blur sprite + cloud TilingSprites masked by blur + brush sprite for live strokes.

    // --- Blur sprite: base blurred fog, always visible ---
    pixiFogBlurSrcCvs = fogBlurCvs;
    pixiFogBlurProxy  = pixiClampCanvas(fogBlurCvs);
    const blurSrc     = pixiFogBlurProxy || fogBlurCvs;
    pixiFogBlurBT  = PIXI.BaseTexture.from(blurSrc, { scaleMode: PIXI.SCALE_MODES.LINEAR });
    pixiFogBlurTex = new PIXI.Texture(pixiFogBlurBT);
    pixiFogBlurSpr = new PIXI.Sprite(pixiFogBlurTex);
    pixiFogBlurSpr.width  = mapW;
    pixiFogBlurSpr.height = mapH;
    pixiFogLayer.addChild(pixiFogBlurSpr);

    // Cloud TilingSprites and their mask. The mask re-uses pixiFogBlurTex, so BT.update() keeps it
    // in sync. ⚠ The mask sprite MUST be a child of pixiFogLayer, so getBounds() uses the stage
    // transform. Unparented it returns map-sized bounds and SpriteMaskFilter allocates hundreds of
    // megabytes of intermediate RenderTexture.
    pixiFogCloudMaskSpr = new PIXI.Sprite(pixiFogBlurTex);
    pixiFogCloudMaskSpr.width      = mapW;
    pixiFogCloudMaskSpr.height     = mapH;
    pixiFogCloudMaskSpr.renderable = false; // in the tree for transform, not for drawing
    pixiFogLayer.addChild(pixiFogCloudMaskSpr);

    pixiFogCloudBT  = PIXI.BaseTexture.from(cloudBlendCvs, { scaleMode: PIXI.SCALE_MODES.LINEAR });
    pixiFogCloudTex = new PIXI.Texture(pixiFogCloudBT);

    pixiFogCloudContainer = new PIXI.Container();
    pixiFogCloudContainer.mask = pixiFogCloudMaskSpr;
    pixiFogLayer.addChild(pixiFogCloudContainer);

    // Base colour rect, first child so it renders beneath clouds and tint. The container mask
    // clips it to fog-opaque pixels, so it recolours without touching fogBlurCanvas.
    pixiFogBaseColorRect = new PIXI.Graphics();
    pixiFogBaseColorRect.beginFill(parseInt(fogBaseColor.slice(1), 16), 1.0);
    pixiFogBaseColorRect.drawRect(0, 0, mapW, mapH);
    pixiFogBaseColorRect.endFill();
    pixiFogCloudContainer.addChild(pixiFogBaseColorRect);

    // CLOUD_PASSES is fog.js's, which loads AFTER this file - so read it at call time, never at
    // evaluation time.
    pixiFogCloudSprs = CLOUD_PASSES.map(p => {
      const ts = new PIXI.TilingSprite(pixiFogCloudTex, mapW, mapH);
      // tileScale: 1 fog-pixel = FOG_SCALE map-pixels, so tile covers p.scale * FOG_SCALE map-px per texture-px
      ts.tileScale.set(p.scale * FOG_SCALE, p.scale * FOG_SCALE);
      // tileRotation rotates just the tile pattern (PixiJS v7 TilingSprite property)
      if (typeof ts.tileRotation === 'number') ts.tileRotation = p.angle;
      ts.alpha = p.alpha;
      pixiFogCloudContainer.addChild(ts);
      return ts;
    });

    // Luminosity tint overlay, the source-atop tint from the Canvas-2D path. Inside the masked
    // container it is restricted to fog-opaque pixels, and pixiUpdateFogTintColor() re-fills it.
    pixiFogTintOverlay = new PIXI.Graphics();
    pixiFogTintOverlay.beginFill(parseInt(fogTintColor.slice(1), 16), FOG_TINT_ALPHA);
    pixiFogTintOverlay.drawRect(0, 0, mapW, mapH);
    pixiFogTintOverlay.endFill();
    pixiFogCloudContainer.addChild(pixiFogTintOverlay);

    // --- Brush sprite: raw fog data, shown during active brushing only ---
    pixiFogDataSrcCvs = fogDataCvs;
    pixiFogDataProxy  = pixiClampCanvas(fogDataCvs);
    const dataSrc     = pixiFogDataProxy || fogDataCvs;
    pixiFogDataBT  = PIXI.BaseTexture.from(dataSrc, { scaleMode: PIXI.SCALE_MODES.LINEAR });
    pixiFogDataTex = new PIXI.Texture(pixiFogDataBT);
    pixiFogBrushSpr = new PIXI.Sprite(pixiFogDataTex);
    pixiFogBrushSpr.width  = mapW;
    pixiFogBrushSpr.height = mapH;
    pixiFogBrushSpr.visible = false;
    pixiFogLayer.addChild(pixiFogBrushSpr);
  }

  pixiFogLayer.alpha = FOG_OPACITY_DM;
}

// Called on mouseup / polygon rebuild — uploads new fogBlurCanvas to GPU.
// Both pixiFogBlurSpr and pixiFogCloudMaskSpr share pixiFogBlurBT, so one update covers both.
function pixiUpdateFogBlurTexture() {
  if (!pixiFogBlurBT) return;
  if (pixiFogBlurProxy && pixiFogBlurSrcCvs) pixiRefreshProxy(pixiFogBlurProxy, pixiFogBlurSrcCvs);
  pixiFogBlurBT.update();
}

// Re-fills the PixiJS base color rect with a new hex color. Called on DM color picker change.
function pixiUpdateFogBaseColor(hexStr) {
  if (!pixiFogBaseColorRect) return;
  const { width: w, height: h } = pixiFogBaseColorRect;
  pixiFogBaseColorRect.clear();
  pixiFogBaseColorRect.beginFill(parseInt(hexStr.slice(1), 16), 1.0);
  pixiFogBaseColorRect.drawRect(0, 0, w, h);
  pixiFogBaseColorRect.endFill();
}

// Re-fills the PixiJS tint overlay with a new hex color. Called on DM color picker change.
// The overlay lives inside pixiFogCloudContainer (masked to fog-opaque pixels automatically).
function pixiUpdateFogTintColor(hexStr) {
  if (!pixiFogTintOverlay) return;
  const { width: w, height: h } = pixiFogTintOverlay;
  pixiFogTintOverlay.clear();
  pixiFogTintOverlay.beginFill(parseInt(hexStr.slice(1), 16), FOG_TINT_ALPHA);
  pixiFogTintOverlay.drawRect(0, 0, w, h);
  pixiFogTintOverlay.endFill();
}

// Called every fog animation tick: TilingSprite drift, plus the cloud frame upload.
// offsets and alphas are per pass, and a null entry keeps the current value.
// cloudChanged is true only when the caller repainted cloudBlendCanvas. The upload is the
// expensive part, so it is skipped otherwise.
function pixiUpdateFogAnim(offsets, alphas, cloudChanged) {
  if (!pixiFogCloudSprs.length) return;
  for (let i = 0; i < pixiFogCloudSprs.length; i++) {
    const spr = pixiFogCloudSprs[i];
    if (offsets && offsets[i]) {
      spr.tilePosition.x = offsets[i].x;
      spr.tilePosition.y = offsets[i].y;
    }
    if (alphas && alphas[i] != null) spr.alpha = alphas[i];
  }
  if (cloudChanged && pixiFogCloudBT) pixiFogCloudBT.update();
}

function pixiUpdateFogDataTexture() {
  if (!pixiFogDataBT) return;
  if (pixiFogDataProxy && pixiFogDataSrcCvs) pixiRefreshProxy(pixiFogDataProxy, pixiFogDataSrcCvs);
  pixiFogDataBT.update();
}

function pixiSetFogBrushing(active) {
  if (pixiFogBlurSpr)        pixiFogBlurSpr.visible        = !active;
  if (pixiFogCloudContainer) pixiFogCloudContainer.visible = !active;
  if (pixiFogBrushSpr)       pixiFogBrushSpr.visible       = active;
  if (active) pixiUpdateFogDataTexture();
}

function pixiSetFogTransition(prevCanvas, t) {
  if (!pixiApp) return;

  if (prevCanvas && !pixiFogTransSpr) {
    const proxied = pixiClampCanvas(prevCanvas);
    const src = proxied || prevCanvas;
    pixiFogTransBT  = PIXI.BaseTexture.from(src, { scaleMode: PIXI.SCALE_MODES.LINEAR });
    pixiFogTransTex = new PIXI.Texture(pixiFogTransBT);
    pixiFogTransSpr = new PIXI.Sprite(pixiFogTransTex);
    pixiFogTransSpr.width  = pixiFogBlurSpr ? pixiFogBlurSpr.width  : 0;
    pixiFogTransSpr.height = pixiFogBlurSpr ? pixiFogBlurSpr.height : 0;
    pixiFogLayer.addChildAt(pixiFogTransSpr, 0);
  }

  if (!pixiFogTransSpr) return;

  pixiFogTransSpr.alpha = 1 - t;
  if (pixiFogBlurSpr)        pixiFogBlurSpr.alpha        = t;
  if (pixiFogCloudContainer) pixiFogCloudContainer.alpha = t;
}

function pixiEndFogTransition() {
  if (pixiFogTransSpr) {
    pixiFogLayer.removeChild(pixiFogTransSpr);
    pixiFogTransSpr.destroy();
    pixiFogTransSpr = null;
  }
  if (pixiFogTransTex) { pixiFogTransTex.destroy(true); pixiFogTransTex = null; }
  pixiFogTransBT = null;
  if (pixiFogBlurSpr)        pixiFogBlurSpr.alpha        = 1;
  if (pixiFogCloudContainer) pixiFogCloudContainer.alpha = 1;
}

function pixiDestroyFog() {
  // Release mask before destroying container to avoid PixiJS filter teardown warnings
  if (pixiFogCloudContainer) pixiFogCloudContainer.mask = null;

  if (pixiFogCloudContainer) {
    pixiFogLayer.removeChild(pixiFogCloudContainer);
    pixiFogCloudContainer.destroy({ children: true });
    pixiFogCloudContainer = null;
  }
  pixiFogCloudSprs = [];

  // Mask sprite shares pixiFogBlurTex — destroy sprite only, not texture
  if (pixiFogCloudMaskSpr) { pixiFogLayer.removeChild(pixiFogCloudMaskSpr); pixiFogCloudMaskSpr.destroy(); pixiFogCloudMaskSpr = null; }

  if (pixiFogCloudTex) { pixiFogCloudTex.destroy(true); pixiFogCloudTex = null; }
  pixiFogCloudBT = null;

  if (pixiFogBlurSpr)  { pixiFogLayer.removeChild(pixiFogBlurSpr);  pixiFogBlurSpr.destroy();  pixiFogBlurSpr = null; }
  if (pixiFogBlurTex)  { pixiFogBlurTex.destroy(true);  pixiFogBlurTex = null; }
  pixiFogBlurBT     = null;
  pixiFogBlurProxy  = null;
  pixiFogBlurSrcCvs = null;

  if (pixiFogBrushSpr) { pixiFogLayer.removeChild(pixiFogBrushSpr); pixiFogBrushSpr.destroy(); pixiFogBrushSpr = null; }
  if (pixiFogDataTex)  { pixiFogDataTex.destroy(true);  pixiFogDataTex = null; }
  pixiFogDataBT     = null;
  pixiFogDataProxy  = null;
  pixiFogDataSrcCvs = null;

  pixiEndFogTransition();
}

// Flush any oversized RTs the pool accumulated during startup (e.g. before zoom was applied).
// Safe to call any time; has no effect when no app is running.
function pixiFlushTexturePool() {
  if (pixiApp && pixiApp.renderer && pixiApp.renderer.texturePool) {
    pixiApp.renderer.texturePool.clear(0);
  }
}

function destroyPixiRenderer() {
  pixiDestroyFog();
  pixiDestroyPlayerFog();
  pixiDestroyPlayerGrid();
  if (pixiMapTexture) {
    pixiMapTexture.destroy(true);
    pixiMapTexture = null;
  }
  pixiMapSprite    = null;
  pixiMapLayer     = null;
  pixiEffectsLayer = null;
  pixiFogLayer     = null;
  pixiGridLayer    = null;
  pixiToolLayer    = null;
  pixiWorld        = null;
  pixiScreenLayer  = null;
  if (pixiApp) {
    pixiApp.destroy(true, { children: true, texture: true, baseTexture: true });
    pixiApp = null;
  }
}
