'use strict';

// ─── PixiJS Renderer ─────────────────────────────────────────────────────────
// Depends on window.PIXI (lib/pixi.min.js).

let pixiApp        = null;
let pixiMapSprite  = null;
let pixiMapTexture = null;

// Layer containers
let pixiMapLayer     = null;
let pixiEffectsLayer = null;
let pixiFogLayer     = null;
let pixiGridLayer    = null;
let pixiToolLayer    = null;

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

  pixiApp.stage.addChild(pixiMapLayer);
  pixiApp.stage.addChild(pixiEffectsLayer);
  pixiApp.stage.addChild(pixiFogLayer);
  pixiApp.stage.addChild(pixiGridLayer);
  pixiApp.stage.addChild(pixiToolLayer);
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
// over, so the sprite travels with the camera rather than sitting at 0,0. Pan and zoom still come
// from the stage transform, which is what keeps the Canvas-2D fog above it lined up.
//
// ⚠ This file stays the only one that touches sprite internals.
function pixiSetMapRegion(x, y, w, h) {
  if (!pixiMapSprite) return;
  pixiMapSprite.position.set(x, y);
  pixiMapSprite.width  = w;
  pixiMapSprite.height = h;
}

function pixiSetViewport(z, px, py) {
  if (!pixiApp) return;
  pixiApp.stage.position.set(px, py);
  pixiApp.stage.scale.set(z, z);
}

function pixiResize(width, height) {
  if (!pixiApp) return;
  pixiApp.renderer.resize(width, height);
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

// ─── PixiJS Fog Layer (DM only) ──────────────────────────────────────────────
// ⚠ The Player does NOT render fog in PixiJS: it uses the Canvas-2D renderFog() fog-on-top path on
// #fog-canvas, and its PixiJS draws only the unmasked map sprite. Everything below is DM-only.
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

    // CLOUD_PASSES is a global from fog.js (loaded before renderer.js)
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
  if (pixiApp) {
    pixiApp.destroy(true, { children: true, texture: true, baseTexture: true });
    pixiApp = null;
  }
}
