'use strict';

// fog-preview.js — HOVERING REVEAL ALL OR HIDE ALL SHOWS ITS RESULT, AND DOES NOTHING ELSE.
//
// Covers src/render/fogPreview.js, src/render/dmFogLayer.js (pixiDestroyFog), src/render/playersView.js,
// src/ui/dock.js (dockMapInset), src/ui/fogBar.js, src/ui/icons.js (the cloud glyphs)
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it, in the same order.
//
//   A. Hovering Reveal all hides the DM's fog layer inside a green frame; hovering Hide all covers the
//      map with a fog-coloured overlay inside a purple one. Neither changes the fog, the rooms or the
//      undo stack, and nothing reaches the Player.
//   B. Leaving the button, pressing it, losing the window's focus or pressing a key ends the preview
//      completely: layer shown, overlay gone, frame off.
//   C. Where the buttons act elsewhere (two maps, the world map) the preview does nothing.
//   D. The players' view frame (hold H) and the preview's frame both end at the dock's left edge, with
//      the pane open and shut, and the players' view's label stays centred on that area.
//   E. A click still reveals and hides the whole map on the TV.
//   F. A scene switch under the hovering pointer leaves no hidden layer and no overlay behind.
//
// ⚠ THE SECOND SCENE EXISTS BEFORE THE PLAYER OPENS, as in everything-reaches-the-player.js: an import
// made with the Player open clears the map request it made on opening.
// ⚠ A mouseenter dispatched on the button reaches the app's own listener; no real pointer is needed.

const lib = require('../../lib');

const MAP_W = 2400, MAP_H = 1500;
const MAP2_W = 1800, MAP2_H = 1100;
const CLEAR = { x: 600, y: 400, r: 300 };   // revealed before anything is hovered
const FAR = { x: 1900, y: 1100 };           // still fogged

// Every fog byte, room mode and the undo depth folded into one string: equal before and after means untouched.
const FINGERPRINT = `(() => { const d = fogDataCtx.getImageData(0, 0, fogDataCanvas.width, fogDataCanvas.height).data;
  let h = 0; for (let i = 3; i < d.length; i += 4) h = (h * 31 + d[i]) | 0;
  return h + '|' + polygons.map(p => p.mode).join() + '|' + undoStack.length; })()`;

const COUNTER = `globalThis.__rigFogMsgs = 0;
window.addEventListener('message', e => { if (e && e.data && /fog/i.test(String(e.data.type))) globalThis.__rigFogMsgs++; }); 0`;

