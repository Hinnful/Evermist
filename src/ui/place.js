// place.js — a floating surface placed beside its anchor by placePlan.js, and placed again on every window resize
// while it is open, so a smaller window brings it back inside.

const _placed = new Map();   // surface → { anchor, opts } it was last placed with

// An element, a box, a point {x, y} or a function answering one, as a screen box.
function _placeBox(a) {
  if (typeof a === 'function') a = a();
  if (!a) return null;
  if (a.getBoundingClientRect) a = a.getBoundingClientRect();
  if (a.left === undefined) return { left: a.x, top: a.y, right: a.x, bottom: a.y };
  return { left: a.left, top: a.top, right: a.right !== undefined ? a.right : a.left + (a.width || 0),
    bottom: a.bottom !== undefined ? a.bottom : a.top + (a.height || 0) };
}

// Writes the place in the surface's own style px (it may carry the UI zoom), with a max height and its own scroll
// when it is capped. opts: placePlan's, plus `view` (a box or a function answering one; the window by default).
function placeSurface(el, anchor, opts) {
  const o = opts || {}, a = _placeBox(anchor);
  if (!el || !a) return null;
  Object.assign(el.style, { left: '0px', top: '0px', maxHeight: '', maxWidth: '', overflowY: '' });
  const b = el.getBoundingClientRect();
  const v = typeof o.view === 'function' ? o.view() : o.view;
  const p = placePlan(a, { width: b.width, height: b.height }, v || { left: 0, top: 0, right: innerWidth, bottom: innerHeight }, o);
  const st = _rpScreenToStyle(el, p.left, p.top), z = el.currentCSSZoom || 1;
  el.style.left = st.left + 'px';
  el.style.top = st.top + 'px';
  if (p.maxHeight != null) { el.style.maxHeight = p.maxHeight / z + 'px'; el.style.overflowY = 'auto'; }
  if (p.maxWidth != null) el.style.maxWidth = p.maxWidth / z + 'px';
  _placed.set(el, { anchor, opts: o });
  return p;
}

// The top of the highest bar shown at the bottom of the DM window (the Effects or edit row, the toolbar), or the
// window's bottom: a surface under them is hidden, since they stand over the map's popups.
function placeFloor() {
  let y = innerHeight;
  for (const id of ['context-row', 'edit-row', 'toolbar-bottom']) {
    const b = document.getElementById(id), r = b && b.getClientRects().length ? b.getBoundingClientRect() : null;
    if (r && r.height) y = Math.min(y, r.top);
  }
  return y;
}

window.addEventListener('resize', () => {
  for (const [el, rec] of _placed) {
    if (!motionOpen(el)) { _placed.delete(el); continue; }
    motionSettle(el);   // an opening surface is still scaled down, so it would be measured short
    placeSurface(el, rec.anchor, rec.opts);
  }
});
