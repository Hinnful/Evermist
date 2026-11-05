'use strict';

// fightPlan.js — pure kernel for the list of fights: open, add, duplicate, rename, delete, and a
// backup merged in. No DOM. Unit-tested; see test/fightPlan.test.js.

const FP = (typeof module !== 'undefined' && module.exports) ? Object.assign({}, require('./combatPlan.js'), require('../scenes/editStamps.js'))
  : { combatAddEntry, combatSnapshot, combatCleanBlock, combatCleanRow, esCanon, esGoneClean, esGoneNote, esGoneMerge, esGoneTime, esGoneWins, esGoneLift };

// ── The list of fights ───────────────────────────────────────────────────────
// The open fight's rows are `rows` beside the bestiary, the shape saved before there was a list,
// so an older build still opens the open fight. Only the fights not open carry `rows` of their own.

function combatFightId() {
  return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// A save from before the list, or none at all, is one fight named "Fight" holding what was open.
function combatFightsFrom(saved, newId) {
  if (!saved || !Array.isArray(saved.fights) || !saved.fights.length) {
    const id = newId();
    return { openId: id, fights: [{ id, name: 'Fight' }] };
  }
  const fights = saved.fights.map(f => Object.assign({}, f));
  const open = fights.find(f => f.id === saved.openId) || fights[0];
  delete open.rows;
  return { openId: open.id, fights };
}

function combatFightRows(st, f) {
  return f.id === st.openId ? st.rows : (f.rows || []);
}

function combatOpenFight(st, id) {
  const cur = st.fights.find(f => f.id === st.openId), next = st.fights.find(f => f.id === id);
  if (!next || next === cur) return st;
  if (cur) cur.rows = st.rows;
  st.rows = next.rows || [];
  delete next.rows;
  st.openId = id;
  return st;
}

function combatAddFight(st, newId) {
  const f = { id: newId(), name: 'New fight', rows: [] };
  st.fights.push(f);
  return combatOpenFight(st, f.id);
}

function combatDuplicateFight(st, id, newId) {
  const f = st.fights.find(x => x.id === id);
  const rows = combatFightRows(st, f).map(r => Object.assign(JSON.parse(JSON.stringify(r)), { id: st.nextId++ }));
  st.fights.splice(st.fights.indexOf(f) + 1, 0, { id: newId(), name: f.name + ' copy', rows });
  return st;
}

// The names this file gives a fight stay English in the save; the screen asks for them through `tr` (t()).
// A copy's name is its original's plus a suffix, so each part is translated on its own.
function combatFightLabel(name, tr) {
  if (name === 'Fight' || name === 'New fight' || name === 'Imported fight') return tr(name);
  const copy = /^([\s\S]*) copy$/.exec(name);
  return copy ? tr('{name} copy', { name: combatFightLabel(copy[1], tr) }) : name;
}

function combatRenameFight(st, id, name) {
  const f = st.fights.find(x => x.id === id), n = String(name || '').trim();
  if (f && n) f.name = n;
  return st;
}

// Deleting the open fight opens its neighbour; deleting the last one leaves an empty "Fight".
function combatDeleteFight(st, id, newId) {
  const i = st.fights.findIndex(f => f.id === id);
  if (i < 0) return st;
  const wasOpen = id === st.openId;
  st.fights.splice(i, 1);
  if (!st.fights.length) st.fights.push({ id: newId(), name: 'Fight', rows: [] });
  if (wasOpen) { st.openId = null; combatOpenFight(st, st.fights[Math.min(i, st.fights.length - 1)].id); }
  return st;
}

// ── Edit times ───────────────────────────────────────────────────────────────
// `edits` is { blocks: { uid: { k, t } }, fights: { id: { k, t } } }: a hash of what was last saved and when it
// changed. One seen for the first time has t 0, the oldest: it came from before times or is new here, and a new
// one has no copy elsewhere to lose to. `goneBlocks` and `goneFights` are { id: time } of what was deleted
// (esGoneNote), so a backup carries a deletion; a record that comes back after one is an edit at that moment.
// An older build never reads or writes any of it.

function _fpHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

function combatBlockKey(b) {
  const c = Object.assign({}, b);
  delete c.id; delete c.uid;
  return _fpHash(FP.esCanon(c));
}

function combatFightKey(name, rows) {
  return _fpHash(FP.esCanon({ name, rows: (rows || []).map(r => Object.assign({}, r, { id: undefined })) }));
}

// Run before every save: a monster or fight whose hash moved takes `now`.
function combatStampEdits(st, now) {
  const prev = st.edits || {}, out = { blocks: {}, fights: {} };
  const gone = { blocks: FP.esGoneClean(prev.goneBlocks), fights: FP.esGoneClean(prev.goneFights) };
  const stamp = (kind, id, k) => {
    const p = (prev[kind] || {})[id];
    out[kind][id] = { k, t: !p ? (id in gone[kind] ? now : 0) : p.k === k ? p.t : now };
  };
  for (const b of Object.values(st.blocks)) if (b && b.uid) stamp('blocks', b.uid, combatBlockKey(b));
  for (const f of st.fights) stamp('fights', f.id, combatFightKey(f.name, combatFightRows(st, f)));
  const next = Object.assign({}, prev, out);
  for (const [kind, key] of [['blocks', 'goneBlocks'], ['fights', 'goneFights']]) {
    const g = FP.esGoneNote(gone[kind], Object.keys(prev[kind] || {}), Object.keys(out[kind]), now);
    if (Object.keys(g).length) next[key] = g; else delete next[key];
  }
  st.edits = next;
  return st;
}

// A backup's bestiary merges in without doubling an entry already here, and its fights join the ones here; a
// backup from before the list carries one. Rows are renumbered. A monster or fight both hold takes the copy
// edited later. When neither copy has a time, a differing monster is added as a copy, so no edit is lost, and a
// differing fight stays as it is here.
function combatMerge(cur, incoming, newId, now) {
  const moment = now || Date.now();
  // A deletion in the file removes what here was last edited before it; one made here keeps the file's older copy out.
  const goneHere = { blocks: FP.esGoneClean(cur.edits && cur.edits.goneBlocks), fights: FP.esGoneClean(cur.edits && cur.edits.goneFights) };
  const goneIn = { blocks: FP.esGoneClean(incoming.edits && incoming.edits.goneBlocks), fights: FP.esGoneClean(incoming.edits && incoming.edits.goneFights) };
  const time = (kind, src, id) => { const e = src && src[kind] && src[kind][id], t = e && e.t; return Number.isFinite(t) && t > 0 ? Math.min(t, moment) : 0; };
  const edits = { blocks: Object.assign({}, cur.edits && cur.edits.blocks), fights: Object.assign({}, cur.edits && cur.edits.fights) };
  const blocks = Object.assign({}, cur.blocks);
  const key = b => `${b.name}\u0000${b.source || ''}`;
  // The uid is left out of the comparison, so an older backup of an entry that has one since adds no copy.
  const same = b => { const c = FP.combatSnapshot(FP.combatCleanBlock(b) || b); delete c.uid; return JSON.stringify(c); };
  const seen = new Map(), byUid = new Map();
  const note = b => { const k = key(b); seen.set(k, (seen.get(k) || new Set()).add(same(b))); if (b.uid) byUid.set(b.uid, b); };
  Object.values(blocks).forEach(note);
  // A backup may be hand-made or foreign: every block and row is cleaned before it lands.
  for (const b of Object.values(incoming.blocks || {}).map(FP.combatCleanBlock).filter(Boolean)) {
    const mine = b.uid && byUid.get(b.uid);
    if (mine ? same(mine) === same(b) : (seen.get(key(b)) || new Set()).has(same(b))) continue;
    const ti = time('blocks', incoming.edits, b.uid);
    if (!mine && b.uid && FP.esGoneWins(goneHere.blocks, b.uid, ti, moment)) continue;
    if (mine) {
      const tl = time('blocks', cur.edits, b.uid);
      if (ti > 0 && ti >= tl) {
        const c = Object.assign(FP.combatSnapshot(b), { id: mine.id, uid: mine.uid });
        blocks[mine.id] = c;
        edits.blocks[c.uid] = { k: combatBlockKey(c), t: ti };
        note(c);
        continue;
      }
      if (tl > 0 || ti > 0) continue;
    }
    // An entry no local one shares a uid with keeps its own, so the notes that mention it in the same file still find it.
    const added = FP.combatAddEntry(blocks, b);
    if (b.uid && !byUid.has(b.uid)) {
      added.uid = b.uid;
      if (ti > 0) edits.blocks[b.uid] = { k: combatBlockKey(added), t: ti };
    }
    note(added);
  }
  for (const uid of Object.keys(goneIn.blocks)) {
    const mine = byUid.get(uid);
    if (!mine || !blocks[mine.id] || blocks[mine.id].uid !== uid || !FP.esGoneWins(goneIn.blocks, uid, time('blocks', edits, uid), moment)) continue;
    delete blocks[mine.id];
    delete edits.blocks[uid];
  }
  let nextId = cur.nextId;
  const renumber = rs => (Array.isArray(rs) ? rs : []).map(FP.combatCleanRow).filter(Boolean).map(r => Object.assign(r, { id: nextId++ }));
  const inFights = Array.isArray(incoming.fights) && incoming.fights.length
    ? incoming.fights.filter(f => f && typeof f === 'object').map(f => Object.assign({}, f, { rows: f.id === incoming.openId ? incoming.rows : f.rows }))
    : ((incoming.rows || []).length ? [{ id: newId(), name: 'Imported fight', rows: incoming.rows }] : []);
  const have = new Set(cur.fights.map(f => f.id));
  const st = Object.assign({}, cur, { blocks, fights: cur.fights.map(f => Object.assign({}, f)), rows: cur.rows, edits });
  for (const f of inFights.filter(x => have.has(x.id))) {
    const mine = st.fights.find(x => x.id === f.id), rows = (Array.isArray(f.rows) ? f.rows : []).map(FP.combatCleanRow).filter(Boolean);
    const ti = time('fights', incoming.edits, f.id);
    if (!(ti > 0 && ti >= time('fights', cur.edits, f.id)) || combatFightKey(f.name, rows) === combatFightKey(mine.name, combatFightRows(st, mine))) continue;
    if (typeof f.name === 'string' && f.name.trim()) mine.name = f.name;
    const taken = renumber(rows);
    if (mine.id === st.openId) st.rows = taken; else mine.rows = taken;
    edits.fights[f.id] = { k: combatFightKey(mine.name, taken), t: ti };
  }
  for (const f of cur.fights) {
    if (!FP.esGoneWins(goneIn.fights, f.id, time('fights', edits, f.id), moment)) continue;
    combatDeleteFight(st, f.id, newId);
    delete edits.fights[f.id];
  }
  const added = inFights.filter(f => !have.has(f.id) && !FP.esGoneWins(goneHere.fights, f.id, time('fights', incoming.edits, f.id), moment)).map(f => ({ id: f.id, name: f.name, rows: renumber(f.rows) }));
  for (const f of added) { const ti = time('fights', incoming.edits, f.id); if (ti > 0) edits.fights[f.id] = { k: combatFightKey(f.name, f.rows), t: ti }; }
  // On a fresh install the one empty fight gives way, so the restore opens on a real fight.
  const lone = st.fights.length === 1 && !st.rows.length && st.fights[0].name === 'Fight';
  st.fights.push(...added);
  st.nextId = nextId;
  if (lone && added.length) {
    const empty = st.fights[0].id;
    combatOpenFight(st, (added.find(f => f.id === incoming.openId) || added[0]).id);
    st.fights = st.fights.filter(f => f.id !== empty);
  }
  for (const [kind, key] of [['blocks', 'goneBlocks'], ['fights', 'goneFights']]) {
    const alive = {};
    for (const id of Object.keys(edits[kind])) alive[id] = edits[kind][id].t;
    const g = FP.esGoneLift(FP.esGoneMerge(goneHere[kind], goneIn[kind]), alive);
    if (Object.keys(g).length) edits[key] = g; else delete edits[key];
  }
  return st;
}

// What is written to disk: `combat` in the shape saved before the list (the open fight and the
// bestiary), and `fights` under a key an older build never reads, so its saves erase no fight.
function combatSavedParts(st) {
  return {
    combat: Object.assign({ rows: st.rows, blocks: st.blocks, nextId: st.nextId }, st.edits ? { edits: st.edits } : {}),
    fights: { openId: st.openId, fights: st.fights.map(f => (f.id === st.openId ? { id: f.id, name: f.name } : f)) },
  };
}

// A backup's combat.json: the old shape at the top, so an older build restores the open fight, and
// every fight beside it.
function combatBackupData(st) {
  const p = combatSavedParts(st);
  return Object.assign({}, p.combat, p.fights);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { combatFightId, combatFightsFrom, combatFightRows, combatOpenFight, combatAddFight,
    combatDuplicateFight, combatFightLabel, combatRenameFight, combatDeleteFight, combatBlockKey, combatFightKey, combatStampEdits, combatMerge,
    combatSavedParts, combatBackupData };
}
