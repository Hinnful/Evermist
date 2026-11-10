'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/cursor/companionLogic.js');

const DT = 1 / 60;
const W = 1000, H = 700;
// A companion that has seen one frame, so it is ready, with a fixed random source.
function make(kind) {
  const s = C.cmpCreate(() => 0.5);
  C.cmpStep(s, DT, { cx: 300, cy: 300, kind: kind || 'arrow', w: W, h: H });
  return s;
}
const run = (s, secs, inp) => { for (let t = 0; t < secs; t += DT) C.cmpStep(s, DT, Object.assign({ cx: 300, cy: 300, kind: 'arrow', w: W, h: H }, inp)); };

describe('companionLogic: shapes', () => {
  it('has twelve points in every shape', () => {
    for (const [name, pts] of Object.entries(C.CMP_SHAPES)) assert.equal(pts.length, C.CMP_N, name);
  });
  it('rests as the tall gem, ten up and 9.6 down', () => {
    const r = C.CMP_SHAPES.rest;
    assert.ok(Math.abs(r[0][1] + 10) < 1e-9);
    assert.ok(Math.abs(r[6][1] - 9.6) < 1e-9);
  });
  it('collapses to a dot', () => {
    for (const p of C.CMP_SHAPES.collapse) assert.ok(Math.abs(Math.hypot(p[0], p[1]) - 0.6) < 1e-9);
  });
});

describe('companionLogic: the shape for each moment', () => {
  const sh = (over, kind, sp) => C.cmpShapeFor(Object.assign({ present: true, mood: 'idle', pop: 0 }, over), kind, sp || 0);
  it('collapses when the pointer has left', () => assert.equal(sh({ present: false }, 'arrow'), 'collapse'));
  it('puts moods before tools', () => {
    assert.equal(sh({ mood: 'angry' }, 'crosshair'), 'angry');
    assert.equal(sh({ mood: 'dizzy' }, 'crosshair'), 'rest');
    assert.equal(sh({ mood: 'asleep' }, 'arrow'), 'asleep');
    assert.equal(sh({ mood: 'busy' }, 'text'), 'busy');
  });
  it('snaps to a diamond on a click', () => assert.equal(sh({ pop: 0.2 }, 'crosshair'), 'click'));
  it('echoes the tool', () => {
    for (const k of ['text', 'crosshair', 'move', 'ew', 'ns', 'nwse', 'nesw', 'col', 'rotate', 'grab', 'grabbing']) assert.equal(sh({}, k), k);
  });
  it('blooms over a button, darts while following fast, rests otherwise', () => {
    assert.equal(sh({}, 'pointer'), 'happy');
    assert.equal(sh({}, 'arrow', 200), 'moving');
    assert.equal(sh({}, 'arrow', 100), 'rest');
  });
});

describe('companionLogic: where it hovers', () => {
  it('sits right of a dart, above-right of a centred kind, further off a precise one', () => {
    assert.deepEqual(C.cmpOffset('arrow', 300, 300, W, H), [17, -3]);
    assert.deepEqual(C.cmpOffset('text', 300, 300, W, H), [12, -12]);
    assert.deepEqual(C.cmpOffset('crosshair', 300, 300, W, H), [16, -16]);
  });
  it('hops left at the right edge, below at the top, above at the bottom', () => {
    assert.deepEqual(C.cmpOffset('arrow', W - 10, 300, W, H), [-23, -3]);
    assert.deepEqual(C.cmpOffset('crosshair', 300, 10, W, H), [16, 36]);
    assert.deepEqual(C.cmpOffset('arrow', 300, H - 5, W, H), [17, -13]);
  });
  it('follows the pointer closely', () => {
    const s = make();
    run(s, 0.5, { cx: 500, cy: 400 });
    assert.ok(Math.hypot(s.x - 517, s.y - 397) < 3, s.x + ',' + s.y);
  });
});

