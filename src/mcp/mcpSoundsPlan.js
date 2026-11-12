'use strict';
// mcpSoundsPlan.js — pure rules behind Claude's sound tools, and the lookups the picture tools share: an item found by
// the name the DM reads, two items with one name refused with both named, a group by name, a position, the delete
// question. No DOM. Tested.

const _msLow = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLocaleLowerCase();

// Items [{ key, label, group }] by name: the exact shown name or key first, else every item whose name holds the text.
function mcpLibFind(items, name) {
  const q = _msLow(name);
  if (!q) return [];
  const exact = (items || []).filter(x => _msLow(x.label) === q || _msLow(x.key) === q);
  return exact.length ? exact : (items || []).filter(x => _msLow(x.label).includes(q));
}

// Where an item sits, for telling two of one name apart.
function _msWhere(x) {
  return (x.group ? 'in "' + x.group + '"' : 'in no group') + (x.file ? ', file ' + x.file : x.builtin ? ', built in' : '');
}

// One item, or why not: { item } | { error }. `noun` is what the DM calls one, `lister` the tool that lists them.
function mcpLibOne(items, name, noun, lister) {
  const hits = mcpLibFind(items, name);
  if (hits.length === 1) return { item: hits[0] };
  if (!hits.length) return { error: 'No ' + noun + ' is called "' + (name || '') + '". ' + lister + ' shows them.' };
  const same = hits.every(h => _msLow(h.label) === _msLow(hits[0].label));
  const named = hits.slice(0, 8).map(h => '"' + h.label + '" (' + _msWhere(h) + ')').join(', ');
  return { error: (same ? 'Two or more ' + noun + 's are called "' + hits[0].label + '": ' : 'More than one ' + noun + ' matches "' + name + '": ') +
    named + '. ' + (same ? 'Ask the DM which one, or rename one first.' : 'Use more of the name.') };
}

// Several items at once, every name resolved or nothing: { items } | { error }.
function mcpLibMany(items, names, noun, lister) {
  const asked = Array.isArray(names) ? names : [];
  if (!asked.length) return { error: 'Name at least one ' + noun + '.' };
  const hits = asked.map(n => mcpLibOne(items, n, noun, lister));
  const bad = hits.filter(h => h.error).map(h => h.error);
  if (bad.length) return { error: 'Nothing was changed. ' + bad.join(' ') };
  return { items: [...new Map(hits.map(h => [h.item.key, h.item])).values()] };
}

// A group [{ key, name }] by its shown name, ignoring case, or null.
function mcpLibGroup(groups, name) {
  const q = _msLow(name);
  return (groups || []).find(g => _msLow(g.name) === q) || null;
}

// A position as Claude gives it, 1 at the top, as an index; null for none or junk.
function mcpLibIndex(position) {
  const n = Number(position);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) - 1 : null;
}

function mcpSoundsWouldDelete(label, builtin) {
  return 'Would delete the sound "' + label + '"' + (builtin ? ' (one of the built-in sounds)' : '') + '. Nothing was deleted. It would go to the Trash in ' +
    'Settings for 30 days. Tell the DM what goes and, on their yes, call again with confirmed: true.';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mcpLibFind, mcpLibOne, mcpLibMany, mcpLibGroup, mcpLibIndex, mcpSoundsWouldDelete };
}
