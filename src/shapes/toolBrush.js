'use strict';
// toolBrush.js — the fog brush: the strokes queued while the pointer moves, and the one pass that
// paints them into the fog canvases.

// ─── Brush flush ──────────────────────────────────────────────────────────────

function flushBrushOps() {
  if (!pendingBrushOps.length || !fogDataCtx) return;
  const ops = pendingBrushOps;
  pendingBrushOps = [];

  const mapRadius = (brushSize / 2) / zoom;
  const r         = mapRadius / FOG_SCALE;
  const mode      = ops[0].mode;

  const applyBrushToCtx = (ctx) => {
    ctx.save();
    ctx.beginPath();
    let minFX = Infinity, minFY = Infinity, maxFX = -Infinity, maxFY = -Infinity;
    for (const op of ops) {
      const dist  = Math.hypot(op.x2 - op.x1, op.y2 - op.y1);
      const steps = Math.max(1, Math.floor(dist / (mapRadius / 4)));
      for (let i = 0; i <= steps; i++) {
        const t  = i / steps;
        const fx = (op.x1 + (op.x2 - op.x1) * t) / FOG_SCALE;
        const fy = (op.y1 + (op.y2 - op.y1) * t) / FOG_SCALE;
        ctx.moveTo(fx + r, fy);
        ctx.arc(fx, fy, r, 0, Math.PI * 2);
        if (mode === 'reveal') {
          if (fx - r < minFX) minFX = fx - r;
          if (fy - r < minFY) minFY = fy - r;
          if (fx + r > maxFX) maxFX = fx + r;
          if (fy + r > maxFY) maxFY = fy + r;
        }
      }
    }
    if (mode === 'reveal') {
      ctx.clip();
      ctx.clearRect(minFX, minFY, maxFX - minFX, maxFY - minFY);
    } else {
      ctx.fillStyle = '#1a1a2e';
      ctx.fill();
    }
    ctx.restore();
  };

  applyBrushToCtx(fogDataCtx);
  if (baseFogCtx) applyBrushToCtx(baseFogCtx);
  fogDirty = true;
}

// The press itself paints: a click with no movement still clears a circle of fog.
function toolBrushStart(pos) {
  pushUndo();
  fogModifiedThisStroke = true;
  const mapRadius = (brushSize / 2) / zoom;
  if (tool === 'reveal') revealCircle(pos.x, pos.y, mapRadius);
  else                   shroudCircle(pos.x, pos.y, mapRadius);
  lastMapX = pos.x; lastMapY = pos.y;
  fogDirty = true;
  scheduleRender();
}

// Queued, never painted here. flushBrushOps lays the whole stroke down in one pass.
function toolBrushMove(pos) {
  pendingBrushOps.push({ x1: lastMapX, y1: lastMapY, x2: pos.x, y2: pos.y, mode: tool });
  lastMapX = pos.x; lastMapY = pos.y;
}
