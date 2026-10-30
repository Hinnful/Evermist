#!/usr/bin/env node
'use strict';

/*
 * The rig's half of CI, in three commands.
 *
 *   node tools/rig-ci.js pick [--map file] [--cap-minutes 10] [--changed a,b] [--base ref] [--json]
 *       /commit's test plan: which scenarios the diff needs, from the coverage map of the latest
 *       green run. Exits 3 when a changed src file has no scenario that covers it.
 *       CI's decide job runs it with --base origin/main and fails only on that exit 3.
 *   node tools/rig-ci.js merge <reportsDir> <outDir> [--sha X] [--run N]
 *       CI, after every rig shard: merges the shards' reports into rig-coverage-map.json and
 *       rig-flakes.json.
 *   node tools/rig-ci.js flakes [--runs 15]
 *       /commit's monitor: scenarios that needed a rerun in 3 or more recent runs.
 *
 * The logic is in tools/rig/pick.js and tools/rig/reports.js; this file reads and writes.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pickScenarios, diffIdentifiers, DEFAULT_CAP_MS } = require('./rig/pick.js');
const { mergeCoverage, collectFlakes, repeatFlakes } = require('./rig/reports.js');

const ROOT = path.join(__dirname, '..');
const SCEN = path.join(ROOT, 'tools', 'rig', 'scenarios');
const WORKFLOW = 'release.yml';

const out = cmd => execFileSync(cmd[0], cmd.slice(1), { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const flag = (argv, name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };

function walk(dir, match, into = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, match, into);
    else if (match(e.name)) into.push(p);
  }
  return into;
}

// The first lines of each scenario are its criteria, which is where it names what it covers.
function readHeaders() {
  const headers = {};
  const add = file => { headers[path.basename(file, '.js')] = fs.readFileSync(file, 'utf8').split('\n').slice(0, 80).join('\n'); };
  add(path.join(SCEN, 'smoke.js'));
  for (const f of fs.readdirSync(path.join(SCEN, 'acceptance')).filter(n => n.endsWith('.js'))) add(path.join(SCEN, 'acceptance', f));
  return headers;
}

function readTexts() {
  const texts = {};
  const add = file => { texts[path.basename(file, '.js')] = fs.readFileSync(file, 'utf8'); };
  add(path.join(SCEN, 'smoke.js'));
  for (const f of fs.readdirSync(path.join(SCEN, 'acceptance')).filter(n => n.endsWith('.js'))) add(path.join(SCEN, 'acceptance', f));
  return texts;
}

// CI has a clean checkout of the commit, so it names the ref the branch was cut from.
function changedFiles(base) {
  const lines = s => s.split('\n').map(l => l.trim()).filter(Boolean);
  if (base) return lines(out(['git', 'diff', '--name-only', base + '...HEAD']));
  return Array.from(new Set(lines(out(['git', 'diff', 'HEAD', '--name-only']))
    .concat(lines(out(['git', 'ls-files', '--others', '--exclude-standard'])))));
}

// Newest green run that kept a map. Every download lands in a folder of its own and only the JSON
// inside is read.
function downloadMap(notes) {
  let runs;
  try {
    runs = JSON.parse(out(['gh', 'run', 'list', '--workflow', WORKFLOW, '--status', 'success', '--limit', '15',
                           '--json', 'databaseId,headSha']));
  } catch (err) { notes.push('could not list green runs (' + String(err.message).split('\n')[0] + ')'); return null; }
  for (const run of runs) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evermist-rig-map-'));
    try {
      out(['gh', 'run', 'download', String(run.databaseId), '-n', 'rig-coverage-map', '-D', dir]);
      const file = walk(dir, n => n === 'rig-coverage-map.json')[0];
      if (file) {
        const map = JSON.parse(fs.readFileSync(file, 'utf8'));
        notes.push('coverage map from the green run of ' + String(run.headSha).slice(0, 7) + ' (run ' + run.databaseId + ')');
        return map;
      }
    } catch (_) { /* this run kept no map; try the one before */ }
  }
  return null;
}

