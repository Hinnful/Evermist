'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { MCP_GRID_HEX, mcpGridPhase, mcpPctPoint, mcpGridArgs, mcpPxPerFt, mcpPctRing, mcpFxShape, mcpFxMaterial, mcpPickOne,
  mcpFxWouldDelete } = require('../src/mcp/mcpGridPlan.js');

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, a + ' is not ' + b);
const base = { enabled: false, cellSize: 70, offsetX: 0, offsetY: 0, color: '#ffffff', opacity: 0.25, mode: 'square', lineWidth: 1 };

// Whether some cell's top corner of the hex lattice drawGridLines draws lies at (x, y).
function hexCornerAt(cfg, x, y) {
  const px = cfg.cellSize * MCP_GRID_HEX.stepX, py = cfg.cellSize * MCP_GRID_HEX.stepY;
  for (let row = -20; row <= 20; row++) {
    const cy = cfg.offsetY + row * py;
    if (Math.abs(cy - cfg.cellSize - y) > 1e-6) continue;
    const t = (x - cfg.offsetX - (row & 1) * px / 2) / px;
    if (Math.abs(t - Math.round(t)) < 1e-6) return true;
  }
  return false;
}

describe('mcpGridPhase', () => {
  it('puts a square grid line through the crossing on both axes', () => {
    const p = mcpGridPhase('square', 70, 245, 1000);
    near(p.offsetX, 35);
    near(p.offsetY, 20);
  });
  it('keeps the phase inside one cell for a crossing at the edge', () => {
    const p = mcpGridPhase('square', 50, 0, 100);
    near(p.offsetX, 0);
    near(p.offsetY, 0);
  });
  it('puts a hex cell\'s top corner on the crossing, in an even row and an odd one', () => {
    for (const [x, y] of [[300, 400], [123.4, 567.8], [10, 5], [999, 1]]) {
      const p = mcpGridPhase('hex-pointy', 40, x, y);
      assert.ok(hexCornerAt({ cellSize: 40, ...p }, x, y), 'no corner at ' + x + ',' + y);
      assert.ok(p.offsetX >= 0 && p.offsetX < 40 * MCP_GRID_HEX.stepX && p.offsetY >= 0 && p.offsetY < 40 * MCP_GRID_HEX.stepY);
    }
  });
  it('fails the hex check when the stagger is dropped', () => {
    const p = mcpGridPhase('hex-pointy', 40, 300, 400);
    const naive = { cellSize: 40, offsetX: ((300 % (40 * MCP_GRID_HEX.stepX)) + 40 * MCP_GRID_HEX.stepX) % (40 * MCP_GRID_HEX.stepX), offsetY: p.offsetY };
    const row = Math.round((400 + 40 - p.offsetY) / (40 * MCP_GRID_HEX.stepY));
    assert.equal(hexCornerAt(naive, 300, 400), !(row & 1));
  });
});

describe('mcpGridArgs', () => {
  it('turns percent into the stored grid and says what changed', () => {
    const r = mcpGridArgs({ on: true, type: 'Hex', color: 'F00', opacity: 40, lineWidth: 3, cell: 2.5, crossing: { x: 50, y: 50 } }, base, 2000, 1000);
    assert.equal(r.error, undefined);
    assert.equal(r.cfg.enabled, true);
    assert.equal(r.cfg.mode, 'hex-pointy');
    assert.equal(r.cfg.color, '#ff0000');
    assert.equal(r.cfg.opacity, 0.4);
    assert.equal(r.cfg.lineWidth, 3);
    assert.equal(r.cfg.cellSize, 50);
    assert.ok(hexCornerAt(r.cfg, 1000, 500));
    assert.equal(r.said.length, 7);
  });
  it('fits a crossing with the cell the map already has', () => {
    const r = mcpGridArgs({ crossing: [10, 10] }, base, 1000, 1000);
    near(r.cfg.offsetX, 30);
    assert.equal(r.cfg.cellSize, 70);
    assert.equal(base.offsetX, 0);
  });
  it('refuses what the grid controls cannot hold', () => {
    assert.match(mcpGridArgs({}, base, 1000, 1000).error, /Nothing to change/);
    assert.match(mcpGridArgs({ on: 'yes' }, base, 1000, 1000).error, /on must/);
    assert.match(mcpGridArgs({ type: 'triangle' }, base, 1000, 1000).error, /square or hex/);
    assert.match(mcpGridArgs({ color: 'red' }, base, 1000, 1000).error, /hex colour/);
    assert.match(mcpGridArgs({ opacity: 120 }, base, 1000, 1000).error, /0 to 100/);
    assert.match(mcpGridArgs({ lineWidth: 2.5 }, base, 1000, 1000).error, /1 to 10/);
    assert.match(mcpGridArgs({ cell: 0.5 }, base, 1000, 1000).error, /1% to 40%/);
    assert.match(mcpGridArgs({ crossing: { x: 120, y: 5 } }, base, 1000, 1000).error, /crossing/);
  });
});

