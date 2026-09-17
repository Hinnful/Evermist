const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  encodeShapeForSave, decodeShapeFromSave,
  splitCubic, sampleCubic, edgeCubic, edgeIsCurved, handleAt, flattenRing, scaleHandles, shapeBBox,
  buildRoundedPolyPath,
} = require('../src/fogGeometry.js');
const {
  subCubic, wallParamAt, wallOf, flattenShapeForClip, restoreShapeDetail, restoreGroupDetail,
} = require('../src/shapeDetail.js');

const rect = (x1, y1, x2, y2) =>
  [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];

const H = (ix, iy, ox, oy) => ({ ix, iy, ox, oy });
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-9 : eps);

// A square whose top wall bows upward: vertex 0 pushes out, vertex 1 pulls in.
function bowedSquare() {
  return {
    vertices: rect(0, 0, 100, 100),
    handles: [H(0, 0, 0, -40), H(0, -40, 0, 0), null, null],
  };
}

function cubicAt(c, t) {
  const u = 1 - t;
  return {
    x: u * u * u * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t * t * t * c[3].x,
    y: u * u * u * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t * t * t * c[3].y,
  };
}

describe('splitCubic', () => {
  const c = [{ x: 0, y: 0 }, { x: 0, y: 30 }, { x: 60, y: 30 }, { x: 60, y: 0 }];

  it('cuts at the point the curve actually passes through', () => {
    const s = splitCubic(c[0], c[1], c[2], c[3], 0.5);
    const want = cubicAt(c, 0.5);
    assert.ok(near(s.mid.x, want.x) && near(s.mid.y, want.y));
  });

  it('gives two halves that trace the same curve as the whole', () => {
    const s = splitCubic(c[0], c[1], c[2], c[3], 0.4);
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const left = cubicAt(s.left, u);
      const want = cubicAt(c, 0.4 * u);
      assert.ok(near(left.x, want.x, 1e-9) && near(left.y, want.y, 1e-9), 'left half at ' + u);
      const right = cubicAt(s.right, u);
      const want2 = cubicAt(c, 0.4 + 0.6 * u);
      assert.ok(near(right.x, want2.x, 1e-9) && near(right.y, want2.y, 1e-9), 'right half at ' + u);
    }
  });
});

describe('subCubic', () => {
  const c = [{ x: 0, y: 0 }, { x: 10, y: 40 }, { x: 50, y: 40 }, { x: 60, y: 0 }];

  it('is the stretch of curve between the two parameters, to the last decimal', () => {
    const sub = subCubic(c, 0.3, 0.8);
    for (const u of [0, 0.3, 0.6, 1]) {
      const got = cubicAt(sub, u);
      const want = cubicAt(c, 0.3 + 0.5 * u);
      assert.ok(near(got.x, want.x, 1e-8) && near(got.y, want.y, 1e-8), 'at ' + u);
    }
  });

  it('answers the whole curve when asked for all of it', () => {
    const sub = subCubic(c, 0, 1);
    for (let k = 0; k < 4; k++) {
      assert.ok(near(sub[k].x, c[k].x, 1e-9) && near(sub[k].y, c[k].y, 1e-9));
    }
  });

  it('collapses to a point when the two parameters do not span anything', () => {
    const sub = subCubic(c, 0.5, 0.5);
    assert.deepEqual(sub[0], c[0]);
  });
});

describe('edgeIsCurved', () => {
  it('reads an outgoing handle on the near anchor and an incoming one on the far', () => {
    assert.equal(edgeIsCurved([H(0, 0, 3, 0), null], 0, 1), true);
    assert.equal(edgeIsCurved([null, H(0, 4, 0, 0)], 0, 1), true);
    assert.equal(edgeIsCurved([H(5, 0, 0, 0), H(0, 0, 0, 7)], 0, 1), false);
    assert.equal(edgeIsCurved(null, 0, 1), false);
  });
});

describe('handleAt', () => {
  it('reads an all-zero record as no handle at all', () => {
    assert.equal(handleAt([H(0, 0, 0, 0)], 0), null);
    assert.ok(handleAt([H(0, 0, 0, 1)], 0));
    assert.equal(handleAt(null, 0), null);
  });
});

describe('scaleHandles', () => {
  it('scales both control points, because they are offsets from their anchor', () => {
    const out = scaleHandles([H(2, 4, 6, 8), null], 0.5);
    assert.deepEqual(out[0], { ix: 1, iy: 2, ox: 3, oy: 4 });
    assert.equal(out[1], null);
  });

  it('answers null for a shape that has no handles', () => {
    assert.equal(scaleHandles(null, 2), null);
  });
});

