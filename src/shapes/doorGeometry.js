// doorGeometry.js — pure geometry kernel for doors: where a notch sits, which wall a point is
// near, and how a door follows its wall when the outline changes. Unit-tested.
// Loaded via <script src> after fogGeometry.js; the require() below runs under Node only.

'use strict';

// ⚠ THE SAMPLE COUNT IS READ, NEVER REDECLARED. `CURVE_SAMPLE_STEPS` is a const in
// fogGeometry.js, so a `var` of that name in this script is a SyntaxError that kills the page.
const _dgSteps = () => (typeof CURVE_SAMPLE_STEPS !== 'undefined' ? CURVE_SAMPLE_STEPS
  : require('../fog/fogGeometry').CURVE_SAMPLE_STEPS);

var getPolyBBox, polyRings, insetPolygon, polygonWindingSign;
var edgeIsCurved, edgeCubic, handleAt, sampleCubic;
if (typeof module !== 'undefined' && module.exports) {
  ({ getPolyBBox, polyRings, insetPolygon, polygonWindingSign,
   edgeIsCurved, edgeCubic, handleAt, sampleCubic } = require('../fog/fogGeometry'));
}

// ─── Door notches ─────────────────────────────────────────────────────────────
// A door marks an exit on a room's outline, stored as {edge, t}: which wall, and where along it.
// It carries no size — width and depth come from the grid cell at draw time, so correcting a
// scene's grid resizes every door already placed. The notch straddles its wall, reaching the same
// distance either side, which frees it from the outline's winding and from which side was traced.

const DOOR_AXIS_EPS = 0.999;   // above this a wall counts as straight, so it snaps to the world grid

function doorSizeForCell(cell, widthPct, depthPct) {
  const c = cell > 0 ? cell : 0;
  return { width: c * (widthPct / 100), depth: c * (depthPct / 100) };
}


// Outward unit normal of edge i, i.e. the opposite of the direction insetPolygon moves a vertex.
function edgeOutwardNormal(verts, edge) {
  const a = verts[edge % verts.length], b = verts[(edge + 1) % verts.length];
  const ex = b.x - a.x, ey = b.y - a.y;
  const len = Math.hypot(ex, ey) || 1;
  const sign = polygonWindingSign(verts);
  return { x: sign * ey / len, y: -sign * ex / len };
}

// The ring a FLAT edge number lands on, which is what lets a door mark an inner wall.
function edgeRingRef(src, edge) {
  const rings = Array.isArray(src) ? [src] : polyRings(src);
  let total = 0;
  for (const r of rings) total += (r ? r.length : 0);
  if (!total) return null;
  let k = ((edge | 0) % total + total) % total;
  for (let r = 0; r < rings.length; r++) {
    const verts = rings[r];
    if (!verts || !verts.length) continue;
    if (k < verts.length) return { ring: r, verts, i: k, flat: ((edge | 0) % total + total) % total };
    k -= verts.length;
  }
  return null;
}

// The wall a door sits on: its endpoints, unit direction, outward normal and length. `ei` is the
// FLAT edge number, which is what a stored door carries.
// ⚠ A HOLE'S NORMAL IS FLIPPED: out of the ROOM at an inner wall points into the hole.
function doorEdgeFrame(src, edge) {
  const ref = edgeRingRef(src, edge);
  if (!ref || ref.verts.length < 3) return null;
  const verts = ref.verts;
  const n = verts.length;
  const a = verts[ref.i], b = verts[(ref.i + 1) % n];
  const ex = b.x - a.x, ey = b.y - a.y;
  const chord = Math.hypot(ex, ey);
  if (!(chord > 0)) return null;
  const nrm = edgeOutwardNormal(verts, ref.i);
  const flip = ref.ring > 0 ? -1 : 1;
  const f = { ei: ref.flat, a, b, len: chord, ux: ex / chord, uy: ey / chord,
              n: { x: nrm.x * flip, y: nrm.y * flip } };
  // A BENT WALL CARRIES ITS OWN ARC. A door's `t` is a fraction of the wall's real length, so
  // without this the notch slides along the chord and leaves the wall it was placed on.
  const handles = Array.isArray(src) ? null : src.handles;
  const flatB = ref.flat - ref.i + ((ref.i + 1) % n);
  if (handles && edgeIsCurved(handles, ref.flat, flatB)) {
    const c = edgeCubic(a, b, handleAt(handles, ref.flat), handleAt(handles, flatB));
    const pts = [a].concat(sampleCubic(c[0], c[1], c[2], c[3], _dgSteps() * 2));
    const cum = [0];
    for (let k = 1; k < pts.length; k++) {
      cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
    }
    if (cum[cum.length - 1] > 0) { f.len = cum[cum.length - 1]; f.arc = { pts, cum }; }
  }
  return f;
}

