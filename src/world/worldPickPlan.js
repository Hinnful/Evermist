'use strict';
// worldPickPlan.js — the world map's multi-pick and partial backup, in pure functions: a Shift-click
// toggled, which scenes a Shift-dragged box touches, and which places and roads travel with the scenes
// picked for an export. No DOM.

const _wpOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Shift-click: the scene leaves the pick when it is in it, else it joins at the end.
function wpToggle(list, id) {
  return list.includes(id) ? list.filter(x => x !== id) : list.concat([id]);
}

// The ids a box takes in, added to the pick already held. `items` are { id, x, y } card centres. Far out
// a scene is a diamond, so its centre must be in the box; close in it is a card, so touching is enough.
function wpMarqueeHits(base, rect, items, far, cardW, cardH) {
  const out = base.slice();
  for (const it of items) {
    if (out.includes(it.id)) continue;
    const hw = far ? 0 : cardW / 2, hh = far ? 0 : cardH / 2;
    if (it.x + hw >= rect.x && it.x - hw <= rect.x + rect.w && it.y + hh >= rect.y && it.y - hh <= rect.y + rect.h) out.push(it.id);
  }
  return out;
}

// What a backup of only the picked scenes carries. A place goes when a picked scene sits in it. A road goes
// only when it holds a picked scene, so the scene keeps the road it stood on. Notes follow what is kept.
// `scenes` are { id, group } with the group already cleaned. Maps are returned without a prototype.
function wpSubset(ids, scenes, shapes, roads, placeNotes, roadNotes) {
  const picked = new Set(ids);
  const groups = new Set(scenes.filter(s => picked.has(s.id) && s.group).map(s => s.group));
  const out = { shapes: Object.create(null), roads: Object.create(null), placeNotes: Object.create(null), roadNotes: Object.create(null) };
  for (const k of Object.keys(shapes || {})) if (groups.has(k)) out.shapes[k] = shapes[k];
  for (const k of Object.keys(placeNotes || {})) if (groups.has(k)) out.placeNotes[k] = placeNotes[k];
  for (const k of Object.keys(roads || {})) {
    if (!(roads[k].scenes || []).some(s => picked.has(s.id))) continue;
    out.roads[k] = roads[k];
    if (roadNotes && _wpOwn(roadNotes, k)) out.roadNotes[k] = roadNotes[k];
  }
  return out;
}

// The counts for Settings' line: everything when `ids` is empty, else what wpSubset keeps.
function wpCounts(ids, scenes, shapes, roads) {
  if (!ids || !ids.length) return { scenes: scenes.length, places: Object.keys(shapes || {}).length, roads: Object.keys(roads || {}).length };
  const sub = wpSubset(ids, scenes, shapes, roads, null, null);
  return { scenes: ids.length, places: Object.keys(sub.shapes).length, roads: Object.keys(sub.roads).length };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { wpToggle, wpMarqueeHits, wpSubset, wpCounts };
