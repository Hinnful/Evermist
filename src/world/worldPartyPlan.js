'use strict';
// worldPartyPlan.js — the party marker's pure kernel: a record cleaned, where the marker stands, which map
// a point lands on, and the marker read from a backup's campaign.json. No DOM. Tested.
//
// A record is { x, y, scene? }: x and y are always the last spot, `scene` is the map it rides on.

const WPT_HIT_PX = 6;            // how far outside a card, in screen px, a release still lands on it

var wmUnknownFields;
if (typeof module !== 'undefined' && module.exports) ({ wmUnknownFields } = require('./worldMapPlan'));

const _wptNum = n => typeof n === 'number' && Number.isFinite(n);

// What is kept of a stored or imported marker: a spot, the map it rides on when that is a string, and any field a later release added. Null for anything else.
function wptClean(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!_wptNum(raw.x) || !_wptNum(raw.y) || Math.abs(raw.x) > 1e7 || Math.abs(raw.y) > 1e7) return null;
  // The marker is stored as it is, so its extra fields stay beside the known ones.
  const out = { ...wmUnknownFields(raw, ['x', 'y', 'scene', 'at']), x: Math.round(raw.x * 10) / 10, y: Math.round(raw.y * 10) / 10 };
  if (typeof raw.scene === 'string' && raw.scene && raw.scene.length <= 200) out.scene = raw.scene;
  if (_wptNum(raw.at) && raw.at > 0) out.at = raw.at;   // when the DM last put it down
  return out;
}

// The marker put down at `spot` ({ x, y }), on map `scene` or on bare ground, at time `now`. The one marker moves, so
// it keeps what a later release added to it.
function wptMoved(prev, spot, scene, now) {
  const out = { ...(prev ? wmUnknownFields(prev, ['x', 'y', 'scene', 'at']) : null), x: spot.x, y: spot.y };
  if (scene) out.scene = scene;
  out.at = now;
  return out;
}

// Whether an import's marker replaces the one here: when there is none here, or the file's was put down later. With
// no time on either side the one here stays.
function wptTake(local, incoming, moment) {
  if (!incoming) return false;
  if (!local) return true;
  const at = r => (_wptNum(r.at) && r.at > 0 ? Math.min(r.at, moment) : 0);
  const ti = at(incoming);
  return ti > 0 && ti >= at(local);
}

// The spot a marker takes on a map: centred on the top edge of its card. `pos` is the card's centre.
function wptAnchor(pos, cardH) {
  return { x: pos.x, y: pos.y - cardH / 2 };
}

// The map under `p`, or ''. `cards` are { id, x, y, hw, hh }: a centre and half sizes in world units. A point
// within `tol` of a card's edge counts; the nearest card wins, the first of equals.
function wptSceneAt(p, cards, tol) {
  let best = '', bd = Infinity;
  for (const c of cards) {
    const d = Math.hypot(Math.max(0, Math.abs(p.x - c.x) - c.hw), Math.max(0, Math.abs(p.y - c.y) - c.hh));
    if (d <= tol && d < bd) { bd = d; best = c.id; }
  }
  return best;
}

// The marker in a backup's campaign.json, or null when it holds none or is unreadable.
function wptParse(raw) {
  if (raw == null) return null;
  let obj = null;
  try { obj = JSON.parse(raw); } catch (_) { return null; }
  return obj && typeof obj === 'object' ? wptClean(obj.party) : null;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { WPT_HIT_PX, wptClean, wptMoved, wptTake, wptAnchor, wptSceneAt, wptParse };