// Where a door sits on its wall and which way the wall runs there. A straight wall answers from
// its two endpoints; a bent one walks its sampled arc, so the notch turns with the curve.
function doorFramePoint(f, t) {
  const u = Math.max(0, Math.min(1, t));
  if (!f.arc) {
    return { x: f.a.x + (f.b.x - f.a.x) * u, y: f.a.y + (f.b.y - f.a.y) * u,
             ux: f.ux, uy: f.uy, nx: f.n.x, ny: f.n.y };
  }
  const pts = f.arc.pts, cum = f.arc.cum;
  const want = u * f.len;
  let k = 1;
  while (k < cum.length - 1 && cum[k] < want) k++;
  const seg = (cum[k] - cum[k - 1]) || 1;
  const along = (want - cum[k - 1]) / seg;
  const p0 = pts[k - 1], p1 = pts[k];
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const d = Math.hypot(dx, dy) || 1;
  // The local normal turns with the wall, and KEEPS THE SIDE the straight frame chose: a curve can
  // reverse the sign of its own perpendicular, which would carve the notch into the room.
  const sgn = ((-dy / d) * f.n.x + (dx / d) * f.n.y) >= 0 ? 1 : -1;
  return { x: p0.x + dx * along, y: p0.y + dy * along, ux: dx / d, uy: dy / d,
           nx: (-dy / d) * sgn, ny: (dx / d) * sgn };
}

// How far along a wall a map point falls, measured the same way `len` is.
function doorFrameAlong(f, mx, my) {
  if (!f.arc) return (mx - f.a.x) * f.ux + (my - f.a.y) * f.uy;
  const pts = f.arc.pts, cum = f.arc.cum;
  let best = Infinity, at = 0;
  for (let k = 1; k < pts.length; k++) {
    const p0 = pts[k - 1], p1 = pts[k];
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    const q = dx * dx + dy * dy;
    const u = q === 0 ? 0 : Math.max(0, Math.min(1, ((mx - p0.x) * dx + (my - p0.y) * dy) / q));
    const cx = p0.x + dx * u, cy = p0.y + dy * u;
    const d = Math.hypot(mx - cx, my - cy);
    if (d < best) { best = d; at = cum[k - 1] + Math.hypot(cx - p0.x, cy - p0.y); }
  }
  return at;
}

// Where a wall's cell boundaries fall, as distances along it from its start vertex. ONE source for
// both the snap and the ticks the DM sees, so what is drawn is where a door lands.
// A straight wall on a square grid reads the WORLD grid, offsets included, or a room whose corner
// sits off a grid line carries every door off with it. Diagonal and hex walls subdivide themselves.
function doorCellBounds(verts, edge, cell, offsetX, offsetY, squareGrid) {
  const f = doorEdgeFrame(verts, edge);
  if (!f || !(cell > 0)) return null;
  const axis = Math.abs(f.ux) > DOOR_AXIS_EPS || Math.abs(f.uy) > DOOR_AXIS_EPS;
  const at = [0];
  if (squareGrid && axis) {
    // Projecting the grid's origin onto the wall keeps whichever axis the wall runs along and
    // discards the other, so one expression covers horizontal and vertical alike.
    const base = ((offsetX || 0) - f.a.x) * f.ux + ((offsetY || 0) - f.a.y) * f.uy;
    for (let k = Math.ceil(-base / cell); base + k * cell < f.len; k++) {
      const a = base + k * cell;
      if (a > 0) at.push(a);
    }
  } else {
    for (let a = cell; a < f.len; a += cell) at.push(a);
  }
  at.push(f.len);
  return { frame: f, at };
}

