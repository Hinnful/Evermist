'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { escHtml } = require('../src/sceneManager.js');

describe('escHtml', () => {
  test('escapes & < > " all at once', () => {
    assert.equal(escHtml('a & b < c > d "e"'), 'a &amp; b &lt; c &gt; d &quot;e&quot;');
  });

  test('& is escaped first — no double-escaping of &lt;', () => {
    // if < were processed before &, '<' → '&lt;' then '&' → '&amp;lt;' (wrong)
    assert.equal(escHtml('<'), '&lt;');
    assert.equal(escHtml('&lt;'), '&amp;lt;');
  });

  test('coerces numbers to string', () => {
    assert.equal(escHtml(42), '42');
  });

  test('coerces null to string', () => {
    assert.equal(escHtml(null), 'null');
  });

  test("single-quote is NOT escaped (pinned behavior)", () => {
    assert.equal(escHtml("O'Brien"), "O'Brien");
  });
});
