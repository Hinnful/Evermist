'use strict';

// fightPlan.js — pure kernel for the list of fights: open, add, duplicate, rename, delete, and a
// backup merged in. No DOM. Unit-tested; see test/fightPlan.test.js.

const FP = (typeof module !== 'undefined' && module.exports) ? require('./combatPlan.js')
  : { combatAddEntry, combatSnapshot };

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

// A backup's bestiary merges in without doubling an entry already here, and its fights join the
// ones here, never over them; a backup from before the list carries one. Rows are renumbered.
// An edited entry of the same name is still added, so its edits are not lost.
function combatMerge(cur, incoming, newId) {
  const blocks = Object.assign({}, cur.blocks);
  const key = b => `${b.name}\u0000${b.source || ''}`;
  const seen = new Map();
  const note = b => { const k = key(b); seen.set(k, (seen.get(k) || new Set()).add(JSON.stringify(FP.combatSnapshot(b)))); };
  Object.values(blocks).forEach(note);
  for (const b of Object.values(incoming.blocks || {})) {
    if ((seen.get(key(b)) || new Set()).has(JSON.stringify(FP.combatSnapshot(b)))) continue;
    note(FP.combatAddEntry(blocks, b));
  }
  let nextId = cur.nextId;
  const renumber = rs => (rs || []).map(r => Object.assign({}, r, { id: nextId++ }));
  const inFights = Array.isArray(incoming.fights) && incoming.fights.length
    ? incoming.fights.map(f => Object.assign({}, f, { rows: f.id === incoming.openId ? incoming.rows : f.rows }))
    : ((incoming.rows || []).length ? [{ id: newId(), name: 'Restored fight', rows: incoming.rows }] : []);
  const have = new Set(cur.fights.map(f => f.id));
  const added = inFights.filter(f => !have.has(f.id)).map(f => ({ id: f.id, name: f.name, rows: renumber(f.rows) }));
  const st = Object.assign({}, cur, { blocks, fights: cur.fights.map(f => Object.assign({}, f)), rows: cur.rows });
  // On a fresh install the one empty fight gives way, so the restore opens on a real fight.
  const lone = st.fights.length === 1 && !st.rows.length && st.fights[0].name === 'Fight';
  st.fights.push(...added);
  st.nextId = nextId;
  if (lone && added.length) {
    const empty = st.fights[0].id;
    combatOpenFight(st, (added.find(f => f.id === incoming.openId) || added[0]).id);
    st.fights = st.fights.filter(f => f.id !== empty);
  }
  return st;
}

// What is written to disk: `combat` in the shape saved before the list (the open fight and the
// bestiary), and `fights` under a key an older build never reads, so its saves erase no fight.
function combatSavedParts(st) {
  return {
    combat: { rows: st.rows, blocks: st.blocks, nextId: st.nextId },
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
    combatDuplicateFight, combatRenameFight, combatDeleteFight, combatMerge, combatSavedParts, combatBackupData };
}
