'use strict';

// deal.js - which regression scenarios one gate shard runs, dealt by measured duration.
//
// Pure: tools/rig-deal.js reads the timings file and the scenario folder and prints the answer.
// Unit-tested in test/rigDeal.test.js.
//
// Greedy longest-first: scenarios sorted by recorded time, each handed to the shard with the least
// time so far. Every shard computes the same split, so ties break by name, never by input order.
// A scenario with no recorded time costs the median of the recorded ones, so a new file joins
// with no edit here.

function median(values) {
  if (!values.length) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// scenarios: every name; timings: { name: ms } for one platform; skip: names this platform leaves out.
// answers an array of `shards` name lists, each in the order the shard should run them (longest first).
function dealShards({ scenarios, shards, timings = {}, skip = [] }) {
  const left = Array.from(new Set(scenarios)).filter(n => !skip.includes(n));
  const known = left.map(n => timings[n]).filter(ms => Number.isFinite(ms) && ms > 0);
  const fallback = median(known) || 1;
  const cost = n => (Number.isFinite(timings[n]) && timings[n] > 0 ? timings[n] : fallback);
  left.sort((a, b) => cost(b) - cost(a) || (a < b ? -1 : a > b ? 1 : 0));
  const out = Array.from({ length: shards }, () => []);
  const load = new Array(shards).fill(0);
  for (const n of left) {
    let at = 0;
    for (let i = 1; i < shards; i++) if (load[i] < load[at]) at = i;
    out[at].push(n);
    load[at] += cost(n);
  }
  return out;
}

// The shard's total under the same costs, for the tests and for the CLI's --totals.
function shardTotals(deal, timings = {}) {
  const all = [].concat(...deal).map(n => timings[n]).filter(ms => Number.isFinite(ms) && ms > 0);
  const fallback = median(all) || 1;
  return deal.map(names => names.reduce((s, n) => s + (timings[n] > 0 ? timings[n] : fallback), 0));
}

// maps: parsed rig-coverage-map.json files (their scenarios hold ms per platform).
// answers { platform: { scenario: ms } }, the median across the maps so one slow runner does not set it.
function timingsFromMaps(maps) {
  const samples = {};
  for (const m of maps) {
    for (const [name, e] of Object.entries(m.scenarios || {})) {
      for (const [platform, ms] of Object.entries(e.ms || {})) {
        if (!(ms > 0)) continue;
        const p = samples[platform] = samples[platform] || {};
        (p[name] = p[name] || []).push(ms);
      }
    }
  }
  const out = {};
  for (const [platform, byName] of Object.entries(samples)) {
    out[platform] = {};
    for (const name of Object.keys(byName).sort()) out[platform][name] = Math.round(median(byName[name]));
  }
  return out;
}

module.exports = { dealShards, shardTotals, timingsFromMaps, median };
