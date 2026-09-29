'use strict';
// mapTurn.js — My seat, the DM window only (docs/ARCHITECTURE.md).
//
// ⚠ TWO COORDINATE SPACES. Drawing code works in VIEW space, the turned canvas's own pixels, and
// never converts. A mouse event or a panel placed beside the map is in CLIENT space, where the
// container sits upright; that code converts through here or lands a quarter turn off.

const SEAT_TURN_KEY = 'evermist.seatTurn';
const SEAT_TURNS = [0, 90, 180, 270];

// ─── Pure ─────────────────────────────────────────────────────────────────────

function seatSideways(deg) { return deg === 90 || deg === 270; }

// A vector as the screen shows it once the view is turned `deg` clockwise (y points down).
function turnVec(x, y, deg) {
  switch (deg) {
    case 90:  return { x: -y, y:  x };
    case 180: return { x: -x, y: -y };
    case 270: return { x:  y, y: -x };
    default:  return { x, y };
  }
}

function unturn(deg) { return (360 - deg) % 360; }

// Both boxes share a centre: the turned canvas is centred on the container it fills.
function containerToView(px, py, deg, vw, vh, cw, ch) {
  const d = turnVec(px - cw / 2, py - ch / 2, unturn(deg));
  return { x: d.x + vw / 2, y: d.y + vh / 2 };
}

function viewToContainer(x, y, deg, vw, vh, cw, ch) {
  const d = turnVec(x - vw / 2, y - vh / 2, deg);
  return { x: d.x + cw / 2, y: d.y + ch / 2 };
}

// A shape as the screen shows it, handles included. An additive spread, so no field is dropped.
function turnShape(poly, deg) {
  const pt = v => ({ ...v, ...turnVec(v.x, v.y, deg) });
  const out = { ...poly, vertices: poly.vertices.map(pt) };
  if (poly.holes) out.holes = poly.holes.map(r => r && r.map(pt));
  if (poly.handles) {
    out.handles = poly.handles.map(h => {
      if (!h) return h;
      const i = turnVec(h.ix || 0, h.iy || 0, deg), o = turnVec(h.ox || 0, h.oy || 0, deg);
      return { ...h, ix: i.x, iy: i.y, ox: o.x, oy: o.y };
    });
  }
  return out;
}

const _SEAT_CURSOR_SWAP = { 'nwse-resize': 'nesw-resize', 'nesw-resize': 'nwse-resize' };
function turnCursor(c, deg) { return (seatSideways(deg) && _SEAT_CURSOR_SWAP[c]) || c; }

// ─── The DM window ────────────────────────────────────────────────────────────

function mapAreaSize() {
  const cw = container.clientWidth, ch = container.clientHeight;
  return seatSideways(seatTurn) ? { w: ch, h: cw } : { w: cw, h: ch };
}

// ⚠ The layout size, never the rect's: the turned canvases are laid out from clientWidth, and the
// rect's fractional width would shift every point by up to half a pixel.
function clientToView(clientX, clientY) {
  const r = container.getBoundingClientRect();
  const px = clientX - r.left, py = clientY - r.top;
  if (!seatTurn) return { x: px, y: py };
  const a = mapAreaSize();
  return containerToView(px, py, seatTurn, a.w, a.h, container.clientWidth, container.clientHeight);
}

function viewToClient(x, y) {
  const r = container.getBoundingClientRect();
  const a = mapAreaSize();
  const p = seatTurn ? viewToContainer(x, y, seatTurn, a.w, a.h, container.clientWidth, container.clientHeight)
                     : { x, y };
  return { x: p.x + r.left, y: p.y + r.top };
}

// A view-space box as the client-space box around it.
function viewRectToClient(x, y, w, h) {
  const p = viewToClient(x, y), q = viewToClient(x + w, y + h);
  return { left: Math.min(p.x, q.x), top: Math.min(p.y, q.y),
           right: Math.max(p.x, q.x), bottom: Math.max(p.y, q.y) };
}

function turnDelta(dx, dy) { return turnVec(dx, dy, unturn(seatTurn)); }

// Turns the context back about (x, y), so what is drawn next reads upright on screen.
function uprightAt(ctx, x, y) {
  if (!seatTurn) return;
  ctx.translate(x, y);
  ctx.rotate(-seatTurn * Math.PI / 180);
  ctx.translate(-x, -y);
}

// The DM's animated map is a <video> in the container, not a canvas, so it carries the turn itself.
function seatTurnCss() {
  if (!seatTurn) return '';
  const a = mapAreaSize();
  return 'translate(' + container.clientWidth / 2 + 'px,' + container.clientHeight / 2 + 'px) rotate(' +
         seatTurn + 'deg) translate(' + (-a.w / 2) + 'px,' + (-a.h / 2) + 'px) ';
}

// The CSS the turned canvases are laid out by. Called from syncSize, so a window resize keeps it.
function seatTurnLayout() {
  container.classList.toggle('seat-turned', seatTurn !== 0);
  if (!seatTurn) return;
  const cw = container.clientWidth, ch = container.clientHeight, a = mapAreaSize();
  const s = container.style;
  s.setProperty('--seat-w', a.w + 'px');
  s.setProperty('--seat-h', a.h + 'px');
  s.setProperty('--seat-l', (cw - a.w) / 2 + 'px');
  s.setProperty('--seat-t', (ch - a.h) / 2 + 'px');
  s.setProperty('--seat-a', seatTurn + 'deg');
}

// ⚠ CAPTURE BEFORE syncSize, which is what swaps the view's width and height.
function applySeatTurn() {
  const mini = document.getElementById('minimap-canvas');
  if (mini) mini.style.transform = seatTurn ? 'rotate(' + seatTurn + 'deg)' : '';
  // The shell's own map is hidden behind the columns; each column turns its own.
  if (paneBroadcast('seat-turn', { deg: seatTurn })) return;
  const held = mapWidth > 0 ? captureCamera() : null;
  syncSize();
  if (held) applyCamera(held);
  else pixiSetViewport(zoom, panX, panY);
  if (typeof syncVideoDomTransform === 'function') syncVideoDomTransform();
  viewportDirty = true;
  gridDirty = true;
  scheduleRender();
  // The pointer's last spot was measured in the old view.
  lastScreenX = lastScreenY = null;
  drawCursor(null, null);
}

function setSeatTurn(deg) {
  if (!SEAT_TURNS.includes(deg) || deg === seatTurn) return;
  seatTurn = deg;
  try { localStorage.setItem(SEAT_TURN_KEY, String(deg)); } catch (e) {}
  applySeatTurn();
}

function initSeatTurn() {
  if (isPlayer) return;
  let saved = 0;
  try { saved = parseInt(localStorage.getItem(SEAT_TURN_KEY), 10) || 0; } catch (e) {}
  if (!SEAT_TURNS.includes(saved) || !saved) return;
  seatTurn = saved;
  applySeatTurn();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { turnVec, containerToView, viewToContainer, turnShape, turnCursor, seatSideways };
}
