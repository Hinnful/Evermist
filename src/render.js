// render.js — render orchestration (dirty-flag dispatcher, canvas sizing) + cursor overlay

// ─── Canvas sizing ────────────────────────────────────────────────────────────
function syncSize() {
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  const _sizableCanvases = [mapCanvas, fogCanvas, gridCanvasEl, cursorCanvas];
  if (playerGridCanvas) _sizableCanvases.push(playerGridCanvas);
  for (const c of _sizableCanvases) {
    if (c.style.display === 'none') continue;
    if (c.width !== cw || c.height !== ch) {
      c.width  = cw;
      c.height = ch;
    }
  }
  pixiResize(cw, ch);
}

// ─── Rendering — split into per-layer functions ───────────────────────────────

// This loop RIDES THE PIXIJS TICKER rather than its own requestAnimationFrame —
// pumpDirtyRender is registered in renderer.js:initPixiRenderer at a priority above
// PixiJS's own render. That is not a tidiness choice, it is what makes the frame cap
// safe.
//
// doRender paints the Canvas-2D layers (grid, Player fog-on-top, cursor overlay) AND
// sets the Pixi stage viewport; the WebGL map only appears at the next present. Two
// independently-throttled loops hold the same interval but not the same phase, so the
// 2D layers ended up leading the map by most of a frame — measured at 33ms p90 during
// a pan, about 36px of grid sliding against the map. Sharing one clock, with doRender
// running immediately before the present in the SAME tick, drops that to ~0.
//
// The cap itself therefore lives on the ticker (APP_MAX_FPS, state.js). Do not
// reintroduce a second gate here: a throttle on top of a throttle is exactly the
// phase problem this replaced.
let _lastRenderTs   = -Infinity;
let _rafFallbackId  = null;

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  // No ticker to ride yet (pre-init) or the renderer was torn down — fall back to rAF
  // so an early render is never silently dropped.
  if (!pixiApp && _rafFallbackId == null) {
    _rafFallbackId = requestAnimationFrame(_rafFallbackTick);
  }
}

// Called by the PixiJS ticker every allowed frame, just before the stage is presented.
function pumpDirtyRender() {
  if (renderScheduled) doRender(); // doRender clears renderScheduled
}

function _rafFallbackTick(ts) {
  _rafFallbackId = null;
  if (pixiApp) return;                 // ticker has taken over; it will pick this up
  if (ts - _lastRenderTs < APP_FRAME_MS) {
    _rafFallbackId = requestAnimationFrame(_rafFallbackTick); // defer, never drop
    return;
  }
  _lastRenderTs = ts;
  doRender();
}

function getViewportSize() {
  if (pixiApp) return { w: pixiApp.renderer.width, h: pixiApp.renderer.height };
  return { w: mapCanvas.width, h: mapCanvas.height };
}

function calcViewport() {
  const { w: vpW, h: vpH } = getViewportSize();
  return calcViewportRect(panX, panY, zoom, mapWidth, mapHeight, vpW, vpH);
}

function doRender() {
  renderScheduled = false;
  flushBrushOps();
  if (!isPlayer && isDrawing) pixiUpdateFogDataTexture();

  if (!videoDOMActive && !mapOffscreen && !pixiMapSprite) return;

  const vp = calcViewport();
  if (!videoDOMActive && vp.srcW <= 0 && vp.srcH <= 0) return;

  if (videoDOMActive) syncVideoDomTransform();

  // In Player view the grid lives on the map canvas, so any grid change needs
  // a full map redraw rather than just the grid layer.
  if (isPlayer && gridDirty) viewportDirty = true;

  if (viewportDirty) {
    pixiSetViewport(zoom, panX, panY);
    if (isPlayer) renderPlayerGrid(vp);
    renderFog(vp);
    renderGrid(vp);
    viewportDirty = fogDirty = gridDirty = mapDirty = false;
    if (!isPlayer) minimapDirty = true;
  } else {
    if (mapDirty) {
      // Player video texture updates run on the PixiJS render ticker
      // (pixiStartVideoTextureSync), not here. DM uses a DOM <video> element.
      mapDirty = false;
    }
    if (fogDirty)  { renderFog(vp); fogDirty = false; if (!isPlayer) minimapDirty = true; }
    if (gridDirty) { renderGrid(vp); gridDirty = false; if (!isPlayer) minimapDirty = true; }
  }

  if (!isPlayer && minimapDirty) drawMinimap();

}

// ─── Cursor overlay ───────────────────────────────────────────────────────────
function drawCursor(screenX, screenY) {
  cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
  if (!mapOffscreen && !mapVideo) return;

  for (const poly of polygons) {
    const isSel = poly.id === selectedPolygonId;
    drawPolyOutline(poly, isSel, isSel ? selectedVertexIndex : -1);
  }
  // Second pass, so labels paint above every outline rather than under the next room's.
  // roomPanel.js loads after this file, hence the guards.
  if (typeof drawRoomLabels === 'function') drawRoomLabels();
  if (typeof refreshRoomPanel === 'function') refreshRoomPanel();

  if (activePolygon && activePolygon.vertices.length > 0) {
    drawActivePolyPreview(screenX, screenY);
    return; // skip other cursor shapes while drawing polygon
  }

  if (screenX == null) return;
  const color = tool === 'reveal' ? 'rgba(255,255,255,0.8)' : 'rgba(100,160,255,0.8)';
  cursorCtx.save();
  cursorCtx.strokeStyle = color;
  cursorCtx.lineWidth = 1.5;
  cursorCtx.setLineDash([4, 3]);

  if (shape === 'brush') {
    const r = brushSize / 2;
    cursorCtx.beginPath();
    cursorCtx.arc(screenX, screenY, r, 0, Math.PI * 2);
    cursorCtx.stroke();
    cursorCtx.setLineDash([]);
    cursorCtx.fillStyle = 'rgba(255,255,255,0.6)';
    cursorCtx.beginPath();
    cursorCtx.arc(screenX, screenY, 2, 0, Math.PI * 2);
    cursorCtx.fill();
  } else if (shape === 'rect' && isDrawing) {
    const sx = rectStartX * zoom + panX;
    const sy = rectStartY * zoom + panY;
    cursorCtx.strokeRect(sx, sy, screenX - sx, screenY - sy);
  } else if (shape === 'circle' && isDrawing && circleCenter != null) {
    const cx = circleCenter.x * zoom + panX;
    const cy = circleCenter.y * zoom + panY;
    const r = Math.hypot(screenX - cx, screenY - cy);
    cursorCtx.beginPath();
    cursorCtx.arc(cx, cy, r, 0, Math.PI * 2);
    cursorCtx.stroke();
    cursorCtx.setLineDash([]);
    cursorCtx.fillStyle = 'rgba(255,255,255,0.6)';
    cursorCtx.beginPath();
    cursorCtx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    cursorCtx.fill();
  }

  cursorCtx.restore();
}
