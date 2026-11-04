'use strict';

// fog-themes.js - FOG THEMES, whole (backlog item 254).
// It drives src/fog/fogTheme.js, the theme records in src/fog/themes/fogThemes.js, src/fog/themes/default.js
// and src/fog/themes/ice.js, the Player's one shader per theme in render/playerFogPass.js and the dock's
// Fog row in controlPanel.js.
//
// THE GOAL OF THIS FEATURE: the DM picks the look of a map's fog from one dropdown, the TV shows it, and
// the fog still hides every hidden room completely. Every check below serves that sentence.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its letter.
//
//   A. Map settings' Fog row is one dropdown listing Default and Ice, each with a swatch. The colour
//      field, the movement dropdown, the Custom dials and the eye are gone, and the A key does nothing.
//   B. A theme picked on the DM reaches the TV with its colour and its motion together.
//   C. On a map switch the next map's theme reaches the TV while the fog closes, never during the reveal.
//   D. No theme lets a hidden room's map show through on the TV.
//   E. A map saved on Default has no theme field on its record, and one saved on Ice keeps it.
//      (The restart itself is boot.js's; the reading of a bad id is a unit test.)
//   F. Undo takes back a theme pick.
//   G. The DM's screen shows the theme's colour, see-through; holding H shows it at full strength.
//   H. Reset puts back Default, No weather and the feather's 12.
//   I. Two maps: each half of the TV shows its own theme (two-maps.js, section I).
//   K. Two hidden rooms sharing a wall leave no line in the fog on the TV.
//   J. The look on the TV, each theme, is the DM's eye.
//
// ⚠ THE TV'S FOG IS READ BY EXTRACTING ITS MESH ALONE, never the stage: the stage is opaque everywhere
// because the map sits under it, and alpha is the whole point of D.

const path = require('path');
const lib = require('../../lib');

const MAP_W = 2000, MAP_H = 1200;
const ROOM = { x1: 600, y1: 400, x2: 1200, y2: 800 };
const CLEAR = { x: 1700, y: 1000 };
const INSET = 90;

