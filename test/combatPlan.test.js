'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  combatHpSum, combatHpState, combatBaseName, combatSortByInit, combatAbilityMod,
} = require('../src/combat/combatPlan.js');

describe('combatHpSum', () => {
  it('adds up what the DM typed', () => {
    assert.equal(combatHpSum('45 - 9 - 12'), 24);
    assert.equal(combatHpSum('45-9+5'), 41);
    assert.equal(combatHpSum(' 13 '), 13);
  });
  it('reads an empty cell as nothing', () => {
    assert.equal(combatHpSum(''), null);
    assert.equal(combatHpSum('   '), null);
    assert.equal(combatHpSum(undefined), null);
  });
  it('reads anything that is not a sum as NaN', () => {
    assert.ok(Number.isNaN(combatHpSum('45 - ')));
    assert.ok(Number.isNaN(combatHpSum('45 * 2')));
    assert.ok(Number.isNaN(combatHpSum('abc')));
  });
  it('goes below zero', () => {
    assert.equal(combatHpSum('13 - 6 - 9'), -2);
  });
});

describe('combatHpState', () => {
  it('takes the first number as the maximum', () => {
    const s = combatHpState('45 - 9 - 12');
    assert.equal(s.value, 24);
    assert.ok(Math.abs(s.share - 24 / 45) < 1e-9);
    assert.equal(s.bloodied, false);
    assert.equal(s.down, false);
  });
  it('is bloodied below half, not at exactly half', () => {
    assert.equal(combatHpState('40 - 21').bloodied, true);
    assert.equal(combatHpState('40 - 20').bloodied, false);
  });
  it('is down at zero or below, and the share stops at zero', () => {
    const s = combatHpState('13 - 6 - 9');
    assert.equal(s.down, true);
    assert.equal(s.share, 0);
  });
  it('caps a heal past the maximum at a full share', () => {
    assert.equal(combatHpState('20 + 5').share, 1);
  });
  it('carries no share for an empty or broken cell', () => {
    assert.equal(combatHpState('').share, null);
    assert.equal(combatHpState('12 -').share, null);
    assert.equal(combatHpState('').down, false);
  });
});

describe('combatBaseName', () => {
  it('drops a trailing copy number', () => {
    assert.equal(combatBaseName('Skeleton 3'), 'Skeleton');
    assert.equal(combatBaseName('Skeleton  12 '), 'Skeleton');
  });
  it('keeps a number that is part of the name', () => {
    assert.equal(combatBaseName('Wight'), 'Wight');
    assert.equal(combatBaseName('Guard2'), 'Guard2');
  });
});

describe('combatSortByInit', () => {
  it('puts the highest first and ties in their old order', () => {
    const rows = [{ n: 'a', init: '12' }, { n: 'b', init: '18' }, { n: 'c', init: '12' }, { n: 'd', init: '3' }];
    assert.deepEqual(combatSortByInit(rows).map(r => r.n), ['b', 'a', 'c', 'd']);
  });
  it('sinks a row with no initiative', () => {
    const rows = [{ n: 'a', init: '' }, { n: 'b', init: '-1' }, { n: 'c', init: 'x' }];
    assert.deepEqual(combatSortByInit(rows).map(r => r.n), ['b', 'a', 'c']);
  });
  it('leaves the array it was given alone', () => {
    const rows = [{ init: '1' }, { init: '2' }];
    combatSortByInit(rows);
    assert.equal(rows[0].init, '1');
  });
});

describe('combatAbilityMod', () => {
  it('rounds down', () => {
    assert.equal(combatAbilityMod('15'), '+2');
    assert.equal(combatAbilityMod('10'), '+0');
    assert.equal(combatAbilityMod('9'), '-1');
    assert.equal(combatAbilityMod('1'), '-5');
  });
  it('says nothing for a blank score', () => {
    assert.equal(combatAbilityMod(''), '');
  });
});

const {
  combatUniqueName, combatSearchBlocks, combatBlankBlock, combatFirstNum, combatSetFirstNum,
  combatSnapshot, combatAddEntry, combatRowFromEntry, combatRowHpState, combatSourceName, combatNewBlocks,
  combatNextName, combatDuplicateRow,
} = require('../src/combat/combatPlan.js');

describe('the bestiary', () => {
  const goblin = Object.assign(combatBlankBlock('b1', 'Goblin'), { source: 'dnd.su', ac: '15 (leather armor)', hp: '7 (2d6)' });
  it('lets a name repeat under another source, and numbers it under the same one', () => {
    const blocks = { b1: goblin };
    assert.equal(combatUniqueName(blocks, 'Goblin', 'dndbeyond.com'), 'Goblin');
    assert.equal(combatUniqueName(blocks, 'Goblin', 'dnd.su'), 'Goblin (1)');
    blocks.b2 = Object.assign(combatBlankBlock('b2', 'Goblin (1)'), { source: 'dnd.su' });
    assert.equal(combatUniqueName(blocks, 'Goblin', 'dnd.su'), 'Goblin (2)');
  });
  it('adds an entry under a fresh id and a name that does not clash', () => {
    const blocks = { b1: goblin };
    const e = combatAddEntry(blocks, goblin);
    assert.equal(e.id, 'b2');
    assert.equal(e.name, 'Goblin (1)');
    assert.equal(blocks.b1.name, 'Goblin');
  });
  it('copies an entry so that no edit on either side reaches the other', () => {
    const c = combatSnapshot(goblin);
    c.secs.Actions = [{ n: 'Scimitar.', t: '' }];
    c.abil[0] = '18';
    assert.deepEqual(goblin.secs, {});
    assert.equal(goblin.abil[0], '10');
    assert.equal(c.id, undefined);
  });
  it('searches names that start with the query first', () => {
    const blocks = { b1: goblin, b2: Object.assign(combatBlankBlock('b2', 'Hobgoblin'), { ac: '18' }),
      b3: combatBlankBlock('b3', 'Ogre') };
    assert.deepEqual(combatSearchBlocks(blocks, 'gob').map(b => b.name), ['Goblin', 'Hobgoblin']);
  });
});

