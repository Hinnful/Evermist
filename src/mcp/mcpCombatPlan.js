'use strict';
// mcpCombatPlan.js — pure rules behind Claude's fight-row and bestiary edits: which row details it may set,
// the open-fight refusal for them, and how a bestiary monster is found, replaced, copied and put back. No DOM. Tested.

const MCC = (typeof module !== 'undefined' && module.exports) ? require('../combat/combatPlan.js')
  : { combatSetFirstNum, combatBaseName, combatUniqueName, combatNextBlockId, combatSnapshot, combatMintUid, combatFirstNum, combatRowHpState, combatBlankBlock,
    combatIsCleaned, combatReviveRows };

const MCP_ROW_FIELDS = ['name', 'hp', 'maxHp', 'ac', 'init'];
const _key = s => String(s || '').trim().toLowerCase();

// The fight open at the table takes no row details; only adding monsters and raising a count are allowed there.
function mcpRowsRefusal(args) {
  return Array.isArray(args && args.rows) && args.rows.length ? 'changing a row\'s details' : null;
}

// Row details applied to copies of `rows`. Each edit is { row: "Goblin 2", name?, hp?, maxHp?, ac?, init? }, the row
// picked by its shown name. AC, max HP and a name go into the row's own stat block, as typing them in the table does;
// `hp` is the table's damage and healing after that max.
// Returns { rows, changed, errors }; an edit with a problem is skipped and named in `errors`.
function mcpRowEdits(rows, edits) {
  const list = (rows || []).map(r => JSON.parse(JSON.stringify(r)));
  const out = { rows: list, changed: false, errors: [] };
  for (const e of Array.isArray(edits) ? edits : []) {
    const shown = String((e && e.row) || '').trim();
    const hits = list.filter(r => _key(r.name) === _key(shown));
    if (hits.length !== 1) { out.errors.push(hits.length ? 'More than one row is called "' + shown + '".' : 'No row is called "' + shown + '".'); continue; }
    const fields = MCP_ROW_FIELDS.filter(f => e[f] !== undefined);
    if (!fields.length) { out.errors.push('"' + shown + '": no detail to set (name, hp, maxHp, ac or init).'); continue; }
    const r = hits[0], bad = rowFieldProblem(e, list, r);
    if (bad) { out.errors.push('"' + shown + '": ' + bad); continue; }
    for (const f of fields) {
      const v = String(e[f]).trim();
      if (f === 'maxHp') { out.changed = _setRowMax(r, v) || out.changed; continue; }
      if (r[f] === v) continue;
      r[f] = v;
      if (f === 'ac' && r.sb) r.sb.ac = MCC.combatSetFirstNum(r.sb.ac, v);
      if (f === 'name' && r.sb) r.sb.name = MCC.combatBaseName(v);
      if (f === 'ac' || f === 'name') r.sbChanged = true;
      out.changed = true;
    }
  }
  MCC.combatReviveRows(list);
  return out;
}

// A fight's own max for one row, kept in its stat-block copy so the bestiary entry stays as it is.
function _setRowMax(r, v) {
  if (!r.sb) r.sb = MCC.combatSnapshot(MCC.combatBlankBlock('', MCC.combatBaseName(r.name)));
  if (MCC.combatFirstNum(r.sb.hp) === v) return false;
  r.sb.hp = MCC.combatSetFirstNum(r.sb.hp, v);
  r.sbChanged = true;
  return true;
}

function rowFieldProblem(e, list, row) {
  if (e.name !== undefined) {
    const n = String(e.name).trim();
    if (!n) return 'a row needs a name.';
    if (list.some(x => x !== row && _key(x.name) === _key(n))) return 'another row is already called "' + n + '".';
  }
  if (e.ac !== undefined && !/^\d{0,3}$/.test(String(e.ac).trim())) return 'AC is a whole number.';
  if (e.init !== undefined && !/^-?\d{0,3}$/.test(String(e.init).trim())) return 'initiative is a whole number.';
  if (e.maxHp !== undefined && !/^[1-9]\d{0,4}$/.test(String(e.maxHp).trim())) return 'maxHp is a whole number above 0.';
  if (e.hp !== undefined) return hpProblem(String(e.hp));
  return null;
}

// hp is damage taken and healing since the fight began, as the table's box takes it: "-12", "+5", "-9 -12", or empty
// for full HP. A bare number would read as nothing the table can add up.
function hpProblem(hp) {
  if (hp.length > 60) return 'hp is too long.';
  const s = hp.replace(/\s+/g, '');
  if (!s || /^[+-]\d+([+-]\d+)*$/.test(s)) return null;
  if (/^\d+$/.test(s)) return 'hp "' + hp.trim() + '" was not set: hp is damage and healing, not max HP. Send damage as "-' + s + '" or healing as "+' + s + '"; to change the row\'s max HP, send maxHp: ' + s + '.';
  return 'hp "' + hp.trim() + '" was not set: hp is damage and healing in the table\'s form, such as "-12", "+5" or "-9 -12", or empty for full HP.';
}

