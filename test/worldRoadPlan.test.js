'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/world/worldRoadPlan.js');

const road = (extra) => ({ name: 'Old Road', vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }], ...extra });
const square = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }];

describe('wrCleanRoad', () => {
  it('keeps a good road with two open ends', () => {
    const c = R.wrCleanRoad(road());
    assert.equal(c.name, 'Old Road');
    assert.deepEqual(c.ends, [{ kind: null }, { kind: null }]);
    assert.deepEqual(c.scenes, []);
  });

  it('refuses fewer than two points, a bad point, or a thing that is not a road', () => {
    assert.equal(R.wrCleanRoad(road({ vertices: [{ x: 1, y: 1 }] })), null);
    assert.equal(R.wrCleanRoad(road({ vertices: [{ x: 1, y: 1 }, { x: NaN, y: 2 }] })), null);
    assert.equal(R.wrCleanRoad(road({ vertices: [{ x: 1, y: 1 }, { x: '2', y: 2 }] })), null);
    assert.equal(R.wrCleanRoad(null), null);
    assert.equal(R.wrCleanRoad([]), null);
  });

  it('turns a name that is not text into an empty one', () => {
    assert.equal(R.wrCleanRoad(road({ name: 5 })).name, '');
  });

  it('opens an end that names nothing it can use', () => {
    const c = R.wrCleanRoad(road({ ends: [{ kind: 'scene' }, { kind: 'place', ref: 'Vallaki' }] }));
    assert.deepEqual(c.ends, [{ kind: null }, { kind: null }]);
  });

  it('keeps a scene end and a place end with its spot', () => {
    const c = R.wrCleanRoad(road({ ends: [{ kind: 'scene', ref: 'a' }, { kind: 'place', ref: 'Vallaki', dx: 4, dy: -3 }] }));
    assert.deepEqual(c.ends[0], { kind: 'scene', ref: 'a' });
    assert.deepEqual(c.ends[1], { kind: 'place', ref: 'Vallaki', dx: 4, dy: -3 });
  });

  it('keeps each scene once, with t held between 0 and 1', () => {
    const c = R.wrCleanRoad(road({ scenes: [{ id: 'a', t: 0.4 }, { id: 'a', t: 0.9 }, { id: 'b', t: 3 }, { id: 'c', t: 'x' }, { t: 0.1 }] }));
    assert.deepEqual(c.scenes, [{ id: 'a', t: 0.4 }, { id: 'b', t: 1 }]);
  });

  it('drops handles that do not match the points', () => {
    assert.equal(R.wrCleanRoad(road({ handles: [null] })).handles, undefined);
    const c = R.wrCleanRoad(road({ handles: [{ ix: 0, iy: 0, ox: 10, oy: 5 }, null] }));
    assert.deepEqual(c.handles[0], { ix: 0, iy: 0, ox: 10, oy: 5 });
  });
});

describe('wrParseRoads', () => {
  it('answers nothing for a file with no roads', () => {
    assert.equal(Object.keys(R.wrParseRoads(null).roads).length, 0);
    assert.equal(R.wrParseRoads('{"notes":"x"}').broken, false);
    assert.equal(R.wrParseRoads('not json').broken, false);
  });

  it('reads each good road and reports a bad one', () => {
    const raw = JSON.stringify({ roads: { r1: road(), r2: { vertices: [] } } });
    const p = R.wrParseRoads(raw);
    assert.deepEqual(Object.keys(p.roads), ['r1']);
    assert.equal(p.broken, true);
  });

  it('calls roads that are not a plain object broken', () => {
    assert.equal(R.wrParseRoads('{"roads":[1]}').broken, true);
    assert.equal(R.wrParseRoads('{"roads":5}').broken, true);
  });

  it('reads a road called constructor as an ordinary road', () => {
    const p = R.wrParseRoads(JSON.stringify({ roads: { constructor: road() } }));
    assert.deepEqual(Object.keys(p.roads), ['constructor']);
  });
});

