'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { evictUndoStack, evictUndoPair } = require('../src/undo.js');

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

describe('evictUndoPair — one budget across both stacks', () => {
  // each entry = 100×100×4 = 40000 bytes
  const E = () => entry(100, 100);

  it('empty redo → undo keeps the whole budget', () => {
    const undo = [E(), E(), E()], redo = [];
    evictUndoPair(undo, redo, 120000);
    assert.equal(undo.length, 3);
  });

  it('the pair is capped together, not each stack separately', () => {
    // Capping each at 120000 would allow 6 entries / 240000 bytes total.
    const undo = [E(), E(), E()], redo = [E(), E(), E()];
    evictUndoPair(undo, redo, 120000);
    const total = [...undo, ...redo]
      .reduce((s, e) => s + e.baseFog.width * e.baseFog.height * 4, 0);
    assert.ok(total <= 120000, `pair total ${total} exceeded budget`);
  });

  it('redo is trimmed before undo depth is touched', () => {
    const undo = [E(), E()], redo = [E(), E()];
    evictUndoPair(undo, redo, 120000);
    assert.equal(undo.length, 2);  // undo depth preserved
    assert.equal(redo.length, 1);  // redo gave up the space
  });

  it('redo keeps one entry so redo() can never pop undefined', () => {
    const undo = [E(), E(), E()], redo = [E()];
    evictUndoPair(undo, redo, 1);
    assert.equal(redo.length, 1);
  });

  it('undo keeps one entry even when the pair is far over budget', () => {
    const undo = [E()], redo = [E()];
    evictUndoPair(undo, redo, 1);
    assert.equal(undo.length, 1);
  });

  it('trims from the oldest end of redo', () => {
    const oldest = entry(100, 100); oldest.tag = 'oldest';
    const newest = entry(100, 100); newest.tag = 'newest';
    const undo = [E(), E()], redo = [oldest, newest];
    evictUndoPair(undo, redo, 120000);
    assert.equal(redo[0].tag, 'newest');
  });

  it('returns both stacks by reference', () => {
    const undo = [E()], redo = [E()];
    const result = evictUndoPair(undo, redo, 1000000);
    assert.strictEqual(result.undo, undo);
    assert.strictEqual(result.redo, redo);
  });
});