describe('a row picked from the bestiary', () => {
  const skeleton = Object.assign(combatBlankBlock('b4', 'Skeleton'), { ac: '13 (armor scraps)', hp: '13 (2d8+4)' });
  it('takes the name, AC and a copy of the stat block, at full HP with no conditions', () => {
    const r = combatRowFromEntry(skeleton, []);
    assert.equal(r.name, 'Skeleton');
    assert.equal(r.ac, '13');
    assert.equal(r.hp, '');
    assert.deepEqual(r.conds, []);
    assert.equal(r.sbChanged, false);
    r.sb.ac = '17';
    assert.equal(skeleton.ac, '13 (armor scraps)');
  });
  it('numbers the second copy of a monster already in the fight', () => {
    assert.equal(combatRowFromEntry(skeleton, [{ name: 'Skeleton' }]).name, 'Skeleton 2');
    assert.equal(combatRowFromEntry(skeleton, [{ name: 'Skeleton' }, { name: 'Skeleton 2' }]).name, 'Skeleton 3');
    assert.equal(combatRowFromEntry(skeleton, [{ name: 'Ghoul' }]).name, 'Skeleton');
  });
  it('never hands out a number twice after a copy is removed', () => {
    assert.equal(combatNextName('Wolf', [{ name: 'Wolf' }, { name: 'Wolf 3' }]), 'Wolf 4');
    assert.equal(combatNextName('Wolf', [{ name: 'Wolf 2' }]), 'Wolf 3');
    assert.equal(combatNextName('Wolf', [{ name: 'Dire wolf' }, { name: 'Wolfhound 2' }]), 'Wolf');
  });
  it('duplicates a row at full HP, with no conditions, under the next number', () => {
    const row = { id: 3, name: 'Skeleton', init: '12', hp: '- 5', conds: ['Prone'], sb: combatSnapshot(skeleton), side: 'enemy' };
    const c = combatDuplicateRow(row, [row], 9);
    assert.equal(c.id, 9);
    assert.equal(c.name, 'Skeleton 2');
    assert.equal(c.hp, '');
    assert.deepEqual(c.conds, []);
    assert.equal(c.init, '12');
    c.sb.ac = '1';
    assert.equal(row.sb.ac, '13 (armor scraps)');
  });
});

describe('the numbers a row shares with its stat block', () => {
  it('reads the first number of a line', () => {
    assert.equal(combatFirstNum('15 (leather armor)'), '15');
    assert.equal(combatFirstNum('Hit Points 45 (6d8+18)'), '45');
    assert.equal(combatFirstNum(''), '');
  });
  it('writes a row number back and keeps the rest of the line', () => {
    assert.equal(combatSetFirstNum('15 (leather armor)', '17'), '17 (leather armor)');
    assert.equal(combatSetFirstNum('', '12'), '12');
    assert.equal(combatSetFirstNum('natural armor', '12'), '12');
    assert.equal(combatSetFirstNum('15 (leather armor)', ''), '(leather armor)');
  });
  it('counts damage and healing from the stat block max', () => {
    assert.equal(combatRowHpState('45', '').value, 45);
    assert.equal(combatRowHpState('45', '- 9 - 12').value, 24);
    assert.equal(combatRowHpState('45', '-30').bloodied, true);
    assert.equal(combatRowHpState('45', '+ 5').share, 1);
    assert.equal(combatRowHpState('45', '-45').down, true);
  });
  it('shows a line that does not start with a sign as unreadable, not as a bigger number', () => {
    assert.ok(Number.isNaN(combatRowHpState('45', '9').value));
  });
  it('reads a row with no max yet as the typed line alone', () => {
    assert.equal(combatRowHpState('', '30 - 5').value, 25);
    assert.equal(combatRowHpState('', '').value, null);
  });
});

describe('importing a book or a module', () => {
  it('names the source after the file, without its extension', () => {
    assert.equal(combatSourceName('Curse of Strahd.pdf'), 'Curse of Strahd');
    assert.equal(combatSourceName('Keep.v2.txt'), 'Keep.v2');
    assert.equal(combatSourceName('AG-MM-v1.1-dc.pdf'), 'AG-MM-v1.1-dc');
  });
  it('adds nothing a module import of the same file already added, and each name once', () => {
    const source = combatSourceName('Curse of Strahd.pdf');
    const found = [combatBlankBlock(null, 'Rahadin'), combatBlankBlock(null, 'Strahd'), combatBlankBlock(null, 'Strahd')];
    const blocks = {};
    for (const b of combatNewBlocks(found, blocks, source)) combatAddEntry(blocks, Object.assign(b, { source }));
    assert.deepEqual(Object.values(blocks).map(b => b.name), ['Rahadin', 'Strahd']);
    assert.deepEqual(combatNewBlocks(found, blocks, combatSourceName('Curse of Strahd.pdf')), []);
    assert.equal(combatNewBlocks(found, blocks, 'Other book').length, 2);
  });
});
