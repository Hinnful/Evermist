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
  } catch (e) { /* storage full or blocked; the group field itself is already safe */ }
}

function addGroup(name) {
  const n = uniqueGroupName(name, smGroupOrder);
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

function knownGroupNames() { return smGroupOrder.slice(); }

if (typeof module !== 'undefined') {
  module.exports = { sanitizeGroupName, uniqueGroupName, mergeGroupOrder, buildGroupSections };
}