describe('effect and light shapes', () => {
  it('reads a point in percent, refusing one off the map', () => {
    assert.deepEqual(mcpPctPoint([50, 25], 2000, 1000), { x: 1000, y: 250 });
    assert.deepEqual(mcpPctPoint({ x: 0, y: 100 }, 2000, 1000), { x: 0, y: 1000 });
    assert.equal(mcpPctPoint([101, 5], 2000, 1000), null);
    assert.equal(mcpPctPoint({ x: 5 }, 2000, 1000), null);
  });
  it('takes an outline with area, and refuses a line or a short list', () => {
    assert.deepEqual(mcpPctRing([[0, 0], [10, 0], [10, 10]], 1000, 1000).vertices, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    assert.match(mcpPctRing([[0, 0], [10, 0]], 1000, 1000).error, /at least 3/);
    assert.match(mcpPctRing([[0, 0], [10, 0], [20, 0]], 1000, 1000).error, /no area/);
    assert.match(mcpPctRing([[0, 0], [10, 0], [10, 'a']], 1000, 1000).error, /Every outline point/);
  });
  it('takes exactly one shape', () => {
    assert.match(mcpFxShape({}, 1000, 1000, 14).error, /exactly one/);
    assert.match(mcpFxShape({ outline: [], circle: {} }, 1000, 1000, 14).error, /exactly one/);
  });
  it('makes a circle with its radius in percent of the width', () => {
    const v = mcpFxShape({ circle: { x: 50, y: 50, radius: 10 } }, 1000, 500, 14).vertices;
    for (const p of v) near(Math.hypot(p.x - 500, p.y - 250), 100);
    assert.match(mcpFxShape({ circle: { x: 50, y: 50, radius: 0 } }, 1000, 500, 14).error, /radius/);
  });
  it('makes a preset at a size the Effects row offers, measured on the grid', () => {
    const sq = mcpFxShape({ preset: { shape: 'Square', feet: 10, x: 50, y: 50 } }, 1000, 1000, 14).vertices;
    near(Math.max(...sq.map(p => p.x)) - Math.min(...sq.map(p => p.x)), 140);
    const ring = mcpFxShape({ preset: { shape: 'ring', feet: 20, x: 50, y: 50 } }, 1000, 1000, 14);
    assert.equal(ring.holes.length, 1);
    const line = mcpFxShape({ preset: { shape: 'line', feet: 20, x: 10, y: 10, angle: 90 } }, 1000, 1000, 14).vertices;
    near(Math.max(...line.map(p => p.y)) - 100, 280);
    assert.match(mcpFxShape({ preset: { shape: 'circle', feet: 12, x: 5, y: 5 } }, 1000, 1000, 14).error, /5 to 60 feet/);
    assert.match(mcpFxShape({ preset: { shape: 'star', feet: 10, x: 5, y: 5 } }, 1000, 1000, 14).error, /square, circle/);
    assert.match(mcpFxShape({ preset: { shape: 'cone', feet: 10 } }, 1000, 1000, 14).error, /x and y/);
  });
  it('measures a foot as the effect tool does: a square cell or a hex cell across', () => {
    near(mcpPxPerFt({ cellSize: 70, mode: 'square' }), 14);
    near(mcpPxPerFt({ cellSize: 40, mode: 'hex-pointy' }), 40 * Math.sqrt(3) / 5);
    near(mcpPxPerFt(null), 14);
  });
});

describe('materials and finding one', () => {
  it('names the materials and sends Light to create_light', () => {
    assert.deepEqual(mcpFxMaterial(' Acid '), { material: 'acid' });
    assert.match(mcpFxMaterial('light').error, /create_light/);
    assert.match(mcpFxMaterial('ice').error, /Fire, Acid/);
  });
  const fx = [{ material: 'fire' }, { material: 'acid' }, { material: 'fire' }, {}];
  it('finds by index from 1', () => {
    assert.deepEqual(mcpPickOne(fx, 2, 'effect'), { i: 1 });
    assert.deepEqual(mcpPickOne(fx, '4', 'effect'), { i: 3 });
    assert.match(mcpPickOne(fx, 0, 'effect').error, /1 to 4/);
    assert.match(mcpPickOne([], 1, 'light').error, /no lights/);
  });
  it('finds an effect by material only when one has it', () => {
    assert.deepEqual(mcpPickOne(fx, 'Acid', 'effect'), { i: 1 });
    assert.match(mcpPickOne(fx, 'fire', 'effect').error, /3 Fire effects, at indexes 1, 3, 4/);
    assert.match(mcpPickOne(fx, 'ice', 'effect').error, /No effect/);
    assert.match(mcpPickOne([{}], 'fire', 'light').error, /index/);
  });
  it('says what a delete would take', () => {
    assert.match(mcpFxWouldDelete('the light 2', 'Crypt'), /^Would delete the light 2 from the map "Crypt"\. Nothing was deleted.*confirmed: true/);
  });
});
