'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mcpMapKeys, mcpMapSnapshot, mcpMapRecordRead, mcpMapRecordWrite } = require('../src/mcp/mcpMapPlan.js');

const { esLegacyUid } = require('../src/scenes/editStamps.js');
const sq = (x, y, w) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + w }, { x, y: y + w }];
const DEFAULTS = { grid: { enabled: false, cellSize: 50 } };

describe('mcpMapKeys', () => {
  it('names each part\'s fields once, lights and effects sharing the effect id', () => {
    assert.deepEqual(mcpMapKeys(['effects', 'lights']), ['effects', 'nextEffectId', 'lightShapes', 'lightsHidden']);
    assert.deepEqual(mcpMapKeys(['rooms', 'fog']), ['polygons', 'nextPolygonId', 'fog']);
    assert.deepEqual(mcpMapKeys(['grid', 'fogTheme']), ['gridConfig', 'fogTheme']);
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
  it('reads the fog theme as Default when unknown or missing, and fills the grid for an old record', () => {
    assert.equal(mcpMapRecordRead({ fogTheme: 'ice' }, ['fogTheme'], DEFAULTS).fogTheme, 'ice');
    assert.equal(mcpMapRecordRead({ fogTheme: 'lava' }, ['fogTheme'], DEFAULTS).fogTheme, 'default');
    const d = mcpMapRecordRead({ fogSettings: { pickedHex: '#112233' } }, ['fogTheme', 'gridConfig'], DEFAULTS);
    assert.equal(d.fogTheme, 'default');
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
  it('gives a room from before uids the uid every machine derives, and a pasted twin a new one', () => {
    const rec = { id: 's' };
    mcpMapRecordWrite(rec, { polygons: [{ id: 3, vertices: sq(0, 0, 10) }, { id: 4, uid: 'a', vertices: sq(20, 0, 10) }, { id: 5, uid: 'a', vertices: sq(40, 0, 10) }], nextPolygonId: 6 }, ['polygons', 'nextPolygonId']);
    assert.equal(rec.polygons[0].uid, esLegacyUid({ id: 3 }));
    assert.equal(rec.polygons[1].uid, 'a');
    assert.notEqual(rec.polygons[2].uid, 'a');
  });
  it('round-trips through a read, and removes a field the plain shape leaves undefined', () => {
    const rec = { gridConfig: { cellSize: 40 }, fogSettings: { pickedHex: '#000000' }, mapBlob: 'kept' };
    const before = mcpMapRecordRead(rec, ['gridConfig'], DEFAULTS);
    mcpMapRecordWrite(rec, { gridConfig: { cellSize: 70 } }, ['gridConfig']);
    assert.equal(rec.gridConfig.cellSize, 70);
    mcpMapRecordWrite(rec, before, ['gridConfig']);
    assert.deepEqual(rec.gridConfig, { cellSize: 40 });
    mcpMapRecordWrite(rec, {}, ['fogTheme', 'fog']);
    assert.equal('fogTheme' in rec, false);
    assert.equal(rec.mapBlob, 'kept');
  });
});

describe('the fog look in a Claude edit', () => {
  it('names the fog theme alone, so an undo never reaches the weather', () => {
    assert.deepEqual(mcpMapKeys(['fogTheme']), ['fogTheme']);
    const rec = { id: 's', weather: 'blizzard', fogTheme: 'ice', fogSettings: { pickedHex: '#000000' } };
    const keys = mcpMapKeys(['fogTheme']);
    const before = mcpMapSnapshot(mcpMapRecordRead(rec, keys, DEFAULTS), keys);
    const edit = mcpMapRecordRead(rec, keys, DEFAULTS);
    edit.fogTheme = 'default';
    mcpMapRecordWrite(rec, edit, keys);
    assert.equal('fogTheme' in rec, false);
    rec.weather = 'storm';   // the DM's own pick, made after Claude's step
    mcpMapRecordWrite(rec, before, keys);
    assert.equal(rec.fogTheme, 'ice');
    assert.equal(rec.weather, 'storm');
    // The old settings are never rewritten: the previous release still reads them.
    assert.equal(rec.fogSettings.pickedHex, '#000000');
  });
  it('leaves any other part alone', () => {
    const rec = { id: 's', weather: 'storm', fogTheme: 'ice', gridConfig: { cellSize: 40 } };
    mcpMapRecordWrite(rec, { gridConfig: { cellSize: 70 } }, mcpMapKeys(['grid']));
    mcpMapRecordWrite(rec, { polygons: [], nextPolygonId: 1 }, mcpMapKeys(['rooms']));
    assert.equal(rec.weather, 'storm');
    assert.equal(rec.fogTheme, 'ice');
  });
  it('keeps a theme id a newer release wrote when its read-back default is written again', () => {
    const rec = { id: 's', fogTheme: 'aurora' };
    const keys = mcpMapKeys(['fogTheme']);
    const d = mcpMapRecordRead(rec, keys, DEFAULTS);
    assert.equal(d.fogTheme, 'default');
    mcpMapRecordWrite(rec, d, keys);
    assert.equal(rec.fogTheme, 'aurora');
    mcpMapRecordWrite(rec, { fogTheme: 'ice' }, keys);
    assert.equal(rec.fogTheme, 'ice');
  });
});

describe('weather in a Claude edit', () => {
  const edit = (rec, parts, set) => {
    const keys = mcpMapKeys(parts);
    const before = mcpMapSnapshot(mcpMapRecordRead(rec, keys, DEFAULTS), keys);
    const d = mcpMapRecordRead(rec, keys, DEFAULTS);
    Object.assign(d, set);
    mcpMapRecordWrite(rec, d, keys);
    return () => mcpMapRecordWrite(rec, before, keys);
  };
  it('is its own part', () => {
    assert.deepEqual(mcpMapKeys(['weather']), ['weather']);
    assert.deepEqual(mcpMapKeys(['fogTheme', 'weather']), ['fogTheme', 'weather']);
  });
  it('undoes only weather when only weather was set', () => {
    const rec = { id: 's', fogTheme: 'ice', weather: 'rain' };
    const undo = edit(rec, ['weather'], { weather: 'storm' });
    assert.equal(rec.weather, 'storm');
    rec.fogTheme = 'blood';   // the DM's pick after Claude's step
    undo();
    assert.equal(rec.weather, 'rain');
    assert.equal(rec.fogTheme, 'blood');
  });
  it('undoes only the theme when only the theme was set', () => {
    const rec = { id: 's', fogTheme: 'ice', weather: 'rain' };
    const undo = edit(rec, ['fogTheme'], { fogTheme: 'fire' });
    rec.weather = 'snowfall';
    undo();
    assert.equal(rec.fogTheme, 'ice');
    assert.equal(rec.weather, 'snowfall');
  });
  it('undoes both when both were set', () => {
    const rec = { id: 's', fogTheme: 'ice', weather: 'rain' };
    const undo = edit(rec, ['fogTheme', 'weather'], { fogTheme: 'default', weather: 'none' });
    assert.equal('fogTheme' in rec || 'weather' in rec, false);
    undo();
    assert.equal(rec.fogTheme, 'ice');
    assert.equal(rec.weather, 'rain');
  });
  it('keeps a weather id a newer release wrote when the edit does not set weather, or reads it back as none', () => {
    const rec = { id: 's', weather: 'hail', fogTheme: 'ice' };
    edit(rec, ['fogTheme'], { fogTheme: 'fire' });
    assert.equal(rec.weather, 'hail');
    mcpMapRecordWrite(rec, mcpMapRecordRead(rec, ['weather'], DEFAULTS), ['weather']);
    assert.equal(rec.weather, 'hail');
    mcpMapRecordWrite(rec, { weather: 'rain' }, ['weather']);
    assert.equal(rec.weather, 'rain');
    mcpMapRecordWrite(rec, { weather: 'none' }, ['weather']);
    assert.equal('weather' in rec, false);
  });
});
