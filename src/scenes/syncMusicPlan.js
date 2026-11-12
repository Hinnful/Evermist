'use strict';
// syncMusicPlan.js — pure kernel for syncing the music folder: what this computer gained or lost since the last tick,
// which tracks to fetch, send or remove, the deletion records and their 30-day trash, and the groups the later edit
// keeps. No DOM, no network. Tested.
//
// A track is its content hash. Each computer sends one `music` record (and one `sounds` record, the same shape): its tracks { hash: { name, at, size } }, the
// deletions { hash: { at, name, restoredAt?, purged? } } and the groups { of: { hash: group }, order, at }. ⚠ Track
// files sit in the Drive's own `music` folder as `<machine>.<hash>`, never in `blobs`, which the previous release
// tidies by the records it understands.

const _SYM = typeof syBlobNameOk === 'function' ? { syBlobNameOk, SY_TRASH_MS, SY_FORMAT } : require('./syncPlan.js');
const _SYM_ES = typeof esCanon === 'function' ? { esCanon } : require('./editStamps.js');
const _SYM_HASH = /^[0-9a-f]{64}$/;
const _SYM_EXT = /\.(m4a|webm|mp3|opus|ogg|oga|wav|flac|aac|mp4)$/i;
const _symNum = v => (Number.isFinite(v) && v > 0 ? v : 0);
const _symHashOf = name => name.slice(name.lastIndexOf('.') + 1);
const _symOwnerOf = name => name.slice(0, name.lastIndexOf('.'));
const _symByMachine = (a, b) => (a.machine < b.machine ? -1 : a.machine > b.machine ? 1 : 0);

// A track's file name as the music folder takes it: no path, an audio extension.
function syMuNameOk(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 300 && !/[/\\\0]/.test(name) &&
    !name.startsWith('.') && _SYM_EXT.test(name);
}

// What the folder holds now, as hash -> { name, size }. A file not hashed yet is left out; two files of one content
// keep the first name.
function syMuLocal(list) {
  const out = {};
  const rows = (list || []).filter(t => t && _SYM_HASH.test(t.hash || '') && syMuNameOk(t.name));
  rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const t of rows) if (!out[t.hash]) out[t.hash] = { name: t.name, size: _symNum(t.size) };
  return out;
}

const syMuEmpty = () => ({ init: false, tracks: {}, gone: {}, groups: null });

// True when the deletion stands against a copy that landed at `at`: not undone since, and not older than the copy.
function syMuGoneWins(g, at) {
  if (!g || !(_symNum(g.at) > 0)) return false;
  if ((g.restoredAt || 0) >= g.at) return false;
  return g.at >= (at || 0);
}

// The folder against the last tick: a track gone from it is deleted now, one new to it is noted. The first look
// counts every track as old, so a deletion made elsewhere still reaches it. A track in Claude's undo window
// (`stashed`) or still in the folder unhashed is neither. A track added again by hand undoes its deletion.
function syMuObserve(st, list, stashed, now) {
  const local = syMuLocal(list), hold = new Set(stashed || []), first = !st.init;
  const unhashed = new Set((list || []).filter(t => t && !_SYM_HASH.test(t.hash || '')).map(t => t.name));
  const tracks = {}, gone = { ...st.gone };
  for (const h of Object.keys(st.tracks || {})) {
    const was = st.tracks[h];
    if (local[h]) { tracks[h] = { ...was, name: local[h].name, size: local[h].size }; continue; }
    if (hold.has(h) || unhashed.has(was.name)) { tracks[h] = was; continue; }
    const prev = gone[h];
    gone[h] = { ...(prev || {}), at: Math.max(now, prev ? _symNum(prev.at) : 0), name: was.name };
  }
  for (const h of Object.keys(local)) {
    if (tracks[h]) continue;
    tracks[h] = { name: local[h].name, size: local[h].size, at: first ? 0 : now };
    const g = gone[h];
    if (!first && g && !g.purged && (g.restoredAt || 0) < g.at) gone[h] = { ...g, restoredAt: now };
  }
  return { ...st, init: true, tracks, gone };
}

// ─── Deletions and the 30-day trash ──────────────────────────────────────────

function syMuGoneClean(gone) {
  const out = {};
  for (const h of Object.keys(gone || {}).sort()) {
    const g = gone[h];
    if (!_SYM_HASH.test(h) || !g || !(_symNum(g.at) > 0)) continue;
    out[h] = { at: g.at, name: syMuNameOk(g.name) ? g.name : '' };
    if (_symNum(g.restoredAt)) out[h].restoredAt = g.restoredAt;
    if (g.purged === true) out[h].purged = true;
  }
  return out;
}

