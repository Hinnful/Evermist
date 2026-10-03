'use strict';

// lights.js — LIGHTS, whole.
//
// THE GOAL OF THIS FEATURE: players ask "is this spot lit?", mostly to find darkness to hide in.
// Lights are polygons the DM edits like rooms and effects, in a mode of their own. A floor plan
// seeds them once - each light's room, clipped by its radius - and a daytime map is drawn by hand.
// The TV shows a faint line round the lit areas, under the fog. Every check below serves that.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its
// letter, wherever in the file that state is cheapest to reach.
//
//   A. The Lights row in Scene control loads a .dd2vtt as the Rooms row does and draws its lights;
//      the icon beside it redraws them from the file.
//      The TV is sent the same number of outlines, and draws them only where the fog is fully cleared:
//      none over shrouded or half-shrouded ground, though the polygons stay.
//   B. Seeded lights are clean: the lights of one room are one polygon, and none overlap another.
//   C. Lights are edited in Effects mode beside the fires. They are picked, moved, reshaped and deleted
//      with the same tools as a room. A light has no name, no description and no off switch.
//   D. Light is an effect type: pick a shape, pick the Light material, place it, by hand or with a
//      size preset. There is no Light tool. A fire and a light never share an id.
//   E. The Lights eye in Scene control hides every light in the scene, on the DM map and the TV,
//      and shows them again. A light has no name or description, and no Room tab.
//   F. Every light change rides Auto/Manual sync: with Auto off the TV keeps its old lights until
//      Send is pressed.
//   G. Undo covers each change: the eye, a drawing and a delete.
//   H. Lights survive a scene switch and come back from the saved scene.
//   I. A scene saved with lights stays loadable by the release before them: lights sit outside
//      `effects` and `polygons`, and a scene without them has none.
//   J. Two-map mode: each column holds and sends its own scene's lights.
//
// ⚠ THE DISK LOOKUP IS STUBBED, as in floor-plan.js: a File built in-page has no path, so
// findPlanForFile can find nothing. The plan is the repo's own real Dungeon Alchemist export.
//
// ⚠ THE PLAN IS 3150px ACROSS AND THE MAP HERE 1400px, so every light must arrive scaled by 4/9.
// A check on the file's own numbers would pass with the scaling deleted.

const fs = require('fs');
const path = require('path');
const lib = require('../../lib');

const MAP_W = 1400, MAP_H = 900;
const MAP_B_W = 1200, MAP_B_H = 800;
const PLAN = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'test', 'fixtures', 'sample-map.dd2vtt'), 'utf8');
const PLAN_LIGHTS = 2;   // the sample's 6 lights, merged where they share a room

