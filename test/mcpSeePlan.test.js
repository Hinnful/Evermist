'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { MCP_SEE_MAX_SIDE, MCP_SEE_MIN_SIDE, mcpSeeArea, mcpSeePixels, mcpSeeOutSize, mcpSeeShrink, mcpSeeStep, mcpSeeLines, mcpSeeLabel,
  mcpSeeLabelKeep, mcpSeeRing, mcpSeeAnchor, mcpSeeDoorAt, mcpSeeFog, mcpSeeGrid, mcpSeePlanCounts, mcpSeeRead, mcpSeeJson,
  mcpSeeViewText } = require('../src/mcp/mcpSeePlan.js');

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

describe('mcpSeeArea', () => {
  it('is the whole map when none is given', () => {
    assert.deepEqual(mcpSeeArea(undefined).area, { x: 0, y: 0, w: 100, h: 100 });
  });
  it('clips an area that runs off the map', () => {
    assert.deepEqual(mcpSeeArea({ x: -10, y: 80, w: 30, h: 50 }).area, { x: 0, y: 80, w: 20, h: 20 });
  });
  it('refuses a missing number, a non-object and a sliver', () => {
    assert.ok(mcpSeeArea({ x: 0, y: 0, w: 50 }).error);
    assert.ok(mcpSeeArea('all').error);
    assert.ok(mcpSeeArea({ x: 99.5, y: 0, w: 10, h: 10 }).error);
    assert.ok(mcpSeeArea({ x: 120, y: 0, w: 10, h: 10 }).error);
  });
});

describe('mcpSeePixels', () => {
  it('covers the whole map for the whole area', () => {
    assert.deepEqual(mcpSeePixels({ x: 0, y: 0, w: 100, h: 100 }, 1600, 1000), { sx: 0, sy: 0, sw: 1600, sh: 1000 });
  });
  it('rounds outward and never leaves the map', () => {
    const p = mcpSeePixels({ x: 33.3, y: 90, w: 66.7, h: 10 }, 1000, 999);
    assert.ok(p.sx <= 333 && p.sx >= 332);
    assert.equal(p.sx + p.sw, 1000);
    assert.equal(p.sy + p.sh, 999);
  });
});

describe('mcpSeeOutSize', () => {
  it('holds the long side to the cap and keeps the proportions', () => {
    const o = mcpSeeOutSize(10000, 6000);
    assert.equal(o.w, MCP_SEE_MAX_SIDE);
    assert.equal(o.h, Math.round(6000 * MCP_SEE_MAX_SIDE / 10000));
  });
  it('keeps a mid-size crop as it is', () => {
    assert.deepEqual(mcpSeeOutSize(1000, 500), { w: 1000, h: 500 });
  });
  it('enlarges a small crop so the labels have room', () => {
    assert.deepEqual(mcpSeeOutSize(100, 50), { w: MCP_SEE_MIN_SIDE, h: MCP_SEE_MIN_SIDE / 2 });
  });
  it('shrinks by a factor', () => {
    assert.deepEqual(mcpSeeShrink({ w: 1000, h: 500 }, 0.75), { w: 750, h: 375 });
  });
});

