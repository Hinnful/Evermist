'use strict';

// effects.js — THE MAP EFFECTS FEATURE, whole.
//
// THE GOAL OF THIS FEATURE: the DM marks ground during play — fire still burning, acid a zombie
// just vomited — and the players see it on the TV, without it hiding or revealing anything.
// Every check below serves that sentence.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks directly beneath it, in order.
//
//   A. Every shape tool draws an effect in Effects mode, and the brush is not offered there.
//   B. Effects and rooms are two lists that never mix, and an effect paints NO fog.
//   C. An effect carries a material and a name of its own.
//   D. An effect actually burns on the DM. It is not an empty layer.
//   E. Rounding an effect's corners takes its fire with it.
//   F. An effect is edited exactly as a room is: selected, moved, deleted, undone.
//   G. Effects ride the Auto/Manual send gate, the same gate fog rides.
//   H. Effects reach the TV, and they are drawn UNDER the fog there — an effect in a room
//      nobody has entered stays secret for free.
//   I. Effects survive a scene switch, because they are placed during play and persist.
//
// ⚠ EFFECTS ARE NOT ROOMS AND NOT TOKENS. An effect is the same record as a room carrying a
// `material` where a room has a fog `mode` (CLAUDE.md). They live in two arrays because array
// order is fog compositing precedence, and an effect has no business in that order.
//
// ⚠ THE FIRE IS ANIMATED, SO NEVER SAMPLE ONE FRAME. A single reading says which frame the
// flame was in, not how brightly the ground burns. Everything here reads the PEAK across a
// spread of frames, which converges on the flame's envelope and is stable run to run.
//
// ⚠ ONLY ONE MATERIAL EXISTS TODAY. The fire ramp is hardcoded, so a second material would
// paint orange whatever its button claimed, and the picker holds one entry on purpose. The
// checks below are written against that; a second material makes C and the picker worth more.

const path = require('path');

const MAP_W = 2400, MAP_H = 1400;
const CLEAR = { x: 800, y: 500, r: 420 };        // revealed: effects here are visible
const DARK  = { x: 1900, y: 900 };               // never revealed: effects here must stay hidden

const HELPERS = `
globalThis.__rigMouse = (type, mx, my) => {
  const r = container.getBoundingClientRect();
  container.dispatchEvent(new MouseEvent(type, {
    clientX: mx * zoom + panX + r.left, clientY: my * zoom + panY + r.top,
    bubbles: true, cancelable: true, button: 0,
  }));
};
globalThis.__rigDrag = (x1, y1, x2, y2) => {
  __rigMouse('mousedown', x1, y1); __rigMouse('mousemove', (x1+x2)/2, (y1+y2)/2);
  __rigMouse('mousemove', x2, y2); __rigMouse('mouseup', x2, y2);
};
globalThis.__rigClick = (mx, my) => { __rigMouse('mousedown', mx, my); __rigMouse('mouseup', mx, my); };
globalThis.__rigKey = (k) => document.dispatchEvent(
  new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
globalThis.__rigFog = (mx, my) => fogDataCtx.getImageData(
  Math.round(mx / FOG_SCALE), Math.round(my / FOG_SCALE), 1, 1).data[3];
// Brightest red in a map-space box, reading the EFFECT LAYER ALONE: the map sprite is hidden
// for the read, so a bright patch of map underneath cannot stand in for a flame.
globalThis.__rigMaxRed = (mx1, my1, mx2, my2) => {
  const w = pixiApp.renderer.width, h = pixiApp.renderer.height;
  const rt = PIXI.RenderTexture.create({ width: w, height: h });
  pixiHideMap();
  pixiApp.renderer.render(pixiApp.stage, { renderTexture: rt, clear: true });
  pixiShowMap();
  const px = pixiApp.renderer.extract.pixels(rt); rt.destroy(true);
  const sx1=Math.max(0,Math.round(mx1*zoom+panX)), sy1=Math.max(0,Math.round(my1*zoom+panY));
  const sx2=Math.min(w-1,Math.round(mx2*zoom+panX)), sy2=Math.min(h-1,Math.round(my2*zoom+panY));
  let best=-1;
  for(let y=sy1;y<=sy2;y+=2) for(let x=sx1;x<=sx2;x+=2){ const i=(y*w+x)*4; if(px[i]>best) best=px[i]; }
  return best;
};
0`;

