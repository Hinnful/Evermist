'use strict';

// The Defeated line (BACKLOG 296): which rows count as defeated, Clean up's mark, the render order, the
// flag cleared again, Sort over the live rows, and where an add lands.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const cp = require('../src/combat/combatPlan.js');
const { initiativeSlots } = require('../src/combat/initiativePlan.js');

const sb = max => ({ name: 'Zombie', hp: String(max), ac: '8' });
const row = (id, o) => Object.assign({ id, init: '', name: 'Zombie ' + id, hp: '', ac: '', conds: [], side: 'enemy', sb: sb(22) }, o);

describe('a defeated row', () => {
  it('is an enemy at 0 HP or below', () => {
    assert.equal(cp.combatIsDefeated(row(1, { hp: '-22' })), true);
    assert.equal(cp.combatIsDefeated(row(1, { hp: '-30' })), true);
    assert.equal(cp.combatIsDefeated(row(1, { hp: '-21' })), false);
    assert.equal(cp.combatIsDefeated(row(1, { hp: '' })), false);
  });
  it('is never an ally, which keeps rolling death saves', () => {
    assert.equal(cp.combatIsDefeated(row(1, { hp: '-22', side: 'ally' })), false);
  });
  it('counts a row with no side as an enemy', () => {
    assert.equal(cp.combatIsDefeated(row(1, { hp: '-22', side: undefined })), true);
  });
  it('needs a max HP: a hand-typed line with none is never down', () => {
    assert.equal(cp.combatIsDefeated({ id: 1, name: 'Rat', hp: '-5', side: 'enemy' }), false);
    assert.equal(cp.combatIsDefeated({ id: 1, name: 'Rat', hp: '7 - 7', side: 'enemy' }), false);
    assert.equal(cp.combatIsDefeated({ id: 1, name: 'Rat', hp: '- 7', side: 'enemy', sb: { hp: '7' } }), true);
  });
});

describe('a cleaned row', () => {
  it('carries the flag and is still defeated', () => {
    assert.equal(cp.combatIsCleaned(row(1, { hp: '-22', cleaned: true })), true);
    assert.equal(cp.combatIsCleaned(row(1, { hp: '-22' })), false);
    assert.equal(cp.combatIsCleaned(row(1, { hp: '-5', cleaned: true })), false);
    assert.equal(cp.combatIsCleaned(row(1, { hp: '-22', cleaned: true, side: 'ally' })), false);
  });
});

describe('Clean up', () => {
  it('marks every defeated enemy and nothing else', () => {
    const rows = [row(1, { hp: '-22' }), row(2, { hp: '-3' }), row(3, { hp: '-22', side: 'ally' }), row(4, { hp: '-40' })];
    assert.equal(cp.combatToClean(rows), 2);
    assert.equal(cp.combatCleanUp(rows), 2);
    assert.deepEqual(rows.map(r => !!r.cleaned), [true, false, false, true]);
    assert.equal(cp.combatToClean(rows), 0);
  });
  it('never moves a row inside the list', () => {
    const rows = [row(1, { hp: '-22' }), row(2)], before = rows.slice();
    cp.combatCleanUp(rows);
    assert.deepEqual(rows, before);
  });
});

describe('the render order', () => {
  it('draws the live rows in their order, then the cleaned ones in theirs', () => {
    const rows = [row(1, { hp: '-22', cleaned: true }), row(2), row(3, { hp: '-22', cleaned: true }), row(4)];
    const o = cp.combatRenderOrder(rows);
    assert.deepEqual(o.live.map(r => r.id), [2, 4]);
    assert.deepEqual(o.gone.map(r => r.id), [1, 3]);
  });
  it('keeps a defeated row not yet cleaned among the live ones', () => {
    const o = cp.combatRenderOrder([row(1, { hp: '-22' }), row(2)]);
    assert.deepEqual(o.live.map(r => r.id), [1, 2]);
    assert.deepEqual(o.gone, []);
  });
});

