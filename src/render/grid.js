'use strict';
// grid.js — grid rendering + config serialization. Reads grid state from state.js; drawGridLines
// derives scale from the vp it receives.

// ─── Line width ───────────────────────────────────────────────────────────────
// N map-pixels wide so lines scale with zoom; floor keeps thin lines visible.
const MIN_SCREEN_PX = 0.75;

function lineWidthForZoom(base, zoom) {
  return Math.max(MIN_SCREEN_PX, base * zoom);
}

// The setLineDash pattern for a line style, in screen px. Dashes and gaps grow with the line
// width and the zoom, so the pattern holds its shape on the map at every zoom; a dot is a near-zero
// dash that the round cap draws as a circle.
const GRID_LINE_STYLES = ['solid', 'dashed', 'dotted'];
function gridDashPattern(style, width, scale) {
  const u = Math.max(width, 1.5) * scale;
  if (style === 'dashed') return [u * 4, u * 3];
  if (style === 'dotted') return [0.001, u * 3];
  return [];
}

// A saved grid with no style, or one this release does not know, reads as solid.
function normalizeGridLineStyle(style) {
  return GRID_LINE_STYLES.includes(style) ? style : 'solid';
}

// ─── Rendering ───────────────────────────────────────────────────────────────
// The shared primitive behind renderGrid (DM) and renderMap (Player). `style` overrides colour,
// alpha and width for the ember relight inside effect zones.
function drawGridLines(ctx, vp, style) {
  const scale = vp.dstW / vp.srcW;
  const step = gridSize * scale;
  if (step < 4 || vp.srcW <= 0 || vp.srcH <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(vp.dstX, vp.dstY, vp.dstW, vp.dstH);
  ctx.clip();
  ctx.strokeStyle = (style && style.color) || gridColor;
  ctx.globalAlpha = style && style.alpha != null ? style.alpha : gridOpacity;
  ctx.lineWidth = lineWidthForZoom(gridLineWidth, scale) * (style && style.widthMul || 1);
  ctx.setLineDash(gridDashPattern(gridLineStyle, gridLineWidth * (style && style.widthMul || 1), scale));
  ctx.lineCap = gridLineStyle === 'dotted' ? 'round' : 'butt';

  if (gridMode === 'square') {
    ctx.beginPath();
    const c0 = Math.floor((vp.srcX - gridOffsetX) / gridSize);
    const c1 = Math.ceil( (vp.srcX - gridOffsetX + vp.srcW) / gridSize);
    const r0 = Math.floor((vp.srcY - gridOffsetY) / gridSize);
    const r1 = Math.ceil( (vp.srcY - gridOffsetY + vp.srcH) / gridSize);
    // Each line starts on a grid crossing, never the viewport's edge: the dash pattern restarts at
    // every subpath, and an edge start would make the dashes crawl as the view pans.
    const sxAt = c => vp.dstX + (gridOffsetX + c * gridSize - vp.srcX) * scale;
    const syAt = r => vp.dstY + (gridOffsetY + r * gridSize - vp.srcY) * scale;
    for (let c = c0; c <= c1; c++) {
      ctx.moveTo(sxAt(c), syAt(r0)); ctx.lineTo(sxAt(c), syAt(r1));
    }
    for (let r = r0; r <= r1; r++) {
      ctx.moveTo(sxAt(c0), syAt(r)); ctx.lineTo(sxAt(c1), syAt(r));
    }
    ctx.stroke();

  } else { // hex-pointy
    const hw = gridSize * Math.sqrt(3);
    const rowStep = 1.5 * gridSize;
    const colMin = Math.floor((vp.srcX - gridOffsetX - hw) / hw);
    const colMax = Math.ceil( (vp.srcX - gridOffsetX + vp.srcW + hw) / hw);
    const rowMin = Math.floor((vp.srcY - gridOffsetY - gridSize * 2) / rowStep);
    const rowMax = Math.ceil( (vp.srcY - gridOffsetY + vp.srcH + gridSize * 2) / rowStep);
    ctx.beginPath();
    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        const cx = gridOffsetX + col * hw + (row & 1) * hw / 2;
        const cy = gridOffsetY + row * rowStep;
        for (let k = 0; k < 6; k++) {
          const angle = Math.PI / 3 * k + Math.PI / 6;
          const px = vp.dstX + (cx + gridSize * Math.cos(angle) - vp.srcX) * scale;
          const py = vp.dstY + (cy + gridSize * Math.sin(angle) - vp.srcY) * scale;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
      }
    }
    ctx.stroke();
  }

  ctx.restore();
}

