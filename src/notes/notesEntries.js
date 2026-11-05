'use strict';
// notesEntries.js — factions and lore, kept under their own key. The previous release never reads it, so a
// rollback leaves them waiting. A save that fails keeps the list here and reports once (notesSaveFailed).

const NOTES_ENTRIES_KEY = 'evermist.notesEntries';

let _neList = null;       // the list as last read or written
let _nePending = false;   // the last write failed, so this copy is the truth
let _neGone = null;       // { id: time } of the entries deleted (editStamps.js), kept with the list

function _neMint() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function notesEntriesAll() {
  if (_neList && _nePending) return _neList;
  try {
    const raw = JSON.parse(localStorage.getItem(NOTES_ENTRIES_KEY) || 'null');
    _neList = neClean(raw && raw.entries).entries;
    _neGone = esGoneClean(raw && raw.gone);
  } catch (_) { _neList = _neList || []; _neGone = _neGone || esGoneClean(null); }
  return _neList;
}

// The deletion records a backup carries.
function notesEntriesGone() {
  notesEntriesAll();
  return _neGone;
}

// `stamped` is the import's: its entries keep the times they arrived with, and `gone` is its merged deletion records.
// Every other write times its changes and notes what it deleted. An older build keeps the entries and drops `gone`.
function _neWrite(list, stamped, gone) {
  const before = notesEntriesAll(), now = Date.now();
  _neGone = stamped ? gone : neGone(_neGone, before, list, now);
  if (!stamped) list = neStamp(before, list, now);
  _neList = list;
  const saved = { v: 1, entries: list };
  if (Object.keys(_neGone).length) saved.gone = _neGone;
  try { localStorage.setItem(NOTES_ENTRIES_KEY, JSON.stringify(saved)); } catch (err) { _nePending = true; return notesSaveFailed('entries', err); }
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

// A backup's entries, joined to the library's. `goneFile` is the file's deletion records (an import); without it
// (an undo putting entries back) nothing is removed. Answers how many came in.
function notesEntriesAdopt(raw, goneFile) {
  const r = neMerge(notesEntriesAll(), raw, Date.now(), goneFile ? { here: _neGone, file: goneFile } : undefined);
  if (r.added || r.updated || r.removed || JSON.stringify(r.gone) !== JSON.stringify(_neGone)) _neWrite(r.entries, true, r.gone);
  return r.added;
}