module.exports = async function effectsFeature(rig) {
  const dm = rig.dm;

  // Sampling has to cross real time: __rigMaxRed renders on demand, but the shader's clock only
  // advances with the ticker, so N renders in one task would all read the same instant.
  const SAMPLES = 8, GAP = 60;
  const peak = async (b) => {
    let best = -1;
    for (let i = 0; i < SAMPLES; i++) {
      const v = await dm.evaluate('__rigMaxRed(' + b.join(',') + ')');
      if (v > best) best = v;
      if (i < SAMPLES - 1) await rig.sleep(GAP);
    }
    return best;
  };

  const still = await rig.fixtures.stillMap(dm, rig.fixtureDir,
    { w: MAP_W, h: MAP_H, name: 'rig-effects.png' });
  await dm.evaluate('createNewScene(' + (await rig.fixtures.asFileExpr(dm, still)) + ')', 120000);
  await dm.waitFor('currentScene && currentScene.mapType === "image" && mapWidth === ' + MAP_W,
                   120000, 'the map to load on the DM');
  await dm.waitFor('!!mapOffscreen', 60000, 'the DM map surface');
  await dm.evaluate(HELPERS);
  await dm.evaluate('revealCircle(' + CLEAR.x + ',' + CLEAR.y + ',' + CLEAR.r + ');' +
                    'rebuildFogEffect(); fogDirty = true; scheduleRender(); 0');
  await dm.waitFor('fogCoverT === 0 && fogTransRafId === null', 30000, 'the clearing to open');

  // ══ A. Every shape tool draws an effect, and the brush is not offered ══
  await dm.evaluate('setPlaceMode("effects"); 0');
  rig.check(await dm.evaluate('placeMode') === 'effects', 'Effects mode did not take');
  rig.check(await dm.evaluate('shape') !== 'brush',
            'the brush survived into Effects mode, where there is no fog for it to paint');
  rig.check(await dm.evaluate('document.getElementById("btn-brush").disabled') === true,
            'the brush button is still live in Effects mode');

  // Exactly one of Rooms/Effects is picked, and the pair sits in its own pill rather than loose
  // in the bar — a pick-one group reads as one control or it reads as two toggles.
  const pill = await dm.evaluate(`(() => {
    const on = id => document.getElementById(id).classList.contains('active');
    const b = document.getElementById('btn-place-effects');
    const r = document.getElementById('btn-place-rooms');
    const bar = document.getElementById('toolbar-bottom');
    return { effects: on('btn-place-effects'), rooms: on('btn-place-rooms'),
             parent: b && b.parentElement ? b.parentElement.id : null,
             shared: !!(b && r && b.parentElement === r.parentElement),
             inBar: !!(b && bar && bar.contains(b)) };
  })()`);
  rig.check(pill.effects && !pill.rooms,
            'the toolbar does not show exactly one of Rooms/Effects picked: ' + JSON.stringify(pill));
  // A pick-one pair reads as ONE control or it reads as two toggles, so the two buttons live in
  // their own pill rather than loose in the bar (the dm-ui skill's button-identity rules).
  // It shipped inside the bar behind a wide gap first and read as just another segment, which
  // is why it has its own container outside the bar now.
  rig.check(pill.parent === 'place-pill' && pill.shared && !pill.inBar,
            'the Rooms/Effects pair is not in its own pill outside the toolbar: ' +
            JSON.stringify(pill));

  const SHAPES = [
    { s: 'rect',   draw: '__rigDrag(600, 300, 800, 450)' },
    { s: 'circle', draw: '__rigDrag(700, 620, 700, 700)' },
    { s: 'cone',   draw: '__rigDrag(950, 400, 1120, 400)' },
    { s: 'poly',   draw: '__rigClick(500, 600); __rigClick(640, 600); __rigClick(640, 720);' +
                         ' __rigClick(500, 600)' },
  ];
  for (let i = 0; i < SHAPES.length; i++) {
    await dm.evaluate('setShape("' + SHAPES[i].s + '"); ' + SHAPES[i].draw + '; 0');
    rig.check(await dm.evaluate('effects.length') === i + 1,
              'the ' + SHAPES[i].s + ' tool made no effect in Effects mode');
  }

  // ══ B. Two lists that never mix, and an effect paints NO fog ══
  rig.check(await dm.evaluate('polygons.length') === 0,
            'drawing in Effects mode appended to the ROOMS list as well, which would put an ' +
            'effect into fog compositing order');
  rig.check(await dm.evaluate('__rigFog(700, 375)') < 40,
            'an effect changed the fog over its own ground. Effects mark ground; they never ' +
            'hide or reveal it');
  const fogSig = await dm.evaluate('fogDataCanvas.toDataURL().length');
  await dm.evaluate('setShape("rect"); __rigDrag(' + (DARK.x - 120) + ',' + (DARK.y - 90) + ',' +
                    (DARK.x + 120) + ',' + (DARK.y + 90) + '); 0');
  rig.check(await dm.evaluate('fogDataCanvas.toDataURL().length') === fogSig,
            'an effect drawn on unexplored ground changed the fog, which would show the players ' +
            'exactly where the DM marked something');

  // ══ C. An effect carries a material and a name of its own ══
  const rec = await dm.evaluate('effects[0]');
  rig.check(rec.material === 'fire',
            'the effect came out with material "' + rec.material + '" rather than the picked one');
  rig.check(/^Fire \d+$/.test(rec.name || ''),
            'the effect was not named after its material: "' + rec.name + '"');
  rig.check(rec.mode === undefined,
            'the effect carries a fog `mode`, which is a room\'s field — the two records must ' +
            'not converge');
  const picker = await dm.evaluate(`(() => {
    const on = document.querySelectorAll('#material-row [data-material].active');
    return { count: on.length, which: on.length ? on[0].dataset.material : null };
  })()`);
  rig.check(picker.count === 1 && picker.which === 'fire',
            'the material picker does not show exactly one material picked: ' + JSON.stringify(picker));

  // ══ D. An effect actually burns on the DM ══
  await dm.waitFor('pixiEffectsLayer && pixiEffectsLayer.children.length > 0', 15000,
                   'the fire meshes to be built');
  const lit = await peak([610, 310, 790, 440]);
  const bare = await peak([300, 900, 480, 1030]);   // revealed-but-empty ground, for comparison
  rig.note('effect layer brightness — over the fire ' + lit + ', over bare map ' + bare);
  rig.check(lit > bare + 20,
            'the effect layer is not painting anything over the effect (' + lit + ' against ' +
            bare + ' on bare ground) — the effect exists as a record and draws nothing');

  // ══ E. Rounding an effect's corners takes its fire with it ══
  // Compared BEFORE against AFTER on the same corner, so the map's own colour under it cannot
  // pass the check — only the DROP in brightness can.
  const RB = { x1: 1300, y1: 250, x2: 1680, y2: 530 };
  await dm.evaluate('setShape("rect"); __rigDrag(' + RB.x1 + ',' + RB.y1 + ',' +
                    RB.x2 + ',' + RB.y2 + '); 0');
  const roundId = await dm.evaluate('effects[effects.length - 1].id');
  await dm.waitFor('pixiEffectsLayer.children.length > 0', 15000, 'the mesh for the new effect');
  const cornerBox = [RB.x1 + 2, RB.y1 + 2, RB.x1 + 22, RB.y1 + 22];
  const edgeBox   = [(RB.x1 + RB.x2) / 2 - 20, RB.y1 + 4, (RB.x1 + RB.x2) / 2 + 20, RB.y1 + 40];
  const cSharp = await peak(cornerBox), eSharp = await peak(edgeBox);
  await dm.evaluate('(() => { const e = effects.find(x => x.id === ' + roundId + ');' +
                    ' selectedPolygonId = e.id; selectedVertexIndex = -1; e.cornerRadius = 80;' +
                    ' effectsChanged(); scheduleRender(); return 0; })()');
  await dm.waitFor('effects.find(x => x.id === ' + roundId + ').cornerRadius === 80', 5000,
                   'the radius to take');
  await rig.sleep(200);
  const cRound = await peak(cornerBox), eRound = await peak(edgeBox);
  rig.note('corner brightness sharp ' + cSharp + ' → rounded ' + cRound +
           ';  straight edge ' + eSharp + ' → ' + eRound);
  rig.check(cSharp > 60, 'the sharp corner never showed fire, so rounding it proves nothing');
  rig.check(cRound < cSharp - 40,
            'rounding the corner did not take the fire with it (' + cSharp + ' → ' + cRound +
            ') — the outline rounded and the flame did not');
  rig.check(eRound > eSharp - 40,
            'rounding the corners dimmed a straight edge that should have been untouched (' +
            eSharp + ' → ' + eRound + ')');

  // ══ F. An effect is edited exactly as a room is ══
  await dm.evaluate('setShape("select"); __rigClick(700, 375); 0');
  rig.check(await dm.evaluate('selectedPolygonId') === rec.id,
            'the Select tool did not pick an effect by clicking inside it');
  const preMove = await dm.evaluate('effects[0].vertices[0].x');
  await dm.evaluate('__rigDrag(700, 375, 760, 375); 0');
  const postMove = await dm.evaluate('effects[0].vertices[0].x');
  const tol = 3 / (await dm.evaluate('zoom'));
  rig.check(Math.abs((postMove - preMove) - 60) < tol,
            'dragging an effect moved it by ' + (postMove - preMove).toFixed(1) + ' instead of 60');
  await dm.evaluate('undo(); 0');
  rig.check(Math.abs(await dm.evaluate('effects[0].vertices[0].x') - preMove) < tol,
            'undo did not put a moved effect back, so an effect edit cannot be taken back');

  const nBefore = await dm.evaluate('effects.length');
  await dm.evaluate('__rigClick(700, 375); __rigKey("Delete"); 0');
  rig.check(await dm.evaluate('effects.length') === nBefore - 1, 'Delete did not remove the effect');
  rig.check(await dm.evaluate('polygons.length') === 0,
            'deleting an effect touched the rooms list');

  // ══ G. Effects ride the Auto/Manual send gate ══
  rig.check(await dm.evaluate('autoSync === true'), 'auto-sync is not on at the start of the gate check');
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen && !!fogDataCanvas', 45000, 'the Player to receive the map');
  await player.waitFor('fogCoverT === 0', 45000, 'the scene cover to lift on the Player');
  try { await player.waitFor('effects.length > 0', 30000, 'the effects drawn so far to arrive'); }
  catch (_) {}
  const arrived = await player.evaluate('effects.length');
  rig.check(arrived > 0, 'not one effect reached the TV with auto-sync on');

  await dm.evaluate('(() => { const b = document.getElementById("btn-auto-sync");' +
                    ' if (autoSync) b.click(); return 0; })()');
  rig.check(await dm.evaluate('autoSync') === false, 'auto-sync did not switch off');
  const heldBefore = await player.evaluate('effects.length');
  await dm.evaluate('setPlaceMode("effects"); setShape("rect");' +
                    ' __rigDrag(400, 350, 520, 450); 0');
  await rig.sleep(1200);
  rig.check(await player.evaluate('effects.length') === heldBefore,
            'an effect drawn with auto-sync OFF went to the TV anyway — the gate that lets the ' +
            'DM prepare before the players see it does not hold for effects');
  await dm.evaluate('sendToPlayer(); 0');
  try { await player.waitFor('effects.length > ' + heldBefore, 20000, 'the manual Send to land'); }
  catch (_) {}
  rig.check(await player.evaluate('effects.length') > heldBefore,
            'pressing Send did not deliver the held effect to the TV');

  // ══ H. Effects reach the TV, and are drawn UNDER the fog ══
  // ⚠ AS SHAPE DESCRIPTORS, NOT PIXELS. The Player paints the material itself, so a wall of
  // fire costs the wire a few dozen bytes; a payload carrying an image would still pass a
  // "something arrived" check.
  const onTv = await player.evaluate(`(() => {
    const e = effects[0];
    return { hasVerts: !!(e && e.vertices && e.vertices.length >= 3),
             material: e && e.material,
             hasPixels: !!(e && (e.image || e.dataUrl || e.pixels)) };
  })()`);
  rig.check(onTv.hasVerts && onTv.material === 'fire',
            'the TV received an effect it cannot draw: ' + JSON.stringify(onTv));
  rig.check(!onTv.hasPixels,
            'the effect crossed to the TV as pixels rather than as a shape and a material name');

  // The one in the unexplored area must still be behind fog on the TV.
  const darkFog = await player.evaluate(
    '(fogDataCtx.getImageData(Math.round(' + DARK.x + ' / FOG_SCALE), Math.round(' +
    DARK.y + ' / FOG_SCALE), 1, 1).data[3])');
  rig.check(darkFog > 200,
            'the ground under an effect in an unexplored room is not fogged on the TV (alpha ' +
            darkFog + ') — placing an effect would tell the players where it is');

  // ══ I. Effects survive a scene switch ══
  // Rooms are prep; effects are placed DURING play and persist, which is the point of them.
  const beforeSwitch = await dm.evaluate('effects.length');
  const sceneOne = await dm.evaluate('currentScene.id');
  const still2 = await rig.fixtures.stillMap(dm, rig.fixtureDir,
    { w: 1600, h: 1000, name: 'rig-effects-two.png' });
  await dm.evaluate('createNewScene(' + (await rig.fixtures.asFileExpr(dm, still2)) + ')', 120000);
  await dm.waitFor('currentScene && mapWidth === 1600', 120000, 'the second map');
  rig.check(await dm.evaluate('effects.length') === 0,
            'the first scene\'s effects followed the DM onto a different map');
  await dm.evaluate('switchScene("' + sceneOne + '"); 0', 120000);
  await dm.waitFor('currentScene && currentScene.id === "' + sceneOne + '"', 60000, 'the switch back');
  await dm.waitFor('effects.length === ' + beforeSwitch, 30000, 'the effects to come back')
    .catch(() => {});
  rig.check(await dm.evaluate('effects.length') === beforeSwitch,
            'switching away and back lost effects: ' + await dm.evaluate('effects.length') +
            ' came back out of ' + beforeSwitch);

  // ══ The look, which is the DM's call and not the rig's ══
  await dm.evaluate('selectedPolygonId = null; selectedVertexIndex = -1; drawCursor(null, null); 0');
  await rig.sleep(250);
  const dmShot = path.join(rig.outDir, 'effect-rounded.png');
  await dm.screenshot(dmShot);
  rig.note('DM screenshot: ' + dmShot);
  rig.byEye('whether the fire in ' + dmShot + ' follows the rounded corners cleanly rather than ' +
            'cutting across them');

  const tvShot = path.join(rig.outDir, 'player-effects.png');
  await player.screenshot(tvShot);
  rig.note('Player screenshot: ' + tvShot);
  rig.byEye('whether the fire in ' + tvShot + ' reads as a flaming frame — the outline burning ' +
            'with flames licking off it, over a faint tint. Judged live, since the motion is the ' +
            'point and a still cannot show it');
};
