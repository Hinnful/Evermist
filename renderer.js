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

function pixiExtractCanvas() {
  if (!pixiApp || !pixiMapSprite) return null;
  return pixiApp.renderer.extract.canvas(pixiMapSprite);
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

// ─── PixiJS Fog Layer ────────────────────────────────────────────────────────
// Layer hierarchy inside pixiFogLayer (DM mode):
//   [0] pixiFogTransSpr      — snapshot of prior fog state, fades out during transitions
//   [1] pixiFogBlurSpr       — blurred fog canvas (the base, always visible)
//   [2] pixiFogCloudContainer — 3 TilingSprites + purple overlay, masked to fog-opaque pixels
//
// Player mode: fog is the BACKGROUND (behind map). Layers are swapped so fog renders below map.
// The map sprite is masked by an inverted fog blur canvas (reveal mask) so it only shows in
// revealed areas. Fog covers everything seamlessly — no map-rect boundary visible.
//
// Stage order (Player mode — swapped from DM):
//   stage[0] pixiFogLayer:
//     pixiFogBgGraphics       — navy fill (huge, covers far background)
//     pixiFogCloudContainer   — 3 unmasked TilingSprites + purple tint (covers everything)
//   stage[1] pixiMapLayer:
//     pixiFogRevealMaskSpr    — inverted fog blur (renderable=false, used as mask)
//     pixiMapSprite           — masked by pixiFogRevealMaskSpr (shows only revealed areas)

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

// Player-only fog effect sprite (Canvas 2D composited fogEffectCanvas)
let pixiFogEffectBT     = null;
let pixiFogEffectTex    = null;
let pixiFogEffectSpr    = null;
let pixiFogEffectProxy  = null;
let pixiFogEffectSrcCvs = null;

// Player-only background fog (navy fill + unmasked cloud TilingSprites behind map)
let pixiFogBgGraphics  = null;
let pixiFogBgCloudBT   = null;
let pixiFogBgCloudSpr  = null;
let pixiFogBgMask      = null;
// Stored map dimensions for transition sprite sizing (independent of pixiFogEffectSpr dimensions)
let pixiMapW = 0, pixiMapH = 0;

// Player-only: reveal mask (inverted fog blur — opaque where revealed, transparent where shrouded)
// Applied to pixiMapSprite so the map only shows in revealed areas; fog background shows everywhere else.
let pixiFogRevealMaskCvs   = null;
let pixiFogRevealMaskCtx   = null;
let pixiFogRevealMaskBT    = null;
let pixiFogRevealMaskTex   = null;
let pixiFogRevealMaskSpr   = null;
let pixiFogRevealMaskProxy = null;

// Player-only transition sprite (snapshot of old fogEffectCanvas, fades out during reveal)
let pixiFogTransEffectBT  = null;
let pixiFogTransEffectTex = null;
let pixiFogTransEffectSpr = null;

// fogBlurCvs      — fogBlurCanvas (fog-scale, updated on mouseup)
// cloudBlendCvs   — cloudBlendCanvas (512×512, cross-faded cloud frame, updated per anim tick)
// fogEffectCvs    — fogEffectCanvas (fog-scale, map-rect sized, used for transition snapshots)
// fogEffectExtCvs — fogEffectExtCanvas (extended canvas: map + FOG_DISPLAY_BORDER border; the display source)
function pixiInitFog(fogDataCvs, fogBlurCvs, cloudBlendCvs, mapW, mapH, playerMode, fogEffectCvs, fogEffectExtCvs) {
  if (!pixiApp) return;
  pixiDestroyFog();

  if (playerMode && fogBlurCvs) {
    // Player: fog is the BACKGROUND (behind map). The map sprite is masked to show
    // only revealed areas. This eliminates any seam between map-area fog and off-map
    // fog — they're the same unmasked layer covering everything uniformly.
    //
    // Layer order (swapped from DM):
    //   stage[0] pixiFogLayer  — navy fill + unmasked cloud TilingSprites + purple tint
    //   stage[1] pixiMapLayer  — map sprite masked by inverted fog blur
    //   stage[2] pixiGridLayer
    //   stage[3] pixiToolLayer

    pixiMapW = mapW;
    pixiMapH = mapH;

    // Swap layer order: fog renders BELOW map for Player
    pixiApp.stage.setChildIndex(pixiFogLayer, 0);
    pixiApp.stage.setChildIndex(pixiMapLayer, 1);

    const BS  = 5;
    const bgW = (2 * BS + 1) * mapW;
    const bgH = (2 * BS + 1) * mapH;

    // --- Unmasked fog background (covers entire visible area) ---
    pixiFogBgGraphics = new PIXI.Graphics();
    pixiFogBgGraphics.beginFill(0x1a1a2e, 1);
    pixiFogBgGraphics.drawRect(-BS * mapW, -BS * mapH, bgW, bgH);
    pixiFogBgGraphics.endFill();
    pixiFogLayer.addChild(pixiFogBgGraphics);

    pixiFogCloudBT  = PIXI.BaseTexture.from(cloudBlendCvs, { scaleMode: PIXI.SCALE_MODES.LINEAR });
    pixiFogCloudTex = new PIXI.Texture(pixiFogCloudBT);

    pixiFogCloudContainer = new PIXI.Container();
    pixiFogLayer.addChild(pixiFogCloudContainer);

    // Scale tiles 2.5× larger than DM — at 100% opacity the pattern repetition is
    // much more visible than DM's 55%, and the Player canvas covers a larger area.
    var playerTileBoost = 2.5;
    pixiFogCloudSprs = CLOUD_PASSES.map(p => {
      const ts = new PIXI.TilingSprite(pixiFogCloudTex, bgW, bgH);
      ts.x = -BS * mapW;
      ts.y = -BS * mapH;
      ts.tileScale.set(p.scale * FOG_SCALE * playerTileBoost, p.scale * FOG_SCALE * playerTileBoost);
      if (typeof ts.tileRotation === 'number') ts.tileRotation = p.angle;
      ts.alpha = p.alpha;
      pixiFogCloudContainer.addChild(ts);
      return ts;
    });

    const purpleOverlay = new PIXI.Graphics();
    purpleOverlay.beginFill(0x7050e0, 0.18);
    purpleOverlay.drawRect(-BS * mapW, -BS * mapH, bgW, bgH);
    purpleOverlay.endFill();
    pixiFogCloudContainer.addChild(purpleOverlay);

    // --- Reveal mask: inverted fog blur (opaque where revealed, transparent where shrouded) ---
    // Applied to pixiMapSprite so map only appears in revealed areas.
    const fw = fogBlurCvs.width, fh = fogBlurCvs.height;
    pixiFogRevealMaskCvs = document.createElement('canvas');
    pixiFogRevealMaskCvs.width  = fw;
    pixiFogRevealMaskCvs.height = fh;
    pixiFogRevealMaskCtx = pixiFogRevealMaskCvs.getContext('2d');
    pixiRebuildRevealMask(fogBlurCvs);

    pixiFogRevealMaskProxy = pixiClampCanvas(pixiFogRevealMaskCvs);
    const maskSrc = pixiFogRevealMaskProxy || pixiFogRevealMaskCvs;
    pixiFogRevealMaskBT  = PIXI.BaseTexture.from(maskSrc, { scaleMode: PIXI.SCALE_MODES.LINEAR });
    pixiFogRevealMaskTex = new PIXI.Texture(pixiFogRevealMaskBT);
    pixiFogRevealMaskSpr = new PIXI.Sprite(pixiFogRevealMaskTex);
    pixiFogRevealMaskSpr.width  = mapW;
    pixiFogRevealMaskSpr.height = mapH;
    pixiFogRevealMaskSpr.renderable = false;
    pixiMapLayer.addChild(pixiFogRevealMaskSpr);

    if (pixiMapSprite) {
      pixiMapSprite.mask = pixiFogRevealMaskSpr;
      // PixiJS creates a SpriteMaskFilter with default padding=4, which expands the
      // filter region 4px beyond the sprite boundary. In that 4px strip, CLAMP_TO_EDGE
      // repeats the reveal mask edge texel → map image bleeds visibly outside the map rect.
      // Inject a padding=0 filter into the MaskData before the first render to prevent this.
      var _md = pixiMapSprite._mask;
      if (_md && _md.isMaskData) {
        var _smf = new PIXI.SpriteMaskFilter(pixiFogRevealMaskSpr);
        _smf.padding = 0;
        _md._filters = [_smf];
      }
    }
  } else {
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

  pixiFogLayer.alpha = playerMode ? 1.0 : FOG_OPACITY_DM;
}

// Called on mouseup / polygon rebuild — uploads new fogBlurCanvas to GPU.
// Both pixiFogBlurSpr and pixiFogCloudMaskSpr share pixiFogBlurBT, so one update covers both.
function pixiUpdateFogBlurTexture() {
  if (!pixiFogBlurBT) return;
  if (pixiFogBlurProxy && pixiFogBlurSrcCvs) pixiRefreshProxy(pixiFogBlurProxy, pixiFogBlurSrcCvs);
  pixiFogBlurBT.update();
}

// Player-only: uploads new fogEffectCanvas (Canvas 2D composited blur + source-atop clouds) to GPU.
function pixiUpdateFogEffectTexture() {
  if (!pixiFogEffectBT) return;
  if (pixiFogEffectProxy && pixiFogEffectSrcCvs) pixiRefreshProxy(pixiFogEffectProxy, pixiFogEffectSrcCvs);
  pixiFogEffectBT.update();
}

// Background cloud TilingSprite removed — background fog is now baked into fogEffectExtCanvas
// alongside the inner fog, so both share a single cloud pass and there is no seam.
function pixiUpdateFogBgCloud(offsets) { /* no-op */ }

// Player-only: rebuild the inverted fog blur canvas (white where revealed, transparent where shrouded).
function pixiRebuildRevealMask(blurCvs) {
  if (!pixiFogRevealMaskCvs || !blurCvs) return;
  var ctx = pixiFogRevealMaskCtx;
  var w = pixiFogRevealMaskCvs.width, h = pixiFogRevealMaskCvs.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(blurCvs, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
}

// Player-only: rebuild + upload the reveal mask to GPU.
// blurCvs: the fog blur canvas to invert (defaults to rebuilding from current canvas).
function pixiUpdateRevealMask(blurCvs) {
  if (!pixiFogRevealMaskBT) return;
  if (blurCvs) pixiRebuildRevealMask(blurCvs);
  if (pixiFogRevealMaskProxy && pixiFogRevealMaskCvs) pixiRefreshProxy(pixiFogRevealMaskProxy, pixiFogRevealMaskCvs);
  pixiFogRevealMaskBT.update();
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

// Player-only transition sprite:
//   REVEAL (isShroud=false): cover = old fog snapshot, placed on top at alpha=1, fades to 0.
//   SHROUD (isShroud=true):  delta = newly-shrouded pixels, placed on top at alpha=0, fades to 1.
// Call with a canvas on first setup (t=0), then with null for subsequent alpha updates.
function pixiSetPlayerFogTransition(prevEffectCvs, t, isShroud) {
  if (!pixiApp) return;

  if (prevEffectCvs && !pixiFogTransEffectSpr) {
    const proxied = pixiClampCanvas(prevEffectCvs);
    const src = proxied || prevEffectCvs;
    pixiFogTransEffectBT  = PIXI.BaseTexture.from(src, { scaleMode: PIXI.SCALE_MODES.LINEAR });
    pixiFogTransEffectTex = new PIXI.Texture(pixiFogTransEffectBT);
    pixiFogTransEffectSpr = new PIXI.Sprite(pixiFogTransEffectTex);
    // Transition sprite covers the map rect only (0,0 → mapW,mapH) — the border area
    // of the extended fog sprite never participates in reveal/shroud transitions.
    pixiFogTransEffectSpr.width  = pixiMapW || (pixiFogEffectSpr ? pixiFogEffectSpr.width  : 0);
    pixiFogTransEffectSpr.height = pixiMapH || (pixiFogEffectSpr ? pixiFogEffectSpr.height : 0);
    // Add ON TOP so the transition sprite composites above pixiFogEffectSpr (which stays alpha=1).
    pixiFogLayer.addChild(pixiFogTransEffectSpr);
  }

  if (!pixiFogTransEffectSpr) return;

  // REVEAL: cover fades OUT (1→0). SHROUD: delta fades IN (0→1).
  pixiFogTransEffectSpr.alpha = isShroud ? t : (1 - t);
  // pixiFogEffectSpr.alpha intentionally NOT touched — always 1.
}

function pixiEndPlayerFogTransition() {
  if (pixiFogTransEffectSpr) {
    pixiFogLayer.removeChild(pixiFogTransEffectSpr);
    pixiFogTransEffectSpr.destroy();
    pixiFogTransEffectSpr = null;
  }
  if (pixiFogTransEffectTex) { pixiFogTransEffectTex.destroy(true); pixiFogTransEffectTex = null; }
  pixiFogTransEffectBT = null;
  // pixiFogEffectSpr.alpha NOT reset — it's always 1 by design.
}

function pixiDestroyFog() {
  // Player-only transition sprite must be torn down before the effect sprite it references
  pixiEndPlayerFogTransition();

  // Player-only reveal mask (remove from map sprite before destroying)
  if (pixiMapSprite && pixiMapSprite.mask === pixiFogRevealMaskSpr) {
    // Clear injected _filters before releasing: PixiJS pools MaskData objects; stale
    // SpriteMaskFilter references on a returned MaskData cause WebGL errors on reuse.
    var _mdata = pixiMapSprite._mask;
    if (_mdata && _mdata.isMaskData) _mdata._filters = null;
    pixiMapSprite.mask = null;
  }
  if (pixiFogRevealMaskSpr) { pixiMapLayer.removeChild(pixiFogRevealMaskSpr); pixiFogRevealMaskSpr.destroy(); pixiFogRevealMaskSpr = null; }
  if (pixiFogRevealMaskTex) { pixiFogRevealMaskTex.destroy(true); pixiFogRevealMaskTex = null; }
  pixiFogRevealMaskBT    = null;
  pixiFogRevealMaskProxy = null;
  pixiFogRevealMaskCvs   = null;
  pixiFogRevealMaskCtx   = null;

  // Restore layer order (fog above map) in case Player swapped them
  if (pixiApp && pixiApp.stage && pixiFogLayer && pixiMapLayer) {
    var fogIdx = pixiApp.stage.getChildIndex(pixiFogLayer);
    var mapIdx = pixiApp.stage.getChildIndex(pixiMapLayer);
    if (fogIdx < mapIdx) {
      pixiApp.stage.setChildIndex(pixiMapLayer, 0);
      pixiApp.stage.setChildIndex(pixiFogLayer, 1);
    }
  }

  // Player-only effect sprite
  if (pixiFogEffectSpr) { pixiFogLayer.removeChild(pixiFogEffectSpr); pixiFogEffectSpr.destroy(); pixiFogEffectSpr = null; }
  if (pixiFogEffectTex) { pixiFogEffectTex.destroy(true); pixiFogEffectTex = null; }
  pixiFogEffectBT     = null;
  pixiFogEffectProxy  = null;
  pixiFogEffectSrcCvs = null;

  // Player-only background fog
  if (pixiFogBgCloudSpr) { pixiFogBgCloudSpr.mask = null; pixiFogLayer.removeChild(pixiFogBgCloudSpr); pixiFogBgCloudSpr.destroy(); pixiFogBgCloudSpr = null; }
  pixiFogBgCloudBT = null;
  if (pixiFogBgMask) { pixiFogLayer.removeChild(pixiFogBgMask); pixiFogBgMask.destroy(); pixiFogBgMask = null; }
  if (pixiFogBgGraphics) {
    var parent = pixiFogBgGraphics.parent;
    if (parent) parent.removeChild(pixiFogBgGraphics);
    pixiFogBgGraphics.destroy(); pixiFogBgGraphics = null;
  }

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
