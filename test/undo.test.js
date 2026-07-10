'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { evictUndoStack } = require('../src/undo.js');

function entry(w, h) { return { baseFog: { width: w, height: h } }; }

describe('evictUndoStack', () => {
  it('under budget → stack unchanged', () => {
    const stack = [entry(10, 10), entry(10, 10)];
    // 2 entries × 10×10×4 = 800 bytes; budget 1000
    const result = evictUndoStack(stack, 1000);
    assert.equal(result.length, 2);
  });

  it('over budget → shifts oldest until under', () => {
    // each entry = 100×100×4 = 40000 bytes; budget = 50000
    const stack = [entry(100, 100), entry(100, 100), entry(100, 100)];
    evictUndoStack(stack, 50000);
    assert.equal(stack.length, 1);
  });

  it('length > 1 floor: single entry larger than budget is never evicted', () => {
    const stack = [entry(1000, 1000)]; // 4MB >> budget
    evictUndoStack(stack, 1);
    assert.equal(stack.length, 1);
  });

  it('two entries where combined > budget but keeping one stays: result is 1 entry', () => {
    // entry A = 50×50×4 = 10000; entry B = 50×50×4 = 10000; total = 20000 > 15000 budget
    const stack = [entry(50, 50), entry(50, 50)];
    evictUndoStack(stack, 15000);
    assert.equal(stack.length, 1);
  });

  it('exact boundary total === maxBytes → kept (> not >=)', () => {
    // entry = 10×10×4 = 400; budget = 400 → total === budget → NOT evicted
    const stack = [entry(10, 10), entry(10, 10)];
    evictUndoStack(stack, 800);
    assert.equal(stack.length, 2);
  });

  it('returns the same array reference', () => {
    const stack = [entry(10, 10)];
    const result = evictUndoStack(stack, 1000);
    assert.strictEqual(result, stack);
  });
});
