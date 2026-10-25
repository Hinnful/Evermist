'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/world/worldMapPlan.js');

const sc = (id, group, pos) => ({ id, group, worldPos: pos });

describe('wmPlanPositions', () => {
  it('places nothing when every scene has a position', () => {
    assert.deepEqual(W.wmPlanPositions([sc('a', '', { x: 1, y: 2 })]), {});
  });

  it('lays each group out around its own point and ungrouped scenes below', () => {
    const list = [sc('a', 'Vallaki'), sc('b', 'Vallaki'), sc('c', 'Krezk'), sc('d', ''), sc('e', '')];
    const out = W.wmPlanPositions(list);
    assert.deepEqual(Object.keys(out).sort(), ['a', 'b', 'c', 'd', 'e']);
    const groupBottom = Math.max(out.a.y, out.b.y, out.c.y);
    assert.ok(out.d.y > groupBottom + W.WM_CARD_H, 'the loose row sits clear below the groups');
    assert.equal(out.d.y, out.e.y);
    assert.equal(out.e.x - out.d.x, W.WM_STEP_X);
  });

  it('never stacks two scenes on one spot', () => {
    const list = Array.from({ length: 14 }, (_, i) => sc('s' + i, i < 9 ? 'A' : i < 12 ? 'B' : '', null));
    const out = W.wmPlanPositions(list);
    const keys = Object.values(out).map(p => p.x + ',' + p.y);
    assert.equal(new Set(keys).size, 14);
  });

  it('keeps one scene of a one-scene place', () => {
    const out = W.wmPlanPositions([sc('a', 'Barn')]);
    assert.ok(Number.isFinite(out.a.x) && Number.isFinite(out.a.y));
  });

  it('treats a position that is not finite as missing', () => {
    const out = W.wmPlanPositions([sc('a', '', { x: NaN, y: 1 }), sc('b', '', 'x')]);
    assert.deepEqual(Object.keys(out).sort(), ['a', 'b']);
  });

  it('puts a late arrival under its own group, and a loose one under the layout', () => {
    const list = [sc('a', 'Vallaki', { x: 0, y: 0 }), sc('b', 'Vallaki', { x: 240, y: 0 }),
                  sc('c', 'Krezk', { x: 2000, y: 0 }), sc('n', 'Vallaki'), sc('l', '')];
    const out = W.wmPlanPositions(list);
    assert.deepEqual(Object.keys(out).sort(), ['l', 'n']);
    assert.equal(out.n.x, 0);
    assert.ok(out.n.y > 0);
    assert.ok(out.l.y > 0);
    assert.equal(out.l.x, 0);
  });

  it('never puts a loose late arrival on a spot just given to a group late arrival', () => {
    const list = [sc('a', 'Hall', { x: 0, y: 0 }), sc('b', 'Hall'), sc('c', 'Hall'), sc('l', '')];
    const out = W.wmPlanPositions(list);
    const spots = [{ x: 0, y: 0 }, ...Object.values(out)].map(p => p.x + ',' + p.y);
    assert.equal(new Set(spots).size, spots.length, JSON.stringify(out));
    assert.ok(out.l.y > out.b.y, 'the loose one sits below the new row of the group');
  });

  it('places a late arrival whose group has nothing placed under the layout', () => {
    const out = W.wmPlanPositions([sc('a', 'Vallaki', { x: 0, y: 0 }), sc('n', 'Brand new')]);
    assert.ok(out.n.y > 0);
  });
});

describe('wmHullRect', () => {
  it('is null for no scenes', () => {
    assert.equal(W.wmHullRect([]), null);
  });

  it('wraps the cards, the name above them and a margin', () => {
    const r = W.wmHullRect([{ x: 0, y: 0 }]);
    assert.equal(r.w, W.WM_CARD_W + 2 * W.WM_PAD);
    assert.equal(r.h, W.WM_CARD_H + W.WM_LABEL + 2 * W.WM_PAD);
    assert.equal(r.x, -W.WM_CARD_W / 2 - W.WM_PAD);
  });
});

