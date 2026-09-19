'use strict';

// fog.js — THE FOG FEATURE, whole. This is the app's core promise.
//
// THE GOAL OF THIS FEATURE: the players see only the ground the party has walked into, and what
// they see reads as cloud lying over the map rather than a hole cut in felt. The DM opens ground
// as the party moves, and every change is on the TV a moment later. Every check below serves that
// sentence.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks directly beneath it, in order.
//
//   A. Opening the Player puts the DM's map on it, at the map's own size, fogged all over.
//   B. An area the DM reveals is clear of fog on the Player — in the fog data it was sent, and
//      in the fog it actually paints.
//   C. An area the DM has not touched is still fully fogged there, at full strength.
//   D. The Player carries no DM controls, and still has a cursor to drag its view with.
//   E. Reveal All and Shroud All do what they say — on the fog, on every room's mode, on the TV —
//      and each is one undo step.
//   F. The fog is never flat black: the colour the DM dials in is the colour the table sees.
//   G. The feathered edge is a dial. A wider one softens the edge without moving it.
//   H. Half-shroud is a density the DM sets, it lands between revealed and shrouded, and it is
//      ABSOLUTE — a half room reads the same whatever was under it.
//   I. The drift switches on and off, its three presets are exclusive, and the fog really moves.
//   J. Reset Fog Settings restores the look and deliberately leaves half-shroud alone.
//   K. The fog looks right on the TV.
//   L. The colour picker is the only way the DM reaches the fog colour, so the hex field, the
//      hue strip and the saturation square each have to set it, and each has to move the
//      other two.
//   M. The Auto/Manual gate holds for FOG. With Auto off nothing the DM reveals reaches the
//      table until Send is pressed, which is how a room is prepared before the players see it.
//
// ⚠ THE PLAYER'S FOG IS ONE FULL-SCREEN PIXIJS PASS, so its painted fog is read by extracting
// that mesh from the renderer rather than off a DOM canvas. The extract is in CSS pixels, as the
// renderer runs at resolution 1, so a map point converts with the camera transform alone.
//
// ⚠ WAIT OUT THE SCENE COVER BEFORE READING PAINTED FOG. A fresh map arrives under a full-fog
// cover (fogCoverT) which punches nothing, so every sample reads opaque no matter what was
// revealed — the reveal is real and invisible. Poll fogCoverT down to 0 first.
//
// ⚠ READ AFTER A FRAME HAS GONE OUT, not after a change was made. Sampling straight after a
// control fires reports the canvas from before the update, which is the old state wearing the new
// state's name.
//
// ⚠ fogHalfAlpha PERSISTS IN localStorage AND NOTHING ELSE IN THAT PANEL DOES. Section J's point
// is that Reset leaves it alone; a Reset that swept it away would erase a value the DM spent
// sittings at the table dialling in.

const path = require('path');

// Where the DM reveals, and where it deliberately does not. Both well inside the map and far
// apart, so the feathered edge of the reveal cannot reach the untouched sample.
const lib = require('../../lib');

const MAP_W = 2000, MAP_H = 1200;
const REVEAL = { x: 500, y: 300, r: 250 };
const UNTOUCHED = { x: 1500, y: 900 };
const ROOM = { x1: 1050, y1: 620, x2: 1400, y2: 860 };   // clear of both samples above

const HELD = { x: 300, y: 300 };

