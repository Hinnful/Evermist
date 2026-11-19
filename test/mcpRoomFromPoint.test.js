'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const clip = require('polygon-clipping');
const { mcpRoomFromPoint, MCP_CLOSE_SNAP } = require('../src/mcp/mcpRoomsPlan.js');

// A doorless crypt plan, 27 x 26 squares at 150 px: two crypts and the corridors around them, 90 walls and no portal,
// which the face walk reads as one room plus rock. The DM's own rooms, in percent, are the reference.
const PLAN = fs.readFileSync(path.join(__dirname, 'fixtures/void-crypts.dd2vtt'), 'utf8');
const W = 4050, H = 3900;
const box = (a, b, c, d) => [[a, b], [c, b], [c, d], [a, d]];
const UPPER = box(12.8, 13.4, 44.1, 45.9), LOWER = box(12.8, 50, 32.4, 86.6);
const CORRIDORS = [[32.4, 49.9], [44.1, 50], [44.1, 66.4], [59.8, 66.4], [59.8, 58.2], [48, 58.2], [48, 37.7], [51.9, 37.7], [51.9, 45.9], [55.9, 45.9],
  [55.9, 41.9], [59.8, 41.9], [59.8, 46], [75.5, 46], [75.5, 33.6], [67.7, 33.6], [67.7, 37.8], [63.8, 37.8], [63.8, 33.7], [51.9, 33.7], [51.9, 25.6], [55.9, 25.6],
  [55.9, 29.7], [63.8, 29.7], [63.8, 21.6], [44.1, 21.6], [44.1, 17.4], [63.7, 17.4], [63.7, 13.4], [67.6, 13.4], [67.6, 17.4], [71.6, 17.4], [71.6, 21.5], [67.6, 21.5],
  [67.6, 29.6], [75.5, 29.6], [75.5, 13.4], [79.4, 13.4], [79.4, 21.5], [87.2, 21.5], [87.2, 50], [52, 50], [52, 54.1], [87.2, 54.1], [87.2, 58.1], [83.3, 58.1],
  [83.3, 62.2], [79.4, 62.2], [79.4, 58.1], [75.5, 58.1], [75.5, 62.2], [71.6, 62.2], [71.6, 58.1], [63.7, 58.1], [63.7, 70.3], [40.2, 70.3], [40.2, 54.1], [32.4, 54.1]];
const ROCK = [[79.3, 25.5], [79.3, 46.1], [83.4, 46.1], [83.4, 25.5]];
const CLOSE_UPPER = [[[44.1, 17.4], [44.1, 21.5]], [[24.5, 45.9], [32.4, 45.9]]];
const CLOSE_LOWER = [[[32.4, 50], [32.4, 54.1]]];

const ring = pts => { const r = pts.map(p => [p.x, p.y]); r.push(r[0]); return r; };
const pctRing = pts => ring(pts.map(([x, y]) => ({ x: x / 100 * W, y: y / 100 * H })));
const geom = r => [[ring(r.verts), ...r.holes.map(ring)]];
const area = g => g.reduce((s, poly) => s + poly.reduce((t, r, k) => {
  let a = 0;
  for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return t + (k ? -1 : 1) * Math.abs(a / 2);
}, 0), 0);
const iou = (a, b) => area(clip.intersection(a, b)) / area(clip.union(a, b));

describe('mcpRoomFromPoint', () => {
  it('reads both crypts and the corridors around them as the DM drew them, from three points and three closers', () => {
    const up = mcpRoomFromPoint(PLAN, [28, 30], CLOSE_UPPER, W, H);
    const low = mcpRoomFromPoint(up.plan, [22, 70], CLOSE_LOWER, W, H);
    const cor = mcpRoomFromPoint(low.plan, [50, 19.5], undefined, W, H);
    assert.ok(iou(geom(up), [[pctRing(UPPER)]]) >= 0.95, 'upper crypt');
    assert.ok(iou(geom(low), [[pctRing(LOWER)]]) >= 0.95, 'lower crypt');
    assert.equal(cor.holes.length, 1, 'the rock between the corridors is the corridors\' one hole');
    assert.ok(iou(geom(cor), [[pctRing(CORRIDORS), pctRing(ROCK)]]) >= 0.95, 'corridors');
  });
  it('keeps the closers on the plan, so a later call needs only its point', () => {
    const up = mcpRoomFromPoint(PLAN, [28, 30], CLOSE_UPPER, W, H);
    assert.equal(up.closed, 2);
    const p = JSON.parse(up.plan);
    assert.equal(p.portals.filter(x => x.evermistCloser).length, 2);
    assert.deepEqual(mcpRoomFromPoint(up.plan, [28, 30], undefined, W, H).verts, up.verts);
    assert.equal(mcpRoomFromPoint(up.plan, [28, 30], undefined, W, H).plan, null);
  });
  it('without closers reads the one merged area the plan has today', () => {
    const merged = mcpRoomFromPoint(PLAN, [28, 30], undefined, W, H);
    assert.ok(iou(geom(merged), [[pctRing(UPPER)]]) < 0.6);
  });
  it('snaps a closer end within ' + MCP_CLOSE_SNAP + ' of a square onto the wall, and refuses one further out', () => {
    const near = mcpRoomFromPoint(PLAN, [28, 30], [[[44.1 + 0.5 / 27 * 100 * 0.9, 17.4], [44.1, 21.5]], CLOSE_UPPER[1]], W, H);
    assert.ok(!near.error, near.error);
    const far = mcpRoomFromPoint(PLAN, [28, 30], [[[40, 30], [44.1, 21.5]]], W, H);
    assert.match(far.error, /end 1 of close line 1 is .* grid squares from the nearest wall/);
  });
  it('refuses a map with no plan, a point outside the map, and a point on no floor', () => {
    assert.match(mcpRoomFromPoint(null, [10, 10], undefined, W, H).error, /no floor plan/);
    assert.match(mcpRoomFromPoint(PLAN, [120, 10], undefined, W, H).error, /at must be/);
    assert.match(mcpRoomFromPoint(PLAN, [1, 1], undefined, W, H).error, /no closed floor area/);
  });
});
