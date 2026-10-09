'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/world/worldPickPlan.js');

const scenes = [
  { id: 'a', group: 'Nanlet' }, { id: 'b', group: 'Nanlet' }, { id: 'c', group: 'Marsh' }, { id: 'd', group: '' },
];
const shapes = { Nanlet: { v: 1 }, Marsh: { v: 2 }, Empty: { v: 3 } };
const roads = { r1: { scenes: [{ id: 'c' }] }, r2: { scenes: [] }, r3: { scenes: [{ id: 'd' }, { id: 'a' }] } };

describe('wpToggle', () => {
  it('adds a scene at the end and takes it out again', () => {
    assert.deepEqual(P.wpToggle(['a'], 'b'), ['a', 'b']);
    assert.deepEqual(P.wpToggle(['a', 'b'], 'a'), ['b']);
    assert.deepEqual(P.wpToggle([], 'a'), ['a']);
  });
});

describe('wpMarqueeHits', () => {
  const items = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 200, y: 0 }, { id: 'c', x: 100, y: 100 }];
  it('takes a diamond only when its centre is in the box', () => {
    assert.deepEqual(P.wpMarqueeHits([], { x: -10, y: -10, w: 60, h: 20 }, items, true, 110, 77), ['a']);
    assert.deepEqual(P.wpMarqueeHits([], { x: 60, y: -10, w: 20, h: 20 }, items, true, 110, 77), []);
  });
  it('takes a card as soon as the box touches it', () => {
    assert.deepEqual(P.wpMarqueeHits([], { x: 50, y: -10, w: 20, h: 20 }, items, false, 110, 77), ['a']);
  });
  it('keeps what was held and adds each hit once', () => {
    assert.deepEqual(P.wpMarqueeHits(['c', 'a'], { x: -10, y: -10, w: 60, h: 20 }, items, true, 110, 77), ['c', 'a']);
    assert.deepEqual(P.wpMarqueeHits(['c'], { x: -10, y: -10, w: 300, h: 20 }, items, true, 110, 77), ['c', 'a', 'b']);
  });
});

describe('wpSubset', () => {
  it('keeps the places that hold a picked scene, and their notes', () => {
    const s = P.wpSubset(['a'], scenes, shapes, roads, { Nanlet: 'n', Marsh: 'm' }, {});
    assert.deepEqual(Object.keys(s.shapes), ['Nanlet']);
    assert.deepEqual(Object.keys(s.placeNotes), ['Nanlet']);
  });
  it('keeps a road only when it holds a picked scene, with its note', () => {
    const s = P.wpSubset(['a'], scenes, shapes, roads, {}, { r1: 'x', r3: 'y' });
    assert.deepEqual(Object.keys(s.roads), ['r3']);
    assert.deepEqual(Object.keys(s.roadNotes), ['r3']);
  });
  it('carries no place for a scene that has none', () => {
    const s = P.wpSubset(['d'], scenes, shapes, roads, {}, {});
    assert.deepEqual(Object.keys(s.shapes), []);
    assert.deepEqual(Object.keys(s.roads), ['r3']);
  });
  it('is safe with a place named __proto__', () => {
    const s = P.wpSubset(['x'], [{ id: 'x', group: '__proto__' }], JSON.parse('{"__proto__":{"v":1}}'), {}, {}, {});
    assert.deepEqual(Object.keys(s.shapes), ['__proto__']);
    assert.equal(Object.getPrototypeOf(s.shapes), null);
  });
});

describe('wpCounts', () => {
  it('counts everything with nothing picked', () => {
    assert.deepEqual(P.wpCounts([], scenes, shapes, roads), { scenes: 4, places: 3, roads: 3 });
  });
  it('counts what a pick carries', () => {
    assert.deepEqual(P.wpCounts(['a', 'b'], scenes, shapes, roads), { scenes: 2, places: 1, roads: 1 });
  });
});