describe('the camera', () => {
  const view = { w: 1000, h: 600 };

  const clear = { w: 1000, h: 600, shift: 0 };

  it('frames an empty library on the origin', () => {
    const c = W.wmFrameCamera(W.wmContentBox([], [], null), clear, false);
    assert.deepEqual([c.cx, c.cy], [0, 0]);
  });

  it('boxes the cards, the places and the backdrop together', () => {
    const b = W.wmContentBox([{ x: 0, y: 0 }], [{ x: 500, y: -50, w: 100, h: 100 }], { x: -300, y: 0, w: 100, h: 900 });
    assert.deepEqual(b, { x0: -300, y0: -50, x1: 600, y1: 900 });
  });

  it('centres on the content and fits it in 70% of the clear window', () => {
    const box = { x0: 0, y0: 0, x1: 10000, y1: 4000 };
    const c = W.wmFrameCamera(box, clear, true);
    assert.deepEqual([c.cx, c.cy], [5000, 2000]);
    assert.ok(c.z * 10000 <= clear.w * 0.7 + 1e-9);
    assert.ok(c.z * 4000 <= clear.h * 0.7 + 1e-9);
  });

  it('never frames closer than 2.6x', () => {
    const c = W.wmFrameCamera(W.wmContentBox([{ x: 0, y: 0 }], [], null), clear, true);
    assert.equal(c.z, W.WM_FRAME_MAX);
  });

  it('keeps loose maps at the scenes level when no place is drawn', () => {
    const wide = { x0: 0, y0: 0, x1: 20000, y1: 8000 };
    assert.equal(W.wmFrameCamera(wide, clear, false).z, W.WM_SPLIT);
    assert.ok(W.wmFrameCamera(wide, clear, true).z < W.WM_SPLIT);
  });

  it('centres on the clear part of the window, not the window', () => {
    const box = { x0: 0, y0: 0, x1: 1000, y1: 1000 };
    const c = W.wmFrameCamera(box, { w: 800, h: 600, shift: 100 }, true);
    assert.equal(c.cx, 500 - 100 / c.z);
  });

  it('fills the view with one card', () => {
    const z = W.wmFillZoom(view);
    assert.ok(z * W.WM_CARD_W >= view.w && z * W.WM_CARD_H >= view.h);
  });

  it('opens a place at the scene level', () => {
    const c = W.wmPlaceCamera({ x: 0, y: 0, w: 10000, h: 10000 }, view);
    assert.ok(c.z >= W.WM_SPLIT);
    assert.deepEqual([c.cx, c.cy], [5000, 5000]);
  });

  it('names the level for a zoom', () => {
    assert.equal(W.wmLevelFor(W.WM_SPLIT - 0.01), 'places');
    assert.equal(W.wmLevelFor(W.WM_SPLIT), 'scenes');
  });

  it('zooms around the pointer and holds that world point still', () => {
    const cam = { cx: 100, cy: 50, z: 1 };
    const px = 800, py = 100;
    const before = { x: cam.cx + (px - view.w / 2) / cam.z, y: cam.cy + (py - view.h / 2) / cam.z };
    const next = W.wmZoomAround(cam, view, px, py, -400);
    assert.ok(next.z > cam.z);
    const after = { x: next.cx + (px - view.w / 2) / next.z, y: next.cy + (py - view.h / 2) / next.z };
    assert.ok(Math.abs(after.x - before.x) < 1e-9 && Math.abs(after.y - before.y) < 1e-9);
  });

  it('stops zooming at both ends', () => {
    let cam = { cx: 0, cy: 0, z: 1 };
    for (let i = 0; i < 100; i++) cam = W.wmZoomAround(cam, view, 0, 0, -1000);
    assert.equal(cam.z, 5);
    for (let i = 0; i < 100; i++) cam = W.wmZoomAround(cam, view, 0, 0, 1000);
    assert.equal(cam.z, 0.06);
  });
});

