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

// ─── Render boost ─────────────────────────────────────────────────────────────
// Lift the frame cap for the length of a DM viewport gesture. See the deadline
// rationale in state.js — the contract here is that boostRender() may be called as
// often as the gesture likes and nothing has to call a matching stop.
//
// DM-only on purpose. The Player runs a TV, where the sync path and not the frame
// rate is the limit, and a boost there would only heat the machine. If Player
// freelook ever wants this, drop the guard deliberately rather than by accident.
function boostRender() {
  if (isPlayer) return;
  renderBoostUntil = performance.now() + RENDER_BOOST_MS;
  if (pixiApp) pixiApp.ticker.maxFPS = 0; // 0 = uncapped (PixiJS Ticker.maxFPS setter)
}

function endRenderBoost() {
  renderBoostUntil = 0;
  if (pixiApp) pixiApp.ticker.maxFPS = APP_MAX_FPS;
}

// Called by the PixiJS ticker every allowed frame, just before the stage is presented.
// The ticker runs every frame regardless of whether anything is dirty, so this is a
// reliable place to notice an expired boost — there is no timer to leak.
function pumpDirtyRender() {
  if (renderBoostUntil && performance.now() >= renderBoostUntil) endRenderBoost();
  // Map effects animate continuously, so they ride the ticker rather than the dirty flags —
  // the stage is presented every tick anyway, and pumpEffects returns on a Map size check when
  // nothing is placed. effects.js.
  pumpEffects();
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

// Request an overlay repaint on the shared clock instead of painting inline.
//
// THE VIEWPORT GESTURES MUST USE THIS, NOT drawCursor() DIRECTLY. A pan handler runs
// once per mouse event — on a 180Hz display that is ~180 times a second, while every
// other layer is capped at APP_MAX_FPS. Painting the overlay inline therefore put the
// room outlines, labels and room card on a different clock from the map and fog they
// sit on, which is the whole point of riding the ticker (see the note above). It also
// made the overlay the most expensive thing on the main thread during a drag — it walks
// every polygon, lays out every label and repositions the room card — so it delayed the
// very rAF callbacks the capped layers depend on, and they arrived late and unevenly.
//
// The non-gesture callers (tools.js, roomPanel.js) still call drawCursor() directly and
// should: they fire on discrete edits, not per mouse event, and want the repaint now.
let _cursorX = null, _cursorY = null;

function scheduleCursor(screenX, screenY) {
  _cursorX = screenX;
  _cursorY = screenY;
  cursorDirty = true;
  scheduleRender();
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

  // Ahead of the early returns below so the flag always clears — drawCursor() guards
  // the no-map case itself. Position within the tick is free: the 2D overlay and the
  // WebGL present land in the same compositor frame either way.
  if (cursorDirty) drawCursor(_cursorX, _cursorY);

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
    viewportDirty = fogDirty = gridDirty = false;
    if (!isPlayer) minimapDirty = true;
  } else {
    if (fogDirty)  { renderFog(vp); fogDirty = false; if (!isPlayer) minimapDirty = true; }
    if (gridDirty) { renderGrid(vp); gridDirty = false; if (!isPlayer) minimapDirty = true; }
  }

  if (!isPlayer && minimapDirty) drawMinimap();

}

// ─── Cursor overlay ───────────────────────────────────────────────────────────
function drawCursor(screenX, screenY) {
  // Any direct paint satisfies a pending scheduleCursor(), so a discrete caller can
  // never be undone by a stale scheduled repaint arriving a tick later — mouseleave
  // clearing the brush ring is the case that needs this.
  cursorDirty = false;
  _cursorX = screenX;
  _cursorY = screenY;

  cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
  if (!mapOffscreen && !mapVideo) return;

  // BOTH lists are outlined, so the DM can see a fire while drawing the room around it, but
  // only the list the placement mode names can be SELECTED — which is what makes a click over
  // a fire drawn inside a room unambiguous rather than a priority guess. The other list is
  // DIMMED to match: it is still visible, it just stops offering handles it would refuse.
  const roomsLive = placeMode !== 'effects';
  for (const poly of polygons) {
    const isSel = roomsLive && poly.id === selectedPolygonId;
    drawPolyOutline(poly, isSel, isSel ? selectedVertexIndex : -1, !roomsLive);
  }
  // Player-side guard: effects DO cross to the Player, and its view carries no editing chrome.
  if (!isPlayer) {
    for (const e of effects) {
      const isSel = !roomsLive && e.id === selectedPolygonId;
      drawPolyOutline(e, isSel, isSel ? selectedVertexIndex : -1, roomsLive);
    }
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
  // Same table the polygon paths read, so a brush/rect/circle preview is already the colour
  // the room it makes will be outlined in. The centre dots below stay white on purpose:
  // they mark where the stroke lands, so they must read against every map.
  // In Effects mode the shape tools draw into a different array entirely, so the preview stops
  // wearing a fog colour — otherwise the only thing saying where the next drag lands is a
  // toolbar button the DM is not looking at while they draw. effects.js owns the colour.
  const drawingEffect = placeMode === 'effects' &&
                       (shape === 'rect' || shape === 'circle' || shape === 'cone');
  const color = drawingEffect ? EFFECT_EDGE_COLOR
                              : (POLY_EDGE_COLORS[tool] || POLY_EDGE_COLORS.shroud);
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
  } else if (shape === 'cone' && isDrawing && coneApex != null) {
    // Previewed from the SNAPPED direction, not the raw cursor, so what the DM sees while
    // dragging is the triangle they are about to get.
    const tip = { x: (screenX - panX) / zoom, y: (screenY - panY) / zoom };
    const v = coneVertices(coneApex, tip, axisLock ? CONE_SNAP_DEG : 0);
    if (v) {
      cursorCtx.beginPath();
      v.forEach((pt, i) => {
        const x = pt.x * zoom + panX, y = pt.y * zoom + panY;
        if (i === 0) cursorCtx.moveTo(x, y); else cursorCtx.lineTo(x, y);
      });
      cursorCtx.closePath();
      cursorCtx.stroke();
      cursorCtx.setLineDash([]);
      // The apex dot marks the point of origin, which is the thing the DM is aiming from.
      cursorCtx.fillStyle = 'rgba(255,255,255,0.6)';
      cursorCtx.beginPath();
      cursorCtx.arc(coneApex.x * zoom + panX, coneApex.y * zoom + panY, 2.5, 0, Math.PI * 2);
      cursorCtx.fill();
    }
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
