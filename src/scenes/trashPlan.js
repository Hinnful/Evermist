'use strict';
// trashPlan.js — the pure rules of Recently deleted on this computer: the days an entry has left, which entries are
// due, the one list with the Drive's rows, and the road ends a map held when it went, put back on Restore.

const TRASH_DAYS = 30;
const TRASH_DAY_MS = 86400000;

// Whole days left in the window, counted up, never below 1 and never past the window (a clock set back).
function trashDaysLeft(at, now) {
  const left = Math.ceil((at + TRASH_DAYS * TRASH_DAY_MS - now) / TRASH_DAY_MS);
  return Math.max(1, Math.min(TRASH_DAYS, left));
}

function trashIsDue(at, now) { return now - at >= TRASH_DAYS * TRASH_DAY_MS; }

// The ids of the entries [{ id, at }] whose 30 days are up.
function trashDue(entries, now) { return entries.filter(e => trashIsDue(e.at, now)).map(e => e.id); }

// The one list, newest first: this computer's entries (a track's carrying its `hash`), then the Drive's rows not held
// here - a map by its id, a track (`music:<hash>`) by its hash.
function trashRows(local, drive) {
  const mine = new Set(local.map(e => (e.hash ? (e.kind || 'music') + ':' + e.hash : e.id)));
  const onDrive = new Set((drive || []).map(e => e.id));
  return local.map(e => ({ ...e, local: true, drive: onDrive.has(e.id) }))
    .concat((drive || []).filter(e => !mine.has(e.id)).map(e => ({ ...e, local: false, drive: true })))
    .sort((a, b) => b.at - a.at);
}

// What the map `id` held on the roads, read before its ends open: [{ uid, ends: [index], scene }], `scene` its entry
// on the road's list or null.
function trashRoadEnds(roads, id) {
  const out = [];
  for (const r of roads) {
    const ends = [];
    r.ends.forEach((e, i) => { if (e && e.kind === 'scene' && e.ref === id) ends.push(i); });
    const s = r.scenes.find(x => x.id === id);
    if (ends.length || s) out.push({ uid: r.uid, ends, scene: s ? { ...s } : null });
  }
  return out;
}

// A road the map comes back to: each end it held that is still open sticks to it again, and it is back on the road's
// list. An end attached elsewhere since stays where it is.
function trashReattach(road, id, held) {
  const ends = road.ends.map((e, i) => (held.ends.includes(i) && e && e.kind === null ? { kind: 'scene', ref: id } : e));
  const scenes = held.scene && !road.scenes.some(s => s.id === id) ? road.scenes.concat([{ ...held.scene }]) : road.scenes;
  return { ends, scenes };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TRASH_DAYS, TRASH_DAY_MS, trashDaysLeft, trashIsDue, trashDue, trashRows, trashRoadEnds, trashReattach };
}
