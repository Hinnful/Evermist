'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { placePlan, placeWindowFit, PLACE_MIN_ROOM } = require('../src/ui/placePlan.js');

const VIEW = { left: 0, top: 0, right: 1000, bottom: 600 };
const box = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h });
const inside = (p, size, view = VIEW, m = 8) => {
  const h = p.maxHeight == null ? size.height : Math.min(size.height, p.maxHeight);
  const w = p.maxWidth == null ? size.width : Math.min(size.width, p.maxWidth);
  return p.left >= view.left + m && p.top >= view.top + m && p.left + w <= view.right - m && p.top + h <= view.bottom - m;
};

describe('placePlan: own side', () => {
  it('a list above its button stands above it, the gap between', () => {
    const p = placePlan(box(400, 500, 40, 30), { width: 200, height: 150 }, VIEW, { side: 'above', gap: 10 });
    assert.deepEqual(p, { left: 400, top: 340, maxHeight: null, maxWidth: null, side: 'above' });
  });
  it('a menu at a point opens below and right of it', () => {
    const p = placePlan(box(300, 200, 0, 0), { width: 240, height: 180 }, VIEW, { side: 'below' });
    assert.deepEqual([p.left, p.top, p.side], [300, 200, 'below']);
  });
  it('a pop-out to the left of a row ends at the row and lines up with its top', () => {
    const p = placePlan(box(700, 100, 0, 0), { width: 250, height: 200 }, VIEW, { side: 'left' });
    assert.deepEqual([p.left, p.top, p.side], [450, 100, 'left']);
  });
});

describe('placePlan: flip', () => {
  it('a list above a button near the top opens below it', () => {
    const p = placePlan(box(400, 40, 40, 30), { width: 200, height: 150 }, VIEW, { side: 'above', gap: 10 });
    assert.deepEqual([p.top, p.side, p.maxHeight], [80, 'below', null]);
  });
  it('a menu at a point near the bottom opens above it', () => {
    const p = placePlan(box(300, 560, 0, 0), { width: 240, height: 180 }, VIEW, { side: 'below' });
    assert.deepEqual([p.top, p.side], [380, 'above']);
  });
  it('a pop-out with no room on the left opens to the right', () => {
    const p = placePlan(box(100, 100, 50, 0), { width: 250, height: 200 }, VIEW, { side: 'left', gap: 8 });
    assert.deepEqual([p.left, p.side], [158, 'right']);
  });
});

describe('placePlan: pinned with a max height', () => {
  it('a list taller than either side takes the side with more room, pinned at the margin, and scrolls', () => {
    const size = { width: 200, height: 500 };
    const p = placePlan(box(400, 350, 40, 30), size, VIEW, { side: 'below', gap: 4 });
    assert.equal(p.side, 'above');
    assert.equal(p.top, 8);
    assert.equal(p.maxHeight, 350 - 4 - 8);
    assert.ok(inside(p, size));
  });
  it('below wins when it has more room', () => {
    const size = { width: 200, height: 500 };
    const p = placePlan(box(400, 150, 40, 30), size, VIEW, { side: 'above', gap: 4 });
    assert.deepEqual([p.side, p.top, p.maxHeight], ['below', 184, 600 - 8 - 184]);
    assert.ok(inside(p, size));
  });
  it('with too little room on both sides it covers the anchor and takes the whole height', () => {
    const view = { left: 0, top: 0, right: 1000, bottom: 200 };
    const size = { width: 200, height: 400 };
    const p = placePlan(box(400, 80, 40, 40), size, view, { side: 'below' });
    assert.ok(Math.max(80 - 8, 200 - 8 - 120) < PLACE_MIN_ROOM);
    assert.deepEqual([p.top, p.maxHeight], [8, 184]);
    assert.ok(inside(p, size, view));
  });
  it('an anchor off the window still leaves the surface inside', () => {
    const size = { width: 300, height: 300 };
    const p = placePlan(box(-50, 700, 40, 40), size, VIEW, { side: 'below' });
    assert.ok(inside(p, size), JSON.stringify(p));
  });
});

describe('placePlan: across', () => {
  it('slides inside the right margin', () => {
    const p = placePlan(box(900, 100, 0, 0), { width: 240, height: 100 }, VIEW, { side: 'below' });
    assert.equal(p.left, 1000 - 8 - 240);
  });
  it('slides inside the left margin', () => {
    const p = placePlan(box(2, 100, 0, 0), { width: 240, height: 100 }, VIEW, { side: 'below' });
    assert.equal(p.left, 8);
  });
  it('centres on the anchor, and ends on its right edge', () => {
    assert.equal(placePlan(box(400, 300, 100, 20), { width: 60, height: 40 }, VIEW, { side: 'above', align: 'center' }).left, 420);
    assert.equal(placePlan(box(400, 300, 100, 20), { width: 60, height: 40 }, VIEW, { side: 'above', align: 'end' }).left, 440);
  });
  it('one wider than the window is pinned and capped', () => {
    const p = placePlan(box(400, 100, 0, 0), { width: 1200, height: 100 }, VIEW, { side: 'below' });
    assert.deepEqual([p.left, p.maxWidth], [8, 984]);
  });
  it('a side placement clamps its top the same way', () => {
    const p = placePlan(box(700, 560, 0, 0), { width: 250, height: 200 }, VIEW, { side: 'left' });
    assert.equal(p.top, 600 - 8 - 200);
  });
  it('keeps a wider margin when asked', () => {
    const p = placePlan(box(990, 100, 0, 0), { width: 100, height: 50 }, VIEW, { side: 'below', margin: 12 });
    assert.equal(p.left, 1000 - 12 - 100);
  });
});

describe('placeWindowFit: a free window kept inside', () => {
  it('a window that fits keeps its place and size', () => {
    const f = placeWindowFit({ left: 90, top: 40, width: 560, height: 400 }, VIEW);
    assert.deepEqual([f.left, f.top, f.width, f.height], [90, 40, 560, 400]);
    assert.deepEqual([f.maxWidth, f.maxHeight], [1000 - 8 - 90, 600 - 8 - 40]);
  });
  it('a window past the bottom-right comes back, its corner on screen', () => {
    const f = placeWindowFit({ left: 800, top: 500, width: 560, height: 400 }, VIEW);
    assert.deepEqual([f.left, f.top], [1000 - 8 - 560, 600 - 8 - 400]);
  });
  it('a window larger than the view shrinks to it, its header at the margin', () => {
    const f = placeWindowFit({ left: 300, top: -20, width: 1400, height: 900 }, VIEW, { minWidth: 300, minHeight: 220 });
    assert.deepEqual([f.left, f.top, f.width, f.height], [8, 8, 984, 584]);
  });
  it('never shrinks under its minimum while the room allows it', () => {
    const f = placeWindowFit({ left: 10, top: 10, width: 100, height: 100 }, VIEW, { minWidth: 300, minHeight: 220 });
    assert.deepEqual([f.width, f.height], [300, 220]);
  });
  it('a view narrower than the minimum wins over it', () => {
    const f = placeWindowFit({ left: 10, top: 10, width: 400, height: 300 }, { left: 0, top: 0, right: 250, bottom: 200 }, { minWidth: 300, minHeight: 220 });
    assert.deepEqual([f.width, f.height], [234, 184]);
  });
});