describe('wrNewUid', () => {
  it('never answers a key already taken', () => {
    const taken = Object.create(null);
    const seen = new Set();
    for (let i = 0; i < 200; i++) { const u = R.wrNewUid(taken); assert.ok(!seen.has(u)); seen.add(u); taken[u] = true; }
  });
});

describe('line geometry', () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];

  it('finds the point a fraction along the length', () => {
    assert.deepEqual(R.wrPointAt(pts, 0), { x: 0, y: 0 });
    assert.deepEqual(R.wrPointAt(pts, 0.5), { x: 100, y: 0 });
    assert.deepEqual(R.wrPointAt(pts, 0.75), { x: 100, y: 50 });
    assert.deepEqual(R.wrPointAt(pts, 1), { x: 100, y: 100 });
  });

  it('finds the nearest point with its t', () => {
    const n = R.wrNearest(pts, { x: 50, y: 20 });
    assert.deepEqual([n.x, n.y, n.t, n.d], [50, 0, 0.25, 20]);
  });

  it('snaps to the nearest road inside the distance, and to none beyond it', () => {
    const lines = [{ uid: 'a', pts }, { uid: 'b', pts: [{ x: 0, y: 50 }, { x: 40, y: 50 }] }];
    assert.equal(R.wrSnap(lines, { x: 20, y: 44 }, 10).uid, 'b');
    assert.equal(R.wrSnap(lines, { x: 50, y: 30 }, 10), null);
  });

  it('samples a curved segment and leaves a straight one alone', () => {
    const straight = R.wrCleanRoad(road());
    assert.equal(R.wrSamples(straight).length, 2);
    const bent = R.wrCleanRoad(road({ handles: [{ ix: 0, iy: 0, ox: 30, oy: 40 }, null] }));
    const s = R.wrSamples(bent);
    assert.ok(s.length > 4);
    assert.deepEqual(s[s.length - 1], { x: 100, y: 0 });
    assert.ok(s.some(p => p.y > 5), 'the line leaves the chord');
  });

  it('writes the path with a cubic only where a segment bends', () => {
    assert.equal(R.wrSvgPath(R.wrCleanRoad(road())), 'M0 0L100 0');
    const bent = R.wrCleanRoad(road({ handles: [{ ix: 0, iy: 0, ox: 30, oy: 40 }, null] }));
    assert.equal(R.wrSvgPath(bent), 'M0 0C30 40 100 0 100 0');
  });
});

describe('ends follow what they stick to', () => {
  const ctx = {
    scene: id => (id === 'a' ? { x: 500, y: 40 } : null),
    place: name => (name === 'Vallaki' ? square : null),
  };

  it('puts a scene end on the scene', () => {
    const r = R.wrCleanRoad(road({ ends: [{ kind: 'scene', ref: 'a' }, { kind: null }] }));
    assert.deepEqual(R.wrFollow(r, ctx)[0], { x: 500, y: 40 });
  });

  it('keeps a place end at its spot when the place moves', () => {
    const r = R.wrCleanRoad(road({ vertices: [{ x: 0, y: 0 }, { x: 130, y: 90 }], ends: [{ kind: null }, { kind: 'place', ref: 'Vallaki', dx: 30, dy: -10 }] }));
    assert.deepEqual(R.wrEndPos(r.ends[1], ctx), { x: 130, y: 90 });
    const moved = { ...ctx, place: () => square.map(p => ({ x: p.x + 1000, y: p.y })) };
    assert.deepEqual(R.wrFollow(r, moved)[1], { x: 1130, y: 90 });
  });

  it('moves a spot a reshape left outside the place to the nearest point of the outline', () => {
    const e = { kind: 'place', ref: 'Vallaki', dx: 400, dy: 0 };
    assert.deepEqual(R.wrEndPos(e, ctx), { x: 200, y: 100 });
  });

  it('keeps the last spot of an end whose thing is gone', () => {
    const r = R.wrCleanRoad(road({ ends: [{ kind: 'scene', ref: 'gone' }, { kind: 'place', ref: 'Nowhere', dx: 0, dy: 0 }] }));
    assert.equal(R.wrFollow(r, ctx), r.vertices);
  });

  it('does not copy the points when nothing moved', () => {
    const r = R.wrCleanRoad(road({ vertices: [{ x: 500, y: 40 }, { x: 9, y: 9 }], ends: [{ kind: 'scene', ref: 'a' }, { kind: null }] }));
    assert.equal(R.wrFollow(r, ctx), r.vertices);
  });

  it('says an end was dragged off its anchor', () => {
    const r = R.wrCleanRoad(road({ ends: [{ kind: 'scene', ref: 'a' }, { kind: null }] }));
    assert.equal(R.wrEndMoved(r, 0, ctx), true);
    assert.equal(R.wrEndMoved(r, 1, ctx), false);
  });
});

