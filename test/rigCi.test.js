'use strict';

// The rig's CI half: reading a coverage answer, picking scenarios from the map, merging reports and
// counting repeat flakes. The pure modules only; run.js drives a real app and is the rig's own job.

const test = require('node:test');
const assert = require('node:assert');
const { repoPathOf, filesFrom, mergeRan } = require('../tools/rig/coverage.js');
const { pickScenarios, headerNames } = require('../tools/rig/pick.js');
const { mergeCoverage, collectFlakes, repeatFlakes } = require('../tools/rig/reports.js');

const fn = (startOffset, count, functionName = 'f') => ({ functionName, ranges: [{ startOffset, endOffset: startOffset + 9, count }] });
const top = count => ({ functionName: '', ranges: [{ startOffset: 0, endOffset: 999, count }] });

test('a script url becomes the repo path it came from', () => {
  assert.equal(repoPathOf('file:///C:/Users/x/Evermist/src/fog/fog.js'), 'src/fog/fog.js');
  assert.equal(repoPathOf('file:///C:/Users/x/Evermist/resources/app.asar/src/ui/dock.js?v=2'), 'src/ui/dock.js');
  assert.equal(repoPathOf('file:///C:/src/Evermist/src/ui/dock.js'), 'src/ui/dock.js');
  assert.equal(repoPathOf('file:///C:/%D0%A0/Evermist/index.html'), 'index.html');
  assert.equal(repoPathOf('file:///C:/Evermist/lib/pixi.min.js'), null);
  assert.equal(repoPathOf('node:electron/js2c/sandbox_bundle'), null);
});

test('a file ran only when one of its own functions was called', () => {
  const got = filesFrom([
    { url: 'file:///a/src/x.js', functions: [top(1), fn(40, 3), fn(90, 0)] },
    { url: 'file:///a/src/loadedOnly.js', functions: [top(1), fn(10, 0)] },
    { url: 'file:///a/lib/pixi.min.js', functions: [fn(5, 9)] },
  ]);
  assert.deepEqual(Array.from(got.ran), [['src/x.js', [40]]]);
  assert.deepEqual(Array.from(got.loaded).sort(), ['src/loadedOnly.js', 'src/x.js']);
});

test('two harvests merge their function offsets without repeats', () => {
  const m = mergeRan(new Map([['src/x.js', [40, 90]]]), new Map([['src/x.js', [90, 10]], ['src/y.js', [1]]]));
  assert.deepEqual(Array.from(m), [['src/x.js', [10, 40, 90]], ['src/y.js', [1]]]);
});

test('a header names a file by path or bare name, never by a longer name', () => {
  assert.ok(headerNames('// covers src/fog/fog.js', 'src/fog/fog.js'));
  assert.ok(headerNames('// the dock.js buttons', 'src/ui/dock.js'));
  assert.ok(!headerNames('// the controlDock.js buttons', 'src/ui/dock.js'));
  assert.ok(!headerNames('// the dock.json file', 'src/ui/dock.js'));
});

const headers = { smoke: '', fog: '// fog', dock: '// dock', slow: '// slow', named: '// src/ui/panel.js' };
const map = {
  loaded: ['src/data/table.js'],
  scenarios: {
    smoke: { ms: { Windows: 20000 }, fns: { 'src/fog/fog.js': [1] } },
    fog: { ms: { Windows: 30000 }, fns: { 'src/fog/fog.js': [1, 2, 3], 'src/ui/dock.js': [5] } },
    dock: { ms: { Windows: 30000 }, fns: { 'src/ui/dock.js': [5, 6] } },
    slow: { ms: { Windows: 900000 }, fns: { 'src/fog/fog.js': [4] } },
    gone: { ms: { Windows: 1000 }, fns: { 'src/fog/fog.js': [9] } },
  },
};
const names = a => a.run.map(r => r.name);

test('nothing runs for a diff that touches no app file', () => {
  const a = pickScenarios({ changed: ['docs/BACKLOG.md', 'test/x.test.js'], map, headers });
  assert.deepEqual(a.run, []);
});

