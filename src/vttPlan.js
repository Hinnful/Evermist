// vttPlan.js — pure geometry kernel: a Universal VTT floor plan → room polygons.
//
// Dungeon Alchemist writes a `.dd2vtt` beside the map it exports, holding the walls as vector
// data. Argument-in / value-out, no DOM and no globals. See the `floor-plan` skill for the rules,
// docs/DECISIONS.md for why the shape is this shape.
//
// ⚠ EVERYTHING HERE WORKS IN GRID SQUARES, the file's own unit (1 square = 5 ft). Every
// tolerance is therefore resolution-independent; applied in pixels they would need
// re-tuning per map. Pixels appear once, in the final conversion.

'use strict';

// Two endpoints this far apart are ONE node, and a node this close to an edge's interior sits ON
// it. Coincident endpoints are near-identical rather than bit-identical. Well under the thinnest
// DA wall, well over float noise.
const VTT_NODE_SNAP = 0.02;

// A face vertex whose perpendicular distance from its neighbours' chord is under this is a
// T-junction artefact, not a corner. SMALL on purpose: a bigger one flattens real arcs.
const VTT_COLLINEAR_EPS = 0.002;

// Faces smaller than this are not rooms, in square grid squares. Just under one 5ft square, and a
// real 5ft closet measures slightly over one, because the polygon follows wall centrelines.
//
// This guard is what makes generous gap-closing safe: bridging at a corner can chop a triangle
// off it. Sliver in, sliver refused, whatever produced it.
const VTT_MIN_FACE_AREA = 0.9;

// How far a wall end reaches to close a gap — wider than any double door, so a missing wall panel
// and an undoored archway both bridge. Beyond it, the ends were probably never meant to meet.
const VTT_CLOSE_GAP_MAX = 2.5;

// The same reach for a MUTUAL PAIR of loose ends, which is far better evidence: two ends that
// each pick the other were almost certainly one wall. A stub projecting onto a mid-span is a guess
// and keeps the tighter ceiling above. This width covers a room fronting onto a cave.
const VTT_CLOSE_PAIR_MAX = 5;

// Reporting ceiling for the gaps closing could NOT bridge. ⚠ Must stay above VTT_CLOSE_PAIR_MAX,
// or there is nothing left to describe. Low enough that a decorative wall in open ground is not
// reported as a broken room.
const VTT_OPEN_WALL_MAX_GAP = 6;

// Room centroids within this vertical distance are one row, for the left-to-right
// numbering. Roughly two rooms' worth of slack, so a corridor's rooms don't split rows.
const VTT_ROW_BUCKET = 2;

// ─── Edge collection ──────────────────────────────────────────────────────────
// Walls alone have a gap at every opening; the portals fill those gaps and share endpoints, so
// walls UNIONED WITH PORTALS is a closed plan and walls alone are not.
//
// ⚠ `objects_line_of_sight` is never read. It is vision-blocking props, so unioning it turns every
// pillar into a fake room.
function vttCollectEdges(plan) {
  const out = [];
  const addPolyline = (pts) => {
    if (!Array.isArray(pts)) return;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if (!a || !b || !isFinite(a.x) || !isFinite(a.y) || !isFinite(b.x) || !isFinite(b.y)) continue;
      out.push([{ x: a.x, y: a.y }, { x: b.x, y: b.y }]);
    }
  };
  const los = (plan && plan.line_of_sight) || [];
  for (const wall of los) addPolyline(wall);
  const portals = (plan && plan.portals) || [];
  for (const p of portals) if (p) addPolyline(p.bounds);
  return out;
}

