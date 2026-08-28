'use strict';

// everything-reaches-the-player.js — one Player window, one table session, checked at every step.
//
// THE CRITERIA ARE THIS HEADER. Each line below has its check directly beneath it in the code,
// in the same order. There is no separate criteria document.
//
//   A. A room drawn in shroud mode darkens that ground on the TV.
//   B. Moving that room takes the shroud with it: where it was clears, where it went darkens.
//   C. Rooms themselves never reach the Player, so a room's name and notes cannot leak.
//   D. Switching scenes puts the NEW map on the TV, at its own size.
//   E. A switch delivers the map ONCE. A second delivery lands before the Player's cover has
//      closed, which is the one moment the cover exists to hide.
//   F. Sync View puts the DM's region on the TV.
//
// WHY THIS FILE EXISTS ALONGSIDE THE OTHER THREE PLAYER SCENARIOS. They each prove one thing
// ARRIVING — fog, effects, grid. Nothing proved anything CHANGING: no scenario had ever switched
// a scene with the Player open, moved a room, or pressed Sync View. Those are the actions a DM
// takes most at the table, and they were the untested half of the app's whole promise.
//
// ⚠ ROOMS DO NOT CROSS TO THE PLAYER, AND MUST NOT. What crosses is the fog a room paints
// (CLAUDE.md). So every check here reads the FOG over the ground a room covers, never a room. A
// check written against the Player's `polygons` would pass on an empty array forever.
//
// ⚠ THE MAP STARTS FULLY FOGGED, so a shroud room over untouched ground changes nothing and a
// check on it passes without the app doing anything. Ground is REVEALED first, and the shroud
// room is drawn inside the clearing.
//
// ⚠ WAIT OUT THE SCENE COVER BEFORE READING PAINTED FOG (fogCoverT). A fresh map arrives under a
// full-fog cover that punches nothing, so every sample reads opaque no matter what was revealed.
//
// ⚠ THE MAP IS ANIMATED, AND EVERY ACCEPTANCE FILE'S IS. Animated is the only kind the DM
// ever uses, so a suite running on still PNGs proved the app worked in a case that never
// happens. `tableMap` (tools/rig/fixtures.js) records the clip once per run and caches it by
// size. Do not swap it back to `stillMap`; smoke.js is the one file that wants both.

const MAP_W = 2000, MAP_H = 1200;          // scene one
const MAP2_W = 1600, MAP2_H = 1000;        // scene two, a different size so a switch is visible

