'use strict';

// ─── PixiJS Renderer ─────────────────────────────────────────────────────────
// Depends on: window.PIXI (loaded via lib/pixi.min.js)
// Globals: pixiApp, pixiMapSprite, pixiMapTexture,
//          initPixiRenderer, pixiSetMap, pixiSetViewport, pixiResize, destroyPixiRenderer

let pixiApp        = null;
let pixiMapSprite  = null;
let pixiMapTexture = null;

// Layer containers
let pixiMapLayer   = null;
let pixiFogLayer   = null;
let pixiGridLayer  = null;
let pixiToolLayer  = null;

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

  // Layer hierarchy
  pixiMapLayer  = new PIXI.Container();
  pixiFogLayer  = new PIXI.Container();
  pixiGridLayer = new PIXI.Container();
  pixiToolLayer = new PIXI.Container();

  pixiApp.stage.addChild(pixiMapLayer);
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

// Re-upload the map texture to the GPU. Used by the Player video loop: each frame
// the current video frame is drawn into the texture's source canvas, then this
// pushes it to the GPU. (The DM uses a DOM <video> element instead, so this is
// Player-only.)
function pixiUpdateMapTexture() {
  if (pixiMapTexture && pixiMapTexture.baseTexture) pixiMapTexture.baseTexture.update();
}

// Player video playback: the map is a masked PixiJS sprite (no DOM <video> compositing),
// so the map texture must be refreshed from the video every rendered frame. We hook the
// PixiJS render ticker directly rather than the app's dirty-flag render loop, which only
// fires on demand and would leave the video frozen between viewport changes.
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
// WebGL has a hard MAX_TEXTURE_SIZE limit (4096–16384 depending on GPU).
// Maps and fog canvases that exceed it need downscaled proxy canvases.

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
// The Player does NOT render fog in PixiJS — it uses the Canvas-2D renderFog() path
// (fog.js) drawing fog-on-top-with-holes on #fog-canvas, above #pixi-canvas. PixiJS in
// the Player draws only the unmasked map sprite. So everything below is DM-only.
//
// Layer hierarchy inside pixiFogLayer (DM mode):
//   [0] pixiFogTransSpr       — snapshot of prior fog state, fades out during transitions
//   [1] pixiFogBlurSpr        — blurred fog canvas (the base, always visible)
//   [2] pixiFogCloudContainer — 3 TilingSprites + purple overlay, masked to fog-opaque pixels

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

    // --- Cloud TilingSprites (3 passes) + mask ---
    // Mask sprite re-uses pixiFogBlurTex so BT.update() keeps it in sync automatically.
    // IMPORTANT: the mask sprite must be a child of pixiFogLayer so that getBounds() uses the
    // stage world transform (zoom). Without a parent, getBounds() returns local-space bounds
    // (mapW × mapH = e.g. 10000×6000), causing SpriteMaskFilter to allocate a 229 MB intermediate
    // RenderTexture. With the stage transform applied, the bounds are viewport-sized (~8 MB).
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

    // Purple-blue luminosity tint — replicates the source-atop purple overlay from Canvas 2D path.
    // Being inside the masked container restricts it to fog-opaque pixels automatically.
    const purpleOverlay = new PIXI.Graphics();
    purpleOverlay.beginFill(0x7050e0, 0.18);
    purpleOverlay.drawRect(0, 0, mapW, mapH);
    purpleOverlay.endFill();
    pixiFogCloudContainer.addChild(purpleOverlay);

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

// Called every fog animation tick — updates TilingSprite drift + uploads the 512×512 cloud frame.
// offsets: array of {x,y} per pass (null entries keep current tilePosition)
// alphas:  array of alpha values per pass (null entries keep current alpha)
function pixiUpdateFogAnim(offsets, alphas) {
  if (!pixiFogCloudSprs.length) return;
  for (let i = 0; i < pixiFogCloudSprs.length; i++) {
    const spr = pixiFogCloudSprs[i];
    if (offsets && offsets[i]) {
      spr.tilePosition.x = offsets[i].x;
      spr.tilePosition.y = offsets[i].y;
    }
    if (alphas && alphas[i] != null) spr.alpha = alphas[i];
  }
  if (pixiFogCloudBT) pixiFogCloudBT.update();
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
  pixiMapSprite  = null;
  pixiMapLayer   = null;
  pixiFogLayer   = null;
  pixiGridLayer  = null;
  pixiToolLayer  = null;
  if (pixiApp) {
    pixiApp.destroy(true, { children: true, texture: true, baseTexture: true });
    pixiApp = null;
  }
}
