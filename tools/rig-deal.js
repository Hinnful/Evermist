#!/usr/bin/env node
'use strict';

/*
 * Which regression scenarios this gate shard runs, dealt by how long each one took.
 *
 *   node tools/rig-deal.js --shard 2 --of 4 --platform Linux [--skip "playback"] [--totals]
 *       Prints this shard's scenario names on one line. gate.yml calls it. The scenarios are the
 *       files in tools/rig/scenarios/acceptance/; the times are tools/rig/timings.json. --platform
 *       defaults to $RUNNER_OS (Linux, Windows, macOS), the name the rig's reports carry.
 *       --totals prints every shard's expected time on stderr instead of staying quiet.
 *
 *   node tools/rig-deal.js refresh <rig-coverage-map.json> [more maps...]
 *       Rewrites tools/rig/timings.json from the maps the gate's report job uploads (artifact
 *       `rig-coverage-map`, kept 90 days). Several maps give the median per scenario:
 *         gh run download <run id> -n rig-coverage-map -D <dir>      once per recent green run
 *         node tools/rig-deal.js refresh <dir>/rig-coverage-map.json ...
 *       Refresh when the shards drift apart; stale or missing times only cost balance, never
 *       correctness, because an unknown scenario is dealt at the median.
 *
 * The logic is in tools/rig/deal.js; this file reads and writes.
 */

const fs = require('fs');
const path = require('path');
const { dealShards, shardTotals, timingsFromMaps } = require('./rig/deal.js');

const ACCEPTANCE = path.join(__dirname, 'rig', 'scenarios', 'acceptance');
const TIMINGS = path.join(__dirname, 'rig', 'timings.json');
const flag = (argv, name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };

function readTimings(platform) {
  try { return (JSON.parse(fs.readFileSync(TIMINGS, 'utf8')).platforms || {})[platform] || {}; }
  catch (_) { return {}; }   // no file yet: every scenario costs the same and the deal is even by count
}

function refresh(files) {
  if (!files.length) throw new Error('usage: rig-deal.js refresh <rig-coverage-map.json> [...]');
  const platforms = timingsFromMaps(files.map(f => JSON.parse(fs.readFileSync(f, 'utf8'))));
  fs.writeFileSync(TIMINGS, JSON.stringify({ version: 1, platforms }, null, 1) + '\n');
  console.log('timings.json: ' + Object.entries(platforms).map(([p, t]) => p + ' ' + Object.keys(t).length).join(', ') + ' scenarios');
}

function deal(argv) {
  const shard = Number(flag(argv, '--shard'));
  const of = Number(flag(argv, '--of'));
  if (!(shard >= 1 && shard <= of)) throw new Error('usage: rig-deal.js --shard N --of M [--platform P] [--skip "a b"]');
  const platform = flag(argv, '--platform') || process.env.RUNNER_OS || '';
  const skip = (flag(argv, '--skip') || '').split(/\s+/).filter(Boolean);
  const scenarios = fs.readdirSync(ACCEPTANCE).filter(n => n.endsWith('.js')).map(n => n.slice(0, -3));
  const timings = readTimings(platform);
  const dealt = dealShards({ scenarios, shards: of, timings, skip });
  if (argv.includes('--totals')) {
    shardTotals(dealt, timings).forEach((ms, i) => console.error('shard ' + (i + 1) + ': ' + dealt[i].length + ' scenarios, ~' + Math.round(ms / 1000) + 's'));
  }
  console.log(dealt[shard - 1].join(' '));
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  try { if (argv[0] === 'refresh') refresh(argv.slice(1)); else deal(argv); }
  catch (err) { console.error(err.message); process.exit(1); }
}
