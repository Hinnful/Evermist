'use strict';

// wheelPlan.js — pure wheel kernel: which device sent a wheel event, how far it zooms, and how many
// size steps it is worth. No DOM, so it is unit-tested; see test/wheelPlan.test.js.

const WHEEL_PINCH_K  = 0.01;     // zoom per deltaY of a pinch
const WHEEL_SCROLL_K = 0.0015;   // zoom per deltaY of a scroll, the world map's own rate
const WHEEL_ZOOM_CLAMP = 10;     // a Ctrl+mouse wheel sends 100; this keeps its notch at the old ~1.1x
const WHEEL_GAP_MS   = 150;      // a gesture ends after this long with no event
const WHEEL_STEP_PX  = 60;       // scrolled pixels that make one size step

function wheelState() { return { touchpad: false, last: -Infinity }; }

// 'pinch' (ctrlKey), 'touchpad' or 'mouse'. A touchpad event carries a deltaX or a fractional or
// small deltaY, and once one does the gesture stays touchpad until a gap. The caller owns `state`.
function classifyWheel(e, state, now) {
  if (e.ctrlKey) return 'pinch';
  const reads = e.deltaMode === 0 &&
    (e.deltaX !== 0 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 50);
  const live = state.touchpad && now - state.last < WHEEL_GAP_MS;
  state.touchpad = live || reads;
  state.last = now;
  return state.touchpad ? 'touchpad' : 'mouse';
}

function _clamp(d) { return Math.max(-WHEEL_ZOOM_CLAMP, Math.min(WHEEL_ZOOM_CLAMP, d)); }

// The zoom factor of one event. A mouse wheel keeps its fixed `step` per event.
function wheelZoomFactor(kind, deltaY, step) {
  if (kind === 'mouse') return deltaY < 0 ? step : 1 / step;
  return Math.exp(-_clamp(deltaY) * (kind === 'pinch' ? WHEEL_PINCH_K : WHEEL_SCROLL_K));
}

// Size steps for a stepped control: a mouse wheel is one step an event, a touchpad one per
// WHEEL_STEP_PX scrolled. `acc` is the caller's remainder. Positive steps grow (scroll up).
function wheelSteps(kind, deltaY, acc) {
  if (kind === 'mouse') return { steps: deltaY < 0 ? 1 : (deltaY > 0 ? -1 : 0), acc: 0 };
  const sum = acc + deltaY;
  const n = Math.trunc(sum / WHEEL_STEP_PX);
  return { steps: -n || 0, acc: sum - n * WHEEL_STEP_PX };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { wheelState, classifyWheel, wheelZoomFactor, wheelSteps,
    WHEEL_PINCH_K, WHEEL_SCROLL_K, WHEEL_GAP_MS, WHEEL_STEP_PX };
}