// One row as read_fight reports it: max HP from its stat-block copy, current HP after the damage line, and that line.
function mcpFightRowRead(r) {
  const max = MCC.combatFirstNum(r.sb && r.sb.hp), value = MCC.combatRowHpState(max, r.hp).value;
  return { name: r.name, side: r.side || 'enemy', ac: r.ac || MCC.combatFirstNum(r.sb && r.sb.ac) || null,
    maxHp: max ? Number(max) : null, hp: Number.isFinite(value) ? value : null, damage: String(r.hp || '').trim() || null,
    cleanedUp: MCC.combatIsCleaned(r) };
}

// One bestiary monster by name, narrowed by source when two share a name: { entry } or { error }.
function mcpFindMonster(blocks, name, source) {
  const hits = Object.values(blocks || {}).filter(b => _key(b.name) === _key(name) && (!source || _key(b.source) === _key(source)));
  if (!hits.length) return { error: 'No monster is called "' + (name || '') + '" in the bestiary. list_bestiary searches it.' };
  if (hits.length > 1) return { error: 'More than one monster is called "' + name + '". Give its source: ' + hits.map(b => b.source || '(none)').join(', ') + '.' };
  return { entry: hits[0] };
}

const _taken = (blocks, name, source, except) => Object.values(blocks).some(b => b !== except && b.name === name && (b.source || '') === (source || ''));

// The entry a re-read stat block makes: the new text's block under the old id and source, with the DM's own notes
// and lore kept. Refused when its name would clash with another entry of that source.
function mcpReplacedEntry(blocks, old, parsed) {
  const entry = Object.assign(MCC.combatSnapshot(parsed), { id: old.id, source: old.source || '', notes: old.notes || '', lore: parsed.lore || old.lore || '' });
  delete entry.uid;
  if (old.uid) entry.uid = old.uid;
  if (_taken(blocks, entry.name, entry.source, old)) return { error: 'Another monster of the source "' + entry.source + '" is already called "' + entry.name + '", so nothing was changed.' };
  return { entry };
}

// A copy of an entry under `newName`, with its own id. Refused when that name is already taken in its source.
function mcpCopiedEntry(blocks, old, newName) {
  const name = String(newName || '').trim();
  if (!name) return { error: 'A copy needs a name: give newName.' };
  if (_taken(blocks, name, old.source)) return { error: 'A monster of the source "' + (old.source || '') + '" is already called "' + name + '". Use another name.' };
  return { entry: Object.assign(MCC.combatSnapshot(old), { id: MCC.combatNextBlockId(blocks), uid: MCC.combatMintUid(), name }) };
}

// Puts a deleted entry back under its old id, or a new one when another monster took it since.
function mcpRestoreEntry(blocks, entry) {
  const e = blocks[entry.id] ? Object.assign({}, entry, { id: MCC.combatNextBlockId(blocks) }) : entry;
  blocks[e.id] = e;
  return e;
}

function mcpWouldDeleteMonster(b) {
  return 'Would delete the monster "' + b.name + '"' + (b.source ? ' (' + b.source + ')' : '') + ' from the bestiary. Fights already built keep their own copies. Nothing was deleted. Tell the DM and, on their yes, call again with confirmed: true.';
}

// The fight table after a zip import is undone: `now` is the table, `snap` a JSON copy taken before the import. The
// monsters and fights the import added go; a fight it displaced comes back, and the table opens on it again. { state }
// or { error } when a fight the import added is the one open at the table.
function mcpCombatUndoImport(now, snap) {
  const had = new Set(snap.fights.map(f => f.id)), live = new Set(now.fights.map(f => f.id));
  const blocks = {};
  for (const k of Object.keys(now.blocks || {})) if (snap.blocks && snap.blocks[k]) blocks[k] = now.blocks[k];
  const state = Object.assign({}, now, { blocks });
  state.fights = now.fights.filter(f => had.has(f.id));
  const displaced = snap.fights.filter(f => !live.has(f.id));
  if (now.openId !== null && !had.has(now.openId)) {
    if (!displaced.some(f => f.id === snap.openId)) return { error: 'A fight the import added is open at the table. Ask the DM to open another fight first.' };
    state.openId = snap.openId;
    state.rows = snap.rows;
  }
  state.fights = displaced.concat(state.fights);
  const rowIds = state.rows.concat(...state.fights.map(f => f.rows || [])).map(r => r.id);
  state.nextId = Math.max(snap.nextId, ...rowIds.map(n => n + 1));
  return { state };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mcpCombatUndoImport, MCP_ROW_FIELDS, mcpFightRowRead, mcpRowsRefusal, mcpRowEdits, mcpFindMonster, mcpReplacedEntry, mcpCopiedEntry, mcpRestoreEntry, mcpWouldDeleteMonster };
}
