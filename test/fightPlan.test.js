'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { combatBlankBlock } = require('../src/combat/combatPlan.js');
const {
  combatFightId, combatFightsFrom, combatFightRows, combatOpenFight, combatAddFight, combatDuplicateFight,
  combatRenameFight, combatDeleteFight, combatMerge, combatSavedParts, combatBackupData,
} = require('../src/combat/fightPlan.js');

const ids = () => { let n = 0; return () => 'id' + (++n); };
const goblin = Object.assign(combatBlankBlock('b1', 'Goblin'), { source: 'dnd.su', ac: '15 (leather armor)', hp: '7 (2d6)' });

// Two fights, the first open: its rows live at the top, the second carries its own.
function twoFights() {
  return { rows: [{ id: 1, name: 'Goblin', hp: '- 4' }], blocks: { b1: goblin }, nextId: 3, openId: 'fA',
    fights: [{ id: 'fA', name: 'Ambush' }, { id: 'fB', name: 'Strahd', rows: [{ id: 2, name: 'Strahd' }] }] };
}

// The load and merge of the build before the list, copied as it shipped, so a pulled release is tested.
function oldLoad(raw) {
  const d = JSON.parse(raw);
  return { rows: Array.isArray(d.rows) ? d.rows : [], blocks: d.blocks || {}, nextId: d.nextId || 1 };
}
function oldMerge(cur, incoming) {
  const blocks = Object.assign({}, cur.blocks);
  for (const b of Object.values(incoming.blocks || {})) if (!Object.values(blocks).some(x => x.name === b.name)) blocks[b.id] = b;
  let rows = cur.rows, nextId = cur.nextId;
  if (!rows.length) rows = (incoming.rows || []).map(r => Object.assign({}, r, { id: nextId++ }));
  return { rows, blocks, nextId };
}

describe('the list of fights', () => {
  it('makes one fight named "Fight" from a save that has no list', () => {
    const l = combatFightsFrom(null, ids());
    assert.deepEqual(l, { openId: 'id1', fights: [{ id: 'id1', name: 'Fight' }] });
  });
  it('keeps a saved list, and the open fight carries no rows of its own', () => {
    const l = combatFightsFrom({ openId: 'fB', fights: [{ id: 'fA', name: 'A', rows: [] }, { id: 'fB', name: 'B', rows: [{ id: 9 }] }] }, ids());
    assert.equal(l.openId, 'fB');
    assert.equal(l.fights[1].rows, undefined);
  });
  it('switches fights without losing either one\'s rows', () => {
    const st = combatOpenFight(twoFights(), 'fB');
    assert.deepEqual(st.rows.map(r => r.name), ['Strahd']);
    assert.deepEqual(combatFightRows(st, st.fights[0]).map(r => r.hp), ['- 4']);
    combatOpenFight(st, 'fA');
    assert.deepEqual(st.rows.map(r => r.name), ['Goblin']);
  });
  it('adds a fight and opens it empty', () => {
    const st = combatAddFight(twoFights(), ids());
    assert.equal(st.openId, 'id1');
    assert.deepEqual(st.rows, []);
    assert.equal(st.fights.length, 3);
  });
  it('duplicates a fight with fresh row ids, beside the original, without opening it', () => {
    const st = combatDuplicateFight(twoFights(), 'fA', ids());
    assert.deepEqual(st.fights.map(f => f.name), ['Ambush', 'Ambush copy', 'Strahd']);
    assert.deepEqual(st.fights[1].rows.map(r => r.id), [3]);
    assert.equal(st.openId, 'fA');
    st.fights[1].rows[0].hp = '';
    assert.equal(st.rows[0].hp, '- 4');
  });
  it('renames, and keeps the old name for an empty one', () => {
    const st = combatRenameFight(twoFights(), 'fA', '  Road  ');
    assert.equal(st.fights[0].name, 'Road');
    combatRenameFight(st, 'fA', '   ');
    assert.equal(st.fights[0].name, 'Road');
  });
  it('opens the neighbour when the open fight is deleted, and never leaves the list empty', () => {
    const st = combatDeleteFight(twoFights(), 'fA', ids());
    assert.equal(st.openId, 'fB');
    assert.deepEqual(st.rows.map(r => r.name), ['Strahd']);
    combatDeleteFight(st, 'fB', ids());
    assert.deepEqual(st.fights.map(f => f.name), ['Fight']);
    assert.deepEqual(st.rows, []);
  });
  it('gives every fight an id no other install will share', () => {
    const seen = new Set(Array.from({ length: 200 }, combatFightId));
    assert.equal(seen.size, 200);
  });
});

