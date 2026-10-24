'use strict';
// toolPreset.js — effect presets: the outline that follows the pointer, the wheel and [ ] through the
// sizes, and the click or aiming drag that places one. The size field is effectsRow.js's.

// Line, Wall and Ring have no hand tool, so picking one arms a size straight away, in feet.
const PRESET_DEFAULT = { line: 60, wall: 30, ring: 20 };
const PRESET_AIMS = { cone: true, line: true, wall: true };
let _presetShift = false;
document.addEventListener('keydown', e => { if (e.key === 'Shift' && !isPlayer) { _presetShift = true; drawCursor(lastScreenX, lastScreenY); } });
document.addEventListener('keyup',   e => { if (e.key === 'Shift' && !isPlayer) { _presetShift = false; drawCursor(lastScreenX, lastScreenY); } });

// One grid cell is 5 ft. A square cell is gridSize across; a hex cell's gridSize is its corner radius,
// so the cell is gridSize * sqrt(3) across the flats (grid.js).
function presetPxPerFt() { return (gridMode === 'square' ? gridSize : gridSize * Math.sqrt(3)) / 5; }

function presetForShape(s) {
  const list = EFFECT_PRESETS[s];
  return list && PRESET_DEFAULT[s] != null ? { kind: s, ...list.find(z => z.s === PRESET_DEFAULT[s]) } : null;
}

function setPreset(p) {
  paneBroadcast('preset', { preset: p });
  presetArmed = p;
  if (p) effectsSize = p.s;
  refreshPresetRow();
  drawCursor(lastScreenX, lastScreenY);
}

// A column that changed its own preset tells the shell, which repaints its row and the other column.
function reportPaneTool() {
  if (typeof isPane === 'undefined' || !isPane || parent === window) return;
  parent.postMessage({ type: 'pane-tool', pane: paneId, shape, preset: presetArmed, placeMode }, '*');
}

// One grid square a step, stopping at both ends. A shape with a hand tool has one step below the
// smallest size, which is drawing it by hand; the wheel passes `stayArmed` and never takes that step.
function stepPreset(dir, stayArmed) {
  const kind = presetArmed ? presetArmed.kind : shape;
  const list = EFFECT_PRESETS[kind];
  if (!list) return;
  const i = presetArmed ? list.findIndex(z => z.s === presetArmed.s && z.w === presetArmed.w) : -1;
  const j = stepPresetIndex(i, list.length, dir, !!PRESET_HAS_HAND[kind] && !stayArmed);
  setPreset(j < 0 ? null : { kind, ...list[j] });
  reportPaneTool();
}

// [ and ] step the size of the shape in hand; with no size to step they belong to the brush.
function stepPresetKey(dir) {
  if (placeMode !== 'effects' || !EFFECT_PRESETS[shape]) return false;
  stepPreset(dir);
  return true;
}

// Escape puts an armed size down: back to Select, the mode stays (effectsTool.js owns leaving it).
function dropPreset() {
  if (!presetArmed) return false;
  setShape('select');
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
    // The Light material places a light where any other places a fire.
    placed = currentMaterial === 'light' ? addLightShape(r.vertices) : addEffect(r.vertices);
    if (r.holes) { setShapeHoles(placed, r.holes); shapeListChanged('effects'); }
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
  const o = toS(origin);
  // Screen-up in the turned canvas: the plate sits above the shape as the DM sees it, and upright.
  const th = -seatTurn * Math.PI / 180, ux = Math.sin(th), uy = -Math.cos(th);
  let reach = 0;
  for (const ring of [r.vertices].concat(r.holes || [])) {
    ring.forEach((v, i) => { const s = toS(v); reach = Math.max(reach, (s.x - o.x) * ux + (s.y - o.y) * uy); if (i) c.lineTo(s.x, s.y); else c.moveTo(s.x, s.y); });
    c.closePath();
  }
  c.fillStyle = `rgba(${effectPreviewRgb()},0.09)`;
  c.fill('evenodd');
  c.strokeStyle = effectPreviewEdge();
  c.lineWidth = 1.5;
  c.setLineDash([4, 3]);
  c.stroke();
  c.setLineDash([]);
  c.fillStyle = 'rgba(255,255,255,0.6)';
  c.beginPath(); c.arc(o.x, o.y, 2.5, 0, Math.PI * 2); c.fill();

  const px = o.x + ux * (reach + 16);
  const y = seatTurn ? o.y + uy * (reach + 16) : Math.max(14, o.y + uy * (reach + 16));
  drawLabelPlate(c, px, y, presetLabel(p.kind, p.s, p.w, t));
  c.restore();
}