describe('buildRoundedPolyPath with curves', () => {
  function recordingCtx() {
    const calls = [];
    return {
      calls,
      moveTo: (...a) => calls.push(['moveTo', ...a]),
      lineTo: (...a) => calls.push(['lineTo', ...a]),
      bezierCurveTo: (...a) => calls.push(['bez', ...a]),
      arcTo: (...a) => calls.push(['arcTo', ...a]),
      closePath: () => calls.push(['close']),
    };
  }

  it('draws a cubic for a bent wall and lines for the rest', () => {
    const ctx = recordingCtx();
    const s = bowedSquare();
    buildRoundedPolyPath(ctx, s.vertices, 0, null, null, s.handles);
    const kinds = ctx.calls.map(c => c[0]);
    assert.deepEqual(kinds, ['moveTo', 'bez', 'lineTo', 'lineTo', 'close']);
    assert.deepEqual(ctx.calls[1].slice(1), [0, -40, 100, -40, 100, 0]);
  });

  it('leaves a straight closing wall to closePath, as it always has', () => {
    const ctx = recordingCtx();
    buildRoundedPolyPath(ctx, rect(0, 0, 10, 10), 0, null, null, null);
    assert.equal(ctx.calls.filter(c => c[0] === 'lineTo').length, 3);
  });

  it('spells out a curved closing wall, which closePath would draw straight', () => {
    const ctx = recordingCtx();
    const handles = [H(0, -12, 0, 0), null, null, H(0, 0, 0, -12)];
    buildRoundedPolyPath(ctx, rect(0, 0, 10, 10), 0, null, null, handles);
    assert.equal(ctx.calls[ctx.calls.length - 2][0], 'bez', 'the last wall drawn is the curve');
  });

  it('reads an anchor with handles as sharp, whatever its radius says', () => {
    const ctx = recordingCtx();
    const s = bowedSquare();
    buildRoundedPolyPath(ctx, s.vertices, 20, null, null, s.handles);
    const arcs = ctx.calls.filter(c => c[0] === 'arcTo');
    assert.equal(arcs.length, 2, 'only the two anchors with no handles round');
  });

  it('swaps a hole anchor’s two handles when the ring is walked backwards', () => {
    const outer = rect(0, 0, 100, 100);
    const hole = rect(20, 20, 60, 60);              // same winding as the outer, so it reverses
    const handles = new Array(8).fill(null);
    handles[4] = H(0, 0, 0, 9);                     // the hole's first anchor, outgoing
    const ctx = recordingCtx();
    buildRoundedPolyPath(ctx, outer, 0, null, [hole], handles);
    const holeCalls = ctx.calls.slice(ctx.calls.findIndex((c, i) => c[0] === 'moveTo' && i > 0));
    const bez = holeCalls.filter(c => c[0] === 'bez');
    assert.equal(bez.length, 1, 'the bent hole wall is still one curve after the reversal');
  });
});

describe('flattenRing', () => {
  it('samples a bent wall and leaves a straight one as its two ends', () => {
    const s = bowedSquare();
    const flat = flattenRing(s.vertices, s.handles, 0, 8);
    assert.equal(flat.length, 4 + 7, 'one wall gained its samples, minus its far anchor');
    assert.ok(flat.some(p => p.y < -1), 'the samples follow the bow above the anchors');
  });

  it('is the ring itself when nothing is bent', () => {
    assert.deepEqual(flattenRing(rect(0, 0, 4, 4), null, 0, 8), rect(0, 0, 4, 4));
  });
});

describe('shapeBBox', () => {
  it('takes in the bulge of a bent wall, which the anchors alone miss', () => {
    const s = bowedSquare();
    assert.equal(shapeBBox({ vertices: s.vertices }).minY, 0);
    assert.ok(shapeBBox(s).minY < -20, 'the bow reaches above the top anchors');
  });

  it('answers the plain box for a shape with no handles', () => {
    assert.deepEqual(shapeBBox({ vertices: rect(0, 0, 10, 20) }),
                     { minX: 0, minY: 0, maxX: 10, maxY: 20 });
  });
});

describe('wallParamAt', () => {
  it('separates the curve parameter from the fraction of the wall’s length', () => {
    const s = bowedSquare();
    const w = wallOf(s, [s.vertices], 0, 0, 0);
    const mid = wallParamAt(w, { x: 50, y: -30 });
    assert.ok(mid.t > 0.4 && mid.t < 0.6);
    assert.ok(mid.s > 0.4 && mid.s < 0.6);
    const start = wallParamAt(w, { x: 0, y: 0 });
    assert.ok(start.t < 0.05 && start.s < 0.05);
  });
});

