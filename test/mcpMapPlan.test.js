'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mcpMapKeys, mcpMapSnapshot, mcpMapRecordRead, mcpMapRecordWrite } = require('../src/mcp/mcpMapPlan.js');

const sq = (x, y, w) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + w }, { x, y: y + w }];
const DEFAULTS = { grid: { enabled: false, cellSize: 50 }, fog: { hex: '#3a3a8c', alpha: 0.18, anim: { enabled: true, speed: 1, drift: 1, morph: 0.35, warpStr: 0.15, warpRad: 0.08, pulse: 0.3 } } };

describe('mcpMapKeys', () => {
  it('names each part\'s fields once, lights and effects sharing the effect id', () => {
    assert.deepEqual(mcpMapKeys(['effects', 'lights']), ['effects', 'nextEffectId', 'lightShapes', 'lightsHidden']);
    assert.deepEqual(mcpMapKeys(['rooms', 'fog']), ['polygons', 'nextPolygonId', 'fog']);
    assert.deepEqual(mcpMapKeys(['grid', 'fogSettings']), ['gridConfig', 'fogSettings']);
  });
  it('throws on a part that does not exist', () => {
    assert.throws(() => mcpMapKeys(['tokens']), /tokens/);
  });
});

describe('mcpMapSnapshot', () => {
  it('copies only the named fields, deeply, and leaves the painted fog out', () => {
    const data = { polygons: [{ id: 1, vertices: sq(0, 0, 10), doors: [{ t: 0.5 }] }], nextPolygonId: 2, gridConfig: { cellSize: 40 }, fog: {} };
    const snap = mcpMapSnapshot(data, ['polygons', 'nextPolygonId', 'fog']);
    assert.deepEqual(Object.keys(snap), ['polygons', 'nextPolygonId']);
    data.polygons[0].doors[0].t = 0.9;
    data.polygons[0].vertices[0].x = 99;
    assert.equal(snap.polygons[0].doors[0].t, 0.5);
    assert.equal(snap.polygons[0].vertices[0].x, 0);
  });
});

describe('mcpMapRecordRead', () => {
  it('decodes a held room back to its real mode and keeps every field', () => {
    const rec = { polygons: [{ id: 3, vertices: sq(0, 0, 100), holes: [sq(20, 20, 10)], mode: 'shroud', modeWithHoles: 'reveal', cornerRadii: [1, 2], name: 'Keep' }] };
    const d = mcpMapRecordRead(rec, ['polygons', 'nextPolygonId'], DEFAULTS);
    assert.equal(d.polygons[0].mode, 'reveal');
    assert.equal(d.polygons[0].modeWithHoles, undefined);
    assert.deepEqual(d.polygons[0].cornerRadii, [1, 2]);
    assert.equal(d.nextPolygonId, 1);
    d.polygons[0].vertices[0].x = 7;
    assert.equal(rec.polygons[0].vertices[0].x, 0);
  });
  it('fills fog settings and the grid for a record saved before either', () => {
    const d = mcpMapRecordRead({ fogSettings: { pickedHex: '#112233' } }, ['fogSettings', 'gridConfig'], DEFAULTS);
    assert.deepEqual(d.fogSettings, { pickedHex: '#112233', tintAlpha: 0.18, anim: DEFAULTS.fog.anim });
    assert.deepEqual(d.gridConfig, DEFAULTS.grid);
    assert.notEqual(d.gridConfig, DEFAULTS.grid);
  });
  it('reads lights without the broken ones, and hidden as a boolean', () => {
    const d = mcpMapRecordRead({ lightShapes: [{ id: 4, vertices: sq(0, 0, 5) }, null, { id: 5 }] }, mcpMapKeys(['lights']), DEFAULTS);
    assert.deepEqual(d.lightShapes.map(l => l.id), [4]);
    assert.equal(d.lightsHidden, false);
    assert.equal(d.nextEffectId, 1);
  });
});

describe('mcpMapRecordWrite', () => {
  it('writes rooms the way a save does: uids, and a held room as a shroud carrying its mode', () => {
    const rec = { id: 's', name: 'Crypt' };
    mcpMapRecordWrite(rec, { polygons: [{ id: 1, vertices: sq(0, 0, 100), holes: [sq(20, 20, 10)], mode: 'reveal' }], nextPolygonId: 2 }, ['polygons', 'nextPolygonId']);
    assert.equal(rec.polygons[0].mode, 'shroud');
    assert.equal(rec.polygons[0].modeWithHoles, 'reveal');
    assert.ok(rec.polygons[0].uid);
    assert.equal(rec.nextPolygonId, 2);
    assert.equal(rec.name, 'Crypt');
  });
  it('round-trips through a read, and removes a field the plain shape leaves undefined', () => {
    const rec = { gridConfig: { cellSize: 40 }, fogSettings: { pickedHex: '#000000' }, mapBlob: 'kept' };
    const before = mcpMapRecordRead(rec, ['gridConfig'], DEFAULTS);
    mcpMapRecordWrite(rec, { gridConfig: { cellSize: 70 } }, ['gridConfig']);
    assert.equal(rec.gridConfig.cellSize, 70);
    mcpMapRecordWrite(rec, before, ['gridConfig']);
    assert.deepEqual(rec.gridConfig, { cellSize: 40 });
    mcpMapRecordWrite(rec, {}, ['fogSettings', 'fog']);
    assert.equal('fogSettings' in rec, false);
    assert.equal(rec.mapBlob, 'kept');
  });
});
