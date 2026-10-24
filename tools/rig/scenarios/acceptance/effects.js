'use strict';

// effects.js — THE MAP EFFECTS FEATURE, whole.
//
// THE GOAL OF THIS FEATURE: the DM marks ground during play — fire still burning, acid a zombie
// just vomited — and the players see it on the TV, without it hiding or revealing anything.
// Every check below serves that sentence.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its
// letter, wherever in the file that state is cheapest to reach - which is not letter order.
//
//   A. Every shape tool draws an effect in Effects mode, and Brush and Room grey in place there.
//   B. Effects and rooms are two lists that never mix, and an effect paints NO fog.
//   C. An effect carries a material and a name of its own.
//   D. An effect actually burns on the DM. It is not an empty layer.
//   E. Rounding an effect's corners takes its fire with it.
//   F. An effect is edited exactly as a room is: selected, moved, deleted, undone.
//   G. Effects ride the Auto/Manual send gate, the same gate fog rides.
//   H. Effects reach the TV, and they are drawn UNDER the fog there — an effect in a room
//      nobody has entered stays secret for free.
//   I. Effects survive a scene switch, because they are placed during play and persist.
//   J. The grid inside an effect relights in ember on EVERY grid type, square and both hexes,
//      so the cells a hazard covers stay countable whatever grid the map is on. Outside the
//      outline the grid keeps the DM's own colour, which is what proves the clip still holds.
//   K. All three repairs act on an EFFECT, from the Effects bar's own buttons, and never touch
//      the rooms list. A repair armed in one mode survives the switch to the other.
//   L. Bending an effect's wall redraws its outline, with no other change to the effect.
//   M. Acid is a material of its own: picked, it draws an effect named after it with acid's own
//      ramp, and switching a placed effect between Fire and Acid redraws it in the new one.
//   N. The grid inside acid relights in acid's yellow-green, never in ember.
//   O. The DM and the TV paint an effect the same way, and the DM draws no chrome over an effect
//      that is not picked, so the fire or acid the DM sees is the one the players see.
//   P. Effects beside Room is the way in and out. A click or E enters with the last shape armed (Circle, 20 ft
//      at first). With Select in hand it arms the next effect; with an effect armed it leaves. While on, the bar's
//      border and the picked shape wear the material's colour and the band burns on the border; off, the band
//      requests no frame at all (effectsTool.js, effectsBarFire.js).
//
// ⚠ EFFECTS ARE NOT ROOMS AND NOT TOKENS. An effect is the same record as a room carrying a
// `material` where a room has a fog `mode` (CLAUDE.md). They live in two arrays because array
// order is fog compositing precedence, and an effect has no business in that order.
//
// ⚠ THE FIRE IS ANIMATED, SO NEVER SAMPLE ONE FRAME. A single reading says which frame the
// flame was in, not how brightly the ground burns. Everything here reads the PEAK across a
// spread of frames, which converges on the flame's envelope and is stable run to run.
//
// ⚠ A TO L ARE WRITTEN AGAINST FIRE. Acid, the second material, is M to O.

const path = require('path');

const lib = require('../../lib');

const MAP_W = 2400, MAP_H = 1400;
const CLEAR = { x: 800, y: 500, r: 420 };        // revealed: effects here are visible
const DARK  = { x: 1900, y: 900 };               // never revealed: effects here must stay hidden