describe('the cleaned flag cleared', () => {
  it('on a row back above 0 HP', () => {
    const rows = [row(1, { hp: '-22 + 5', cleaned: true }), row(2, { hp: '-22', cleaned: true })];
    assert.equal(cp.combatReviveRows(rows), 1);
    assert.equal(rows[0].cleaned, undefined);
    assert.equal(rows[1].cleaned, true);
  });
  it('on a row made an ally', () => {
    const rows = [row(1, { hp: '-22', cleaned: true, side: 'ally' })];
    assert.equal(cp.combatReviveRows(rows), 1);
    assert.equal('cleaned' in rows[0], false);
  });
  it('on a duplicate', () => {
    const r = row(1, { hp: '-22', cleaned: true });
    const c = cp.combatDuplicateRow(r, [r], 2);
    assert.equal('cleaned' in c, false);
    assert.equal(r.cleaned, true);
  });
  it('on a suggestion pick that replaces the row', () => {
    const r = row(1, { hp: '-22', cleaned: true, conds: ['Prone'] });
    cp.combatPickInto(r, { id: 'b1', name: 'Ghoul', hp: '22', ac: '12' }, []);
    assert.equal('cleaned' in r, false);
    assert.equal(r.name, 'Ghoul');
    assert.equal(r.hp, '');
    assert.equal(r.sbChanged, false);
  });
  it('on Return to fight', () => {
    const r = row(1, { hp: '-22', cleaned: true });
    cp.combatReturnRow(r);
    assert.equal('cleaned' in r, false);
  });
});

describe('Sort over the live rows', () => {
  it('reads as sorted when only a cleaned row is out of order', () => {
    const rows = [row(1, { init: '5', hp: '-22', cleaned: true }), row(2, { init: '20' }), row(3, { init: '10' })];
    assert.equal(cp.combatIsSortedByInit(rows), false);
    assert.equal(cp.combatLiveSorted(rows), true);
  });
  it('sorts the live rows into their own places and leaves each cleaned row where it is', () => {
    const rows = [row(1, { init: '5' }), row(2, { init: '1', hp: '-22', cleaned: true }), row(3, { init: '20' }), row(4, { init: '10' })];
    assert.equal(cp.combatLiveSorted(rows), false);
    assert.deepEqual(cp.combatSortLive(rows).map(r => r.id), [3, 2, 4, 1]);
    assert.equal(cp.combatLiveSorted(cp.combatSortLive(rows)), true);
  });
});

describe('where an add lands', () => {
  it('right after the last live row, above the Defeated line', () => {
    assert.equal(cp.combatAddIndex([row(1), row(2, { hp: '-22', cleaned: true }), row(3, { hp: '-22', cleaned: true })]), 1);
    assert.equal(cp.combatAddIndex([row(1, { hp: '-22', cleaned: true }), row(2)]), 2);
    assert.equal(cp.combatAddIndex([row(1, { hp: '-22', cleaned: true })]), 0);
    assert.equal(cp.combatAddIndex([]), 0);
  });
});

describe('the TV turn order with cleaned rows', () => {
  it('is what it was: allies always, enemies with an initiative and above 0 HP', () => {
    const rows = [row(1, { init: '15' }), row(2, { init: '12', hp: '-22', cleaned: true }), row(3, { init: '9', side: 'ally', name: 'Lira', hp: '-22', cleaned: true })];
    assert.deepEqual(initiativeSlots(rows), [{ n: 1, count: 1 }, { n: 2, name: 'Lira' }]);
  });
});

describe('an HP line too long for its cell', () => {
  it('splits into its hits', () => {
    assert.deepEqual(cp.combatHpHits('- 18 - 4 +5'), ['- 18', '- 4', '+5']);
    assert.deepEqual(cp.combatHpHits(''), []);
  });
  it('shows "…" and the last hits that fit', () => {
    assert.equal(cp.combatHpTail('- 18 - 4 - 9 - 12', 2), '… - 9 - 12');
    assert.equal(cp.combatHpTail('-18-4-9', 1), '… -9');
  });
});

describe('the column widths after the update', () => {
  it('start at the new defaults, keeping the list height and the stat block size from the old key', () => {
    const old = JSON.stringify({ name: 240, hp: 200, cond: 150, atk: 400, listH: 300, statW: 420, statH: 500 });
    assert.deepEqual(cp.combatReadCols(null, old), { listH: 300, statW: 420, statH: 500 });
  });
  it('read the new key once it is written, ignoring the old', () => {
    assert.deepEqual(cp.combatReadCols(JSON.stringify({ name: 150 }), JSON.stringify({ listH: 300 })), { name: 150 });
  });
  it('survive a broken or missing store', () => {
    assert.deepEqual(cp.combatReadCols('{', '['), {});
    assert.deepEqual(cp.combatReadCols(null, null), {});
  });
});