describe('wmSideBySide and wmMatches', () => {
  it('centres a row of new scenes on the point', () => {
    const row = W.wmSideBySide(1000, 500, 3);
    assert.deepEqual(row.map(p => p.x), [1000 - W.WM_STEP_X, 1000, 1000 + W.WM_STEP_X]);
    assert.ok(row.every(p => p.y === 500));
  });

  it('lands a new scene beside the last one, clear of every card', () => {
    const last = { x: 0, y: 0 }, taken = [W.wmCardRect(last)];
    const a = W.wmFreeSpot(last, taken, true);
    assert.deepEqual(a, { x: W.WM_STEP_X, y: 0 });
    taken.push(W.wmCardRect(a));
    const b = W.wmFreeSpot(a, taken, true);
    assert.deepEqual(b, { x: 2 * W.WM_STEP_X, y: 0 });
    taken.push(W.wmCardRect({ x: 3 * W.WM_STEP_X, y: 0 }));
    const c = W.wmFreeSpot(b, taken, true);
    const hit = r => taken.some(t => r.x < t.x + t.w && t.x < r.x + r.w && r.y < t.y + t.h && t.y < r.y + r.h);
    assert.ok(!hit(W.wmCardRect(c)) && Math.hypot(c.x - b.x, c.y - b.y) <= W.WM_STEP_Y + 1);
  });

  it('lands on the chosen spot itself when it is clear', () => {
    assert.deepEqual(W.wmFreeSpot({ x: 500, y: 300 }, [W.wmCardRect({ x: 0, y: 0 })], false), { x: 500, y: 300 });
  });

  it('matches a scene by its own name or its place, ignoring case', () => {
    assert.ok(W.wmMatches('VAL', 'Town square', 'Vallaki'));
    assert.ok(W.wmMatches('square', 'Town square', ''));
    assert.ok(!W.wmMatches('xyz', 'Town square', 'Vallaki'));
    assert.ok(W.wmMatches('  ', 'anything', ''));
  });
});

describe('wmCleanPos and wmBesideOffset', () => {
  it('keeps a finite position and nothing else', () => {
    assert.deepEqual(W.wmCleanPos({ x: 1, y: 2, extra: 3 }), { x: 1, y: 2 });
    for (const bad of [null, undefined, 5, 'a', {}, { x: 1 }, { x: '1', y: 2 }, { x: NaN, y: 0 }, { x: Infinity, y: 0 }]) {
      assert.equal(W.wmCleanPos(bad), null, JSON.stringify(bad));
    }
  });

  it('moves nothing into an empty layout', () => {
    assert.deepEqual(W.wmBesideOffset([], [{ x: 5, y: 5 }]), { dx: 0, dy: 0 });
  });

  it('puts a restored block right of the existing layout, top edges level', () => {
    const o = W.wmBesideOffset([{ x: 0, y: 100 }, { x: 1000, y: 300 }], [{ x: 50, y: 20 }, { x: 250, y: 90 }]);
    assert.equal(50 + o.dx, 1000 + W.WM_CARD_W + 400);
    assert.equal(20 + o.dy, 100);
  });
});

describe('a card inside a polygon', () => {
  const sq = W.wmRectShape(0, 0, 600, 400);
  const card = (x, y) => W.wmCardRect({ x, y });

  it('is in when the whole card is, and out when one pixel is not', () => {
    assert.ok(W.wmRectInPoly(card(300, 200), sq));
    assert.ok(W.wmRectInPoly(card(W.WM_CARD_W / 2, W.WM_CARD_H / 2), sq), 'a card flush with the corner is in');
    assert.ok(!W.wmRectInPoly(card(W.WM_CARD_W / 2 - 1, W.WM_CARD_H / 2), sq), 'one pixel past the left wall is out');
    assert.ok(!W.wmRectInPoly(card(300, 400 - W.WM_CARD_H / 2 + 1), sq), 'one pixel past the bottom wall is out');
    assert.ok(!W.wmRectInPoly(card(900, 200), sq));
  });

  it('is out when a notch cuts across it with all four corners in', () => {
    const u = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 400, y: 400 }, { x: 400, y: 200 }, { x: 200, y: 200 }, { x: 200, y: 400 }, { x: 0, y: 400 }];
    assert.ok(W.wmRectInPoly(card(100, 300), u), 'the left leg holds a card');
    assert.ok(!W.wmRectInPoly(card(300, 300), u), 'the notch is across it');
  });

  it('is out when a corner of the polygon pokes into it', () => {
    const star = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 300, y: 150 }, { x: 0, y: 400 }];
    assert.ok(!W.wmRectInPoly(card(300, 130), star));
  });

  it('is out for a shape with fewer than three points', () => {
    assert.ok(!W.wmRectInPoly(card(0, 0), [{ x: 0, y: 0 }, { x: 5, y: 5 }]));
  });

  it('belongs to the smallest polygon that holds it, and to none outside every one', () => {
    const shapes = Object.assign(Object.create(null), { Big: W.wmRectShape(0, 0, 1200, 800), Small: W.wmRectShape(0, 0, 600, 400) });
    assert.equal(W.wmPlaceOf(card(300, 200), shapes), 'Small');
    assert.equal(W.wmPlaceOf(card(900, 600), shapes), 'Big');
    assert.equal(W.wmPlaceOf(card(5000, 5000), shapes), '');
    assert.equal(W.wmPlaceOf(card(300, 200), null), '');
  });

  it('takes a name that is also an Object property', () => {
    const shapes = Object.assign(Object.create(null), { constructor: W.wmRectShape(0, 0, 600, 400) });
    assert.equal(W.wmPlaceOf(card(300, 200), shapes), 'constructor');
  });
});

