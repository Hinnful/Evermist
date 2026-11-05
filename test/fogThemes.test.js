'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/fog/themes/fogThemes.js');
require('../src/fog/themes/default.js');
require('../src/fog/themes/blood.js');
require('../src/fog/themes/toxic.js');
require('../src/fog/themes/ice.js');
require('../src/fog/themes/fire.js');
const { parseSceneFogSettings } = require('../src/fog/fogColor.js');
global.esWithUids = require('../src/scenes/editStamps.js').esWithUids;
const E = require('../src/scenes/editStamps.js');
const TP = require('../src/scenes/transferPlan.js');
const { sceneBackupMeta } = require('../src/scenes/backup.js');

describe('the fog theme records', () => {
  it('list the five themes in the dropdown order, each with what the dropdown and the TV need', () => {
    assert.deepEqual(T.FOG_THEMES.map(t => t.id), ['default', 'blood', 'toxic', 'ice', 'fire']);
    for (const t of T.FOG_THEMES) {
      assert.match(t.hex, /^#[0-9a-f]{6}$/);
      assert.equal(t.swatch, t.hex);
      assert.ok(t.label && t.tint > 0 && t.tint < 1);
      assert.equal(t.passCol.length, 3);
      assert.equal(t.rim.length, 3);
      assert.ok(t.shader.length > 0);
    }
  });
  it('give each theme its own transition: durations, a front, a rank and a fogStep with a screenRank', () => {
    for (const t of T.FOG_THEMES) {
      const tr = t.trans;
      assert.ok(tr.dur.length === 2 && tr.dur.every(ms => ms >= 2000 && ms <= 4000), t.id);
      assert.ok(tr.front.length === 3 && tr.front.every(c => c >= 0 && c <= 1), t.id);
      assert.ok(tr.tint === 0 || tr.tint === 1);
      assert.match(tr.glsl, /float fogStep\(float rk, float e, vec2 sp, float dir\)/);
      assert.match(tr.glsl, /float screenRank\(vec2 sp, float n, float dir\)/);
      const w = [0, .3, 1];
      for (const dir of [1, -1]) for (const wd of w) {
        const r = tr.rank(.4, .6, .5, .5, dir, wd, (x, y) => (x + y) % 1);
        assert.ok(Number.isFinite(r) && r >= -.01 && r <= 1.01, t.id + ' ' + r);
      }
    }
  });
  it('shape the rank their own way: Ice from the walls in, Blood from the top down', () => {
    const ice = T.fogThemeRecord('ice').trans.rank, blood = T.fogThemeRecord('blood').trans.rank, vn = () => .5;
    assert.ok(ice(.5, .5, .5, .5, -1, 0) < ice(.5, .5, .5, .5, -1, 1));
    assert.ok(ice(.5, .5, .5, .5, 1, 0) > ice(.5, .5, .5, .5, 1, 1));
    assert.ok(blood(.5, 0, .5, .5, 1, .5, vn) < blood(.5, 1, .5, .5, 1, .5, vn));
  });
  it('let only Fire rise, and only Blood draw no rim', () => {
    assert.deepEqual(T.FOG_THEMES.filter(t => t.rise).map(t => t.id), ['fire']);
    assert.deepEqual(T.fogThemeRecord('blood').rim, [0, 0, 0]);
  });
  it('share Default\'s cloud warp, so a theme switch never rebuilds the cloud frames', () => {
    const d = T.fogThemeRecord('default').anim;
    for (const t of T.FOG_THEMES) {
      assert.equal(t.anim.warpStr, d.warpStr);
      assert.equal(t.anim.warpRad, d.warpRad);
    }
  });
  it('keep their shader source ASCII, which a driver may otherwise reject', () => {
    for (const t of T.FOG_THEMES) assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(t.shaderFns + t.shader + t.trans.glsl), t.id);
  });
});

