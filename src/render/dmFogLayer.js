'use strict';
// dmFogLayer.js — the DM's fog: map-sized PixiJS sprites, their transition crossfade and the
// cloud container masked to them.

// ⚠ MAP-SIZED, AND DM-ONLY. The Player's fog is the full-screen pass in playerFogPass.js; these
// sprites end at the map edge, which is exactly what the Player cannot use.
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