function renderGrid(vp) {
  gridCtx.clearRect(0, 0, vp.cw, vp.ch);
  // In Player view the grid is painted onto the map canvas (see renderMap),
  // so the fog layer above it naturally hides it in shrouded areas.
  if (isPlayer) return;
  // ⚠ The Door tool shows the grid even when the DM has it switched off, because a door IS one
  // cell and placing one blind is guesswork. Do NOT do this by flipping gridEnabled: that value is
  // the scene's and reaches the TV, so picking a tool would put a grid in front of the players
  // mid-session. renderPlayerGrid stays gated on gridEnabled alone.
  // Calibration hides it instead: the old grid over the map art is what the DM is not aiming at,
  // and the shape draws its own cells.
  if (gridCalArmed) return;
  if (!gridEnabled && shape !== 'door') return;
  drawGridLines(gridCtx, vp);
  drawEffectGridGlow(gridCtx, vp);
}

// Edge squares: the grid relit in each effect's and light's own colour, bright at its edge and gone within one
// cell inward, so the middle shows the plain map grid and the cells along the edge stay countable. ⚠ It has to
// live HERE, on the grid's own canvas: the effects and lights are a PixiJS layer below it. Hex grids relight
// too: drawGridLines applies the style override before it branches on gridMode.
function drawEffectGridGlow(ctx, vp) {
  const items = [];
  if (typeof effects !== 'undefined') {
    for (const e of effects) {
      if (!e.vertices || e.vertices.length < 3) continue;
      items.push({ key: _gridGlowKey(e), color: effectMaterial(e.material).grid, shapes: [_glowRingsOf(e)] });
    }
  }
  // Every light as one union, as lights.js draws their glow; lightPolys is what both screens hold.
  if (typeof lightPolys !== 'undefined' && lightPolys.length) {
    items.push({ key: lightPolys, color: LIGHT_RGB, reveal: tvRevealCanvas(),
      shapes: lightPolys.map(rings => rings.map(flat => {
        const pts = [];
        for (let i = 0; i < flat.length; i += 2) pts.push({ x: flat[i], y: flat[i + 1] });
        return pts;
      })) });
  }
  const live = new Set();
  for (const it of items) {
    live.add(it.key);
    _drawEdgeSquares(ctx, vp, it);
  }
  for (const k of _glowMasks.keys()) if (!live.has(k)) _glowMasks.delete(k);
}

// One effect's rings, corners and curves resolved the way its shader draws them.
function _glowRingsOf(e) {
  let offset = 0;
  return polyRings(e).map(ring => {
    const pts = roundEffectRing(ring, e.cornerRadius || 0, e.cornerRadii || null, offset, e.handles);
    offset += ring.length;
    return pts;
  });
}

function _gridGlowKey(e) {
  return 'fx' + e.id + '|' + e.material + '|' + (e.cornerRadius || 0) + '|' + (e.cornerRadii || '') + '|' +
    JSON.stringify(e.handles || null) + '|' + polyRings(e).map(r => r.map(v => (v.x | 0) + ',' + (v.y | 0)).join(';')).join('/');
}

function _glowBox(shapes) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const rings of shapes) for (const ring of rings) for (const v of ring) {
    if (v.x < x1) x1 = v.x; if (v.x > x2) x2 = v.x;
    if (v.y < y1) y1 = v.y; if (v.y > y2) y2 = v.y;
  }
  return { x1, y1, x2, y2 };
}

function _fillShapes(c, shapes, map) {
  c.fillStyle = '#fff';
  for (const rings of shapes) {
    c.beginPath();
    for (const ring of rings) {
      ring.forEach((v, i) => { const p = map(v); if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); });
      c.closePath();
    }
    c.fill('evenodd');
  }
}

