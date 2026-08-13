'use strict';

// fog-reaches-the-player.js — the app's core promise, across both windows. No test has ever been
// able to look at this: the old harness ran one plain window and could not see the Player at all.
//
// THE CRITERIA ARE THIS HEADER. Each line below has its check directly beneath it in the code,
// in the same order. There is no separate criteria document. A criterion that can only be judged
// by eye stays here too, marked as the user's to judge, and the report lists it as unchecked.
//
//   A. Opening the Player puts the DM's map on it, at the map's own size.
//   B. An area the DM reveals is clear of fog on the Player — in the fog data it was sent, and
//      in the fog it actually paints.
//   C. An area the DM has not touched is still fully fogged on the Player.
//   D. The Player carries no DM controls, and still has a cursor to drag its view with.
//   E. The Player looks right — the reveal reads as a clearing in cloud, not a hole cut in felt.
//
// ⚠ THE PLAYER'S FOG IS CANVAS-2D DRAWN ON TOP OF THE PIXIJS MAP (docs/DECISIONS.md), so its
// painted fog can be read straight off #fog-canvas. Canvas pixels are CSS pixels here — syncSize
// sets width/height from clientWidth/clientHeight with no devicePixelRatio — so a map point
// converts to a fog-canvas pixel with the camera transform alone.
//
// ⚠ WAIT OUT THE SCENE COVER BEFORE READING PAINTED FOG. A fresh map arrives under a full-fog
// cover (fogCoverT), which "punches nothing" — every sample reads opaque no matter what was
// revealed, and the reveal is real but invisible. Poll fogCoverT down to 0 first.

const path = require('path');

// Where the DM reveals, and where it deliberately does not. Both well inside the map and far
// apart, so the feathered edge of the reveal cannot reach the untouched sample.
const MAP_W = 2000, MAP_H = 1200;
const REVEAL = { x: 500, y: 300, r: 250 };
const UNTOUCHED = { x: 1500, y: 900 };

module.exports = async function fogReachesThePlayer(rig) {
  const dm = rig.dm;

  const still = await rig.fixtures.stillMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H, name: 'rig-still.png' });
  const fileExpr = await rig.fixtures.asFileExpr(dm, still);
  await dm.evaluate('createNewScene(' + fileExpr + ')', 120000);
  await dm.waitFor('currentScene && currentScene.mapType === "image" && mapWidth === ' + MAP_W,
                   120000, 'the generated map to load on the DM');

  // ── A. Opening the Player puts the DM's map on it, at the map's own size ───
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen', 45000, 'the Player to receive the map');
  const onPlayer = await player.evaluate('({ w: mapWidth, h: mapHeight, hasFog: !!fogDataCanvas })');
  rig.check(onPlayer.w === MAP_W && onPlayer.h === MAP_H,
            'the Player has the map at the wrong size: ' + onPlayer.w + 'x' + onPlayer.h);
  rig.check(onPlayer.hasFog, 'the Player received a map with no fog at all — the table would see everything');

  // ── B. An area the DM reveals is clear of fog on the Player ───────────────
  // revealCircle is the app's own fog operation, the one the brush drives; sendToPlayer is the
  // app's own delivery. Nothing here is a rig-only path.
  await player.waitFor('fogCoverT === 0', 45000, 'the scene cover to lift on the Player');
  await dm.evaluate('revealCircle(' + REVEAL.x + ',' + REVEAL.y + ',' + REVEAL.r + '); sendToPlayer(); 0');

  // The fog it was SENT: fogDataCanvas is the Player's source of truth, at 1/FOG_SCALE.
  const sampleData = `((mx, my) => {
    const d = fogDataCtx.getImageData(Math.round(mx / FOG_SCALE), Math.round(my / FOG_SCALE), 1, 1).data;
    return d[3];
  })`;
  await player.waitFor(sampleData + '(' + REVEAL.x + ',' + REVEAL.y + ') === 0', 30000,
                       "the reveal to reach the Player's fog data");
  const revealedData = await player.evaluate(sampleData + '(' + REVEAL.x + ',' + REVEAL.y + ')');
  rig.check(revealedData === 0,
            'the Player still holds fog data over the revealed area (alpha ' + revealedData + ')');

  // The fog it PAINTS. ⚠ Read after a frame has actually gone out, or this samples the canvas
  // from before the update and reports the old state as the new one.
  const samplePainted = `((mx, my) => {
    const sx = Math.round(mx * zoom + panX), sy = Math.round(my * zoom + panY);
    const c = document.getElementById('fog-canvas');
    if (sx < 0 || sy < 0 || sx >= c.width || sy >= c.height) return -1;
    return c.getContext('2d').getImageData(sx, sy, 1, 1).data[3];
  })`;
  await player.evaluate('viewportDirty = true; scheduleRender(); 0');
  try { await player.waitFor(samplePainted + '(' + REVEAL.x + ',' + REVEAL.y + ') === 0', 20000, 'a repaint'); }
  catch (_) {}   // let the assertion below report the real number rather than a timeout
  const painted = await player.evaluate(`({
    revealed: ${samplePainted}(${REVEAL.x}, ${REVEAL.y}),
    untouched: ${samplePainted}(${UNTOUCHED.x}, ${UNTOUCHED.y}),
    opacity: getComputedStyle(document.getElementById('fog-canvas')).opacity,
  })`);
  rig.note('painted fog alpha — revealed ' + painted.revealed + ', untouched ' + painted.untouched +
           ', layer opacity ' + painted.opacity);
  rig.check(painted.revealed === 0,
            'the Player is still painting fog over the revealed area (alpha ' + painted.revealed + ')');

  // ── C. An area the DM has not touched is still fully fogged ───────────────
  const untouchedData = await player.evaluate(sampleData + '(' + UNTOUCHED.x + ',' + UNTOUCHED.y + ')');
  rig.check(untouchedData === 255,
            'untouched map is not fully fogged in the Player fog data (alpha ' + untouchedData + ')');
  rig.check(painted.untouched > 200,
            'the Player is barely painting fog over untouched map (alpha ' + painted.untouched + ')');
  // The fog layer is drawn at full strength on the Player; the 0.55 knock-down is the DM's view
  // alone, so a Player showing DM-strength fog means the table can read through it.
  rig.check(painted.opacity === '1', 'the Player fog layer is not at full opacity: ' + painted.opacity);

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

  // ── E. The Player looks right ─────────────────────────────────────────────
  const shot = path.join(rig.outDir, 'player-fog.png');
  await player.screenshot(shot);
  rig.note('Player screenshot: ' + shot);
  rig.byEye('whether the revealed area in ' + shot + ' reads as a clearing in cloud rather than a ' +
            'hole cut in felt — fog quality is a look-and-feel call, not a pixel one');
};
