'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/world/worldFindPlan.js');

describe('wfRank', () => {
  it('ranks the whole name, its start, a word start and a middle in that order', () => {
    assert.equal(F.wfRank('Inn', 'inn'), 0);
    assert.equal(F.wfRank('Inner Keep', 'inn'), 1);
    assert.equal(F.wfRank('The Inn', 'inn'), 2);
    assert.equal(F.wfRank('Skinner', 'inn'), 3);
    assert.equal(F.wfRank('Market', 'inn'), -1);
  });
  it('never matches an empty query or name', () => {
    assert.equal(F.wfRank('Inn', ''), -1);
    assert.equal(F.wfRank('', 'a'), -1);
  });
});

describe('wfHit', () => {
  it('says where the query sits, ignoring case', () => {
    assert.deepEqual(F.wfHit('The Inn', 'inn'), { at: 4, len: 3 });
    assert.equal(F.wfHit('Market', 'inn'), null);
  });
});

describe('wfSearch', () => {
  const places = [{ name: 'Nanlet', count: 3 }, { name: 'Inner Marsh', count: 1 }];
  const scenes = [{ id: 'a', name: 'The Inn', place: 'Nanlet' }, { id: 'b', name: 'Inn', place: '' }, { id: 'c', name: 'Cellar', place: 'Nanlet' }];
  const roads = [{ uid: 'r', name: 'Inn road' }];
  it('finds across the three kinds, best match first', () => {
    const f = F.wfSearch(' INN ', places, scenes, roads);
    assert.deepEqual(f.scenes.map(s => s.id), ['b', 'a']);
    assert.deepEqual(f.places.map(p => p.name), ['Inner Marsh']);
    assert.deepEqual(f.roads.map(r => r.uid), ['r']);
    assert.equal(f.total, 4);
  });
  it('keeps equal ranks in the order given', () => {
    const f = F.wfSearch('a', [], [{ id: '1', name: 'Alpha' }, { id: '2', name: 'Atlas' }], []);
    assert.deepEqual(f.scenes.map(s => s.id), ['1', '2']);
  });
  it('shows six rows a group but counts every match', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: String(i), name: 'Room ' + i }));
    const f = F.wfSearch('room', [], many, []);
    assert.equal(f.scenes.length, 6);
    assert.equal(f.total, 9);
  });
  it('answers nothing for an empty query', () => {
    assert.deepEqual(F.wfSearch('  ', places, scenes, roads), { places: [], scenes: [], roads: [], total: 0 });
  });
  it('walks places, then scenes, then roads', () => {
    const flat = F.wfFlat(F.wfSearch('inn', places, scenes, roads));
    assert.deepEqual(flat.map(x => x.kind), ['place', 'scene', 'scene', 'road']);
  });
});
