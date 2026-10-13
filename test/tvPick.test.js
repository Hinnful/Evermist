'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { pickTv, screenName, tvRemember } = require('../src/player/tvPick.js');

const disp = (id, label, o = {}) => ({
  id, label, internal: false,
  bounds: { x: o.x || 0, y: 0, width: o.w || 1920, height: o.h || 1080 },
  size: { width: o.w || 1920, height: o.h || 1080 },
  ...(o.internal ? { internal: true } : {}),
});

describe('pickTv', () => {
  it('has no candidate when the DM window holds the only screen', () => {
    const r = pickTv([disp(1, 'Laptop', { internal: true })], 1, null);
    assert.equal(r.kind, 'none');
    assert.deepEqual(r.candidates, []);
  });

  it('uses the one other screen', () => {
    const r = pickTv([disp(1, 'Laptop', { internal: true }), disp(2, 'LG TV', { x: 1920 })], 1, null);
    assert.equal(r.kind, 'one');
    assert.equal(r.display.id, 2);
  });

  it('prefers an external screen over an internal one', () => {
    const r = pickTv([disp(1, 'Desk'), disp(2, 'Laptop', { internal: true }), disp(3, 'TV', { x: 1920 })], 1, null);
    assert.equal(r.kind, 'one');
    assert.equal(r.display.id, 3);
  });

  it('keeps an internal screen when it is the only other one', () => {
    const r = pickTv([disp(1, 'Desk'), disp(2, 'Laptop', { internal: true })], 1, null);
    assert.equal(r.kind, 'one');
    assert.equal(r.display.id, 2);
  });

  it('asks when several screens and none is remembered', () => {
    const r = pickTv([disp(1, 'Laptop'), disp(2, 'TV A', { x: 1920 }), disp(3, 'TV B', { x: 3840 })], 1, null);
    assert.equal(r.kind, 'ask');
    assert.equal(r.candidates.length, 2);
  });

  it('uses the remembered screen when label and size match', () => {
    const displays = [disp(1, 'Laptop'), disp(2, 'TV A', { x: 1920 }), disp(3, 'TV B', { x: 3840 })];
    const r = pickTv(displays, 1, tvRemember(displays[2]));
    assert.equal(r.kind, 'one');
    assert.equal(r.display.id, 3);
  });

  it('asks again when the remembered size no longer matches', () => {
    const displays = [disp(1, 'Laptop'), disp(2, 'TV A', { x: 1920 }), disp(3, 'TV B', { x: 3840 })];
    const stale = { ...tvRemember(displays[2]), width: 1280, height: 720 };
    assert.equal(pickTv(displays, 1, stale).kind, 'ask');
  });

  it('never matches an empty label', () => {
    const displays = [disp(1, 'Laptop'), disp(2, '', { x: 1920 }), disp(3, '', { x: 3840 })];
    const r = pickTv(displays, 1, tvRemember(displays[2]));
    assert.equal(r.kind, 'ask');
  });

  it('breaks a tie between duplicate labels by position', () => {
    const displays = [disp(1, 'Laptop'), disp(2, 'TV', { x: 1920 }), disp(3, 'TV', { x: 3840 })];
    const r = pickTv(displays, 1, tvRemember(displays[2]));
    assert.equal(r.kind, 'one');
    assert.equal(r.display.id, 3);
  });

  it('takes the first duplicate when none holds the remembered position', () => {
    const displays = [disp(1, 'Laptop'), disp(2, 'TV', { x: 1920 }), disp(3, 'TV', { x: 3840 })];
    const moved = { ...tvRemember(displays[2]), x: 9999 };
    assert.equal(pickTv(displays, 1, moved).display.id, 2);
  });

  it('drops the DM window even when it sits on the TV', () => {
    const r = pickTv([disp(1, 'TV'), disp(2, 'Laptop', { internal: true })], 1, null);
    assert.equal(r.display.id, 2);
  });

  it('survives a missing list', () => {
    assert.equal(pickTv(undefined, 1, null).kind, 'none');
  });
});

describe('screenName', () => {
  it('uses the label', () => assert.equal(screenName({ label: ' LG TV ' }, 1), 'LG TV'));
  it('numbers a screen with no label by its position', () => {
    assert.equal(screenName({ label: '' }, 0), 'Screen 1');
    assert.equal(screenName({}, 2), 'Screen 3');
  });
  it('names a display in a candidate list by its place in the full list', () => {
    const r = pickTv([disp(1, 'A'), disp(2, ''), disp(3, '')], 1, null);
    assert.deepEqual(r.candidates.map(c => c.name), ['Screen 2', 'Screen 3']);
  });
});