// Two computers' deletions combined: the later time of each field, a purge once either has it, the later one's name.
function syMuGoneMerge(a, b) {
  const out = { ...(a || {}) };
  for (const h of Object.keys(b || {})) {
    const x = out[h], y = b[h];
    if (!x) { out[h] = { ...y }; continue; }
    const e = { at: Math.max(x.at || 0, y.at || 0), name: (y.at > x.at ? y.name || x.name : x.name || y.name) || '' };
    const r = Math.max(x.restoredAt || 0, y.restoredAt || 0);
    if (r) e.restoredAt = r;
    if (x.purged || y.purged) e.purged = true;
    out[h] = e;
  }
  return out;
}

const _symInTrash = g => !g.purged && !((g.restoredAt || 0) >= (g.at || 0));

// "Recently deleted": [{ hash, name, at }] of tracks not back in the folder here.
function syMuTrash(gone, local) {
  return Object.keys(gone || {}).filter(h => _symInTrash(gone[h]) && !(local || {})[h])
    .map(h => ({ hash: h, name: gone[h].name || '', at: gone[h].at }));
}

const syMuTrashDue = (gone, now) => Object.keys(gone || {}).filter(h => _symInTrash(gone[h]) && now - gone[h].at > _SYM.SY_TRASH_MS);

function syMuPurge(gone, hashes) {
  const out = { ...gone };
  for (const h of hashes) if (out[h]) out[h] = { ...out[h], purged: true };
  return out;
}

// A restored track counts as added at `now` on every computer. A purged one cannot come back.
function syMuRestore(gone, h, now) {
  const g = (gone || {})[h];
  if (!g || g.purged) return gone;
  return { ...gone, [h]: { ...g, restoredAt: now } };
}

// The tracks this computer's Recently deleted holds (`held`, hashes) that come back here from it rather than the Drive:
// one restored on any computer, or one this tick would fetch (`fetch`). Never one in the folder or purged.
function syMuFromTrash(gone, local, held, fetch) {
  const want = new Set(fetch || []);
  return [...new Set(held || [])].filter(h => {
    const g = (gone || {})[h];
    if ((local || {})[h] || (g && g.purged)) return false;
    return want.has(h) || (!!g && (g.restoredAt || 0) >= g.at);
  });
}

// ─── Groups ──────────────────────────────────────────────────────────────────

function syMuGroupsClean(g) {
  if (!g || typeof g !== 'object') return null;
  const of = {};
  const ok = s => typeof s === 'string' && s.trim().length > 0 && s.length <= 200;
  for (const h of Object.keys(g.of || {}).sort()) if (_SYM_HASH.test(h) && ok(g.of[h])) of[h] = g.of[h];
  const order = Array.isArray(g.order) ? g.order.filter(ok).filter((n, i, a) => a.indexOf(n) === i) : [];
  return { of, order, at: _symNum(g.at) };
}

// This computer's groups in the synced form: by hash, with the stored edit time. A group the last synced form gave a
// track not in the folder yet stays with it.
function syMuGroupsFromLocal(ls, local, prev) {
  const of = {};
  for (const h of Object.keys((prev && prev.of) || {})) if (!local[h]) of[h] = prev.of[h];
  for (const h of Object.keys(local)) {
    const g = ls && ls.of ? ls.of[local[h].name] : '';
    if (typeof g === 'string' && g.trim()) of[h] = g;
  }
  return syMuGroupsClean({ of, order: (ls && ls.order) || [], at: (ls && ls.at) || 0 });
}

// The groups every computer keeps: the latest edit, a tie going to the larger machine id. With no edit since the
// update anywhere, everyone's are combined, the earlier machine's first.
function syMuGroupsPick(cands) {
  const list = (cands || []).filter(c => c && c.groups).slice().sort(_symByMachine);
  if (!list.length) return null;
  let best = null;
  for (const c of list) if (c.groups.at > 0 && (!best || c.groups.at >= best.groups.at)) best = c;
  if (best) return syMuGroupsClean(best.groups);
  const of = {}, order = [];
  for (const c of list) {
    for (const h of Object.keys(c.groups.of)) if (!(h in of)) of[h] = c.groups.of[h];
    for (const n of c.groups.order) if (!order.includes(n)) order.push(n);
  }
  return { of, order, at: 0 };
}

