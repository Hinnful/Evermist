'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mcpOutlineArg, mcpSpotArg, mcpBackdropArgs, mcpFindRoad, mcpWouldDeleteRoad } = require('../src/mcp/mcpWorldPlan.js');

describe('mcpOutlineArg', () => {
  it('takes a triangle and rounds it', () => {
    assert.deepEqual(mcpOutlineArg([{ x: 0, y: 0 }, { x: 200.4, y: 0 }, { x: 100, y: 150.6 }]).points, [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 100, y: 151 }]);
  });
  it('refuses fewer than 3 points, missing numbers and a non-list', () => {
    assert.match(mcpOutlineArg([{ x: 0, y: 0 }, { x: 5, y: 5 }]).error, /at least 3/);
    assert.match(mcpOutlineArg([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 'a', y: 150 }]).error, /number x/);
    assert.match(mcpOutlineArg([{ x: 0, y: 0 }, { x: 200, y: 0 }, { y: 150 }]).error, /number x/);
    assert.match(mcpOutlineArg(undefined).error, /at least 3/);
  });
  it('refuses an outline too small to hold a card', () => {
    assert.match(mcpOutlineArg([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 150 }]).error, /at least 150 wide/);
    assert.match(mcpOutlineArg([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 100, y: 50 }]).error, /110 high/);
  });
  it('refuses points on one line and a bow tie', () => {
    assert.match(mcpOutlineArg([{ x: 0, y: 0 }, { x: 100, y: 55 }, { x: 200, y: 110 }]).error, /one line/);
    assert.match(mcpOutlineArg([{ x: 0, y: 0 }, { x: 200, y: 150 }, { x: 200, y: 0 }, { x: 0, y: 100 }]).error, /crosses itself/);
  });
});

describe('mcpSpotArg', () => {
  it('gives no spot when neither is given', () => assert.deepEqual(mcpSpotArg({}), { at: null }));
  it('rounds both', () => assert.deepEqual(mcpSpotArg({ x: 10.4, y: '20.6' }), { at: { x: 10, y: 21 } }));
  it('needs both numbers', () => {
    assert.ok(mcpSpotArg({ x: 10 }).error);
    assert.ok(mcpSpotArg({ y: 10 }).error);
    assert.ok(mcpSpotArg({ x: 'a', y: 1 }).error);
  });
});

describe('mcpBackdropArgs', () => {
  it('turns percent into a fraction and keeps only what is given', () => {
    assert.deepEqual(mcpBackdropArgs({ scale: 150, opacity: 0.5, x: 10.2 }), { scale: 1.5, alpha: 0.5, x: 10 });
    assert.deepEqual(mcpBackdropArgs({}), {});
  });
  it('holds scale and opacity to the controls\' ranges', () => {
    assert.ok(mcpBackdropArgs({ scale: 4 }).error);
    assert.ok(mcpBackdropArgs({ scale: 401 }).error);
    assert.ok(mcpBackdropArgs({ opacity: 0 }).error);
    assert.ok(mcpBackdropArgs({ opacity: 1.2 }).error);
    assert.ok(mcpBackdropArgs({ x: 'far' }).error);
  });
});

describe('mcpFindRoad', () => {
  const roads = [{ name: 'King\'s Road', from: 'A', to: 'B' }, { name: 'Trail', from: 'A', to: 'B' }, { name: 'Trail', from: 'B', to: 'C' }];
  it('finds a road by name, any case', () => assert.deepEqual(mcpFindRoad(roads, 'king\'s road'), { index: 0 }));
  it('asks for from and to when two roads share a name', () => {
    assert.match(mcpFindRoad(roads, 'Trail').error, /Give from and to/);
    assert.deepEqual(mcpFindRoad(roads, 'Trail', 'B', 'C'), { index: 2 });
  });
  it('says when none matches', () => {
    assert.match(mcpFindRoad(roads, 'Nope').error, /No road/);
    assert.match(mcpFindRoad(roads, 'Trail', 'C', 'A').error, /joins those two/);
  });
});

describe('mcpWouldDeleteRoad', () => {
  it('names what goes', () => assert.match(mcpWouldDeleteRoad({ name: 'R', notes: 5, maps: 2 }), /5 characters.*2 maps/));
});
