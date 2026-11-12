'use strict';
// notesOrder.js — the Notes tree's own order and groups in `evermist.notesOrder`: read, written list by list, merged from
// another computer or an import, and the item keys a list stores. The rules are notesOrderPlan.js.
// ⚠ NOTES-ONLY: the order here never touches `polygons`, a scene's `sortOrder` or the Campaign's group order.

let _noCache = null;

function notesOrderAll() {
  if (_noCache) return _noCache;
  let text = null;
  try { text = localStorage.getItem(NOTES_ORDER_KEY); } catch (_) { text = null; }
  _noCache = notesOrderParse(text) || notesOrderEmpty();
  return _noCache;
}

function notesOrderWrite(value) {
  _noCache = value;
  try { localStorage.setItem(NOTES_ORDER_KEY, JSON.stringify(value)); } catch (err) { notesSaveFailed('notesOrder', err); }
  syncNoteLocal(NOTES_ORDER_KEY);
}

function notesOrderGet(listKey) { return notesOrderList(notesOrderAll(), listKey); }

// One list replaced, or taken out with null (an undo back to no stored order).
function notesOrderPut(listKey, list) {
  const all = notesOrderAll(), next = notesOrderEmpty();
  for (const k of Object.keys(all.lists)) if (k !== listKey) next.lists[k] = all.lists[k];
  if (list) next.lists[listKey] = list;
  notesOrderWrite(next);
}

function notesOrderNewGid() { return '#' + esRandomUid(); }

// Another computer's copy or an import's: each list the newer of the two. Answers whether anything changed here.
function notesOrderAdopt(theirs) {
  if (!theirs) return false;
  const m = notesOrderMerge(notesOrderAll(), theirs);
  if (m.changed) notesOrderWrite(m.value);
  return m.changed;
}

// What campaign.json carries: null with nothing stored.
function notesOrderExport() {
  const all = notesOrderAll();
  return Object.keys(all.lists).length ? all : null;
}

// A campaign.json's order, its scene ids and group uids made the library's.
function notesOrderImport(raw, maps, groups) {
  let obj = null;
  try { obj = JSON.parse(raw); } catch (_) { return false; }
  return notesOrderAdopt(notesOrderRemap(obj && cleanNotesOrder(obj.notesOrder), maps, groups));
}
