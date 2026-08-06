// inspect-plan.js — diagnostic dump of a Universal VTT floor plan and what the kernel makes
// of it. Read-only, prints and exits. Not shipped: `tools/` is outside the build glob.
//
//   node tools/inspect-plan.js path/to/map.dd2vtt
//
// The point is to see every face the walk produces BEFORE vttDerivePlan sorts them into
// rooms and boundaries, so a face that is wrong is visible as a face rather than as a
// missing room. Areas are in grid squares and as a share of the whole map.

'use strict';

const fs = require('fs');
const path = require('path');
const V = require(path.join(__dirname, '..', 'src', 'vttPlan.js'));

const file = process.argv[2];
if (!file) { console.error('usage: node tools/inspect-plan.js <plan.dd2vtt>'); process.exit(1); }

const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
const res = plan.resolution || {};
const size = res.map_size || {};
const mapArea = (Number(size.x) || 0) * (Number(size.y) || 0);

console.log('── file ' + '─'.repeat(60));
console.log('  ' + path.basename(file) + '   format ' + plan.format);
console.log('  map_size        ' + size.x + ' × ' + size.y + ' squares  (' + mapArea + ' sq)');
console.log('  map_origin      ' + JSON.stringify(res.map_origin));
console.log('  pixels_per_grid ' + res.pixels_per_grid);
console.log('  image           ' + (plan.image ? plan.image.length + ' chars' : 'EMPTY'));

console.log('── arrays ' + '─'.repeat(58));
for (const k of Object.keys(plan)) {
  if (Array.isArray(plan[k])) {
    const pts = plan[k].reduce((n, w) => n + (Array.isArray(w) ? w.length : (w && Array.isArray(w.bounds) ? w.bounds.length : 0)), 0);
    console.log('  ' + k.padEnd(24) + String(plan[k].length).padStart(5) + ' entries, ' + pts + ' points');
  }
}
// The one array that must never be unioned in. Loud, because its presence changes what a
// cave map means: props inside an open cavern would each become a fake room.
if (Array.isArray(plan.objects_line_of_sight) && plan.objects_line_of_sight.length) {
  console.log('  ⚠ objects_line_of_sight is PRESENT and stays unread.');
}

// Polyline length histogram: an organic cave wall is one very long polyline, a built room is
// a handful of short ones. This is the cheapest way to see which the file is made of.
const los = plan.line_of_sight || [];
const lens = los.map(w => (Array.isArray(w) ? w.length : 0)).sort((a, b) => b - a);
console.log('  line_of_sight polyline point-counts, largest first:');
console.log('    ' + lens.slice(0, 20).join(', ') + (lens.length > 20 ? ', … (' + (lens.length - 20) + ' more)' : ''));

// ─── The faces, before classification ─────────────────────────────────────────
const edges = V.vttCollectEdges(plan);
const { nodes, pairs: raw } = V.vttBuildNodes(edges);
const split = V.vttSplitAtJunctions(nodes, raw);
const bridged = V.vttCloseGaps(nodes, split);
const pairs = bridged.closed.length ? V.vttSplitAtJunctions(nodes, bridged.pairs) : bridged.pairs;

console.log('── graph ' + '─'.repeat(59));
console.log('  ' + edges.length + ' segments → ' + nodes.length + ' nodes, ' + raw.length +
  ' edges → ' + split.length + ' after T-splits → ' + pairs.length + ' after ' +
  bridged.closed.length + ' bridges');

const faces = [];
for (const face of V.vttWalkFaces(nodes, pairs)) {
  const ring = V.vttCleanRing(face.map(i => nodes[i]));
  if (ring.length < 3) continue;
  faces.push({ ring, area: V.vttSignedArea(ring) });
}
faces.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));

console.log('── faces (' + faces.length + ' with ≥3 vertices) ' + '─'.repeat(38));
console.log('  ' + 'kind'.padEnd(10) + 'area(sq)'.padStart(11) + '%map'.padStart(8) +
  'verts'.padStart(7) + '  refused?');
for (const f of faces) {
  const kind = f.area > 0 ? 'ROOM' : 'boundary';
  const pct = mapArea ? (Math.abs(f.area) / mapArea * 100).toFixed(1) : '?';
  const refused = Math.abs(f.area) < V.VTT_MIN_FACE_AREA ? 'yes (min area)' : '';
  console.log('  ' + kind.padEnd(10) + Math.abs(f.area).toFixed(2).padStart(11) +
    pct.padStart(8) + String(f.ring.length).padStart(7) + '  ' + refused);
}

const derived = V.vttDerivePlan(plan);
console.log('── vttDerivePlan ' + '─'.repeat(51));
console.log('  ' + derived.rooms.length + ' rooms, ' + derived.boundaries.length +
  ' boundaries, ' + derived.closedGaps.length + ' gaps closed, ' +
  derived.openWalls.length + ' open walls left');
