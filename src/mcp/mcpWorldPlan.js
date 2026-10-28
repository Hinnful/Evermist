'use strict';
// mcpWorldPlan.js — pure rules for Claude's Campaign tools: a group's outline, a card's exact spot, a road
// found by name and the backdrop's numbers. Tested.

const MCP_OUTLINE_MIN_W = 150, MCP_OUTLINE_MIN_H = 110, MCP_OUTLINE_MAX = 400;
const MCP_BG_SCALE = [5, 400], MCP_BG_ALPHA = [0.05, 1];   // percent, and 0 to 1: the backdrop controls' ranges

function _mwCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

const _mwHas = v => v !== undefined && v !== null && v !== '';

// A group's outline from a list of { x, y } in Campaign units: { points } rounded, or { error } in the DM's words.
function mcpOutlineArg(raw) {
  if (!Array.isArray(raw) || raw.length < 3) return { error: 'An outline needs at least 3 points, each { x, y } in Campaign units.' };
  if (raw.length > MCP_OUTLINE_MAX) return { error: 'An outline can have up to ' + MCP_OUTLINE_MAX + ' points.' };
  const pts = [];
  for (const p of raw) {
    const x = p && _mwHas(p.x) ? Math.round(Number(p.x)) : NaN, y = p && _mwHas(p.y) ? Math.round(Number(p.y)) : NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { error: 'Every outline point needs a number x and a number y.' };
    pts.push({ x, y });
  }
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  if (Math.max(...xs) - Math.min(...xs) < MCP_OUTLINE_MIN_W || Math.max(...ys) - Math.min(...ys) < MCP_OUTLINE_MIN_H) {
    return { error: 'The outline must span at least ' + MCP_OUTLINE_MIN_W + ' wide and ' + MCP_OUTLINE_MIN_H + ' high.' };
  }
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p.x * q.y - q.x * p.y; }
  if (area === 0) return { error: 'The outline points lie on one line; they must enclose an area.' };
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (_mwCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return { error: 'The outline crosses itself. List the points in order around the edge.' };
    }
  }
  return { points: pts };
}

// The exact spot of a card from { x, y }: { at } rounded, { at: null } when neither is given, or { error }.
function mcpSpotArg(raw) {
  if (!_mwHas(raw.x) && !_mwHas(raw.y)) return { at: null };
  const x = Math.round(Number(raw.x)), y = Math.round(Number(raw.y));
  if (!_mwHas(raw.x) || !_mwHas(raw.y) || !Number.isFinite(x) || !Number.isFinite(y)) return { error: 'An exact spot needs both x and y, as numbers, in Campaign units (the card\'s centre).' };
  return { at: { x, y } };
}

// The backdrop numbers a call changes, as { scale (a fraction), alpha, x, y } with only the given ones, or { error }.
function mcpBackdropArgs(raw) {
  const out = {};
  if (_mwHas(raw.scale)) {
    const v = Math.round(Number(raw.scale));
    if (!Number.isFinite(v) || v < MCP_BG_SCALE[0] || v > MCP_BG_SCALE[1]) return { error: 'scale is a percent from ' + MCP_BG_SCALE[0] + ' to ' + MCP_BG_SCALE[1] + '.' };
    out.scale = v / 100;
  }
  if (_mwHas(raw.opacity)) {
    const v = Number(raw.opacity);
    if (!Number.isFinite(v) || v < MCP_BG_ALPHA[0] || v > MCP_BG_ALPHA[1]) return { error: 'opacity is from ' + MCP_BG_ALPHA[0] + ' to 1.' };
    out.alpha = Math.round(v * 100) / 100;
  }
  for (const k of ['x', 'y']) {
    if (!_mwHas(raw[k])) continue;
    const v = Math.round(Number(raw[k]));
    if (!Number.isFinite(v)) return { error: k + ' must be a number in Campaign units (the picture\'s centre).' };
    out[k] = v;
  }
  return out;
}

// One road of `roads` ({ name, from, to }) by name, narrowed by its two ends: { index } or { error }.
function mcpFindRoad(roads, name, from, to) {
  const q = s => String(s || '').trim().toLowerCase();
  const hits = roads.map((r, index) => ({ r, index })).filter(h => q(h.r.name) === q(name));
  if (!hits.length) return { error: 'No road is called "' + (name || '') + '". list_campaign shows the roads.' };
  const narrow = hits.filter(h => (!q(from) || q(h.r.from) === q(from)) && (!q(to) || q(h.r.to) === q(to)));
  const ends = list => list.map(h => (h.r.from || 'nothing') + ' to ' + (h.r.to || 'nothing')).join('; ');
  if (narrow.length === 1) return { index: narrow[0].index };
  if (!narrow.length) return { error: 'No road called "' + name + '" joins those two. The ones with that name join: ' + ends(hits) + '.' };
  return { error: 'More than one road is called "' + name + '". Give from and to (the groups or maps it joins): ' + ends(narrow) + '.' };
}

function mcpWouldDeleteRoad(d) {
  const n = (c, w) => c + ' ' + w + (c === 1 ? '' : 's');
  return 'Would delete the road "' + d.name + '"' + (d.notes ? ' and its notes (' + n(d.notes, 'character') + ')' : ' (it has no notes)') + '. ' +
    (d.maps ? n(d.maps, 'map') + ' on it would stay where they are.' : 'No maps are on it.') + ' Nothing was deleted. Tell the DM what goes and, on their yes, call again with confirmed: true.';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mcpOutlineArg, mcpSpotArg, mcpBackdropArgs, mcpFindRoad, mcpWouldDeleteRoad };
}
