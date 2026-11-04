'use strict';
// vttHoles.js — pure kernel: the free-standing buildings each floor-plan room encloses, as its holes. Tested.
//
// ⚠ The face walk (vttPlan.js) emits only outer rings, so without this a hall covers its vault and
// revealing the hall reveals the hidden vault on the TV.

function _vhArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  return Math.abs(a / 2);
}

function _vhInside(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Parallel to `rooms`. Each island's outer boundary goes to the smallest room that holds every one of its
// points; the map's own outline sits in no room and is skipped.
function vttRoomHoles(rooms, boundaries) {
  const out = rooms.map(() => []);
  const areas = rooms.map(_vhArea);
  for (const b of boundaries || []) {
    const bArea = _vhArea(b);
    let best = -1;
    for (let i = 0; i < rooms.length; i++) {
      if (areas[i] <= bArea || (best >= 0 && areas[i] >= areas[best])) continue;
      if (b.every(p => _vhInside(p, rooms[i]))) best = i;
    }
    if (best >= 0) out[best].push(b.map(p => ({ x: p.x, y: p.y })));
  }
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { vttRoomHoles };
}
