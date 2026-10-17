'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { cleanFit, crossesTv, fitTurn, nextFit, fitDisabled } = require('../src/player/tvFit.js');

describe('fitTurn', () => {
  it('turns a side chair back upright and guesses clockwise from a long side', () => {
    assert.equal(fitTurn(0), 90);
    assert.equal(fitTurn(180), 90);
    assert.equal(fitTurn(90), 270);
    assert.equal(fitTurn(270), 90);
  });
});

describe('nextFit', () => {
  it('steps Off, Fitted, Flipped, Off for every seat', () => {
    for (const seat of [0, 90, 180, 270]) {
      const a = nextFit({ step: 0, turn: 0 }, seat);
      assert.deepEqual(a, { step: 1, turn: fitTurn(seat) });
      const b = nextFit(a, seat);
      assert.deepEqual(b, { step: 2, turn: (fitTurn(seat) + 180) % 360 });
      assert.deepEqual(nextFit(b, seat), { step: 0, turn: 0 });
    }
  });
  it('treats an absent fit as Off', () => {
    assert.deepEqual(nextFit(undefined, 0), { step: 1, turn: 90 });
  });
  it('keeps Flipped on the turn Fitted chose when the seat changed in between', () => {
    const a = nextFit(undefined, 90);
    assert.deepEqual(nextFit(a, 180), { step: 2, turn: 90 });
  });
});

describe('crossesTv', () => {
  it('is true for a tall map on a wide TV and a wide map on a tall TV', () => {
    assert.equal(crossesTv(1000, 2000, 1920, 1080, 0), true);
    assert.equal(crossesTv(2000, 1000, 1080, 1920, 0), true);
  });
  it('is false for a map that already lies along the TV, or a near-square one', () => {
    assert.equal(crossesTv(2000, 1000, 1920, 1080, 0), false);
    assert.equal(crossesTv(1000, 1030, 1920, 1080, 0), false);
  });
  it('reads the TV as turned when the picture already is', () => {
    assert.equal(crossesTv(1000, 2000, 1920, 1080, 90), false);
  });
  it('is false for an unknown size', () => {
    assert.equal(crossesTv(0, 0, 1920, 1080, 0), false);
  });
});

describe('fitDisabled', () => {
  it('disables the row only while Off and nothing crosses', () => {
    assert.equal(fitDisabled({ step: 0, turn: 0 }, false), true);
    assert.equal(fitDisabled(undefined, false), true);
    assert.equal(fitDisabled({ step: 0, turn: 0 }, true), false);
    assert.equal(fitDisabled({ step: 1, turn: 90 }, false), false);
    assert.equal(fitDisabled({ step: 2, turn: 270 }, false), false);
  });
});

describe('cleanFit', () => {
  it('keeps a good fit and turns anything else Off', () => {
    assert.deepEqual(cleanFit({ step: 2, turn: 270, extra: 1 }), { step: 2, turn: 270 });
    for (const bad of [null, {}, { step: 1 }, { step: 3, turn: 90 }, { step: 1, turn: 45 }, { step: 1, turn: 0 }, 'x']) {
      assert.deepEqual(cleanFit(bad), { step: 0, turn: 0 });
    }
  });
});