describe('wrAttachAt', () => {
  const ctx = {
    sceneAt: p => (Math.hypot(p.x - 500, p.y - 40) < 20 ? 'a' : ''),
    placeAt: p => (p.x >= 0 && p.x <= 200 && p.y >= 0 && p.y <= 200 ? { name: 'Vallaki', outline: square } : null),
  };

  it('sticks to a scene first', () => {
    assert.deepEqual(R.wrAttachAt({ x: 505, y: 40 }, ctx), { kind: 'scene', ref: 'a' });
  });

  it('sticks to the place under the click, keeping the spot against its centre', () => {
    assert.deepEqual(R.wrAttachAt({ x: 130, y: 90 }, ctx), { kind: 'place', ref: 'Vallaki', dx: 30, dy: -10 });
  });

  it('leaves an end on bare ground open', () => {
    assert.deepEqual(R.wrAttachAt({ x: 900, y: 900 }, ctx), { kind: null });
  });
});

describe('what happens to a road when its world changes', () => {
  const r = R.wrCleanRoad(road({
    ends: [{ kind: 'scene', ref: 'a' }, { kind: 'place', ref: 'Vallaki', dx: 1, dy: 2 }],
    scenes: [{ id: 'a', t: 0.5 }, { id: 'b', t: 0.7 }],
  }));

  it('opens the end of a deleted scene and drops it from the road', () => {
    const o = R.wrOpenEnds(r, 'scene', ['a']);
    assert.deepEqual(o.ends[0], { kind: null });
    assert.deepEqual(o.ends[1], r.ends[1]);
    assert.deepEqual(o.scenes, [{ id: 'b', t: 0.7 }]);
    assert.deepEqual(r.ends[0], { kind: 'scene', ref: 'a' }, 'the original is untouched');
  });

  it('opens the end of a deleted place and keeps the scenes', () => {
    const o = R.wrOpenEnds(r, 'place', ['Vallaki']);
    assert.deepEqual(o.ends[1], { kind: null });
    assert.equal(o.scenes.length, 2);
  });

  it('follows a place that is renamed', () => {
    assert.equal(R.wrRenamePlace(r, 'Vallaki', 'Krezk').ends[1].ref, 'Krezk');
    assert.equal(R.wrRenamePlace(r, 'Other', 'Krezk').ends[1].ref, 'Vallaki');
  });

  it('remaps scenes to their restored copies and shifts the line', () => {
    const m = R.wrRemap(r, { a: 'A2', b: 'B2' }, { Vallaki: true }, 1000, 50);
    assert.deepEqual(m.vertices[0], { x: 1000, y: 50 });
    assert.deepEqual(m.ends[0], { kind: 'scene', ref: 'A2' });
    assert.deepEqual(m.ends[1], r.ends[1]);
    assert.deepEqual(m.scenes, [{ id: 'A2', t: 0.5 }, { id: 'B2', t: 0.7 }]);
  });

  it('opens an end on a scene that did not come back or a place the DM already had', () => {
    const m = R.wrRemap(r, { b: 'B2' }, {}, 0, 0);
    assert.deepEqual(m.ends, [{ kind: null }, { kind: null }]);
    assert.deepEqual(m.scenes, [{ id: 'B2', t: 0.7 }]);
  });
});

