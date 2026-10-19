'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { wheelState, classifyWheel, wheelZoomFactor, wheelSteps } = require('../src/ui/wheelPlan');

const ev = (o) => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, ...o });

describe('classifyWheel', () => {
  it('reads a ctrlKey wheel as a pinch', () => {
    assert.equal(classifyWheel(ev({ deltaY: 3, ctrlKey: true }), wheelState(), 0), 'pinch');
  });
  it('reads a whole 100px deltaY as a mouse', () => {
    assert.equal(classifyWheel(ev({ deltaY: -100 }), wheelState(), 0), 'mouse');
  });
  it('reads a line-mode wheel as a mouse', () => {
    assert.equal(classifyWheel(ev({ deltaY: 3, deltaMode: 1 }), wheelState(), 0), 'mouse');
  });
  it('reads a deltaX, a fraction or a small deltaY as a touchpad', () => {
    assert.equal(classifyWheel(ev({ deltaX: 2, deltaY: 120 }), wheelState(), 0), 'touchpad');
    assert.equal(classifyWheel(ev({ deltaY: 80.5 }), wheelState(), 0), 'touchpad');
    assert.equal(classifyWheel(ev({ deltaY: 7 }), wheelState(), 0), 'touchpad');
  });
  it('keeps a gesture touchpad until a 150ms gap', () => {
    const s = wheelState();
    assert.equal(classifyWheel(ev({ deltaY: 5 }), s, 0), 'touchpad');
    assert.equal(classifyWheel(ev({ deltaY: 100 }), s, 100), 'touchpad');
    assert.equal(classifyWheel(ev({ deltaY: 100 }), s, 200), 'touchpad');
    assert.equal(classifyWheel(ev({ deltaY: 100 }), s, 351), 'mouse');
  });
  it('a pinch does not start a touchpad gesture', () => {
    const s = wheelState();
    classifyWheel(ev({ deltaY: 2, ctrlKey: true }), s, 0);
    assert.equal(classifyWheel(ev({ deltaY: 100 }), s, 10), 'mouse');
  });
});

describe('wheelZoomFactor', () => {
  it('gives a mouse its fixed step each way', () => {
    assert.ok(Math.abs(wheelZoomFactor('mouse', -100, 1.1) - 1.1) < 1e-12);
    assert.ok(Math.abs(wheelZoomFactor('mouse', 100, 1.1) - 1 / 1.1) < 1e-12);
  });
  it('zooms a pinch in proportion to deltaY, in on a negative one', () => {
    assert.ok(wheelZoomFactor('pinch', -2, 1.1) > 1);
    assert.ok(wheelZoomFactor('pinch', 2, 1.1) < 1);
    assert.ok(wheelZoomFactor('pinch', -4, 1.1) > wheelZoomFactor('pinch', -2, 1.1));
  });
  it('caps one event, so a Ctrl+mouse wheel does not jump', () => {
    assert.ok(wheelZoomFactor('pinch', -100, 1.1) < 1.5);
  });
});

describe('wheelSteps', () => {
  it('gives a mouse one step an event and keeps no remainder', () => {
    assert.deepEqual(wheelSteps('mouse', -100, 17), { steps: 1, acc: 0 });
    assert.deepEqual(wheelSteps('mouse', 100, 0), { steps: -1, acc: 0 });
  });
  it('gives a touchpad one step per 60px, carrying the remainder', () => {
    let r = wheelSteps('touchpad', -25, 0);
    assert.equal(r.steps, 0);
    r = wheelSteps('touchpad', -25, r.acc);
    assert.equal(r.steps, 0);
    r = wheelSteps('touchpad', -25, r.acc);
    assert.equal(r.steps, 1);
    assert.equal(r.acc, -15);
  });
  it('steps down on a positive scroll', () => {
    assert.equal(wheelSteps('touchpad', 130, 0).steps, -2);
  });
});

it('a Ctrl+mouse wheel notch zooms no faster than a plain notch', () => {
  assert.ok(wheelZoomFactor('pinch', 100) >= 1 / 1.11);
  assert.ok(wheelZoomFactor('pinch', -100) <= 1.11);
});