// A clearing, and two spots inside it far enough apart that the fog's feathered edge cannot
// carry from one to the other.
const CLEAR = { x: 600, y: 400, r: 350 };
const ROOM_A = { x1: 400, y1: 250, x2: 600, y2: 450 };
const AT_A = { x: 500, y: 350 };           // inside the room where it is drawn
const MOVE = { dx: 200, dy: 100 };
const AT_B = { x: AT_A.x + MOVE.dx, y: AT_A.y + MOVE.dy };   // inside it after the move

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
0`;

// The Player's own source of truth for fog, at 1/FOG_SCALE. Alpha 255 is fully hidden ground,
// 0 is clear. Read from the DATA canvas rather than the painted one wherever the question is
// "was it delivered", so a missed repaint cannot read as a missed delivery.
const SAMPLE = `((mx, my) => fogDataCtx.getImageData(
  Math.round(mx / FOG_SCALE), Math.round(my / FOG_SCALE), 1, 1).data[3])`;

// Counts fog-update messages as the Player receives them. A listener added here reaches the same
// messages the app's own handler does — postMessage dispatches to every listener — so this
// observes delivery without changing it. NOT an app-side hook: it lives only in this run.
const COUNTER = `
globalThis.__rigFogUpdates = 0;
window.addEventListener('message', e => {
  if (e && e.data && e.data.type === 'fog-update') globalThis.__rigFogUpdates++;
});
0`;

module.exports = async function everythingReachesThePlayer(rig) {
  const dm = rig.dm;

  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir,
    { w: MAP_W, h: MAP_H });
  await dm.evaluate('createNewScene(' + (await rig.fixtures.asFileExpr(dm, map)) + ')', 120000);
  await dm.waitFor('currentScene && currentScene.mapType === "video" && mapWidth === ' + MAP_W,
                   120000, 'the first map to load on the DM');
  await dm.evaluate(HELPERS);
  const sceneOne = await dm.evaluate('currentScene.id');

  // BOTH SCENES EXIST BEFORE THE PLAYER OPENS. See the warning on D: an import made while the
  // Player is open clears the map request it made on opening, and E cannot then measure anything.
  const map2 = await rig.fixtures.tableMap(dm, rig.fixtureDir,
    { w: MAP2_W, h: MAP2_H });
  await dm.evaluate('createNewScene(' + (await rig.fixtures.asFileExpr(dm, map2)) + ')', 120000);
  await dm.waitFor('currentScene && mapWidth === ' + MAP2_W, 120000, 'the second map on the DM');
  const sceneTwo = await dm.evaluate('currentScene.id');
  await dm.evaluate('switchScene("' + sceneOne + '"); 0', 120000);
  await dm.waitFor('currentScene && currentScene.id === "' + sceneOne + '" && mapWidth === ' + MAP_W,
                   120000, 'the first map to come back before the Player opens');

  // Auto-sync is what carries a fog change to the Player. Asserted rather than assumed: with it
  // off, every check below would be reading the Player's own untouched defaults and passing.
  rig.check(await dm.evaluate('autoSync === true'),
            'auto-sync is off, so nothing the DM does could reach the Player and every check ' +
            'below would be measuring the Player\'s own starting state');

  const player = await rig.player();
  await player.waitFor('!!mapOffscreen && !!fogDataCanvas', 45000, 'the Player to receive the map');
  await player.waitFor('fogCoverT === 0', 45000, 'the scene cover to lift on the Player');
  await player.evaluate(COUNTER);

  // The clearing the shroud room is drawn inside. revealCircle is the app's own fog operation.
  await dm.evaluate('revealCircle(' + CLEAR.x + ',' + CLEAR.y + ',' + CLEAR.r + ');' +
                    'rebuildFogEffect(); fogDirty = true; scheduleRender(); scheduleAutoSync(); 0');
  await player.waitFor(SAMPLE + '(' + AT_A.x + ',' + AT_A.y + ') === 0', 30000,
                       'the clearing to reach the Player');

  // ── A. A shroud room darkens that ground on the TV ────────────────────────
  await dm.evaluate('setShape("rect"); document.getElementById("btn-shroud").click(); 0');
  await dm.evaluate('__rigDrag(' + ROOM_A.x1 + ',' + ROOM_A.y1 + ',' +
                                   ROOM_A.x2 + ',' + ROOM_A.y2 + '); 0');
  rig.check(await dm.evaluate('polygons.length') === 1, 'the shroud room was not created on the DM');
  rig.check(await dm.evaluate('polygons[0].mode') === 'shroud',
            'the room was created in the wrong fog mode, so it would not darken anything');

  try { await player.waitFor(SAMPLE + '(' + AT_A.x + ',' + AT_A.y + ') > 200', 30000,
                             'the shroud to reach the Player'); } catch (_) {}
  const shroudArrived = await player.evaluate(SAMPLE + '(' + AT_A.x + ',' + AT_A.y + ')');
  rig.note('ground under the shroud room — clear 0, after the room ' + shroudArrived);
  rig.check(shroudArrived > 200,
            'a room drawn in shroud mode left that ground visible on the TV (alpha ' +
            shroudArrived + ' where 255 is hidden) — the players can see what the DM hid');

  // ── B. Moving the room takes the shroud with it ───────────────────────────
  await dm.evaluate('setShape("select"); 0');
  await dm.evaluate('__rigDrag(' + AT_A.x + ',' + AT_A.y + ',' + AT_A.x + ',' + AT_A.y + '); 0');
  rig.check(await dm.evaluate('selectedPolygonId !== null'),
            'clicking inside the room did not select it, so the move below moves nothing');
  await dm.evaluate('__rigDrag(' + AT_A.x + ',' + AT_A.y + ',' + AT_B.x + ',' + AT_B.y + '); 0');
  await dm.evaluate('scheduleAutoSync(); 0');

  try { await player.waitFor(SAMPLE + '(' + AT_B.x + ',' + AT_B.y + ') > 200', 30000,
                             'the moved shroud to reach the Player'); } catch (_) {}
  const moved = await player.evaluate(
    '({ was: ' + SAMPLE + '(' + AT_A.x + ',' + AT_A.y + '),' +
    '   now: ' + SAMPLE + '(' + AT_B.x + ',' + AT_B.y + ') })');
  rig.note('after the move — where it was ' + moved.was + ', where it went ' + moved.now);
  rig.check(moved.now > 200,
            'moving the room did not carry its shroud to the new ground (alpha ' + moved.now + ')');
  rig.check(moved.was < 60,
            'the ground the room moved OFF is still hidden on the TV (alpha ' + moved.was +
            ') — the shroud was left behind and the table loses map the DM uncovered');

  // ── C. Rooms never reach the Player ───────────────────────────────────────
  // The anti-spoiler guarantee is architectural: rooms are simply not in the payload, so notes
  // are DM-only for free. Nothing had ever checked that it stayed true.
  await dm.evaluate('(() => { const p = polygons[0]; p.name = "Secret Vault";' +
                    ' p.description = "The lich sleeps here"; return 0; })()');
  await dm.evaluate('scheduleAutoSync(); 0');
  await rig.sleep(600);
  const leaked = await player.evaluate(`(() => {
    const n = (typeof polygons !== 'undefined' && polygons) ? polygons.length : 0;
    const body = document.body.innerText || '';
    return { rooms: n, inText: body.indexOf('Secret Vault') >= 0 || body.indexOf('lich') >= 0 };
  })()`);
  rig.check(leaked.rooms === 0,
            'the Player is holding ' + leaked.rooms + ' room(s) — room names and notes are DM-only ' +
            'and anything that reaches the Player can be read off the TV');
  rig.check(!leaked.inText, 'a room name or note is rendered somewhere in the Player window');

  // ── D. Switching scenes puts the new map on the TV, at its own size ───────
  // ⚠ SWITCH THROUGH switchScene(), NOT THE DROPDOWN. openDropdown() calls doAutoSave() before it
  // renders, which changes what the switch carries; the delivery is what is under test here.
  //
  // ⚠ THIS MUST BE THE FIRST SCENE CHANGE SINCE THE PLAYER OPENED, which is why both scenes are
  // imported before it opens. The Player asks for the map on open, and only onSceneLoaded clears
  // that request — so an import in between would clear the flag and E below would count 1 no
  // matter what the code did.
  await player.waitFor('fogCoverT === 0', 45000, 'the cover to lift before the switch under test');

  // ⚠ THE PLAYER HAS TO HAVE ASKED FOR THE MAP, or E below measures nothing. initPlayerMapRetry
  // sends need-map only when the map has not arrived within 4s, which is a slow delivery — a big
  // animated map, or a Player opened mid-switch. Here the map arrives at once, so the retry never
  // fires and the DM never enters the state E is about. This is the Player's OWN message, sent
  // exactly as its retry sends it; nothing here is a path the app does not take.
  await player.evaluate('window.opener.postMessage({ type: "need-map" }, "*"); 0');
  await rig.sleep(800);   // the DM answers straight away; let that answer land before counting

  // The DM answered that request rather than filing it. A request left outstanding after being
  // served is what the next switch flushes as a second delivery, so this reads the cause while E
  // below reads the effect.
  rig.check(await dm.evaluate('_playerResyncPending === false'),
            'the DM answered the Player\'s map request but left it marked outstanding, so the ' +
            'next scene switch flushes a second delivery on top of its own');
  await player.evaluate('globalThis.__rigFogUpdates = 0; 0');
  await dm.evaluate('switchScene("' + sceneTwo + '"); 0', 120000);
  await dm.waitFor('currentScene && currentScene.id === "' + sceneTwo + '"', 60000, 'the switch');
  try { await player.waitFor('mapWidth === ' + MAP2_W, 45000, 'the second map to reach the Player'); }
  catch (_) {}
  const afterSwitch = await player.evaluate('({ w: mapWidth, h: mapHeight })');
  rig.check(afterSwitch.w === MAP2_W && afterSwitch.h === MAP2_H,
            'switching scenes left the OLD map on the TV (' + afterSwitch.w + 'x' + afterSwitch.h +
            ') — the table is looking at the wrong map');

  // ── E. That switch delivers the map once ──────────────────────────────────
  // ⚠ WAIT OUT THE WHOLE COVER BEFORE COUNTING. switchScene holds its own push behind the fog
  // cover (FOG_SCENE_COVER_MS, 2250ms in fog.js), so a shorter wait counts the synchronous push
  // alone and reports 1 — this check PASSED for that reason before the wait was lengthened, which
  // is exactly the way a scenario proves nothing while looking green.
  await rig.sleep(3000);
  const sends = await player.evaluate('globalThis.__rigFogUpdates');
  rig.note('fog-update messages the Player received for ONE scene switch: ' + sends);
  // EXACTLY one, never "at most one": a count of 0 would mean nothing was delivered at all, and
  // a check that allowed it would go green on a Player left showing the previous map.
  rig.check(sends === 1,
            'one scene switch delivered the map ' + sends + ' times. Two means an extra push, and ' +
            'that one is SYNCHRONOUS at the end of the switch, so it lands before the Player\'s ' +
            'cover has closed — the TV can show the swap the cover exists to hide. Zero means the ' +
            'switch reached the Player through no push at all');

  // ── F. Sync View puts the DM's region on the TV ───────────────────────────
  // ⚠ COMPARE REGIONS, NEVER RAW PAN AND ZOOM. The Player refits what it is sent to its own
  // canvas, so the two windows hold different pan and zoom for the same view on purpose.
  // visibleMapRegion is the shared function both sides already use, and it clamps to the map —
  // a centre computed from the canvas alone disagrees with it near an edge.
  //
  // The Player lerps towards the region rather than jumping, so the centre is polled in.
  await dm.evaluate('panX = -400; panY = -250; viewportDirty = true; scheduleRender(); 0');
  const want = await dm.evaluate('dmVisibleRegion()');
  await dm.evaluate('document.getElementById("btn-sync-view").click(); 0');
  const region = `(() => { const s = getViewportSize();
    return visibleMapRegion(panX, panY, zoom, mapWidth, mapHeight, s.w, s.h); })()`;
  const near = 'Math.abs(' + region + '.cx - ' + want.mapCX + ') < 60';
  try { await player.waitFor(near, 20000, 'the Player view to settle on the DM region'); } catch (_) {}
  const got = await player.evaluate(region);
  rig.note('view centre — DM asked for ' + Math.round(want.mapCX) + ',' + Math.round(want.mapCY) +
           ', the Player settled on ' + Math.round(got.cx) + ',' + Math.round(got.cy));
  rig.check(Math.abs(got.cx - want.mapCX) < 60 && Math.abs(got.cy - want.mapCY) < 60,
            'Sync View did not move the TV to what the DM is looking at (asked ' +
            Math.round(want.mapCX) + ',' + Math.round(want.mapCY) + ', got ' +
            Math.round(got.cx) + ',' + Math.round(got.cy) + ')');
  rig.check(await player.evaluate('playerFollowDM === true'),
            'the Player did not go back to following the DM after Sync View');
};
