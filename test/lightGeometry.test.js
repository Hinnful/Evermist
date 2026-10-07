const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { planLights, lightShapeFor, seedLightShapes, dropCoveredLights,
        LIGHT_DEFAULT_RANGE } = require('../src/fog/lightGeometry.js');
const { vttDerivePlan, vttScaleRooms } = require('../src/rooms/vttPlan.js');

const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const area = ring => Math.abs(ring.reduce((s, p, i) => {
  const q = ring[(i + 1) % ring.length];
  return s + (p.x * q.y - q.x * p.y);
}, 0)) / 2;
const box = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const room = box(0, 0, 200, 100);
const first = (light, rooms) => lightShapeFor(light, rooms).shapes[0].vertices;

describe('planLights', () => {
  it('reads 40 lights from the cave and 6 from the sample', () => {
    assert.equal(planLights(fixture('cave-map.dd2vtt'), 9750).length, 40);
    assert.equal(planLights(fixture('sample-map.dd2vtt'), 3150).length, 6);
  });

  it('puts a light where the file does, at map pixels, with its range in squares', () => {
    const l = planLights(fixture('sample-map.dd2vtt'), 3150)[0];
    assert.ok(Math.abs(l.x - 7.40823174 * 150) < 1e-6);
    assert.ok(Math.abs(l.y - 2.639704 * 150) < 1e-6);
    assert.ok(Math.abs(l.r - 4 * 150) < 1e-6);
  });

  it('scales to a map of a different width, as the rooms do', () => {
    const full = planLights(fixture('sample-map.dd2vtt'), 3150)[0];
    const half = planLights(fixture('sample-map.dd2vtt'), 1575)[0];
    assert.ok(Math.abs(half.x - full.x / 2) < 1e-6);
    assert.ok(Math.abs(half.r - full.r / 2) < 1e-6);
  });

  it('subtracts a non-zero origin before scaling', () => {
    const plan = { resolution: { map_origin: { x: 2, y: 3 }, map_size: { x: 10, y: 10 }, pixels_per_grid: 100 },
                   lights: [{ position: { x: 4, y: 5 }, range: 2 }] };
    const l = planLights(plan, 1000)[0];
    assert.deepEqual([l.x, l.y, l.r], [200, 200, 200]);
  });

  it('gives a light with no range the default', () => {
    const plan = { resolution: { map_size: { x: 10, y: 10 }, pixels_per_grid: 100 }, lights: [{ position: { x: 1, y: 1 } }] };
    assert.equal(planLights(plan, 1000)[0].r, LIGHT_DEFAULT_RANGE * 100);
  });

  it('answers a truncated or missing plan with nothing, never a throw', () => {
    for (const bad of [undefined, null, '', '{"resol', '[]', 42, '{}']) assert.deepEqual(planLights(bad, 1000), []);
  });
});

describe('lightShapeFor', () => {
  const big = box(0, 0, 100, 100);

  it('lights the whole room when the radius reaches every corner', () => {
    assert.equal(area(first({ x: 50, y: 50, r: 80 }, [big])), 100 * 100);
  });

  it('lights only the part the radius covers when the room is bigger', () => {
    const ring = first({ x: 50, y: 50, r: 30 }, [big]);
    assert.ok(Math.abs(area(ring) - Math.PI * 900) / (Math.PI * 900) < 0.02);
  });

  it('never leaves the room, so a wall corner stays out of a big radius', () => {
    const ring = first({ x: 10, y: 50, r: 90 }, [big]);
    for (const p of ring) assert.ok(p.x >= -1e-6 && p.x <= 100 + 1e-6 && p.y >= -1e-6 && p.y <= 100 + 1e-6);
    assert.ok(area(ring) < 100 * 100);
  });

  it('takes the smallest room that holds the light', () => {
    assert.equal(area(first({ x: 50, y: 50, r: 200 }, [big, box(40, 40, 60, 60)])), 20 * 20);
  });

  it('is a plain circle when no room is near', () => {
    const { room: ri, shapes } = lightShapeFor({ x: 500, y: 500, r: 40 }, [big]);
    assert.equal(ri, -1);
    assert.equal(shapes.length, 1);
    assert.ok(Math.abs(area(shapes[0].vertices) - Math.PI * 1600) / (Math.PI * 1600) < 0.02);
    for (const p of shapes[0].vertices) assert.ok(Math.abs(Math.hypot(p.x - 500, p.y - 500) - 40) < 1e-6);
  });

  it('stops an outdoor light at the wall of a room, near it or far, so it never lights the inside', () => {
    for (const x of [108, 130]) {
      const { room: ri, shapes } = lightShapeFor({ x, y: 50, r: 60 }, [big]);
      assert.equal(ri, -1);
      for (const sh of shapes) for (const p of sh.vertices) {
        assert.ok(!(p.y > 1e-6 && p.y < 100 - 1e-6 && p.x < 100 - 1e-6), 'light entered the room');
      }
    }
  });

  it('sends a light hung on the outside of a wall outward, and not into the room', () => {
    // 8 outside a 100 x 100 room's right wall: a torch on that wall.
    const { room: ri, shapes } = lightShapeFor({ x: 108, y: 50, r: 40 }, [big]);
    assert.equal(ri, -1);
    const lit = shapes.reduce((s, sh) => s + area(sh.vertices), 0);
    assert.ok(lit > 0 && lit < Math.PI * 1600, 'the circle was not cut by the room');
    for (const sh of shapes) for (const p of sh.vertices) assert.ok(p.x >= 100 - 1e-6, 'light entered the room');
  });

  it('leaves a hole where a wall light\'s circle holds a whole room', () => {
    const { shapes } = lightShapeFor({ x: 108, y: 50, r: 400 }, [big]);
    assert.ok(shapes.some(s => s.holes && s.holes.length === 1), 'the room inside the circle was lit');
  });

  it('gives every sample light a shape', () => {
    const text = fixture('sample-map.dd2vtt');
    const derived = vttDerivePlan(JSON.parse(text));
    const rooms = vttScaleRooms(derived.rooms, 3150, derived.srcW);
    for (const l of planLights(text, 3150)) {
      const { shapes } = lightShapeFor(l, rooms);
      assert.ok(shapes.length >= 1 && shapes.every(s => s.vertices.length >= 3));
    }
  });
});