describe('fogThemeNormalize', () => {
  it('keeps a known id', () => {
    assert.equal(T.fogThemeNormalize('ice'), 'ice');
    assert.equal(T.fogThemeNormalize('default'), 'default');
  });
  it('reads an unknown, missing or non-string id as Default', () => {
    for (const bad of ['lava', '', 'ICE', undefined, null, 3, {}, ['ice'], true]) assert.equal(T.fogThemeNormalize(bad), 'default');
  });
});

describe('a saved map\'s fog theme', () => {
  // This release leaves fogColor.js as it was, so its reader IS the previous release's.
  const rec = { fogTheme: 'ice', fogSettings: { pickedHex: '#c02020', tintAlpha: 0.6, anim: { enabled: true, speed: 0.4, drift: 0.3, morph: 0.12, warpStr: 0.08, warpRad: 0.05, pulse: 0.1 } } };
  const DEF = { hex: '#3a3a8c', alpha: 0.18, anim: { enabled: true, speed: 1, drift: 1, morph: 0.35, warpStr: 0.15, warpRad: 0.08, pulse: 0.3 } };
  it('leaves the old settings readable by the previous release, so /rollback keeps a custom colour', () => {
    const before = parseSceneFogSettings(rec, DEF);
    assert.equal(before.hex, '#c02020');
    assert.equal(before.alpha, 0.6);
    assert.equal(before.anim.speed, 0.4);
    assert.deepEqual(parseSceneFogSettings({ ...rec, fogTheme: undefined }, DEF), before);
  });
  it('reads a bad fogTheme as Default', () => {
    assert.equal(T.fogThemeNormalize(rec.fogTheme), 'ice');
    assert.equal(T.fogThemeNormalize({ ...rec, fogTheme: 7 }.fogTheme), 'default');
    assert.equal(T.fogThemeNormalize({}.fogTheme), 'default');
  });
  it('goes into a backup', () => {
    assert.equal(sceneBackupMeta({ id: 'a', fogTheme: 'ice' }, '.jpg', 'image/jpeg', []).fogTheme, 'ice');
    assert.equal(sceneBackupMeta({ id: 'b' }, '.jpg', 'image/jpeg', []).fogTheme, undefined);
  });
  it('is stamped when it changes, and Default reads as absent', () => {
    const scene = x => ({ id: 's', name: 'Cave', polygons: [], effects: [], notes: '', ...x });
    const snap = E.esSnapshot(scene({}));
    assert.deepEqual(E.esStamp(snap, scene({ fogTheme: 'ice' }), 80, false).scene, { fogSettings: 80 });
    assert.deepEqual(E.esStamp(snap, scene({ fogTheme: 'default' }), 81, false).scene, {});
  });
  it('comes across a zip import with the fog settings, and a newer local one stays', () => {
    const scene = (edits, extra) => ({ id: 's', name: 'Cave', polygons: [], effects: [], notes: '', edits, ...extra });
    const take = TP.tpMergeScene(scene({ scene: { fogSettings: 100 } }), scene({ scene: { fogSettings: 300 } }, { fogTheme: 'ice' }), 10000);
    assert.equal(take.record.fogTheme, 'ice');
    const keep = TP.tpMergeScene(scene({ scene: { fogSettings: 500 } }, { fogTheme: 'ice' }), scene({ scene: { fogSettings: 300 } }, { fogTheme: 'default' }), 10000);
    assert.equal(keep.record.fogTheme, undefined);
  });
});

describe('Claude\'s fog theme tool', () => {
  // Evermist's own main process loads the shim for its tool list; that is the one case it stays off stdio.
  const type = process.type; process.type = 'browser';
  const { TOOLS } = require('../electron/mcpShim.js');
  process.type = type;
  const tool = n => TOOLS.find(t => t.name === n);
  it('offers every theme the app has, by id, and no preset, tint or fogColor', () => {
    const p = tool('set_fog_look').inputSchema.properties;
    assert.deepEqual(p.theme.enum, T.FOG_THEMES.map(t => t.id));
    assert.equal(p.preset, undefined);
    assert.equal(p.tint, undefined);
    assert.equal(tool('set_scene').inputSchema.properties.fogColor, undefined);
  });
});
