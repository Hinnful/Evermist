'use strict';

// pick.js — which rig scenarios a diff needs, chosen from what CI recorded each one executing.
//
// Pure: no git, no network, no disk. tools/rig-ci.js feeds it the changed files, the recorded map
// and the scenario headers, and prints what it answers. Unit-tested in test/rigPick.test.js.
//
// THE MAP (rig-coverage-map.json, written by tools/rig/reports.js) holds, per scenario, how long it
// took and which functions of which src file it called. A file is covered by the scenarios that
// called its functions. The pick is a greedy cover: the scenario reaching the most not-yet-reached
// functions of the changed files per second goes next, until every function any scenario reaches is
// reached or the time cap is spent. `smoke` always runs first.
//
// WHAT COVERAGE CANNOT SEE, and the answer for each:
//   - main-process files (main.js, electron/): the profiler belongs to a page
//   - stylesheets and markup: no function to call
//   - a file loaded at boot and never called by any scenario (data tables, constants)
// For these the pick is smoke plus every scenario whose header names the file, and it says so.
// Only a src/**.js file with NO recorded scenario, NO naming header and NO boot load blocks.

const path = require('path');

const DEFAULT_CAP_MS = 10 * 60 * 1000;
const UNKNOWN_MS = 90 * 1000;    // a scenario the map has not timed yet

const isAppFile = f => /^(src\/|index\.html$|stage\.html$|splash\.html$|main\.js$|preload\.js$|electron\/)/.test(f);
const isRecordable = f => /^src\/.+\.js$/.test(f);
const isScenarioFile = f => /^tools\/rig\/scenarios\/(acceptance\/)?[^/]+\.js$/.test(f);
const scenarioName = f => path.basename(f, '.js');

// A scenario's header is its criteria. A file is named there by its repo path or its bare name.
function headerNames(header, file) {
  const base = path.basename(file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return header.includes(file) || new RegExp('(^|[^\\w./-])' + base + '(?![\\w-])').test(header);
}

function durationOf(entry) {
  const ms = entry && entry.ms;
  if (!ms) return UNKNOWN_MS;
  return ms.Windows || Math.max(...Object.values(ms)) || UNKNOWN_MS;
}

/*
 * input: {
 *   changed:   repo paths the diff touches,
 *   map:       the parsed rig-coverage-map.json, or null,
 *   headers:   { scenarioName: header text } for every scenario that exists now,
 *   capMs:     the time the local run may take, smoke included
 * }
 * answers: { run: [{ name, ms, why }], skipped: [{ name, ms, why }], blocked: [file],
 *            notes: [string], totalMs }
 */
function pickScenarios({ changed, map, headers, capMs = DEFAULT_CAP_MS }) {
  const notes = [];
  const exists = name => Object.prototype.hasOwnProperty.call(headers, name);
  const recorded = (map && map.scenarios) || {};
  const app = changed.filter(isAppFile);
  const edited = changed.filter(isScenarioFile).map(scenarioName).filter(exists);

  const run = [];          // in the order they will run
  const chosen = new Set();
  const take = (name, why) => {
    if (chosen.has(name) || !exists(name) && name !== 'smoke') return;
    chosen.add(name);
    run.push({ name, ms: durationOf(recorded[name]), why });
  };
  const skipped = [];

  if (!app.length && !edited.length) {
    return { run: [], skipped: [], blocked: [], totalMs: 0,
             notes: ['no app file and no scenario changed, so the rig does not run'] };
  }
  if (!map) notes.push('no coverage map from a green run was available: falling back to smoke plus the scenarios whose header names a changed file');

  take('smoke', 'always first');
  for (const name of edited) take(name, 'its own file changed');

  // What the greedy cover is after: every (file, function) a scenario reached in a changed file.
  const wanted = new Set();
  const reach = {};        // scenario -> Set of "file@offset"
  const fallbackFiles = [];
  const blocked = [];
  for (const f of app) {
    const scenarios = Object.entries(recorded).filter(([n, e]) => exists(n) && e.fns && e.fns[f]);
    const named = Object.keys(headers).filter(n => headerNames(headers[n], f));
    if (isRecordable(f) && scenarios.length) {
      for (const [n, e] of scenarios) {
        (reach[n] = reach[n] || new Set());
        for (const o of e.fns[f]) { reach[n].add(f + '@' + o); wanted.add(f + '@' + o); }
      }
    } else {
      fallbackFiles.push(f);
      const bootOnly = map && (map.loaded || []).includes(f);
      if (isRecordable(f) && !named.length && !bootOnly) blocked.push(f);
      else if (!named.length) notes.push(f + ' is not something coverage can record (' +
        (isRecordable(f) ? 'only loaded at boot, never called' : 'not a script a page runs') + '): smoke is its check');
    }
    for (const n of named) take(n, 'its header names ' + f);
  }
  if (fallbackFiles.length && map) {
    notes.push('not in the map, so smoke plus the header-named scenarios stand in for: ' + fallbackFiles.join(', '));
  }

  // Greedy: most newly reached functions per second first.
  const reached = new Set();
  for (const r of run) for (const id of reach[r.name] || []) reached.add(id);
  const rest = Object.keys(reach).filter(n => !chosen.has(n));
  while (rest.length) {
    let best = null;
    for (const n of rest) {
      let gain = 0;
      for (const id of reach[n]) if (!reached.has(id)) gain++;
      const score = gain / durationOf(recorded[n]);
      if (gain && (!best || score > best.score)) best = { n, gain, score };
    }
    if (!best) break;
    rest.splice(rest.indexOf(best.n), 1);
    for (const id of reach[best.n]) reached.add(id);
    take(best.n, 'reaches ' + best.gain + ' more functions of the changed files');
  }

  // The cap. Smoke and an edited scenario are never dropped; the rest go in the order chosen.
  let total = 0;
  const kept = [];
  for (const r of run) {
    const must = r.name === 'smoke' || edited.includes(r.name) || r.why.startsWith('its header');
    if (must || total + r.ms <= capMs) { kept.push(r); total += r.ms; } else skipped.push(r);
  }
  if (skipped.length) {
    notes.push('over the ' + Math.round(capMs / 60000) + ' minute cap, so ' + skipped.length +
      ' scenario(s) are left to CI: ' + skipped.map(s => s.name).join(', '));
  }
  const reachedKept = new Set();
  for (const r of kept) for (const id of reach[r.name] || []) reachedKept.add(id);
  if (wanted.size) notes.push('the picked set reaches ' + reachedKept.size + ' of the ' + wanted.size +
    ' functions any scenario ran in the changed files');
  return { run: kept, skipped, blocked, notes, totalMs: total };
}

module.exports = { pickScenarios, headerNames, isAppFile, isRecordable, DEFAULT_CAP_MS };