describe('polygon helpers', () => {
  it('measures area, bounds and the middle', () => {
    const sq = W.wmRectShape(0, 0, 200, 100);
    assert.equal(W.wmPolyArea(sq), 20000);
    assert.deepEqual(W.wmPolyBounds(sq), { x: 0, y: 0, w: 200, h: 100 });
    assert.deepEqual(W.wmPolyCentre(sq), { x: 100, y: 50 });
  });

  it('falls back to the bounding box for a flat polygon', () => {
    const flat = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }];
    assert.deepEqual(W.wmPolyCentre(flat), { x: 100, y: 0 });
  });

  it('draws a rectangle from any two corners and a circle from its middle', () => {
    assert.deepEqual(W.wmRectShape(50, 80, 10, 20), W.wmRectShape(10, 20, 50, 80));
    const c = W.wmCircleShape(0, 0, 100, 40);
    assert.equal(c.length, 40);
    assert.ok(c.every(p => Math.abs(Math.hypot(p.x, p.y) - 100) < 1));
  });

  it('places a name at the highest corner', () => {
    assert.deepEqual(W.wmLabelSpot([{ x: 5, y: 9 }, { x: 7, y: 2 }, { x: 1, y: 2 }]), { x: 1, y: 2 });
  });

  it('finds a free slot that holds a card, or none', () => {
    const sq = W.wmRectShape(0, 0, 600, 400);
    const slot = W.wmSlotInPoly(sq, []);
    assert.ok(slot && W.wmRectInPoly(W.wmCardRect(slot), sq));
    const taken = [W.wmCardRect(slot)];
    const next = W.wmSlotInPoly(sq, taken);
    assert.ok(next && (next.x !== slot.x || next.y !== slot.y));
    assert.equal(W.wmSlotInPoly(W.wmRectShape(0, 0, 100, 100), []), null);
  });

  it('a full outline still yields a spot inside it, a different one for each card', () => {
    const full = W.wmRectShape(0, 0, 600, 400);
    const taken = [];
    for (let y = 0; y <= 400; y += 40) for (let x = 0; x <= 600; x += 40) taken.push(W.wmCardRect({ x, y }));
    assert.equal(W.wmSlotInPoly(full, taken), null);
    const spots = [];
    for (let i = 0; i < 3; i++) {
      const s = W.wmSpotInOutline(full, taken);
      assert.ok(W.wmPointInPoly(s, full));
      assert.ok(!spots.some(p => p.x === s.x && p.y === s.y));
      spots.push(s);
      taken.push(W.wmCardRect(s));
    }
  });
});

describe('a place built like a room', () => {
  const sq = W.wmRectShape(0, 0, 400, 400);

  it('keeps the rounding and the curves a room carries, and drops what is malformed', () => {
    const ok = W.wmCleanPlace({ vertices: sq, cornerRadius: 30, cornerRadii: [null, 10, null, 0],
                                handles: [null, { ix: 1, iy: 2, ox: 3, oy: 4 }, null, null], junk: 1 });
    assert.deepEqual(Object.keys(ok).sort(), ['cornerRadii', 'cornerRadius', 'handles', 'vertices']);
    assert.equal(W.wmCleanPlace(sq).vertices.length, 4, 'a bare array is a place from before rounding');
    assert.equal(W.wmCleanPlace({ vertices: sq, cornerRadii: [1, 2] }).cornerRadii, undefined, 'radii for the wrong count are dropped');
    assert.equal(W.wmCleanPlace({ vertices: sq, handles: [null, { ix: 'a' }, null, null] }).handles, undefined);
    assert.equal(W.wmCleanPlace({ vertices: sq, cornerRadius: -5 }).cornerRadius, undefined);
    for (const bad of [null, 5, {}, { vertices: [] }]) assert.equal(W.wmCleanPlace(bad), null);
  });

  it('answers the true outline: a rounded corner cuts the card that fits the square', () => {
    const plain = W.wmOutline({ vertices: sq });
    const round = W.wmOutline({ vertices: sq, cornerRadius: 100 });
    assert.ok(round.length > plain.length);
    const card = { x: 0, y: 0, w: W.WM_CARD_W, h: W.WM_CARD_H };
    assert.ok(W.wmRectInPoly(card, plain), 'flush in the square corner');
    assert.ok(!W.wmRectInPoly(card, round), 'out of a corner rounded away');
    assert.ok(W.wmRectInPoly({ x: 100, y: 100, w: 200, h: 140 }, round));
  });

  it('answers a curved wall as its curve, not its chord', () => {
    const bowed = W.wmOutline({ vertices: sq, handles: [{ ix: 0, iy: 0, ox: 0, oy: -150, }, null, null, { ix: 0, iy: -150, ox: 0, oy: 0 }] });
    assert.ok(bowed.length > 4);
    assert.ok(Math.min(...bowed.map(p => p.y)) < -20, 'the top wall bulges above the chord');
  });
});