describe('drawing helpers', () => {
  it('locks a direction to the nearest 45 degrees and keeps the distance', () => {
    const a = R.wrLockAngle({ x: 0, y: 0 }, { x: 100, y: 10 });
    assert.ok(Math.abs(a.x - Math.hypot(100, 10)) < 1e-9 && Math.abs(a.y) < 1e-9, 'a near-horizontal line goes flat');
    const b = R.wrLockAngle({ x: 10, y: 10 }, { x: 60, y: 70 });
    assert.ok(Math.abs((b.x - 10) - (b.y - 10)) < 1e-9, 'a near-diagonal line goes diagonal');
    assert.deepEqual(R.wrLockAngle({ x: 5, y: 5 }, { x: 5, y: 5 }), { x: 5, y: 5 });
  });

  it('offers only an open end within reach', () => {
    const roads = [
      { uid: 'a', vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }], ends: [{ kind: null }, { kind: 'scene', ref: 's' }] },
      { uid: 'b', vertices: [{ x: 0, y: 50 }, { x: 40, y: 90 }], ends: [{ kind: 'place', ref: 'P', dx: 0, dy: 0 }, { kind: null }] },
    ];
    assert.deepEqual(R.wrEndNear(roads, { x: 3, y: 2 }, 10), { uid: 'a', k: 0 });
    assert.equal(R.wrEndNear(roads, { x: 98, y: 0 }, 10), null, 'an end on a scene is not offered');
    assert.equal(R.wrEndNear(roads, { x: 2, y: 50 }, 10), null, 'an end on a place is not offered');
    assert.deepEqual(R.wrEndNear(roads, { x: 40, y: 88 }, 10), { uid: 'b', k: 1 });
    assert.equal(R.wrEndNear(roads, { x: 500, y: 500 }, 10), null);
  });

  it('walks a road the other way with its handles, ends and scenes', () => {
    const r = R.wrCleanRoad(road({
      vertices: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }],
      handles: [{ ix: 0, iy: 0, ox: 5, oy: 6 }, null, { ix: 7, iy: 8, ox: 0, oy: 0 }],
      ends: [{ kind: 'scene', ref: 'a' }, { kind: null }], scenes: [{ id: 'm', t: 0.25 }],
    }));
    const v = R.wrReverse(r);
    assert.deepEqual(v.vertices.map(p => p.x), [100, 50, 0]);
    assert.deepEqual(v.ends, [{ kind: null }, { kind: 'scene', ref: 'a' }]);
    assert.deepEqual(v.scenes, [{ id: 'm', t: 0.75 }]);
    assert.deepEqual(v.handles[0], { ix: 0, iy: 0, ox: 7, oy: 8 });
    assert.deepEqual(v.handles[2], { ix: 5, iy: 6, ox: 0, oy: 0 });
    assert.deepEqual(R.wrReverse(v).vertices, r.vertices, 'reversing twice is the road again');
  });
});

describe('a road that enters a place', () => {
  const ring = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }];
  const ctx = { place: () => ring, scene: () => null };
  // From inside the square out to the right.
  const out = (extra) => R.wrCleanRoad({ name: 'r', vertices: [{ x: 100, y: 100 }, { x: 400, y: 100 }], ends: [{ kind: 'place', ref: 'P', dx: 0, dy: 0 }, { kind: null }], ...extra });

  it('finds where the line leaves the place', () => {
    assert.equal(R.wrLeaves([{ x: 100, y: 100 }, { x: 400, y: 100 }], ring), 100);
    assert.equal(R.wrLeaves([{ x: 100, y: 100 }, { x: 150, y: 100 }], ring), null);
  });

  it('cuts the drawn line at the outline', () => {
    const v = R.wrVisible(out(), ctx);
    assert.deepEqual(v[0], { x: 200, y: 100 });
    assert.deepEqual(v[v.length - 1], { x: 400, y: 100 });
  });

  it('cuts the far end too when both ends enter places', () => {
    const r = out({ vertices: [{ x: 100, y: 100 }, { x: 600, y: 100 }, { x: 900, y: 100 }], ends: [{ kind: 'place', ref: 'A', dx: 0, dy: 0 }, { kind: 'place', ref: 'B', dx: 0, dy: 0 }] });
    const rings = { A: ring, B: ring.map(p => ({ x: p.x + 800, y: p.y })) };
    const v = R.wrVisible(r, { place: n => rings[n], scene: () => null });
    assert.deepEqual([v[0].x, v[v.length - 1].x], [200, 800]);
  });

  it('draws the line whole when nothing is cut', () => {
    assert.equal(R.wrVisible(out({ ends: [{ kind: null }, { kind: null }] }), ctx), null);
    assert.equal(R.wrVisible(out({ vertices: [{ x: 50, y: 50 }, { x: 150, y: 150 }] }), ctx), null, 'a line that stays inside is kept');
  });

  it('slices a line by distance and writes it as a path', () => {
    const s = R.wrSlice([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 50, 150);
    assert.deepEqual(s, [{ x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }]);
    assert.equal(R.wrPolylinePath(s), 'M50 0L100 0L100 50');
  });
});

