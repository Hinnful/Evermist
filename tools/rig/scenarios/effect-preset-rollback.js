'use strict';

// effect-preset-rollback.js - A MAP WITH SIZED EFFECTS OPENS ON THE PREVIOUS RELEASE AND COMES BACK (spec
// edit-row-redesign, DoD 19).
//
// One profile, in Russian. This build places a 20 ft fire Circle and a 10 ft light Square, each storing its size
// (`preset`) on the record, resizes the Circle to 30 ft through the effect popup, and saves. The previous release,
// 5.14.8, extracted under ~/.cache/evermist-rig/prev-5.14.8/, then opens the same library, drags one corner of the
// Circle and saves; this build opens it once more. A run against any other previous release fails on its version
// line, since the trip it checks is back to 5.14.8. Console errors fail the run.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   0.  The previous release under the cache is 5.14.8.
//   1.  Here both placed effects carry their size, and the popup resizes the Circle to 30 ft; the save holds both.
//   2.  On 5.14.8 the map opens with no page error, console error or error dialog, and both effects are there with
//       the outlines and materials this build saved.
//   3.  On 5.14.8 a corner of the Circle drags, keeping its corner count, and saves.
//   4.  Back on this build the map opens with no error; the Circle keeps 5.14.8's corner, its popup reads "От руки"
//       and its Size is greyed; the untouched light still resizes from its size, to 15 ft.

const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../lib');
const kit = require('../backupKit');

const PREV = path.join(os.homedir(), '.cache', 'evermist-rig', 'prev-5.14.8', 'evermist');
const q = JSON.stringify;
const FIRE = { x: 600, y: 800 }, LIGHT = { x: 1800, y: 800 };

// Rounded outlines and materials of every effect and light, to compare across builds.
const SHAPES = `({
  effects: effects.map(e => ({ id: e.id, material: e.material, n: e.vertices.length,
    v: e.vertices.map(p => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]) })),
  lights: lightShapes.map(e => ({ id: e.id, n: e.vertices.length,
    v: e.vertices.map(p => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]) })),
})`;
const DIALOG = '(typeof _cdOpen !== "undefined" && _cdOpen ? (document.getElementById("cd-msg") || {}).textContent || "a dialog" : "")';

const open = async (dm, id) => {
  await dm.evaluate(`switchScene(${q(id)})`, 60000);
  await lib.settle(dm, `!!currentScene && currentScene.id === ${q(id)} && fogCoverT === 0 && !fogDirty`, 60000);
  await dm.evaluate('(() => { if (worldMapOpen) worldMapHide(); setPlaceMode("effects"); setShape("select"); return 0; })()');
  return dm.evaluate(SHAPES);
};

// The page's own errors since it started, and any error dialog on screen.
const faults = async dm => {
  const dialog = await dm.evaluate(DIALOG);
  return (dm.errors || []).slice().concat(dialog ? ['dialog: ' + dialog] : []);
};

// The popup over the picked effect: whether it shows, its size, and whether it reads By hand.
const POPUP = `(() => {
  const el = document.getElementById('fx-pop'), f = el && el.querySelector('.sz-field');
  if (!f || el.style.display !== 'flex') return null;
  const hand = f.querySelector('.sz-hand');
  return { size: f.querySelector('.sz-in').value, greyed: f.classList.contains('off') && f.querySelector('.sz-in').disabled,
           hand: hand.textContent, handShown: getComputedStyle(hand).display !== 'none' };
})()`;

const pick = async (dm, at, id) => {
  await dm.evaluate(`(() => { __rigClick(${at.x}, ${at.y}); return 0; })()`);
  await lib.settle(dm, `selectedPolygonId === ${id} && document.getElementById('fx-pop').style.display === 'flex'`, 10000);
  return dm.evaluate(POPUP);
};

const resize = async (dm, s) => {
  await dm.evaluate(`(() => { const i = document.querySelector('#fx-pop .sz-in'); i.value = '${s}';
    i.dispatchEvent(new Event('change')); return 0; })()`);
};