// Snaps a click to the cell it landed in, so a door fills that cell.
function doorCellSnap(verts, edge, mx, my, cell, offsetX, offsetY, squareGrid) {
  const b = doorCellBounds(verts, edge, cell, offsetX, offsetY, squareGrid);
  if (!b) return null;
  const f = b.frame;
  const along = Math.max(0, Math.min(f.len, doorFrameAlong(f, mx, my)));
  let i = 0;
  while (i < b.at.length - 2 && along >= b.at[i + 1]) i++;
  const centre = (b.at[i] + b.at[i + 1]) / 2;
  const half = Math.min(cell, f.len) / 2;
  return { edge: f.ei, t: Math.max(half, Math.min(f.len - half, centre)) / f.len };
}

// The four corners of one notch, a plain rectangle straddling the wall, in the space of `verts`.
// The caller passes a deeper inward reach than the shape needs: that ground is already clear, and
// the extra is what makes the notch meet the reveal's ragged edge instead of floating free.
function doorNotchCorners(verts, door, width, out, inward) {
  const f = doorEdgeFrame(verts, door && door.edge);
  if (!f || !(width > 0) || !(out > 0)) return null;
  // Capped at the wall: a cell is wider than a short alcove edge, and an uncapped door would carve
  // fog around both its corners rather than mark an opening in it.
  const hw = Math.min(width, f.len) / 2;
  const back = -(inward > 0 ? inward : out);
  const q = doorFramePoint(f, door.t);
  const px = q.x, py = q.y;
  return {
    outerL: { x: px - q.ux * hw + q.nx * out,  y: py - q.uy * hw + q.ny * out },
    outerR: { x: px + q.ux * hw + q.nx * out,  y: py + q.uy * hw + q.ny * out },
    innerL: { x: px - q.ux * hw + q.nx * back, y: py - q.uy * hw + q.ny * back },
    innerR: { x: px + q.ux * hw + q.nx * back, y: py + q.uy * hw + q.ny * back },
  };
}

// Nearest point on the outline to (mx,my), across every ring, with `edge` the flat number.
// Returns null when nothing is within `maxDist`.
function nearestOutlinePoint(src, mx, my, maxDist) {
  const rings = Array.isArray(src) ? [src] : polyRings(src);
  const handles = Array.isArray(src) ? null : src.handles;
  let best = null, flat = 0;
  for (const verts of rings) {
    if (!verts || verts.length < 2) { flat += verts ? verts.length : 0; continue; }
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i], b = verts[(i + 1) % verts.length];
      const fb = flat + ((i + 1) % verts.length);
      // A BENT WALL answers from its own arc, or a door aimed at a curve snaps to the chord and
      // lands off the wall the DM was pointing at.
      if (handles && edgeIsCurved(handles, flat + i, fb)) {
        const f = doorEdgeFrame(src, flat + i);
        if (f && f.arc) {
          const at = doorFrameAlong(f, mx, my);
          const t = Math.max(0, Math.min(1, at / f.len));
          const q = doorFramePoint(f, t);
          const d = Math.hypot(mx - q.x, my - q.y);
          if (!best || d < best.dist) best = { edge: flat + i, t, x: q.x, y: q.y, dist: d };
          continue;
        }
      }
      const dx = b.x - a.x, dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy;
      const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((mx - a.x) * dx + (my - a.y) * dy) / lenSq));
      const cx = a.x + dx * t, cy = a.y + dy * t;
      const d = Math.hypot(mx - cx, my - cy);
      if (!best || d < best.dist) best = { edge: flat + i, t, x: cx, y: cy, dist: d };
    }
    flat += verts.length;
  }
  if (maxDist != null && best && best.dist > maxDist) return null;
  return best;
}

