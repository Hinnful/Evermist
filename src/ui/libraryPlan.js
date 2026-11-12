'use strict';
// libraryPlan.js — pure: what Music, Sounds and Pictures store of their order, names and groups, each key read back
// through a cleaner, and the layout a library starts from when nothing is stored yet. The order rules themselves are
// sceneGroups.js's. No DOM. Tested.
//
// evermist.musicOrder     { v, at, order:[file], labels:{file:name} } - the groups stay in evermist.musicGroups
// evermist.soundsLayout   { v, at, order, groups:{ key:{ name?, members } }, groupOrder, labels, hidden:[file] }
// evermist.picturesLayout { v, at, order:[id], groups:{ key:{ name, members } }, groupOrder }
// ⚠ The previous release never reads these keys, so it shows file names, its own order and every built-in sound.

const _LP = typeof libEmpty === 'function' ? { libEmpty, libSoundsSeed } : require('../scenes/sceneGroups.js');

const LIB_V = 1;
const LIB_LABEL_MAX = 120;
const LIB_MUSIC_KEY = 'evermist.musicOrder';
const LIB_SOUNDS_KEY = 'evermist.soundsLayout';
const LIB_PICTURES_KEY = 'evermist.picturesLayout';
const _LIB_BUILTIN_FILE = /^[a-z0-9-]+\.(mp3|ogg|wav)$/;

// A name as the DM typed it: one line, trimmed, capped. Empty means "no name of its own".
function libLabelClean(raw) {
  return String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LIB_LABEL_MAX);
}

const libKeyOk = k => typeof k === 'string' && k.length > 0 && k.length <= 300 && !/[/\\\u0000-\u001f]/.test(k);
const _libNum = v => (Number.isFinite(v) && v > 0 ? v : 0);

function _libKeys(arr, ok) {
  const seen = new Set();
  return (Array.isArray(arr) ? arr : []).filter(k => ok(k) && !seen.has(k) && seen.add(k));
}

function _libLabels(raw, ok) {
  const out = Object.create(null);
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(raw)) {
    const name = libLabelClean(raw[k]);
    if (ok(k) && name) out[k] = name;
  }
  return out;
}

// `named`: a group needs a name of its own (a built-in group may go without one until renamed).
function _libGroups(raw, ok, named) {
  const groups = Object.create(null), groupOrder = [];
  const src = raw && raw.groups && typeof raw.groups === 'object' ? raw.groups : {};
  const keys = _libKeys((Array.isArray(raw && raw.groupOrder) ? raw.groupOrder : []).concat(Object.keys(src)), libKeyOk);
  for (const gk of keys) {
    const g = src[gk];
    if (!g || typeof g !== 'object' || !Object.prototype.hasOwnProperty.call(src, gk)) continue;
    const name = libLabelClean(g.name);
    if (named(gk) && !name) continue;
    groups[gk] = name ? { name, members: _libKeys(g.members, ok) } : { members: _libKeys(g.members, ok) };
    groupOrder.push(gk);
  }
  return { groups, groupOrder };
}

function cleanMusicOrder(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return { v: LIB_V, at: _libNum(raw.at), order: _libKeys(raw.order, libKeyOk), labels: _libLabels(raw.labels, libKeyOk) };
}

function cleanSoundsLayout(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const g = _libGroups(raw, libKeyOk, gk => !gk.startsWith('builtin:'));
  return { v: LIB_V, at: _libNum(raw.at), order: _libKeys(raw.order, libKeyOk), groups: g.groups, groupOrder: g.groupOrder,
    labels: _libLabels(raw.labels, libKeyOk), hidden: _libKeys(raw.hidden, f => typeof f === 'string' && _LIB_BUILTIN_FILE.test(f)) };
}

const _libPicOk = k => typeof k === 'string' && /^[a-z0-9]{1,32}$/.test(k);

function cleanPicturesLayout(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const g = _libGroups(raw, _libPicOk, () => true);
  return { v: LIB_V, at: _libNum(raw.at), order: _libKeys(raw.order, _libPicOk), groups: g.groups, groupOrder: g.groupOrder };
}

// A stored key's text read back, or null when it is missing or unreadable.
function libParse(text, clean) {
  if (typeof text !== 'string' || !text) return null;
  try { return clean(JSON.parse(text)); } catch (_) { return null; }
}

// ─── Where an upgrade starts ─────────────────────────────────────────────────

// The tracks in the order the pane lists them now, with no names of their own.
function musicOrderSeed(files) {
  return { v: LIB_V, at: 0, order: _libKeys(files, libKeyOk), labels: Object.create(null) };
}

// The music groups the previous release kept, less every group no track is in: empty groups no longer exist.
function musicGroupsUpgrade(order, of) {
  const used = new Set(Object.keys(of || {}).map(k => of[k]));
  return (order || []).filter(n => used.has(n));
}

function soundsSeedLayout(soundGroups, own) {
  const L = _LP.libSoundsSeed(soundGroups, own);
  return { v: LIB_V, at: 0, order: L.order, groups: L.groups, groupOrder: L.groupOrder, labels: Object.create(null), hidden: [] };
}

// Newest first, as the gallery always listed them.
function picturesSeed(pics) {
  const ids = (pics || []).slice().sort((a, b) => (b.added || 0) - (a.added || 0)).map(p => p.id);
  return { v: LIB_V, at: 0, order: _libKeys(ids, _libPicOk), groups: Object.create(null), groupOrder: [] };
}

// ─── Music: the order beside the groups the music record carries ─────────────

// The groups are names a track carries (`of`), kept in evermist.musicGroups; the order is one list of files.
function musicToLib(order, of, groupNames) {
  const L = _LP.libEmpty(), byName = of || {};
  const names = _libKeys((groupNames || []).concat(Object.keys(byName).map(k => byName[k])), n => typeof n === 'string' && !!n);
  for (const n of names) { L.groups[n] = { name: n, members: [] }; L.groupOrder.push(n); }
  const placed = new Set();
  for (const k of order || []) {
    const g = byName[k];
    if (g && L.groups[g]) L.groups[g].members.push(k); else L.order.push(k);
    placed.add(k);
  }
  for (const k of Object.keys(byName)) if (!placed.has(k) && L.groups[byName[k]]) L.groups[byName[k]].members.unshift(k);
  return L;
}

// Back to the two stores: the order of every file, Ungrouped first, and the group each grouped file carries.
function musicFromLib(L) {
  const of = Object.create(null);
  let order = L.order.slice();
  for (const g of L.groupOrder) {
    for (const k of L.groups[g].members) of[k] = L.groups[g].name || g;
    order = order.concat(L.groups[g].members);
  }
  return { order, of, groupOrder: L.groupOrder.map(g => L.groups[g].name || g) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LIB_V, LIB_LABEL_MAX, LIB_MUSIC_KEY, LIB_SOUNDS_KEY, LIB_PICTURES_KEY, libLabelClean, libKeyOk,
    cleanMusicOrder, cleanSoundsLayout, cleanPicturesLayout, libParse, musicOrderSeed, musicGroupsUpgrade, soundsSeedLayout,
    picturesSeed, musicToLib, musicFromLib };
}
