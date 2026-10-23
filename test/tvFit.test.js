'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { cleanFit, fitTile, fitForTile } = require('../src/player/tvFit.js');

describe('fitForTile', () => {
  it('saves the three turns in the form 4.7.0 reads', () => {
    assert.deepEqual(fitForTile(0), { step: 0, turn: 0 });
    assert.deepEqual(fitForTile(1), { step: 1, turn: 270 });
    assert.deepEqual(fitForTile(2), { step: 1, turn: 90 });
  });
  it('answers upright for a tile that does not exist', () => {
    assert.deepEqual(fitForTile(7), { step: 0, turn: 0 });
  });
  it('hands back a copy, so a caller cannot change a tile', () => {
    fitForTile(1).turn = 0;
    assert.equal(fitForTile(1).turn, 270);
  });
  it('gives a form that loads unchanged through cleanFit', () => {
    for (const i of [0, 1, 2]) assert.deepEqual(cleanFit(fitForTile(i)), fitForTile(i));
  });
});

describe('fitTile', () => {
  it('reads each saved form as its tile', () => {
    assert.equal(fitTile({ step: 0, turn: 0 }), 0);
    assert.equal(fitTile(undefined), 0);
    assert.equal(fitTile({ step: 1, turn: 270 }), 1);
    assert.equal(fitTile({ step: 1, turn: 90 }), 2);
  });
  it('reads an old Flipped save as the tile with that turn', () => {
    assert.equal(fitTile({ step: 2, turn: 270 }), 1);
    assert.equal(fitTile({ step: 2, turn: 90 }), 2);
  });
  it('marks no tile for a turn none offers', () => {
    assert.equal(fitTile({ step: 1, turn: 180 }), -1);
  });
});

describe('cleanFit', () => {
  it('keeps a good fit and turns anything else upright', () => {
    assert.deepEqual(cleanFit({ step: 2, turn: 270, extra: 1 }), { step: 2, turn: 270 });
    for (const bad of [null, {}, { step: 1 }, { step: 3, turn: 90 }, { step: 1, turn: 45 }, { step: 1, turn: 0 }, 'x']) {
      assert.deepEqual(cleanFit(bad), { step: 0, turn: 0 });
    }
  });
});
