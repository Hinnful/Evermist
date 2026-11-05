'use strict';
// notesEntriesPlan.js — the pure rules behind factions and lore: a list of entries cleaned, and what adding,
// renaming, moving, ordering, deleting and restoring one does to it. An entry is
// { id, kind: 'faction'|'lore', name, note, parent, order }; `parent` is the section (the kind itself) or the id
// of another entry of the same kind.

const NE_KINDS = ['faction', 'lore'];
const NE_NAME_MAX = 60;

function _neSanitize(raw) {
  return (typeof notesSanitize === 'function' ? notesSanitize : require('./notesPlan.js').notesSanitize)(raw);
}

function neCleanName(raw) {
  return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, NE_NAME_MAX);
}

// ⚠ NEVER NORMALISED FROM A FIXED KEY LIST: an entry keeps the fields it was written with, so a later release's
// extra field survives a round trip through this one.
function neClean(raw) {
  const seen = new Set(), kept = [];
  let dropped = !Array.isArray(raw);
  for (const e of Array.isArray(raw) ? raw : []) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !e.id || seen.has(e.id) || !NE_KINDS.includes(e.kind)) { dropped = true; continue; }
    seen.add(e.id);
    const note = _neSanitize(e.note);
    if (note.dropped) dropped = true;
    kept.push({ ...e, name: neCleanName(e.name) || 'Untitled', note: note.text, parent: typeof e.parent === 'string' ? e.parent : e.kind,
                order: Number.isFinite(e.order) ? e.order : 0 });
  }
  const byId = new Map(kept.map(e => [e.id, e]));
  // A parent that is not a section of the kind or an entry of the kind, or that loops back, becomes the section.
  for (const e of kept) {
    let p = e.parent, hops = 0;
    while (p !== e.kind && byId.has(p) && byId.get(p).kind === e.kind && p !== e.id && hops++ <= kept.length) p = byId.get(p).parent;
    if (p !== e.kind) e.parent = e.kind;
  }
  return { entries: kept, dropped };
}

function neChildren(entries, parent) {
  return entries.filter(e => e.parent === parent).sort((a, b) => a.order - b.order);
}

function neById(entries, id) { return entries.find(e => e.id === id) || null; }

// The ids under `id`, itself not included.
function neDescendants(entries, id) {
  const out = [];
  const walk = p => { for (const e of entries.filter(x => x.parent === p)) { out.push(e.id); walk(e.id); } };
  walk(id);
  return out;
}

function _neNextOrder(entries, parent) {
  const sibs = entries.filter(e => e.parent === parent);
  return sibs.length ? Math.max(...sibs.map(e => e.order)) + 1 : 0;
}

// A new entry at the end of its siblings. `parent` is a section or an entry id; anything else is the section.
function neAdd(entries, kind, name, parent, id) {
  const p = parent === kind || (neById(entries, parent) && neById(entries, parent).kind === kind) ? parent : kind;
  const e = { id, kind, name: neCleanName(name) || 'Untitled', note: '', parent: p, order: _neNextOrder(entries, p) };
  return { entries: entries.concat(e), entry: e };
}

function neRename(entries, id, name) {
  const n = neCleanName(name);
  return n ? entries.map(e => (e.id === id ? { ...e, name: n } : e)) : entries;
}

function neSetNote(entries, id, text) {
  const note = _neSanitize(text).text;
  return entries.map(e => (e.id === id ? { ...e, note } : e));
}

// Moves `id` under `parent`, before sibling `before` (or last). Refused into itself, into its own descendant, or
// into another kind, which leaves the list as it was.
function neMove(entries, id, parent, before) {
  const e = neById(entries, id);
  if (!e) return entries;
  const into = neById(entries, parent);
  if (parent !== e.kind && (!into || into.kind !== e.kind)) return entries;
  if (parent === id || neDescendants(entries, id).includes(parent)) return entries;
  const sibs = neChildren(entries, parent).filter(x => x.id !== id);
  const at = before ? sibs.findIndex(x => x.id === before) : -1;
  sibs.splice(at < 0 ? sibs.length : at, 0, e);
  const order = new Map(sibs.map((x, i) => [x.id, i]));
  return entries.map(x => (x.id === id ? { ...x, parent, order: order.get(x.id) } : order.has(x.id) ? { ...x, order: order.get(x.id) } : x));
}

// The entry and everything under it go; `removed` says how many, for the question that asks first.
function neDelete(entries, id) {
  const gone = new Set([id, ...neDescendants(entries, id)]);
  return { entries: entries.filter(e => !gone.has(e.id)), removed: entries.filter(e => gone.has(e.id)).length };
}

// Where the window goes when the entry it shows is deleted: its parent entry, else null (the campaign note).
function neFallback(entries, id) {
  const e = neById(entries, id);
  return e && neById(entries, e.parent) ? e.parent : null;
}

const _neContent = e => JSON.stringify([e.name, e.note, e.parent]);

// `edited` is when an entry's name, note or place last changed; one with none is the oldest. `before` is the list as
// stored, `after` the one about to be.
function neStamp(before, after, now) {
  const was = new Map(before.map(e => [e.id, e]));
  return after.map(e => {
    const b = was.get(e.id);
    return !b || _neContent(b) !== _neContent(e) ? { ...e, edited: now } : e;
  });
}

function _neTime(e, moment) { return Number.isFinite(e.edited) && e.edited > 0 ? Math.min(e.edited, moment) : 0; }

// A restore adds the entries the library lacks, and an entry both hold takes the copy edited later; with no time on
// either side the one here stays. An added entry whose parent did not come along goes under its section, and so does
// a taken one whose parent is not here or sits inside it.
function neMerge(existing, incoming, now) {
  const moment = now || Date.now();
  const have = new Map(existing.map(e => [e.id, e]));
  const inc = neClean(incoming).entries;
  const fresh = inc.filter(e => !have.has(e.id));
  const ids = new Set(existing.concat(fresh).map(e => e.id));
  const added = fresh.map(e => {
    return ids.has(e.parent) || e.parent === e.kind ? e : { ...e, parent: e.kind };
  });
  let entries = existing.concat(added), updated = 0;
  for (const e of inc) {
    const mine = have.get(e.id);
    if (!mine || mine.kind !== e.kind || _neContent(mine) === _neContent(e)) continue;
    const ti = _neTime(e, moment);
    if (!(ti > 0 && ti >= _neTime(mine, moment))) continue;
    const into = neById(entries, e.parent);
    const okParent = e.parent === e.kind || (into && into.kind === e.kind && e.parent !== e.id && !neDescendants(entries, e.id).includes(e.parent));
    const parent = okParent ? e.parent : e.kind;
    const order = parent === mine.parent ? mine.order : _neNextOrder(entries, parent);
    entries = entries.map(x => (x.id === e.id ? { ...x, name: e.name, note: e.note, parent, order, edited: ti } : x));
    updated++;
  }
  return { entries, added: added.length, updated };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NE_KINDS, neCleanName, neClean, neChildren, neById, neDescendants, neAdd, neRename, neSetNote, neMove, neDelete, neFallback, neStamp, neMerge };
}
