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
});
