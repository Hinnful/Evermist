'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDisplayRecord } = require('../src/display.js');

test('integer scaleFactor', () => {
  const result = normalizeDisplayRecord({ workAreaSize: { width: 1920, height: 1080 }, scaleFactor: 1 });
  assert.deepEqual(result, { w: 1920, h: 1080, scaleFactor: 1 });
});

test('fractional scaleFactor', () => {
  const result = normalizeDisplayRecord({ workAreaSize: { width: 2560, height: 1440 }, scaleFactor: 1.5 });
  assert.deepEqual(result, { w: 2560, h: 1440, scaleFactor: 1.5 });
});

test('missing workAreaSize falls back to size', () => {
  const result = normalizeDisplayRecord({ size: { width: 3840, height: 2160 }, scaleFactor: 2 });
  assert.deepEqual(result, { w: 3840, h: 2160, scaleFactor: 2 });
});
