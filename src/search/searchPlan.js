'use strict';
// searchPlan.js — what the search answers, in pure functions: which entries a query matches, how well, the
// groups ordered by their strongest result, five a group, the words around a note hit, the recent list. No DOM.
//
// An entry is { key, kind, name, where, text }: `key` is unique ("map:<id>"), `text` the note a hit can land in.

const SP_PER_GROUP = 5;          // rows a group shows before "N more"
const SP_RECENT = 6;             // recently opened things kept and shown
const SP_NOTE = 4;               // the rank of a hit inside a note, below every kind of name hit

// The groups in the order a tie falls: maps first. A road sits with the groups; the campaign's own notes too.
const SP_GROUPS = [
  { id: 'map', label: 'Maps' }, { id: 'room', label: 'Rooms' }, { id: 'place', label: 'Groups and roads' },
  { id: 'monster', label: 'Monsters and NPCs' }, { id: 'faction', label: 'Factions' }, { id: 'lore', label: 'Lore' }, { id: 'fight', label: 'Fights' }, { id: 'music', label: 'Music' },
  { id: 'picture', label: 'Pictures' },
];

function spGroupOf(kind) { return kind === 'road' || kind === 'campaign' ? 'place' : kind; }

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

function _spClean(query) { return String(query || '').trim().toLowerCase(); }

// An entry's rank: its name's, else SP_NOTE when its note holds the query, else -1.
function spRank(entry, q) {
  const r = wfRank(entry.name, q);
  if (r >= 0) return r;
  return entry.text && String(entry.text).toLowerCase().includes(q) ? SP_NOTE : -1;
}

// Groups ordered by their own strongest result (ties by SP_GROUPS), each ranked, a result once.
// `open` is the set of group ids shown whole. Answers { groups: [{ id, label, total, more, rows }], total } where a
// row is { entry, rank }, and `more` counts the rows left out.
function spSearch(query, entries, open) {
  const q = _spClean(query);
  const out = { groups: [], total: 0 };
  if (!q) return out;
  const seen = new Set(), by = new Map();
  (entries || []).forEach((entry, i) => {
    if (seen.has(entry.key)) return;
    seen.add(entry.key);
    const rank = spRank(entry, q);
    if (rank < 0) return;
    const id = spGroupOf(entry.kind);
    if (!by.has(id)) by.set(id, []);
    by.get(id).push({ entry, rank, i });
  });
  const groups = [...by.entries()].map(([id, list]) => {
    list.sort((a, b) => a.rank - b.rank || a.i - b.i);
    return { id, best: list[0].rank, list };
  });
  const at = id => SP_GROUPS.findIndex(g => g.id === id);
  groups.sort((a, b) => a.best - b.best || at(a.id) - at(b.id));
  for (const g of groups) {
    const shown = open && open.has(g.id) ? g.list : g.list.slice(0, SP_PER_GROUP);
    out.groups.push({ id: g.id, label: SP_GROUPS[at(g.id)].label, total: g.list.length, more: g.list.length - shown.length,
      rows: shown.map(x => ({ entry: x.entry, rank: x.rank })) });
    out.total += g.list.length;
  }
  return out;
}

// The rows in the order the keys walk them.
function spFlat(found) { return found.groups.flatMap(g => g.rows); }

// The words around a note's hit: { pre, hit, post }, starting on a whole word, with an ellipsis where the note goes on.
// Newlines and runs of spaces count as one space. null when the note does not hold the query.
function spSnippet(text, query) {
  const q = _spClean(query), s = String(text || '').replace(/\s+/g, ' ').trim();
  const i = q ? s.toLowerCase().indexOf(q) : -1;
  if (i < 0) return null;
  let a = Math.max(0, i - 24);
  if (a > 0) {
    const sp = s.indexOf(' ', a);
    a = sp >= 0 && sp < i ? sp + 1 : s.lastIndexOf(' ', a) + 1;
    if (a > i) a = i;
  }
  const end = i + q.length + 50;
  return { pre: (a > 0 ? '…' : '') + s.slice(a, i), hit: s.slice(i, i + q.length), post: s.slice(i + q.length, end) + (end < s.length ? '…' : '') };
}

// The recent list after `key` was opened: first, once, at most SP_RECENT.
function spRecentAdd(list, key) {
  return [key].concat((Array.isArray(list) ? list : []).filter(k => k !== key)).slice(0, SP_RECENT);
}

// The recent keys as entries, dropping what is gone, so a deleted map leaves no dead row.
function spRecentRows(list, entries) {
  const by = new Map((entries || []).map(e => [e.key, e]));
  return (Array.isArray(list) ? list : []).map(k => by.get(k)).filter(Boolean).slice(0, SP_RECENT);
}

// The rows factions and lore add to the index: each entry by name, its note as the text a hit can land in, and
// the entry it sits under (or its section) as where.
function spNoteRows(entries, sectionName) {
  const byId = new Map(entries.map(e => [e.id, e]));
  return entries.map(e => ({
    key: 'entry:' + e.id, kind: e.kind, id: e.id, name: e.name,
    where: byId.has(e.parent) ? byId.get(e.parent).name : sectionName(e.kind), text: e.note || '',
  }));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SP_PER_GROUP, SP_RECENT, SP_NOTE, SP_GROUPS, spGroupOf, wfRank, wfHit, spRank, spSearch, spFlat, spSnippet, spRecentAdd, spRecentRows, spNoteRows };
}
