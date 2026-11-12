'use strict';
// notesOrderPlan.js — pure: the Notes tree's own order and groups (`evermist.notesOrder`): the key read back through a
// cleaner, one list's children put in order, the moves a drop makes, two copies merged list by list, and the ids an
// import remaps. The order rules are sceneGroups.js's. No DOM. Tested.
// { v:1, lists: { <list>: { at, order:[token], groups:{ <gid>: { name, members:[item] } } } } }. A list is its parent's
// key: campaign, place:<group uid>, map:<scene id>, roads, monster. A token is an item or a group id (`#…`). An item is a
// map's scene id, a group's uid, `<scene id>:<room uid>`, a road's uid or a monster's uid, never a numeric id.
// ⚠ AN ITEM THAT IS MISSING IS SKIPPED, NEVER PRUNED: a restored map, an undone room delete or a sync record ahead of
// its scene comes back to its old place and group.

const _NO = typeof libMove === 'function' ? { libMove, libHoldGroup, libRenameGroup } : require('../scenes/sceneGroups.js');

const NO_V = 1;
const NOTES_ORDER_KEY = 'evermist.notesOrder';
const NO_NAME_MAX = 60;
const _noOk = k => typeof k === 'string' && k.length > 0 && k.length <= 300 && !/[\u0000-\u001f]/.test(k) && k[0] !== '#';
const noIsGroup = k => typeof k === 'string' && /^#[0-9a-z]{1,40}$/.test(k);
const _noOwn = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

function noName(raw) {
  return String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NO_NAME_MAX);
}

function notesOrderEmpty() { return { v: NO_V, lists: Object.create(null) }; }
function noListEmpty() { return { at: 0, order: [], groups: Object.create(null) }; }

// One list read back: each item once, a group only with a name and a member, and every group's token in `order`.
function _noCleanList(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw.groups && typeof raw.groups === 'object' ? raw.groups : {};
  const seen = new Set(), groups = Object.create(null), order = [];
  const take = list => (Array.isArray(list) ? list : []).filter(k => _noOk(k) && !seen.has(k) && seen.add(k));
  const group = gid => {
    if (!noIsGroup(gid) || _noOwn(groups, gid) || !_noOwn(src, gid) || !src[gid] || typeof src[gid] !== 'object') return false;
    const name = noName(src[gid].name), members = take(src[gid].members);
    if (!name || !members.length) return false;
    groups[gid] = { name, members };
    return true;
  };
  for (const k of Array.isArray(raw.order) ? raw.order : []) {
    if (noIsGroup(k)) { if (group(k)) order.push(k); } else order.push(...take([k]));
  }
  for (const gid of Object.keys(src)) if (group(gid)) order.push(gid);
  return { at: Number.isFinite(raw.at) && raw.at > 0 ? raw.at : 0, order, groups };
}

function cleanNotesOrder(raw) {
  if (!raw || typeof raw !== 'object' || !raw.lists || typeof raw.lists !== 'object' || Array.isArray(raw.lists)) return null;
  const out = notesOrderEmpty();
  for (const k of Object.keys(raw.lists)) {
    const l = _noOk(k) ? _noCleanList(raw.lists[k]) : null;
    if (l) out.lists[k] = l;
  }
  return out;
}

function notesOrderParse(text) {
  if (typeof text !== 'string' || !text) return null;
  try { return cleanNotesOrder(JSON.parse(text)); } catch (_) { return null; }
}

function notesOrderList(value, key) { return value && _noOwn(value.lists, key) ? value.lists[key] : null; }

// ─── A list's children in order ──────────────────────────────────────────────