module.exports = async function effectPresetRollback(rig) {
  if (!rig.check(fs.existsSync(PREV), '0: no previous release is extracted at ' + PREV)) return;
  let dm = await lib.inRussian(rig);
  await kit.install(dm);
  const id = await dm.evaluate(`(async () => {
    const f = await __bk.noiseFile('Эффекты', 2400, 1600, 7, 0.85);
    const r = await addMapsToLibrary([f], { x: 0, y: 400 }, true);
    return r.ids[0];
  })()`, 240000);

  let here = null, fireId = null, lightId = null;
  await lib.step(rig, '1 here', async () => {
    await open(dm, id);
    const placed = await dm.evaluate(`(() => {
      const arm = (kind, s) => { effectsToolArm(kind); setPreset({ kind, ...EFFECT_PRESETS[kind].find(z => z.s === s) }); };
      setMaterial('fire'); arm('circle', 20); __rigClick(${FIRE.x}, ${FIRE.y});
      setMaterial('light'); arm('rect', 10); __rigClick(${LIGHT.x}, ${LIGHT.y});
      setMaterial('fire');
      const f = effects[effects.length - 1], l = lightShapes[lightShapes.length - 1];
      return { fire: f && { id: f.id, material: f.material, preset: f.preset }, light: l && { id: l.id, preset: l.preset } };
    })()`);
    rig.check(placed.fire && placed.fire.material === 'fire' && placed.fire.preset && placed.fire.preset.kind === 'circle' &&
              placed.fire.preset.s === 20 && placed.light && placed.light.preset && placed.light.preset.kind === 'rect' &&
              placed.light.preset.s === 10, '1: placing should store each effect\'s size, got ' + q(placed));
    fireId = placed.fire && placed.fire.id;
    lightId = placed.light && placed.light.id;
    const before = await pick(dm, FIRE, fireId);
    rig.check(before && before.size === '20' && !before.greyed, '1: the fire Circle\'s popup should read 20 ft, got ' + q(before));
    await resize(dm, 30);
    await lib.settle(dm, `(effects.find(e => e.id === ${fireId}) || {}).preset && effects.find(e => e.id === ${fireId}).preset.s === 30`, 10000);
    await dm.evaluate('doAutoSave()', 60000);
    here = await dm.evaluate(SHAPES);
    const stored = await dm.evaluate(`sceneStore.loadScene(${q(id)}).then(s => ({
      fire: (s.effects.find(e => e.id === ${fireId}) || {}).preset || null,
      light: (s.lightShapes.find(e => e.id === ${lightId}) || {}).preset || null }))`, 60000);
    rig.check(stored.fire && stored.fire.s === 30 && stored.light && stored.light.s === 10,
      '1: the save should hold the Circle at 30 ft and the light at 10 ft, holds ' + q(stored));
  });
  if (!here || fireId == null || lightId == null) return;

  dm = await rig.restart({ exe: PREV });
  const ver = await dm.evaluate('window.electronAPI.getAppVersion()');
  if (!rig.check(ver === '5.14.8', '0: the previous release under ' + PREV + ' is ' + ver + ', not 5.14.8; refresh the cache')) return;
  await lib.installHelpers(dm);
  let moved = null;
  await lib.step(rig, '2 on 5.14.8', async () => {
    const then = await open(dm, id);
    const bad = await faults(dm);
    rig.check(!bad.length, '2: on 5.14.8 the map should open without error, got ' + q(bad));
    rig.check(q(then) === q(here), '2: on 5.14.8 the effects open as ' + q(then).slice(0, 400) + ', not as saved: ' + q(here).slice(0, 400));
  });
  await lib.step(rig, '3 on 5.14.8', async () => {
    const c = await dm.evaluate(`(() => {
      const f = effects.find(e => e.id === ${fireId}), v = f.vertices[0];
      __rigClick(${FIRE.x}, ${FIRE.y});
      const r = container.getBoundingClientRect();
      container.dispatchEvent(new MouseEvent('dblclick', { clientX: ${FIRE.x} * zoom + panX + r.left,
        clientY: ${FIRE.y} * zoom + panY + r.top, bubbles: true, cancelable: true }));
      return { x: v.x, y: v.y, n: f.vertices.length, edit: shapeEditMode && selectedPolygonId === ${fireId} };
    })()`);
    rig.check(c.edit, '3 setup: a double-click on the Circle should open its corners on 5.14.8');
    const to = { x: c.x + 120, y: c.y + 80 };
    await dm.evaluate(`(() => { __rigDrag(${c.x}, ${c.y}, ${to.x}, ${to.y}, { steps: 4 }); return 0; })()`);
    await dm.evaluate('doAutoSave()', 60000);
    moved = await dm.evaluate(`(() => { const f = effects.find(e => e.id === ${fireId}), v = f.vertices[0];
      return { x: v.x, y: v.y, n: f.vertices.length }; })()`);
    const tol = 2 / await dm.evaluate('zoom');
    rig.check(moved.n === c.n && Math.hypot(moved.x - to.x, moved.y - to.y) <= tol,
      '3: on 5.14.8 the Circle\'s corner should drag to ' + q(to) + ' keeping ' + c.n + ' corners, got ' + q(moved));
    const bad = await faults(dm);
    rig.check(!bad.length, '3: editing on 5.14.8 should raise no error, got ' + q(bad));
  });
  if (!moved) return;

  dm = await rig.restart({ exe: null });
  await lib.installHelpers(dm);
  await lib.step(rig, '4 back here', async () => {
    const back = await open(dm, id);
    const bad = await faults(dm);
    rig.check(!bad.length, '4: back on this build the map should open without error, got ' + q(bad));
    const f = back.effects.find(e => e.id === fireId);
    rig.check(f && Math.abs(f.v[0][0] - moved.x) < 0.02 && Math.abs(f.v[0][1] - moved.y) < 0.02,
      '4: the Circle should keep the corner 5.14.8 moved, got ' + q(f && f.v[0]) + ' for ' + q(moved));
    const fire = await pick(dm, FIRE, fireId);
    rig.check(fire && fire.greyed && fire.handShown && fire.hand === 'От руки',
      '4: the Circle edited on 5.14.8 should read "От руки" with Size greyed, got ' + q(fire));
    const light = await pick(dm, LIGHT, lightId);
    rig.check(light && light.size === '10' && !light.greyed, '4: the untouched light should still read 10 ft, got ' + q(light));
    const was = back.lights.find(e => e.id === lightId);
    await resize(dm, 15);
    await lib.settle(dm, `(lightShapes.find(e => e.id === ${lightId}) || {}).preset && lightShapes.find(e => e.id === ${lightId}).preset.s === 15`, 10000);
    const now = await dm.evaluate(`(() => { const l = lightShapes.find(e => e.id === ${lightId});
      const xs = l.vertices.map(v => v.x); return { s: l.preset && l.preset.s, w: Math.max(...xs) - Math.min(...xs) }; })()`);
    const wasW = Math.max(...was.v.map(p => p[0])) - Math.min(...was.v.map(p => p[0]));
    rig.check(now.s === 15 && Math.abs(now.w / wasW - 1.5) < 0.01,
      '4: the untouched light should resize from 10 to 15 ft (1.5 times as wide), got ' + q(now) + ' from width ' + wasW);
  });
};
