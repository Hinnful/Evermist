'use strict';
// mentionPlan.js — the pure rules behind mentions between notes. A mention is stored inside a note's plain text as
// @[Shown name](kind:id), and everything else here reads or rewrites that form: parse, write, plain words, refresh
// the shown names, find the mentions of one id, and remap ids for a transfer import. No DOM.
//
// Ids are ones the app never reuses (room: <scene id>:<room uid>, monster: <uid>, group: <uid>, road: <uid>,
// map: <scene id>, entry: <id>, campaign). A token that does not parse cleanly to its closing ")" is plain words.

const MP_KINDS = ['room', 'monster', 'group', 'road', 'map', 'entry', 'campaign'];
const MP_ID = /^[A-Za-z0-9_-]{1,80}$/;
const MP_NAME_MAX = 200;

// The id part of a token: a room carries two ids joined by ":", every other kind one.
function mpIdOk(kind, id) {
  if (kind === 'room') { const p = id.split(':'); return p.length === 2 && MP_ID.test(p[0]) && MP_ID.test(p[1]); }
  return MP_ID.test(id);
}

function mpEscape(name) {
  return String(name == null ? '' : name).replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/]/g, '\\]');
}

// The stored token for a mention. An empty shown name would not parse back, so it falls back to the kind.
function mpToken(name, kind, id) {
  const shown = mpEscape(name).trim() ? mpEscape(name) : kind;
  return '@[' + shown + '](' + kind + ':' + id + ')';
}

// One token starting at `i` (the "@"), or null when it is not a clean one.
function _mpReadToken(s, i) {
  if (s[i + 1] !== '[') return null;
  let name = '', j = i + 2;
  for (; j < s.length && j - i <= MP_NAME_MAX; j++) {
    const c = s[j];
    if (c === '\n' || c === '\r') return null;
    if (c === '\\' && (s[j + 1] === '\\' || s[j + 1] === ']')) { name += s[j + 1]; j++; continue; }
    if (c === ']') break;
    name += c;
  }
  if (s[j] !== ']' || s[j + 1] !== '(' || !name) return null;
  const close = s.indexOf(')', j + 2);
  if (close < 0 || close - j > 200) return null;
  const body = s.slice(j + 2, close), at = body.indexOf(':');
  if (at < 1) return null;
  const kind = body.slice(0, at), id = body.slice(at + 1);
  if (!MP_KINDS.includes(kind) || !mpIdOk(kind, id)) return null;
  return { name, kind, id, end: close + 1 };
}

// Segments in order: { text } and { name, kind, id, raw }. Joined, their text and raw parts are the input.
function mpParse(text) {
  const s = String(text == null ? '' : text), out = [];
  let from = 0, i = s.indexOf('@[');
  while (i >= 0) {
    const m = _mpReadToken(s, i);
    if (m) {
      if (i > from) out.push({ text: s.slice(from, i) });
      out.push({ name: m.name, kind: m.kind, id: m.id, raw: s.slice(i, m.end) });
      from = m.end;
      i = s.indexOf('@[', from);
    } else i = s.indexOf('@[', i + 1);
  }
  if (from < s.length) out.push({ text: s.slice(from) });
  return out;
}

function _mpHas(text) { return typeof text === 'string' && text.indexOf('@[') >= 0; }

// What a reader sees: each mention as its shown name.
function mpPlain(text) {
  if (!_mpHas(text)) return typeof text === 'string' ? text : '';
  return mpParse(text).map(p => (p.text !== undefined ? p.text : p.name)).join('');
}

function mpMentions(text) {
  return _mpHas(text) ? mpParse(text).filter(p => p.kind) : [];
}

// "kind:id" as one string: what a mention is looked up by.
function mpRef(kind, id) { return kind + ':' + id; }

// True when `text` mentions the entry `ref` (see mpRef).
function mpFindRef(text, ref) {
  return mpMentions(text).some(m => mpRef(m.kind, m.id) === ref);
}

// The shown names brought up to date: `resolve(kind, id)` answers the current name or null for an entry that is
// gone (its words stay as they were). A refresh that would pass `cap` is refused and leaves the text alone.
function mpRefresh(text, resolve, cap) {
  if (!_mpHas(text)) return { text, changed: false, refused: false };
  let changed = false;
  const out = mpParse(text).map(p => {
    if (p.text !== undefined) return p.text;
    const now = resolve(p.kind, p.id);
    if (now == null || now === p.name) return p.raw;
    changed = true;
    return mpToken(now, p.kind, p.id);
  }).join('');
  if (!changed) return { text, changed: false, refused: false };
  if (out.length > cap && out.length > text.length) return { text, changed: false, refused: true };
  return { text: out, changed: out !== text, refused: false };
}