// `kids` in the order the tree built them, each with `okey` (null while it has none). Answers them in the list's order,
// a Notes group as { gid, name, kids }, then the ones the list does not hold in their built order. With `flat` a group's
// members stand in its place: the Campaign's lists take no Notes groups.
function notesOrderApply(list, kids, flat) {
  if (!list) return kids.slice();
  const by = new Map();
  for (const n of kids) if (n.okey != null && !by.has(n.okey)) by.set(n.okey, n);
  const used = new Set(), out = [];
  const pick = keys => keys.filter(k => by.has(k) && !used.has(k)).map(k => { used.add(k); return by.get(k); });
  for (const tok of list.order) {
    if (!_noOwn(list.groups, tok)) { out.push(...pick([tok])); continue; }
    const members = pick(list.groups[tok].members);
    if (!members.length) continue;
    if (flat) out.push(...members); else out.push({ gid: tok, name: list.groups[tok].name, kids: members });
  }
  return out.concat(kids.filter(n => n.okey == null || !used.has(n.okey)));
}

// ─── The moves a drop makes ──────────────────────────────────────────────────

function _noCopy(list) {
  const groups = Object.create(null);
  for (const g of Object.keys(list.groups)) groups[g] = { name: list.groups[g].name, members: list.groups[g].members.slice() };
  return { at: list.at, order: list.order.slice(), groups };
}

const _noL = list => ({ order: list.order.slice(), groups: _noCopy(list).groups, groupOrder: Object.keys(list.groups) });
const _noBack = (L, at) => ({ at, order: L.order.filter(k => !noIsGroup(k) || _noOwn(L.groups, k)), groups: L.groups });

// The list with every key in `keys` it does not hold yet added at the end, in that order: what is shown before a move,
// so a drop between two newcomers lands between them.
function notesOrderFill(list, keys) {
  const l = list ? _noCopy(list) : noListEmpty(), have = new Set(l.order);
  for (const g of Object.keys(l.groups)) for (const k of l.groups[g].members) have.add(k);
  for (const k of keys) if (_noOk(k) && !have.has(k)) { have.add(k); l.order.push(k); }
  return l;
}

// `key` (an item or a group id) out of wherever it is and into `group` (null: the list itself) before `before`, or
// last. A group never goes inside a group, and one nothing is in any more goes.
function notesOrderMove(list, key, group, before, at) {
  if (noIsGroup(key) && group != null) return _noCopy(list);
  return _noBack(_NO.libMove(_noL(list), [key], group, before), at);
}

// `drag` held over `target` and dropped: the two make the group `gid` where the target stood, the target first. A target
// already in a group takes the dragged item in, just after it.
function notesOrderHold(list, drag, target, gid, name, at) {
  if (drag === target || noIsGroup(drag) || noIsGroup(target)) return _noCopy(list);
  const holder = Object.keys(list.groups).find(g => list.groups[g].members.includes(target));
  if (holder) {
    const m = list.groups[holder].members.filter(k => k !== drag);
    return notesOrderMove(list, drag, holder, m[m.indexOf(target) + 1] || null, at);
  }
  const L = _noL(list);
  L.order = L.order.map(k => (k === target ? gid : k));
  return _noBack(_NO.libHoldGroup(L, drag, target, gid, noName(name)).L, at);
}

// The group goes and its members stand where it stood.
function notesOrderUngroup(list, gid, at) {
  if (!_noOwn(list.groups, gid)) return _noCopy(list);
  const out = _noCopy(list), members = out.groups[gid].members;
  delete out.groups[gid];
  out.order = [].concat(...out.order.map(k => (k === gid ? members : [k])));
  out.at = at;
  return out;
}

function notesOrderRename(list, gid, name, at) {
  const n = noName(name);
  if (!n || !_noOwn(list.groups, gid)) return _noCopy(list);
  return _noBack(_NO.libRenameGroup(_noL(list), gid, n), at);
}

// The item keys of a list, groups' members in place: what Claude reads as its order.
function notesOrderFlat(list) {
  if (!list) return [];
  return [].concat(...list.order.map(k => (_noOwn(list.groups, k) ? list.groups[k].members : [k])));
}

