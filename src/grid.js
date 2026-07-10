// grid.js — grid rendering + config serialization.
// Extracted from the index.html inline blob (migrate-on-touch). See CLAUDE.md.
// Reads grid state globals from state.js; drawGridLines derives scale from the vp it receives.

// ─── Line width ───────────────────────────────────────────────────────────────
// N map-pixels wide so lines scale with zoom; floor keeps thin lines visible.
const MIN_SCREEN_PX = 0.75;

function lineWidthForZoom(base, zoom) {
  return Math.max(MIN_SCREEN_PX, base * zoom);
}

// ─── Rendering ───────────────────────────────────────────────────────────────
// Shared grid-drawing primitive used by both renderGrid (DM) and renderMap (Player).
function drawGridLines(ctx, vp) {
  const scale = vp.dstW / vp.srcW;
  const step = gridSize * scale;
  if (step < 4 || vp.srcW <= 0 || vp.srcH <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(vp.dstX, vp.dstY, vp.dstW, vp.dstH);
  ctx.clip();
  ctx.strokeStyle = gridColor;
  ctx.globalAlpha = gridOpacity;
  ctx.lineWidth = lineWidthForZoom(gridLineWidth, scale);

  if (gridMode === 'square') {
    ctx.beginPath();
    const c0 = Math.floor((vp.srcX - gridOffsetX) / gridSize);
    const c1 = Math.ceil( (vp.srcX - gridOffsetX + vp.srcW) / gridSize);
    const r0 = Math.floor((vp.srcY - gridOffsetY) / gridSize);
    const r1 = Math.ceil( (vp.srcY - gridOffsetY + vp.srcH) / gridSize);
    for (let c = c0; c <= c1; c++) {
      const sx = vp.dstX + (gridOffsetX + c * gridSize - vp.srcX) * scale;
      ctx.moveTo(sx, vp.dstY); ctx.lineTo(sx, vp.dstY + vp.dstH);
    }
    for (let r = r0; r <= r1; r++) {
      const sy = vp.dstY + (gridOffsetY + r * gridSize - vp.srcY) * scale;
      ctx.moveTo(vp.dstX, sy); ctx.lineTo(vp.dstX + vp.dstW, sy);
    }
    ctx.stroke();

  } else if (gridMode === 'hex-flat') {
    const hh = gridSize * Math.sqrt(3);
    const colStep = 1.5 * gridSize;
    const colMin = Math.floor((vp.srcX - gridOffsetX - gridSize * 2) / colStep);
    const colMax = Math.ceil( (vp.srcX - gridOffsetX + vp.srcW + gridSize * 2) / colStep);
    const rowMin = Math.floor((vp.srcY - gridOffsetY - hh) / hh);
    const rowMax = Math.ceil( (vp.srcY - gridOffsetY + vp.srcH + hh) / hh);
    ctx.beginPath();
    for (let col = colMin; col <= colMax; col++) {
      for (let row = rowMin; row <= rowMax; row++) {
        const cx = gridOffsetX + col * colStep;
        const cy = gridOffsetY + row * hh + (col & 1) * hh / 2;
        for (let k = 0; k < 6; k++) {
          const angle = Math.PI / 3 * k;
          const px = vp.dstX + (cx + gridSize * Math.cos(angle) - vp.srcX) * scale;
          const py = vp.dstY + (cy + gridSize * Math.sin(angle) - vp.srcY) * scale;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
      }
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
  if (isPlayer || !gridEnabled) return;
  drawGridLines(gridCtx, vp);
}

function renderPlayerGrid(vp) {
  if (!playerGridCtx) return;
  playerGridCtx.clearRect(0, 0, vp.cw, vp.ch);
  if (!gridEnabled) return;
  drawGridLines(playerGridCtx, vp);
}

// ─── Config serialization ─────────────────────────────────────────────────────
function captureGridConfig() {
  return { enabled: gridEnabled, cellSize: gridSize, offsetX: gridOffsetX, offsetY: gridOffsetY, color: gridColor, opacity: gridOpacity, mode: gridMode, lineWidth: gridLineWidth };
}

function applyGridConfig(cfg) {
  if (!cfg) return;
  gridEnabled   = cfg.enabled   ?? gridEnabled;
  gridSize      = cfg.cellSize  ?? gridSize;
  gridOffsetX   = cfg.offsetX   ?? gridOffsetX;
  gridOffsetY   = cfg.offsetY   ?? gridOffsetY;
  gridColor     = cfg.color     ?? gridColor;
  gridOpacity   = cfg.opacity   ?? gridOpacity;
  gridMode      = cfg.mode      ?? gridMode;
  gridLineWidth = cfg.lineWidth ?? gridLineWidth;
  if (!isPlayer) {
    document.getElementById('btn-grid').classList.toggle('active', gridEnabled);
    document.getElementById('grid-size').value                = gridSize;
    document.getElementById('grid-size-num').value            = gridSize;
    document.getElementById('grid-offset-x').value            = gridOffsetX;
    document.getElementById('grid-offset-x-num').value        = gridOffsetX;
    document.getElementById('grid-offset-y').value            = gridOffsetY;
    document.getElementById('grid-offset-y-num').value        = gridOffsetY;
    document.getElementById('grid-color').value               = gridColor;
    document.getElementById('grid-opacity').value             = Math.round(gridOpacity * 100);
    document.getElementById('grid-opacity-num').value         = Math.round(gridOpacity * 100);
    document.getElementById('grid-thickness').value           = gridLineWidth;
    document.getElementById('grid-thickness-num').value       = gridLineWidth;
    document.querySelectorAll('.grid-mode-btn').forEach(b => b.classList.remove('active'));
    const mk = gridMode === 'square' ? 'sq' : gridMode === 'hex-flat' ? 'hflat' : 'hptop';
    document.getElementById('btn-grid-' + mk).classList.add('active');
  }
  gridDirty = true;
}

// ─── Node.js export guard (unit tests only) ──────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { lineWidthForZoom };
}
