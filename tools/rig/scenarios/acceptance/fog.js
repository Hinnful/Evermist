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
//
// ⚠ THE PLAYER'S FOG IS CANVAS-2D DRAWN ON TOP OF THE PIXIJS MAP (docs/DECISIONS.md), so its
// painted fog can be read straight off #fog-canvas — colour included, which the DM's GPU path
// cannot give up as cheaply. Canvas pixels are CSS pixels here: syncSize sets width/height from
// clientWidth/clientHeight with no devicePixelRatio, so a map point converts to a fog-canvas
// pixel with the camera transform alone.
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
//
// ⚠ THE MAP IS ANIMATED, AND EVERY ACCEPTANCE FILE'S IS. Animated is the only kind the DM
// ever uses, so a suite running on still PNGs proved the app worked in a case that never
// happens. `tableMap` (tools/rig/fixtures.js) records the clip once per run and caches it by
// size. Do not swap it back to `stillMap`; smoke.js is the one file that wants both.

const path = require('path');

// Where the DM reveals, and where it deliberately does not. Both well inside the map and far
// apart, so the feathered edge of the reveal cannot reach the untouched sample.
const MAP_W = 2000, MAP_H = 1200;
const REVEAL = { x: 500, y: 300, r: 250 };
const UNTOUCHED = { x: 1500, y: 900 };
const ROOM = { x1: 1050, y1: 620, x2: 1400, y2: 860 };   // clear of both samples above

module.exports = async function fogFeature(rig) {
  const dm = rig.dm;

  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir,
    { w: MAP_W, h: MAP_H });
  const fileExpr = await rig.fixtures.asFileExpr(dm, map);
  await dm.evaluate('createNewScene(' + fileExpr + ')', 120000);
  await dm.waitFor('currentScene && currentScene.mapType === "video" && mapWidth === ' + MAP_W,
                   120000, 'the map to load on the DM');

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
  const SAMPLE_PAINTED = `((mx, my) => {
    const sx = Math.round(mx * zoom + panX), sy = Math.round(my * zoom + panY);
    const c = document.getElementById('fog-canvas');
    if (sx < 0 || sy < 0 || sx >= c.width || sy >= c.height) return { a: -1 };
    const d = c.getContext('2d').getImageData(sx, sy, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] };
  })`;
  const repaintPlayer = async () => {
    await player.evaluate('viewportDirty = true; fogDirty = true; scheduleRender(); 0');
    await rig.sleep(500);
  };
  const painted = (x, y) => player.evaluate(SAMPLE_PAINTED + '(' + x + ',' + y + ')');

  await repaintPlayer();
  const paintedRevealed = await painted(REVEAL.x, REVEAL.y);
  const paintedUntouched = await painted(UNTOUCHED.x, UNTOUCHED.y);
  const layerOpacity = await player.evaluate(
    "getComputedStyle(document.getElementById('fog-canvas')).opacity");
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
  await rig.sleep(400);
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
  await rig.sleep(400);
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
  await rig.sleep(400);
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
  await rig.sleep(500);
  await fire('fog-color', '#c02020');
  await fire('fog-tint-alpha', 60);
  await rig.sleep(600);
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
  await rig.sleep(600);
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
    await rig.sleep(300);
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
    await rig.sleep(300);
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
  await rig.sleep(250);
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
  await rig.sleep(1200);
  const t1 = (await animState()).offsets;
  rig.note('drift offsets: ' + JSON.stringify(t0) + ' → ' + JSON.stringify(t1));
  rig.check(t0.some((v, i) => v !== t1[i]),
            'the fog animation is switched on and the clouds are not moving: the offsets are ' +
            'still ' + JSON.stringify(t1));

  await segAnim('off');
  const stopped = await animState();
  rig.check(stopped.on === false, "the drift segment's Off did not switch the animation off");
  const s0 = stopped.offsets;
  await rig.sleep(900);
  const s1 = (await animState()).offsets;
  rig.check(s0.every((v, i) => v === s1[i]),
            'the fog is still drifting after the animation was switched off: ' +
            JSON.stringify(s0) + ' → ' + JSON.stringify(s1));

  // ── J. Reset Fog Settings ────────────────────────────────────────────────
  await fire('fog-color', '#c02020');
  await fire('fog-tint-alpha', 70);
  await fire('fog-feather', 3);
  await fire('fog-half-alpha', 77);
  await rig.sleep(400);
  await dm.evaluate('document.getElementById("cp-fog-reset").click(); 0');
  await rig.sleep(600);
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
  await rig.sleep(800);
  const shot = path.join(rig.outDir, 'player-fog.png');
  await player.screenshot(shot);
  rig.note('Player screenshot: ' + shot);
  rig.byEye('whether the revealed area in ' + shot + ' reads as a clearing in cloud rather than ' +
            'a hole cut in felt — fog quality is a look-and-feel call, not a pixel one');
  rig.byEye('whether the drift at each of the three speeds reads as weather rather than as a ' +
            'texture sliding — speed is a feel call at the table, on a TV');
};
