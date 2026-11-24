'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { bsCrTable } = require('../src/combat/bestiaryPlan.js');

const XP = { 0: 10, '1/8': 25, '1/4': 50, '1/2': 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900,
  8: 3900, 9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000, 17: 18000, 18: 20000,
  19: 22000, 20: 25000, 21: 33000, 22: 41000, 23: 50000, 24: 62000, 25: 75000, 26: 90000, 27: 105000, 28: 120000,
  29: 135000, 30: 155000 };
const PB = [[['0', '1/8', '1/4', '1/2', '1', '2', '3', '4'], 2], [['5', '6', '7', '8'], 3], [['9', '10', '11', '12'], 4],
  [['13', '14', '15', '16'], 5], [['17', '18', '19', '20'], 6], [['21', '22', '23', '24'], 7], [['25', '26', '27', '28'], 8],
  [['29', '30'], 9]];

test('every challenge rating maps to its XP', () => {
  assert.equal(Object.keys(XP).length, 34);
  for (const [cr, xp] of Object.entries(XP)) assert.equal(bsCrTable(cr).xp, xp, cr);
});

test('every challenge rating maps to its proficiency bonus band', () => {
  let n = 0;
  for (const [crs, pb] of PB) for (const cr of crs) { assert.equal(bsCrTable(cr).pb, pb, cr); n++; }
  assert.equal(n, 34);
});

test('no rating or a rating the table lacks gives null', () => {
  for (const cr of ['—', '', 'abc', '31', '-1', '1/3', '0.5', '12x', undefined, null]) assert.equal(bsCrTable(cr), null, String(cr));
});
