'use strict';
// fogThemes.js - the fog themes' registry: each theme file in this folder registers one record, and
// the dock's dropdown, the Player's shaders and a scene's saved id all read the list here. Pure.
// Unit-tested.

// A record: id, label, swatch and hex (the picked colour), tint (colour strength, 0..1), anim (the
// motion: speed, drift, morph, warpStr, warpRad, pulse), passCol (a colour multiplier on each of the
// three cloud passes), rim (the living edge's colour), shaderFns (GLSL helpers the theme needs) and
// shader (the theme's own fragment code, run in its own branch).
const FOG_THEMES = [];

function registerFogTheme(rec) { FOG_THEMES.push(rec); }

// An unknown, missing or non-string id is Default, so a record from anywhere loads.
function fogThemeNormalize(id) {
  return typeof id === 'string' && FOG_THEMES.some(t => t.id === id) ? id : 'default';
}

function fogThemeRecord(id) {
  const k = fogThemeNormalize(id);
  return FOG_THEMES.find(t => t.id === k);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FOG_THEMES, registerFogTheme, fogThemeNormalize, fogThemeRecord };
}
