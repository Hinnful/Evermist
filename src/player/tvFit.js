'use strict';
// tvFit.js — pure kernel: Fit to TV. A scene's own turn of the TV picture, kept as
// { step, turn }: step 0 Off, 1 Fitted, 2 Flipped; turn is the quarter-turn the TV draws.
// The seat only chooses which way Fitted turns; a later seat change leaves a fit as it was.

const TV_FIT_TURNS = [0, 90, 180, 270];
const TV_FIT_OFF = { step: 0, turn: 0 };

// A fit read from a saved scene or an import: anything unreadable is Off.
function cleanFit(f) {
  if (!f || !Number.isInteger(f.step) || f.step < 1 || f.step > 2 || !TV_FIT_TURNS.includes(f.turn) || !f.turn) {
    return { ...TV_FIT_OFF };
  }
  return { step: f.step, turn: f.turn };
}

// Does the map lie across the TV: tall on a wide TV, or wide on a tall one? `turn` is the turn the
// picture already has, which swaps the TV's sides when sideways. A near-square map crosses nothing.
function crossesTv(mapW, mapH, tvW, tvH, turn) {
  if (!(mapW > 0) || !(mapH > 0) || !(tvW > 0) || !(tvH > 0)) return false;
  const sideways = turn === 90 || turn === 270;
  const w = sideways ? tvH : tvW, h = sideways ? tvW : tvH;
  if (mapH > mapW * 1.05) return w > h;
  if (mapW > mapH * 1.05) return h > w;
  return false;
}

// Upright from the DM's chair: a side chair sees the TV turned by the seat, so the turn that
// cancels it. From a long side there is no upright quarter turn, so clockwise is the guess and
// Flipped is the other way.
function fitTurn(seat) {
  return seat % 180 ? (360 - seat) % 360 : 90;
}

// Off → Fitted → Flipped → Off. Flipped adds 180 to what Fitted chose, so it never reads the seat.
function nextFit(fit, seat) {
  const f = cleanFit(fit);
  const step = (f.step + 1) % 3;
  if (step === 0) return { ...TV_FIT_OFF };
  return { step, turn: step === 1 ? fitTurn(seat) : (f.turn + 180) % 360 };
}

// Only Off is ever disabled, so a fit can always be stepped back to Off.
function fitDisabled(fit, crosses) {
  return !crosses && cleanFit(fit).step === 0;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { cleanFit, crossesTv, fitTurn, nextFit, fitDisabled };
}
