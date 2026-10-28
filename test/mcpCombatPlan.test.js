'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { combatBlankBlock } = require('../src/combat/combatPlan.js');
const { mcpRowsRefusal, mcpRowEdits, mcpFindMonster, mcpReplacedEntry, mcpCopiedEntry, mcpRestoreEntry, mcpCombatUndoImport } = require('../src/mcp/mcpCombatPlan.js');

const rows = () => [
  { id: 1, init: '', name: 'Goblin', hp: '', ac: '15', conds: [], side: 'enemy', sb: { name: 'Goblin', ac: '15 (leather)' } },
  { id: 2, init: '', name: 'Goblin 2', hp: '', ac: '15', conds: [], side: 'enemy', sb: { name: 'Goblin', ac: '15 (leather)' } },
];

describe('mcpRowsRefusal', () => {
  it('refuses row details on the open fight', () => {
    assert.ok(mcpRowsRefusal({ rows: [{ row: 'Goblin', hp: '7' }] }));
  });
  it('lets an edit without rows through', () => {
    assert.equal(mcpRowsRefusal({ add: [{ name: 'Wolf' }] }), null);
    assert.equal(mcpRowsRefusal({ rows: [] }), null);
  });
});

describe('mcpRowEdits', () => {
  it('sets a row picked by its shown name and leaves the input alone', () => {
    const src = rows(), r = mcpRowEdits(src, [{ row: 'goblin 2', hp: '12', init: '-1' }]);
    assert.equal(r.rows[1].hp, '12');
    assert.equal(r.rows[1].init, '-1');
    assert.equal(src[1].hp, '');
    assert.equal(r.changed, true);
  });
  it('carries AC and name into the row\'s stat block', () => {
    const r = mcpRowEdits(rows(), [{ row: 'Goblin', ac: '17', name: 'Sneak' }]);
    assert.equal(r.rows[0].sb.ac, '17 (leather)');
    assert.equal(r.rows[0].sb.name, 'Sneak');
    assert.equal(r.rows[0].sbChanged, true);
  });
  it('names a row that does not exist and changes nothing', () => {
    const r = mcpRowEdits(rows(), [{ row: 'Orc', hp: '5' }]);
    assert.equal(r.changed, false);
    assert.match(r.errors[0], /No row is called "Orc"/);
  });
  it('refuses bad values, an empty name, a clashing name and an edit with no detail', () => {
    const r = mcpRowEdits(rows(), [{ row: 'Goblin', ac: 'high' }, { row: 'Goblin', init: 'x' }, { row: 'Goblin', name: ' ' },
      { row: 'Goblin', name: 'Goblin 2' }, { row: 'Goblin' }]);
    assert.equal(r.changed, false);
    assert.equal(r.errors.length, 5);
  });
});

describe('bestiary monsters', () => {
  const b = (id, name, source) => Object.assign(combatBlankBlock(id, name), { source });
  const blocks = () => ({ b1: b('b1', 'Wolf', 'A'), b2: b('b2', 'Wolf', 'B'), b3: b('b3', 'Owlbear', 'A') });
  it('finds by name and asks for the source when two share one', () => {
    assert.equal(mcpFindMonster(blocks(), 'owlbear').entry.id, 'b3');
    assert.match(mcpFindMonster(blocks(), 'Wolf').error, /source/);
    assert.equal(mcpFindMonster(blocks(), 'Wolf', 'b').entry.id, 'b2');
    assert.ok(mcpFindMonster(blocks(), 'Troll').error);
  });
  it('replaces under the old id and source and keeps the DM\'s notes', () => {
    const bl = blocks(); bl.b3.notes = 'mine';
    const made = mcpReplacedEntry(bl, bl.b3, combatBlankBlock('', 'Owlbear Alpha'));
    assert.equal(made.entry.id, 'b3');
    assert.equal(made.entry.source, 'A');
    assert.equal(made.entry.notes, 'mine');
  });
  it('refuses a replacement that takes another entry\'s name', () => {
    const bl = blocks();
    assert.ok(mcpReplacedEntry(bl, bl.b3, combatBlankBlock('', 'Wolf')).error);
  });
  it('copies under a new name and refuses a taken or empty one', () => {
    const bl = blocks();
    const c = mcpCopiedEntry(bl, bl.b3, 'Cave Owlbear');
    assert.equal(c.entry.name, 'Cave Owlbear');
    assert.notEqual(c.entry.id, 'b3');
    assert.ok(mcpCopiedEntry(bl, bl.b3, 'Owlbear').error);
    assert.ok(mcpCopiedEntry(bl, bl.b3, '').error);
  });
  it('restores a deleted entry under its id, or a new one when the id was taken', () => {
    const bl = blocks(), kept = bl.b3; delete bl.b3;
    assert.equal(mcpRestoreEntry(bl, kept).id, 'b3');
    const bl2 = blocks(), k2 = bl2.b3; delete bl2.b3; bl2.b3 = b('b3', 'Other', 'A');
    const e = mcpRestoreEntry(bl2, k2);
    assert.notEqual(e.id, 'b3');
    assert.equal(bl2[e.id].name, 'Owlbear');
  });
});

describe('mcpCombatUndoImport', () => {
  const snap = { rows: [], blocks: { b1: { id: 'b1' } }, nextId: 1, openId: 'f0', fights: [{ id: 'f0', name: 'Fight' }] };
  it('removes the fights and monsters the import added, and brings back the empty fight it displaced', () => {
    const now = { rows: [{ id: 1 }], blocks: { b1: { id: 'b1' }, b2: { id: 'b2' } }, nextId: 2, openId: 'f1', fights: [{ id: 'f1', name: 'Ambush' }, { id: 'f2', name: 'Boss', rows: [{ id: 2 }] }] };
    const out = mcpCombatUndoImport(now, JSON.parse(JSON.stringify(snap)));
    assert.deepEqual(out.state.fights, [{ id: 'f0', name: 'Fight' }]);
    assert.equal(out.state.openId, 'f0');
    assert.deepEqual(out.state.rows, []);
    assert.deepEqual(Object.keys(out.state.blocks), ['b1']);
    assert.equal(out.state.nextId, 1);
  });
  it('keeps a fight the DM opened that the import did not add', () => {
    const before = { rows: [{ id: 1 }], blocks: {}, nextId: 2, openId: 'f0', fights: [{ id: 'f0', name: 'Fight' }, { id: 'f9', name: 'Old', rows: [] }] };
    const now = { ...before, fights: before.fights.concat({ id: 'f3', name: 'New', rows: [{ id: 2 }] }), nextId: 3 };
    const out = mcpCombatUndoImport(now, JSON.parse(JSON.stringify(before)));
    assert.deepEqual(out.state.fights.map(f => f.id), ['f0', 'f9']);
    assert.equal(out.state.openId, 'f0');
    assert.equal(out.state.nextId, 2);
  });
  it('refuses while a fight the import added is open and nothing was displaced', () => {
    const before = { rows: [], blocks: {}, nextId: 1, openId: 'f0', fights: [{ id: 'f0', name: 'A' }, { id: 'f9', name: 'B', rows: [] }] };
    const now = { rows: [], blocks: {}, nextId: 1, openId: 'f3', fights: [{ id: 'f0', name: 'A', rows: [] }, { id: 'f9', name: 'B', rows: [] }, { id: 'f3', name: 'C' }] };
    assert.match(mcpCombatUndoImport(now, before).error, /open at the table/);
  });
});