// Where a door's centre sits, for the DM's outline.
function doorPoint(verts, door) {
  const f = doorEdgeFrame(verts, door && door.edge);
  if (!f) return null;
  const q = doorFramePoint(f, door.t);
  return { x: q.x, y: q.y };
}

// Whether a click landed on a door — the fallback for one placed before the grid changed, which no
// longer sits on a cell centre. ⚠ `slack` forgives DEPTH ONLY: along the wall it would reach into
// the next cell, so a click beside a door would delete it instead of opening a second one.
function pointInDoorNotch(verts, door, width, depth, mx, my, slack) {
  const f = doorEdgeFrame(verts, door && door.edge);
  if (!f) return false;
  const q = doorFramePoint(f, door.t);
  const relX = mx - q.x, relY = my - q.y;
  const along = relX * q.ux + relY * q.uy;
  const perp  = relX * q.nx + relY * q.ny;
  const s = slack || 0;
  return Math.abs(along) < Math.min(width, f.len) / 2 && perp >= -depth - s && perp <= depth + s;
}

// ─── Shared walls ─────────────────────────────────────────────────────────────
// Which stretches of a wall another room's outline runs along, as {from, to} distances from the
// wall's start vertex. Two rooms sharing a wall each feather INWARD from it, so neither reaches a
// full erase on the line and a band of fog is left standing over the wall.
// `tol` is what counts as the same wall; spans are widened by half a step, to cover the gaps
// between the points actually sampled.
function sharedWallSpans(verts, edge, others, tol, step) {
  const f = doorEdgeFrame(verts, edge);
  if (!f || !others || !(tol > 0) || !(step > 0)) return [];

  // Bounding-box reject first: on a real map almost no room is anywhere near a given wall.
  // A bent wall bows outside its own chord, so the box takes its sampled arc.
  const pts = f.arc ? f.arc.pts : [f.a, f.b];
  const xs = pts.map(pt => pt.x), ys = pts.map(pt => pt.y);
  const loX = Math.min(...xs) - tol, hiX = Math.max(...xs) + tol;
  const loY = Math.min(...ys) - tol, hiY = Math.max(...ys) + tol;
  const near = [];
  for (const o of others) {
    if (!o || !o.vertices || o.vertices.length < 3) continue;
    const b = getPolyBBox(o.vertices);
    if (b.maxX < loX || b.minX > hiX || b.maxY < loY || b.minY > hiY) continue;
    near.push(o);
  }
  if (!near.length) return [];

  const n = Math.max(1, Math.ceil(f.len / step));
  const half = f.len / n / 2;
  const spans = [];
  let open = -1, last = -1;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * f.len;
    // Along the WALL, not along its chord, so a bent wall's samples stay on it.
    const q = doorFramePoint(f, a / f.len);
    const px = q.x, py = q.y;
    let hit = false;
    for (const o of near) {
      if (nearestOutlinePoint(o, px, py, tol)) { hit = true; break; }
    }
    // Closed at the last point that HIT, not at the first that missed, or a span that ends
    // mid-wall runs a whole step past the neighbour it was following.
    if (hit) { if (open < 0) open = a; last = a; }
    else if (open >= 0) { spans.push({ from: open, to: last }); open = -1; }
  }
  if (open >= 0) spans.push({ from: open, to: last });
  return spans.map(sp => ({
    from: Math.max(0, sp.from - half),
    to: Math.min(f.len, sp.to + half),
  }));
}

// Least to most revealed. Anything unset paints like a reveal, matching applyPolygonToFog.
const DOOR_MODE_ORDER = ['shroud', 'half', 'reveal'];

function doorModeRank(mode) {
  const i = DOOR_MODE_ORDER.indexOf(mode);
  return i < 0 ? DOOR_MODE_ORDER.length - 1 : i;
}

