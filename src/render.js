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

// ⚠ This loop RIDES THE PIXIJS TICKER, never its own requestAnimationFrame. pumpDirtyRender is
// registered in renderer.js at a priority above PixiJS's own render, which is what makes the frame
// cap safe.
//
// doRender paints the Canvas-2D layers AND sets the Pixi stage viewport, and the WebGL map appears
// at the next present. Two independently-throttled loops share an interval but not a phase, so the
// 2D layers lead the map by most of a frame and the grid slides against it during a pan.
//
// ⚠ The cap lives on the ticker (APP_MAX_FPS). Never add a second gate here: a throttle on top of
// a throttle is the phase problem this replaced.
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
// Lift the frame cap for the length of a DM viewport gesture. boostRender() may be called as often
// as the gesture likes, and nothing has to call a matching stop.
//
// DM-only: the Player runs a TV, where the sync path and not the frame rate is the limit.
function boostRender() {
  if (isPlayer) return;
  renderBoostUntil = performance.now() + RENDER_BOOST_MS;
  if (pixiApp) pixiApp.ticker.maxFPS = 0; // 0 = uncapped (PixiJS Ticker.maxFPS setter)
}

function endRenderBoost() {
  renderBoostUntil = 0;
  if (pixiApp) pixiApp.ticker.maxFPS = APP_MAX_FPS;
}

// Called by the PixiJS ticker every allowed frame, just before the stage is presented. The ticker
// runs whether or not anything is dirty, so an expired boost is noticed here with no timer.
function pumpDirtyRender() {
  if (renderBoostUntil && performance.now() >= renderBoostUntil) endRenderBoost();
  // Map effects animate continuously, so they ride the ticker rather than the dirty flags.
  // pumpEffects returns on a size check when nothing is placed.
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
// ⚠ THE VIEWPORT GESTURES MUST USE THIS, NOT drawCursor() DIRECTLY. A pan handler runs once per
// mouse event while every other layer is capped, so painting inline puts the outlines, labels and
// room card on a different clock from the map. It also walks every polygon and lays out every
// label, delaying the rAF callbacks the capped layers depend on.
//
// The non-gesture callers still call drawCursor() directly: they fire on discrete edits.
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

  // Ahead of the early returns so the flag always clears — drawCursor() guards the no-map case.
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
// Doors outline throughout Rooms mode, dimmed unless their own tool is picked, or a room gives no
// sign it has any. That tool also ticks each wall at its cell boundaries — the only way a diagonal
// wall's cells are predictable, since it has no world grid to read.
const DOOR_TICK_MIN_PX = 8;   // screen px per grid cell, below which the wall ticks are dropped

function drawDoorHandles(active) {
  const size = doorSizeForCell(gridSize, doorWidthPct, doorDepthPct);
  if (!(size.width > 0)) return;
  const sx = x => x * zoom + panX, sy = y => y * zoom + panY;
  const square = gridMode === 'square';
  cursorCtx.save();
  cursorCtx.lineWidth = 1.5;

  // ⚠ One tick per cell per wall: at the grid's smallest size on a big map that is tens of
  // thousands of segments on every mouse move, and a smear rather than a guide. drawGridLines
  // stops at 4px for the same reason, so the grid itself is already gone by here.
  if (active && gridSize * zoom >= DOOR_TICK_MIN_PX) {
    cursorCtx.strokeStyle = 'rgba(120,190,255,0.3)';
    cursorCtx.beginPath();
    for (const poly of polygons) {
      if (poly.vertices.length < 3) continue;
      for (let e = 0; e < poly.vertices.length; e++) {
        const b = doorCellBounds(poly.vertices, e, gridSize, gridOffsetX, gridOffsetY, square);
        if (!b) continue;
        const f = b.frame, tick = 6 / zoom;
        for (const a of b.at) {
          const px = f.a.x + f.ux * a, py = f.a.y + f.uy * a;
          cursorCtx.moveTo(sx(px - f.n.x * tick), sy(py - f.n.y * tick));
          cursorCtx.lineTo(sx(px + f.n.x * tick), sy(py + f.n.y * tick));
        }
      }
    }
    cursorCtx.stroke();
  }

  cursorCtx.strokeStyle = active ? 'rgba(120,190,255,0.95)' : 'rgba(120,190,255,0.4)';
  for (const poly of polygons) {
    if (!poly.doors) continue;
    for (const d of poly.doors) {
      const c = doorNotchCorners(poly.vertices, d, size.width, size.depth, size.depth);
      if (!c) continue;
      cursorCtx.beginPath();
      cursorCtx.moveTo(sx(c.innerL.x), sy(c.innerL.y));
      cursorCtx.lineTo(sx(c.outerL.x), sy(c.outerL.y));
      cursorCtx.lineTo(sx(c.outerR.x), sy(c.outerR.y));
      cursorCtx.lineTo(sx(c.innerR.x), sy(c.innerR.y));
      cursorCtx.closePath();
      cursorCtx.stroke();
    }
  }
  cursorCtx.restore();
}

function drawCursor(screenX, screenY) {
  // Any direct paint satisfies a pending scheduleCursor(), so a discrete caller cannot be undone
  // by a stale scheduled repaint a tick later.
  cursorDirty = false;
  _cursorX = screenX;
  _cursorY = screenY;

  cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
  if (!mapOffscreen && !mapVideo) return;

  // BOTH lists are outlined, so the DM sees a fire while drawing the room around it, but only the
  // list the placement mode names can be SELECTED. The other is DIMMED, so it stops offering
  // handles it would refuse.
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
  // Editing chrome, never sent to the Player; the notch itself is fog and reads the same on both
  // screens. Effects mode has no doors to show.
  if (!isPlayer && placeMode !== 'effects') drawDoorHandles(shape === 'door');
  // Second pass, so labels paint above every outline rather than under the next room's.
  // roomPanel.js loads after this file, hence the guards.
  if (typeof drawRoomLabels === 'function') drawRoomLabels();
  if (typeof refreshRoomPanel === 'function') refreshRoomPanel();

  if (activePolygon && activePolygon.vertices.length > 0) {
    drawActivePolyPreview(screenX, screenY);
    return; // skip other cursor shapes while drawing polygon
  }

  if (screenX == null) return;
  // Same table the polygon paths read, so a preview is already the colour of the room it makes.
  // The centre dots stay white: they mark where the stroke lands and must read against every map.
  // In Effects mode the preview stops wearing a fog colour, or the only thing saying where the next
  // drag lands is a toolbar button the DM is not looking at.
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
