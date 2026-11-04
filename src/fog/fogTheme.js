'use strict';
// fogTheme.js - the fog theme on a live window: the DM's pick, a map's restore, and what the Player does
// with the theme the DM sends. The records are fog/themes/; the shader that draws one is
// render/playerFogPass.js.

// ─── Fog theme ────────────────────────────────────────────────────────────────
// A theme is the whole look: colour, tint, motion and the Player's shader. The live numbers below
// are written FROM the theme and never edited by hand; a scene stores only the theme's id
// (`fogTheme`) and passes its old `fogSettings` through untouched (captureFogSettings).

// The theme's motion into the live numbers. ⚠ Every theme carries Default's warp, so the cloud
// frames are rebuilt only for a number this window did not start with.
function applyFogThemeMotion(rec) {
  const an = rec.anim;
  fogAnimEnabled = true;
  fogAnimSpeed   = an.speed;
  driftScale     = an.drift;
  cloudFrameSpeed = an.morph;
  alphaPulseAmp  = an.pulse;
  if (cloudWarpStrength !== an.warpStr || cloudWarpRadius !== an.warpRad) {
    cloudWarpStrength = an.warpStr;
    cloudWarpRadius   = an.warpRad;
    generateCloudFrames(512, CLOUD_FRAME_COUNT);
    cloudFramePos = 0;
    if (fogEffectCanvas) recompositeCloudEffect(fogAnimOffsets);
  }
  startFogAnim();
}

// The DM's own window: the theme's colour and tint, see-through as always (dmFogLayer.js). The
// shader's effects draw on the TV only.
function applyFogThemeLook(id) {
  const rec = fogThemeRecord(id);
  fogTheme = rec.id;
  applyFogThemeMotion(rec);
  applyFogColor(rec.hex);
  applyFogTintAlpha(rec.tint);
}

// The Player takes a theme from the DM. The colour eases (fogAnim.js) and the theme's own effects
// switch on when it lands, so a pick or a map switch changes the fog while it is closing. `now`
// is a map payload's own theme, which has nothing to ease from.
function applyPlayerFogTheme(id, now) {
  const rec = fogThemeRecord(id);
  applyFogThemeMotion(rec);
  FOG_TINT_ALPHA = rec.tint;
  // ⚠ A switch's colour ease OWNS the colour until it lands. Retarget rather than ignore, so a
  // theme picked DURING a switch still arrives.
  if (fogColorToHex) { fogColorToHex = rec.hex; fogThemePending = rec.id; return; }
  if (now) { fogTheme = rec.id; fogThemePending = null; applyFogColor(rec.hex); return; }
  fogThemePending = rec.id;
  startFogColorEase(rec.hex);
  if (!fogColorRafId) { fogTheme = rec.id; fogThemePending = null; fogDirty = true; scheduleRender(); }
}

// A theme picked on the DM's screen. ⚠ Two maps: the selected column owns its map, so the pick
// goes to it and the column runs this again.
function setFogTheme(id, fromUndo) {
  const next = fogThemeNormalize(id);
  if (paneForward('fog-theme', { id: next })) return;
  if (next === fogTheme && !fromUndo) return;
  applyFogThemeLook(next);
  syncFogThemeToPlayer();
  if (!fromUndo) noteSettingsChange();
  if (currentScene) scheduleAutoSave();
  if (typeof refreshFogThemeUI === 'function') refreshFogThemeUI();
}

// Restores the open map's theme from its record. ⚠ Never call syncFogThemeToPlayer here: the
// theme rides the sendToPlayer fog-update, and sending it early paints it over the old scene's fog.
function restoreSceneFogSettings(scene) {
  fogSettingsKept = scene.fogSettings || null;
  applyFogThemeLook(fogThemeNormalize(scene.fogTheme));
  if (typeof refreshFogThemeUI === 'function') refreshFogThemeUI();
}