// The falloff, in map space and kept per shape and cell size: the shape less its own blurred copy, as lights.js
// builds its glow, so it is bright at the edge and gone within one cell without a per-pixel distance.
const GLOW_MASK_MAX = 1024;
const _glowMasks = new Map();
function _glowMask(it, box) {
  const cached = _glowMasks.get(it.key);
  if (cached && cached.cell === gridSize) return cached;
  const pad = gridSize;
  const s = Math.min(1, GLOW_MASK_MAX / Math.max(box.x2 - box.x1 + 2 * pad, box.y2 - box.y1 + 2 * pad));
  const W = Math.max(1, Math.ceil((box.x2 - box.x1 + 2 * pad) * s)), H = Math.max(1, Math.ceil((box.y2 - box.y1 + 2 * pad) * s));
  const mk = () => { const k = document.createElement('canvas'); k.width = W; k.height = H; return k; };
  const shape = mk(), blurred = mk(), out = mk();
  _fillShapes(shape.getContext('2d'), it.shapes, v => ({ x: (v.x - box.x1 + pad) * s, y: (v.y - box.y1 + pad) * s }));
  const b = blurred.getContext('2d');
  b.filter = 'blur(' + (gridSize * 0.35 * s) + 'px)';
  b.drawImage(shape, 0, 0);
  const o = out.getContext('2d');
  o.drawImage(shape, 0, 0);
  o.globalCompositeOperation = 'destination-out';
  o.drawImage(blurred, 0, 0);
  // Right at the edge the blurred copy is half there; drawn over itself the edge comes back to full.
  o.globalCompositeOperation = 'source-over';
  o.drawImage(out, 0, 0);
  const m = { canvas: out, x: box.x1 - pad, y: box.y1 - pad, s, cell: gridSize };
  _glowMasks.set(it.key, m);
  return m;
}

const _glowScratch = [];
function _glowLayer(i, W, H) {
  let k = _glowScratch[i];
  if (!k) { k = document.createElement('canvas'); _glowScratch[i] = k; }
  if (k.width < W || k.height < H) { k.width = Math.max(k.width, W); k.height = Math.max(k.height, H); }
  const c = k.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
  c.clearRect(0, 0, W, H);
  return k;
}

function _drawEdgeSquares(ctx, vp, it) {
  const scale = vp.dstW / vp.srcW;
  const box = _glowBox(it.shapes);
  // ⚠ HAND drawGridLines THIS SHAPE'S BOX, never the whole viewport. It walks every cell in the region it is
  // given, and a hex cell is a six-point subpath, so the viewport would rebuild the entire grid once per effect.
  const mx1 = Math.max(box.x1, vp.srcX), my1 = Math.max(box.y1, vp.srcY);
  const mx2 = Math.min(box.x2, vp.srcX + vp.srcW), my2 = Math.min(box.y2, vp.srcY + vp.srcH);
  if (mx2 <= mx1 || my2 <= my1) return;
  const ox = vp.dstX + (mx1 - vp.srcX) * scale, oy = vp.dstY + (my1 - vp.srcY) * scale;
  const W = Math.ceil((mx2 - mx1) * scale) + 2, H = Math.ceil((my2 - my1) * scale) + 2;
  const mask = _glowMask(it, box);
  const lines = _glowLayer(0, W, H), l = lines.getContext('2d');
  drawGridLines(l, { ...vp, srcX: mx1, srcY: my1, srcW: mx2 - mx1, srcH: my2 - my1, dstX: 0, dstY: 0,
    dstW: (mx2 - mx1) * scale, dstH: (my2 - my1) * scale }, { color: it.color, alpha: 1, widthMul: 1.8 });
  l.globalCompositeOperation = 'destination-in';
  l.drawImage(mask.canvas, (mask.x - mx1) * scale, (mask.y - my1) * scale,
    mask.canvas.width / mask.s * scale, mask.canvas.height / mask.s * scale);
  // The crisp outline, so the lines stop at the edge the effect draws and not at the mask's softer copy.
  const clip = _glowLayer(1, W, H), c = clip.getContext('2d');
  _fillShapes(c, it.shapes, v => ({ x: (v.x - mx1) * scale, y: (v.y - my1) * scale }));
  l.drawImage(clip, 0, 0);
  // A light's cells stop where its glow does on the TV: half fog is see-through, and they would give the room away.
  if (it.reveal) l.drawImage(it.reveal, -mx1 * scale, -my1 * scale, mapWidth * scale, mapHeight * scale);
  ctx.save();
  ctx.globalAlpha = (typeof FX_LOOK !== 'undefined') ? FX_LOOK.gridGlow : 0.7;
  ctx.drawImage(lines, 0, 0, W, H, ox, oy, W, H);
  ctx.restore();
}

function renderPlayerGrid(vp) {
  if (!playerGridCtx) return;
  // ⚠ NOTHING IS DRAWN OR UPLOADED WHILE THE GRID IS OFF. This runs on every viewport-dirty
  // frame, and the upload is the size of the screen - a pan would pay for a blank canvas.
  if (!gridEnabled) { pixiHidePlayerGrid(); return; }
  playerGridCtx.clearRect(0, 0, vp.cw, vp.ch);
  drawGridLines(playerGridCtx, vp);
  drawEffectGridGlow(playerGridCtx, vp);
  // The canvas is offscreen; this is what puts it on the screen, under the fog.
  pixiSetPlayerGrid(playerGridCanvas);
  pixiUploadPlayerGrid();
}

