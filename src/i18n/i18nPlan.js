'use strict';

// i18nPlan.js — pure kernel for the interface language: lookup, {name} fill, plural pick.
// No DOM. Unit-tested; see test/i18nPlan.test.js. The English text is the key; a missing entry
// falls back to it.

function i18nKey(text) { return String(text).replace(/\s+/g, ' ').trim(); }

// Keys are stored with whitespace collapsed, so a message with a blank line still finds its entry.
function i18nLookup(dict, src) {
  const k = i18nKey(src);
  return dict && Object.prototype.hasOwnProperty.call(dict, k) ? dict[k] : src;
}

// One pass, so a value that itself holds "{x}" is never filled again. Callers inside an innerHTML
// template pass values already escaped.
function i18nFill(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m);
}

function i18nPluralForm(lang, n) {
  if (lang !== 'ru') return n === 1 ? 'one' : 'other';
  return new Intl.PluralRules('ru').select(n);
}

// A Russian entry is { one, few, many } keyed by the English `one` string; a fraction picks
// 'other', which Russian writes as `few`.
function i18nPlural(lang, dict, n, one, other, vars) {
  const all = Object.assign({ n: n }, vars);
  const form = i18nPluralForm(lang, n);
  const entry = lang === 'ru' ? i18nLookup(dict, one) : one;
  if (entry === one) return i18nFill(n === 1 ? one : other, all);
  return i18nFill(entry[form] || (form === 'other' ? entry.few : entry.many), all);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { i18nKey, i18nLookup, i18nFill, i18nPluralForm, i18nPlural };
}
