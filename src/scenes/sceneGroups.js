'use strict';

// ─── Scene groups ─────────────────────────────────────────────────────────────
// A group is a NAME a scene carries, never a container; on the world map it is a place. The scene's own
// `group` field is the only truth, and it rides the record through IndexedDB and the backup zip.
//
// This module keeps what that field cannot express: the order the names came in, and a name made before
// anything was filed under it. That lives in localStorage, where losing it costs an order, never a map.

const SM_GROUPS_KEY  = 'evermist-scene-groups';
const SM_GROUP_MAXLEN = 40;

let smGroupOrder = [];   // group names, in the order they came

// ── Pure kernel (unit-tested) ────────────────────────────────────────────────

// A group name is one line of trimmed text, and empty means ungrouped. Every read goes through
// this, or an all-spaces name makes a heading nothing can be dragged out of.
function sanitizeGroupName(raw) {
  return String(raw == null ? '' : raw)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SM_GROUP_MAXLEN);
}

function uniqueGroupName(base, taken) {
  const want = sanitizeGroupName(base) || 'Group';
  const used = new Set((taken || []).map(sanitizeGroupName));
  if (!used.has(want)) return want;
  for (let n = 2; n < 1000; n++) {
    const tryName = sanitizeGroupName(want + ' ' + n);
    if (!used.has(tryName)) return tryName;
  }
  return want;
}

