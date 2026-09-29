'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { i18nKey, i18nLookup, i18nFill, i18nPluralForm, i18nPlural } = require('../src/i18n/i18nPlan');

describe('i18nKey', () => {
  it('collapses the whitespace an HTML file leaves inside a label', () => {
    assert.equal(i18nKey('\n    Import\n      map  '), 'Import map');
  });
});

describe('i18nLookup', () => {
  const dict = { 'Reveal': 'Открыть' };
  it('finds an entry', () => assert.equal(i18nLookup(dict, 'Reveal'), 'Открыть'));
  it('falls back to the English text', () => assert.equal(i18nLookup(dict, 'Hide'), 'Hide'));
  it('never answers from the prototype', () => assert.equal(i18nLookup(dict, 'toString'), 'toString'));
  it('survives no dictionary', () => assert.equal(i18nLookup(null, 'Hide'), 'Hide'));
  it('finds a message with a blank line under its collapsed key', () => {
    assert.equal(i18nLookup({ 'One. Two.': 'Раз. Два.' }, 'One.\n\nTwo.'), 'Раз. Два.');
  });
  it('falls back to the English exactly as written', () => assert.equal(i18nLookup({}, 'One.\n\nTwo.'), 'One.\n\nTwo.'));
});

describe('i18nFill', () => {
  it('fills every named value', () => {
    assert.equal(i18nFill('{n} KB, limit {max} KB', { n: 12, max: 500 }), '12 KB, limit 500 KB');
  });
  it('leaves an unknown name as written', () => assert.equal(i18nFill('{a} {b}', { a: 1 }), '1 {b}'));
  it('never fills a value a second time', () => {
    assert.equal(i18nFill('File {name}', { name: '{name}.png' }), 'File {name}.png');
  });
  it('keeps a value escaped by its caller', () => {
    assert.equal(i18nFill('No scene matches “{q}”.', { q: '&lt;b&gt;' }), 'No scene matches “&lt;b&gt;”.');
  });
  it('returns the text untouched with no values', () => assert.equal(i18nFill('{n}'), '{n}'));
});

describe('i18nPluralForm', () => {
  const ru = n => i18nPluralForm('ru', n);
  it('reads Russian counts', () => {
    assert.deepEqual([0, 1, 2, 5, 11, 21, 22, 25].map(ru),
      ['many', 'one', 'few', 'many', 'many', 'one', 'few', 'many']);
  });
  it('reads English as one or other', () => {
    assert.deepEqual([0, 1, 2].map(n => i18nPluralForm('en', n)), ['other', 'one', 'other']);
  });
});

describe('i18nPlural', () => {
  const dict = { '{n} room': { one: '{n} комната', few: '{n} комнаты', many: '{n} комнат' } };
  it('picks the Russian form for each count', () => {
    assert.deepEqual([0, 1, 2, 5, 11, 21, 22, 25].map(n => i18nPlural('ru', dict, n, '{n} room', '{n} rooms')),
      ['0 комнат', '1 комната', '2 комнаты', '5 комнат', '11 комнат', '21 комната', '22 комнаты', '25 комнат']);
  });
  it('writes English exactly as before', () => {
    assert.equal(i18nPlural('en', dict, 1, '{n} room', '{n} rooms'), '1 room');
    assert.equal(i18nPlural('en', dict, 3, '{n} room', '{n} rooms'), '3 rooms');
  });
  it('falls back to English when Russian has no entry', () => {
    assert.equal(i18nPlural('ru', dict, 3, '{n} door', '{n} doors'), '3 doors');
  });
  it('fills other values beside the count', () => {
    const d = { 'Filter {n} track in {f}': { one: 'a {n} {f}', few: 'b {n} {f}', many: 'c {n} {f}' } };
    assert.equal(i18nPlural('ru', d, 2, 'Filter {n} track in {f}', 'Filter {n} tracks in {f}', { f: 'X' }), 'b 2 X');
  });
  it('writes a fraction with the few form', () => {
    assert.equal(i18nPlural('ru', dict, 1.5, '{n} room', '{n} rooms'), '1.5 комнаты');
  });
});
