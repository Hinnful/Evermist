'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { COMBAT_MULTI, _cbMultiRead } = require('../src/combat/multiattack.js');

// Pills as combatAttacks builds them: a name, the action text, a to-hit or save DC.
const pill = (n, hit, t = 'Melee Weapon Attack: ' + hit + ' to hit.') => ({ n, t, hit });
const bite = pill('Bite', '+9'), claw = pill('Claw', '+7'), tail = pill('Tail', '+4');
const breath = pill('Fire Breath', 'DC 17', 'Each creature in a 30-foot cone must make a DC 17 Dexterity saving throw.');
const actionsOf = ps => [{ n: 'Multiattack' }, ...ps.map(p => ({ n: p.n }))];
const read = (text, ps) => _cbMultiRead(text, ps, actionsOf(ps));
const countsOf = r => new Map([...r.counts].map(([p, c]) => [p.n, c]));

describe('the Multiattack name', () => {
  it('matches the action in English and Russian, any case, and nothing that only starts with it', () => {
    for (const n of ['Multiattack', 'MULTIATTACK', 'Мультиатака', 'мультиатака', 'Multiattack (Humanoid Form Only)']) assert.ok(COMBAT_MULTI.test(n), n);
    for (const n of ['Multiattacks', 'Мультиатакой', 'Bite', 'The Multiattack']) assert.ok(!COMBAT_MULTI.test(n), n);
  });
});

describe('a Multiattack reading', () => {
  it('counts each named attack, uneven counts included, against the very pills it was given', () => {
    const ps = [bite, claw, tail];
    const r = read('The dragon makes three attacks: one with its bite and two with its claws.', ps);
    assert.deepEqual(countsOf(r), new Map([['Bite', 1], ['Claw', 2]]));
    for (const p of r.counts.keys()) assert.ok(ps.includes(p), 'a counted pill is a copy, not the input');
    assert.deepEqual(new Set(r.opts), new Set([bite, claw]));
    assert.ok(!r.opts.includes(tail));
  });

  it('gives the fallback when the named counts disagree with the stated total', () => {
    assert.equal(read('The dragon makes four attacks: one with its bite and two with its claws.', [bite, claw]), null);
  });

  it('puts a bare count on the one attack roll there is, never on a save', () => {
    const r = read('The drake makes two attacks.', [breath, claw]);
    assert.deepEqual(countsOf(r), new Map([['Claw', 2]]));
  });

  it('gives the fallback for a bare count over several attacks it cannot tell apart', () => {
    assert.equal(read('The dragon makes two attacks.', [bite, claw]), null);
  });

  it('narrows a bare count by melee or ranged', () => {
    const sword = pill('Longsword', '+6', 'Melee Weapon Attack: +6 to hit, reach 5 ft.');
    const bow = pill('Longbow', '+4', 'Ranged Weapon Attack: +4 to hit, range 150/600 ft.');
    assert.deepEqual(countsOf(read('The knight makes three ranged attacks.', [sword, bow])), new Map([['Longbow', 3]]));
    assert.deepEqual(countsOf(read('The knight makes two melee attacks.', [sword, bow])), new Map([['Longsword', 2]]));
  });

  it('never lets a whole-word name also match an attack sharing its stem', () => {
    const sword = pill('Longsword', '+6'), bow = pill('Longbow', '+4');
    assert.deepEqual(countsOf(read('The knight makes two longsword attacks.', [sword, bow])), new Map([['Longsword', 2]]));
  });

  it('matches a Russian case against the action name by its stem', () => {
    const k = pill('Коготь', '+7'), u = pill('Укус', '+9');
    const r = read('Дракон совершает три атаки: одну укусом и две когтями.', [u, k]);
    assert.deepEqual(countsOf(r), new Map([['Укус', 1], ['Коготь', 2]]));
  });

  it('reads a count over a pick of named attacks as a choice', () => {
    const burst = pill('Eldritch Burst', '+12'), touch = pill('Paralyzing Touch', '+12');
    const r = read('The lich makes three attacks, using Eldritch Burst or Paralyzing Touch in any combination.', [burst, touch, bite]);
    assert.equal(r.x, 3);
    assert.equal(r.or, true);
    assert.deepEqual(new Set(r.opts), new Set([burst, touch]));
  });

  it('reads two full alternatives as one map each', () => {
    const scim = pill('Scimitar', '+5', 'Melee Weapon Attack: +5 to hit.');
    const dag = pill('Dagger', '+5', 'Melee or Ranged Weapon Attack: +5 to hit.');
    const r = read('The captain makes three melee attacks: two with its scimitar and one with its dagger. Or the captain makes two ranged attacks with its daggers.', [scim, dag]);
    assert.equal(r.alts.length, 2);
    assert.deepEqual(new Map([...r.alts[0]].map(([p, c]) => [p.n, c])), new Map([['Scimitar', 2], ['Dagger', 1]]));
    assert.deepEqual(new Map([...r.alts[1]].map(([p, c]) => [p.n, c])), new Map([['Dagger', 2]]));
  });

  it('carries a swap to another action and keeps the base count', () => {
    const rend = pill('Rend', '+7');
    const r = _cbMultiRead('The dragon makes three Rend attacks. It can replace one attack with a use of Spellcasting.',
      [rend], [{ n: 'Multiattack' }, { n: 'Rend' }, { n: 'Spellcasting' }]);
    assert.deepEqual(countsOf(r), new Map([['Rend', 3]]));
    assert.equal(r.swap.k, '1');
    assert.deepEqual(r.swap.to, ['Spellcasting']);
  });

  it('keeps an "only one of which" attack out of the base count', () => {
    const strike = pill('Unarmed Strike', '+9'), vbite = pill('Bite', '+9');
    const r = read('The vampire makes two attacks, only one of which can be a bite attack.', [strike, vbite]);
    assert.ok(r.swap);
    assert.ok(!r.counts || !r.counts.has(vbite));
  });

  it('lifts a pill a bonus-action sentence names out of the attacks', () => {
    const r = read('The goblin makes two attacks with its claws. It can make a tail attack as a bonus action.', [claw, tail]);
    assert.deepEqual(countsOf(r), new Map([['Claw', 2]]));
    assert.deepEqual(r.bonus, [tail]);
  });

  it('reads rays used several times as a pick of that list', () => {
    const rays = ['Charm Ray', 'Paralyzing Ray', 'Fear Ray'].map((n, i) => ({ ...pill(n, 'DC ' + (16 + i)), of: 'Eye Rays' }));
    const r = _cbMultiRead('The beholder uses Eye Rays three times.', [bite, ...rays],
      [{ n: 'Multiattack' }, { n: 'Bite' }, { n: 'Eye Rays' }]);
    assert.equal(r.x, 3);
    assert.equal(r.or, true);
    assert.deepEqual(r.opts, rays);
  });

  it('gives the fallback for what a frame may not carry', () => {
    for (const t of [
      'The dragon makes two attacks with its claws if it is flying.',
      'The mage casts a spell and makes one bite attack.',
      'The dragon makes two attacks with its claws, dealing 7 (2d6) extra damage.',
      'The beast makes two attacks: one with its bite and one with its horns.',
    ]) assert.equal(read(t, [bite, claw]), null, t);
  });

  it('leaves the pills it reads untouched', () => {
    const ps = [bite, claw, tail].map(p => ({ ...p }));
    const before = JSON.parse(JSON.stringify(ps));
    read('The dragon makes three attacks: one with its bite and two with its claws.', ps);
    assert.deepEqual(ps, before);
  });
});
