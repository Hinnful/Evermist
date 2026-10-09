'use strict';
// cornerGeometry.js — pure kernel for rounding a corner by hand on the map. Tested.

const CORNER_MIN_TURN = 25 * Math.PI / 180;   // a corner turning less shows no circle: a circle's or an arc's own points

function cornerRadiusAt(poly, flat) {
  const v = poly.cornerRadii ? poly.cornerRadii[flat] : null;
  return v != null ? v : (poly.cornerRadius || 0);
}

// computeFillet's own clamp.
function cornerMaxRadius(verts, i) {
  const n = verts.length, v = verts[i], p = verts[(i - 1 + n) % n], q = verts[(i + 1) % n];
  return Math.min(Math.hypot(v.x - p.x, v.y - p.y), Math.hypot(q.x - v.x, q.y - v.y)) / 2;
}

// `inset` keeps the circle off the corner's own dot while the fillet centre is nearer than that.
function cornerHandle(verts, handles, offset, i, r, inset, open) {
  const n = verts.length;
  if (n < 3 || (open && (i === 0 || i === n - 1))) return null;   // an open line's ends have no corner
  const wrap = k => ((k % n) + n) % n;
  const at = k => verts[wrap(k)];
  const curvedWall = k => edgeIsCurved(handles, offset + wrap(k), offset + wrap(k + 1));
  const wallCubic = k => edgeCubic(at(k), at(k + 1), handleAt(handles, offset + wrap(k)),
                                   handleAt(handles, offset + wrap(k + 1)));
  const maxR = cornerMaxRadius(verts, i);
  // A tiny fillet gives each wall's direction at the corner, a curved one included.
  const probe = computeFillet(at, curvedWall, wallCubic, () => maxR * 0.25, i);
  if (!probe) return null;
  const v = at(i);
  const ua = unitVec(probe.start.x - v.x, probe.start.y - v.y);
  const ub = unitVec(probe.end.x - v.x, probe.end.y - v.y);
  const turn = Math.PI - Math.acos(Math.max(-1, Math.min(1, ua.x * ub.x + ua.y * ub.y)));
  if (turn < CORNER_MIN_TURN) return null;
  const toCentre = Math.hypot(probe.cx - v.x, probe.cy - v.y);
  const dir = unitVec(probe.cx - v.x, probe.cy - v.y);
  const sinH = probe.radius / toCentre;
  // ⚠ A REFLEX CORNER'S FILLET CENTRE IS OUTSIDE THE SHAPE: its circle sits inside, dragged the other way.
  const cross = (v.x - at(i - 1).x) * (at(i + 1).y - v.y) - (v.y - at(i - 1).y) * (at(i + 1).x - v.x);
  if (!open && Math.sign(cross) !== polygonWindingSign(verts)) {
    return { x: v.x - dir.x * inset, y: v.y - dir.y * inset, dir: { x: -dir.x, y: -dir.y }, sinH, maxR };
  }
  const f = r > 0 ? computeFillet(at, curvedWall, wallCubic, () => r, i) : null;
  const d = Math.max(inset, f ? Math.hypot(f.cx - v.x, f.cy - v.y) : 0);
  return { x: v.x + dir.x * d, y: v.y + dir.y * d, dir, sinH, maxR };
}

function unitVec(x, y) { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; }

function cornerDragRadius(h, r0, along) {
  return Math.round(Math.max(0, Math.min(h.maxR, r0 + along * h.sinH)));
}

// Figma's drag-all: corners set one by one go with it.
function setAllCornerRadii(poly, r) {
  poly.cornerRadius = r;
  delete poly.cornerRadii;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { cornerRadiusAt, cornerMaxRadius, cornerHandle, cornerDragRadius, setAllCornerRadii,
                     CORNER_MIN_TURN };
}
