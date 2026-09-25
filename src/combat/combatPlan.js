'use strict';

// combatPlan.js — pure kernel for the fight table and the bestiary: the HP line's arithmetic, a
// row's copy of an entry, initiative order, ability modifiers. No DOM. Unit-tested; see
// test/combatPlan.test.js.

// The HP cell holds what the DM typed, "45 - 9 - 12", and the table shows what it adds up to.
// null = nothing typed; NaN = something that is not a sum, which the cell shows as "?".
function combatHpSum(expr) {
  const s = String(expr || '').replace(/\s+/g, '');
  if (!s) return null;
  if (!/^[+-]?\d+([+-]\d+)*$/.test(s)) return NaN;
  return s.match(/[+-]?\d+/g).reduce((a, t) => a + Number(t), 0);
}

// The first number typed is the creature's maximum, so a heal past it still reads as a share of it.
function combatHpState(expr) {
  const value = combatHpSum(expr);
  const max = parseInt((String(expr || '').match(/\d+/) || [])[0], 10);
  if (value === null || Number.isNaN(value) || !max) return { value, share: null, bloodied: false, down: false };
  const share = Math.max(0, Math.min(1, value / max));
  return { value, share, bloodied: share <= 0.5, down: value <= 0 };
}

// A row's name without its copy number: "Skeleton 3" is a "Skeleton".
function combatBaseName(name) {
  return String(name || '').trim().replace(/\s+\d+$/, '');
}

// Highest first; a row with no initiative sinks to the bottom; ties keep the order they had.
function combatSortByInit(rows) {
  const key = r => {
    const n = parseInt(r.init, 10);
    return Number.isNaN(n) ? -Infinity : n;
  };
  return rows.map((r, i) => ({ r, i }))
    .sort((a, b) => (key(b.r) - key(a.r)) || (a.i - b.i))
    .map(x => x.r);
}

function combatAbilityMod(score) {
  const n = parseInt(score, 10);
  if (Number.isNaN(n)) return '';
  const m = Math.floor((n - 10) / 2);
  return (m >= 0 ? '+' : '') + m;
}

function combatBlankBlock(id, name) {
  return { id, name, source: '', meta: '', ac: '', hp: '', speed: '', abil: ['10', '10', '10', '10', '10', '10'],
    saves: '', skills: '', vuln: '', resist: '', immune: '', senses: '', languages: '', cr: '', secs: {}, lore: '', notes: '' };
}

// The first number in a stat block line: "15 (leather armor)" is AC 15, "45 (6d8+18)" is 45 HP.
function combatFirstNum(s) {
  return (String(s || '').match(/\d+/) || [''])[0];
}

// A row's AC or max HP written back into its stat block line, keeping the rest of the line.
function combatSetFirstNum(s, n) {
  const line = String(s || '');
  if (!n) return line.replace(/\d+\s*/, '').trim();
  return /\d+/.test(line) ? line.replace(/\d+/, n) : n;
}

// Two entries may share a name when their sources differ; a third with the same pair is "Goblin (1)".
function combatUniqueName(blocks, name, source) {
  const taken = new Set(Object.values(blocks).filter(b => (b.source || '') === (source || '')).map(b => b.name));
  if (!taken.has(name)) return name;
  let n = 1;
  while (taken.has(`${name} (${n})`)) n++;
  return `${name} (${n})`;
}

function combatNextBlockId(blocks) {
  let n = 1;
  while (blocks['b' + n]) n++;
  return 'b' + n;
}

// A copy that shares nothing with what it was copied from, so neither side's edits reach the other.
function combatSnapshot(b) {
  const c = JSON.parse(JSON.stringify(b));
  delete c.id;
  return c;
}

// A bestiary entry added as a new bestiary entry: a fresh id, and a name that does not clash.
function combatAddEntry(blocks, b) {
  const id = combatNextBlockId(blocks);
  const e = Object.assign(combatSnapshot(b), { id });
  e.name = combatUniqueName(blocks, e.name, e.source);
  blocks[id] = e;
  return e;
}

// A picked entry becomes the row: the row owns a copy of the stat block, and its AC and max HP
// are that copy's. A second Skeleton in the fight is "Skeleton 2".
function combatRowFromEntry(entry, rows) {
  const copies = rows.filter(r => combatBaseName(r.name) === entry.name).length;
  return { name: copies ? `${entry.name} ${copies + 1}` : entry.name, ac: combatFirstNum(entry.ac),
    hp: '', conds: [], sb: combatSnapshot(entry), sbChanged: false };
}

// A row's HP is its stat block's max, then the damage and healing typed after it: max 45 and
// "- 9 - 12" is 24. With no max yet, the typed line stands alone, its first number the max.
function combatRowHpState(max, rest) {
  const r = String(rest || '').trim();
  if (!max) return combatHpState(r);
  if (r && !/^[+-]/.test(r)) return { value: NaN, share: null, bloodied: false, down: false };
  return combatHpState(max + r);
}

// A backup's bestiary merges in without doubling an entry already here; its fight lands only on an empty table.
// An edited entry of the same name is still added, so its edits are not lost.
function combatMerge(cur, incoming) {
  const blocks = Object.assign({}, cur.blocks);
  const key = b => `${b.name}\u0000${b.source || ''}`;
  const seen = new Map();
  const note = b => { const k = key(b); seen.set(k, (seen.get(k) || new Set()).add(JSON.stringify(combatSnapshot(b)))); };
  Object.values(blocks).forEach(note);
  for (const b of Object.values(incoming.blocks || {})) {
    if ((seen.get(key(b)) || new Set()).has(JSON.stringify(combatSnapshot(b)))) continue;
    note(combatAddEntry(blocks, b));
  }
  let rows = cur.rows, nextId = cur.nextId;
  if (!rows.length) rows = (incoming.rows || []).map(r => Object.assign({}, r, { id: nextId++ }));
  return Object.assign({}, cur, { rows, blocks, nextId });
}

// A book or module's file name without its extension, so both imports of one file share a source.
function combatSourceName(fileName) {
  return String(fileName || '').replace(/\.[^./\\]{1,5}$/, '').trim();
}

// The blocks an import adds: none already stored under this source, and a name printed twice once.
function combatNewBlocks(blocks, existing, source) {
  const taken = new Set(Object.values(existing).filter(b => (b.source || '') === source).map(b => b.name));
  return blocks.filter(b => !taken.has(b.name) && taken.add(b.name));
}

// Name matches first, then names that merely contain the query; each group alphabetical.
function combatSearchBlocks(blocks, query) {
  const q = String(query || '').trim().toLowerCase();
  const all = Object.values(blocks);
  const byName = (a, b) => a.name.localeCompare(b.name) || (a.source || '').localeCompare(b.source || '');
  if (!q) return all.sort(byName);
  const starts = all.filter(b => b.name.toLowerCase().startsWith(q)).sort(byName);
  const has = all.filter(b => !b.name.toLowerCase().startsWith(q) && b.name.toLowerCase().includes(q)).sort(byName);
  return starts.concat(has);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { combatHpSum, combatHpState, combatBaseName, combatSortByInit, combatAbilityMod,
    combatBlankBlock, combatFirstNum, combatSetFirstNum, combatUniqueName, combatNextBlockId, combatSnapshot,
    combatAddEntry, combatRowFromEntry, combatRowHpState, combatMerge, combatSourceName, combatNewBlocks,
    combatSearchBlocks };
}
