'use strict';
// effectMaterials.js — what an effect is made of: the colour ramp it burns through, its warmth,
// the grid colour inside it, and the look its shader passes draw. One record per material.

// A material is a warmth (0 = red ember, 1 = white-hot), the six-stop ramp its border burns
// through (coolest first, then three rising stops, then the two the hottest core mixes between
// under `warm`), the grid relight colour, and `look`: the uniforms effectShader.js reads.
//
// ⚠ EVERY NUMBER HERE IS A LOOK THE DM PICKED in `.claude/private/design/item-46/acid-lab.html`.
// Change one only on a fresh look call. A term a material does not use is 0, which skips it.
const EFFECT_MATERIALS = {
  fire: {
    warm: 0.30, grid: '#ffa040',
    ramp: [[0.06, 0.0, 0.0], [0.62, 0.05, 0.0], [1.0, 0.30, 0.03],
           [1.0, 0.64, 0.14], [1.0, 0.84, 0.42], [1.0, 0.97, 0.85]],
    look: { heightMul: 0.80, diss: 0.60, smoke: 0.35, haze: 0, spark: 0,
            sparkCol: [1.0, 0.66, 0.28], smokeCol: [0.035, 0.03, 0.03],
            steam: 0.95, steamCol: [0.055, 0.05, 0.045], liquid: 0, bub: 0, bubSize: 0,
            toon: 0.8, core: 0.45, spill: 0.35, flicker: 0.6, scorch: 0.6, drift: 1.0 },
  },
  acid: {
    warm: 0.45, grid: '#d8f040',
    ramp: [[0.04, 0.03, 0.0], [0.25, 0.30, 0.02], [0.60, 0.80, 0.05],
           [0.85, 1.0, 0.2], [0.95, 1.0, 0.5], [1.0, 1.0, 0.85]],
    look: { heightMul: 0.28, diss: 0.30, smoke: 0.20, haze: 0, spark: 0.45,
            sparkCol: [0.94, 1.0, 0.5], smokeCol: [0.05, 0.05, 0.0],
            steam: 0.95, steamCol: [0.75, 0.8, 0.45], liquid: 0.28, bub: 0.35, bubSize: 0.55,
            toon: 0, core: 0, spill: 0, flicker: 0, scorch: 0, drift: 0 },
  },
};

// The record for a stored name. An unknown one, from a newer release, burns as fire.
function effectMaterial(name) { return EFFECT_MATERIALS[name] || EFFECT_MATERIALS.fire; }

// The ramp as the shader wants it: six vec3s end to end.
function effectRamp(name) {
  const stops = effectMaterial(name).ramp;
  const out = new Float32Array(18);
  for (let i = 0; i < 6; i++) {
    out[i * 3] = stops[i][0]; out[i * 3 + 1] = stops[i][1]; out[i * 3 + 2] = stops[i][2];
  }
  return out;
}

// What every material shares. The grid relight is separate, in grid.js, because the map grid is
// a canvas above this layer.
const FX_LOOK = { speed: 1.00, fill: 0.20, gridGlow: 0.60 };

// The editing outline for a selected or previewed effect, separate from the burning render. A
// different colour family from POLY_EDGE_COLORS, so an effect never reads as a fourth fog state.
const EFFECT_EDGE_COLOR = '#ff8a3d';
