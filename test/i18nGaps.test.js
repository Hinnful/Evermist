'use strict';

// The Russian interface stays complete: this fails the release while any English a DM reads has
// no entry in src/i18n/ru.js, or reaches the screen glued from pieces. The fix is the entry, or a
// t() call with {names}; `node tools/i18n-report.js` prints the same lists with file names.
// A string the scan mistakes for screen text is fixed in the scan, never by a dummy entry.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { i18nGaps } = require('../tools/i18n-report');

describe('Russian interface', () => {
  const gaps = i18nGaps();
  const list = rows => rows.map(([a, b]) => `  ${a}: ${JSON.stringify(b)}`).join('\n');

  it('has a Russian entry for every piece of English on the DM screen', () => {
    assert.equal(gaps.missing.length, 0, 'No Russian entry in src/i18n/ru.js:\n' +
      list(gaps.missing.map(([k, w]) => [w, k])));
  });

  it('has a Russian entry for every count', () => {
    assert.equal(gaps.missingPlural.length, 0, 'No RU_PLURAL entry in src/i18n/ru.js:\n' +
      list(gaps.missingPlural.map(([k, w]) => [w, k])));
  });

  it('builds no sentence from pieces', () => {
    assert.equal(gaps.glued.length, 0, 'Glued from pieces, so it stays English - use t() with {names}:\n' +
      list(gaps.glued));
  });

  // A later duplicate key silently wins in a JS object literal, so the better wording can lose.
  const ruSrc = fs.readFileSync(path.join(__dirname, '../src/i18n/ru.js'), 'utf8');
  const { RU, RU_PLURAL } = new Function(ruSrc + '\nreturn { RU, RU_PLURAL };')();

  it('has no key twice in src/i18n/ru.js', () => {
    const seen = new Map(), dups = [];
    let block = null;
    for (const line of ruSrc.split('\n')) {
      if (/^const RU(_PLURAL)?\b/.test(line)) block = line.match(/^const (\w+)/)[1];
      else if (/^};/.test(line)) block = null;
      if (!block) continue;
      for (const m of line.matchAll(/(?:^ {1,2}|,\s)'((?:[^'\\]|\\.)*)'\s*:/g)) {
        const id = block + ' ' + m[1];
        if (seen.has(id)) dups.push(id);
        seen.set(id, true);
      }
    }
    assert.deepEqual(dups, [], 'Duplicate keys in src/i18n/ru.js - the later one wins');
  });

  it('translates the split refusal for a room, an effect and a light', () => {
    for (const noun of ['room', 'effect', 'light']) {
      assert.ok(RU[`A cut has to enter and leave the ${noun} once each. Nothing changed.`], noun);
    }
  });

  it('keeps a counted entry out of the plain dictionary', () => {
    const wrong = Object.keys(RU).filter(k => RU[k] && typeof RU[k] === 'object');
    assert.deepEqual(wrong, [], 'A { one, few, many } entry belongs in RU_PLURAL');
    assert.ok(RU_PLURAL['{n} square'], 'the effect size list counts squares');
  });
});