// The centre of each portal's span, in grid squares. First and last bounds point, so a curved
// portal reports the middle of the opening rather than a bend in it.
function vttPortalMidpoints(plan) {
  const out = [];
  for (const p of ((plan && plan.portals) || [])) {
    // ⚠ COERCED, not just checked: isFinite('3') is true, and this is the file's one place that
    // ADDS two coordinates, where a string pair concatenates into a point far off the map.
    const pts = p && Array.isArray(p.bounds)
      ? p.bounds.filter(q => q && isFinite(q.x) && isFinite(q.y))
                .map(q => ({ x: Number(q.x), y: Number(q.y) }))
      : [];
    if (pts.length < 2) continue;
    const a = pts[0], b = pts[pts.length - 1];
    out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  return out;
}

// ─── Node snapping ────────────────────────────────────────────────────────────
// A grid of buckets one snap-radius wide, so coincidence is a 9-cell lookup, not a scan.
function vttBuildNodes(edges, snap) {
  const s = snap == null ? VTT_NODE_SNAP : snap;
  const nodes = [];
  const buckets = new Map();
  const key = (ix, iy) => ix + ',' + iy;

  const idFor = (p) => {
    const ix = Math.floor(p.x / s), iy = Math.floor(p.y / s);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = buckets.get(key(ix + dx, iy + dy));
        if (!list) continue;
        for (const id of list) {
          const n = nodes[id];
          if (Math.hypot(n.x - p.x, n.y - p.y) <= s) return id;
        }
      }
    }
    const id = nodes.length;
    nodes.push({ x: p.x, y: p.y });
    const k = key(ix, iy);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(id);
    return id;
  };

  const pairs = [];
  for (const [a, b] of edges) {
    const ia = idFor(a), ib = idFor(b);
    if (ia !== ib) pairs.push([ia, ib]);   // a segment shorter than the snap is not an edge
  }
  return { nodes, pairs };
}

// Perpendicular distance from p to segment a-b, plus where along it the foot lands.
function vttProjectToSegment(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return { dist: Math.hypot(p.x - a.x, p.y - a.y), t: 0 };
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = a.x + t * vx, cy = a.y + t * vy;
  return { dist: Math.hypot(p.x - cx, p.y - cy), t };
}

// ─── T-junction splitting ─────────────────────────────────────────────────────
// A node landing on another edge's INTERIOR is a junction the graph does not know about, so the
// face walk has nowhere to turn and collapses to zero-area faces. Every real DA map needs it.
function vttSplitAtJunctions(nodes, pairs, snap) {
  const s = snap == null ? VTT_NODE_SNAP : snap;
  const out = [];
  for (const [ia, ib] of pairs) {
    const a = nodes[ia], b = nodes[ib];
    const hits = [];
    for (let id = 0; id < nodes.length; id++) {
      if (id === ia || id === ib) continue;
      const pr = vttProjectToSegment(nodes[id], a, b);
      if (pr.dist <= s && pr.t > 0 && pr.t < 1) hits.push({ id, t: pr.t });
    }
    if (!hits.length) { out.push([ia, ib]); continue; }
    hits.sort((x, y) => x.t - y.t);
    let prev = ia;
    for (const h of hits) {
      if (h.id !== prev) out.push([prev, h.id]);
      prev = h.id;
    }
    if (prev !== ib) out.push([prev, ib]);
  }
  // One edge per node pair: walls and portals can overlap, and a doubled edge would let
  // the face walk take the same turn twice.
  const seen = new Set();
  const uniq = [];
  for (const [ia, ib] of out) {
    const k = ia < ib ? ia + '|' + ib : ib + '|' + ia;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push([ia, ib]);
  }
  return uniq;
}

// ─── Planar face walk ─────────────────────────────────────────────────────────
// Each node's neighbours sorted by angle; arriving at v from u, leave by the neighbour immediately
// CLOCKWISE of (v→u). Every directed edge belongs to one face, so this enumerates them all.
function vttWalkFaces(nodes, pairs) {
  const adj = nodes.map(() => []);
  for (const [ia, ib] of pairs) { adj[ia].push(ib); adj[ib].push(ia); }
  const sorted = adj.map((nbrs, i) => {
    const v = nodes[i];
    return nbrs
      .map(n => ({ n, ang: Math.atan2(nodes[n].y - v.y, nodes[n].x - v.x) }))
      .sort((p, q) => p.ang - q.ang)
      .map(e => e.n);
  });

  const nextCW = (v, u) => {
    const ring = sorted[v];
    const i = ring.indexOf(u);
    if (i < 0) return u;
    return ring[(i - 1 + ring.length) % ring.length];
  };

  const visited = new Set();
  const faces = [];
  for (const [ia, ib] of pairs) {
    for (const [u0, v0] of [[ia, ib], [ib, ia]]) {
      if (visited.has(u0 + '|' + v0)) continue;
      const face = [];
      let a = u0, b = v0;
      // The edge count bounds the walk; a malformed graph must not spin forever.
      for (let guard = 0; guard <= pairs.length * 2 + 2; guard++) {
        visited.add(a + '|' + b);
        face.push(a);
        const c = nextCW(b, a);
        a = b; b = c;
        if (a === u0 && b === v0) break;
      }
      faces.push(face);
    }
  }
  return faces;
}

