'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
global.esWithUids = require('../src/scenes/editStamps.js').esWithUids;
const { resolveSceneName, mapExtFromScene, sceneBackupMeta } = require('../src/scenes/backup.js');

describe('resolveSceneName', () => {
  test('fresh name returned as-is and added to Set', () => {
    const used = new Set();
    const result = resolveSceneName('Crypt', used);
    assert.equal(result, 'Crypt');
    assert.ok(used.has('Crypt'));
  });

  test('one collision → appends (2)', () => {
    const used = new Set(['Crypt']);
    const result = resolveSceneName('Crypt', used);
    assert.equal(result, 'Crypt (2)');
    assert.ok(used.has('Crypt (2)'));
  });

  test('two collisions → appends (3)', () => {
    const used = new Set(['Crypt', 'Crypt (2)']);
    const result = resolveSceneName('Crypt', used);
    assert.equal(result, 'Crypt (3)');
    assert.ok(used.has('Crypt (3)'));
  });

  test('gap-fill: has (2) and (4) but not (3) → returns (3)', () => {
    const used = new Set(['Crypt', 'Crypt (2)', 'Crypt (4)']);
    const result = resolveSceneName('Crypt', used);
    assert.equal(result, 'Crypt (3)');
    assert.ok(used.has('Crypt (3)'));
  });

  test('resolved name is added to the Set each call', () => {
    const used = new Set();
    resolveSceneName('X', used);
    resolveSceneName('X', used);
    assert.ok(used.has('X'));
    assert.ok(used.has('X (2)'));
  });
});

describe('mapExtFromScene', () => {
  test('video + mapPath with .mp4 → .mp4', () => {
    assert.equal(mapExtFromScene({ mapType: 'video', mapPath: 'dungeon.mp4' }), '.mp4');
  });

  test('video + no extension → .webm', () => {
    assert.equal(mapExtFromScene({ mapType: 'video', mapPath: 'dungeon' }), '.webm');
  });

  test('video + missing mapPath → .webm', () => {
    assert.equal(mapExtFromScene({ mapType: 'video' }), '.webm');
  });

  test('video + multi-dot path → last ext only', () => {
    assert.equal(mapExtFromScene({ mapType: 'video', mapPath: 'a.b.webm' }), '.webm');
  });

  test('image blob image/png → .png', () => {
    assert.equal(mapExtFromScene({ mapBlob: { type: 'image/png' } }), '.png');
  });

  test('image blob image/gif → .gif', () => {
    assert.equal(mapExtFromScene({ mapBlob: { type: 'image/gif' } }), '.gif');
  });

  test('image blob image/jpeg → .jpg', () => {
    assert.equal(mapExtFromScene({ mapBlob: { type: 'image/jpeg' } }), '.jpg');
  });

  test('image with no blob → .jpg', () => {
    assert.equal(mapExtFromScene({}), '.jpg');
  });
});

describe('sceneBackupMeta', () => {
  test('carries the TV fit into the zip, and leaves an Off scene without one', () => {
    const scene = { id: 'a', name: 'Tall', tvFit: { step: 2, turn: 270 } };
    assert.deepEqual(sceneBackupMeta(scene, '.jpg', 'image/jpeg', []).tvFit, { step: 2, turn: 270 });
    assert.equal(sceneBackupMeta({ id: 'b' }, '.jpg', 'image/jpeg', []).tvFit, undefined);
  });
  // Every field a saved scene record holds, but the files the zip carries beside the manifest.
  const FULL = {
    id: 'a', name: 'Crypt', group: 'g1', worldPos: { x: 10, y: 20 }, mapType: 'video', mapWidth: 4000, mapHeight: 3000,
    polygons: [{ id: 1, uid: 'r1', name: 'Hall', mode: 'shroud', vertices: [{ x: 0, y: 0 }], cornerRadii: [2] }],
    nextPolygonId: 7, notes: 'DM notes',
    effects: [{ id: 1, uid: 'e1', material: 'water', vertices: [{ x: 1, y: 1 }] }], nextEffectId: 4,
    lightsHidden: true, lightShapes: [{ id: 1, vertices: [{ x: 5, y: 5 }] }], floorPlan: { format: 0.3, walls: [] },
    gridConfig: { size: 70, offsetX: 3 }, fogSettings: { blur: 5 }, fogTheme: 'ice', weather: 'rain',
    tvFit: { step: 1, turn: 90 }, createdAt: 123, sortOrder: 5, edits: { scene: { fog: 100 } },
  };
  const FILES = ['mapBlob', 'mapPath', 'baseFogBlob', 'thumbnail', 'pictureBlobs'];

  test('carries every persisted scene field into the zip unchanged', () => {
    const meta = sceneBackupMeta({ ...FULL, mapBlob: {}, baseFogBlob: {}, thumbnail: {}, pictureBlobs: {} }, '.webm', 'video/webm', ['p.png']);
    for (const [k, v] of Object.entries(FULL)) assert.deepEqual(meta[k], v, k);
    assert.equal(meta.mapExt, '.webm');
    assert.equal(meta.mapMimeType, 'video/webm');
    assert.deepEqual(meta.pictures, ['p.png']);
    for (const k of FILES) assert.equal(meta[k], undefined, k + ' goes in the zip as a file');
    assert.deepEqual(Object.keys(meta).filter(k => !(k in FULL)).sort(), ['mapExt', 'mapMimeType', 'pictures']);
  });

  test('carries the weather of each map into the zip, and leaves a dry map without one', () => {
    assert.equal(sceneBackupMeta({ id: 'a', weather: 'storm' }, '.jpg', 'image/jpeg', []).weather, 'storm');
    assert.equal(sceneBackupMeta({ id: 'b' }, '.jpg', 'image/jpeg', []).weather, undefined);
  });
});