module.exports = async function fogPreview(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  const sceneOne = await dm.evaluate('currentScene.id');
  await lib.openMap(rig, { w: MAP2_W, h: MAP2_H });
  const sceneTwo = await dm.evaluate('currentScene.id');
  await dm.evaluate('switchScene("' + sceneOne + '"); 0', 120000);
  await dm.waitFor('currentScene && currentScene.id === "' + sceneOne + '" && mapWidth === ' + MAP_W, 120000, 'scene one to come back');
  await lib.settle(dm, 'fogCoverT === 0 && !fogTransRafId', 30000);

  const player = await rig.player();
  await player.waitFor('!!mapOffscreen', 45000, 'the Player to receive the map');
  await player.waitFor('fogCoverT === 0', 45000, 'the Player cover to lift');
  await dm.evaluate('revealCircle(' + CLEAR.x + ',' + CLEAR.y + ',' + CLEAR.r + '); sendToPlayer(); 0');
  const sample = (x, y) => '((mx, my) => fogDataCtx.getImageData(Math.round(mx / FOG_SCALE), Math.round(my / FOG_SCALE), 1, 1).data[3])(' + x + ',' + y + ')';
  await player.waitFor(sample(CLEAR.x, CLEAR.y) + ' === 0', 30000, 'the reveal to reach the Player');
  await player.evaluate(COUNTER);

  const state = () => dm.evaluate(`({ visible: pixiFogLayer.visible, kids: pixiFogLayer.children.length,
    last: pixiFogLayer.children[pixiFogLayer.children.length - 1] instanceof PIXI.Graphics,
    frame: (f => f && f.classList.contains('on') ? f.dataset.kind : null)(document.getElementById('fp-frame')) })`);
  const onButton = (id, type) => dm.evaluate('document.getElementById("' + id + '").dispatchEvent(new Event("' + type + '")); 0');
  const hover = id => onButton(id, 'mouseenter');
  const rest = JSON.stringify(await state());
  const ended = s => s.visible && !s.last && s.frame === null;
  const dmPrint = await dm.evaluate(FINGERPRINT);
  const tvPrint = await player.evaluate(FINGERPRINT);
  const msgs = () => player.evaluate('__rigFogMsgs');
  const msgs0 = await msgs();

  // ── A ──
  // RED BY DESIGN: written against the feature - fails with fogPreview.js gone (no frame, layer stays visible)
  await hover('tb-reveal-all');
  const rv = await state();
  rig.check(!rv.visible && rv.frame === 'reveal' && JSON.stringify({ ...rv, visible: true, frame: null }) === rest,
            'A: hovering Reveal all did not hide the fog layer inside a green frame: ' + JSON.stringify(rv));
  await lib.hold(500, 'a send would have arrived by now; the preview must send none');
  rig.check(await dm.evaluate(FINGERPRINT) === dmPrint, 'A: the Reveal all preview changed the DM fog, the rooms or the undo stack');
  rig.check(await player.evaluate(FINGERPRINT) === tvPrint && await msgs() === msgs0,
            'A: the Reveal all preview reached the Player (fog changed or a fog message arrived)');
  await onButton('tb-reveal-all', 'mouseleave');
  rig.check(JSON.stringify(await state()) === rest, 'B: leaving Reveal all did not end the preview fully: ' + JSON.stringify(await state()));

  await hover('tb-hide-all');
  const hd = await state();
  rig.check(hd.visible && hd.frame === 'hide' && hd.kids === JSON.parse(rest).kids + 1 && hd.last,
            'A: hovering Hide all did not cover the map with an overlay inside a purple frame: ' + JSON.stringify(hd));
  await lib.hold(500, 'a send would have arrived by now; the preview must send none');
  rig.check(await dm.evaluate(FINGERPRINT) === dmPrint, 'A: the Hide all preview changed the DM fog, the rooms or the undo stack');
  rig.check(await player.evaluate(FINGERPRINT) === tvPrint && await msgs() === msgs0,
            'A: the Hide all preview reached the Player (fog changed or a fog message arrived)');
  await onButton('tb-hide-all', 'mouseleave');
  rig.check(JSON.stringify(await state()) === rest, 'B: leaving Hide all did not end the preview fully: ' + JSON.stringify(await state()));

  // ── B ──
  // RED BY DESIGN: written against the feature - fails with the matching listener missing from fogPreviewInit
  const enders = {
    'pressing the button': 'document.getElementById("tb-hide-all").dispatchEvent(new Event("mousedown"))',
    'window losing focus': 'window.dispatchEvent(new Event("blur"))',
    'a key press': 'document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyZ" }))',
  };
  for (const [how, js] of Object.entries(enders)) {
    await hover('tb-hide-all');
    await dm.evaluate(js + '; 0');
    rig.check(JSON.stringify(await state()) === rest, 'B: ' + how + ' did not end the preview fully: ' + JSON.stringify(await state()));
  }
  rig.check(await dm.evaluate(FINGERPRINT) === dmPrint, 'B: the events dispatched for these checks changed the fog');

  // ── C ──
  // RED BY DESIGN: written against the feature - fails with the panesActive / worldMapOpen guard dropped
  for (const flag of ['panesActive', 'worldMapOpen']) {
    await dm.evaluate(flag + ' = true; 0');
    await hover('tb-reveal-all');
    const s = JSON.stringify(await state());
    await hover('tb-hide-all');
    const t = JSON.stringify(await state());
    await dm.evaluate(flag + ' = false; 0');
    await onButton('tb-hide-all', 'mouseleave');
    rig.check(s === rest && t === rest, 'C: with ' + flag + ' the preview still acted: ' + s + ' / ' + t);
  }

  // ── D ──
  // RED BY DESIGN: written against the fix - on the old build #pv-frame is inset 0, so its right edge is the window's
  const edges = () => dm.evaluate(`(() => { const r = id => document.getElementById(id).getBoundingClientRect();
    const pv = r('pv-frame'), lab = document.querySelector('#pv-frame span').getBoundingClientRect();
    return { dockLeft: r('dock').left, pvLeft: pv.left, pvRight: pv.right, fpRight: r('fp-frame').right,
             labelMid: (lab.left + lab.right) / 2, win: window.innerWidth }; })()`);
  const lefts = {};
  for (const open of [true, false]) {
    await dm.evaluate(open ? 'dockOpen("scene"); 0' : 'dockOpen(null); 0');
    await lib.settle(dm, 'dockActivePane() === ' + (open ? '"scene"' : 'null'), 5000);
    await hover('tb-reveal-all');
    await dm.evaluate('__rigKey("KeyH"); 0');
    await lib.settle(dm, 'playersViewOn', 5000);
    const e = await edges();
    await dm.evaluate('document.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyH", bubbles: true })); 0');
    await onButton('tb-reveal-all', 'mouseleave');
    lefts[open] = e.dockLeft;
    const tag = 'D (' + (open ? 'pane open' : 'pane shut') + '): ';
    rig.check(e.dockLeft > 0 && e.dockLeft < e.win, tag + 'the dock is not on screen: ' + JSON.stringify(e));
    rig.check(Math.abs(e.fpRight - e.dockLeft) <= 1, tag + 'the preview frame does not end at the dock: ' + JSON.stringify(e));
    rig.check(Math.abs(e.pvRight - e.dockLeft) <= 1, tag + 'the players\' view frame does not end at the dock: ' + JSON.stringify(e));
    rig.check(Math.abs(e.labelMid - (e.pvLeft + e.pvRight) / 2) <= 1.5, tag + 'the players\' view label is not centred on the map area: ' + JSON.stringify(e));
  }
  rig.check(lefts[true] < lefts[false], 'D: the open pane did not move the dock edge left, so the check proved nothing: ' + JSON.stringify(lefts));
  await dm.evaluate('dockOpen("scene"); 0');

  // ── E ──
  // RED BY DESIGN: written against the feature - fails if the preview's click handling swallowed the action
  const lift = sample(FAR.x, FAR.y), darken = sample(CLEAR.x, CLEAR.y);
  rig.check(await player.evaluate(lift) > 200, 'E: the far ground was not fogged on the TV before Reveal all');
  await dm.evaluate('autoSync = true; setPlaceMode("rooms"); setShape("select"); 0');
  await hover('tb-reveal-all');
  await dm.evaluate('document.getElementById("tb-reveal-all").click(); document.getElementById("cd-ok").click(); 0');
  await player.waitFor(lift + ' < 60', 30000, 'Reveal all to reach the TV');
  // Reveal all's own fog crossfade adds a sprite under the layer for a while, so E leaves the child count out.
  rig.check(ended(await state()), 'E: the preview outlived the Reveal all click: ' + JSON.stringify(await state()));
  await hover('tb-hide-all');
  await dm.evaluate('document.getElementById("tb-hide-all").click(); 0');
  await player.waitFor(darken + ' > 200', 30000, 'Hide all to reach the TV');
  rig.check(ended(await state()), 'E: the preview outlived the Hide all click: ' + JSON.stringify(await state()));

  // ── F ──
  // RED BY DESIGN: written against the feature - fails with fogPreviewEnd() removed from pixiDestroyFog (dmFogLayer.js)
  await hover('tb-reveal-all');
  await dm.evaluate('switchScene("' + sceneTwo + '"); 0', 120000);
  await dm.waitFor('currentScene && currentScene.id === "' + sceneTwo + '" && mapWidth === ' + MAP2_W, 120000, 'scene two');
  await lib.settle(dm, '!fogTransRafId', 30000);
  const afterReveal = await state();
  rig.check(afterReveal.visible && afterReveal.frame === null,
            'F: a scene switch under Reveal all\'s preview left the fog layer hidden or the frame on: ' + JSON.stringify(afterReveal));
  await hover('tb-hide-all');
  await dm.evaluate('switchScene("' + sceneOne + '"); 0', 120000);
  await dm.waitFor('currentScene && currentScene.id === "' + sceneOne + '" && mapWidth === ' + MAP_W, 120000, 'scene one again');
  await lib.settle(dm, '!fogTransRafId', 30000);
  const afterHide = await state();
  rig.check(afterHide.visible && afterHide.frame === null && afterHide.kids === afterReveal.kids,
            'F: a scene switch under Hide all\'s preview left an overlay or the frame behind: ' +
            JSON.stringify(afterHide) + ' vs ' + JSON.stringify(afterReveal));
  rig.byEye('A: the frame\'s colours, glow and 180 ms fade, and the cloud glyphs on the buttons');
};