// A whole list as Claude sets it: `keys` the items top to bottom, `groups` [{ name, keys }] the Notes groups in the order
// their items are named (null keeps the ones `old` has, ordered by `keys`), each group where its first item stands. An
// item `old` held that is not here keeps its group or goes last, so it still comes back.
function notesOrderRebuild(old, keys, groups, at, newGid) {
  const base = old ? _noCopy(old) : noListEmpty(), of = new Map(), out = { at, order: [], groups: {} };
  const src = groups ? groups.map(g => ({ gid: newGid(), name: g.name, members: g.keys })) : Object.keys(base.groups).map(gid => ({ gid, ...base.groups[gid] }));
  for (const g of src) { out.groups[g.gid] = { name: noName(g.name), members: [] }; for (const k of g.members) if (!of.has(k)) of.set(k, g.gid); }
  const seen = new Set();
  const place = k => {
    if (seen.has(k)) return;
    const g = of.get(k);
    if (g && groups) {
      out.order.push(g);
      for (const m of src.find(x => x.gid === g).members) if (of.get(m) === g && !seen.has(m)) { seen.add(m); out.groups[g].members.push(m); }
      return;
    }
    seen.add(k);
    if (!g) { out.order.push(k); return; }
    if (!out.groups[g].members.length) out.order.push(g);
    out.groups[g].members.push(k);
  };
  keys.forEach(place);
  notesOrderFlat(base).forEach(place);
  return cleanNotesOrder({ lists: { x: out } }).lists.x;
}

// ─── Two copies ──────────────────────────────────────────────────────────────

// Each list the newer of the two, so a reorder of monsters here and of rooms there both survive; a list only one side
// has is kept. `changed` when `theirs` brought anything.
function notesOrderMerge(mine, theirs) {
  const out = notesOrderEmpty(), a = (mine && mine.lists) || {}, b = (theirs && theirs.lists) || {};
  let changed = false;
  for (const k of Object.keys(a)) out.lists[k] = a[k];
  for (const k of Object.keys(b)) {
    if (_noOwn(out.lists, k) && !(b[k].at > out.lists[k].at)) continue;
    if (!_noOwn(out.lists, k) || JSON.stringify(b[k]) !== JSON.stringify(out.lists[k])) changed = true;
    out.lists[k] = b[k];
  }
  return { value: out, changed };
}

// An import's ids made the library's: `maps` is { file scene id: library id }, `groups` { file group uid: library uid }.
function notesOrderRemap(value, maps, groups) {
  if (!value) return null;
  const m = maps || {}, g = groups || {};
  const tok = k => {
    if (_noOwn(m, k)) return m[k];
    if (_noOwn(g, k)) return g[k];
    const i = k.indexOf(':');
    return i > 0 && _noOwn(m, k.slice(0, i)) ? m[k.slice(0, i)] + k.slice(i) : k;
  };
  const listKey = k => (k.startsWith('map:') ? 'map:' + tok(k.slice(4)) : k.startsWith('place:') ? 'place:' + tok(k.slice(6)) : k);
  const lists = {};
  for (const k of Object.keys(value.lists)) {
    const l = value.lists[k], groupsOut = {};
    for (const gid of Object.keys(l.groups)) groupsOut[gid] = { name: l.groups[gid].name, members: l.groups[gid].members.map(tok) };
    lists[listKey(k)] = { at: l.at, order: l.order.map(x => (noIsGroup(x) ? x : tok(x))), groups: groupsOut };
  }
  return cleanNotesOrder({ v: NO_V, lists });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NO_V, NOTES_ORDER_KEY, noName, noIsGroup, notesOrderEmpty, noListEmpty, cleanNotesOrder, notesOrderParse,
    notesOrderList, notesOrderApply, notesOrderFill, notesOrderMove, notesOrderHold, notesOrderUngroup, notesOrderRename,
    notesOrderFlat, notesOrderRebuild, notesOrderMerge, notesOrderRemap };
}