// The groups as the music pane stores them, by file name: the picked groups for every hashed track, and what this
// computer said of a file not hashed yet.
function syMuGroupsToLocal(groups, local, ls, list) {
  const hashed = new Set(Object.keys(local).map(h => local[h].name));
  const present = new Set((list || []).map(t => t && t.name));
  const of = {};
  for (const n of Object.keys((ls && ls.of) || {})) if (present.has(n) && !hashed.has(n)) of[n] = ls.of[n];
  for (const h of Object.keys(local)) if (groups.of[h]) of[local[h].name] = groups.of[h];
  return { of, order: groups.order.slice(), at: groups.at };
}

// ─── The record ──────────────────────────────────────────────────────────────

// `key` is 'music', or 'sounds' for the DM's own soundboard files, which sync the same way with no groups.
function syMuRecordText(st, key = 'music') {
  const tracks = {};
  for (const h of Object.keys(st.tracks || {})) tracks[h] = { name: st.tracks[h].name, at: _symNum(st.tracks[h].at), size: _symNum(st.tracks[h].size) };
  return _SYM_ES.esCanon({ format: _SYM.SY_FORMAT, key, tracks, gone: syMuGoneClean(st.gone), groups: syMuGroupsClean(st.groups) });
}

// Another computer's record, read back checked: null for anything unreadable or from a newer format.
function syMuRecordParse(text, key = 'music') {
  let r;
  try { r = JSON.parse(text); } catch (_) { return null; }
  if (!r || r.key !== key || !(r.format <= _SYM.SY_FORMAT)) return null;
  const tracks = {};
  for (const h of Object.keys(r.tracks || {})) {
    const t = r.tracks[h];
    if (_SYM_HASH.test(h) && t && syMuNameOk(t.name)) tracks[h] = { name: t.name, at: _symNum(t.at), size: _symNum(t.size) };
  }
  return { tracks, gone: syMuGoneClean(r.gone), groups: syMuGroupsClean(r.groups) };
}

// ─── The panes' order, names and groups ──────────────────────────────────────
// evermist.musicOrder and evermist.soundsLayout key by file name here and by content hash in the synced record. A
// hash this computer has no file for yet stays in the local form as '#<hash>' until the file lands. Built-ins,
// `builtin:<file>`, travel as they are.

const SY_HOLD = '#';

// Every key in a layout (`order`, each group's `members`, the `labels`) put through `fn`; null drops it.
function syLayoutMap(layout, fn) {
  const out = { ...layout };
  const list = a => (Array.isArray(a) ? a.map(fn).filter(k => k != null).filter((k, i, all) => all.indexOf(k) === i) : a);
  out.order = list(layout.order);
  if (layout.groups) {
    out.groups = {};
    for (const g of Object.keys(layout.groups)) out.groups[g] = { ...layout.groups[g], members: list(layout.groups[g].members) };
  }
  if (layout.labels) {
    out.labels = {};
    for (const k of Object.keys(layout.labels)) { const n = fn(k); if (n != null && !(n in out.labels)) out.labels[n] = layout.labels[k]; }
  }
  return out;
}

const _syIsBuiltin = k => k.startsWith('builtin:');

// The local form as it is sent: a file by its hash (`byName`: file -> hash), a held hash bare. A file not hashed yet
// is left out until it is.
function syLayoutOut(layout, byName) {
  return syLayoutMap(layout, k => {
    if (_syIsBuiltin(k)) return k;
    if (k.startsWith(SY_HOLD) && _SYM_HASH.test(k.slice(1))) return k.slice(1);
    return byName[k] || null;
  });
}

// Another computer's form as stored here: a hash by its file (`byHash`: hash -> file), or held until the file lands.
function syLayoutIn(layout, byHash) {
  return syLayoutMap(layout, k => {
    if (_syIsBuiltin(k)) return k;
    if (!_SYM_HASH.test(k)) return null;
    return byHash[k] || SY_HOLD + k;
  });
}

// The held hashes whose file has landed, named by it; null when none has.
function syLayoutResolve(layout, byHash) {
  let hit = false;
  const out = syLayoutMap(layout, k => {
    if (!k.startsWith(SY_HOLD) || !byHash[k.slice(1)]) return k;
    hit = true;
    return byHash[k.slice(1)];
  });
  return hit ? out : null;
}

