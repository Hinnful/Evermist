'use strict';

// world-mist-drift.js — THE WORLD MAP'S MIST DRIFTS.
//
// THE GOAL: a first-time DM opens the world map and sees the mist move, whatever their OS says about animation.
//
//   1. On a fresh profile (an empty world map) the painted mist changes from one moment to the next.
//   2. With the OS asking for reduced motion, the painted mist still changes.
//   3. Closing the world map and opening it again leaves the mist drifting.
//
// ⚠ The measure is PIXELS. SVGAnimatedTransformList.animVal reads 0 on a running SMIL animation in this Chromium.

const lib = require('../../lib');

// A patch of the window the dock and the bar never cover, away from the callout.
const CLIP = { x: 20, y: 20, width: 240, height: 240, scale: 1 };

const shot = async dm => (await dm.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: CLIP }, 60000)).data;

// True once the patch repaints. The map's finite animations repaint it too, so they are waited out first.
async function drifts(dm) {
  await lib.settle(dm, 'document.getAnimations().every(a => a.effect.getComputedTiming().iterations === Infinity)', 8000);
  let prev = await shot(dm);
  for (let n = 0; n < 6; n++) {
    await lib.hold(1000, 'the mist drifts about 14px a second; a second is long enough to have repainted');
    const now = await shot(dm);
    if (now !== prev) return true;
    prev = now;
  }
  return false;
}

module.exports = async function worldMistDrift(rig) {
  const dm = rig.dm;
  await lib.settle(dm, 'worldMapOpen && !_wmAnim', 30000);
  rig.check(await dm.evaluate('document.body.classList.contains("wm-empty") && document.querySelectorAll("#wm-mist .wmist-all").length > 0'),
            'the fresh profile is not on an empty world map with a mist');

  // ── 1. A fresh profile's empty world map ───────────────────────────────────
  // RED ON: worldMistWake() removed from worldMapShow (worldMap.js) - 2026-10-18
  rig.check(await drifts(dm), 'the mist did not drift on a fresh profile\'s empty world map');

  // ── 2. Reduced motion asked for ────────────────────────────────────────────
  await dm.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  rig.check(await dm.evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches'), 'the rig could not emulate reduced motion, so criterion 2 proves nothing');
  await dm.evaluate('location.reload(); 0');
  await lib.poll(async () => { try { return (await dm.evaluate('worldMapOpen && !_wmAnim')) ? { up: true } : null; } catch (e) { return null; } }, 30000, 500);
  // RED ON: the matchMedia('(prefers-reduced-motion: reduce)') check back in worldMistInit (worldMist.js) - 2026-10-18
  rig.check(await drifts(dm), 'the mist stood still with reduced motion asked for');
  await dm.send('Emulation.setEmulatedMedia', { features: [] });

  // ── 3. Closed and opened again ─────────────────────────────────────────────
  await dm.evaluate('worldMapHide(); 0');
  await lib.settle(dm, '!worldMapOpen && _wm.hidden', 8000);
  await dm.evaluate('worldMapShow(); 0');
  await lib.settle(dm, 'worldMapOpen && !_wmAnim', 8000);
  // RED ON: worldMistWake() removed from worldMapShow (worldMap.js) - 2026-10-18
  rig.check(await drifts(dm), 'the mist stood still after the world map was closed and opened again');
};