describe('a repair keeps what it did not touch', () => {
  it('hands a curved room back unchanged when the geometry is unchanged', () => {
    const s = bowedSquare();
    s.cornerRadii = [null, null, 12, null];
    s.doors = [{ edge: 2, t: 0.5 }];
    const out = restoreShapeDetail([s], flattenShapeForClip(s)).pieces[0];
    assert.deepEqual(out.vertices, s.vertices);
    assert.deepEqual(out.handles, s.handles);
    assert.deepEqual(out.cornerRadii, s.cornerRadii);
    assert.deepEqual(out.doors, s.doors);
  });

  it('keeps a hole’s own curves and radii on the hole', () => {
    const s = {
      vertices: rect(0, 0, 100, 100),
      holes: [rect(30, 30, 70, 70)],
      handles: [null, null, null, null, H(0, 0, 10, 0), null, null, null],
      cornerRadii: [null, null, null, null, null, null, null, 4],
    };
    const out = restoreShapeDetail([s], flattenShapeForClip(s)).pieces[0];
    assert.equal(out.holes.length, 1);
    assert.equal(out.holes[0].length, 4);
    assert.deepEqual(out.handles, s.handles);
    assert.deepEqual(out.cornerRadii, s.cornerRadii);
  });

  it('adds no handles array to a room that had none', () => {
    const s = { vertices: rect(0, 0, 10, 10) };
    const out = restoreShapeDetail([s], flattenShapeForClip(s)).pieces[0];
    assert.equal(out.handles, undefined);
    assert.equal(out.cornerRadii, undefined);
  });
});

describe('a repair that cuts a curved wall', () => {
  // The bowed square with its top wall stopped halfway: the piece keeps the half of the curve it
  // still owns, as its own cubic.
  it('keeps the surviving half of the curve as a curve', () => {
    const s = bowedSquare();
    const full = flattenShapeForClip(s)[0];
    // Cut the ring down to the stretch from the first anchor to the middle of the bow.
    const half = full.slice(0, Math.ceil(full.length / 2)).concat([{ x: 0, y: 100 }]);
    const out = restoreGroupDetail([s], [{ verts: half, holes: [] }]).pieces[0];
    assert.ok(out.handles, 'the piece kept a curve');
    assert.ok(out.handles.some(h => h && (h.ox || h.oy || h.ix || h.iy)));
    assert.ok(out.vertices.length < full.length, 'the sampled points did not survive as vertices');
  });
});

