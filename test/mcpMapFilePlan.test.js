'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mcpSizeNote, mcpSceneCopy, mcpRescaleScene, MCP_SHRINK_BOXES } = require('../src/mcp/mcpMapFilePlan.js');

describe('mcpSizeNote', () => {
  it('states the pixel size of every map', () => {
    assert.equal(mcpSizeNote({ mapType: 'image', mapWidth: 9000, mapHeight: 6000 }, false).text, 'The map is 9000×6000 pixels.');
    assert.equal(mcpSizeNote({ mapType: 'video', mapWidth: 3840, mapHeight: 2160 }, false).big, false);
  });
  it('warns about an animated map past 4K, says Compression is off, and names shrink_map', () => {
    const n = mcpSizeNote({ mapType: 'video', mapWidth: 6000, mapHeight: 5250 }, false);
    assert.equal(n.big, true);
    assert.match(n.text, /6000×5250/);
    assert.match(n.text, /larger than 4K/);
    assert.match(n.text, /Compression is off/);
    assert.match(n.text, /Tell the DM/);
    assert.match(n.text, /shrink_map/);
  });
  it('counts a tall map that misses the box as too big, and leaves out the Compression line when it is on', () => {
    const n = mcpSizeNote({ mapType: 'video', mapWidth: 2700, mapHeight: 4800 }, true);
    assert.equal(n.big, true);
    assert.doesNotMatch(n.text, /Compression/);
  });
});

describe('mcpSceneCopy', () => {
  const src = () => ({ id: 'old', name: 'Road', group: 'Hill', worldPos: { x: 1, y: 2 }, sortOrder: 3, createdAt: 5, mapType: 'video', mapPath: 'maps/old.webm',
    mapWidth: 100, mapHeight: 50, edits: { scene: { map: 9 } }, gridConfig: { cellSize: 10 }, fogTheme: 'ice', baseFogBlob: 'FOG', effects: [{ id: 1 }], lightShapes: [{ id: 2 }], floorPlan: '{}',
    notes: 'See @[Road › Gate](room:old:r1) and @[Other](map:x9)', polygons: [{ id: 1, uid: 'r1', name: 'Gate', desc: 'Back to @[Road](map:old)', vertices: [] }] });
  const opts = { id: 'new', name: 'Road copy', group: 'Vale', worldPos: { x: 7, y: 8 }, sortOrder: 4, now: 10, mapPath: 'maps/new.webm' };
  it('keeps everything the map holds under its own id, name, group, spot and file', () => {
    const c = mcpSceneCopy(src(), opts);
    assert.deepEqual([c.id, c.name, c.group, c.worldPos, c.sortOrder, c.createdAt, c.mapPath], ['new', 'Road copy', 'Vale', { x: 7, y: 8 }, 4, 10, 'maps/new.webm']);
    for (const k of ['gridConfig', 'fogTheme', 'baseFogBlob', 'effects', 'lightShapes', 'floorPlan', 'mapWidth', 'mapHeight']) assert.deepEqual(c[k], src()[k], k);
    assert.equal(c.polygons[0].uid, 'r1');
  });
  it('starts its edit times fresh, so it syncs as a new map', () => {
    assert.equal(mcpSceneCopy(src(), opts).edits, undefined);
  });
  it('points mentions of the source map and its rooms at the copy, and leaves others alone', () => {
    const c = mcpSceneCopy(src(), opts);
    assert.match(c.notes, /room:new:r1/);
    assert.match(c.notes, /map:x9/);
    assert.match(c.polygons[0].desc, /map:new/);
  });
  it('never leaves the copy on the original\'s file', () => {
    assert.notEqual(mcpSceneCopy(src(), opts).mapPath, src().mapPath);
  });
});

describe('mcpRescaleScene', () => {
  const rec = () => ({ mapWidth: 4800, mapHeight: 2700, mapPath: 'maps/a.webm', baseFogBlob: 'FOG', floorPlan: '{}',
    polygons: [{ id: 1, uid: 'u', name: 'Hall', mode: 'shroud', modeWithHoles: 'revealed', vertices: [{ x: 480, y: 270 }, { x: 960, y: 270 }, { x: 960, y: 540 }],
      holes: [[{ x: 600, y: 300 }, { x: 700, y: 300 }, { x: 700, y: 400 }]], cornerRadii: [48, null, 0, 24], handles: [null, { ix: 10, iy: -20, ox: 30, oy: 40 }],
      doors: [{ edge: 1, t: 0.5 }], pictures: ['p1'], future: { keep: true } }],
    effects: [{ id: 1, material: 'fire', cornerRadius: 12, vertices: [{ x: 100, y: 200 }] }],
    lightShapes: [{ id: 2, light: true, vertices: [{ x: 4800, y: 2700 }] }],
    gridConfig: { enabled: true, cellSize: 150, offsetX: 30, offsetY: 60, color: '#fff', lineWidth: 2 } });
  const k = 3840 / 4800;
  const out = () => mcpRescaleScene(rec(), 3840, 2160);
  it('sets the new size and keeps the fog picture and floor plan, which scale themselves', () => {
    const o = out();
    assert.deepEqual([o.mapWidth, o.mapHeight, o.baseFogBlob, o.floorPlan], [3840, 2160, 'FOG', '{}']);
  });
  it('moves room corners and hole corners by the width ratio', () => {
    const p = out().polygons[0];
    assert.deepEqual(p.vertices, [{ x: 384, y: 216 }, { x: 768, y: 216 }, { x: 768, y: 432 }]);
    assert.deepEqual(p.holes[0], [{ x: 480, y: 240 }, { x: 560, y: 240 }, { x: 560, y: 320 }]);
  });
  it('scales rounded corners and curve handles, and leaves doors along their wall', () => {
    const p = out().polygons[0];
    assert.deepEqual(p.cornerRadii, [48 * k, null, 0, 24 * k]);
    assert.deepEqual(p.handles, [null, { ix: 10 * k, iy: -20 * k, ox: 30 * k, oy: 40 * k }]);
    assert.deepEqual(p.doors, [{ edge: 1, t: 0.5 }]);
  });
  it('keeps every room field it does not know, the held mode included', () => {
    const p = out().polygons[0];
    assert.deepEqual([p.uid, p.name, p.mode, p.modeWithHoles, p.pictures, p.future], ['u', 'Hall', 'shroud', 'revealed', ['p1'], { keep: true }]);
  });
  it('scales effects and lights', () => {
    const o = out();
    assert.deepEqual(o.effects[0].vertices, [{ x: 80, y: 160 }]);
    assert.equal(o.effects[0].cornerRadius, 12 * k);
    assert.deepEqual(o.lightShapes[0].vertices, [{ x: 3840, y: 2160 }]);
  });
  it('scales the grid cell and the crossing, and keeps its look', () => {
    assert.deepEqual(out().gridConfig, { enabled: true, cellSize: 120, offsetX: 24, offsetY: 48, color: '#fff', lineWidth: 2 });
  });
  it('keeps every position the same in percent of the map', () => {
    const a = rec().polygons[0].vertices[1], b = out().polygons[0].vertices[1];
    assert.equal(a.x / 4800, b.x / 3840);
    assert.ok(Math.abs(a.y / 2700 - b.y / 2160) < 1e-9);
  });
  it('leaves the input alone', () => {
    const r = rec();
    mcpRescaleScene(r, 3840, 2160);
    assert.deepEqual(r, rec());
  });
  it('offers the Compression sizes', () => {
    assert.deepEqual(Object.keys(MCP_SHRINK_BOXES), ['4K', '2K', '1080p']);
  });
});