const OWN_HELPERS = `
// Brightest red in a map-space box, reading the EFFECT LAYER ALONE, so a bright patch of map
// underneath cannot stand in for a flame.
//
// ⚠ TWO DIFFERENT THINGS KEEP THIS READ CLEAN, and only one of them is doing any work today.
// On an ANIMATED map — which is what this file imports — there is no PixiJS map sprite at all:
// the map is a DOM <video> outside the stage, so the extract cannot see it and pixiHideMap() is a
// no-op. The hide/show pair is kept because it is the ONLY thing standing between this read and
// the map on a STILL one, and a scenario here may yet want a still map. Do not delete it as dead.
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
      if (i < SAMPLES - 1) {
        await lib.hold(GAP, 'the flame is an animation and this is looking for its PEAK, so the ' +
          'samples have to be spread across the cycle rather than taken from one frame');
      }
    }
    return best;
  };

  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await dm.waitFor('!!mapOffscreen', 60000, 'the DM map surface');
  await dm.evaluate(OWN_HELPERS);
  await dm.evaluate('revealCircle(' + CLEAR.x + ',' + CLEAR.y + ',' + CLEAR.r + ');' +
                    'rebuildFogEffect(); fogDirty = true; scheduleRender(); 0');
  await dm.waitFor('fogCoverT === 0 && fogTransRafId === null', 30000, 'the clearing to open');

  // ══ A. Every shape tool draws an effect, and the brush is not on the bar ══
  // RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('setPlaceMode("effects"); 0');
  rig.check(await dm.evaluate('placeMode') === 'effects', 'Effects mode did not take');
  rig.check(await dm.evaluate('shape') !== 'brush',
            'the brush survived into Effects mode, where there is no fog for it to paint');
  // GREYED IN PLACE, not absent: the bar keeps its width in both modes, and the tip says why.
  const grey = await dm.evaluate(`(() => {
    const q = id => document.getElementById(id), shown = el => !!el && el.getClientRects().length > 0;
    const brush = q('btn-brush'), room = q('btn-shape'), chev = document.querySelector('#tb-grp-shape .tb-chev');
    return { brush: shown(brush) && brush.classList.contains('tb-off'), room: shown(room) && room.classList.contains('tb-off'),
             chev: shown(chev) && chev.classList.contains('tb-off'),
             roomWord: room.querySelector('.tb-shape-label').textContent.trim(),
             roomGlyph: room.querySelector('.tb-shape-glyph svg').outerHTML === q('btn-' + modeShape('rooms')).querySelector('svg').outerHTML,
             roomTip: room.title, seg: shown(document.querySelector('.tb-seg')) };
  })()`);
  rig.check(grey.brush && grey.room && grey.chev,
            'Brush, Room and the Room arrow are not all greyed in place in Effects mode: ' + JSON.stringify(grey));
  rig.check(grey.roomWord === 'Room' && grey.roomGlyph && /leave Effects/.test(grey.roomTip),
            'the Room button does not stay Room, with the room shape and a tip that says why, in Effects mode: ' + JSON.stringify(grey));
  rig.check(!grey.seg, 'the old Fog / Effects switch is still on screen');
  // A click on a greyed Brush does nothing.
  await dm.evaluate('document.getElementById("btn-brush").click(); 0');
  rig.check(await dm.evaluate('shape') !== 'brush', 'the greyed Brush took the tool in Effects mode');

  // The Effects tool is lit while its shape is in hand, and the mode's way in and out is its own.
  await dm.evaluate('setShape("select"); setPlaceMode("rooms"); document.getElementById("btn-effects").click(); 0');
  const tool = await dm.evaluate('({ mode: placeMode, shape, armed: presetArmed && presetArmed.s, lit: document.getElementById("btn-effects").classList.contains("fx-on") })');
  rig.check(tool.mode === 'effects' && tool.shape === 'circle' && tool.armed === 20 && tool.lit,
            'a click on Effects did not enter the mode with the Circle armed at 20 ft: ' + JSON.stringify(tool));
  // ══ P. On, the band runs and the border and the picked shape wear the material ══
  // RED BY DESIGN: written against the fix, never re-proved
  const band = await dm.evaluate('({ raf: _bfRaf !== 0, broken: _bfBroken, border: document.getElementById("toolbar-bottom").style.borderColor, ' +
    'col: document.getElementById("fx-shapes").style.getPropertyValue("--fx-col"), want: effectsMaterialColor(currentMaterial) })');
  rig.check(band.raf && !band.broken, 'the bar band is not running with Effects on: ' + JSON.stringify(band));
  rig.check(band.border !== '' && band.col === band.want,
            'the bar border or the picked shape does not wear the material colour with Effects on: ' + JSON.stringify(band));
  rig.byEye('the band reads as a stroke on the bar border, and the Fire, Acid and Light icons read with depth');
  // The switch owns its row: with Select in hand the row stays, the button stays pressed, no shape is lit.
  await dm.evaluate('document.getElementById("btn-select").click(); 0');
  const sel = await dm.evaluate('(() => { const b = document.getElementById("btn-effects"), r = document.getElementById("context-row"); ' +
    'return { row: r.style.visibility !== "hidden" && getComputedStyle(r).visibility !== "hidden", well: !!document.querySelector("#fx-shapes .fx-shape") && getComputedStyle(document.getElementById("fx-shapes")).display !== "none", ' +
    'lit: document.querySelectorAll("#fx-shapes .fx-shape.active").length, pressed: b.classList.contains("fx-on") && !b.classList.contains("active"), mode: placeMode, chev: !!document.querySelector("#tb-grp-fx .tb-chev") }; })()');
  rig.check(sel.row && sel.well && sel.lit === 0 && sel.pressed && sel.mode === 'effects' && !sel.chev,
            'Select in Effects mode did not keep the row, the pressed button and an unlit well, or Effects still has a chevron: ' + JSON.stringify(sel));
  await dm.evaluate('document.querySelector("#fx-shapes [data-fxshape=ring]").click(); 0');
  const wellPick = await dm.evaluate('({ shape, armed: presetArmed && presetArmed.kind, lit: document.querySelector("#fx-shapes .fx-shape.active").dataset.fxshape })');
  rig.check(wellPick.shape === 'ring' && wellPick.armed === 'ring' && wellPick.lit === 'ring',
            'a click on a shape in the row did not arm it and light it: ' + JSON.stringify(wellPick));
  // On, the button is blue, glyph included; off, the glyph wears the material colour (checked after leaving, below).
  await dm.evaluate('setMaterial("acid"); 0');
  rig.check(await dm.evaluate('document.querySelector("#btn-effects .tb-shape-glyph").style.color') === '' &&
            await dm.evaluate('document.querySelector("#btn-effects .tb-shape-glyph svg").outerHTML === document.querySelector("#material-row [data-material=acid] svg").outerHTML'),
            'the Effects button does not wear the picked material glyph');
  await dm.evaluate('setMaterial("fire"); document.getElementById("btn-effects").click(); document.getElementById("btn-effects").click(); 0');
  await dm.evaluate('document.getElementById("btn-effects").click(); 0');
  rig.check(await dm.evaluate('placeMode') === 'rooms' && await dm.evaluate('shape') === 'select',
            'a second click on Effects did not return to Fog with Select');
  await dm.evaluate('__rigKey("KeyE"); 0');
  // The Ring was the last shape picked, and Effects comes back with it.
  rig.check(await dm.evaluate('placeMode') === 'effects' && await dm.evaluate('shape') === 'ring',
            'E did not enter Effects with the last shape armed');
  await dm.evaluate('__rigKey("Escape"); 0');
  rig.check(await dm.evaluate('placeMode') === 'effects' && await dm.evaluate('shape') === 'select',
            'Esc with an effect armed did not put it down and keep the mode');
  // A placement ends on Select, so the next click on Effects places another one: it arms, it does not leave.
  // RED ON: the shape === 'select' branch of effectsToolToggle removed (effectsTool.js) — 2026-10-24
  await dm.evaluate('document.getElementById("btn-effects").click(); 0');
  const again = await dm.evaluate('({ mode: placeMode, shape, glyph: document.querySelector("#btn-effects .tb-shape-glyph").style.color })');
  rig.check(again.mode === 'effects' && again.shape === 'ring' && again.glyph === '',
            'a click on Effects with Select in hand did not arm the next effect, or the lit button kept the material colour: ' + JSON.stringify(again));
  await dm.evaluate('__rigKey("Escape"); 0');
  await dm.evaluate('__rigKey("Escape"); 0');
  rig.check(await dm.evaluate('placeMode') === 'rooms', 'Esc with Select in Effects did not leave the mode');
  rig.check(await dm.evaluate('document.querySelector("#btn-effects .tb-shape-glyph").style.color') !== '',
            'the Effects glyph does not wear the material colour once the mode is off');
  // P. Off, the band fades out and then asks for no frame; the border drops the material colour at once.
  await lib.settle(dm, '_bfRaf === 0', 5000);
  rig.check(await dm.evaluate('_bfRaf') === 0, 'the bar band still requests frames with Effects off');
  rig.check(await dm.evaluate('document.getElementById("toolbar-bottom").style.borderColor') === '',
            'the bar border kept the material colour with Effects off');
  await dm.evaluate('setPlaceMode("effects"); 0');

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
  // RED BY DESIGN: written against the fix, never re-proved
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
  // RED BY DESIGN: written against the fix, never re-proved
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
  // RED BY DESIGN: written against the fix, never re-proved
  await dm.waitFor('pixiEffectsLayer && pixiEffectsLayer.children.length > 0', 15000,
                   'the fire meshes to be built');
  const lit = await peak([610, 310, 790, 440]);
  const bare = await peak([300, 900, 480, 1030]);   // revealed-but-empty ground, for comparison
  rig.note('effect layer brightness — over the fire ' + lit + ', over bare map ' + bare);
  rig.check(lit > bare + 20,
            'the effect layer is not painting anything over the effect (' + lit + ' against ' +
            bare + ' on bare ground) — the effect exists as a record and draws nothing');

  // ══ E. Rounding an effect's corners takes its fire with it ══
  // RED BY DESIGN: written against the fix, never re-proved
  // Compared BEFORE against AFTER on the same corner, so the map's own colour under it cannot
  // pass the check — only the DROP in brightness can.
  const RB = { x1: 1300, y1: 250, x2: 1680, y2: 530 };
  await dm.evaluate('setShape("rect"); __rigDrag(' + RB.x1 + ',' + RB.y1 + ',' +
                    RB.x2 + ',' + RB.y2 + '); 0');
  const roundId = await dm.evaluate('effects[effects.length - 1].id');
  await dm.waitFor('pixiEffectsLayer.children.length > 0', 15000, 'the mesh for the new effect');
  // ⚠ THE RADIUS HAS TO DWARF THE BOX, and at 80 it did not. A radius r pulls the outline
  // r*(√2−1) away from the corner along the diagonal, so 80 put the arc 33 map px out and the
  // box reached 22 — a 1.4 px margin, which is HALF A SCREEN PIXEL at the zoom a small window
  // gives. The arc's own glow then landed inside the box and the corner read BRIGHTER after
  // rounding. 120 puts the arc at 50 and leaves 13 map px, and 140 is the clamp for this rect.
  const ROUND_R = 120;
  const cornerBox = [RB.x1 + 2, RB.y1 + 2, RB.x1 + 22, RB.y1 + 22];
  const edgeBox   = [(RB.x1 + RB.x2) / 2 - 20, RB.y1 + 4, (RB.x1 + RB.x2) / 2 + 20, RB.y1 + 40];
  // ⚠ THE SPILL GOES OFF FOR THESE READS, on this mesh alone. Fire throws light 0.8 of a cell past
  // its outline, which still reaches the rounded corner, so with it on this measures the glow round
  // the shape rather than the flame inside it. The mesh reloads its uniforms on the rounding, so
  // it is switched off again after that wait.
  const noSpill = () => dm.evaluate('(i => { for (const m of [i.meshLight, i.meshDark]) m.shader.uniforms.uSpill = 0; return 0; })' +
                                    '(_fxInstances.get(' + roundId + '))');
  await dm.waitFor('!!_fxInstances.get(' + roundId + ')', 15000, 'the mesh for the probe effect itself');
  await noSpill();
  const cSharp = await peak(cornerBox), eSharp = await peak(edgeBox);
  await dm.evaluate('(() => { const e = effects.find(x => x.id === ' + roundId + ');' +
                    ' selectedPolygonId = e.id; selectedVertexIndex = -1; e.cornerRadius = ' +
                    ROUND_R + '; effectsChanged(); scheduleRender(); return 0; })()');
  // ⚠ WAIT FOR THE MESH, NOT FOR THE RECORD. `cornerRadius` is set synchronously and the outline
  // reloads on a later frame, keyed by `geomKey`. peak() takes the MAX over eight samples, so one
  // stale frame of the sharp corner wins the whole reading and the check fails on a slow renderer
  // with nothing wrong. The key starts with the radius, so this is the mesh saying it reloaded.
  await dm.waitFor('_fxInstances.get(' + roundId + ') && ' +
                   '_fxInstances.get(' + roundId + ').geomKey.startsWith("' + ROUND_R + '|")',
                   10000, 'the rounded outline to reach the mesh');
  await noSpill();
  const cRound = await peak(cornerBox), eRound = await peak(edgeBox);
  rig.note('corner brightness sharp ' + cSharp + ' → rounded ' + cRound +
           ';  straight edge ' + eSharp + ' → ' + eRound);
  // ⚠ 45, NOT 60: the flame flickers, and the peak read 60 to 80 across runners. Bare map reads 30.
  rig.check(cSharp > 45, 'the sharp corner never showed fire, so rounding it proves nothing');
  // ⚠ A SHARE OF WHAT WAS THERE, not a fixed 40 points. How bright the flame peaks depends on
  // the renderer, and a software rasteriser reads 69 where a GPU reads 85 — against which a
  // fixed drop of 40 is a different demand on each machine.
  rig.check(cRound < cSharp * 0.6,
            'rounding the corner did not take the fire with it (' + cSharp + ' → ' + cRound +
            ') — the outline rounded and the flame did not');
  rig.check(eRound > eSharp - 40,
            'rounding the corners dimmed a straight edge that should have been untouched (' +
            eSharp + ' → ' + eRound + ')');

  // A corner that also carries a curve keeps its rounding — effects share the fog pipeline's own
  // fillet (fogGeometry.js's computeFillet), so a bent wall must round the same way a room's does.
  // ⚠ READ FROM THE MESH'S OWN `verts`, not a fresh call to roundEffectRing: that would prove the
  // pure function works, which the unit tests already do, and miss a break in the wiring between
  // it and _loadFxGeometry. ⚠ PIXEL BRIGHTNESS DOES NOT DISCRIMINATE HERE — the flame's own inward
  // reach (`_flameHeight`) already covers the gap between a barely-curved and a heavily-rounded
  // corner at this scale, so a geometric check on the uploaded vertices is what actually catches a
  // regression; brightness only proved the plain, unbent case above.
  // Each step waits on the radius at the head of geomKey, so each radius is its own value.
  const nearestToCorner = (verts, n) => {
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(verts[i * 2] - RB.x1, verts[i * 2 + 1] - RB.y1);
      if (d < best) best = d;
    }
    return best;
  };
  await dm.evaluate('(() => { const e = effects.find(x => x.id === ' + roundId + ');' +
                    ' setShapeHandle(e, 0, "out", 0, -30); e.cornerRadius = 1;' +
                    ' effectsChanged(); scheduleRender(); return 0; })()');
  await dm.waitFor('_fxInstances.get(' + roundId + ') && ' +
                   '_fxInstances.get(' + roundId + ').geomKey.startsWith("1|")',
                   10000, 'the bent, still-sharp outline to reach the mesh');
  const meshA = await dm.evaluate(
    '(() => { const i = _fxInstances.get(' + roundId + ');' +
    ' return { verts: Array.from(i.verts), count: i.meshLight.shader.uniforms.uCount }; })()');
  const distSharp = nearestToCorner(meshA.verts, meshA.count);
  await dm.evaluate('(() => { const e = effects.find(x => x.id === ' + roundId + ');' +
                    ' e.cornerRadius = 60; effectsChanged(); scheduleRender(); return 0; })()');
  await dm.waitFor('_fxInstances.get(' + roundId + ') && ' +
                   '_fxInstances.get(' + roundId + ').geomKey.startsWith("60|")',
                   10000, 'the curved-and-rounded outline to reach the mesh');
  const meshB = await dm.evaluate(
    '(() => { const i = _fxInstances.get(' + roundId + ');' +
    ' return { verts: Array.from(i.verts), count: i.meshLight.shader.uniforms.uCount }; })()');
  const distRound = nearestToCorner(meshB.verts, meshB.count);
  rig.note('bent corner distance from its own vertex: sharp ' + distSharp.toFixed(1) +
           ' → rounded ' + distRound.toFixed(1) + ' map units');
  rig.check(distRound > distSharp + 8,
            'a corner that also carries a curve did not pull away from its own vertex when ' +
            'rounded (' + distSharp.toFixed(1) + ' → ' + distRound.toFixed(1) +
            '), so an effect cannot round a bent wall the way a room can');

  // ══ L. A bend alone redraws the effect ══
  // RED ON: e.handles gated out of _fxGeomKey (effects.js) — 2026-09-24
  // Nothing but a handle changes, so only the handles in geomKey can make the mesh rebuild.
  const keyBefore = await dm.evaluate('_fxInstances.get(' + roundId + ').geomKey');
  await dm.evaluate('(() => { const e = effects.find(x => x.id === ' + roundId + ');' +
                    ' setShapeHandle(e, 1, "out", 40, 0); effectsChanged(); scheduleRender();' +
                    ' return 0; })()');
  const rebuilt = await lib.poll(async () => (await dm.evaluate(
    '_fxInstances.get(' + roundId + ').geomKey !== ' + JSON.stringify(keyBefore))) ? { v: true } : null,
    10000, 100);
  const meshC = await dm.evaluate(
    '(() => { const i = _fxInstances.get(' + roundId + ');' +
    ' return { verts: Array.from(i.verts), count: i.meshLight.shader.uniforms.uCount }; })()');
  rig.check(!!rebuilt && meshC.verts.join(',') !== meshB.verts.join(','),
            'bending a wall on an effect left its outline where it was, so the fire stays on ' +
            'the old straight wall until something else changes');

  // ══ F. An effect is edited exactly as a room is ══
  // RED BY DESIGN: written against the fix, never re-proved
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
  // RED BY DESIGN: written against the fix, never re-proved
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
  // Nothing to poll for: the claim is that the effect does NOT reach the Player with Auto off.
  await lib.hold(1200, 'long enough for a push that ignored the gate to have landed, then ' +
    'prove it did not');
  rig.check(await player.evaluate('effects.length') === heldBefore,
            'an effect drawn with auto-sync OFF went to the TV anyway — the gate that lets the ' +
            'DM prepare before the players see it does not hold for effects');
  await dm.evaluate('sendToPlayer(); 0');
  try { await player.waitFor('effects.length > ' + heldBefore, 20000, 'the manual Send to land'); }
  catch (_) {}
  rig.check(await player.evaluate('effects.length') > heldBefore,
            'pressing Send did not deliver the held effect to the TV');

  // ══ H. Effects reach the TV, and are drawn UNDER the fog ══
  // RED BY DESIGN: written against the fix, never re-proved
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
  // RED BY DESIGN: written against the fix, never re-proved
  // Rooms are prep; effects are placed DURING play and persist, which is the point of them.
  const beforeSwitch = await dm.evaluate('effects.length');
  const sceneOne = await dm.evaluate('currentScene.id');
  await lib.openMap(rig, { w: 1600, h: 1000 });
  rig.check(await dm.evaluate('effects.length') === 0,
            'the first scene\'s effects followed the DM onto a different map');
  await dm.evaluate('switchScene("' + sceneOne + '"); 0', 120000);
  await dm.waitFor('currentScene && currentScene.id === "' + sceneOne + '"', 60000, 'the switch back');
  await dm.waitFor('effects.length === ' + beforeSwitch, 30000, 'the effects to come back')
    .catch(() => {});
  rig.check(await dm.evaluate('effects.length') === beforeSwitch,
            'switching away and back lost effects: ' + await dm.evaluate('effects.length') +
            ' came back out of ' + beforeSwitch);

  // ══ J. The ember relight happens on every grid type ══
  // RED BY DESIGN: written against the fix, never re-proved
  // The grid is a plain 2D canvas above the effect layer (grid.js), so this reads gridCtx rather
  // than the PixiJS stage. The ember is #ff9a3c; gridColor goes hard blue first so an ordinary
  // grid line can never be mistaken for one — the check is a HUE test, not a brightness test.
  // ⚠ ONE KNOWN EFFECT AND NOTHING ELSE, then everything put back. The effects standing here have
  // been moved and deleted by F, so their geometry is not something to sample blind — and the
  // screenshots below are of the scene as I left it, not as this criterion needs it.
  await dm.evaluate('globalThis.__rigSavedFx = effects; globalThis.__rigSavedGrid = captureGridConfig();' +
    ' effects = [{ id: 900, vertices: [{x:600,y:380},{x:1000,y:380},{x:1000,y:640},{x:600,y:640}],' +
    ' material: "fire", cornerRadius: 0, name: "Ember probe" }];' +
    ' gridEnabled = true; gridSize = 70; gridOffsetX = 0; gridOffsetY = 0;' +
    ' gridColor = "#2060ff"; gridOpacity = 0.3; gridLineWidth = 2;' +
    ' gridDirty = true; scheduleRender(); 0');

  // Ember pixels in a map-space box on the DM's grid canvas. The base grid above goes faint and
  // blue for this, and the test below is relative rather than absolute, for the reason the `rig`
  // skill gives under Traps. Blue keeps r = 32 at every alpha, so a grid line can never pass it.
  await dm.evaluate(`globalThis.__rigEmber = (mx1, my1, mx2, my2) => {
    const x1 = Math.round(mx1 * zoom + panX), y1 = Math.round(my1 * zoom + panY);
    const x2 = Math.round(mx2 * zoom + panX), y2 = Math.round(my2 * zoom + panY);
    const w = Math.max(1, x2 - x1), h = Math.max(1, y2 - y1);
    const d = gridCtx.getImageData(x1, y1, w, h).data;
    let ember = 0, other = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 20) continue;
      if (d[i] > 170 && d[i] - d[i + 2] > 60) ember++;
      else other++;
    }
    return { ember, other };
  }; 0`);

  // ⚠ PEAK ACROSS FRAMES, like every other read in this file. The grid canvas only repaints on a
  // dirty flag, so each sample forces one and then lets a frame land.
  const emberPeak = async () => {
    let best = { ember: -1, other: 0 };
    for (let i = 0; i < 5; i++) {
      await dm.evaluate('gridDirty = true; scheduleRender(); 0');
      await lib.settle(dm, '!gridDirty', 5000);
      await lib.hold(80, 'the ember pulses, so five samples across its cycle find its peak where ' +
        'one frame finds whatever phase it happened to be in');
      const v = await dm.evaluate('__rigEmber(620, 400, 980, 620)');
      if (v.ember > best.ember) best = v;
    }
    return best;
  };

  for (const mode of ['square', 'hex-pointy']) {
    await dm.evaluate('gridMode = ' + JSON.stringify(mode) + '; gridDirty = true; scheduleRender(); 0');
    await lib.settle(dm, '!gridDirty', 8000);
    const inside = await emberPeak();
    rig.note(mode + ' grid: ' + inside.ember + ' ember px inside the effect, ' +
             inside.other + ' plain');
    rig.check(inside.ember > 50,
              'a ' + mode + ' grid does not relight in ember inside an effect (' + inside.ember +
              ' ember px) — the cells the hazard covers cannot be counted on this grid type');
  }

  // Outside the outline the grid must stay the DM's own colour, or the clip has stopped working.
  const outside = await dm.evaluate('__rigEmber(1200, 800, 1500, 1000)');
  rig.check(outside.ember === 0 && outside.other > 0,
            'the ember leaked outside the effect outline on a hex grid: ' + JSON.stringify(outside));

  rig.byEye('whether the hex ember reads cleanly — every hexagon is a closed subpath, so two ' +
            'neighbours stroke their shared edge twice inside one stroke() and those edges land ' +
            'darker than the outer ones. The unlit hex grid already does this, so it should read ' +
            'as consistent rather than as a fault');

  await dm.evaluate('effects = __rigSavedFx; applyGridConfig(__rigSavedGrid);' +
    ' gridDirty = true; scheduleRender(); 0');
  await lib.settle(dm, '!gridDirty && !viewportDirty', 8000);

  // ══ M. Acid is a material of its own ══
  const rampAt = (session, id) => session.evaluate('(i => i ? Array.from(i.meshLight.shader.uniforms.uRamp).slice(6, 9)' +
    '.map(x => Math.round(x * 100)) : null)(_fxInstances.get(' + id + '))');
  const want = m => dm.evaluate('EFFECT_MATERIALS.' + m + '.ramp[2].map(x => Math.round(x * 100))');
  await dm.evaluate('selectedPolygonId = null; setPlaceMode("effects"); setMaterial("acid"); setShape("rect");' +
                    ' __rigDrag(600, 380, 1000, 640); setShape("select"); 0');
  const acid = await dm.evaluate('effects[effects.length - 1]');
  rig.check(acid.material === 'acid' && /^Acid \d+$/.test(acid.name || ''),
            'picking Acid did not draw an acid effect named after it: ' + JSON.stringify([acid.material, acid.name]));
  const acidRamp = JSON.stringify(await want('acid'));
  rig.check(JSON.stringify(await lib.poll(async () => {
    const r = await rampAt(dm, acid.id); return JSON.stringify(r) === acidRamp ? r : null; }, 8000)) === acidRamp,
            'the acid effect does not burn with acid\'s own ramp');
  // RED ON: the material dropped from _fxGeomKey (effects.js) — 2026-10-11
  await dm.evaluate('selectedPolygonId = ' + acid.id + '; setMaterial("fire"); 0');
  const fireRamp = JSON.stringify(await want('fire'));
  rig.check(JSON.stringify(await lib.poll(async () => {
    const r = await rampAt(dm, acid.id); return JSON.stringify(r) === fireRamp ? r : null; }, 8000)) === fireRamp,
            'switching a placed acid to Fire left it burning with acid\'s colours');
  await dm.evaluate('setMaterial("acid"); selectedPolygonId = null; selectedVertexIndex = -1; drawCursor(null, null); 0');

  // ══ N. The grid inside acid relights in acid's colour ══
  // RED ON: the relight drawn in the fixed ember colour again (grid.js) — 2026-10-11
  await dm.evaluate('globalThis.__rigSavedFx = effects; globalThis.__rigSavedGrid = captureGridConfig();' +
    ' effects = [{ id: 901, vertices: [{x:600,y:380},{x:1000,y:380},{x:1000,y:640},{x:600,y:640}],' +
    ' material: "acid", cornerRadius: 0, name: "Acid probe" }];' +
    ' gridEnabled = true; gridMode = "square"; gridSize = 70; gridOffsetX = 0; gridOffsetY = 0;' +
    ' gridColor = "#2060ff"; gridOpacity = 0.3; gridLineWidth = 2; gridDirty = true; scheduleRender(); 0');
  await lib.settle(dm, '!gridDirty', 8000);
  const tint = await dm.evaluate(`(() => {
    const x1 = Math.round(620 * zoom + panX), y1 = Math.round(400 * zoom + panY);
    const w = Math.max(1, Math.round(360 * zoom)), h = Math.max(1, Math.round(220 * zoom));
    const d = gridCtx.getImageData(x1, y1, w, h).data;
    let acid = 0, ember = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 20) continue;
      if (d[i + 1] > 170 && d[i + 1] - d[i + 2] > 60 && d[i + 1] >= d[i] - 20) acid++;
      else if (d[i] > 170 && d[i] - d[i + 1] > 50) ember++;
    }
    return { acid, ember };
  })()`);
  rig.note('acid grid: ' + JSON.stringify(tint));
  rig.check(tint.acid > 50 && tint.ember === 0,
            'the grid inside acid does not relight in acid\'s yellow-green: ' + JSON.stringify(tint));
  await dm.evaluate('effects = __rigSavedFx; effectsChanged(); applyGridConfig(__rigSavedGrid); gridDirty = true; scheduleRender(); 0');
  await lib.settle(dm, '!gridDirty && !viewportDirty', 8000);

  // ══ O. One look on both screens, and no chrome over an effect that is not picked ══
  // RED ON: the light pass back on BLEND_MODES.ADD (effects.js) — 2026-10-11
  await dm.evaluate('sendToPlayer(); 0');
  await lib.poll(() => player.evaluate('effects.some(e => e.material === "acid") && _fxInstances.size === effects.length || null'), 20000);
  const blends = async s => s.evaluate('[..._fxInstances.values()].map(i => [i.meshLight.blendMode, i.meshDark.blendMode])');
  const normal = await dm.evaluate('PIXI.BLEND_MODES.NORMAL');
  for (const [who, s] of [['DM', dm], ['TV', player]]) {
    const b = await blends(s);
    rig.check(b.length > 0 && b.every(p => p[0] === normal && p[1] === normal),
              'the ' + who + ' does not paint its effects over the map: blend modes ' + JSON.stringify(b) +
              '. Added instead, an effect turns see-through and changes hue over a coloured floor');
  }
  // RED ON: the early return for an unpicked material removed from drawPolyOutline (shapeSelect.js) — 2026-10-11
  await dm.evaluate('selectedPolygonId = null; selectedVertexIndex = -1; setMaterial("fire"); drawCursor(null, null); 0');
  const chrome = await dm.evaluate(`(() => {
    const x1 = Math.round(600 * zoom + panX), y1 = Math.round(380 * zoom + panY);
    const d = cursorCtx.getImageData(x1, y1, Math.max(1, Math.round(400 * zoom)), Math.max(1, Math.round(260 * zoom))).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  })()`);
  rig.check(chrome === 0, 'the DM draws editing chrome over an effect nobody picked (' + chrome + ' px), so its ' +
            'fire or acid looks different from the TV\'s');

  // ══ The look, which is the DM's call and not the rig's ══
  await dm.evaluate('selectedPolygonId = null; selectedVertexIndex = -1; drawCursor(null, null); 0');
  await lib.settle(dm, '!viewportDirty', 8000);
  const dmShot = path.join(rig.outDir, 'effect-rounded.png');
  await dm.screenshot(dmShot);
  rig.note('DM screenshot: ' + dmShot);
  rig.byEye('whether the fire in ' + dmShot + ' follows the rounded corners cleanly rather than ' +
            'cutting across them');

  const tvShot = path.join(rig.outDir, 'player-effects.png');
  await player.screenshot(tvShot);
  rig.note('Player screenshot: ' + tvShot);
  rig.byEye('whether the fire in ' + tvShot + ' reads as the toon fire and the acid as the acid ' +
            'picked in .claude/private/design/item-46/acid-lab.html. Judged live, since the motion is ' +
            'the point and a still cannot show it');

  // ══ K. All three repairs act on an effect, from the bar's own buttons ══
  // RED BY DESIGN: written against the fix, never re-proved
  // ⚠ EVERY REPAIR HERE IS ARMED BY CLICKING ITS BUTTON, never by calling setShapeOp. The
  // buttons are the half that was missing, and a scripted setShapeOp would pass without them.
  // Drawn low on the map, clear of every effect the criteria above left standing.
  await dm.evaluate('setPlaceMode("effects"); setShapeOp("new"); setShape("rect");' +
                    ' __rigDrag(300, 1100, 500, 1250); __rigDrag(600, 1100, 800, 1250); 0');
  const kRooms  = await dm.evaluate('polygons.length');
  const kBefore = await dm.evaluate('effects.length');
  await dm.evaluate('document.getElementById("btn-op-join").click(); setShape("rect");' +
                    ' __rigDrag(400, 1130, 700, 1220); 0');
  const kJoined = await dm.evaluate('effects.length');
  rig.check(kJoined === kBefore - 1,
            'a Merge left ' + kJoined + ' effects out of ' + kBefore + ' instead of joining two ' +
            'into one, so the Merge button on the Effects bar reaches nothing');
  rig.check(await dm.evaluate('polygons.length') === kRooms,
            'a Merge drawn in Effects mode changed the ROOMS list');

  // Cut out, on the effect the Merge just made. A notch adds corners without adding a record.
  const kVerts = await dm.evaluate('effects[effects.length - 1].vertices.length');
  await dm.evaluate('document.getElementById("btn-op-trim").click(); setShape("rect");' +
                    ' __rigDrag(650, 1080, 780, 1160); 0');
  rig.check(await dm.evaluate('effects.length') === kJoined,
            'a Cut out on an effect changed how many effects there are instead of notching one');
  rig.check(await dm.evaluate('effects[effects.length - 1].vertices.length') > kVerts,
            'the effect came back at ' + kVerts + ' corners, so the Cut out took nothing out of it');

  // Split, which is a TOOL rather than an armed mode, and cuts whichever list the mode names.
  await dm.evaluate('document.getElementById("btn-op-trim").click(); 0');
  const kSplit = await dm.evaluate('effects.length');
  await dm.evaluate('setShape("cut"); __rigClick(250, 1180); __rigClick(900, 1180);' +
                    ' container.dispatchEvent(new MouseEvent("dblclick",' +
                    ' { bubbles: true, cancelable: true })); setShape("select"); 0');
  rig.check(await dm.evaluate('effects.length') === kSplit + 1,
            'Split left ' + (await dm.evaluate('effects.length')) + ' effects out of ' + kSplit +
            ' instead of cutting one in two, so the tool still only reads the rooms list');
  rig.check(await dm.evaluate('polygons.length') === kRooms,
            'Split drawn in Effects mode cut a ROOM');

  // A repair armed in one mode SURVIVES the switch, because its button is on both bars.
  await dm.evaluate('setPlaceMode("rooms"); document.getElementById("btn-op-join").click();' +
                    ' setPlaceMode("effects"); 0');
  rig.check(await dm.evaluate('shapeOp') === 'join',
            'a Merge armed in Rooms was disarmed by the switch to Effects, where its button is ' +
            'now on the bar to show it and to cancel it');
  await dm.evaluate('setPlaceMode("rooms"); setShapeOp("new"); 0');
};
