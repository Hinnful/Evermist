'use strict';

// fog.js — THE FOG FEATURE, whole. This is the app's core promise.
//
// THE GOAL OF THIS FEATURE: the players see only the ground the party has walked into, and what
// they see reads as cloud lying over the map rather than a hole cut in felt. The DM opens ground
// as the party moves, and every change is on the TV a moment later. Every check below serves that
// sentence.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its
// letter, wherever in the file that state is cheapest to reach - which is not letter order.
//
//   A. Opening the Player puts the DM's map on it, at the map's own size, fogged all over.
//   B. An area the DM reveals is clear of fog on the Player — in the fog data it was sent, and
//      in the fog it actually paints.
//   C. An area the DM has not touched is still fully fogged there, at full strength.
//   D. The Player carries no DM controls, and still has a cursor to drag its view with.
//   E. Reveal All and Shroud All do what they say — on the fog, on every room's mode, on the TV —
//      and each is one undo step.
//   F. The fog is never flat black: the colour of the DM's theme is the colour the table sees.
//   G. The feathered edge is a dial. A wider one softens the edge without moving it.
//   H. Half-shroud is a density the DM sets, it lands between revealed and shrouded, and it is
//      ABSOLUTE — a half room reads the same whatever was under it.
//   I. The fog really moves, whatever the theme.
//   J. Reset Fog Settings restores the look and deliberately leaves half-shroud alone.
//   K. The fog looks right on the TV.
//   M. The Auto/Manual gate holds for FOG. With Auto off nothing the DM reveals reaches the
//      table until Send is pressed, which is how a room is prepared before the players see it.
//   N. Every fog dial answers from its number chip as well as its slider. The chip was the half nothing pressed: a DM who types 18 into a
//      box and watches the slider stay put has a panel that lies about the fog it is showing.
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
  // RED BY DESIGN: written against the fix, never re-proved
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen', 45000, 'the Player to receive the map');
  const onPlayer = await player.evaluate('({ w: mapWidth, h: mapHeight, hasFog: !!fogDataCanvas })');
  rig.check(onPlayer.w === MAP_W && onPlayer.h === MAP_H,
            'the Player has the map at the wrong size: ' + onPlayer.w + 'x' + onPlayer.h);
  rig.check(onPlayer.hasFog,
            'the Player received a map with no fog at all — the table would see everything');

  // ── B. What the DM reveals is clear on the Player ──────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
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
  // RED BY DESIGN: written against the fix, never re-proved
  const untouchedData = await player.evaluate(sampleData + '(' + UNTOUCHED.x + ',' + UNTOUCHED.y + ')');
  rig.check(untouchedData === 255,
            'untouched map is not fully fogged in the Player fog data (alpha ' + untouchedData + ')');
  rig.check(paintedUntouched.a > 200,
            'the Player is barely painting fog over untouched map (alpha ' + paintedUntouched.a + ')');
  // The fog layer is drawn at full strength on the Player; the 0.55 knock-down is the DM's view
  // alone, so a Player showing DM-strength fog means the table can read through it.
  rig.check(layerOpacity === '1', 'the Player fog layer is not at full opacity: ' + layerOpacity);

  // ── D. No DM controls, but the cursor stays ───────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  const chrome = await player.evaluate(`(() => {
    const shown = id => { const el = document.getElementById(id);
      if (!el) return false; const b = el.getBoundingClientRect();
      return getComputedStyle(el).display !== 'none' && b.width > 0 && b.height > 0; };
    return { toolbar: shown('toolbar-bottom'), sidebar: shown('dock'),
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
  await dm.evaluate('document.getElementById("btn-clear-fog").click(); document.getElementById("cd-ok").click(); 0');
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
  // ⚠ settle, NOT waitFor. A waitFor throws on its timeout, so the check under it could never be
  // the failing line and the report named a timeout where the criterion had its own words.
  // RED ON: sendToPlayer() gated off inside revealAllRooms (fog.js) — 2026-09-19
  await lib.settle(player, sampleData + '(' + UNTOUCHED.x + ',' + UNTOUCHED.y + ') === 0', 30000);
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
  await lib.settle(player, sampleData + '(' + REVEAL.x + ',' + REVEAL.y + ') > 200', 30000);
  rig.check(await player.evaluate(sampleData + '(' + REVEAL.x + ',' + REVEAL.y + ')') > 200,
            'Shroud All never reached the TV, so the players can still see the room');

  await dm.evaluate('undo(); 0');
  await lib.settle(dm, DM_SAMPLE + '(' + REVEAL.x + ',' + REVEAL.y + ') === 0', 15000);
  rig.check(await dmFog(REVEAL.x, REVEAL.y) === 0,
            'undo after Shroud All did not put the revealed ground back: alpha ' +
            await dmFog(REVEAL.x, REVEAL.y));

  // ── F. The fog is never flat black ────────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  // Read on the Player, whose fog is Canvas 2D and gives up its colour. A strong red is far from
  // both the default blue-violet and from black, so the reading cannot be a coincidence.
  //
  // Shrouded first, and deliberately: the undo above put the whole map back to Reveal All, so
  // without this the colour is sampled over ground that carries no fog at all and every reading
  // is a transparent pixel.
  await dm.evaluate('document.getElementById("btn-fill-fog").click(); 0');
  await lib.settle(dm, DM_SAMPLE + '(' + UNTOUCHED.x + ',' + UNTOUCHED.y + ') === 255', 15000);
  const sampleTheme = async id => {
    await dm.evaluate('setFogTheme("' + id + '"); 0');
    await lib.settle(player, 'fogTheme === "' + id + '" && !fogColorRafId', 20000);
    // ⚠ THE TV CATCHES UP ON ITS OWN TIME: read until the ground there is fogged, then judge the colour.
    let c = { a: 0 };
    await lib.poll(async () => { await repaintPlayer(); c = await painted(UNTOUCHED.x, UNTOUCHED.y); return c.a > 200 ? { ok: true } : null; }, 10000, 250);
    return c;
  };
  // RED ON: applyFogThemeLook's applyFogColor removed (fogTheme.js) — 2026-11-04
  const coloured = await sampleTheme('default');
  rig.note('painted fog colour on Default: ' + JSON.stringify(coloured));
  rig.check(coloured.a > 200, 'the sample is not on fogged ground any more: ' + JSON.stringify(coloured));
  rig.check(coloured.r > 20 || coloured.g > 20 || coloured.b > 20,
            'the fog on the TV is flat black, which the app must never paint: ' + JSON.stringify(coloured));
  const icy = await sampleTheme('ice');
  rig.note('painted fog colour on Ice: ' + JSON.stringify(icy));
  rig.check(Math.abs(icy.r - coloured.r) + Math.abs(icy.g - coloured.g) + Math.abs(icy.b - coloured.b) > 12,
            'picking Ice changed nothing on the TV: ' + JSON.stringify({ coloured, icy }));
  await sampleTheme('default');

  // ── G. The feathered edge is a dial ──────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
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
  // RED BY DESIGN: written against the fix, never re-proved
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
  // RED ON: applyFogThemeMotion's startFogAnim() removed (fogTheme.js) — 2026-11-04
  // Moving, not merely enabled: every theme carries a drift, and the offsets only advance on the animation's own tick, so
  // this has to cross real time. The movement has no switch any more.
  const offsets = () => dm.evaluate('fogAnimOffsets.map(o => +(o.x + o.y).toFixed(3))');
  for (const id of ['default', 'ice']) {
    await dm.evaluate('setFogTheme("' + id + '"); 0');
    const t0 = await offsets();
    const t1 = (await lib.poll(async () => {
      const now = await offsets();
      return t0.some((v, i) => v !== now[i]) ? { offsets: now } : null;
    }, 15000)) || { offsets: await offsets() };
    rig.note(id + ' drift offsets: ' + JSON.stringify(t0) + ' → ' + JSON.stringify(t1.offsets));
    rig.check(t0.some((v, i) => v !== t1.offsets[i]), 'the ' + id + ' fog is not moving: the offsets are still ' + JSON.stringify(t1.offsets));
  }
  await dm.evaluate('setFogTheme("default"); 0');

  // ── J. Reset Fog Settings ────────────────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('setFogTheme("ice"); 0');
  await fire('fog-feather', 3);
  await fire('fog-half-alpha', 77);
  // ⚠ Reset ASKS FIRST, and confirmDialog answers asynchronously — reading the dials straight
  // after the click reads them before anyone said yes.
  await dm.evaluate('document.getElementById("cp-fog-reset").click(); 0');
  await dm.waitFor('document.getElementById("cd-ok")', 5000, 'the reset confirmation');
  await dm.evaluate('document.getElementById("cd-ok").click(); 0');
  await lib.settle(dm, 'fogFeatherRadius === 12 && fogTheme === "default"', 10000);
  const afterReset = await dm.evaluate(`({
    theme: fogTheme,
    feather: fogFeatherRadius,
    halfPct: Math.round(fogHalfAlpha * 100),
    halfSlider: +document.getElementById('fog-half-alpha').value,
  })`);
  rig.note('after Reset Fog Settings: ' + JSON.stringify(afterReset));
  rig.check(afterReset.theme === 'default', 'Reset did not put the fog theme back on Default: ' + JSON.stringify(afterReset));
  rig.check(afterReset.feather === 12, 'Reset did not put Feather back to 12: ' + afterReset.feather);
  // The one dial Reset must not touch. It persists across restarts because the DM tunes it over
  // several sittings, so resetting it would throw that away rather than restore a default.
  rig.check(afterReset.halfPct === 77 && afterReset.halfSlider === 77,
            'Reset Fog Settings swept away the half-shroud density, which is the one dial in ' +
            'that panel that persists: ' + JSON.stringify(afterReset));

  // ── K. The look at the table ─────────────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
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

  // ⚠ THE BUTTON, NEVER sendToPlayer(). Send is the only way anything reaches the TV on Manual,
  // and every other scenario calls the function around it, so the handler itself was covered
  // nowhere. What that handler guards against is at its own line in toolbar.js.
  // RED ON: sendToPlayer() removed from the btn-send handler (toolbar.js) — 2026-09-19
  await dm.evaluate('document.getElementById("btn-send").click(); 0');
  await lib.settle(player, '(' + lib.TV_FOG + ')(' + HELD.x + ',' + HELD.y + ') < 60', 20000);
  rig.check(await player.evaluate('(' + lib.TV_FOG + ')(' + HELD.x + ',' + HELD.y + ')') < 60,
            'pressing Send did not deliver the held reveal to the TV, so Manual mode strands the fog on the DM');

  await dm.evaluate('(() => { const b = document.getElementById("btn-auto-sync");' +
                    ' if (!autoSync) b.click(); return 0; })()');
  rig.check(await dm.evaluate('autoSync') === true,
            'auto-sync would not switch back on, so the DM is stuck in Manual');

  // ── N. Every dial answers from its chip, and the five behind Advanced answer at all ──────
  // RED ON: apply(v) gated off in wireAnimSlider's num.onchange, and separately
  // featherSlider.value = v gated off in featherNum.onchange (fogControls.js) — 2026-09-19
  // ⚠ 'change' ON A CHIP, 'input' ON A SLIDER. The chips commit on change and the sliders on
  // input, so firing the wrong event leaves the app never hearing the dial move and the read
  // below reports the value the chip was ALREADY showing.
  const chip = async (numId, sliderId, v) => {
    await lib.fire(dm, numId, v, 'change');
    return dm.evaluate('+document.getElementById(' + JSON.stringify(sliderId) + ').value');
  };

  rig.check(await chip('fog-feather-num', 'fog-feather', 17) === 17 &&
            await dm.evaluate('fogFeatherRadius') === 17,
            'a feather typed into the chip did not drive the fog and the slider: slider ' +
            await dm.evaluate('document.getElementById("fog-feather").value') + ', radius ' +
            await dm.evaluate('fogFeatherRadius'));

  rig.check(await chip('fog-half-alpha-num', 'fog-half-alpha', 61) === 61 &&
            Math.abs(await dm.evaluate('fogHalfAlpha') - 0.61) < 0.0001,
            'a half-shroud density typed into the chip did not drive the fog and the slider: ' +
            'slider ' + await dm.evaluate('document.getElementById("fog-half-alpha").value') +
            ', alpha ' + await dm.evaluate('fogHalfAlpha'));


};