describe('stored shapes', () => {
  const tri = [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 0, y: 9 }];

  it('cleans a shape: three finite points or nothing', () => {
    assert.deepEqual(W.wmCleanShape(tri), tri);
    for (const bad of [null, 5, 'x', {}, [], tri.slice(0, 2), [...tri, { x: NaN, y: 0 }], [...tri, null], [...tri, { x: '1', y: 2 }], Array(500).fill({ x: 1, y: 1 })]) {
      assert.equal(W.wmCleanShape(bad), null, JSON.stringify(bad).slice(0, 40));
    }
  });

  it('reads the shapes of a campaign.json, and reports what it dropped', () => {
    const ok = W.wmParseShapes(JSON.stringify({ placeShapes: { Vallaki: tri, constructor: tri } }));
    assert.equal(ok.broken, false);
    assert.deepEqual(Object.keys(ok.shapes).sort(), ['Vallaki', 'constructor']);
    assert.deepEqual(ok.shapes.Vallaki, { vertices: tri }, 'a place is a record, an old bare array included');
    assert.equal(Object.getPrototypeOf(ok.shapes), null);
    assert.equal(W.wmParseShapes('{"placeShapes":{"A":[1,2]}}').broken, true);
    for (const bad of ['[]', 'null', '7', '"s"']) assert.equal(W.wmParseShapes('{"placeShapes":' + bad + '}').broken, true, bad);
  });

  it('treats a missing file, a missing key and a file that does not parse as normal', () => {
    assert.deepEqual([W.wmParseShapes(null).broken, W.wmParseShapes('{}').broken, W.wmParseShapes('{nope').broken], [false, false, false]);
    assert.equal(Object.keys(W.wmParseShapes('{}').shapes).length, 0);
  });
});

describe('the name plate', () => {
  const sq = W.wmRectShape(0, 0, 600, 400);

  it('sits the gap away from the top and left walls of a plain place', () => {
    const p = W.wmPlateSpot(sq, 120, 24, 10, 0);
    assert.ok(Math.abs(p.x - 10) < 1e-9 && Math.abs(p.y - 10) < 1e-9, JSON.stringify(p));
    assert.equal(p.w, 120);
  });

  it('keeps the same gap in a place of any size, so the distance is constant', () => {
    const a = W.wmPlateSpot(W.wmRectShape(0, 0, 300, 200), 100, 20, 8, 0), b = W.wmPlateSpot(W.wmRectShape(0, 0, 1500, 900), 100, 20, 8, 0);
    assert.deepEqual([a.x, a.y], [b.x, b.y]);
  });

  it('goes to the top left where the wall slopes, not under the highest corner', () => {
    const slope = [{ x: 20, y: 330 }, { x: 540, y: 300 }, { x: 570, y: 560 }, { x: 490, y: 700 }, { x: 60, y: 690 }, { x: 0, y: 520 }];
    const p = W.wmPlateSpot(slope, 100, 24, 10, 0);
    assert.ok(p.x < 120, 'the plate is at the left: ' + JSON.stringify(p));
    assert.ok(W.wmRectInPoly({ x: p.x - 10, y: p.y - 10, w: p.w + 20, h: 44 }, slope), 'with its gap, the plate is inside');
  });

  it('narrows to what fits, and answers null for a place too small to hold it', () => {
    const p = W.wmPlateSpot(W.wmRectShape(0, 0, 150, 100), 300, 24, 10, 60);
    assert.ok(p && p.w >= 60 && p.w <= 130);
    assert.equal(W.wmPlateSpot(W.wmRectShape(0, 0, 30, 30), 300, 24, 10, 60), null);
  });
});