function pick(argv) {
  const notes = [];
  const mapFile = flag(argv, '--map');
  const map = mapFile ? JSON.parse(fs.readFileSync(mapFile, 'utf8')) : downloadMap(notes);
  const capArg = flag(argv, '--cap-minutes');
  const changedArg = flag(argv, '--changed');
  const base = flag(argv, '--base');
  const answer = pickScenarios({
    changed: changedArg ? changedArg.split(',') : changedFiles(base),
    map,
    headers: readHeaders(),
    texts: readTexts(),
    identifiers: diffIdentifiers(out(['git', 'diff', base ? base + '...HEAD' : 'HEAD', '-U0', '--', 'src', 'index.html']),
      fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')),
    capMs: capArg ? Number(capArg) * 60000 : DEFAULT_CAP_MS,
  });
  answer.notes = notes.concat(answer.notes);
  if (argv.includes('--json')) { console.log(JSON.stringify(answer, null, 2)); process.exit(answer.blocked.length ? 3 : 0); }

  for (const n of answer.notes) console.log('note: ' + n);
  for (const r of answer.run) console.log('RUN   ' + r.name.padEnd(28) + String(Math.round(r.ms / 1000)).padStart(4) + 's  ' + r.why);
  for (const r of answer.skipped) console.log('LEFT TO CI  ' + r.name.padEnd(22) + String(Math.round(r.ms / 1000)).padStart(4) + 's  ' + r.why);
  if (answer.blocked.length) {
    console.log('BLOCKED: no scenario covers ' + answer.blocked.join(', ') + '. Write one whose header names the file, then run again.');
    process.exit(3);
  }
  if (answer.run.length) {
    console.log('about ' + Math.round(answer.totalMs / 60000) + ' minute(s)');
    console.log('npm run rig -- --low-priority ' + answer.run.map(r => r.name).join(' '));
  }
}

function merge(argv) {
  const [inDir, outDir] = argv.filter(a => !a.startsWith('--') && a !== flag(argv, '--sha') && a !== flag(argv, '--run'));
  if (!inDir || !outDir) throw new Error('usage: rig-ci.js merge <reportsDir> <outDir>');
  const reports = walk(inDir, n => /^rig-report.*\.json$/.test(n)).map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
  const meta = { sha: flag(argv, '--sha') || '', run: flag(argv, '--run') || '', generatedAt: new Date().toISOString() };
  fs.mkdirSync(outDir, { recursive: true });
  const map = mergeCoverage(reports, meta);
  const flakes = collectFlakes(reports, meta);
  fs.writeFileSync(path.join(outDir, 'rig-coverage-map.json'), JSON.stringify(map));
  fs.writeFileSync(path.join(outDir, 'rig-flakes.json'), JSON.stringify(flakes, null, 2));
  const withFns = Object.values(map.scenarios).filter(s => s.fns).length;
  console.log(reports.length + ' reports: ' + Object.keys(map.scenarios).length + ' scenarios timed, ' + withFns + ' with recorded coverage, ' +
              flakes.flakes.length + ' flake(s)');
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = ['## Rig report', '', reports.length + ' shard reports, ' + withFns + ' scenarios with recorded coverage, ' +
                   flakes.flakes.length + ' flake(s) that passed on rerun.'];
    for (const f of flakes.flakes) lines.push('- `' + f.scenario + '` on ' + f.platform + ': ' + f.firstFail.slice(0, 200));
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }
}

function flakes(argv) {
  const limit = Number(flag(argv, '--runs') || 15);
  let runs;
  try { runs = JSON.parse(out(['gh', 'run', 'list', '--workflow', WORKFLOW, '--limit', String(limit), '--json', 'databaseId,conclusion'])); }
  catch (err) { console.log('could not list runs: ' + String(err.message).split('\n')[0]); return; }
  const records = [];
  for (const run of runs) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evermist-rig-flakes-'));
    try {
      out(['gh', 'run', 'download', String(run.databaseId), '-p', 'rig-flakes*', '-D', dir]);
      const file = walk(dir, n => n === 'rig-flakes.json')[0];
      if (file) records.push(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (_) { /* a run with no gate kept no record */ }
  }
  const repeat = repeatFlakes(records);
  console.log(records.length + ' of the last ' + runs.length + ' runs kept a flake record.');
  if (!repeat.length) { console.log('No scenario needed a rerun three times.'); return; }
  for (const r of repeat) console.log('REPEAT FLAKE ' + r.scenario + ': reran in ' + r.runs + ' runs (' + r.platforms.join(', ') + '). Last: ' + r.lastFail.slice(0, 200));
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === 'pick') pick(rest);
  else if (cmd === 'merge') merge(rest);
  else if (cmd === 'flakes') flakes(rest);
  else { console.error('usage: rig-ci.js pick | merge | flakes'); process.exit(2); }
} catch (err) {
  console.error('rig-ci.js ' + cmd + ': ' + err.message);
  process.exit(2);
}
