'use strict';

// coverage.js — which app files a scenario actually ran, recorded over CDP rather than declared.
//
// V8's precise coverage runs inside the page. A scenario's set is every repo file with a function
// that executed between startCoverage and takeCoverage, in the DM window and the Player windows
// alike. CI merges the shards' sets into one map (tools/merge-rig-reports.js), and /commit reads
// that map to pick the scenarios for a diff (tools/pick-rig.js).
//
// Main-process files (main.js, electron/) never reach this: the Profiler domain belongs to a page.
//
// The pure half (repoPathOf, filesFrom) is unit-tested in test/rigCoverage.test.js.

// A script url as the page reports it, down to the repo path it came from. Repo checkouts and the
// packaged app.asar both end in the same relative path, and the LAST `src/` wins so a checkout
// under a folder called src still resolves.
function repoPathOf(url) {
  if (!url || !url.startsWith('file:')) return null;
  let u;
  try { u = decodeURIComponent(url.replace(/[?#].*$/, '')); } catch (_) { return null; }
  const src = /^.*\/(src\/.+\.js)$/.exec(u);
  if (src) return src[1];
  const page = /\/([A-Za-z0-9_-]+\.html)$/.exec(u);
  if (page) return page[1];
  if (/\/preload\.js$/.test(u)) return 'preload.js';
  return null;
}

// A script's own top-level code is the function V8 lists first, nameless, from offset 0. It runs
// when the file loads, so counting it would put every file in every scenario's set.
const isTopLevel = fn => !fn.functionName && fn.ranges && fn.ranges[0] && fn.ranges[0].startOffset === 0;

// What takePreciseCoverage answered: `ran` maps each repo path to the start offsets of the functions
// that were called (a function's identity inside one build of the file), and `loaded` lists every
// path seen at all. The inline script of index.html is attributed to index.html, since its url is the
// page's own.
//
// ⚠ FUNCTIONS, NOT WHOLE FILES. A scenario that merely opens a map calls something in a hundred
// files, so a file-level answer would say every scenario covers everything. The offsets let the
// picker choose scenarios that between them reach the most of a changed file.
function filesFrom(result) {
  const ran = new Map();
  const loaded = new Set();
  for (const s of result || []) {
    const f = repoPathOf(s.url);
    if (!f) continue;
    loaded.add(f);
    const hit = (s.functions || []).filter(fn => !isTopLevel(fn) && (fn.ranges || []).some(r => r.count > 0))
      .map(fn => fn.ranges[0].startOffset);
    if (hit.length) ran.set(f, (ran.get(f) || []).concat(hit));
  }
  return { ran, loaded };
}

// Adds one harvest to another's `ran` map, offsets kept unique and sorted.
function mergeRan(into, from) {
  for (const [f, offs] of from) {
    const set = new Set(into.get(f) || []);
    offs.forEach(o => set.add(o));
    into.set(f, Array.from(set).sort((x, y) => x - y));
  }
  return into;
}

// callCount and detailed stay off: only "did it run" is wanted, and that is the cheap mode.
async function startCoverage(session) {
  await session.send('Profiler.enable');
  await session.send('Profiler.startPreciseCoverage', { callCount: false, detailed: false });
}

async function takeCoverage(session) {
  const r = await session.send('Profiler.takePreciseCoverage', {}, 120000);
  return filesFrom(r.result);
}

module.exports = { repoPathOf, filesFrom, mergeRan, startCoverage, takeCoverage };