// ─── Committing a change ──────────────────────────────────────────────────────
// ⚠ EVERY grid control goes through this, the on/off toggle and Reset included. The grid belongs to
// the scene, so a change has to reach the Player AND the store, and scheduleAutoSync debounces both.
function commitGridChange() {
  if (paneForward('grid', { config: captureGridConfig() })) return;
  if (isPane && parent !== window) parent.postMessage({ type: 'pane-grid-changed', pane: paneId }, '*');
  noteSettingsChange();
  gridDirty = true;
  // A door is one cell wide, so the cell changing resizes every door already placed.
  rebuildFogForGridChange();
  if (typeof updateContextPanels === 'function') updateContextPanels();
  if (presetArmed) drawCursor(lastScreenX, lastScreenY);   // a size follows the cell, so its outline does too
  scheduleRender();
  scheduleAutoSync();
}

// The Line style segment. Through commitGridChange like every grid control, so it saves, reaches
// the Player and the columns, and undoes.
function setGridLineStyle(style) {
  gridLineStyle = normalizeGridLineStyle(style);
  commitGridChange();
  if (typeof refreshGridControlUI === 'function') refreshGridControlUI();
}

// The grid a freshly imported map starts with. The DM's LOOK carries over — colour, opacity,
// thickness, grid type, on/off — because that is a preference, not a property of the map. The
// FIT does not: cell size and offset describe whatever map was on screen a moment ago, and
// inheriting them is what made the grid look shared between scenes. Where the map came with a
// floor plan, floorPlan.js overwrites cellSize with the size the plan implies.
function freshGridConfig() {
  return { ...captureGridConfig(), cellSize: GRID_DEFAULT_SIZE, offsetX: 0, offsetY: 0 };
}

// ─── Config serialization ─────────────────────────────────────────────────────
// Flat-top hex was dropped: a saved one loads as pointy-top and needs one recalibration.
const GRID_MODES = ['square', 'hex-pointy'];
function normalizeGridMode(mode, current) {
  if (mode === 'hex-flat') return 'hex-pointy';
  return GRID_MODES.includes(mode) ? mode : current;
}

function captureGridConfig() {
  return { enabled: gridEnabled, cellSize: gridSize, offsetX: gridOffsetX, offsetY: gridOffsetY, color: gridColor, opacity: gridOpacity, mode: gridMode, lineWidth: gridLineWidth, lineStyle: gridLineStyle };
}

function applyGridConfig(cfg) {
  if (!cfg) return;
  gridEnabled   = cfg.enabled   ?? gridEnabled;
  gridSize      = cfg.cellSize  ?? gridSize;
  gridOffsetX   = cfg.offsetX   ?? gridOffsetX;
  gridOffsetY   = cfg.offsetY   ?? gridOffsetY;
  gridColor     = cfg.color     ?? gridColor;
  gridOpacity   = cfg.opacity   ?? gridOpacity;
  gridMode      = normalizeGridMode(cfg.mode, gridMode);
  gridLineWidth = cfg.lineWidth ?? gridLineWidth;
  gridLineStyle = normalizeGridLineStyle(cfg.lineStyle);
  if (!isPlayer) {
    document.getElementById('btn-grid').classList.toggle('active', gridEnabled);
    document.getElementById('grid-size').value                = gridSize;
    document.getElementById('grid-size-num').value            = gridSize;
    document.getElementById('grid-offset-x').value            = gridOffsetX;
    document.getElementById('grid-offset-y').value            = gridOffsetY;
    document.getElementById('grid-color').value               = gridColor;
    document.getElementById('grid-opacity').value             = Math.round(gridOpacity * 100);
    document.getElementById('grid-opacity-num').value         = Math.round(gridOpacity * 100);
    document.getElementById('grid-thickness').value           = gridLineWidth;
    document.querySelectorAll('.grid-mode-btn').forEach(b => b.classList.remove('active'));
    const mk = gridMode === 'square' ? 'sq' : 'hptop';
    document.getElementById('btn-grid-' + mk).classList.add('active');
    // Reflect the restored grid settings into the redesigned control panel.
    if (typeof refreshGridControlUI === 'function') refreshGridControlUI();
  }
  gridDirty = true;
}

// ─── Node.js export guard (unit tests only) ──────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { lineWidthForZoom, normalizeGridMode, gridDashPattern, normalizeGridLineStyle };
}
