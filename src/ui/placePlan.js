'use strict';
// placePlan.js — pure kernel of where a floating surface stands (place.js applies it): its own side of its anchor,
// else the opposite side, else the side with more room, pinned inside the margin with a max height so it scrolls.
// Boxes are screen px {left, top, right, bottom}; a point is a box of no size. No DOM, so it is unit-tested.

// Along one axis: the start of a surface `size` long beside the span [lo, hi] on side `after` (true: past hi),
// inside [min, max]. Answers { at, cap, after }: cap is the room left when the surface does not fit either side.
function _placeAxis(lo, hi, size, min, max, gap, after) {
  const roomAfter = max - (hi + gap), roomBefore = (lo - gap) - min;
  const own = after ? roomAfter : roomBefore, other = after ? roomBefore : roomAfter;
  // An anchor past the view's edge still leaves the surface inside it.
  const at = a => Math.max(min, Math.min(max - size, a ? hi + gap : lo - gap - size));
  if (size <= own) return { at: at(after), cap: null, after };
  if (size <= other) return { at: at(!after), cap: null, after: !after };
  const more = roomAfter >= roomBefore;
  // Too little room either side for even a short list: it covers the anchor and takes the whole window's height.
  if (Math.max(roomAfter, roomBefore) < Math.min(size, PLACE_MIN_ROOM)) return { at: min, cap: Math.max(0, max - min), after };
  return more ? { at: hi + gap, cap: roomAfter, after: true } : { at: min, cap: roomBefore, after: false };
}

// Across: aligned to the anchor's start, centre or end, then slid inside [min, max]; one wider than the room is
// pinned at min and capped.
function _placeCross(lo, hi, size, min, max, align) {
  let at = align === 'center' ? (lo + hi) / 2 - size / 2 : align === 'end' ? hi - size : lo;
  if (size > max - min) return { at: min, cap: max - min };
  at = Math.max(min, Math.min(max - size, at));
  return { at, cap: null };
}

const PLACE_MIN_ROOM = 120;   // the least room a pinned list scrolls in before it covers its anchor instead

// anchor: the box it opens from. size: {width, height}. view: the box it must stay inside. opts: side (above,
// below, right or left), gap between anchor and surface, margin from the view's edges (8), align across
// (start, center or end). Answers { left, top, maxHeight, maxWidth, side }; a max is null when nothing is capped.
function placePlan(anchor, size, view, opts) {
  const o = opts || {}, side = o.side || 'below', gap = o.gap || 0, m = o.margin == null ? 8 : o.margin;
  const vert = side === 'above' || side === 'below';
  const minX = view.left + m, maxX = view.right - m, minY = view.top + m, maxY = view.bottom - m;
  if (vert) {
    const main = _placeAxis(anchor.top, anchor.bottom, size.height, minY, maxY, gap, side === 'below');
    const cross = _placeCross(anchor.left, anchor.right, size.width, minX, maxX, o.align || 'start');
    return { left: cross.at, top: main.at, maxHeight: main.cap, maxWidth: cross.cap, side: main.after ? 'below' : 'above' };
  }
  const main = _placeAxis(anchor.left, anchor.right, size.width, minX, maxX, gap, side === 'right');
  const cross = _placeCross(anchor.top, anchor.bottom, size.height, minY, maxY, o.align || 'start');
  return { left: main.at, top: cross.at, maxHeight: cross.cap, maxWidth: main.cap, side: main.after ? 'right' : 'left' };
}

// A free window pulled inside the view: its size first (never past the room, never under its own minimum unless the
// room is smaller), then its place, so the header and the resize corner are always on screen. Answers
// { left, top, width, height, maxWidth, maxHeight }: the maxes keep a corner drag inside from where it stands.
function placeWindowFit(box, view, opts) {
  const o = opts || {}, m = o.margin == null ? 8 : o.margin;
  const roomW = view.right - view.left - 2 * m, roomH = view.bottom - view.top - 2 * m;
  const width = Math.min(Math.max(box.width, Math.min(o.minWidth || 0, roomW)), roomW);
  const height = Math.min(Math.max(box.height, Math.min(o.minHeight || 0, roomH)), roomH);
  const left = Math.max(view.left + m, Math.min(view.right - m - width, box.left));
  const top = Math.max(view.top + m, Math.min(view.bottom - m - height, box.top));
  return { left, top, width, height, maxWidth: view.right - m - left, maxHeight: view.bottom - m - top };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { placePlan, placeWindowFit, PLACE_MIN_ROOM };
}
