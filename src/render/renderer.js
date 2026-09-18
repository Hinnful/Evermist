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
