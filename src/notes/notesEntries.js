'use strict';
// notesEntries.js — factions and lore, kept under their own key. The previous release never reads it, so a
// rollback leaves them waiting. A save that fails keeps the list here and reports once (notesSaveFailed).

const NOTES_ENTRIES_KEY = 'evermist.notesEntries';

let _neList = null;       // the list as last read or written
let _nePending = false;   // the last write failed, so this copy is the truth

function _neMint() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function notesEntriesAll() {
  if (_neList && _nePending) return _neList;
  try {
    const raw = JSON.parse(localStorage.getItem(NOTES_ENTRIES_KEY) || 'null');
    _neList = neClean(raw && raw.entries).entries;
  } catch (_) { _neList = _neList || []; }
  return _neList;
}

function _neWrite(list) {
  _neList = list;
  try { localStorage.setItem(NOTES_ENTRIES_KEY, JSON.stringify({ v: 1, entries: list })); } catch (err) { _nePending = true; return notesSaveFailed('entries', err); }
  _nePending = false;
  return true;
}

function notesEntryGet(id) { return neById(notesEntriesAll(), id); }

function notesEntryAdd(kind, name, parent) {
  const r = neAdd(notesEntriesAll(), kind, name, parent, _neMint());
  _neWrite(r.entries);
  return r.entry;
}

function notesEntryRename(id, name) { _neWrite(neRename(notesEntriesAll(), id, name)); }
function notesEntrySetNote(id, text) { _neWrite(neSetNote(notesEntriesAll(), id, text)); }
function notesEntryMove(id, parent, before) { _neWrite(neMove(notesEntriesAll(), id, parent, before)); }

// Where the window goes after the entry is gone: its parent entry's id, or null for the campaign note.
function notesEntryDelete(id) {
  const to = neFallback(notesEntriesAll(), id);
  _neWrite(neDelete(notesEntriesAll(), id).entries);
  return to;
}

// A backup's entries, joined to the library's. Answers how many came in.
function notesEntriesAdopt(raw) {
  const r = neMerge(notesEntriesAll(), raw);
  if (r.added) _neWrite(r.entries);
  return r.added;
}
