'use strict';
// notesTreePlan.js — the Notes window's tree, as pure rules: the campaign, its groups nested by outline, their
// maps and rooms, the roads, the monsters with a note, factions and lore; the rows an open set shows; a node's
// path for the breadcrumbs; and which middle crumbs fold into "…". No DOM.
//
// A node is { key, kind, name, id, scene?, sec?, children }. Keys: campaign, place:<name>, map:<id>,
// room:<scene>:<id>, road:<uid>, monster:<id>, entry:<id>, sec:<roads|monster|faction|lore>.

function _ntGeo(name) {
  return typeof globalThis[name] === 'function' ? globalThis[name] : require('../world/worldMapPlan.js')[name];
}

function _ntEntries() {
  return typeof neChildren === 'function' ? { neChildren } : require('./notesEntriesPlan.js');
}

// A group sits inside the smallest other group whose outline holds every corner of its own.
function notesGroupParents(groups) {
  const pointIn = _ntGeo('wmPointInPoly'), areaOf = _ntGeo('wmPolyArea');
  const sized = groups.map(g => ({ name: g.name, outline: g.outline || [], area: g.outline && g.outline.length > 2 ? areaOf(g.outline) : 0 }));
  const parent = {};
  for (const g of sized) {
    if (g.outline.length < 3) continue;
    let best = null;
    for (const o of sized) {
      if (o === g || o.outline.length < 3 || o.area <= g.area) continue;
      if (!g.outline.every(v => pointIn(v, o.outline))) continue;
      if (!best || o.area < best.area) best = o;
    }
    if (best) parent[g.name] = best.name;
  }
  return parent;
}

function _node(key, kind, name, id, extra) { return { key, kind, name, id, children: [], ...extra }; }

function _entryNodes(entries, kind, parent) {
  return _ntEntries().neChildren(entries, parent).map(e => {
    const n = _node('entry:' + e.id, kind, e.name, e.id);
    n.children = _entryNodes(entries, kind, e.id);
    return n;
  });
}

// `scenes` in library order, `groups` ({ name, outline }) in group order, `rooms` by scene id, and `roomLabel(n)`
// the name of an unnamed room by its place in the list. Nothing is stored for that name.
function notesTreeBuild(src) {
  const roomLabel = src.roomLabel;
  const root = _node('campaign', 'campaign', 'Campaign', null);
  const parents = notesGroupParents(src.groups || []);
  const placeNodes = {};
  for (const g of src.groups || []) placeNodes[g.name] = _node('place:' + g.name, 'place', g.name, g.name);
  const mapNode = s => {
    const n = _node('map:' + s.id, 'map', s.name, s.id);
    n.children = ((src.rooms || {})[s.id] || []).map((r, i) => _node('room:' + s.id + ':' + r.id, 'room', r.name || roomLabel(i + 1), r.id, { scene: s.id, unnamed: !r.name }));
    return n;
  };
  for (const g of src.groups || []) {
    const n = placeNodes[g.name], up = parents[g.name] && placeNodes[parents[g.name]];
    (up || root).children.push(n);
  }
  // Maps after the groups inside a group, and after every group at the top.
  for (const s of src.scenes || []) {
    const holder = s.group && placeNodes[s.group];
    (holder || root).children.push(mapNode(s));
  }
  if ((src.roads || []).length) {
    const sec = _node('sec:roads', 'section', 'Roads', null, { sec: 'roads' });
    sec.children = src.roads.map(r => _node('road:' + r.uid, 'road', r.name, r.uid));
    root.children.push(sec);
  }
  const mon = _node('sec:monster', 'section', 'Monsters and NPCs', null, { sec: 'monster' });
  mon.children = (src.blocks || []).filter(b => (b.notes || '').trim() || b.listed)
    .sort((a, b) => String(a.name).localeCompare(String(b.name))).map(b => _node('monster:' + b.id, 'monster', b.name, b.id));
  const fac = _node('sec:faction', 'section', 'Factions', null, { sec: 'faction' });
  fac.children = _entryNodes(src.entries || [], 'faction', 'faction');
  const lore = _node('sec:lore', 'section', 'Lore', null, { sec: 'lore' });
  lore.children = _entryNodes(src.entries || [], 'lore', 'lore');
  root.children.push(mon, fac, lore);
  return root;
}

function notesTreeFind(root, key) {
  if (root.key === key) return root;
  for (const c of root.children) { const f = notesTreeFind(c, key); if (f) return f; }
  return null;
}

// Root to node, both included; empty when the key is not in the tree.
function notesTreePath(root, key) {
  if (root.key === key) return [root];
  for (const c of root.children) { const p = notesTreePath(c, key); if (p.length) return [root, ...p]; }
  return [];
}

// The rows shown: the campaign, then each node with its kids when it is open. A section is always open and
// takes no step of indent.
function notesTreeRows(root, open) {
  const rows = [];
  const walk = (n, depth) => {
    const isSec = n.kind === 'section';
    const shown = isSec || n.key === 'campaign' || open.has(n.key);
    rows.push({ node: n, depth, hasKids: n.children.length > 0, open: shown && n.children.length > 0 });
    if (shown) for (const c of n.children) walk(c, n.key === 'campaign' || isSec ? 1 : depth + 1);
  };
  walk(root, 0);
  return rows;
}

// Every key a row can fold: what Expand all opens.
function notesTreeFoldable(root) {
  const out = [];
  const walk = n => {
    if (n.kind !== 'section' && n.key !== 'campaign' && n.children.length) out.push(n.key);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

// `widths` are the crumbs' own widths, `sep` one separator's and `ell` the "…" crumb's. Answers how many middle
// crumbs, from the second on, fold away so the rest fit `avail`; at most all of them.
function notesCrumbFold(widths, avail, sep, ell) {
  const n = widths.length;
  const total = hidden => {
    const shown = widths.filter((_, i) => i === 0 || i >= 1 + hidden || i === n - 1);
    return shown.reduce((a, b) => a + b, 0) + (hidden ? ell : 0) + sep * (shown.length - 1 + (hidden ? 1 : 0));
  };
  for (let k = 0; k <= Math.max(0, n - 2); k++) if (total(k) <= avail) return k;
  return Math.max(0, n - 2);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { notesGroupParents, notesTreeBuild, notesTreeFind, notesTreePath, notesTreeRows, notesTreeFoldable, notesCrumbFold };
}