module.exports = async function fogFeature(rig) {
  const dm = rig.dm;

  await lib.openMap(rig, { w: MAP_W, h: MAP_H });

  // Fires a control's real handler, exactly as a drag does.
  const fire = (id, v, ev) => dm.evaluate('(() => { const el = document.getElementById(' +
    JSON.stringify(id) + '); el.value = ' + JSON.stringify(String(v)) + ';' +
    ' el.dispatchEvent(new Event(' + JSON.stringify(ev || 'input') + ', { bubbles: true }));' +
    ' return 0; })()');

  // The fog the DM holds, at 1/FOG_SCALE. Its own source of truth, which is what gets sent.
  const DM_SAMPLE = `((mx, my) => fogDataCtx.getImageData(
    Math.round(mx / FOG_SCALE), Math.round(my / FOG_SCALE), 1, 1).data[3])`;
  const dmFog = (x, y) => dm.evaluate(DM_SAMPLE + '(' + x + ',' + y + ')');

  // ── A. Opening the Player puts the DM's map on it ──────────────────────────
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen', 45000, 'the Player to receive the map');
  const onPlayer = await player.evaluate('({ w: mapWidth, h: mapHeight, hasFog: !!fogDataCanvas })');
  rig.check(onPlayer.w === MAP_W && onPlayer.h === MAP_H,
            'the Player has the map at the wrong size: ' + onPlayer.w + 'x' + onPlayer.h);
  rig.check(onPlayer.hasFog,
            'the Player received a map with no fog at all — the table would see everything');

  // ── B. What the DM reveals is clear on the Player ──────────────────────────
  // revealCircle is the app's own fog operation, the one the brush drives; sendToPlayer is the
  // app's own delivery. Nothing here is a rig-only path.
  await player.waitFor('fogCoverT === 0', 45000, 'the scene cover to lift on the Player');
  await dm.evaluate('revealCircle(' + REVEAL.x + ',' + REVEAL.y + ',' + REVEAL.r + '); sendToPlayer(); 0');

  const sampleData = `((mx, my) => {
    const d = fogDataCtx.getImageData(Math.round(mx / FOG_SCALE), Math.round(my / FOG_SCALE), 1, 1).data;
    return d[3];
  })`;
  await player.waitFor(sampleData + '(' + REVEAL.x + ',' + REVEAL.y + ') === 0', 30000,
                       "the reveal to reach the Player's fog data");
  const revealedData = await player.evaluate(sampleData + '(' + REVEAL.x + ',' + REVEAL.y + ')');
  rig.check(revealedData === 0,
            'the Player still holds fog data over the revealed area (alpha ' + revealedData + ')');

  // The fog it PAINTS, with its colour. Alpha says whether fog is there; RGB says what colour it
  // is, which is section F's business.
  // ⚠ EXTRACT THE FOG MESH ALONE, never the stage. The stage composite is opaque everywhere
  // because the map sits under it, and alpha is the whole point here. The mesh on its own gives
  // back what #fog-canvas used to: alpha says whether fog is there, RGB says what colour it is.
  const SNAP = `globalThis.__rigFogSnap = () => {
    if (!pixiPFogMesh || !pixiApp) return null;
    const cvs = pixiApp.renderer.extract.canvas(pixiPFogMesh);
    globalThis.__rigSnap = cvs.getContext('2d').getImageData(0, 0, cvs.width, cvs.height);
    return { w: cvs.width, h: cvs.height };
  };
  globalThis.__rigFogAt = (mx, my) => {
    const d = globalThis.__rigSnap;
    if (!d) return { a: -1 };
    const sx = Math.round(mx * zoom + panX), sy = Math.round(my * zoom + panY);
    if (sx < 0 || sy < 0 || sx >= d.width || sy >= d.height) return { a: -1 };
    const i = (sy * d.width + sx) * 4;
    return { r: d.data[i], g: d.data[i + 1], b: d.data[i + 2], a: d.data[i + 3] };
  };
  0`;
  await player.evaluate(SNAP);
  const repaintPlayer = async () => {
    await player.evaluate('viewportDirty = true; fogDirty = true; scheduleRender(); 0');
    await lib.settle(player, '!viewportDirty && !fogDirty && !fogTransRafId && !fogColorRafId', 10000);
    await player.evaluate('__rigFogSnap()');
  };
  const painted = (x, y) => player.evaluate('__rigFogAt(' + x + ',' + y + ')');

  await repaintPlayer();
  const paintedRevealed = await painted(REVEAL.x, REVEAL.y);
  const paintedUntouched = await painted(UNTOUCHED.x, UNTOUCHED.y);
  // The 0.55 knock-down is the DM's layer alone. On the Player the fog pass carries no alpha of
  // its own, and a mesh drawn at less than 1 means the table can read through the fog.
  const layerOpacity = await player.evaluate(
    'pixiPFogMesh ? String(pixiPFogMesh.worldAlpha) : "no fog mesh"');
  rig.note('painted fog — revealed ' + JSON.stringify(paintedRevealed) + ', untouched ' +
           JSON.stringify(paintedUntouched) + ', layer opacity ' + layerOpacity);
  rig.check(paintedRevealed.a === 0,
            'the Player is still painting fog over the revealed area (alpha ' +
            paintedRevealed.a + ')');

  // ── C. Untouched map is still fully fogged ─────────────────────────────────
  const untouchedData = await player.evaluate(sampleData + '(' + UNTOUCHED.x + ',' + UNTOUCHED.y + ')');
  rig.check(untouchedData === 255,
            'untouched map is not fully fogged in the Player fog data (alpha ' + untouchedData + ')');
  rig.check(paintedUntouched.a > 200,
            'the Player is barely painting fog over untouched map (alpha ' + paintedUntouched.a + ')');
  // The fog layer is drawn at full strength on the Player; the 0.55 knock-down is the DM's view
  // alone, so a Player showing DM-strength fog means the table can read through it.
  rig.check(layerOpacity === '1', 'the Player fog layer is not at full opacity: ' + layerOpacity);

  // ── D. No DM controls, but the cursor stays ───────────────────────────────
  const chrome = await player.evaluate(`(() => {
    const shown = id => { const el = document.getElementById(id);
      if (!el) return false; const b = el.getBoundingClientRect();
      return getComputedStyle(el).display !== 'none' && b.width > 0 && b.height > 0; };
    return { toolbar: shown('toolbar-bottom'), sidebar: shown('sidebar-right'),
             minimap: shown('minimap-panel'),
             cursor: getComputedStyle(document.getElementById('canvas-container')).cursor };
  })()`);
  rig.check(!chrome.toolbar && !chrome.sidebar && !chrome.minimap,
            'the Player is showing DM controls: ' + JSON.stringify(chrome));
  // The cursor is the ONE thing that stays: the DM drags the Player's view by hand on the TV,
  // and that needs a pointer they can see. Asserted so nobody tidies it away as "zero UI".
  rig.check(chrome.cursor !== 'none',
            'the Player cursor was hidden, so the DM can no longer drag the view on the TV');

  // ── E. Reveal All and Shroud All ──────────────────────────────────────────
  // A room is drawn first, so "every room's mode flipped" has something to be true of.
  await dm.evaluate(`(() => {
    pushUndo();
    polygons = [{ id: 1, vertices: [
      { x: ${ROOM.x1}, y: ${ROOM.y1} }, { x: ${ROOM.x2}, y: ${ROOM.y1} },
      { x: ${ROOM.x2}, y: ${ROOM.y2} }, { x: ${ROOM.x1}, y: ${ROOM.y2} },
    ], mode: 'shroud', cornerRadius: 0, name: 'Test Room' }];
    nextPolygonId = 2;
    rebuildFogFromPolygons(); rebuildFogEffect(); fogDirty = true; scheduleRender();
    return 0;
  })()`);

  const undoDepth = () => dm.evaluate('undoStack.length');
  const modes = () => dm.evaluate('polygons.map(p => p.mode)');

  const beforeReveal = await undoDepth();
  await dm.evaluate('document.getElementById("btn-clear-fog").click(); 0');
  await lib.settle(dm, DM_SAMPLE + '(' + UNTOUCHED.x + ',' + UNTOUCHED.y + ') === 0', 15000);
  rig.check(await dmFog(UNTOUCHED.x, UNTOUCHED.y) === 0,
            'Reveal All left fog on the map: alpha ' + await dmFog(UNTOUCHED.x, UNTOUCHED.y));
  // ⚠ COUNTED BEFORE IT IS JUDGED. `[].every(...)` is true, so a Reveal All that emptied
  // `polygons` rather than resetting their modes would report this check green with no room left
  // to check. The count is the guard, and it is asserted separately so the FAIL line says which
  // of the two went wrong.
  const revealModes = await modes();
  rig.check(revealModes.length === 1,
            'the room this section is about is gone, so the mode check below judges nothing: ' +
            JSON.stringify(revealModes));
  rig.check(revealModes.length > 0 && revealModes.every(m => m === 'reveal'),
            'Reveal All left a room shrouded, so the room card is lying about the fog: ' +
            JSON.stringify(revealModes));
  rig.check(await undoDepth() === beforeReveal + 1,
            'Reveal All did not push exactly one undo step: ' + beforeReveal + ' → ' +
            await undoDepth());
  await player.waitFor(sampleData + '(' + UNTOUCHED.x + ',' + UNTOUCHED.y + ') === 0', 30000,
                       'Reveal All to reach the Player');
  rig.check(await player.evaluate(sampleData + '(' + UNTOUCHED.x + ',' + UNTOUCHED.y + ')') === 0,
            'Reveal All never reached the TV, so the players are still in the dark');

  const beforeShroud = await undoDepth();
  await dm.evaluate('document.getElementById("btn-fill-fog").click(); 0');
  await lib.settle(dm, DM_SAMPLE + '(' + REVEAL.x + ',' + REVEAL.y + ') === 255', 15000);
  rig.check(await dmFog(REVEAL.x, REVEAL.y) === 255,
            'Shroud All did not put fog back over ground that had been revealed: alpha ' +
            await dmFog(REVEAL.x, REVEAL.y));
  const shroudModes = await modes();
  rig.check(shroudModes.length > 0 && shroudModes.every(m => m === 'shroud'),
            'Shroud All left a room revealed, or took the room away entirely: ' +
            JSON.stringify(shroudModes));
  rig.check(await undoDepth() === beforeShroud + 1,
            'Shroud All did not push exactly one undo step');
  await player.waitFor(sampleData + '(' + REVEAL.x + ',' + REVEAL.y + ') > 200', 30000,
                       'Shroud All to reach the Player');
  rig.check(await player.evaluate(sampleData + '(' + REVEAL.x + ',' + REVEAL.y + ')') > 200,
            'Shroud All never reached the TV, so the players can still see the room');

  await dm.evaluate('undo(); 0');
  await lib.settle(dm, DM_SAMPLE + '(' + REVEAL.x + ',' + REVEAL.y + ') === 0', 15000);
  rig.check(await dmFog(REVEAL.x, REVEAL.y) === 0,
            'undo after Shroud All did not put the revealed ground back: alpha ' +
            await dmFog(REVEAL.x, REVEAL.y));

  // ── F. The fog is never flat black ────────────────────────────────────────
  // Read on the Player, whose fog is Canvas 2D and gives up its colour. A strong red is far from
  // both the default blue-violet and from black, so the reading cannot be a coincidence.
  //
  // Shrouded first, and deliberately: the undo above put the whole map back to Reveal All, so
  // without this the colour is sampled over ground that carries no fog at all and every reading
  // is a transparent pixel.
  await dm.evaluate('document.getElementById("btn-fill-fog").click(); 0');
  await lib.settle(dm, DM_SAMPLE + '(' + UNTOUCHED.x + ',' + UNTOUCHED.y + ') === 255', 15000);
  await fire('fog-color', '#c02020');
  await fire('fog-tint-alpha', 60);
  await lib.settle(dm, '!fogColorRafId', 10000);
  await repaintPlayer();
  const coloured = await painted(UNTOUCHED.x, UNTOUCHED.y);
  rig.note('painted fog colour after dialling in #c02020: ' + JSON.stringify(coloured));
  rig.check(coloured.a > 200, 'the sample is not on fogged ground any more: ' + JSON.stringify(coloured));
  rig.check(coloured.r > 40 || coloured.g > 40 || coloured.b > 40,
            'the fog on the TV is flat black, which the app must never paint: ' +
            JSON.stringify(coloured));
  rig.check(coloured.r > coloured.b + 10,
            'a red fog colour did not reach the fog the table sees: ' + JSON.stringify(coloured));

  await fire('fog-color', '#2030c0');
  await lib.settle(dm, '!fogColorRafId', 10000);
  await repaintPlayer();
  const blueish = await painted(UNTOUCHED.x, UNTOUCHED.y);
  rig.note('painted fog colour after dialling in #2030c0: ' + JSON.stringify(blueish));
  rig.check(blueish.b > blueish.r + 10,
            'changing the fog colour a second time changed nothing on the TV: ' +
            JSON.stringify(blueish));

  // ── G. The feathered edge is a dial ──────────────────────────────────────
  // ⚠ MEASURED AT A ROOM'S EDGE, NOT A BRUSH STROKE'S. revealCircle punches a hard-edged circle
  // into both fog canvases; Feather is applied by applyPolygonToFog, so a file that measured the
  // brush would read the same ramp at every setting and pass for nothing.
  //
  // Walks out from the middle of a revealed room and reports where fog first appears and where it
  // becomes solid. The gap between the two IS the feather.
  const EDGE = `((cx, cy, span) => {
    const read = d => fogDataCtx.getImageData(
      Math.round((cx + d) / FOG_SCALE), Math.round(cy / FOG_SCALE), 1, 1).data[3];
    let first = null, solid = null;
    for (let d = 0; d < span; d += 2) {
      const a = read(d);
      if (first === null && a > 8) first = d;
      if (solid === null && a > 247) { solid = d; break; }
    }
    return { first, solid, ramp: (first !== null && solid !== null) ? solid - first : null };
  })`;

  const ROOM_CX = (ROOM.x1 + ROOM.x2) / 2, ROOM_CY = (ROOM.y1 + ROOM.y2) / 2;

  const featherEdge = async () => {
    // A fully shrouded base with one revealed room on it, rebuilt through the app's own
    // compositor — writing baseFog alone leaves fogDataCanvas holding the previous state.
    await dm.evaluate('polygons[0].mode = "reveal";' +
      ' baseFogCtx.fillStyle = "#1a1a2e";' +
      ' baseFogCtx.fillRect(0, 0, baseFogCanvas.width, baseFogCanvas.height);' +
      ' rebuildFogFromPolygons(); 0');
    await lib.settle(dm, '!fogTransRafId', 10000);
    return dm.evaluate(EDGE + '(' + ROOM_CX + ',' + ROOM_CY + ',' + (ROOM.x2 - ROOM_CX + 300) + ')');
  };

  await fire('fog-feather', 2);
  const sharp = await featherEdge();
  await fire('fog-feather', 24);
  const soft = await featherEdge();
  rig.note('feather 2: ' + JSON.stringify(sharp) + '  feather 24: ' + JSON.stringify(soft));
  rig.check(sharp.ramp !== null && soft.ramp !== null,
            "the edge of a revealed room could not be measured at all: " +
            JSON.stringify(sharp) + ' / ' + JSON.stringify(soft));
  rig.check(soft.ramp > sharp.ramp,
            'a wider Feather did not soften the edge: the ramp is ' + soft.ramp +
            ' map units at 24 against ' + sharp.ramp + ' at 2');
  // Softer, not smaller. The halfway point is where the room's fog actually ends, and a Feather
  // that moved it would quietly shrink the ground the DM opened. It shifts about 4 map units out
  // of 175 across the whole range of the dial; 20 is a generous ceiling on that.
  const mid = e => e.first + e.ramp / 2;
  rig.note('the edge halfway point moved from ' + mid(sharp) + ' to ' + mid(soft) +
           ' map units out of the room centre');
  rig.check(Math.abs(mid(soft) - mid(sharp)) <= 20,
            'a wider Feather moved the edge instead of softening it: the halfway point went ' +
            'from ' + mid(sharp) + ' to ' + mid(soft) + ' map units');
  await fire('fog-feather', 12);

  // ── H. Half-shroud ───────────────────────────────────────────────────────
  const halfRoom = async mode => {
    await dm.evaluate('polygons[0].mode = ' + JSON.stringify(mode) + ';' +
      ' rebuildFogFromPolygons(); 0');
    await lib.settle(dm, '!fogTransRafId', 10000);
    return dmFog(ROOM_CX, ROOM_CY);
  };

  await fire('fog-half-alpha', 50);
  const halfAt50 = await halfRoom('half');
  const shrouded = await halfRoom('shroud');
  const revealed = await halfRoom('reveal');
  rig.note('room fog — half@50 ' + halfAt50 + ', shroud ' + shrouded + ', reveal ' + revealed);
  rig.check(shrouded === 255 && revealed === 0,
            'a room in shroud or reveal mode is not fully one or the other: ' + shrouded +
            ' / ' + revealed);
  rig.check(halfAt50 > 20 && halfAt50 < 235,
            'a half-shrouded room is not between revealed and shrouded: alpha ' + halfAt50);
  rig.check(Math.abs(halfAt50 - 128) <= 12,
            'half-shroud at 50% did not land on half the fog: alpha ' + halfAt50);

  await fire('fog-half-alpha', 80);
  const halfAt80 = await halfRoom('half');
  rig.check(halfAt80 > halfAt50 + 20,
            'the half-shroud slider did not change how much fog remains: ' + halfAt50 +
            ' at 50% against ' + halfAt80 + ' at 80%');
  rig.check(Math.abs(halfAt80 - 204) <= 12,
            'half-shroud at 80% did not land on 80% of the fog: alpha ' + halfAt80);

  // ABSOLUTE, not a knock-down of what was underneath. Ground that was fully revealed and ground
  // that was fully shrouded must both come out at exactly the same density.
  await dm.evaluate('polygons[0].mode = "shroud"; rebuildFogFromPolygons();' +
    ' revealCircle(' + ROOM_CX + ',' + ROOM_CY + ', 60); 0');
  await lib.settle(dm, '!fogTransRafId', 10000);
  const overRevealed = await halfRoom('half');
  rig.check(Math.abs(overRevealed - halfAt80) <= 6,
            'half-shroud is relative to what was under it rather than absolute: ' + overRevealed +
            ' over revealed ground against ' + halfAt80 + ' over shrouded');
  await fire('fog-half-alpha', 50);

  // ── I. The drift ─────────────────────────────────────────────────────────
  const animState = () => dm.evaluate(`(() => {
    const seg = [...document.querySelectorAll('#cp-anim-row [data-anim]')]
      .filter(b => b.classList.contains('active')).map(b => b.dataset.anim);
    const presets = [...document.querySelectorAll('.anim-preset-btn')]
      .filter(b => b.classList.contains('active')).map(b => b.id);
    return { on: fogAnimEnabled, speed: fogAnimSpeed, seg, presets,
             offsets: fogAnimOffsets.map(o => +(o.x + o.y).toFixed(3)) };
  })()`);

  const segAnim = m => dm.evaluate('(() => { const b = document.querySelector(' +
    JSON.stringify('#cp-anim-row [data-anim="' + m + '"]') + ');' +
    ' if (!b) return "missing"; b.click(); return "clicked"; })()');

  for (const [mode, preset] of [['slow', 'anim-preset-calm'], ['medium', 'anim-preset-default'],
                                ['fast', 'anim-preset-fast']]) {
    rig.check(await segAnim(mode) === 'clicked', 'the panel has no ' + mode + ' drift button');
    const a = await animState();
    rig.check(a.on === true, 'picking the ' + mode + ' drift did not switch the fog animation on');
    rig.check(a.presets.length === 1 && a.presets[0] === preset,
              'the ' + mode + ' drift chose the wrong preset, or more than one: ' +
              JSON.stringify(a.presets));
    rig.check(a.seg.length === 1 && a.seg[0] === mode,
              'the drift segment shows the wrong mode chosen: ' + JSON.stringify(a.seg));
  }

  // Moving, not merely enabled. The offsets only advance on the animation's own tick, so this
  // has to cross real time.
  const t0 = (await animState()).offsets;
  const t1 = (await lib.poll(async () => {
    const now = (await animState()).offsets;
    return t0.some((v, i) => v !== now[i]) ? { offsets: now } : null;
  }, 15000)) || { offsets: (await animState()).offsets };
  const t1o = t1.offsets;
  rig.note('drift offsets: ' + JSON.stringify(t0) + ' → ' + JSON.stringify(t1o));
  rig.check(t0.some((v, i) => v !== t1o[i]),
            'the fog animation is switched on and the clouds are not moving: the offsets are ' +
            'still ' + JSON.stringify(t1o));

  await segAnim('off');
  const stopped = await animState();
  rig.check(stopped.on === false, "the drift segment's Off did not switch the animation off");
  const s0 = stopped.offsets;
  await lib.hold(900, 'the drift is off, so there is no state to poll for - long enough for ' +
    'a running animation to have moved the offsets, then prove it did not');
  const s1 = (await animState()).offsets;
  rig.check(s0.every((v, i) => v === s1[i]),
            'the fog is still drifting after the animation was switched off: ' +
            JSON.stringify(s0) + ' → ' + JSON.stringify(s1));

  // ── J. Reset Fog Settings ────────────────────────────────────────────────
  await fire('fog-color', '#c02020');
  await fire('fog-tint-alpha', 70);
  await fire('fog-feather', 3);
  await fire('fog-half-alpha', 77);
  await lib.settle(dm, '!fogColorRafId', 10000);
  // ⚠ Reset ASKS FIRST, and confirmDialog answers asynchronously — reading the dials straight
  // after the click reads them before anyone said yes.
  await dm.evaluate('document.getElementById("cp-fog-reset").click(); 0');
  await dm.waitFor('document.getElementById("cd-ok")', 5000, 'the reset confirmation');
  await dm.evaluate('document.getElementById("cd-ok").click(); 0');
  await lib.settle(dm, 'fogFeatherRadius === 12 && !fogColorRafId', 10000);
  const afterReset = await dm.evaluate(`({
    color: document.getElementById('fog-color').value,
    tint: +document.getElementById('fog-tint-alpha').value,
    feather: fogFeatherRadius,
    halfPct: Math.round(fogHalfAlpha * 100),
    halfSlider: +document.getElementById('fog-half-alpha').value,
    preset: (document.querySelector('.anim-preset-btn.active') || {}).id || null,
  })`);
  rig.note('after Reset Fog Settings: ' + JSON.stringify(afterReset));
  rig.check(afterReset.color === '#3a3a8c' && afterReset.tint === 18,
            'Reset did not put the fog colour and tint back: ' + JSON.stringify(afterReset));
  rig.check(afterReset.feather === 12, 'Reset did not put Feather back to 12: ' + afterReset.feather);
  rig.check(afterReset.preset === 'anim-preset-default',
            'Reset did not put the drift back on the default preset: ' + afterReset.preset);
  // The one dial Reset must not touch. It persists across restarts because the DM tunes it over
  // several sittings, so resetting it would throw that away rather than restore a default.
  rig.check(afterReset.halfPct === 77 && afterReset.halfSlider === 77,
            'Reset Fog Settings swept away the half-shroud density, which is the one dial in ' +
            'that panel that persists: ' + JSON.stringify(afterReset));

  // ── K. The look at the table ─────────────────────────────────────────────
  await dm.evaluate('document.getElementById("btn-fill-fog").click(); 0');
  await dm.evaluate('revealCircle(' + REVEAL.x + ',' + REVEAL.y + ',' + REVEAL.r + '); sendToPlayer(); 0');
  await lib.settle(player, '!viewportDirty && !fogDirty && !fogTransRafId && !fogColorRafId', 15000);
  const shot = path.join(rig.outDir, 'player-fog.png');
  await player.screenshot(shot);
  rig.note('Player screenshot: ' + shot);
  rig.byEye('whether the revealed area in ' + shot + ' reads as a clearing in cloud rather than ' +
            'a hole cut in felt — fog quality is a look-and-feel call, not a pixel one');
  rig.byEye('whether the drift at each of the three speeds reads as weather rather than as a ' +
            'texture sliding — speed is a feel call at the table, on a TV');

  // ── L. The colour picker itself ───────────────────────────────────────────
  // ⚠ EVERY CHECK ABOVE SETS THE HIDDEN `fog-color` INPUT DIRECTLY, which is not a thing the DM
  // can do. The square, the hue strip and the hex field are the only way they reach the colour,
  // and none of them had a check: a dead hex field would ship.
  //
  // ⚠ THE FOG TAB HAS TO BE OPEN. An element inside `display:none` has zero-sized rects, so a
  // click on the square lands nowhere and the picker correctly does nothing - which reads as the
  // picker being broken.
  // ⚠ THE TAB TOGGLES, so a blind click on an already-open Fog tab SHUTS the panel - and every
  // element inside it then has zero-sized rects, so the press below lands nowhere and the
  // picker correctly does nothing. _cpSelectTab is the app's one way to open a named pane.
  await dm.evaluate('_cpSelectTab("fog"); 0');
  await lib.settle(dm, '!document.getElementById("sidebar-right").hidden', 8000);
  await lib.settle(dm,
    'document.querySelector(\'.cp-picker[data-picker="fog"] .cp-sv-canvas\')' +
    '.getBoundingClientRect().width > 0', 8000);

  const picker = () => dm.evaluate(`(() => {
    const root = document.querySelector('.cp-picker[data-picker="fog"]');
    if (!root) return { err: 'the fog tab carries no colour picker' };
    const sv = root.querySelector('.cp-sv-canvas');
    const box = sv.getBoundingClientRect();
    const cur = root.querySelector('.cp-sv-cursor');
    return {
      hex: (root.querySelector('.cp-hex') || {}).value || '',
      hue: +(root.querySelector('.cp-hue') || {}).value,
      swatch: getComputedStyle(root.querySelector('.cp-swatch')).backgroundColor,
      cursorLeft: parseFloat(cur.style.left), cursorTop: parseFloat(cur.style.top),
      input: document.getElementById('fog-color').value,
      picked: fogPickedHex,
      box: { w: Math.round(box.width), h: Math.round(box.height) },
    };
  })()`);

  const typeHex = v => dm.evaluate(`(() => {
    const el = document.querySelector('.cp-picker[data-picker="fog"] .cp-hex');
    el.value = ${JSON.stringify(v)};
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 0;
  })()`);

  const start = await picker();
  rig.note('the fog picker: ' + JSON.stringify(start));
  rig.check(!start.err && start.box.w > 0 && start.box.h > 0,
            'the fog colour picker has no saturation square to click: ' + JSON.stringify(start));

  // The hex field, which is the one control that takes a value the DM can read off a palette.
  await typeHex('2E8B57');
  const typed = await picker();
  rig.note('after typing 2E8B57: ' + JSON.stringify(typed));
  rig.check(typed.input.toLowerCase() === '#2e8b57',
            'a hex typed into the picker did not reach the fog colour: ' + typed.input);
  rig.check(typed.picked.toLowerCase() === '#2e8b57',
            'the app did not take the typed colour as the fog colour: ' + typed.picked);
  rig.check(typed.swatch === 'rgb(46, 139, 87)',
            'the swatch does not show the colour that was typed: ' + typed.swatch);
  rig.check(typed.hue > 130 && typed.hue < 160,
            'the hue strip did not move to the typed colour: ' + typed.hue);

  // Three digits is how a hex is written half the time, and it has to expand rather than be
  // taken as a colour of its own.
  await typeHex('F0C');
  const short = await picker();
  rig.check(short.input.toLowerCase() === '#ff00cc',
            'a three-digit hex did not expand to six: ' + short.input);

  // Nonsense must leave the colour alone and put the field back to what is actually set. A field
  // that keeps the typing and a colour that did not change is how the DM loses track of both.
  await typeHex('zzzz');
  const junk = await picker();
  rig.note('after typing nonsense: ' + JSON.stringify(junk));
  rig.check(junk.input.toLowerCase() === '#ff00cc',
            'nonsense in the hex field changed the fog colour: ' + junk.input);
  rig.check(junk.hex.toLowerCase() === 'ff00cc',
            'the hex field kept the nonsense instead of showing the colour that is set: ' +
            junk.hex);

  // The hue strip, dragged. Saturation and value stay where they were, which is the whole point
  // of a hue strip beside a square.
  await dm.evaluate(`(() => {
    const el = document.querySelector('.cp-picker[data-picker="fog"] .cp-hue');
    el.value = '210';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 0;
  })()`);
  const hued = await picker();
  rig.note('after dragging the hue to 210: ' + JSON.stringify(hued));
  rig.check(hued.input.toLowerCase() === '#0080ff',
            'the hue strip did not set the fog colour to the hue it was dragged to: ' + hued.input);
  rig.check(Math.abs(hued.cursorLeft - junk.cursorLeft) < 1 &&
            Math.abs(hued.cursorTop - junk.cursorTop) < 1,
            'changing the hue moved the saturation square as well, so the DM cannot pick a hue ' +
            'without losing the shade: ' + JSON.stringify([junk.cursorLeft, junk.cursorTop]) +
            ' → ' + JSON.stringify([hued.cursorLeft, hued.cursorTop]));

  // The square, pressed a quarter across and a fifth down. The picker reads the pointer against
  // the canvas box it captured on mousedown, so this is the real gesture.
  const pressed = await dm.evaluate(`(() => {
    const sv = document.querySelector('.cp-picker[data-picker="fog"] .cp-sv-canvas');
    const b = sv.getBoundingClientRect();
    const at = (type, fx, fy) => sv.dispatchEvent(new MouseEvent(type, {
      clientX: b.left + b.width * fx, clientY: b.top + b.height * fy,
      bubbles: true, cancelable: true, button: 0 }));
    at('mousedown', 0.25, 0.20);
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return 0;
  })()`);
  const square = await picker();
  rig.note('after pressing the square at 25%, 20%: ' + JSON.stringify(square));
  rig.check(Math.abs(square.cursorLeft - 25) < 3 && Math.abs(square.cursorTop - 20) < 3,
            'the square did not take the press where it was aimed: the marker sits at ' +
            square.cursorLeft + '%, ' + square.cursorTop + '%');
  rig.check(square.input.toLowerCase() !== hued.input.toLowerCase(),
            'pressing the saturation square changed no colour at all, so the square is dead: ' +
            square.input);
  rig.check(square.hue === hued.hue,
            'pressing the square moved the hue as well: ' + hued.hue + ' → ' + square.hue);
  rig.check(square.picked.toLowerCase() === square.input.toLowerCase(),
            'the colour the square set never reached the app: field ' + square.input +
            ' against ' + square.picked);

  // ── M. The Auto/Manual gate, on fog ──────────────────────────────────────
  // ⚠ THIS GATE WAS ONLY EVER CHECKED ON EFFECTS. It is a fog control - "let me open the next
  // room before they see it" - and the fog half of it was asserted nowhere, so the one thing
  // the DM relies on between rooms had no check at all.
  await dm.evaluate('document.getElementById("btn-fill-fog").click(); sendToPlayer(); 0');
  await lib.settle(player, '(' + lib.TV_FOG + ')(' + HELD.x + ',' + HELD.y + ') > 200', 20000);
  rig.check(await player.evaluate('(' + lib.TV_FOG + ')(' + HELD.x + ',' + HELD.y + ')') > 200,
            'the TV is not fogged at the point the gate uses, so a reveal that leaks through ' +
            'would be indistinguishable from one that did not');
  rig.check(await dm.evaluate('autoSync === true'),
            'auto-sync is not on at the start of the gate check, so switching it off below proves nothing');

  await dm.evaluate('(() => { const b = document.getElementById("btn-auto-sync");' +
                    ' if (autoSync) b.click(); return 0; })()');
  rig.check(await dm.evaluate('autoSync') === false, 'auto-sync did not switch off');

  await dm.evaluate('revealCircle(' + HELD.x + ',' + HELD.y + ', 160);' +
                    ' fogDirty = true; scheduleRender(); 0');
  rig.check(await dm.evaluate('__rigFog(' + HELD.x + ',' + HELD.y + ')') === 0,
            'the reveal did not take on the DM, so the gate below is measuring nothing');
  // ⚠ POLLED FOR THE WRONG ANSWER, with a bound. A single read straight after the reveal would
  // pass even on a broken gate, because the delivery had not had time to happen yet.
  const readTv = () => player.evaluate('(' + lib.TV_FOG + ')(' + HELD.x + ',' + HELD.y + ')');
  // ⚠ WRAPPED, NEVER RETURNED BARE. lib.poll takes a falsy answer as "not found", and a
  // leaked alpha of 0 is falsy - so returning the number itself makes the poll run its full
  // bound and report no leak on the one reading that IS the leak.
  const leaked = await lib.poll(async () => {
    const a = await readTv();
    return a < 60 ? { alpha: a } : null;
  }, 6000);
  rig.note('the TV at the held point, with Auto off: ' +
           (leaked === null ? await readTv() : leaked.alpha));
  rig.check(leaked === null,
            'a reveal made with Auto off reached the TV anyway (alpha ' + (leaked && leaked.alpha) + '), so the DM cannot open a room before the players see it');

  await dm.evaluate('sendToPlayer(); 0');
  await lib.settle(player, '(' + lib.TV_FOG + ')(' + HELD.x + ',' + HELD.y + ') < 60', 20000);
  rig.check(await player.evaluate('(' + lib.TV_FOG + ')(' + HELD.x + ',' + HELD.y + ')') < 60,
            'pressing Send did not deliver the held reveal to the TV, so Manual mode strands the fog on the DM');

  await dm.evaluate('(() => { const b = document.getElementById("btn-auto-sync");' +
                    ' if (!autoSync) b.click(); return 0; })()');
  rig.check(await dm.evaluate('autoSync') === true,
            'auto-sync would not switch back on, so the DM is stuck in Manual');

};
