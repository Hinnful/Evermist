'use strict';
// effectMaterials.js — what an effect is made of: the colour ramp its fire burns through, its
// warmth, and the swatch the picker shows. One record per material.

// A material is a warmth (0 = red ember, 1 = white-hot), the swatch colours the picker shows, and
// the six-stop ramp its fire burns through: coolest first, then three rising stops, then the two
// the hottest core mixes between under `warm`.
//
// ⚠ A NEW MATERIAL IS A RECORD HERE AND NOTHING ELSE. The shader reads every colour from `ramp`,
// so the entry alone decides what its fire looks like. `glow` and `core` reach the swatch only.
const EFFECT_MATERIALS = {
  fire: {
    warm: 0.30, glow: 0xff5a1e, core: 0xffe0a0,
    ramp: [[0.05, 0.01, 0.0], [0.55, 0.06, 0.01], [1.0, 0.36, 0.05],
           [1.0, 0.72, 0.22], [1.0, 0.85, 0.5], [1.0, 0.97, 0.85]],
  },
};

// The ramp as the shader wants it: six vec3s end to end. An unknown material burns as fire.
function effectRamp(name) {
  const m = EFFECT_MATERIALS[name] || EFFECT_MATERIALS.fire;
  const out = new Float32Array(18);
  const stops = m.ramp || EFFECT_MATERIALS.fire.ramp;
  for (let i = 0; i < 6; i++) {
    out[i * 3] = stops[i][0]; out[i * 3 + 1] = stops[i][1]; out[i * 3 + 2] = stops[i][2];
  }
  return out;
}

// The settled look — the "Cinder seam" border plus the interior and atmosphere. ⚠ The app's one
// look, with no UI that edits it. Change a value only on a fresh look call from the DM.
// The grid relight is separate, in grid.js, because the map grid is a canvas above this layer.
const FX_LOOK = { heightMul: 0.50, speed: 1.00, diss: 0.55, fill: 0.20,
                  spark: 1.00, smoke: 0.40, haze: 0.70, gridGlow: 0.60 };

// The editing outline for a selected or previewed effect, separate from the burning render. A
// different colour family from POLY_EDGE_COLORS, so an effect never reads as a fourth fog state.
const EFFECT_EDGE_COLOR = '#ff8a3d';