describe('the count and the hand of maps', () => {
  const inside = (r, outline, m) => W.wmRectInPoly({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m }, outline);
  const box = (spot, size, k) => ({ x: spot.x, y: spot.y, w: size.w * spot.scale * k, h: size.h * spot.scale * k });
  const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  it('shows up to three maps and a +N card for the rest', () => {
    assert.deepEqual([1, 2, 3, 4, 9].map(n => W.wmFanCards(n).cards), [1, 2, 3, 4, 4]);
    assert.deepEqual(W.wmFanCards(9), { shown: 3, cards: 4, more: 6 });
    assert.deepEqual(W.wmFanCards(2), { shown: 2, cards: 2, more: 0 });
    assert.ok(W.wmFanSize(4).w > W.wmFanSize(2).w);
  });

  it('adds the pill to the plate: its text, its padding and the gap before it', () => {
    assert.equal(W.wmPillWidth(10, 20), 10 + 20 * 0.72 * 1.5);
  });

  it('sits at full size in the middle of a roomy place', () => {
    const o = W.wmRectShape(0, 0, 1000, 800), size = W.wmFanSize(4), k = 1;
    const s = W.wmFanSpot(o, size, null, k);
    assert.equal(s.scale, 1);
    const b = box(s, size, k);
    assert.ok(Math.abs(b.x + b.w / 2 - 500) < 10 && Math.abs(b.y + b.h / 2 - 400) < 10, JSON.stringify(s));
    assert.ok(inside(b, o, 6));
  });

  it('shrinks a step at a time when the place is small, and keeps a margin from the walls', () => {
    const size = W.wmFanSize(4), o = W.wmRectShape(0, 0, size.w * 0.7 + 12, size.h * 0.7 + 12);
    const s = W.wmFanSpot(o, size, null, 1);
    assert.ok(s && s.scale < 1 && s.scale >= 0.5, JSON.stringify(s));
    assert.ok(inside(box(s, size, 1), o, 6));
  });

  it('gives up when even half size does not fit', () => {
    const size = W.wmFanSize(4);
    assert.equal(W.wmFanSpot(W.wmRectShape(0, 0, size.w * 0.5, size.h * 0.5), size, null, 1), null);
    assert.equal(W.wmFanSpot(null, size, null, 1), null);
  });

  it('keeps clear of the name plate', () => {
    const o = W.wmRectShape(0, 0, 400, 300), size = W.wmFanSize(2), plate = { x: 120, y: 100, w: 160, h: 40 };
    const s = W.wmFanSpot(o, size, plate, 1);
    assert.ok(s);
    assert.ok(!hit(box(s, size, 1), plate), 'the hand overlaps the plate: ' + JSON.stringify(s));
    assert.ok(inside(box(s, size, 1), o, 6));
  });

  it('stays inside an oval and an L-shaped place', () => {
    const size = W.wmFanSize(3);
    const oval = W.wmCircleShape(300, 300, 200, 48);
    const L = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 900, y: 200 }, { x: 900, y: 500 }, { x: 0, y: 500 }];
    for (const o of [oval, L]) {
      const s = W.wmFanSpot(o, size, null, 1);
      assert.ok(s, 'it fits somewhere');
      assert.ok(inside(box(s, size, 1), o, 6), JSON.stringify(s));
    }
  });

  it('scales its margin with the zoom: a screen px is k world units', () => {
    const size = W.wmFanSize(2), o = W.wmRectShape(0, 0, 2000, 1500), k = 4;
    const s = W.wmFanSpot(o, size, null, k);
    assert.ok(inside(box(s, size, k), o, 6 * k));
  });
});