describe('what goes to disk', () => {
  it('keeps the open fight and the bestiary in the shape saved before the list', () => {
    const p = combatSavedParts(twoFights());
    assert.deepEqual(Object.keys(p.combat), ['rows', 'blocks', 'nextId']);
    assert.equal(p.fights.fights[0].rows, undefined);
    assert.deepEqual(p.fights.fights[1].rows.map(r => r.name), ['Strahd']);
  });
  it('lets the build before the list open the open fight and the whole bestiary', () => {
    const old = oldLoad(JSON.stringify(combatSavedParts(twoFights()).combat));
    assert.deepEqual(old.rows.map(r => r.name), ['Goblin']);
    assert.deepEqual(Object.keys(old.blocks), ['b1']);
  });
  it('lets the build before the list restore a new backup\'s open fight and bestiary', () => {
    const old = oldMerge({ rows: [], blocks: {}, nextId: 1 }, JSON.parse(JSON.stringify(combatBackupData(twoFights()))));
    assert.deepEqual(old.rows.map(r => r.name), ['Goblin']);
    assert.deepEqual(Object.values(old.blocks).map(b => b.name), ['Goblin']);
  });
});

describe('a backup merged in', () => {
  const here = () => ({ rows: [{ id: 1, name: 'Goblin' }], blocks: { b1: goblin }, nextId: 2, openId: 'fX',
    fights: [{ id: 'fX', name: 'Here' }] });
  it('adds the fights this install lacks, renumbered, and never replaces one it has', () => {
    const inc = combatBackupData(twoFights());
    const m = combatMerge(here(), inc, ids());
    assert.deepEqual(m.fights.map(f => f.name), ['Here', 'Ambush', 'Strahd']);
    assert.deepEqual(m.fights[1].rows.map(r => r.id), [2]);
    assert.deepEqual(m.fights[2].rows.map(r => r.id), [3]);
    assert.equal(m.nextId, 4);
    assert.equal(m.openId, 'fX');
    const again = combatMerge(m, inc, ids());
    assert.equal(again.fights.length, 3);
  });
  it('restores a backup from before the list as one fight, even onto a migrated install', () => {
    const migrated = Object.assign(here(), combatFightsFrom(null, () => 'fM'));
    const m = combatMerge(migrated, { rows: [{ id: 7, name: 'Skeleton' }], blocks: {} }, () => 'fOld');
    assert.deepEqual(m.fights.map(f => f.id), ['fM', 'fOld']);
    assert.deepEqual(combatFightRows(m, m.fights[1]).map(r => r.name), ['Skeleton']);
  });
  it('opens the restored fight on a fresh install, in place of its empty one', () => {
    const fresh = Object.assign({ rows: [], blocks: {}, nextId: 1 }, combatFightsFrom(null, () => 'fNew'));
    const m = combatMerge(fresh, combatBackupData(twoFights()), ids());
    assert.deepEqual(m.fights.map(f => f.name), ['Ambush', 'Strahd']);
    assert.equal(m.openId, 'fA');
    assert.deepEqual(m.rows.map(r => r.name), ['Goblin']);
  });
  it('leaves the fights it was given untouched', () => {
    const cur = here();
    combatMerge(cur, combatBackupData(twoFights()), ids());
    assert.deepEqual(cur.fights, [{ id: 'fX', name: 'Here' }]);
  });
  it('does not double a bestiary entry it already has, and still adds one carrying edits', () => {
    const edited = Object.assign({}, goblin, { id: 'b7', hp: '12 (3d6)' });
    const m = combatMerge(here(), { rows: [], blocks: { b7: edited, b8: Object.assign({}, goblin, { id: 'b8' }) } }, ids());
    assert.deepEqual(Object.values(m.blocks).map(b => b.name + ' ' + b.hp).sort(), ['Goblin (1) 12 (3d6)', 'Goblin 7 (2d6)']);
  });
  it('adds an entry whose only difference is its Table line', () => {
    const m = combatMerge(here(), { rows: [], blocks: { b9: Object.assign({}, goblin, { id: 'b9', quick: 'Scimitar +4 5' }) } }, ids());
    assert.equal(Object.keys(m.blocks).length, 2);
  });
});
