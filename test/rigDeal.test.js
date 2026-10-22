'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { dealShards, shardTotals, timingsFromMaps } = require('../tools/rig/deal.js');

const ROOT = path.join(__dirname, '..');
const real = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'rig', 'timings.json'), 'utf8')).platforms;
const onDisk = fs.readdirSync(path.join(ROOT, 'tools', 'rig', 'scenarios', 'acceptance'))
  .filter(n => n.endsWith('.js')).map(n => n.slice(0, -3));

test('every scenario is dealt exactly once', () => {
  const deal = dealShards({ scenarios: onDisk, shards: 4, timings: real.Linux });
  assert.deepStrictEqual([].concat(...deal).sort(), onDisk.slice().sort());
});

test('skipped scenarios are dealt to no shard and the rest still all are', () => {
  const deal = dealShards({ scenarios: onDisk, shards: 4, timings: real.Linux, skip: ['playback'] });
  const flat = [].concat(...deal);
  assert.ok(!flat.includes('playback'));
  assert.strictEqual(flat.length, onDisk.length - 1);
});

test('the split does not depend on the order the scenarios arrive in', () => {
  const a = dealShards({ scenarios: onDisk, shards: 6, timings: real.Windows });
  const b = dealShards({ scenarios: onDisk.slice().reverse(), shards: 6, timings: real.Windows });
  assert.deepStrictEqual(a, b);
});

test('equal times tie by name', () => {
  const deal = dealShards({ scenarios: ['d', 'b', 'a', 'c'], shards: 2, timings: { a: 5, b: 5, c: 5, d: 5 } });
  assert.deepStrictEqual(deal, [['a', 'c'], ['b', 'd']]);
});

test('a scenario with no recorded time costs the median of the recorded ones', () => {
  const timings = { a: 10, b: 20, c: 30 };
  const deal = dealShards({ scenarios: ['a', 'b', 'c', 'new'], shards: 2, timings });
  // new costs 20, the median: c + a and b + new both total 40.
  assert.deepStrictEqual(shardTotals(deal, timings), [40, 40]);
  assert.ok([].concat(...deal).includes('new'));
});

test('no timings at all deals evenly by count', () => {
  const deal = dealShards({ scenarios: ['a', 'b', 'c', 'd', 'e'], shards: 2 });
  assert.deepStrictEqual(deal.map(d => d.length).sort(), [2, 3]);
});

test('on the recorded timings no shard runs far past the mean', () => {
  for (const [platform, shards, skip] of [['Linux', 4, ['playback']], ['Windows', 6, []], ['macOS', 4, []]]) {
    const deal = dealShards({ scenarios: onDisk, shards, timings: real[platform], skip });
    const totals = shardTotals(deal, real[platform]);
    const mean = totals.reduce((s, x) => s + x, 0) / shards;
    assert.ok(Math.max(...totals) <= mean * 1.2, platform + ': max ' + Math.max(...totals) + ' vs mean ' + mean);
  }
});

test('timingsFromMaps takes the median per platform across maps', () => {
  const map = ms => ({ scenarios: { x: { ms: { Linux: ms, Windows: 5 } } } });
  const t = timingsFromMaps([map(10), map(30), map(20)]);
  assert.deepStrictEqual(t, { Linux: { x: 20 }, Windows: { x: 5 } });
});
