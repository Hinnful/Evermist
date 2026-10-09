'use strict';
// notesPlan.js — the pure rules behind the left panel's notes: the crumb list, the cleaning of a
// notes string, and the merge of a restored campaign note into the one the DM has.

const NOTES_SEPARATOR = '\n\n---\n\n';

// The room cap, read from roomPanel.js so there is one number. Lazy: that file loads after this one.
function _notesCap() {
  return typeof ROOM_DESC_MAX !== 'undefined' ? ROOM_DESC_MAX : require('../rooms/roomPanel.js').ROOM_DESC_MAX;
}

// `names` carries the labels: { campaign, place, road, scene, room }. Each crumb after the campaign exists
// only when its label does: a place for a scene in a group, a road for a road or a scene on one, a room
// with a room selected.
function notesCrumbs(names) {
  const n = names || {};
  const out = [{ level: 'campaign', label: n.campaign }];
  if (n.place != null) out.push({ level: 'place', label: n.place });
  if (n.road != null) out.push({ level: 'road', label: n.road });
  if (n.scene != null) out.push({ level: 'scene', label: n.scene });
  if (n.room != null) out.push({ level: 'room', label: n.room });
  return out;
}

// Missing is a normal empty note. Any other non-string is dropped and reported, so the caller can
// name the scene it came from.
function notesSanitize(raw) {
  if (raw == null) return { text: '', dropped: false };
  if (typeof raw !== 'string') return { text: '', dropped: true };
  return { text: raw.slice(0, _notesCap()).trim(), dropped: false };
}

// The restored text never replaces what the DM has. It joins below a separator, once, and only
// when it fits; otherwise the DM's text stays untouched and `tooLong` says so.
function notesMergeCampaign(existing, incoming) {
  const cur = typeof existing === 'string' ? existing : '';
  const add = notesSanitize(incoming).text;
  if (!add || !cur.trim()) return { text: cur.trim() ? cur : add, tooLong: false };
  if (cur.includes(add)) return { text: cur, tooLong: false };
  const joined = cur + NOTES_SEPARATOR + add;
  if (joined.length > _notesCap()) return { text: cur, tooLong: true };
  return { text: joined, tooLong: false };
}

// Place notes are a map of place name to text. ⚠ NULL-PROTOTYPE, and only ever read with an own-key
// test: a place named "constructor" or "__proto__" is an ordinary name.
function notesPlacesNew() { return Object.create(null); }

function _notesOwn(map, key) { return !!map && Object.prototype.hasOwnProperty.call(map, key); }

function notesPlacesCopy(map) {
  const out = notesPlacesNew();
  for (const k of Object.keys(map || {})) if (typeof map[k] === 'string') out[k] = map[k];
  return out;
}

// What is kept of a parsed `places`: own string keys with string values, each cleaned. Anything that
// is not a plain object is dropped whole, and any value that is not a string is dropped and reported.
function notesPlacesClean(raw) {
  const places = notesPlacesNew();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { places, dropped: true };
  let dropped = false;
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (typeof v !== 'string') { dropped = true; continue; }
    const text = notesSanitize(v).text;
    if (text) places[k] = text;
  }
  return { places, dropped };
}

// The campaign.json at a backup's root. Null when there is nothing to carry, so the zip looks as it
// always did.
function notesCampaignPayload(text, places, shapes, roads, roadNotes) {
  const hasText = typeof text === 'string' && !!text.trim();
  const named = notesPlacesNew();
  for (const k of Object.keys(places || {})) if (typeof places[k] === 'string' && places[k].trim()) named[k] = places[k];
  const hasPlaces = Object.keys(named).length > 0;
  const drawn = shapes && Object.keys(shapes).length > 0;
  const laid = roads && Object.keys(roads).length > 0;
  if (!hasText && !hasPlaces && !drawn && !laid) return null;
  const out = {};
  if (hasText) out.notes = text;
  if (hasPlaces) out.places = named;
  if (drawn) out.placeShapes = shapes;
  if (laid) {
    out.roads = roads;
    // Only a road that is in the file carries notes, so a deleted road's note does not ride along.
    const said = notesPlacesNew();
    for (const k of Object.keys(roadNotes || {})) if (_notesOwn(roads, k) && typeof roadNotes[k] === 'string' && roadNotes[k].trim()) said[k] = roadNotes[k];
    if (Object.keys(said).length) out.roadNotes = said;
  }
  return JSON.stringify(out);
}

