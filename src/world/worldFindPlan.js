'use strict';
// worldFindPlan.js — what the world map's Find answers, in pure functions: which places, scenes and roads a
// query matches, best match first, and where in each name it hit. No DOM.

const WF_PER_GROUP = 6;          // rows shown under each heading; the count still says how many matched

// How well a name fits the query: 0 is the whole name, 1 its start, 2 the start of a word in it, 3 anywhere in it,
// -1 not at all. `q` is already trimmed and lower-cased.
function wfRank(name, q) {
  const n = String(name || '').toLowerCase();
  if (!q || !n) return -1;
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  const at = n.indexOf(q);
  if (at < 0) return -1;
  return /[\s\-_.,:;'’(]/.test(n[at - 1] || 'x') ? 2 : 3;
}

// Where the query sits in the name, for the bold run: { at, len } or null.
function wfHit(name, q) {
  const at = String(name || '').toLowerCase().indexOf(q);
  return q && at >= 0 ? { at, len: q.length } : null;
}

function _wfSort(rows) {
  return rows.map((r, i) => ({ r, i })).sort((a, b) => a.r.rank - b.r.rank || a.i - b.i).map(x => x.r);
}

// places: { name, count }; scenes: { id, name, place }; roads: { uid, name }.
// Answers { places, scenes, roads, total } with each list ranked and cut to WF_PER_GROUP, and `total` counting every match.
function wfSearch(query, places, scenes, roads) {
  const q = String(query || '').trim().toLowerCase();
  const out = { places: [], scenes: [], roads: [], total: 0 };
  if (!q) return out;
  const pick = (list, key) => _wfSort(list.map(x => ({ ...x, rank: wfRank(x[key], q) })).filter(x => x.rank >= 0));
  const p = pick(places || [], 'name'), s = pick(scenes || [], 'name'), r = pick(roads || [], 'name');
  out.total = p.length + s.length + r.length;
  out.places = p.slice(0, WF_PER_GROUP);
  out.scenes = s.slice(0, WF_PER_GROUP);
  out.roads = r.slice(0, WF_PER_GROUP);
  return out;
}

// The rows in the order the keys walk them: places, scenes, roads.
function wfFlat(found) {
  return [].concat(
    found.places.map(x => ({ kind: 'place', ...x })),
    found.scenes.map(x => ({ kind: 'scene', ...x })),
    found.roads.map(x => ({ kind: 'road', ...x })),
  );
}

if (typeof module !== 'undefined' && module.exports) module.exports = { WF_PER_GROUP, wfRank, wfHit, wfSearch, wfFlat };