test('smoke goes first and the scenarios reaching the changed file follow, cheapest per function first', () => {
  const a = pickScenarios({ changed: ['src/fog/fog.js'], map, headers, capMs: 3600000 });
  assert.equal(names(a)[0], 'smoke');
  assert.ok(names(a).includes('fog') && names(a).includes('slow'));
  assert.ok(!names(a).includes('gone'), 'a scenario that no longer exists is never picked');
  assert.deepEqual(a.blocked, []);
});

test('the time cap leaves the slowest to CI and says so', () => {
  const a = pickScenarios({ changed: ['src/fog/fog.js'], map, headers, capMs: 120000 });
  assert.deepEqual(a.skipped.map(s => s.name), ['slow']);
  assert.ok(a.notes.some(n => n.includes('left to CI')));
  assert.ok(a.totalMs <= 120000);
});

test('a changed scenario file runs itself even when no app file changed', () => {
  const a = pickScenarios({ changed: ['tools/rig/scenarios/acceptance/dock.js'], map, headers });
  assert.deepEqual(names(a), ['smoke', 'dock']);
});

test('a src file no scenario ran blocks unless a header names it or it only loads at boot', () => {
  assert.deepEqual(pickScenarios({ changed: ['src/new/thing.js'], map, headers }).blocked, ['src/new/thing.js']);
  const named = pickScenarios({ changed: ['src/ui/panel.js'], map, headers });
  assert.deepEqual(named.blocked, []);
  assert.ok(names(named).includes('named'));
  assert.deepEqual(pickScenarios({ changed: ['src/data/table.js'], map, headers }).blocked, []);
});

test('a stylesheet or main-process file falls back to smoke and never blocks', () => {
  const a = pickScenarios({ changed: ['src/css/dock.css', 'main.js'], map, headers });
  assert.deepEqual(names(a), ['smoke']);
  assert.deepEqual(a.blocked, []);
});

test('with no map the header-named scenarios and smoke stand in, and the note says so', () => {
  const a = pickScenarios({ changed: ['src/ui/panel.js'], map: null, headers });
  assert.deepEqual(names(a), ['smoke', 'named']);
  assert.ok(a.notes.some(n => n.includes('no coverage map')));
});

test('reports merge into one map, with times per platform and functions from the platform that recorded them', () => {
  const merged = mergeCoverage([
    { platform: 'Windows', scenarios: { fog: { ms: 100, fns: { 'src/a.js': [3, 1] }, loaded: ['src/a.js'] } } },
    { platform: 'Linux', scenarios: { fog: { ms: 400 }, dock: { ms: 50 } } },
  ], { sha: 'abc' });
  assert.deepEqual(merged.scenarios.fog.ms, { Windows: 100, Linux: 400 });
  assert.deepEqual(merged.scenarios.fog.fns, { 'src/a.js': [1, 3] });
  assert.equal(merged.scenarios.dock.fns, undefined);
  assert.deepEqual(merged.loaded, ['src/a.js']);
  assert.equal(merged.sha, 'abc');
});

test('a scenario that reran in three runs is reported once, however many platforms reran it', () => {
  const rec = (...f) => ({ flakes: f.map(([scenario, platform]) => ({ scenario, platform, firstFail: 'x ' + platform })) });
  const records = [
    rec(['fog', 'Linux'], ['fog', 'macOS'], ['dock', 'Linux']),
    rec(['fog', 'Linux']),
    rec(['dock', 'Linux']),
    rec(['fog', 'Windows']),
  ];
  const r = repeatFlakes(records);
  assert.deepEqual(r.map(x => [x.scenario, x.runs]), [['fog', 3]]);
  assert.deepEqual(r[0].platforms, ['Linux', 'Windows', 'macOS']);
});

test('the flake record of a run lists each rerun with its platform', () => {
  const f = collectFlakes([{ platform: 'Linux', flakes: [{ scenario: 'fog', firstFail: 'boom' }] }, { platform: 'Windows', flakes: [] }], { run: '7' });
  assert.deepEqual(f.flakes, [{ scenario: 'fog', platform: 'Linux', firstFail: 'boom' }]);
});