describe('mcpSeeStep and mcpSeeLines', () => {
  it('is 10% for the whole map, with ten lines or eleven counting the far edge', () => {
    const step = mcpSeeStep({ x: 0, y: 0, w: 100, h: 100 }, 1600, 1000);
    assert.equal(step, 10);
    assert.equal(mcpSeeLines(0, 100, step).length, 11);
  });
  it('goes finer as the area shrinks, always 8 to 12 lines across', () => {
    for (const w of [50, 30, 20, 12, 7, 3, 1]) {
      const area = { x: 10, y: 10, w, h: w };
      const n = mcpSeeLines(area.x, area.w, mcpSeeStep(area, 1000, 1000)).length;
      assert.ok(n >= 7 && n <= 13, w + '% gave ' + n + ' lines');
    }
  });
  it('steps by the longer side in pixels', () => {
    assert.equal(mcpSeeStep({ x: 0, y: 0, w: 20, h: 100 }, 1000, 1000), 10);
    assert.equal(mcpSeeStep({ x: 0, y: 0, w: 20, h: 100 }, 1000, 100), 2);
  });
  it('lines are exact multiples inside the area', () => {
    assert.deepEqual(mcpSeeLines(12.5, 10, 2.5), [12.5, 15, 17.5, 20, 22.5]);
    assert.deepEqual(mcpSeeLines(0.05, 0.9, 0.1), [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);
  });
  it('labels with one decimal at most', () => {
    assert.equal(mcpSeeLabel(10), '10%');
    assert.equal(mcpSeeLabel(12.5), '12.5%');
    assert.equal(mcpSeeLabel(0.30000000000000004), '0.3%');
  });
});

describe('mcpSeeLabelKeep', () => {
  it('drops a label that would sit on the last kept one', () => {
    assert.deepEqual(mcpSeeLabelKeep([0, 20, 70, 90, 150], 50, 4), [true, false, true, false, true]);
  });
});

describe('outlines', () => {
  it('turns a ring into percent points to 0.1', () => {
    assert.deepEqual(mcpSeeRing(rect(160, 100, 320, 200), 1600, 1000), [[10, 10], [30, 10], [30, 30], [10, 30]]);
    assert.deepEqual(mcpSeeRing([{ x: 1, y: 1 }], 1600, 1000), [[0.1, 0.1]]);
  });
  it('anchors a name at the area centre, and at the mean for a flat ring', () => {
    assert.deepEqual(mcpSeeAnchor(rect(0, 0, 100, 50)), { x: 50, y: 25 });
    assert.deepEqual(mcpSeeAnchor([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]), { x: 10, y: 0 });
  });
  it('places a door along its wall, counting edges across the rings', () => {
    const poly = { vertices: rect(0, 0, 100, 100), holes: [rect(20, 20, 10, 10)] };
    assert.deepEqual(mcpSeeDoorAt(poly, { edge: 0, t: 0.5 }), { x: 50, y: 0 });
    assert.deepEqual(mcpSeeDoorAt(poly, { edge: 4, t: 0.5 }), { x: 25, y: 20 });
    assert.equal(mcpSeeDoorAt(poly, { edge: 8, t: 0.5 }), null);
  });
});

describe('mcpSeeFog, mcpSeeGrid and mcpSeePlanCounts', () => {
  it('names the three fog states', () => {
    assert.deepEqual(['shroud', 'half', 'reveal', undefined].map(mcpSeeFog), ['hidden', 'half', 'revealed', 'revealed']);
  });
  it('reads a grid in px and percent of width', () => {
    assert.deepEqual(mcpSeeGrid({ enabled: true, cellSize: 80, mode: 'hex-pointy' }, 1600), { on: true, type: 'hex', cellPx: 80, cellPercentOfWidth: 5 });
    assert.deepEqual(mcpSeeGrid(null, 1600), { on: false, type: 'square', cellPx: null, cellPercentOfWidth: null });
  });
  it('counts a plan, and takes bad text for none', () => {
    assert.deepEqual(mcpSeePlanCounts(JSON.stringify({ line_of_sight: [[], []], portals: [{}], lights: [{}, {}, {}] })), { loaded: true, walls: 2, doors: 1, lights: 3 });
    assert.deepEqual(mcpSeePlanCounts('{ truncated'), { loaded: false, walls: 0, doors: 0, lights: 0 });
    assert.equal(mcpSeePlanCounts(undefined).loaded, false);
  });
});

describe('mcpSeeRead', () => {
  const polygons = [
    { id: 1, name: 'Vestry', desc: 'Two acolytes.', mode: 'shroud', vertices: rect(160, 100, 320, 200), doors: [{ edge: 1, t: 0.5 }] },
    { id: 2, mode: 'half', vertices: rect(800, 500, 160, 100) },
    { id: 3, name: 'Hall', mode: 'reveal', vertices: rect(0, 0, 160, 100), holes: [rect(40, 25, 20, 20)] },
  ];
  const read = mcpSeeRead({ name: 'Crypt', group: '', mapW: 1600, mapH: 1000, mapType: 'video', onTv: true, gridConfig: { enabled: true, cellSize: 80, mode: 'square' },
    polygons, effects: [{ name: 'Fire 4', material: 'fire', vertices: rect(0, 0, 160, 100) }], floorPlan: '' });

  it('keeps polygons order with fog, notes and outlines in percent', () => {
    assert.deepEqual(read.rooms.map(r => [r.name, r.fog]), [['Vestry', 'hidden'], [null, 'half'], ['Hall', 'revealed']]);
    assert.deepEqual(read.rooms.map(r => r.index), [1, 2, 3]);
    assert.equal(read.rooms[0].notes, 'Two acolytes.');
    assert.deepEqual(read.rooms[0].outline, [[10, 10], [30, 10], [30, 30], [10, 30]]);
    assert.deepEqual(read.rooms[0].doors, [[30, 20]]);
    assert.equal(read.rooms[1].notes, '');
    assert.equal(read.rooms[1].holes, undefined);
    assert.equal(read.rooms[2].holes.length, 1);
  });
  it('carries the map, grid, effects and plan', () => {
    assert.deepEqual(read.map, { widthPx: 1600, heightPx: 1000, type: 'video' });
    assert.equal(read.onTv, true);
    assert.equal(read.group, null);
    assert.equal(read.grid.cellPercentOfWidth, 5);
    assert.deepEqual(read.effects, [{ index: 1, name: 'Fire 4', material: 'fire', outline: [[0, 0], [10, 0], [10, 10], [0, 10]] }]);
    assert.equal(read.floorPlan.loaded, false);
  });
  it('lists the lights with an index, and whether they are on', () => {
    const lit = mcpSeeRead({ name: 'Crypt', mapW: 1600, mapH: 1000, lightsHidden: true,
      lightShapes: [{ id: 7, vertices: rect(0, 0, 160, 100), light: true }, { id: 8, vertices: rect(800, 500, 160, 100), holes: [rect(840, 525, 20, 20)] }] });
    assert.equal(lit.lightsOn, false);
    assert.deepEqual(lit.lights.map(l => l.index), [1, 2]);
    assert.deepEqual(lit.lights[0], { index: 1, outline: [[0, 0], [10, 0], [10, 10], [0, 10]] });
    assert.equal(lit.lights[1].holes.length, 1);
    assert.equal(read.lightsOn, true);
    assert.deepEqual(read.lights, []);
  });
  it('prints each point pair on one line', () => {
    const text = mcpSeeJson(read);
    assert.match(text, /"outline": \[\n\s+\[10, 10\],/);
    assert.deepEqual(JSON.parse(text), read);
  });
});

describe('mcpSeeViewText', () => {
  const v = { name: 'Crypt', mapW: 1600, mapH: 1000, area: { x: 0, y: 0, w: 100, h: 100 }, px: { sw: 1600, sh: 1000 }, out: { w: 1568, h: 980 }, step: 10 };
  it('names the rooms and the grid step', () => {
    const t = mcpSeeViewText({ ...v, roomCount: 2, rooms: ['Vestry', null] });
    assert.match(t, /every 10%/);
    assert.match(t, /2 existing rooms are drawn.*Vestry/);
  });
  it('says so when there are no rooms', () => {
    assert.match(mcpSeeViewText({ ...v, roomCount: 0, rooms: [] }), /no rooms yet/);
  });
});
