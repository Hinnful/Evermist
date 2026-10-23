'use strict';
// tvFit.js — pure kernel: Turn. A scene's own turn of the TV picture, kept as { step, turn }, the
// form 4.7.0 reads: upright is {0, 0}; the two turned tiles are {1, 270} and {1, 90}. An older save
// may hold step 2; it is the tile with its turn.

const TV_FIT_TURNS = [0, 90, 180, 270];
const TV_FIT_OFF = { step: 0, turn: 0 };
const TV_FIT_TILES = [{ step: 0, turn: 0 }, { step: 1, turn: 270 }, { step: 1, turn: 90 }];

// A fit read from a saved scene or an import: anything unreadable is upright.
function cleanFit(f) {
  if (!f || !Number.isInteger(f.step) || f.step < 1 || f.step > 2 || !TV_FIT_TURNS.includes(f.turn) || !f.turn) {
    return { ...TV_FIT_OFF };
  }
  return { step: f.step, turn: f.turn };
}

// The tile a fit shows as: 0 upright, 1 and 2 the turned ones, -1 for a turn no tile offers.
function fitTile(fit) {
  const f = cleanFit(fit);
  return TV_FIT_TILES.findIndex(t => t.turn === f.turn);
}

function fitForTile(tile) {
  return { ...(TV_FIT_TILES[tile] || TV_FIT_OFF) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { cleanFit, fitTile, fitForTile };
}
