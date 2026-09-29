'use strict';

// The Russian interface stays complete: this fails the release while any English a DM reads has
// no entry in src/i18n/ru.js, or reaches the screen glued from pieces. The fix is the entry, or a
// t() call with {names}; `node tools/i18n-report.js` prints the same lists with file names.
// A string the scan mistakes for screen text is fixed in the scan, never by a dummy entry.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
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
});
