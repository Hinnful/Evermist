'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/ui/motionPlan.js');

const VALS = { scale: 0.96, window: 28, pane: 32, popup: 4, toast: 16 };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

describe('motionGeometry: where a surface grows from', () => {
  const surf = { x: 100, y: 50, w: 400, h: 300 };

  it('a window grows from its point nearest the trigger and shifts toward it', () => {
    const rail = { x: 900, y: 60, w: 60, h: 40 };   // to the right, level with the top
    const g = P.motionGeometry('window', surf, rail);
    assert.equal(g.ox, 400);                          // the right edge
    assert.equal(g.oy, 30);                           // level with the button's centre
    assert.ok(g.ux > 0.9 && g.uy < 0, 'shifts right and a little up: ' + JSON.stringify(g));
    assert.ok(near(Math.hypot(g.ux, g.uy), 1));
  });

  it('a menu grows from a point inside it, a pressed point on its corner', () => {
    const g = P.motionGeometry('menu', surf, { x: 100, y: 50, w: 0, h: 0 });
    assert.deepEqual([g.ox, g.oy], [0, 0]);
  });

  it('a dialog grows from the centre, whatever pressed it', () => {
    const g = P.motionGeometry('dialog', surf, { x: 0, y: 0, w: 10, h: 10 });
    assert.deepEqual(g, { ox: 200, oy: 150, ux: 0, uy: 0 });
  });

  it('a toast rises from below', () => {
    const g = P.motionGeometry('toast', surf, null);
    assert.deepEqual([g.ux, g.uy], [0, 1]);
  });

  it('a pane slides from the rail side, the right with no trigger', () => {
    assert.deepEqual(P.motionGeometry('pane', surf, null), { ox: 400, oy: 150, ux: 1, uy: 0 });
    assert.deepEqual(P.motionGeometry('pane', surf, { x: 0, y: 0, w: 10, h: 10 }), { ox: 0, oy: 150, ux: -1, uy: 0 });
  });

  it('a window opened from code with no trigger grows from its centre without a shift', () => {
    assert.deepEqual(P.motionGeometry('window', surf, null), { ox: 200, oy: 150, ux: 0, uy: 0 });
  });
});

describe('motionStates: rest, start and the way out', () => {
  const geo = { ox: 0, oy: 0, ux: 1, uy: 0 };

  it('a window starts 28px toward the trigger at .96 and leaves the same way', () => {
    const s = P.motionStates('window', VALS, geo);
    assert.deepEqual(s.rest, { tx: 0, ty: 0, s: 1, o: 1 });
    assert.deepEqual(s.start, { tx: 28, ty: 0, s: 0.96, o: 0 });
    assert.deepEqual(s.end, s.start);
  });

  it('a menu only grows, never from scale 0, and leaves half the way', () => {
    const s = P.motionStates('menu', VALS, geo);
    assert.equal(s.start.tx, 0);
    assert.equal(s.start.s, 0.96);
    assert.ok(near(s.end.s, 0.98));
    assert.equal(s.start.o, 1, 'a menu is there at once: a fade on something that small reads as a delay');
    assert.equal(s.end.o, 0, 'it still fades on the way out');
    assert.equal(P.motionStates('window', VALS, geo).start.o, 0, 'a window fades in');
  });

  it('a pane slides without a scale', () => {
    const s = P.motionStates('pane', VALS, geo);
    assert.deepEqual(s.start, { tx: 32, ty: 0, s: 1, o: 0 });
  });

  it('a toast rises 16px and leaves 8px', () => {
    const s = P.motionStates('toast', VALS, { ox: 0, oy: 0, ux: 0, uy: 1 });
    assert.equal(s.start.ty, 16);
    assert.equal(s.end.ty, 8);
  });
});

describe('motionOpacityMs: opacity on its own line', () => {
  it('is done by a third of the movement on the way in, and runs the whole way out', () => {
    assert.equal(P.motionOpacityMs(150, true, true), 50);
    assert.equal(P.motionOpacityMs(160, false, true), 160);
    assert.equal(P.motionOpacityMs(120, true, false), 120);
  });
});

describe('motionCurve: a CSS curve read at a moment', () => {
  it('meets both ends and reads the enter curve as fast first', () => {
    const enter = P.motionCurve('cubic-bezier(0, 0, 0, 1)');
    assert.equal(enter(0), 0);
    assert.equal(enter(1), 1);
    assert.ok(enter(0.25) > 0.6, 'the enter curve is most of the way there a quarter in: ' + enter(0.25));
    const exit = P.motionCurve('cubic-bezier(0, 0, .2, 1)');
    assert.ok(exit(0.25) > 0.5, 'the exit curve starts at once too, or closing reads as lag: ' + exit(0.25));
  });

  it('reads anything else as the straight line', () => {
    assert.equal(P.motionCurve('linear')(0.3), 0.3);
  });

  it('never bounces: no point overshoots either end', () => {
    for (const css of ['cubic-bezier(0, 0, 0, 1)', 'cubic-bezier(0, 0, .2, 1)']) {
      const f = P.motionCurve(css);
      for (let t = 0; t <= 1; t += 0.02) assert.ok(f(t) >= -1e-9 && f(t) <= 1 + 1e-9, css + ' at ' + t);
    }
  });
});

describe('motionAt and motionReverseMs: a surface turned back', () => {
  const a = { tx: 28, ty: 0, s: 0.96, o: 0 }, b = { tx: 0, ty: 0, s: 1, o: 1 }, lin = (t) => t;

  it('stands part way along at a moment, opacity on its own time', () => {
    const at = P.motionAt(a, b, lin, 200, 100, 50);
    assert.equal(at.tx, 21);
    assert.ok(near(at.s, 0.97));
    assert.equal(at.o, 0.5);
    assert.deepEqual(P.motionAt(a, b, lin, 200, 100, 500), b);
    const fast = P.motionCurve('cubic-bezier(0, 0, .2, 1)');
    assert.ok(P.motionAt(b, a, lin, 200, 200, 50, fast).o < 0.5, 'closing, opacity reads off the exit curve and is mostly gone a quarter in');
  });

  it('takes the other direction\'s time for the part it covered', () => {
    assert.equal(P.motionReverseMs(160, 110, 220), 80);   // half way in, half the way out
    assert.equal(P.motionReverseMs(160, 300, 220), 160);  // finished: the whole way
    assert.equal(P.motionReverseMs(160, 0, 220), 1);      // never zero
  });
});
