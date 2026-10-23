'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { pickScenarios, diffIdentifiers } = require('../tools/rig/pick.js');

const HTML = ['<body>', '<div id="shortcut-legend" style="display:none">', '  <div class="lg-row">A</div>',
  '  <div class="lg-row">B</div>', '</div>', '<div id="other"></div>'].join('\n');

const DIFF = [
  'diff --git a/src/player/playerWindow.js b/src/player/playerWindow.js',
  '--- a/src/player/playerWindow.js',
  '+++ b/src/player/playerWindow.js',
  '@@ -10,2 +10,3 @@ function sendToPlayerNow(msg) {',
  '-  win.post(msg);',
  '+  deliverToPlayer(msg);',
  '@@ -40,0 +41,2 @@',
  '+function deliverToPlayer(msg) {',
  '+  function finish() {',
  '-function oldHelper() {',
  '-  const sub = () => 1;',
  'diff --git a/index.html b/index.html',
  '--- a/index.html',
  '+++ b/index.html',
  '@@ -3,0 +4 @@',
  '+  <div class="lg-row">C</div>',
].join('\n');

test('diffIdentifiers: top-level functions only, nested helpers ignored, legend by line range', () => {
  assert.deepStrictEqual(diffIdentifiers(DIFF, HTML).sort(),
    ['deliverToPlayer', 'oldHelper', 'sendToPlayerNow', 'shortcut-legend']);
});

test('diffIdentifiers: an html hunk outside the legend yields nothing', () => {
  const d = '+++ b/index.html\n@@ -6,0 +6 @@\n+<p>';
  assert.deepStrictEqual(diffIdentifiers(d, HTML), []);
});

const map = { scenarios: {
  a: { ms: { Windows: 1000 }, fns: { 'src/player/playerWindow.js': [1, 2] } },
  wrap: { ms: { Windows: 1000 }, fns: { 'src/player/playerWindow.js': [1] } },
  caller: { ms: { Windows: 1000 }, fns: { 'src/player/playerWindow.js': [1] } },
} };
const headers = { smoke: '', a: '', wrap: '', caller: '' };
const texts = {
  smoke: '', a: 'x',
  wrap: 'const o = sendToPlayer; sendToPlayer = function () { return o(); };',
  caller: 'await sendToPlayer(); if (sendToPlayer === 1) {}',
};
const base = { changed: ['src/player/playerWindow.js'], map, headers, texts };

test('a scenario that wraps a changed function is picked though the cover skips it', () => {
  const r = pickScenarios({ ...base, identifiers: ['sendToPlayer'] });
  const w = r.run.find(x => x.name === 'wrap');
  assert.ok(w);
  assert.strictEqual(w.why, 'names sendToPlayer from the diff');
});

test('without the rule the wrapping scenario is not picked', () => {
  assert.ok(!pickScenarios(base).run.some(x => x.name === 'wrap'));
});

test('a scenario that only calls or compares the function is not picked', () => {
  const r = pickScenarios({ ...base, identifiers: ['sendToPlayer'] });
  assert.ok(!r.run.some(x => x.name === 'caller'));
});

test('window.name assignment counts; the legend takes a plain mention', () => {
  const t = { ...texts, caller: 'window.sendToPlayer = f;', doc: "qs('#shortcut-legend')" };
  const r = pickScenarios({ ...base, headers: { ...headers, doc: '' }, texts: t, identifiers: ['sendToPlayer', 'shortcut-legend'] });
  assert.ok(r.run.some(x => x.name === 'caller'));
  assert.ok(r.run.some(x => x.name === 'doc' && x.why === 'names shortcut-legend from the diff'));
});

test('over the cap it still runs, with a note', () => {
  const r = pickScenarios({ ...base, identifiers: ['sendToPlayer'], capMs: 1 });
  assert.ok(r.run.some(x => x.name === 'wrap'));
  assert.ok(r.notes.some(n => /exceeds/.test(n)));
});