const SNAP = `
globalThis.__rigFogSnap = () => {
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

module.exports = async function fogThemesFeature(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  const oneId = await dm.evaluate('currentScene.id');
  const click = id => dm.evaluate('document.getElementById(' + JSON.stringify(id) + ').click(); 0');
  await dm.evaluate('dockOpen("scene"); 0');

  // ── A. one dropdown ────────────────────────────────────────────────────────
  // RED ON: the fog dropdown's old colour field and eye put back in index.html - 2026-11-04
  const row = await dm.evaluate(`(() => {
    const blk = document.getElementById('cp-fogtheme-row').closest('.dk-blk');
    const items = [...document.querySelectorAll('#cp-pop-fogtheme [data-fogtheme]')];
    return {
      sub: blk.querySelector('.dk-sub').textContent.trim(),
      ids: items.map(b => b.dataset.fogtheme),
      swatches: items.map(b => !!b.querySelector('.dk-sw') && getComputedStyle(b.querySelector('.dk-sw')).width !== '0px'),
      label: document.getElementById('cp-fogtheme-lbl').textContent,
      kids: blk.children.length,
      gone: ['cp-fog-field', 'cp-move-row', 'cp-move-eye', 'cp-pop-fog', 'cp-pop-move', 'anim-advanced-panel', 'fog-color', 'btn-anim']
        .filter(id => document.getElementById(id)),
    };
  })()`);
  rig.check(row.sub === 'Fog' && row.kids === 2 && row.ids.join() === 'default,ice' && row.swatches.every(Boolean),
            'A: the Fog row is not one dropdown of Default and Ice with a swatch each: ' + JSON.stringify(row));
  rig.check(row.gone.length === 0, 'A: the old fog colour, movement or eye is still in the page: ' + row.gone.join());
  rig.check(row.label === 'Default', 'A: a new map does not open on Default: ' + row.label);
  const keyBefore = await dm.evaluate('({ speed: fogAnimSpeed, on: fogAnimEnabled })');
  await dm.evaluate('__rigKey("KeyA"); 0');
  rig.check(JSON.stringify(await dm.evaluate('({ speed: fogAnimSpeed, on: fogAnimEnabled })')) === JSON.stringify(keyBefore),
            'A: the A key still does something to the fog movement');

  // The rooms the checks below read: one hidden room, the rest of the map clear (a new map starts fully fogged).
  // The app's own Reveal all, past the question it asks in Auto: an unanswered dialog would take the Reset's answer below.
  await dm.evaluate('revealAllRooms(); 0');
  await dm.evaluate('__rigDrawShroud(' + [ROOM.x1, ROOM.y1, ROOM.x2, ROOM.y2].join(',') + '); 0');
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen && mapWidth === ' + MAP_W, 45000, 'the map to reach the Player');
  await player.waitFor('fogCoverT === 0', 45000, 'the scene cover to lift on the Player');
  await player.evaluate(SNAP);
  const repaint = async () => {
    await player.evaluate('viewportDirty = true; fogDirty = true; scheduleRender(); 0');
    await lib.settle(player, '!viewportDirty && !fogDirty && !fogTransRafId && !fogColorRafId', 10000);
    await player.evaluate('__rigFogSnap()');
  };
  const painted = (x, y) => player.evaluate('__rigFogAt(' + x + ',' + y + ')');
  const mid = { x: (ROOM.x1 + ROOM.x2) / 2, y: (ROOM.y1 + ROOM.y2) / 2 };
  await lib.settle(player, 'fogDataCanvas.getContext("2d").getImageData(Math.round(' + mid.x + ' / FOG_SCALE), Math.round(' + mid.y + ' / FOG_SCALE), 1, 1).data[3] > 250', 20000);

  // ── B. the pick reaches the TV, colour and motion together ─────────────────
  // RED ON: syncFogThemeToPlayer's postMessage removed (playerWindow.js) - 2026-11-04
  const def = await player.evaluate('({ hex: fogPickedHex, speed: fogAnimSpeed, tint: FOG_TINT_ALPHA })');
  await dm.evaluate('document.getElementById("cp-fogtheme-dd").click(); 0');
  await dm.evaluate('document.querySelector("#cp-pop-fogtheme [data-fogtheme=ice]").click(); 0');
  const ice = await lib.settle(player, 'fogTheme === "ice" && !fogColorRafId', 20000);
  const after = await player.evaluate('({ theme: fogTheme, hex: fogPickedHex, speed: fogAnimSpeed, tint: FOG_TINT_ALPHA })');
  rig.check(ice && after.hex === '#22344a' && after.speed < def.speed && after.tint === 0.20,
            'B: picking Ice did not reach the TV with its colour and motion together: ' + JSON.stringify({ def, after }));
  rig.check(await dm.evaluate('fogTheme === "ice" && document.getElementById("cp-fogtheme-lbl").textContent === "Ice"'),
            'B: the dropdown does not say Ice after Ice was picked');

  // ── D. no theme lets a hidden room's map through ───────────────────────────
  // RED ON: the fog pass's output alpha lowered to a * 0.5 in PLAYER_FOG_TAIL (playerFogPass.js) - 2026-11-04
  const shots = [];
  for (const id of ['default', 'ice']) {
    await dm.evaluate('setFogTheme("' + id + '"); 0');
    await lib.settle(player, 'fogTheme === "' + id + '" && !fogColorRafId', 20000);
    await repaint();
    // The hidden room's interior and a point INSET in from each wall: the fog's own blur ramps over the first stretch.
    const spots = [mid, { x: ROOM.x1 + INSET, y: mid.y }, { x: ROOM.x2 - INSET, y: mid.y }, { x: mid.x, y: ROOM.y1 + INSET }, { x: mid.x, y: ROOM.y2 - INSET }];
    for (const s of spots) {
      const px = await painted(s.x, s.y);
      rig.check(px.a >= 250, 'D: ' + id + ': the hidden room shows its map through the fog at ' + JSON.stringify(s) + ': ' + JSON.stringify(px));
    }
    const clear = await painted(CLEAR.x, CLEAR.y);
    rig.check(clear.a <= 6, 'D: ' + id + ': fog is drawn over clear ground: ' + JSON.stringify(clear));
    const inside = await painted(mid.x, mid.y);
    rig.check(inside.r + inside.g + inside.b > 60, 'D: ' + id + ': the fog is flat black: ' + JSON.stringify(inside));
    const shot = path.join(rig.outDir, 'player-fog-' + id + '.png');
    await player.screenshot(shot);
    shots.push(shot);
  }
  rig.note('Player screenshots: ' + shots.join(', '));
  rig.byEye('J: whether each theme on the TV, in ' + shots.join(' and ') + ', matches the prototype (.claude/private/design/item-254) and reads as fog');

  // ── K. two hidden rooms that share a wall leave no line (DoD 6, looked at once: there was none to remove) ──
  // RED BY DESIGN: written against the look, never re-proved
  await dm.evaluate('__rigDrawShroud(' + [ROOM.x2, ROOM.y1, ROOM.x2 + 600, ROOM.y2].join(',') + '); 0');
  await lib.settle(player, 'fogBlurCanvas && fogBlurCanvas.getContext("2d").getImageData(Math.round(' + (ROOM.x2 + 300) + ' / FOG_SCALE), Math.round(' + mid.y + ' / FOG_SCALE), 1, 1).data[3] > 250', 20000);
  const seam = await player.evaluate(`(() => {
    const c = fogBlurCanvas.getContext('2d'); let min = 255;
    for (let y = ${ROOM.y1 + 60}; y <= ${ROOM.y2 - 60}; y += 20)
      for (let x = ${ROOM.x2 - 8}; x <= ${ROOM.x2 + 8}; x += 4)
        min = Math.min(min, c.getImageData(Math.round(x / FOG_SCALE), Math.round(y / FOG_SCALE), 1, 1).data[3]);
    return min;
  })()`);
  rig.check(seam >= 250, 'K: two hidden rooms that share a wall leave a line in the fog on the TV: weakest alpha along the wall ' + seam);

  // ── F. undo takes the pick back ────────────────────────────────────────────
  // RED ON: setFogTheme(s.fogTheme, true) removed from _undoApplySettings (undo.js) - 2026-11-04
  await dm.evaluate('document.activeElement && document.activeElement.blur(); 0');
  await dm.evaluate('setFogTheme("default"); 0');
  await lib.hold(1000, 'longer than the undo history pause, so the pick below is a step of its own');
  await dm.evaluate('setFogTheme("ice"); 0');
  await dm.evaluate('__rigKey("KeyZ", { ctrlKey: true }); 0');
  await lib.settle(dm, 'fogTheme === "default"', 8000);
  rig.check(await dm.evaluate('fogTheme === "default" && document.getElementById("cp-fogtheme-lbl").textContent === "Default"'),
            'F: Ctrl+Z did not take back the theme pick: ' + await dm.evaluate('fogTheme'));
  await lib.settle(player, 'fogTheme === "default"', 15000);

  // ── G. the DM's screen: the theme's colour, see-through; H shows full strength ─
  // RED ON: applyFogColor not called from applyFogThemeLook (fogTheme.js) - 2026-11-04
  await dm.evaluate('setFogTheme("ice"); 0');
  const dmLook = await dm.evaluate(`({ base: fogBaseColor, want: deriveFogColors('#22344a').base, tint: fogTintColor, wantTint: deriveFogColors('#22344a').tint,
    alpha: pixiFogLayer.alpha, dm: FOG_OPACITY_DM })`);
  rig.check(dmLook.base === dmLook.want && dmLook.tint === dmLook.wantTint && dmLook.alpha === dmLook.dm && dmLook.alpha < 1,
            'G: the DM screen does not show Ice\'s colour see-through: ' + JSON.stringify(dmLook));
  await dm.evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyH", bubbles: true })); 0');
  rig.check(await dm.evaluate('pixiFogLayer.alpha === 1'), 'G: holding H did not show the fog at full strength');
  await dm.evaluate('document.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyH", bubbles: true })); 0');
  rig.check(await dm.evaluate('pixiFogLayer.alpha === FOG_OPACITY_DM'), 'G: releasing H did not put the working view back');

  // ── C. a map switch changes the theme while the fog closes ─────────────────
  // RED ON: the 'tint' scene-transition's applyPlayerFogTheme call removed (playerMessages.js) - 2026-11-04
  await lib.openMap(rig, { w: 1400, h: 900 });
  const twoId = await dm.evaluate('currentScene.id');
  await player.waitFor('mapWidth === 1400 && fogCoverT === 0', 60000, 'the second map to reach the Player');
  // Map two is on Default and the Player is on Ice or Default; switch to the other so the theme must change.
  await dm.evaluate('switchScene("' + oneId + '"); 0');
  await dm.waitFor('currentScene && currentScene.id === "' + oneId + '" && mapWidth === ' + MAP_W, 60000, 'the first map to open');
  await lib.settle(player, 'mapWidth === ' + MAP_W + ' && fogCoverT === 0', 60000);
  await dm.evaluate('setFogTheme("ice"); 0');
  await lib.settle(player, 'fogTheme === "ice"', 20000);
  await player.evaluate(`globalThis.__rigTrace = []; (function s() {
    __rigTrace.push([Math.round(performance.now()), +fogCoverT.toFixed(3), fogTheme]);
    if (__rigTrace.length < 4000) requestAnimationFrame(s);
  })(); 0`);
  await dm.evaluate('switchScene("' + twoId + '"); 0');
  await lib.settle(player, 'mapWidth === 1400', 60000);
  await lib.settle(player, 'fogCoverT === 0', 60000);
  const trace = await player.evaluate('__rigTrace');
  const landed = trace.findIndex(r => r[2] === 'default');
  const peak = trace.findIndex(r => r[1] >= 0.999);
  const reveal = peak < 0 ? -1 : trace.findIndex((r, i) => i > peak && r[1] < 0.999);
  rig.note('theme change at sample ' + landed + ', cover closed at ' + peak + ', reveal began at ' + reveal + ' of ' + trace.length);
  rig.check(landed >= 0 && peak >= 0 && reveal > peak && landed <= reveal,
            'C: the next map\'s theme did not arrive before the reveal began: ' + JSON.stringify({ landed, peak, reveal }));
  rig.check(landed > 0 && trace[landed][1] > 0.05,
            'C: the theme changed before the fog had started to close: cover ' + (landed >= 0 ? trace[landed][1] : 'never'));

  // ── E. the record ──────────────────────────────────────────────────────────
  // RED ON: the fogTheme write removed from doAutoSave (scenes.js) - 2026-11-04
  await dm.evaluate('switchScene("' + oneId + '"); 0');
  await dm.waitFor('currentScene && currentScene.id === "' + oneId + '"', 60000, 'the first map to open');
  const rec = await lib.poll(async () => {
    await dm.evaluate('doAutoSave(); 0');
    const r = await dm.evaluate('sceneStore.loadScene("' + oneId + '").then(r => ({ theme: r.fogTheme, kept: r.fogSettings }))');
    return r.theme === 'ice' ? r : null;
  }, 20000, 500);
  rig.check(!!rec, 'E: a map picked onto Ice never saved its theme');
  const recTwo = await dm.evaluate('sceneStore.loadScene("' + twoId + '").then(r => ({ has: "fogTheme" in r, kept: r.fogSettings }))');
  rig.check(recTwo.has === false, 'E: a map on Default carries a theme field: ' + JSON.stringify(recTwo));
  // A map saved before themes carries its colour untouched, whatever theme it opens on.
  await dm.evaluate(`(async () => { const r = await sceneStore.loadScene("${twoId}"); r.fogSettings = { pickedHex: '#c02020', tintAlpha: 0.6, anim: { enabled: true, speed: 1, drift: 1, morph: 0.35, warpStr: 0.15, warpRad: 0.08, pulse: 0.3 } }; await sceneStore.saveScene(r); return 0; })()`, 15000);
  await dm.evaluate('switchScene("' + twoId + '"); 0');
  await dm.waitFor('currentScene && currentScene.id === "' + twoId + '" && mapWidth === 1400', 60000, 'the second map to open');
  rig.check(await dm.evaluate('fogTheme === "default"'), 'E: an existing map with a custom colour did not open on Default');
  await dm.evaluate('doAutoSave(); 0');
  const kept = await lib.poll(async () => {
    const r = await dm.evaluate('sceneStore.loadScene("' + twoId + '").then(r => r.fogSettings)');
    return r ? { r } : null;
  }, 10000, 500);
  rig.check(kept && kept.r.pickedHex === '#c02020' && kept.r.tintAlpha === 0.6,
            'E: saving the map rewrote its old fog colour, which /rollback needs: ' + JSON.stringify(kept));

  // ── H. Reset ───────────────────────────────────────────────────────────────
  // RED ON: setFogTheme('default') removed from the cp-fog-reset handler (controlPanel.js) - 2026-11-04
  await dm.evaluate('setFogTheme("ice"); chooseWeather("rain"); 0');
  await lib.fire(dm, 'fog-feather', 4);
  await click('cp-fog-reset');
  await dm.waitFor('document.getElementById("cd-ok")', 5000, 'the reset confirmation');
  await click('cd-ok');
  await lib.settle(dm, 'fogTheme === "default" && fogFeatherRadius === 12 && weatherId === "none"', 10000);
  const reset = await dm.evaluate('({ theme: fogTheme, feather: fogFeatherRadius, weather: weatherId })');
  rig.check(reset.theme === 'default' && reset.feather === 12 && reset.weather === 'none',
            'H: Reset did not put back Default, No weather and the feather: ' + JSON.stringify(reset));
};
