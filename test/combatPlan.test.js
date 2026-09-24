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
  it('is bloodied at exactly half', () => {
    assert.equal(combatHpState('40 - 20').bloodied, true);
    assert.equal(combatHpState('40 - 19').bloodied, false);
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