// The place notes of a campaign.json. A file that does not parse is the campaign notes' to report, so
// this answers nothing for it; a `places` that is not a plain object, or holds a non-string, is broken.
function notesParsePlaces(raw) {
  if (raw == null) return { places: notesPlacesNew(), broken: false };
  let obj = null;
  try { obj = JSON.parse(raw); } catch (_) { return { places: notesPlacesNew(), broken: false }; }
  if (!obj || typeof obj !== 'object' || !_notesOwn(obj, 'places')) return { places: notesPlacesNew(), broken: false };
  const c = notesPlacesClean(obj.places);
  return { places: c.places, broken: c.dropped };
}

// The road notes of a campaign.json, keyed by road. Read like the place notes: a `roadNotes` that is not a
// plain object, or holds a non-string, is broken.
function notesParseRoadNotes(raw) {
  if (raw == null) return { notes: notesPlacesNew(), broken: false };
  let obj = null;
  try { obj = JSON.parse(raw); } catch (_) { return { notes: notesPlacesNew(), broken: false }; }
  if (!obj || typeof obj !== 'object' || !_notesOwn(obj, 'roadNotes')) return { notes: notesPlacesNew(), broken: false };
  const c = notesPlacesClean(obj.roadNotes);
  return { notes: c.places, broken: c.dropped };
}

// A map of notes under new keys: `keys` is { oldKey: newKey }, and a note whose key is not in it is dropped.
function notesRekey(map, keys) {
  const out = notesPlacesNew();
  for (const k of Object.keys(map || {})) if (_notesOwn(keys, k) && typeof map[k] === 'string') out[keys[k]] = map[k];
  return out;
}

// Each restored place note joins the DM's own like the campaign note does. `tooLong` names the places
// whose join would pass the cap, which keep the DM's text.
function notesMergePlaces(existing, incoming) {
  const map = notesPlacesCopy(existing);
  const tooLong = [];
  for (const name of Object.keys(incoming || {})) {
    const r = notesMergeCampaign(_notesOwn(map, name) ? map[name] : '', incoming[name]);
    if (r.tooLong) tooLong.push(name);
    if (r.text) map[name] = r.text;
  }
  return { map, tooLong };
}

// A rename moves a place's notes to its new name, or joins them below the notes already there. A join
// that would pass the cap leaves them under the old name, so nothing is lost.
function notesRenamePlace(map, from, to) {
  const out = notesPlacesCopy(map);
  if (from === to || !_notesOwn(out, from)) return { map: out, kept: false };
  const target = _notesOwn(out, to) ? out[to] : '';
  const r = notesMergeCampaign(target, out[from]);
  if (r.tooLong) return { map: out, kept: true };
  out[to] = r.text;
  delete out[from];
  return { map: out, kept: false };
}

// A missing file is normal. A file that does not parse, or whose notes are not a string, is broken
// and says so, so the caller can name it.
function notesParseCampaign(raw) {
  if (raw == null) return { text: '', broken: false };
  let obj = null;
  try { obj = JSON.parse(raw); } catch (_) { return { text: '', broken: true }; }
  if (!obj || typeof obj !== 'object') return { text: '', broken: true };
  const s = notesSanitize(obj.notes);
  return { text: s.text, broken: s.dropped };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    NOTES_SEPARATOR, notesCrumbs, notesSanitize, notesMergeCampaign, notesCampaignPayload, notesParseCampaign,
    notesPlacesNew, notesPlacesCopy, notesPlacesClean, notesParsePlaces, notesMergePlaces, notesRenamePlace,
    notesParseRoadNotes, notesRekey,
  };
}