module.exports = async function lightsFeature(rig) {
  const dm = rig.dm;

  await dm.evaluate('(() => { globalThis.__rigPlanText = ' + JSON.stringify(PLAN) + ';' +
    ' window.findPlanForFile = async () => globalThis.__rigPlanText;' +
    ' findPlanForFile = window.findPlanForFile; return 0; })()');
  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await dm.waitFor('!!mapOffscreen && fogCoverT === 0', 60000, 'the DM map surface');
  const planId = await dm.evaluate('currentScene.id');
  const tv = await rig.player();
  await lib.installHelpers(tv);
  await dm.evaluate('(() => { if (!autoSync) document.getElementById("btn-auto-sync").click();' +
    ' setPlaceMode("effects"); setShape("select"); return 0; })()');

  const tvCount = () => tv.evaluate('lightPolys.length');
  const dmCount = () => dm.evaluate('lightPolys.length');
  const tvShows = async n => {
    await lib.settle(tv, 'lightPolys.length === ' + n, 15000);
    return (await tvCount()) === n;
  };
  const shapeCount = () => dm.evaluate('lightShapes.length');
  const centreOf = i => dm.evaluate('(l => ({ x: l.vertices.reduce((s, v) => s + v.x, 0) / l.vertices.length,' +
    ' y: l.vertices.reduce((s, v) => s + v.y, 0) / l.vertices.length }))(lightShapes[' + i + '])');

  // ── A. Draw lights from the floor plan ─────────────────────────────────────
  // RED ON: the fog mask gated off with true || in _lightMaskedByFog (lights.js) - the two shroud checks FAIL - 2026-10-03
  rig.check(await shapeCount() === 0 && await dmCount() === 0, 'a map with a plan came up with lights nobody drew');
  rig.check(await dm.evaluate('!document.getElementById("btn-lights-redraw").disabled'),
            'the redraw icon is disabled on a scene whose plan has lights');
  await dm.evaluate('document.getElementById("btn-lights-redraw").click(); 0');
  rig.check(await shapeCount() === PLAN_LIGHTS, 'the redraw icon made ' + (await shapeCount()) + ' lights, not the plan has ' + PLAN_LIGHTS);
  // Loading a file through the row draws the same lights; a second load asks before replacing.
  await dm.evaluate('(async () => { await loadPlanLights(new File([globalThis.__rigPlanText], "p.dd2vtt")); return 0; })()');
  rig.check(await dm.evaluate('(() => { const a = document.getElementById("cd-anchor"); return !!a && a.style.display === "flex"; })()'),
            'loading a plan over lights that exist did not ask before replacing them');
  await dm.evaluate('document.getElementById("cd-ok") && document.getElementById("cd-ok").click(); 0');
  await lib.settle(dm, 'lightShapes.length === ' + PLAN_LIGHTS, 10000);
  rig.check(await shapeCount() === PLAN_LIGHTS, 'loading a plan through the row drew ' + (await shapeCount()) + ' lights');
  rig.check(await tvShows(PLAN_LIGHTS), 'the TV was sent ' + (await tvCount()) + ' outlines, not ' + PLAN_LIGHTS);
  await lib.settle(tv, '_lightSprite && _lightSprite.visible', 15000);
  rig.check(await tv.evaluate('!!_lightSprite && _lightSprite.visible && _lightSprite.parent === pixiEffectsLayer'),
            'the TV holds the light outlines but never drew them under the fog');
  // ⚠ A SPRITE CAN BE VISIBLE AND BLANK: a name clash once filled every outline with NaN, so the TV
  // held lights, a sprite and a texture with not one pixel drawn in it.
  const texPixels = win => win.evaluate(`(() => { const src = _lightSprite.texture.baseTexture.resource.source;
    const d = src.getContext('2d').getImageData(0, 0, src.width, src.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++; return n; })()`);
  // The TV draws a light only where the fog is fully cleared. The map starts shrouded, so the lights
  // are there and nothing is drawn; half fog draws nothing either; cleared fog draws them.
  const setFog = alpha => dm.evaluate(`(() => { const c = fogDataCanvas, x = fogDataCtx;
    x.clearRect(0, 0, c.width, c.height);
    if (${alpha} > 0) { x.fillStyle = '#1a1a2e'; x.globalAlpha = ${alpha}; x.fillRect(0, 0, c.width, c.height); x.globalAlpha = 1; }
    sendToPlayer(true); return 0; })()`);
  const tvTexSettled = async () => { await lib.hold(1200, 'the TV takes the fog and rebuilds the light texture'); return texPixels(tv); };
  rig.check(await tvCount() === PLAN_LIGHTS, 'the lights are not held while the ground is shrouded');
  rig.check(await tvTexSettled() === 0, 'the TV drew lights over shrouded ground');
  await setFog(0.5);
  rig.check(await tvTexSettled() === 0, 'the TV drew lights over half-shrouded ground');
  await setFog(0);
  const drawn = await lib.poll(async () => { const n = await texPixels(tv); return n > 1000 ? { v: n } : null; }, 15000, 250);
  rig.check(!!drawn, 'the TV light texture is blank over cleared fog');
  const dmDrawn = await texPixels(dm);
  rig.check(dmDrawn > 1000, 'the DM light texture is blank: ' + dmDrawn + ' pixels drawn');
  rig.byEye('the outline is a faint thin warm line round the lit areas, on the DM window and the TV');

  // ── B. seeded lights are clean: one polygon per lit area, none stacked ────
  // RED BY DESIGN: written against the fix, never re-proved
  const seeded = await dm.evaluate(`(() => {
    const area = r => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p.x * q.y - q.x * p.y; }, 0)) / 2;
    const lights = planLights(currentScene.floorPlan, mapWidth);
    const ring = s => [s.vertices.map(v => [v.x, v.y])];
    let overlap = 0;
    for (let i = 0; i < lightShapes.length; i++) for (let j = i + 1; j < lightShapes.length; j++) {
      for (const poly of polygonClipping.intersection(ring(lightShapes[i]), ring(lightShapes[j]))) overlap += area(poly[0].map(([x, y]) => ({ x, y })));
    }
    return { firstX: lights[0].x, fileLights: lights.length, overlap: Math.round(overlap) };
  })()`);
  rig.check(Math.abs(seeded.firstX - 7.40823174 * 150 * MAP_W / 3150) < 1, 'the first light is not where the plan puts it once scaled: ' + seeded.firstX);
  rig.check(seeded.fileLights > PLAN_LIGHTS && seeded.overlap === 0,
            'the plan has ' + seeded.fileLights + ' lights and the seeded ones are not one clean polygon per lit area: ' + JSON.stringify(seeded));

  // ── C. picking and moving ─────────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  rig.check(await dm.evaluate('placeMode') === 'effects', 'the app is not in Effects mode');
  const c0 = await centreOf(1);   // the last light is the top one under a click
  await dm.evaluate('__rigClick(' + c0.x + ', ' + c0.y + '); 0');
  const picked = await dm.evaluate('selectedPolygonId');
  rig.check(picked === await dm.evaluate('lightShapes[1].id'), 'a click on a light did not pick it: ' + picked);
  rig.check(await dm.evaluate('lightShapes.every(l => l.name === undefined && l.desc === undefined)'), 'a light carries a name or a description');
  rig.check(await dm.evaluate('(() => { const el = document.getElementById("rp-name"); return !el || el.offsetParent === null; })()'),
            'the Room tab shows a name field for a picked light');
  const x0 = await dm.evaluate('lightShapes[1].vertices[0].x');
  await dm.evaluate('__rigDrag(' + c0.x + ', ' + c0.y + ', ' + (c0.x + 70) + ', ' + c0.y + ', { steps: 5 }); 0');
  rig.check(Math.abs(await dm.evaluate('lightShapes[1].vertices[0].x') - (x0 + 70)) < 1, 'dragging a light did not move it');
  rig.check(await dm.evaluate('document.getElementById("lt-switch") === null'), 'a light still has an off switch');
  await dm.evaluate('setPlaceMode("rooms"); 0');
  rig.check(await dm.evaluate('activeShapeList() === polygons'), 'Rooms mode edits the wrong list');
  await dm.evaluate('setPlaceMode("effects"); setShape("select"); 0');

  // ── D. drawing by hand, and the Light tool ────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  // The Light material turns any shape tool into a light; the default material still draws fire.
  await dm.evaluate('setMaterial("light"); setShape("circle"); __rigDrag(900, 700, 1000, 700, { steps: 4 }); setShape("select"); 0');
  rig.check(await shapeCount() === PLAN_LIGHTS + 1, 'the Circle tool with the Light material did not draw a light');
  rig.check(await dm.evaluate('effects.length') === 0, 'a light drawn by hand landed in effects');
  await dm.evaluate('setMaterial("fire"); setShape("circle"); __rigDrag(1200, 700, 1260, 700, { steps: 4 }); setShape("select"); 0');
  rig.check(await dm.evaluate('effects.length') === 1 && await shapeCount() === PLAN_LIGHTS + 1,
            'the Circle tool with the Fire material drew a light, or no fire');
  // Fires and lights are picked and deleted one at a time, from the same mode.
  await dm.evaluate('__rigClick(1200, 700); 0');
  rig.check(await dm.evaluate('selectedPolygonId === effects[0].id && !selectedLightShape()'), 'a click on the fire did not pick the fire');
  await dm.evaluate('__rigKey("Delete"); 0');
  rig.check(await dm.evaluate('effects.length') === 0 && await shapeCount() === PLAN_LIGHTS + 1, 'Delete on the fire took a light with it');
  rig.check(await dm.evaluate('new Set([...effects, ...lightShapes].map(s => s.id)).size === effects.length + lightShapes.length'),
            'a fire and a light share an id');
  // The size presets place a light too, once the Light material is picked.
  await dm.evaluate('setMaterial("light"); setShape("circle"); 0');
  const px = await dm.evaluate('presetPxPerFt()');
  await dm.evaluate('[...document.querySelectorAll("#ctx-presets [data-preset]")].find(b => b.textContent === "30").click(); __rigClick(300, 600); 0');   // 30 ft
  const placed = await dm.evaluate('(l => ({ r: Math.max(...l.vertices.map(v => Math.hypot(v.x - 300, v.y - 600))), n: lightShapes.length, sel: selectedPolygonId === l.id, shape, fx: effects.length }))(lightShapes[lightShapes.length - 1])');
  rig.check(Math.abs(placed.r - 30 * px) < 1 && placed.n === PLAN_LIGHTS + 2 && placed.sel && placed.shape === 'select' && placed.fx === 0,
            'the 30 ft circle preset with the Light material did not place a picked light there: ' + JSON.stringify(placed));
  rig.check(await dm.evaluate('!document.getElementById("btn-light")'), 'a separate Light tool is still on the bar');
  rig.check(await tvShows(PLAN_LIGHTS + 2), 'the TV did not get the drawn lights');
  await dm.evaluate('__rigKey("Delete"); 0');
  rig.check(await shapeCount() === PLAN_LIGHTS + 1 && await tvShows(PLAN_LIGHTS + 1), 'Delete did not remove the picked light, here and on the TV');

  // ── E. the eye hides every light ──────────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  const live = await dmCount();
  await dm.evaluate('document.getElementById("cp-lights-eye").click(); 0');
  rig.check(await dm.evaluate('lightsHidden') === true && await dmCount() === 0, 'the Lights eye did not hide the lights');
  await lib.settle(dm, '!cursorDirty', 5000);
  rig.byEye('with the eye closed the light outlines are gone from the DM map too');
  rig.check(await tvShows(0), 'the TV still shows lights the eye hid');
  rig.check(await dm.evaluate('document.getElementById("cp-lights-eye").classList.contains("off")'), 'the eye does not say the lights are hidden');
  await dm.evaluate('document.getElementById("cp-lights-eye").click(); 0');
  rig.check(await dmCount() === live && await tvShows(live), 'a second click did not bring the lights back');

  // ── F. Auto/Manual gates the TV ───────────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('document.getElementById("btn-auto-sync").click(); 0');
  rig.check(await dm.evaluate('autoSync') === false, 'Auto did not switch off');
  const before = await tvCount();
  await dm.evaluate('selectedPolygonId = lightShapes[0].id; deleteSelectedPolygon(); 0');
  await lib.hold(1200, 'a light deleted with Auto off must not have reached the TV');
  rig.check(await tvCount() === before, 'a light deleted with Auto off went to the TV before Send');
  await dm.evaluate('sendToPlayer(); 0');
  rig.check(await tvShows(before - 1), 'Send did not carry the deleted light to the TV');
  await dm.evaluate('document.getElementById("btn-auto-sync").click(); undo(); 0');

  // ── G. undo covers each change ────────────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('clearUndo(); 0');
  const n0 = await shapeCount();
  await dm.evaluate('toggleLightsHidden(); undo(); 0');
  rig.check(await dm.evaluate('lightsHidden') === false, 'undo did not undo the eye');
  await dm.evaluate('setMaterial("light"); setShape("circle"); __rigDrag(500, 300, 560, 300, { steps: 3 }); undo(); 0');
  rig.check(await shapeCount() === n0, 'undo did not take a drawn light back');
  await dm.evaluate('redo(); 0');
  rig.check(await shapeCount() === n0 + 1, 'redo did not put the light back');
  await dm.evaluate('setShape("select"); selectedPolygonId = lightShapes[lightShapes.length - 1].id; __rigKey("Delete"); undo(); 0');
  rig.check(await shapeCount() === n0 + 1, 'undo did not bring back a deleted light');

  // ── H. lights survive a scene switch ─────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('doAutoSave(); 0');
  const keep = await dm.evaluate('({ n: lightShapes.length })');
  await dm.evaluate('(() => { globalThis.__rigPlanText = null; return 0; })()');
  const otherId = await dm.evaluate('(async () => { const m = ' +
    (await rig.fixtures.asFileExpr(dm, await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: MAP_B_W, h: MAP_B_H }))) +
    '; await createNewScene(m); return currentScene.id; })()', 180000);
  await dm.waitFor('currentScene && currentScene.id === ' + JSON.stringify(otherId) + ' && mapWidth === ' + MAP_B_W + ' && fogCoverT === 0',
                   180000, 'the plain map to load');
  rig.check(await shapeCount() === 0 && await dmCount() === 0, 'the plan scene\'s lights followed the DM onto a map with none');
  rig.check(await dm.evaluate('document.getElementById("btn-lights-redraw").disabled'), 'the redraw icon is enabled on a map with no plan');
  await dm.evaluate('switchScene(' + JSON.stringify(planId) + '); 0');
  await dm.waitFor('currentScene && currentScene.id === ' + JSON.stringify(planId) + ' && fogCoverT === 0', 60000, 'the plan scene back');
  const back = await dm.evaluate('({ n: lightShapes.length })');
  rig.check(back.n === keep.n, 'a scene switch and back lost lights: ' + JSON.stringify([keep, back]));
  rig.byEye('after a backup restore the lights return as they were (the save dialog is native, so the rig cannot run it)');

  // ── I. rollback: the previous release's load path still opens the scene ───
  // RED BY DESIGN: written against the fix, never re-proved
  const stored = await lib.poll(async () => {
    const s = await dm.evaluate('(async () => { const s = await sceneStore.loadScene(' + JSON.stringify(planId) + ');' +
      ' return { n: (s.lightShapes || []).length, effectsOk: (s.effects || []).every(e => Array.isArray(e.vertices)),' +
      ' polysOk: (s.polygons || []).every(p => Array.isArray(p.vertices)) }; })()');
    return s.n > 0 ? { v: s } : null;
  }, 30000, 250);
  rig.check(!!stored && stored.v.effectsOk && stored.v.polysOk,
            'the saved scene lacks lights, or its effects and rooms are not what the previous release reads: ' + JSON.stringify(stored && stored.v));
  const blank = await dm.evaluate('(() => { loadSceneLights({}); return { n: lightShapes.length, hidden: lightsHidden, live: lightPolys.length }; })()');
  rig.check(blank.n === 0 && blank.hidden === false && blank.live === 0, 'a scene saved before lights did not open with none: ' + JSON.stringify(blank));
  await dm.evaluate('switchScene(' + JSON.stringify(otherId) + '); 0');
  await dm.waitFor('currentScene && currentScene.id === ' + JSON.stringify(otherId) + ' && fogCoverT === 0', 60000, 'the plain map');
  await dm.evaluate('switchScene(' + JSON.stringify(planId) + '); 0');
  await dm.waitFor('currentScene && currentScene.id === ' + JSON.stringify(planId) + ' && fogCoverT === 0', 60000, 'the plan scene');

  // ── J. two maps ──────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  const mine = await dmCount();
  await dm.evaluate('document.getElementById("btn-two-maps").click(); 0');
  await dm.waitFor('panesActive && panes.A.ready && panes.B.ready', 180000, 'both columns to come up');
  const paneA = await rig.pane('A');
  const paneB = await rig.pane('B');
  await paneA.waitFor('typeof currentScene !== "undefined" && currentScene && !!mapOffscreen', 60000, 'column A to hold a map');
  await dm.evaluate('loadSceneIntoSelectedPane(' + JSON.stringify(otherId) + '); 0');
  await dm.waitFor('panes.B.sceneId === ' + JSON.stringify(otherId), 60000, 'the plain map to land in column B');
  await paneB.waitFor('typeof currentScene !== "undefined" && currentScene && !!mapOffscreen', 60000, 'column B to hold a map');
  rig.check(await paneA.evaluate('lightPolys.length') === mine && await paneB.evaluate('lightPolys.length') === 0,
            'the columns did not each hold their own lights: A ' + (await paneA.evaluate('lightPolys.length')) +
            ', B ' + (await paneB.evaluate('lightPolys.length')));
  const tvA = await rig.stageHalf('A');
  const tvB = await rig.stageHalf('B');
  await lib.settle(tvA, 'lightPolys.length === ' + mine, 30000);
  rig.check(await tvA.evaluate('lightPolys.length') === mine && await tvB.evaluate('lightPolys.length') === 0,
            'a half of the Player screen shows the other column lights: A ' + (await tvA.evaluate('lightPolys.length')) +
            ', B ' + (await tvB.evaluate('lightPolys.length')));
  await paneB.evaluate('addLightShape([{x:100,y:100},{x:300,y:100},{x:300,y:300}]); scheduleAutoSync(); 0');
  await lib.settle(tvB, 'lightPolys.length === 1', 30000);
  rig.check(await tvB.evaluate('lightPolys.length') === 1 && await tvA.evaluate('lightPolys.length') === mine,
            'a light drawn in column B did not reach its half alone: A ' + (await tvA.evaluate('lightPolys.length')) +
            ', B ' + (await tvB.evaluate('lightPolys.length')));
};
