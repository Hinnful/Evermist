'use strict';

// The rig's ban on faked input (tools/rig/fakeInput.js): what counts as a fake, and the allow list that may only
// shrink.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { fakeActions, fakeVerdict } = require('../tools/rig/fakeInput.js');

const RIG = path.join(__dirname, '..', 'tools', 'rig');

describe('faked input in a scenario', () => {
  it('finds a JS click, a synthetic event, a script-set value and the old helpers', () => {
    const src = [
      "await dm.evaluate('document.getElementById(\"btn-reveal\").click(); 0');",
      "i.dispatchEvent(new Event('input', { bubbles: true }));",
      "const k = new KeyboardEvent('keydown', { code: 'KeyH' });",
      'inp.focus();',
      'inp.value = q;',
      "await dm.evaluate('__rigDrag(1, 2, 3, 4)');",
    ].join('\n');
    assert.deepEqual(fakeActions(src).map((f) => f.line), [1, 2, 3, 4, 5, 6]);
  });
  it('passes real input, comparisons and stage-setting lines marked as such', () => {
    const src = [
      "await u.click('#btn-reveal');",
      "await dm.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: 2 });",
      'if (a.value === b.value) n++;',
      "inp.files = dt.files; // setup: the native picker would hand these over",
      '// a comment about .click() is not code',
    ].join('\n');
    assert.deepEqual(fakeActions(src), []);
  });
  it('refuses a scenario past its allowance, and a new one with any', () => {
    assert.equal(fakeVerdict('scenarios/x.js', 'a.click();', {}).split('\n')[0].includes('fakes 1 action'), true);
    assert.equal(fakeVerdict('scenarios/x.js', 'a.click();', { 'scenarios/x.js': 1 }), null);
    assert.equal(fakeVerdict('scenarios/x.js', "await u.click('#a');", {}), null);
  });
  it('allows each kept scenario exactly what it still fakes, so the list only shrinks', () => {
    const allow = JSON.parse(fs.readFileSync(path.join(RIG, 'fakeInput.allow.json'), 'utf8'));
    for (const [rel, n] of Object.entries(allow)) {
      if (rel === 'note') continue;
      const found = fakeActions(fs.readFileSync(path.join(RIG, rel), 'utf8')).length;
      assert.equal(found, n, rel + ' fakes ' + found + ' action(s) and is allowed ' + n + '; set the allowance to ' + found + (found ? '' : ' by removing the entry'));
    }
  });
});