// A transfer import's new ids. `maps` is { oldSceneId: newSceneId } and `groups` { oldUid: newUid }. A map and its
// rooms follow the map's id. A mention whose rewrite would push the note past `cap` stays as it was and is counted.
function mpRemap(text, maps, groups, cap) {
  if (!_mpHas(text)) return { text, skipped: 0 };
  const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const parts = mpParse(text);
  let len = text.length, skipped = 0;
  const out = parts.map(p => {
    if (p.text !== undefined) return p.text;
    let id = p.id;
    if (p.kind === 'map' && own(maps, id)) id = maps[id];
    else if (p.kind === 'room') { const [scene, uid] = id.split(':'); if (own(maps, scene)) id = maps[scene] + ':' + uid; }
    else if (p.kind === 'group' && own(groups, id)) id = groups[id];
    if (id === p.id) return p.raw;
    const next = mpToken(p.name, p.kind, id);
    if (len - p.raw.length + next.length > cap) { skipped++; return p.raw; }
    len += next.length - p.raw.length;
    return next;
  });
  return { text: out.join(''), skipped };
}

// True when `add` still fits after `text` under `cap`: the check before a mention is written into a note.
function mpFits(text, add, cap) { return String(text || '').length + String(add || '').length <= cap; }

// The entries a picker lists for `query`: names that start with it first, then names that hold it, each group in
// the order given, at most `limit`. `list` is [{ name, ... }].
function mpRank(list, query, limit) {
  const q = String(query || '').trim().toLowerCase();
  const starts = [], holds = [];
  for (const e of list) {
    const n = String(e.name || '').toLowerCase();
    if (!q || n.startsWith(q)) starts.push(e);
    else if (n.includes(q)) holds.push(e);
  }
  return starts.concat(holds).slice(0, limit);
}

// Group uids: a map of group name to uid, kept beside the place notes. Null-prototype and own-key only, since a
// group may be called "constructor".
function mpGroupUidsNew() { return Object.create(null); }

function mpGroupUidsClean(raw) {
  const out = mpGroupUidsNew();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of Object.keys(raw)) if (typeof raw[k] === 'string' && MP_ID.test(raw[k])) out[k] = raw[k];
  return out;
}

// The group uids of a campaign.json; none when the file has no such key.
function mpParseGroupUids(raw) {
  if (raw == null) return mpGroupUidsNew();
  let obj = null;
  try { obj = JSON.parse(raw); } catch (_) { return mpGroupUidsNew(); }
  return mpGroupUidsClean(obj && obj.groupUids);
}

// A rename moves the uid to the new name. Onto a name that already has one, the target's stays.
function mpGroupUidsRename(map, from, to) {
  const out = mpGroupUidsClean(map);
  if (from === to || !Object.prototype.hasOwnProperty.call(out, from)) return out;
  if (!Object.prototype.hasOwnProperty.call(out, to)) out[to] = out[from];
  delete out[from];
  return out;
}

// The name a uid belongs to, or null.
function mpGroupNameOf(map, uid) {
  for (const k of Object.keys(map || {})) if (map[k] === uid) return k;
  return null;
}

// A transfer file's group uids against the library's. `incoming` and `local` are name -> uid; `renames` is
// [{ from, to }]: a local group the file renames, so the file's name finds the local one. Answers the map to
// keep (the local one plus the file's uids for names it had none for) and `remap`, { fileUid: localUid }.
function mpGroupUidsMerge(local, incoming, renames) {
  const keep = mpGroupUidsClean(local), remap = Object.create(null);
  const inc = mpGroupUidsClean(incoming);
  const own = (m, k) => Object.prototype.hasOwnProperty.call(m, k);
  for (const name of Object.keys(inc)) {
    const r = (renames || []).find(x => x.to === name);
    const there = own(keep, name) ? keep[name] : r && own(keep, r.from) ? keep[r.from] : null;
    if (there) { if (there !== inc[name]) remap[inc[name]] = there; } else keep[name] = inc[name];
  }
  return { keep, remap };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MP_KINDS, mpToken, mpParse, mpPlain, mpMentions, mpRef, mpFindRef, mpRefresh, mpRemap, mpRank, mpFits,
    mpGroupUidsNew, mpGroupUidsClean, mpParseGroupUids, mpGroupUidsRename, mpGroupNameOf, mpGroupUidsMerge,
  };
}
