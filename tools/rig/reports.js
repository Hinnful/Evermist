'use strict';

// reports.js — what the shards' --report files become once CI has them all in one place.
//
// run.js writes one report per rig invocation: per-scenario time (and, on the platform that
// records it, the functions each scenario called), the flakes and the failures. Pure functions here;
// tools/rig-ci.js does the reading and writing. Unit-tested in test/rigReports.test.js.

const FLAKE_LIMIT = 3;   // reruns across recent runs before a scenario is proposed for a fix or retirement

// reports: [{ platform, scenarios: { name: { ms, fns?, loaded? } }, flakes, failed }]
// answers the coverage map /commit picks from. Times are kept per platform; functions come from
// whichever report carried them, and a scenario recorded twice (a smoke pass and a shard) is merged.
function mergeCoverage(reports, meta) {
  const scenarios = {};
  const loaded = new Set();
  for (const r of reports) {
    for (const [name, e] of Object.entries(r.scenarios || {})) {
      const out = scenarios[name] = scenarios[name] || { ms: {}, fns: {} };
      out.ms[r.platform] = Math.max(out.ms[r.platform] || 0, e.ms || 0);
      for (const [file, offs] of Object.entries(e.fns || {})) {
        out.fns[file] = Array.from(new Set((out.fns[file] || []).concat(offs))).sort((a, b) => a - b);
      }
      (e.loaded || []).forEach(f => loaded.add(f));
    }
  }
  for (const s of Object.values(scenarios)) if (!Object.keys(s.fns).length) delete s.fns;
  return { version: 1, ...meta, scenarios, loaded: Array.from(loaded).sort() };
}

// The reruns of one run: every scenario that failed once and passed, with the platform it did so on.
function collectFlakes(reports, meta) {
  const flakes = [];
  for (const r of reports) for (const f of r.flakes || []) {
    flakes.push({ scenario: f.scenario, platform: r.platform, firstFail: f.firstFail });
  }
  return { version: 1, ...meta, flakes };
}

// flakeRecords: the parsed rig-flakes.json of each recent run, newest first.
// answers scenario -> { runs, platforms } for those at or over the limit, most often first. A scenario
// counts once per run however many platforms reran it.
function repeatFlakes(flakeRecords, limit = FLAKE_LIMIT) {
  const byScenario = new Map();
  for (const rec of flakeRecords) {
    const seen = new Set();
    for (const f of rec.flakes || []) {
      const e = byScenario.get(f.scenario) || { scenario: f.scenario, runs: 0, platforms: new Set(), lastFail: '' };
      if (!seen.has(f.scenario)) { e.runs++; seen.add(f.scenario); }
      e.platforms.add(f.platform);
      if (!e.lastFail) e.lastFail = f.firstFail;
      byScenario.set(f.scenario, e);
    }
  }
  return Array.from(byScenario.values())
    .filter(e => e.runs >= limit)
    .sort((a, b) => b.runs - a.runs)
    .map(e => ({ scenario: e.scenario, runs: e.runs, platforms: Array.from(e.platforms).sort(), lastFail: e.lastFail }));
}

module.exports = { mergeCoverage, collectFlakes, repeatFlakes, FLAKE_LIMIT };