// file -> hash and hash -> file from a folder's state (`tracks`: hash -> { name }).
function syLayoutNames(tracks) {
  const byName = {}, byHash = {};
  for (const h of Object.keys(tracks || {})) { const n = tracks[h] && tracks[h].name; if (n) { byName[n] = h; byHash[h] = n; } }
  return { byName, byHash };
}

// The whole record whose edit came later wins; a tie keeps this computer's.
const syLayoutTakes = (mine, theirs) => !!theirs && (theirs.at || 0) > ((mine && mine.at) || 0);

// Built-in sounds hidden there and not here (each lands in this computer's Trash), and hidden here and not there
// (restored there: each leaves this computer's Trash).
function syHiddenChange(mine, theirs) {
  const a = new Set(mine || []), b = new Set(theirs || []);
  return { trash: [...b].filter(f => !a.has(f)), back: [...a].filter(f => !b.has(f)) };
}

// ─── One tick's moves ────────────────────────────────────────────────────────

// `o`: st (this computer's state after syMuObserve), list (the folder), remotes [{ machine, rec }], files (the Drive's
// music folder [{ name, id }]), first, busy (hashes playing here), stashed. Answers what to remove here and how many
// wait for the player, what to send and fetch, and the purged files to delete from the Drive. The first sync removes
// nothing.
function syMuPlan(o) {
  const local = syMuLocal(o.list), gone = o.st.gone || {}, hold = new Set(o.stashed || []), busy = new Set(o.busy || []);
  const byHash = {};
  for (const f of o.files || []) if (_SYM.syBlobNameOk(f.name)) (byHash[_symHashOf(f.name)] = byHash[_symHashOf(f.name)] || []).push(f);
  const out = { remove: [], held: 0, upload: [], download: [], purge: [] };
  const losing = new Set();
  for (const h of Object.keys(local)) {
    const mine = o.st.tracks[h];
    if (!syMuGoneWins(gone[h], mine ? mine.at : 0)) continue;
    losing.add(h);
    if (o.first) continue;
    if (busy.has(h)) out.held++; else out.remove.push({ hash: h, name: local[h].name });
  }
  for (const h of Object.keys(local)) if (!losing.has(h) && !byHash[h]) out.upload.push({ hash: h, name: local[h].name });
  const want = new Map();
  for (const r of (o.remotes || []).slice().sort(_symByMachine)) {
    for (const h of Object.keys(r.rec.tracks)) {
      if (local[h] || hold.has(h) || want.has(h) || syMuGoneWins(gone[h], r.rec.tracks[h].at)) continue;
      want.set(h, r.rec.tracks[h].name);
    }
  }
  for (const h of Object.keys(gone)) {
    const g = gone[h];
    if (local[h] || hold.has(h) || want.has(h) || g.purged || !((g.restoredAt || 0) >= g.at) || !g.name) continue;
    want.set(h, g.name);
  }
  for (const [h, name] of want) if (byHash[h]) out.download.push({ hash: h, name, fileId: byHash[h][0].id, fileName: byHash[h][0].name });
  if (!o.first) for (const h of Object.keys(gone)) if (gone[h].purged && byHash[h]) out.purge.push(...byHash[h].map(f => f.id));
  return out;
}

// The Drive's track files no computer lists and no deletion keeps. A file whose owner has no record there yet is
// another computer's upload in flight, never loose. `records` [{ machine, rec }] include this computer's own.
function syMuLoose(files, records, gone) {
  const used = new Set();
  for (const r of records || []) for (const h of Object.keys(r.rec.tracks)) used.add(h);
  for (const h of Object.keys(gone || {})) if (!gone[h].purged) used.add(h);
  const owners = new Set((records || []).map(r => r.machine));
  return (files || []).filter(f => _SYM.syBlobNameOk(f.name) && !used.has(_symHashOf(f.name)) && owners.has(_symOwnerOf(f.name))).map(f => f.name);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    syMuNameOk, syMuLocal, syMuEmpty, syMuGoneWins, syMuObserve, syMuGoneClean, syMuGoneMerge, syMuTrash, syMuTrashDue,
    syMuPurge, syMuRestore, syMuFromTrash, syMuGroupsClean, syMuGroupsFromLocal, syMuGroupsPick, syMuGroupsToLocal, syMuRecordText,
    syMuRecordParse, syMuPlan, syMuLoose, SY_HOLD, syLayoutMap, syLayoutOut, syLayoutIn, syLayoutResolve, syLayoutNames,
    syLayoutTakes, syHiddenChange,
  };
}
