'use strict';
// toolPreset.js — effect presets: the size row in #context-row, the outline that follows the
// pointer, the wheel through the sizes, and the click or aiming drag that places one.

// Line and Ring have no hand tool, so picking one arms a size straight away.
const PRESET_DEFAULT = { line: 1, ring: 0 };
const PRESET_AIMS = { cone: true, line: true };
let _presetShift = false;
document.addEventListener('keydown', e => { if (e.key === 'Shift' && !isPlayer) { _presetShift = true; drawCursor(lastScreenX, lastScreenY); } });
document.addEventListener('keyup',   e => { if (e.key === 'Shift' && !isPlayer) { _presetShift = false; drawCursor(lastScreenX, lastScreenY); } });

function presetPxPerFt() { return gridSize / 5; }

function presetForShape(s) {
  const list = EFFECT_PRESETS[s];
  return list && PRESET_DEFAULT[s] != null ? { kind: s, ...list[PRESET_DEFAULT[s]] } : null;
}

function setPreset(p) {
  paneBroadcast('preset', { preset: p });
  presetArmed = p;
  refreshPresetRow();
  drawCursor(lastScreenX, lastScreenY);
}

// A column that changed its own preset tells the shell, which repaints its row and the other column.
function reportPaneTool() {
  if (typeof isPane === 'undefined' || !isPane || parent === window) return;
  parent.postMessage({ type: 'pane-tool', pane: paneId, shape, preset: presetArmed }, '*');
}

// The row's look is settled in docs/decisions/ui-and-control-panel.md.
function refreshPresetRow() {
  const row = document.getElementById('ctx-presets');
  if (!row) return;
  const list = placeMode === 'effects' ? EFFECT_PRESETS[shape] : null;
  if (!list) { row.innerHTML = ''; row.dataset.kind = ''; return; }
  if (row.dataset.kind !== shape) {
    row.innerHTML = '';
    row.dataset.kind = shape;
    if (PRESET_DEFAULT[shape] == null) {
      const hand = document.createElement('button');
      hand.className = 'mode-btn';
      hand.dataset.preset = 'hand';
      hand.title = 'Draw it by hand';
      hand.innerHTML = document.getElementById('btn-' + shape).innerHTML;
      const svg = hand.querySelector('svg');
      if (svg) svg.setAttribute('stroke-dasharray', '2.6 2.4');
      hand.onclick = () => setPreset(null);
      row.appendChild(hand);
    }
    list.forEach((z, i) => {
      const b = document.createElement('button');
      b.className = 'mode-btn';
      b.dataset.preset = String(i);
      b.textContent = z.w ? z.s + '×' + z.w : String(z.s);
      b.title = presetLabel(shape, z.s, z.w);
      b.onclick = () => setPreset({ kind: row.dataset.kind, ...z });
      row.appendChild(b);
    });
  }
  const on = presetArmed ? String(list.findIndex(z => z.s === presetArmed.s && z.w === presetArmed.w)) : 'hand';
  row.querySelectorAll('[data-preset]').forEach(b => b.classList.toggle('active', b.dataset.preset === on));
}

// The wheel steps through the list and wraps at both ends; up is the next size.
function stepPreset(dir) {
  const list = EFFECT_PRESETS[presetArmed.kind];
  const i = list.findIndex(z => z.s === presetArmed.s && z.w === presetArmed.w);
  setPreset({ kind: presetArmed.kind, ...list[stepPresetIndex(Math.max(0, i), list.length, dir)] });
  reportPaneTool();
}

// Escape drops the size. A shape with no hand tool goes back to Select with it.
function dropPreset() {
  if (!presetArmed) return false;
  if (PRESET_DEFAULT[shape] != null) setShape('select'); else setPreset(null);
  reportPaneTool();
  return true;
}

function _presetAngle(origin, pos, snap) {
  if (!PRESET_AIMS[presetArmed.kind] || Math.hypot(pos.x - origin.x, pos.y - origin.y) * zoom < 4) return 0;
  let a = Math.atan2(pos.y - origin.y, pos.x - origin.x);
  if (snap) { const step = CONE_SNAP_DEG * Math.PI / 180; a = Math.round(a / step) * step; }
  return a;
}

function toolPresetStart(pos) {
  presetPress = { x: pos.x, y: pos.y };
}

function toolPresetFinish(pos, e) {
  if (!presetPress || !presetArmed) return;
  const origin = presetPress;
  presetPress = null;
  const p = presetArmed;
  const r = presetRings(p.kind, p.s, p.w, origin, _presetAngle(origin, pos, axisLock || e.shiftKey), presetPxPerFt());
  let placed = null;
  if (shapeOp === 'new') {
    placed = addEffect(r.vertices);
    if (r.holes) { setShapeHoles(placed, r.holes); effectsChanged(); }
  } else {
    commitClosedShape(r.vertices);
  }
  setShape('select');
  if (placed) selectedPolygonId = placed.id;
  reportPaneTool();
  drawCursor(lastScreenX, lastScreenY);
}

function drawPresetPreview(sx, sy) {
  const p = presetArmed;
  const pos = { x: (sx - panX) / zoom, y: (sy - panY) / zoom };
  const origin = presetPress || pos;
  const r = presetRings(p.kind, p.s, p.w, origin,
    presetPress ? _presetAngle(origin, pos, axisLock || _presetShift) : 0, presetPxPerFt());
  const toS = v => ({ x: v.x * zoom + panX, y: v.y * zoom + panY });
  const c = cursorCtx;
  c.save();
  c.beginPath();
  let top = Infinity;
  for (const ring of [r.vertices].concat(r.holes || [])) {
    ring.forEach((v, i) => { const s = toS(v); top = Math.min(top, s.y); if (i) c.lineTo(s.x, s.y); else c.moveTo(s.x, s.y); });
    c.closePath();
  }
  c.fillStyle = `rgba(${EFFECT_RGB},0.09)`;
  c.fill('evenodd');
  c.strokeStyle = EFFECT_EDGE_COLOR;
  c.lineWidth = 1.5;
  c.setLineDash([4, 3]);
  c.stroke();
  c.setLineDash([]);
  const o = toS(origin);
  c.fillStyle = 'rgba(255,255,255,0.6)';
  c.beginPath(); c.arc(o.x, o.y, 2.5, 0, Math.PI * 2); c.fill();

  const txt = presetLabel(p.kind, p.s, p.w);
  c.font = '600 12px system-ui, -apple-system, sans-serif';
  const w = c.measureText(txt).width + 16, y = Math.max(14, top - 16);
  c.fillStyle = 'rgba(26,26,28,0.92)';
  c.beginPath(); c.roundRect(o.x - w / 2, y - 11, w, 22, 6); c.fill();
  c.fillStyle = '#f0f1f3';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(txt, o.x, y + 0.5);
  c.restore();
}