describe('doors across a repair', () => {
  it('moves a door onto the output wall that now carries its stretch', () => {
    const s = { vertices: rect(0, 0, 100, 100), doors: [{ edge: 0, t: 0.5 }] };
    const out = restoreShapeDetail([s], flattenShapeForClip(s));
    assert.equal(out.droppedDoors, 0);
    assert.deepEqual(out.pieces[0].doors, [{ edge: 0, t: 0.5 }]);
  });

  it('reports a door whose wall the repair removed, and drops it', () => {
    const s = { vertices: rect(0, 0, 100, 100), doors: [{ edge: 0, t: 0.5 }] };
    // A piece made only of the other three walls: wall 0 is gone.
    const piece = { verts: [{ x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], holes: [] };
    const out = restoreGroupDetail([s], [piece]);
    assert.equal(out.droppedDoors, 1);
    assert.equal(out.pieces[0].doors, undefined);
  });

  it('carries a door’s own fields, not just its place on the wall', () => {
    const s = { vertices: rect(0, 0, 100, 100), doors: [{ edge: 1, t: 0.25, mode: 'reveal' }] };
    const out = restoreShapeDetail([s], flattenShapeForClip(s));
    assert.equal(out.pieces[0].doors[0].mode, 'reveal');
  });
});

describe('downgrade safety for a curve', () => {
  it('writes a revealed room with a bent wall as a shroud, and reads its mode back', () => {
    const live = { ...bowedSquare(), mode: 'reveal' };
    const saved = encodeShapeForSave(live);
    assert.equal(saved.mode, 'shroud',
                 'an older build draws the wall straight and uncovers what the curve cut away');
    assert.equal(saved.modeWithHoles, 'reveal');
    const back = decodeShapeFromSave(saved);
    assert.deepEqual(back, live);
  });

  it('leaves a straight room exactly as it is', () => {
    const live = { vertices: rect(0, 0, 10, 10), mode: 'reveal' };
    assert.equal(encodeShapeForSave(live), live);
  });

  it('leaves a room whose handles are all empty alone', () => {
    const live = { vertices: rect(0, 0, 10, 10), handles: [null, null, null, null], mode: 'reveal' };
    assert.equal(encodeShapeForSave(live), live);
  });
});

describe('a wall the repair created', () => {
  it('stays straight, and gains no curve from the nearest source wall', () => {
    const s = bowedSquare();
    // A piece whose right half is two points the source never had: nothing there came off a wall.
    const flat = flattenShapeForClip(s)[0];
    const piece = { verts: [flat[0], { x: 300, y: -200 }, { x: 320, y: 400 }], holes: [] };
    const out = restoreGroupDetail([s], [piece]).pieces[0];
    const bent = out.handles ? out.handles.filter(h => h && (h.ox || h.oy || h.ix || h.iy)) : [];
    assert.equal(bent.length, 0,
                 'a curve was rebuilt onto a wall the repair invented, because the point was ' +
                 'matched to whichever source wall happened to be nearest');
  });
});

describe('what a repair must not lose', () => {
  it('keeps a piece that lies wholly along one curved wall', () => {
    const s = bowedSquare();
    const flat = flattenShapeForClip(s)[0];
    // Three consecutive samples from the middle of the bow: every point is scaffolding.
    const sliver = [flat[3], flat[4], flat[5]];
    const out = restoreGroupDetail([s], [{ verts: sliver, holes: [] }]);
    assert.equal(out.pieces.length, 1,
                 'the piece vanished, so a Trim through a bulge deletes the room it made');
    assert.equal(out.pieces[0].vertices.length, 3);
  });

  it('clears the radius on any anchor it hands a curve to', () => {
    const s = { ...bowedSquare(), cornerRadii: [25, 25, null, null] };
    const out = restoreShapeDetail([s], flattenShapeForClip(s)).pieces[0];
    for (let i = 0; i < out.vertices.length; i++) {
      const h = out.handles && out.handles[i];
      const r = out.cornerRadii && out.cornerRadii[i];
      assert.ok(!(h && (h.ix || h.iy || h.ox || h.oy) && r),
                'vertex ' + i + ' came back with a radius AND handles, which no outline can draw');
    }
  });

  it('gives a shared corner back to the room its walls came from', () => {
    const A = { vertices: rect(0, 0, 100, 100), cornerRadii: [null, null, 40, null] };
    const B = { vertices: rect(100, 100, 200, 200), cornerRadii: [7, null, null, null] };
    // A ring walking A's own outline, which happens to pass through the corner B also owns.
    const out = restoreGroupDetail([A, B], [{ verts: A.vertices, holes: [] }]).pieces[0];
    assert.equal(out.cornerRadii[2], 40,
                 "the shared corner took the other room's radius: " +
                 JSON.stringify(out.cornerRadii));
  });
});

describe('a corner the repair created on a wall', () => {
  const area = (v) => {
    let t = 0;
    for (let i = 0; i < v.length; i++) {
      const a = v[i], b = v[(i + 1) % v.length];
      t += a.x * b.y - b.x * a.y;
    }
    return Math.abs(t) / 2;
  };

  it('survives, so a notch cut into a straight wall keeps its shape', () => {
    const room = { vertices: rect(0, 0, 400, 400) };
    // What a Trim of a 100x100 notch hands back: four new corners, two of them ON the top wall.
    const notched = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 },
                     { x: 200, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }];
    const out = restoreGroupDetail([room], [{ verts: notched, holes: [] }]).pieces[0];
    assert.equal(out.vertices.length, 8, 'a corner of the notch was read as sampling and dropped');
    assert.equal(area(out.vertices), 150000, 'the notch took more than the 10000 it covers');
  });

  it('survives on a CURVED wall too, where real sampling sits beside it', () => {
    const s = bowedSquare();
    const flat = flattenShapeForClip(s)[0];
    // The bow's own midpoint, kept as a corner the repair put there rather than as sampling.
    const mid = flat[Math.floor(flat.length / 4)];
    const cut = [flat[0], { x: mid.x, y: mid.y }, { x: mid.x + 4, y: mid.y + 30 },
                 { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const out = restoreGroupDetail([s], [{ verts: cut, holes: [] }]).pieces[0];
    assert.ok(out.vertices.length >= 5,
              'a corner the repair invented on a curved wall was dropped as sampling');
  });
});
