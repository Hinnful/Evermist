const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { vttDerivePlan } = require('../src/rooms/vttPlan.js');
const { planLights } = require('../src/fog/lightGeometry.js');

// ⚠ BUILT FROM THE PUBLISHED SPEC, NOT REAL EXPORTS: no .uvtt or .df2vtt sample was at hand. Each
// carries what its exporter is documented to vary: the .uvtt omits map_origin and image, writes
// walls as long polylines and has a pillar in objects_line_of_sight; the .df2vtt writes two-point
// segments, as DungeonFog's own parser reads them. Same two rooms, sharing a doored wall.
const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const bbox = ring => ({
  x0: Math.min(...ring.map(p => p.x)), y0: Math.min(...ring.map(p => p.y)),
  x1: Math.max(...ring.map(p => p.x)), y1: Math.max(...ring.map(p => p.y)),
});

for (const [name, ppg] of [['two-rooms.uvtt', 70], ['two-rooms.df2vtt', 100]]) {
  describe('vttDerivePlan reads ' + path.extname(name), () => {
    const d = vttDerivePlan(read(name));

    it('derives the two rooms and nothing else, pillar included', () => {
      assert.deepEqual(d.rooms.map(bbox), [
        { x0: 2 * ppg, y0: 2 * ppg, x1: 6 * ppg, y1: 6 * ppg },
        { x0: 6 * ppg, y0: 2 * ppg, x1: 10 * ppg, y1: 6 * ppg },
      ]);
    });

    it('reports both openings and the size the plan believes its map is', () => {
      assert.equal(d.portals.length, 2);
      assert.equal(d.srcW, 12 * ppg);
      assert.equal(d.gridPx, ppg);
    });
  });
}

describe('planLights reads .df2vtt', () => {
  it('puts each light where the file does', () => {
    const lights = planLights(JSON.stringify(read('two-rooms.df2vtt')), 1200);
    assert.deepEqual(lights.map(l => [l.x, l.y, l.r]), [[400, 400, 600], [800, 400, 300]]);
  });
});