// ─── Ring cleanup ─────────────────────────────────────────────────────────────
// Drops spur tips and the collinear vertices a T-junction split leaves mid-wall. Repeated until
// stable, because removing one vertex can make its neighbour collinear.
function vttCleanRing(pts, collinearEps, snap) {
  const eps = collinearEps == null ? VTT_COLLINEAR_EPS : collinearEps;
  const sn = snap == null ? VTT_NODE_SNAP : snap;
  let ring = pts.slice();
  let changed = true;
  while (changed && ring.length >= 3) {
    changed = false;
    for (let i = 0; i < ring.length; i++) {
      const n = ring.length;
      if (n < 3) break;
      const prev = ring[(i - 1 + n) % n], cur = ring[i], next = ring[(i + 1) % n];
      const spur = Math.hypot(next.x - prev.x, next.y - prev.y) <= sn;
      if (spur || vttProjectToSegment(cur, prev, next).dist <= eps) {
        ring.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  // A spur removal can leave the two sides of it adjacent and identical.
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    if (Math.hypot(p.x - q.x, p.y - q.y) > sn) out.push(p);
  }
  return out;
}

// Shoelace. The SIGN is the classification: see vttDerivePlan.
function vttSignedArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function vttCentroid(ring) {
  let x = 0, y = 0;
  for (const p of ring) { x += p.x; y += p.y; }
  return { x: x / ring.length, y: y / ring.length };
}

// ─── Loose wall ends ──────────────────────────────────────────────────────────
// A missing wall does not distort a room, it DELETES it: the gap joins the interior to the outside
// and the two merge into one face, so a broken room raises no error.
//
// Every degree-1 node pairs with the nearest thing that is NOT its own wall. ⚠ That exclusion is
// not optional: a freestanding wall's two ends are each other's nearest node, so it would measure
// itself and report a gap of its own length.
//
// ⚠ `avoid` IS WHY A ROOM FRONTING ONTO A CAVE CAN CLOSE AT ALL. Pass the doorless walls and
// nothing solid can be a target. Without it both ends bridge sideways into the rock, which
// consumes them so the real partner is never found and the room merges into the cavern.
function vttLooseEnds(nodes, pairs, avoid) {
  const solid = (p) => !!avoid && avoid.length > 0 &&
    avoid.some(([a, b]) => vttProjectToSegment(p, a, b).dist <= VTT_NODE_SNAP);
  const nodeSolid = nodes.map(solid);
  const edgeSolid = pairs.map(([ia, ib]) => solid({
    x: (nodes[ia].x + nodes[ib].x) / 2, y: (nodes[ia].y + nodes[ib].y) / 2,
  }));
  const deg = nodes.map(() => 0);
  const incident = nodes.map(() => []);
  const linked = nodes.map(() => new Set());
  for (let e = 0; e < pairs.length; e++) {
    const [ia, ib] = pairs[e];
    deg[ia]++; deg[ib]++;
    incident[ia].push(e); incident[ib].push(e);
    linked[ia].add(ib); linked[ib].add(ia);
  }
  const ends = [];
  for (let id = 0; id < nodes.length; id++) {
    if (deg[id] !== 1) continue;
    let best = Infinity, bestNode = -1, bestPoint = null;
    for (let other = 0; other < nodes.length; other++) {
      if (other === id || linked[id].has(other) || nodeSolid[other]) continue;
      const d = Math.hypot(nodes[id].x - nodes[other].x, nodes[id].y - nodes[other].y);
      if (d < best) { best = d; bestNode = other; bestPoint = null; }
    }
    for (let e = 0; e < pairs.length; e++) {
      if (incident[id].includes(e) || edgeSolid[e]) continue;
      const [ia, ib] = pairs[e];
      const pr = vttProjectToSegment(nodes[id], nodes[ia], nodes[ib]);
      if (pr.dist >= best) continue;   // strict, so a tie with a node keeps the node
      const foot = { x: nodes[ia].x + pr.t * (nodes[ib].x - nodes[ia].x),
                     y: nodes[ia].y + pr.t * (nodes[ib].y - nodes[ia].y) };
      // ⚠ A CLAMPED PROJECTION CAN LAND ON THIS END'S OWN NEIGHBOUR. Skipping incident edges is
      // not enough: a SIBLING edge sharing the neighbour clamps to that corner, so the end measures
      // its own wall. The exclusion has to apply to the foot, not just the edge list.
      if (Math.hypot(foot.x - nodes[id].x, foot.y - nodes[id].y) <= VTT_NODE_SNAP) continue;
      let onNeighbour = false;
      for (const nb of linked[id]) {
        if (Math.hypot(foot.x - nodes[nb].x, foot.y - nodes[nb].y) <= VTT_NODE_SNAP) { onNeighbour = true; break; }
      }
      if (onNeighbour) continue;
      best = pr.dist; bestNode = -1; bestPoint = foot;
    }
    ends.push({ id, dist: best, node: bestNode, point: bestPoint });
  }
  return { ends, deg };
}

// ─── Closing the gaps ─────────────────────────────────────────────────────────
// Bridges a wall end to whatever it almost reaches, so a broken room becomes a drawable one. An
// archway with no door still bounds a room the DM wants to shroud.
//
// The bridge is a straight line between two points the file already contains, capped by
// VTT_CLOSE_GAP_MAX. Two loose ends join only when each is the other's nearest feature. Anything
// it gets wrong, one Ctrl+Z removes — the whole import is a single undo step.
function vttCloseGaps(nodes, pairs, maxGap, snap, avoid, pairGap) {
  const max = maxGap == null ? VTT_CLOSE_GAP_MAX : maxGap;
  // Tightening the ceiling tightens BOTH: the pair bonus is part of the default posture, so
  // `closeGapMax: 0` still means no closing at all rather than no closing except pairs.
  const pairMax = pairGap != null ? pairGap
    : (max >= VTT_CLOSE_GAP_MAX ? VTT_CLOSE_PAIR_MAX : max);
  const sn = snap == null ? VTT_NODE_SNAP : snap;
  const { ends, deg } = vttLooseEnds(nodes, pairs, avoid);
  const byId = new Map(ends.map(e => [e.id, e]));
  const used = new Set();
  const added = [], closed = [];

  for (const e of ends) {
    // A mutual pair of loose ends reaches further than a stub reaching for a wall, because
    // it is far better evidence that the two were once joined.
    const mutualPair = e.node >= 0 && deg[e.node] === 1;
    if (used.has(e.id) || !(e.dist <= (mutualPair ? pairMax : max))) continue;
    let target;
    if (e.node >= 0) {
      if (deg[e.node] === 1) {
        const partner = byId.get(e.node);
        if (!partner || partner.node !== e.id) continue;   // the feeling must be mutual
        used.add(partner.id);
      }
      target = e.node;
    } else if (e.point) {
      // ⚠ REUSE A NODE THE PROJECTION LANDS ON. An edge's nearest point is often its own endpoint,
      // and float error can make the edge win by a hair. A fresh node there sits at an existing
      // corner, so the re-split never attaches it and the bridge dead-ends.
      let existing = -1;
      for (let n = 0; n < nodes.length; n++) {
        if (n === e.id) continue;
        if (Math.hypot(nodes[n].x - e.point.x, nodes[n].y - e.point.y) <= sn) { existing = n; break; }
      }
      if (existing >= 0) {
        target = existing;
      } else {
        nodes.push({ x: e.point.x, y: e.point.y });   // mid-wall; the re-split attaches it
        target = nodes.length - 1;
      }
    } else {
      continue;
    }
    used.add(e.id);
    added.push([e.id, target]);
    closed.push({
      x: (nodes[e.id].x + nodes[target].x) / 2,
      y: (nodes[e.id].y + nodes[target].y) / 2,
      gap: e.dist,
    });
  }
  return { pairs: added.length ? pairs.concat(added) : pairs, closed };
}

// What closing left behind: a gap too wide to bridge, which still costs its room. Reported at the
// midpoint of a mutual pair, so the count matches the gaps rather than doubling them. Nothing
// surfaces it in the UI, but the coordinates are exact.
function vttFindOpenWalls(nodes, pairs, maxGap, avoid) {
  const max = maxGap == null ? VTT_OPEN_WALL_MAX_GAP : maxGap;
  const { ends, deg } = vttLooseEnds(nodes, pairs, avoid);
  const byId = new Map(ends.map(e => [e.id, e]));
  const done = new Set();
  const out = [];
  for (const e of ends) {
    if (done.has(e.id) || !(e.dist <= max)) continue;
    const partner = e.node >= 0 && deg[e.node] === 1 ? byId.get(e.node) : null;
    const mutual = !!partner && partner.node === e.id;
    done.add(e.id);
    if (mutual) done.add(partner.id);
    const at = mutual
      ? { x: (nodes[e.id].x + nodes[partner.id].x) / 2, y: (nodes[e.id].y + nodes[partner.id].y) / 2 }
      : { x: nodes[e.id].x, y: nodes[e.id].y };
    out.push({ x: at.x, y: at.y, gap: e.dist });
  }
  return out;
}

// ─── Doorless wall loops ──────────────────────────────────────────────────────
// A run of walls that closes on itself and carries NO portal anywhere is solid, not a room: a rock
// formation in a cave, or the cave's outer shell. Every real room reaches its neighbours through a
// doorway, so its walls are an OPEN chain until the portals are unioned in.
//
// The test is "any at all", with no threshold to tune: a false room is doorless along most of its
// outline and a real one along none of it.
//
// ⚠ IT IS A PROPERTY OF THE WHOLE CONNECTED RUN, NOT OF ONE ROOM, which is what makes it safe. A
// sealed vault inside a house joins the house's walls at the corners, shares their doors, and is
// kept. A whole floor that is one sealed room comes back empty — the accepted cost.
function vttDoorlessWalls(plan, snap) {
  const s = snap == null ? VTT_NODE_SNAP : snap;
  const wallEdges = [];
  for (const wall of ((plan && plan.line_of_sight) || [])) {
    if (!Array.isArray(wall)) continue;
    for (let i = 0; i + 1 < wall.length; i++) {
      const a = wall[i], b = wall[i + 1];
      if (!a || !b || !isFinite(a.x) || !isFinite(a.y) || !isFinite(b.x) || !isFinite(b.y)) continue;
      wallEdges.push([{ x: a.x, y: a.y }, { x: b.x, y: b.y }]);
    }
  }
  if (!wallEdges.length) return [];

  // ⚠ WALLS ONLY. Union the portals in first and every chain closes into a loop, so the
  // distinction this function rests on disappears.
  //
  // ⚠ The T-split is not optional either: without it a doorway in one wall leaves the OTHERS
  // looking like a closed ring and the whole building is refused as solid.
  const built = vttBuildNodes(wallEdges, s);
  const nodes = built.nodes;
  const pairs = vttSplitAtJunctions(nodes, built.pairs, s);
  const adj = nodes.map(() => []);
  for (const [ia, ib] of pairs) { adj[ia].push(ib); adj[ib].push(ia); }

  const comp = new Array(nodes.length).fill(-1);
  let nc = 0;
  for (let i = 0; i < nodes.length; i++) {
    if (comp[i] >= 0 || !adj[i].length) continue;
    const stack = [i];
    comp[i] = nc;
    while (stack.length) {
      const v = stack.pop();
      for (const n of adj[v]) if (comp[n] < 0) { comp[n] = nc; stack.push(n); }
    }
    nc++;
  }

  const doors = [];
  for (const p of ((plan && plan.portals) || [])) {
    if (!p || !Array.isArray(p.bounds)) continue;
    for (const b of p.bounds) if (b && isFinite(b.x) && isFinite(b.y)) doors.push(b);
  }

  // Spared if any node is loose or a junction (so the run is not a clean loop), or if a
  // portal ends on it.
  const spared = new Set();
  for (let i = 0; i < nodes.length; i++) {
    if (comp[i] < 0) continue;
    if (adj[i].length !== 2) { spared.add(comp[i]); continue; }
    for (const d of doors) {
      if (Math.hypot(d.x - nodes[i].x, d.y - nodes[i].y) <= s) { spared.add(comp[i]); break; }
    }
  }

  const out = [];
  for (const [ia, ib] of pairs) if (!spared.has(comp[ia])) out.push([nodes[ia], nodes[ib]]);
  return out;
}

// Does any edge of this ring run along a doorless wall? Tested at each edge's midpoint against the
// whole segment, so a T-junction split partway along a doorless wall still matches.
function vttRingOnDoorlessWall(ring, walls, tol) {
  if (!walls || !walls.length) return false;
  const t = tol == null ? VTT_NODE_SNAP : tol;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    if (Math.hypot(q.x - p.x, q.y - p.y) < 1e-9) continue;
    const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    for (const [a, b] of walls) if (vttProjectToSegment(m, a, b).dist <= t) return true;
  }
  return false;
}

// ─── The derivation ───────────────────────────────────────────────────────────
// A plan that yields nothing returns empty arrays rather than throwing, so a caller can ask "how
// many rooms?" and get zero. Malformed JSON is the CALLER's problem.
function vttDerivePlan(plan, opts) {
  const o = opts || {};
  const empty = { rooms: [], boundaries: [], portals: [], closedGaps: [], openWalls: [],
                  refusedSolid: 0, srcW: 0, srcH: 0, squaresX: 0, squaresY: 0, gridPx: 0 };
  if (!plan || typeof plan !== 'object') return empty;

  const res = plan.resolution || {};
  const ppg = Number(res.pixels_per_grid);
  if (!isFinite(ppg) || ppg <= 0) return empty;
  // ⚠ THE ORIGIN TERM IS NOT OPTIONAL. Omit it and every room comes out correctly shaped
  // and uniformly displaced — silent on a zero-origin export, wrong on any other.
  const ox = Number(res.map_origin && res.map_origin.x) || 0;
  const oy = Number(res.map_origin && res.map_origin.y) || 0;

  const snap = o.nodeSnap == null ? VTT_NODE_SNAP : o.nodeSnap;
  const edges = vttCollectEdges(plan);
  if (!edges.length) return empty;

  const { nodes, pairs: rawPairs } = vttBuildNodes(edges, snap);
  // ⚠ THE DOORLESS WALLS ARE NEEDED BEFORE CLOSING, not just after it. They are what a wall
  // stub must not bridge into, and a bridge into rock costs the room it belonged to.
  const doorless = o.keepDoorless ? [] : vttDoorlessWalls(plan, snap);
  // Split, close, then split again: closing can add a node in an edge's interior, and the face
  // walk cannot turn at a junction the graph does not know about.
  const split = vttSplitAtJunctions(nodes, rawPairs, snap);
  const bridged = vttCloseGaps(nodes, split, o.closeGapMax, snap, doorless, o.closePairMax);
  const pairs = bridged.closed.length
    ? vttSplitAtJunctions(nodes, bridged.pairs, snap)
    : bridged.pairs;
  if (!pairs.length) return empty;

  const minArea = o.minFaceArea == null ? VTT_MIN_FACE_AREA : o.minFaceArea;
  const rooms = [], boundaries = [];
  let refusedSolid = 0;
  for (const face of vttWalkFaces(nodes, pairs)) {
    const raw = face.map(i => nodes[i]);
    const ring = vttCleanRing(raw, o.collinearEps, snap);
    if (ring.length < 3) continue;
    const area = vttSignedArea(ring);
    if (Math.abs(area) < minArea) continue;
    // ⚠ TESTED ON THE UNCLEANED RING. Cleaning merges collinear pieces, so one edge of the
    // tidy ring can span both doorless and ordinary wall and land its midpoint on either.
    if (vttRingOnDoorlessWall(raw, doorless, snap)) {
      if (area > 0) refusedSolid++;
      continue;
    }
    // ⚠ WINDING, NEVER AREA. The clockwise-turn walk gives interior faces positive shoelace area
    // and each island's outer boundary negative. Size works until a map holds two detached
    // buildings, and then the smaller building's boundary outranks a real room.
    (area > 0 ? rooms : boundaries).push(ring);
  }

  // Spatially ordered so the numbering is predictable: rows down the map, then
  // left-to-right inside each row.
  const rowH = o.rowBucket == null ? VTT_ROW_BUCKET : o.rowBucket;
  const withC = rooms.map(r => ({ ring: r, c: vttCentroid(r) }));
  withC.sort((a, b) => (a.c.y - b.c.y) || (a.c.x - b.c.x));
  const orderedRooms = [];
  let i = 0;
  while (i < withC.length) {
    const row = [withC[i]];
    let j = i + 1;
    while (j < withC.length && withC[j].c.y - withC[i].c.y <= rowH) { row.push(withC[j]); j++; }
    row.sort((a, b) => a.c.x - b.c.x);
    for (const r of row) orderedRooms.push(r.ring);
    i = j;
  }

  const toPx = (p) => ({ x: (p.x - ox) * ppg, y: (p.y - oy) * ppg });
  const toReport = (w) => {
    const p = toPx(w);
    return { x: Math.round(p.x), y: Math.round(p.y), gapPx: Math.round(w.gap * ppg) };
  };
  return {
    rooms: orderedRooms.map(r => r.map(toPx)),
    boundaries: boundaries.map(r => r.map(toPx)),
    // One point per opening. NOT doors: the file has no type field, so which are doorways is the
    // caller's call, from the rooms around them.
    portals: vttPortalMidpoints(plan).map(toPx),
    closedGaps: bridged.closed.map(toReport),
    openWalls: vttFindOpenWalls(nodes, pairs, o.openWallMaxGap, doorless).map(toReport),
    refusedSolid,
    // The pixel size the plan believes its own map is: map_size in grid squares × pixels_per_grid.
    // Every coordinate above is in that space, so a caller whose map is a DIFFERENT size must scale
    // by its own width over this. 0 means unknown, which callers read as scale 1.
    srcW: pxSize(res.map_size && res.map_size.x, ppg),
    srcH: pxSize(res.map_size && res.map_size.y, ppg),
    // How many grid squares the plan says its map is, and how many pixels one square holds. With
    // the loaded map's width, that sets Grid Size without asking the DM for a DPI. 0 means unknown.
    squaresX: gridSpan(res.map_size && res.map_size.x),
    squaresY: gridSpan(res.map_size && res.map_size.y),
    gridPx: ppg,
  };
}

// One axis of the plan's declared size in grid squares, or 0 when the file does not say.
function gridSpan(span) {
  const n = Number(span);
  return isFinite(n) && n > 0 ? n : 0;
}

// One axis of the plan's declared pixel size, or 0 when the file does not say.
function pxSize(gridSpan, ppg) {
  const n = Number(gridSpan);
  return isFinite(n) && n > 0 ? n * ppg : 0;
}

// Re-scales derived rings from the plan's own pixel space into the loaded map's, which differ
// whenever the map on screen is not the export the plan was written beside — a shrunk animated map.
//
// ⚠ UNIFORM and POSITIVE, on width alone. Winding classifies a face as a room and a uniform
// positive scale cannot flip it; independent axes would shear a plan whose aspect disagrees.
// Unknown srcW means scale 1, so a plan beside its own export is untouched.
function vttScaleRooms(rooms, mapWidth, srcW) {
  const list = Array.isArray(rooms) ? rooms : [];
  const mw = Number(mapWidth), sw = Number(srcW);
  const k = (isFinite(mw) && mw > 0 && isFinite(sw) && sw > 0) ? mw / sw : 1;
  if (k === 1) return list.map(r => r.map(p => ({ x: p.x, y: p.y })));
  return list.map(r => r.map(p => ({ x: p.x * k, y: p.y * k })));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    vttCollectEdges, vttPortalMidpoints, vttBuildNodes, vttSplitAtJunctions, vttWalkFaces,
    vttCleanRing, vttSignedArea, vttProjectToSegment,
    vttLooseEnds, vttCloseGaps, vttFindOpenWalls,
    vttDoorlessWalls, vttRingOnDoorlessWall, vttDerivePlan, vttScaleRooms,
    VTT_NODE_SNAP, VTT_COLLINEAR_EPS, VTT_MIN_FACE_AREA,
    VTT_CLOSE_GAP_MAX, VTT_CLOSE_PAIR_MAX, VTT_OPEN_WALL_MAX_GAP, VTT_ROW_BUCKET,
  };
}