// The state a door shows in: the most revealed of EVERY room whose wall runs through it, never the
// state of the one room that stores it. Two rooms share a doorway's wall and a click attaches to
// only one, which the DM cannot aim at. It also settles half-shroud, which has no answer while a
// door belongs to one room: half beside shrouded is half, revealed beside anything is revealed.
function doorResolvedMode(centre, rooms, tol) {
  if (!centre || !rooms) return 'shroud';
  let best = 0;
  for (const r of rooms) {
    if (!r || !r.vertices || r.vertices.length < 3) continue;
    if (!nearestOutlinePoint(r, centre.x, centre.y, tol)) continue;
    const rank = doorModeRank(r.mode);
    if (rank > best) best = rank;
  }
  return DOOR_MODE_ORDER[best];
}

// Which of a floor plan's openings are doorways, and where each notch goes. `rooms` is one vertex
// array per room, `portals` the plan's opening centres, both in map pixels.
//
// ⚠ AN OPENING BECOMES A DOOR ONLY WHERE TWO ROOMS SHARE THE WALL. One room means a window or an
// outside entrance, and the DM places those by hand — guessing them fills a map with wrong notches.
// The tolerance matches doorMouseDown's; widen it past half a cell and one portal starts claiming
// three rooms.
function planDoorPlacements(rooms, portals, cell, offsetX, offsetY, squareGrid) {
  if (!(cell > 0) || !Array.isArray(rooms) || !Array.isArray(portals)) return [];
  const tol = cell * 0.25;
  const out = [];
  for (const p of portals) {
    if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
    let hits = 0, best = null, bestIndex = -1;
    for (let i = 0; i < rooms.length; i++) {
      const verts = rooms[i];
      if (!verts || verts.length < 3) continue;
      const near = nearestOutlinePoint(verts, p.x, p.y, tol);
      if (!near) continue;
      hits++;
      if (!best || near.dist < best.dist) { best = near; bestIndex = i; }
    }
    if (hits < 2) continue;
    // Stored on ONE room, whichever is nearest: a door on a shared wall shows from either side.
    const verts = rooms[bestIndex];
    const door = doorCellSnap(verts, best.edge, p.x, p.y, cell, offsetX, offsetY, squareGrid);
    if (!door) continue;
    const centre = doorPoint(verts, door);
    if (!centre) continue;
    // Two portals can snap to the same cell — a double doorway is two entries in the file.
    if (out.some(o => Math.hypot(o.centre.x - centre.x, o.centre.y - centre.y) < tol)) continue;
    out.push({ roomIndex: bestIndex, door, centre });
  }
  return out.map(o => ({ roomIndex: o.roomIndex, door: o.door }));
}

// Keeps doors on the same map point when a vertex is added or removed. On an insert `at` is the
// EDGE being split, `splitT` how far along it the new vertex landed; on a delete `at` is the
// vertex index and a door on either edge it joined goes, having no wall left.
// ⚠ `t` is a fraction of the edge it NAMES, so the insert halving that edge moves the door.
function remapDoorsForVertexChange(doors, at, delta, splitT) {
  if (!doors || !doors.length) return doors || [];
  const s = (splitT > 0 && splitT < 1) ? splitT : 0.5;
  const out = [];
  for (const d of doors) {
    if (delta < 0) {
      if (d.edge === at || d.edge === at - 1) continue;
      out.push({ ...d, edge: d.edge > at ? d.edge - 1 : d.edge });
    } else if (d.edge === at) {
      out.push(d.t < s
        ? { ...d, t: d.t / s }
        : { ...d, edge: at + 1, t: (d.t - s) / (1 - s) });
    } else {
      out.push({ ...d, edge: d.edge > at ? d.edge + 1 : d.edge });
    }
  }
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
      edgeOutwardNormal,
    edgeRingRef,
    doorEdgeFrame,
    doorFramePoint,
    doorFrameAlong,
    doorSizeForCell,
    doorCellBounds,
    doorCellSnap,
    doorNotchCorners,
    nearestOutlinePoint,
    doorPoint,
    pointInDoorNotch,
    doorModeRank,
    doorResolvedMode,
    sharedWallSpans,
    DOOR_MODE_ORDER,
    remapDoorsForVertexChange,
    planDoorPlacements,
    DOOR_AXIS_EPS,
  };
}
