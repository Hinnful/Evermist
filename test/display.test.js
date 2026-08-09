'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDisplayRecord } = require('../src/display.js');

describe('normalizeDisplayRecord — scaleFactor', () => {
  test('integer scaleFactor', () => {
    const result = normalizeDisplayRecord({ workAreaSize: { width: 1920, height: 1080 }, scaleFactor: 1 });
    assert.deepEqual(result, { w: 1920, h: 1080, scaleFactor: 1 });
  });
  test('fractional scaleFactor', () => {
    const result = normalizeDisplayRecord({ workAreaSize: { width: 2560, height: 1440 }, scaleFactor: 1.5 });
    assert.deepEqual(result, { w: 2560, h: 1440, scaleFactor: 1.5 });
  });
  test('missing scaleFactor falls back to 1', () => {
    const result = normalizeDisplayRecord({ workAreaSize: { width: 1920, height: 1080 } });
    assert.equal(result.scaleFactor, 1);
  });
  test('string scaleFactor falls back to 1', () => {
    const result = normalizeDisplayRecord({ workAreaSize: { width: 1920, height: 1080 }, scaleFactor: '2' });
    assert.equal(result.scaleFactor, 1);
  });
  test('null scaleFactor falls back to 1', () => {
    const result = normalizeDisplayRecord({ workAreaSize: { width: 1920, height: 1080 }, scaleFactor: null });
    assert.equal(result.scaleFactor, 1);
  });
  // NaN and Infinity are both typeof 'number', so the guard is isFinite, not typeof.
  test('NaN scaleFactor falls back to 1', () => {
    const result = normalizeDisplayRecord({ workAreaSize: { width: 1920, height: 1080 }, scaleFactor: NaN });
    assert.equal(result.scaleFactor, 1);
  });
  test('Infinite scaleFactor falls back to 1', () => {
    const result = normalizeDisplayRecord({ workAreaSize: { width: 1920, height: 1080 }, scaleFactor: Infinity });
    assert.equal(result.scaleFactor, 1);
  });
});

describe('normalizeDisplayRecord — field preference', () => {
  test('missing workAreaSize falls back to size', () => {
    const result = normalizeDisplayRecord({ size: { width: 3840, height: 2160 }, scaleFactor: 2 });
    assert.deepEqual(result, { w: 3840, h: 2160, scaleFactor: 2 });
  });
  test('workAreaSize preferred when both present', () => {
    const result = normalizeDisplayRecord({
      workAreaSize: { width: 1920, height: 1040 },
      size:         { width: 1920, height: 1080 },
      scaleFactor: 1,
    });
    assert.deepEqual(result, { w: 1920, h: 1040, scaleFactor: 1 });
  });
  test('neither present → {w:0, h:0}', () => {
    const result = normalizeDisplayRecord({ scaleFactor: 1 });
    assert.equal(result.w, 0);
    assert.equal(result.h, 0);
  });
  test('workAreaSize present but width missing → w:0', () => {
    const result = normalizeDisplayRecord({ workAreaSize: { height: 1080 }, scaleFactor: 1 });
    assert.equal(result.w, 0);
    assert.equal(result.h, 1080);
  });
  test('null raw → {w:0, h:0, scaleFactor:1}', () => {
    const result = normalizeDisplayRecord(null);
    assert.deepEqual(result, { w: 0, h: 0, scaleFactor: 1 });
  });
});