describe('a road with a rounded corner', () => {
  const bend = (extra) => R.wrCleanRoad({ name: 'r', vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], ...extra });

  it('keeps radii that match the points and drops the rest', () => {
    assert.deepEqual(bend({ cornerRadii: [null, 20, null] }).cornerRadii, [null, 20, null]);
    assert.equal(bend({ cornerRadii: [null, 20] }).cornerRadii, undefined);
    assert.equal(bend({ cornerRadii: [null, -1, null] }).cornerRadii, undefined);
    assert.equal(bend({ cornerRadii: [null, null, null] }).cornerRadii, undefined);
    assert.equal(bend({ cornerRadius: 12 }).cornerRadius, 12);
  });

  it('cuts the corner off the line and keeps both ends where they are', () => {
    const r = bend({ cornerRadii: [null, 20, null] }), s = R.wrSamples(r);
    assert.deepEqual(s[0], { x: 0, y: 0 });
    assert.deepEqual(s[s.length - 1], { x: 100, y: 100 });
    assert.ok(s.every(p => Math.hypot(p.x - 100, p.y - 0) > 8), 'no point sits on the sharp corner');
    assert.ok(s.every(p => p.x <= 100 + 1e-9 && p.y >= -1e-9), 'the arc stays inside the turn');
    assert.ok(s.some(p => Math.abs(p.x - 80) < 1e-6 && Math.abs(p.y) < 1e-6), 'the arc starts a radius short of the corner');
    assert.ok(R.wrLength(s) < 200, 'a rounded corner is shorter than a sharp one');
  });

  it('draws a road with no rounding as it always did', () => {
    assert.equal(R.wrSamples(bend()).length, 3);
    assert.equal(R.wrSvgPath(bend()), 'M0 0L100 0L100 100');
    assert.ok(R.wrRounded(bend({ cornerRadius: 10 })));
    assert.ok(!R.wrRounded(bend({ cornerRadii: [5, null, 5] })), 'an end has no corner to round');
  });

  it('writes a rounded road as a path of its sampled points', () => {
    const d = R.wrSvgPath(bend({ cornerRadius: 20 }));
    assert.ok(d.startsWith('M0 0L') && d.split('L').length > 6 && !/C/.test(d));
  });

  it('rounds a corner between curved walls without leaving the ends', () => {
    const r = bend({ cornerRadii: [null, 15, null], handles: [{ ix: 0, iy: 0, ox: 20, oy: 10 }, null, null] }), s = R.wrSamples(r);
    assert.deepEqual(s[0], { x: 0, y: 0 });
    assert.deepEqual(s[s.length - 1], { x: 100, y: 100 });
    assert.ok(s.length > 14);
  });

  it('walks the radii the other way when the road is reversed', () => {
    assert.deepEqual(R.wrReverse(bend({ cornerRadii: [null, 20, null] })).cornerRadii, [null, 20, null]);
    const four = R.wrCleanRoad({ name: 'r', vertices: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 50 }], cornerRadii: [null, 5, 9, null] });
    assert.deepEqual(R.wrReverse(four).cornerRadii, [null, 9, 5, null]);
  });
});