describe('how far the map reaches', () => {
  const view = { w: 1000, h: 600 };

  it('is the layout with a margin, or the picture with the layout and a fifth of it beyond', () => {
    const e = W.wmExtent([{ x: 0, y: 0 }, { x: 1000, y: 500 }], null);
    assert.deepEqual(e, { x0: -450, y0: -450, x1: 1450, y1: 950, box: { x0: 0, y0: 0, x1: 1000, y1: 500 } });
    const p = W.wmExtent([{ x: 0, y: 0 }, { x: 1000, y: 500 }], { x: -200, y: -100, w: 2000, h: 900 });
    assert.deepEqual(p, { x0: -600, y0: -500, x1: 2200, y1: 1200, box: { x0: -200, y0: -100, x1: 1800, y1: 800 } });
  });

  it('floors the zoom where all the content fits with room, and never above the places level', () => {
    const ext = { x0: -450, y0: -450, x1: 4450, y1: 2450, box: { x0: 0, y0: 0, x1: 4000, y1: 2000 } };
    assert.equal(W.wmZoomFloor(ext, view), Math.min(1000 / 5200, 600 / 2600));
    assert.equal(W.wmZoomFloor({ x0: 0, y0: 0, x1: 100, y1: 100, box: { x0: 0, y0: 0, x1: 100, y1: 100 } }, view), W.WM_SPLIT * 0.85);
  });

  it('shows every card and place at the floor, for a wide map in a tall window and a tall map in a wide one', () => {
    const cases = [
      { view: { w: 600, h: 1000 }, pts: [{ x: 0, y: 0 }, { x: 6000, y: 300 }] },
      { view: { w: 1000, h: 600 }, pts: [{ x: 0, y: 0 }, { x: 300, y: 6000 }] },
    ];
    for (const c of cases) {
      const ext = W.wmExtent(c.pts, null), box = ext.box;
      const z = W.wmZoomFloor(ext, c.view);
      assert.ok((box.x1 - box.x0) * z < c.view.w && (box.y1 - box.y0) * z < c.view.h, 'the content overflows the window at the floor');
      // the camera the clamp allows at the floor still has the whole box on screen
      const cam = W.wmClampCamera({ cx: 99999, cy: 99999, z: 0.001 }, c.view, ext);
      assert.equal(cam.z, z);
      const hw = c.view.w / 2 / z, hh = c.view.h / 2 / z;
      assert.ok(cam.cx - hw <= box.x0 && cam.cx + hw >= box.x1 && cam.cy - hh <= box.y0 && cam.cy + hh >= box.y1, 'the clamped camera cuts the content off');
    }
  });

  it('moves the camera the least that keeps the window inside', () => {
    const ext = { x0: 0, y0: 0, x1: 4000, y1: 2000 };
    const c = W.wmClampCamera({ cx: -500, cy: 5000, z: 0.5 }, view, ext);
    assert.deepEqual(c, { cx: 1000, cy: 1400, z: 0.5 });
    assert.equal(W.wmClampCamera({ cx: 2000, cy: 1000, z: 0.01 }, view, ext).z, W.wmZoomFloor(ext, view));
  });
});

describe('wmCleanPlace: the id and times a merge matches by', () => {
  const sq = [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }];
  it('keeps the uid and the part times, and nothing else a file might carry', () => {
    const c = W.wmCleanPlace({ vertices: sq, uid: 'p1', edits: { shape: 5, name: 7, notes: 0, junk: 9 }, extra: 1 });
    assert.equal(c.uid, 'p1');
    assert.deepEqual(c.edits, { shape: 5, name: 7 });
    assert.equal(c.extra, undefined);
  });
  it('drops a uid that is not text and times that are not numbers', () => {
    const c = W.wmCleanPlace({ vertices: sq, uid: 4, edits: { shape: 'x', name: -2 } });
    assert.equal(c.uid, undefined);
    assert.equal(c.edits, undefined);
  });
});

describe('wmGroupRectAt', () => {
  const { wmGroupRectAt, wmCardRect, wmRectInPoly, wmRectShape, WM_CARD_W, WM_PAD } = require('../src/world/worldMapPlan.js');

  it('is centred on the click and holds a card there with the margin to spare', () => {
    const at = { x: 500, y: -200 }, r = wmGroupRectAt(at);
    assert.equal(r.x + r.w / 2, at.x);
    assert.equal(r.y + r.h / 2, at.y);
    const verts = wmRectShape(r.x, r.y, r.x + r.w, r.y + r.h);
    assert.equal(wmRectInPoly(wmCardRect(at), verts), true);
    assert.equal(r.w, WM_CARD_W + 2 * WM_PAD);
  });

  it('is no larger than one card with its margin and name', () => {
    const r = wmGroupRectAt({ x: 0, y: 0 });
    assert.ok(r.h < 2 * (77 + 22 + 2 * 34));
  });
});