// The stored order is a preference, not a record: a name can arrive on a scene from a backup zip
// long after the order was written. The stored order leads, and unseen names are appended.
function mergeGroupOrder(storedOrder, namesInUse) {
  const inUse = new Set((namesInUse || []).map(sanitizeGroupName).filter(Boolean));
  const out = [];
  const seen = new Set();
  for (const raw of (storedOrder || [])) {
    const n = sanitizeGroupName(raw);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  for (const n of inUse) {
    if (!seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}

// Splits scenes into display sections. Ungrouped is ALWAYS last and ALWAYS present: a DM who
// groups nothing sees a flat list, and one who files everything can still drag a card back out.
function buildGroupSections(scenes, order) {
  const list = scenes || [];
  const names = mergeGroupOrder(order, list.map(s => sanitizeGroupName(s && s.group)));
  const sections = names.map(name => ({
    name,
    ungrouped: false,
    scenes: list.filter(s => sanitizeGroupName(s && s.group) === name),
  }));
  const loose = list.filter(s => !sanitizeGroupName(s && s.group));
  sections.push({ name: '', ungrouped: true, scenes: loose });
  return sections;
}

// ── DM-local persistence ─────────────────────────────────────────────────────

function loadGroupPrefs() {
  try {
    const raw = localStorage.getItem(SM_GROUPS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    smGroupOrder = Array.isArray(saved.order) ? saved.order.map(sanitizeGroupName).filter(Boolean) : [];
  } catch (e) { /* a corrupt preference is one flat list, not an error */ }
}

function saveGroupPrefs() {
  try {
    localStorage.setItem(SM_GROUPS_KEY, JSON.stringify({ order: smGroupOrder }));
  } catch (err) { notesSaveFailed('groups', err); }
}

// ⚠ UNIQUE AGAINST EVERY NAME IN USE, not the saved order alone: a place restored from a backup never
// enters the order, and a new group taking its name overwrites its outline.
function addGroup(name) {
  const places = typeof worldPlaceRecords === 'function' ? worldPlaceRecords().map(r => r.name) : [];
  const n = uniqueGroupName(name, smGroupOrder.concat(places));
  smGroupOrder.push(n);
  saveGroupPrefs();
  return n;
}

// Renaming rewrites the name on every scene wearing it, and the caller persists those. Renaming
// onto a name already in use MERGES the two groups. The caller asks the DM first, not this.
function renameGroupInOrder(from, to) {
  const a = sanitizeGroupName(from), b = sanitizeGroupName(to);
  if (!a || !b || a === b) return a;
  smGroupOrder = smGroupOrder.map(n => (n === a ? b : n)).filter((n, i, arr) => arr.indexOf(n) === i);
  saveGroupPrefs();
  return b;
}

// Deleting a group deletes NO scenes. Everything in it falls back to Ungrouped.
function forgetGroup(name) {
  const n = sanitizeGroupName(name);
  smGroupOrder = smGroupOrder.filter(g => g !== n);
  saveGroupPrefs();
}

// A name coming back with its place (an undo or redo) re-enters the order as it was: addGroup would
// see the restored place and hand out "New group 2".
function restoreGroupName(name) {
  const n = sanitizeGroupName(name);
  if (!n || smGroupOrder.includes(n)) return;
  smGroupOrder.push(n);
  saveGroupPrefs();
}

function knownGroupNames() { return smGroupOrder.slice(); }

// ─── A library's order (pure, unit-tested) ───────────────────────────────────
// Music, Sounds and Pictures share one shape: `order` is Ungrouped's items, `groups[key]` a group's `name` and
// `members`, `groupOrder` the headings. A key no longer present (a deleted item, a sync placeholder) keeps its
// place, so a restore lands back in its group; only what is present is shown.

const LIB_BUILTIN = 'builtin:';
const libBuiltinKey = file => LIB_BUILTIN + file;
const libIsBuiltin = key => typeof key === 'string' && key.startsWith(LIB_BUILTIN);
const libBuiltinOf = key => (libIsBuiltin(key) ? key.slice(LIB_BUILTIN.length) : null);

function libEmpty() { return { order: [], groups: Object.create(null), groupOrder: [] }; }

function libClone(L) {
  const groups = Object.create(null);
  for (const g of Object.keys(L.groups)) groups[g] = Object.assign({}, L.groups[g], { members: L.groups[g].members.slice() });
  return { order: L.order.slice(), groups, groupOrder: L.groupOrder.slice() };
}

// Where a key sits: { group } (null for Ungrouped) and its index there, or null.
function libWhere(L, key) {
  const i = L.order.indexOf(key);
  if (i !== -1) return { group: null, index: i };
  for (const g of L.groupOrder) {
    const j = L.groups[g].members.indexOf(key);
    if (j !== -1) return { group: g, index: j };
  }
  return null;
}

// Each key once, every group listed once, and each present key not placed yet at the top of Ungrouped in the
// order given. `present` is the library as listed now.
function libNormalize(L, present) {
  const out = libEmpty(), seen = new Set();
  const take = list => list.filter(k => typeof k === 'string' && k && !seen.has(k) && seen.add(k));
  const gks = (L.groupOrder || []).concat(Object.keys(L.groups || {})).filter((g, i, a) => L.groups[g] && a.indexOf(g) === i);
  for (const g of gks) {
    out.groups[g] = Object.assign({}, L.groups[g], { members: take(L.groups[g].members || []) });
    out.groupOrder.push(g);
  }
  const loose = take(L.order || []);
  const fresh = take(present || []);
  out.order = fresh.concat(loose);
  return out;
}

// What the pane draws: Ungrouped first, then each group holding a present item, its present items in order.
function libSections(L, present) {
  const have = new Set(present || []);
  const out = [{ key: null, items: L.order.filter(k => have.has(k)) }];
  for (const g of L.groupOrder) {
    const items = L.groups[g].members.filter(k => have.has(k));
    if (items.length) out.push({ key: g, name: L.groups[g].name, items });
  }
  return out;
}

const _libList = (L, g) => (g == null ? L.order : L.groups[g] ? L.groups[g].members : null);

// A group nothing is in any more goes.
function _libDropEmpty(L) {
  for (const g of L.groupOrder.slice()) {
    if (L.groups[g].members.length) continue;
    delete L.groups[g];
    L.groupOrder = L.groupOrder.filter(x => x !== g);
  }
  return L;
}

// `keys` out of wherever they are and into `group` (null: Ungrouped) before `before`, or at the end.
function libMove(L, keys, group, before) {
  const out = libClone(L), set = new Set(keys);
  if (!_libList(out, group)) return out;
  out.order = out.order.filter(k => !set.has(k));
  for (const g of out.groupOrder) out.groups[g].members = out.groups[g].members.filter(k => !set.has(k));
  const list = _libList(out, group);
  const at = before != null && list.indexOf(before) !== -1 ? list.indexOf(before) : list.length;
  list.splice(at, 0, ...keys);
  return _libDropEmpty(out);
}

// The same move with the place given as a position among the keys present there, as Claude names it.
function libMoveTo(L, keys, group, index, present) {
  const have = new Set(present || []), set = new Set(keys);
  const list = (_libList(L, group) || []).filter(k => have.has(k) && !set.has(k));
  const i = Math.max(0, Math.min(Number.isFinite(index) ? Math.floor(index) : list.length, list.length));
  return libMove(L, keys, group, i < list.length ? list[i] : null);
}

// Held over another item and dropped: the two make a new group `gk` named `name`, the target first, both taken out of
// wherever they were. The group goes where the target's group was, or first after Ungrouped. Answers { L, group, made }.
function libHoldGroup(L, drag, target, gk, name) {
  if (drag === target) return { L: libClone(L), group: null, made: false };
  const at = libWhere(L, target), out = libClone(L);
  out.order = out.order.filter(k => k !== drag && k !== target);
  for (const g of out.groupOrder) out.groups[g].members = out.groups[g].members.filter(k => k !== drag && k !== target);
  out.groups[gk] = { name, members: [target, drag] };
  const i = at && at.group != null ? out.groupOrder.indexOf(at.group) : 0;
  out.groupOrder.splice(Math.max(0, i), 0, gk);
  return { L: _libDropEmpty(out), group: gk, made: true };
}

function libRenameGroup(L, gk, name) {
  const out = libClone(L);
  if (out.groups[gk]) out.groups[gk].name = name;
  return out;
}

// `from`'s items join the end of `into`, and `from` goes. The caller asks the DM first.
function libMergeGroups(L, from, into) {
  if (from === into || !L.groups[from] || !L.groups[into]) return libClone(L);
  const out = libClone(L);
  out.groups[into].members = out.groups[into].members.concat(out.groups[from].members.filter(k => !out.groups[into].members.includes(k)));
  delete out.groups[from];
  out.groupOrder = out.groupOrder.filter(g => g !== from);
  return out;
}

// The heading goes and its items join the end of Ungrouped.
function libUngroup(L, gk) {
  if (!L.groups[gk]) return libClone(L);
  const out = libClone(L);
  out.order = out.order.concat(out.groups[gk].members);
  delete out.groups[gk];
  out.groupOrder = out.groupOrder.filter(g => g !== gk);
  return out;
}

// The group whose shown name is `name`, ignoring case, other than `except`; `nameOf(gk)` is what the DM reads.
function libGroupNamed(L, name, nameOf, except) {
  const want = sanitizeGroupName(name).toLocaleLowerCase();
  return L.groupOrder.find(g => g !== except && sanitizeGroupName(nameOf(g)).toLocaleLowerCase() === want) || null;
}

// The Sounds pane's starting layout: "My sounds" with the DM's own files, then the built-in groups, each keyed by its
// English name and shown in the interface language until renamed.
function libSoundsSeed(soundGroups, own) {
  const L = libEmpty();
  const add = (gk, members) => { L.groups[gk] = { members }; L.groupOrder.push(gk); };
  add(libBuiltinKey('My sounds'), (own || []).slice());
  for (const g of soundGroups || []) add(libBuiltinKey(g.name), g.sounds.map(s => libBuiltinKey(s.file)));
  return L;
}

if (typeof module !== 'undefined') {
  module.exports = { sanitizeGroupName, uniqueGroupName, mergeGroupOrder, buildGroupSections,
    libBuiltinKey, libIsBuiltin, libBuiltinOf, libEmpty, libClone, libWhere, libNormalize, libSections, libMove, libMoveTo,
    libHoldGroup, libRenameGroup, libMergeGroups, libUngroup, libGroupNamed, libSoundsSeed };
}