describe('companionLogic: clicks', () => {
  const clicks = (s, n, onEmpty, gap) => { for (let i = 0; i < n; i++) { C.cmpClick(s, onEmpty); run(s, gap || 0.1); } };
  it('is angered by six fast clicks on empty space', () => {
    const s = make();
    clicks(s, 6, true);
    assert.ok(s.anger > 0);
    assert.equal(s.mood, 'angry');
  });
  it('is not angered by five', () => {
    const s = make();
    clicks(s, 5, true);
    assert.equal(s.anger, 0);
  });
  it('is not angered by fast clicks on a room or a handle, and one of those resets the count', () => {
    const s = make();
    clicks(s, 8, false);
    assert.equal(s.anger, 0);
    clicks(s, 5, true);
    clicks(s, 1, false);
    clicks(s, 1, true);
    assert.equal(s.anger, 0);
  });
  it('is not angered by six slow ones', () => {
    const s = make();
    clicks(s, 6, true, 0.4);
    assert.equal(s.anger, 0);
  });
  it('cools down eight seconds before the next anger', () => {
    const s = make();
    clicks(s, 6, true);
    run(s, 3);
    assert.equal(s.mood, 'idle');
    clicks(s, 6, true);
    assert.equal(s.anger, 0);
    run(s, 5);
    clicks(s, 6, true);
    assert.ok(s.anger > 0);
  });
  it('pops on a click it is not angered by', () => {
    const s = make();
    C.cmpClick(s, false);
    assert.ok(s.pop > 0.2);
  });
});

describe('companionLogic: shake, hover, nap, busy', () => {
  // The pointer swept left and right, `n` reversals at 0.12 s apart.
  const shake = (s, n) => { for (let i = 0; i <= n; i++) run(s, 0.12, { cx: i % 2 ? 400 : 200 }); };
  it('gets dizzy on five fast reversals, and cools down six seconds', () => {
    const s = make();
    shake(s, 7);
    assert.equal(s.lastDizzy > 0, true);
    const first = s.lastDizzy;
    run(s, 2);
    shake(s, 7);
    assert.equal(s.lastDizzy, first);
    run(s, 5);
    shake(s, 7);
    assert.ok(s.lastDizzy > first);
  });
  it('pops once on reaching a button, then not again within 1.5 s', () => {
    const s = make();
    run(s, 0.1, { kind: 'pointer' });
    const at = s.lastHappy;
    assert.ok(at > 0);
    run(s, 0.3); run(s, 0.1, { kind: 'pointer' });
    assert.equal(s.lastHappy, at);
    run(s, 1.5); run(s, 0.1, { kind: 'pointer' });
    assert.ok(s.lastHappy > at);
  });
  it('naps after 25 s still on the arrow, and wakes when the pointer moves', () => {
    const s = make();
    run(s, 24);
    assert.notEqual(s.mood, 'asleep');
    run(s, 1.5);
    assert.equal(s.mood, 'asleep');
    run(s, 0.1, { cx: 400 });
    assert.notEqual(s.mood, 'asleep');
  });
  it('never naps holding a tool', () => {
    const s = make('crosshair');
    run(s, 30, { kind: 'crosshair' });
    assert.notEqual(s.mood, 'asleep');
  });
  it('works while busy, and anger outranks it', () => {
    const s = make();
    s.busy = true;
    run(s, 0.1);
    assert.equal(s.mood, 'busy');
    for (let i = 0; i < 6; i++) { C.cmpClick(s, true); run(s, 0.1); }
    assert.equal(s.mood, 'angry');
  });
});

describe('companionLogic: arriving, leaving, hiding, stillness', () => {
  it('arrives from nothing and leaves to nothing', () => {
    const s = make();
    C.cmpEnter(s);
    assert.equal(s.vis, 0);
    run(s, 0.6);
    assert.ok(s.vis > 0.99);
    C.cmpLeave(s);
    assert.equal(C.cmpGone(s), false);
    run(s, 0.6);
    assert.equal(C.cmpGone(s), true);
    assert.equal(s.shape, 'collapse');
  });
  it('hides while the cursor is none, and comes back', () => {
    const s = make();
    run(s, 0.1, { kind: 'none' });
    assert.equal(s.hidden, true);
    run(s, 0.1);
    assert.equal(s.hidden, false);
  });
  it('under reduced motion keeps the rest shape and sits exactly at its offset', () => {
    const s = make();
    run(s, 0.3, { cx: 500, cy: 400, kind: 'crosshair', still: true });
    assert.deepEqual(s.verts, C.CMP_SHAPES.rest.map(p => [...p]));
    assert.equal(s.x, 516);
    assert.equal(s.y, 384);
    assert.equal(s.mAng, 0);
    assert.equal(s.tilt, 0);
    for (let i = 0; i < 6; i++) { C.cmpClick(s, true); run(s, 0.1, { still: true }); }
    assert.equal(s.sq, 0);
    assert.deepEqual(s.verts, C.CMP_SHAPES.rest.map(p => [...p]));
  });
});