describe('dropCoveredLights', () => {
  it('drops a light that lies wholly inside another', () => {
    const bigRing = box(0, 0, 100, 100), small = box(20, 20, 40, 40);
    assert.deepEqual(dropCoveredLights([small, bigRing]), [bigRing]);
    assert.deepEqual(dropCoveredLights([bigRing, small]), [bigRing]);
  });

  it('keeps one of two identical lights, the first', () => {
    const a = box(0, 0, 50, 50), b = box(0, 0, 50, 50);
    const out = dropCoveredLights([a, b]);
    assert.equal(out.length, 1);
    assert.equal(out[0], a);
  });

  it('keeps two lights that only overlap, or sit apart', () => {
    assert.equal(dropCoveredLights([box(0, 0, 60, 60), box(40, 40, 100, 100)]).length, 2);
    assert.equal(dropCoveredLights([box(0, 0, 10, 10), box(50, 50, 60, 60)]).length, 2);
  });

  it('keeps a light that pokes a little out of the other', () => {
    assert.equal(dropCoveredLights([box(0, 0, 100, 100), box(20, 20, 130, 40)]).length, 2);
  });
});

describe('seedLightShapes', () => {
  it('makes one polygon of two lights that together cover their room', () => {
    const out = seedLightShapes([{ x: 40, y: 50, r: 80 }, { x: 160, y: 50, r: 80 }], [room]);
    assert.equal(out.length, 1);
    assert.equal(area(out[0].vertices), 200 * 100);
  });

  it('makes one polygon of two overlapping lights that leave the room part lit', () => {
    const out = seedLightShapes([{ x: 40, y: 50, r: 45 }, { x: 80, y: 50, r: 45 }], [room]);
    assert.equal(out.length, 1);
    assert.ok(area(out[0].vertices) < 200 * 100);
  });

  it('keeps the lights of one room apart when they do not touch', () => {
    assert.equal(seedLightShapes([{ x: 10, y: 50, r: 8 }, { x: 190, y: 50, r: 8 }], [room]).length, 2);
  });

  it('keeps the lights of two rooms apart', () => {
    const other = box(300, 0, 400, 100);
    assert.equal(seedLightShapes([{ x: 100, y: 50, r: 150 }, { x: 350, y: 50, r: 150 }], [room, other]).length, 2);
  });

  it('keeps outdoor lights as their own circles, even when they overlap', () => {
    const out = seedLightShapes([{ x: 900, y: 900, r: 40 }, { x: 930, y: 900, r: 40 }], [room]);
    assert.equal(out.length, 2);
    for (const s of out) assert.ok(Math.abs(area(s.vertices) - Math.PI * 1600) / (Math.PI * 1600) < 0.03);
  });

  it('drops an outdoor circle that lies wholly inside another', () => {
    assert.equal(seedLightShapes([{ x: 900, y: 900, r: 80 }, { x: 905, y: 900, r: 20 }], [room]).length, 1);
  });

  it('keeps indoor lights apart when they share less than 30% of the smaller one', () => {
    assert.equal(seedLightShapes([{ x: 60, y: 50, r: 25 }, { x: 105, y: 50, r: 25 }], [room]).length, 2);
  });

  it('makes one polygon of indoor lights that share at least 30% of the smaller one', () => {
    assert.equal(seedLightShapes([{ x: 60, y: 50, r: 25 }, { x: 80, y: 50, r: 25 }], [room]).length, 1);
  });

  it('makes one polygon of a table of candles', () => {
    const candles = [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ x: 80 + (i % 4) * 8, y: 40 + Math.floor(i / 4) * 8, r: 20 }));
    assert.equal(seedLightShapes(candles, [room]).length, 1);
  });

  it('lights outside a wall for a torch hung on it, and keeps the room\'s own light apart', () => {
    const out = seedLightShapes([{ x: 100, y: 50, r: 150 }, { x: 208, y: 50, r: 40 }], [room]);
    assert.equal(out.length, 2);
    assert.equal(out.filter(s => s.vertices.every(p => p.x >= 200 - 1e-6)).length, 1);
  });
});
