'use strict';

// ─── Scene groups ─────────────────────────────────────────────────────────────
// A group is a NAME a scene carries, never a container that holds scenes. The
// scene's own `group` field is the only truth, and it rides the scene record
// through IndexedDB and the backup zip like any other field.
//
// This module keeps the three things that field cannot express: the order the
// groups appear in, which ones are collapsed, and a group made before anything
// has been dragged into it. Those live in localStorage, deliberately — losing
// them costs a collapse state and an empty heading, never a map.

const SM_GROUPS_KEY  = 'evermist-scene-groups';
const SM_GROUP_MAXLEN = 40;

let smGroupOrder = [];   // group names, in display order (Ungrouped is not one of them)
let smGroupShut  = {};   // name → true while collapsed

// ── Pure kernel (unit-tested) ────────────────────────────────────────────────

// A group name is one line of trimmed text. Empty means ungrouped, which is why
// every read of a scene's group goes through this: an all-spaces name would
// otherwise make a heading nothing can ever be dragged out of.
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

// The stored order is a preference, not a record — a group name can appear on a
// scene that arrived from a backup zip long after the order was written. So the
// stored order leads, and any name it has never seen is appended.
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

// Splits scenes into display sections. Ungrouped is ALWAYS last and always
// present when it holds anything — filing is never forced, so a DM who groups
// nothing sees exactly the flat list they see today.
function buildGroupSections(scenes, order) {
  const list = scenes || [];
  const names = mergeGroupOrder(order, list.map(s => sanitizeGroupName(s && s.group)));
  const sections = names.map(name => ({
    name,
    ungrouped: false,
    scenes: list.filter(s => sanitizeGroupName(s && s.group) === name),
  }));
  const loose = list.filter(s => !sanitizeGroupName(s && s.group));
  if (loose.length || !sections.length) {
    sections.push({ name: '', ungrouped: true, scenes: loose });
  }
  return sections;
}

// ── DM-local persistence ─────────────────────────────────────────────────────

function loadGroupPrefs() {
  try {
    const raw = localStorage.getItem(SM_GROUPS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    smGroupOrder = Array.isArray(saved.order) ? saved.order.map(sanitizeGroupName).filter(Boolean) : [];
    smGroupShut  = (saved.shut && typeof saved.shut === 'object') ? saved.shut : {};
  } catch (e) { /* a corrupt preference is one flat list, not an error */ }
}

function saveGroupPrefs() {
  try {
    localStorage.setItem(SM_GROUPS_KEY, JSON.stringify({ order: smGroupOrder, shut: smGroupShut }));
  } catch (e) { /* storage full or blocked; the group field itself is already safe */ }
}

function sceneGroupSections(scenes) {
  smGroupOrder = mergeGroupOrder(smGroupOrder, (scenes || []).map(s => sanitizeGroupName(s && s.group)));
  return buildGroupSections(scenes, smGroupOrder);
}

function addGroup(name) {
  const n = uniqueGroupName(name, smGroupOrder);
  smGroupOrder.push(n);
  saveGroupPrefs();
  return n;
}

// Renaming rewrites the name on every scene wearing it; the caller persists those.
// Renaming onto a name already in use MERGES the two groups, and the filter below is what
// collapses the duplicate entry. The caller asks the DM first; this function does not.
function renameGroupInOrder(from, to) {
  const a = sanitizeGroupName(from), b = sanitizeGroupName(to);
  if (!a || !b || a === b) return a;
  smGroupOrder = smGroupOrder.map(n => (n === a ? b : n)).filter((n, i, arr) => arr.indexOf(n) === i);
  if (smGroupShut[a]) { smGroupShut[b] = true; delete smGroupShut[a]; }
  saveGroupPrefs();
  return b;
}

// Deleting a group deletes NO scenes. Everything in it falls back to Ungrouped.
function forgetGroup(name) {
  const n = sanitizeGroupName(name);
  smGroupOrder = smGroupOrder.filter(g => g !== n);
  delete smGroupShut[n];
  saveGroupPrefs();
}

function isGroupShut(name) { return !!smGroupShut[sanitizeGroupName(name)]; }

function toggleGroupShut(name) {
  const n = sanitizeGroupName(name);
  if (smGroupShut[n]) delete smGroupShut[n]; else smGroupShut[n] = true;
  saveGroupPrefs();
}

function knownGroupNames() { return smGroupOrder.slice(); }

if (typeof module !== 'undefined') {
  module.exports = { sanitizeGroupName, uniqueGroupName, mergeGroupOrder, buildGroupSections };
}
