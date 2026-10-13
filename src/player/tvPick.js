'use strict';
// tvPick.js — pure kernel: which screen is the TV. The main process gathers the display list;
// this decides. A display is { id, label, internal, bounds: {x, y, width, height}, size: {width, height} }.

// A TV reports its own name, and some report none. The unnamed one is "Screen N" for its place in
// the list; tvControl.js translates that, so it has the number too.
const SCREEN_UNNAMED = 'Screen {n}';
function screenName(display, index) {
  const label = display && typeof display.label === 'string' ? display.label.trim() : '';
  return label || SCREEN_UNNAMED.replace('{n}', index + 1);
}

function _sameSize(a, b) {
  return !!a && !!b && a.width === b.width && a.height === b.height;
}

// What is stored about the TV the DM picked: enough to know it again, nothing that ties it to a session.
function tvRemember(display) {
  return {
    label: display.label || '', width: display.size.width, height: display.size.height,
    x: display.bounds.x, y: display.bounds.y,
  };
}

// Label AND size match; position settles a tie between two identical screens. An empty label never matches.
function _rememberedMatch(candidates, remembered) {
  if (!remembered || typeof remembered.label !== 'string' || !remembered.label.trim()) return null;
  const same = candidates.filter(c =>
    typeof c.label === 'string' && c.label.trim() === remembered.label.trim() &&
    _sameSize(c.size, { width: remembered.width, height: remembered.height }));
  if (!same.length) return null;
  const there = same.find(c => c.bounds.x === remembered.x && c.bounds.y === remembered.y);
  return there || same[0];
}

// kind 'one': use `display`. 'ask': several, none remembered. 'none': no second screen.
function pickTv(displays, dmDisplayId, remembered) {
  const named = (displays || []).map((d, i) => ({ ...d, name: screenName(d, i), number: i + 1 }));
  const others = named.filter(d => d.id !== dmDisplayId);
  const external = others.filter(d => !d.internal);
  const candidates = external.length ? external : others;
  if (!candidates.length) return { kind: 'none', candidates };
  if (candidates.length === 1) return { kind: 'one', display: candidates[0], candidates };
  const known = _rememberedMatch(candidates, remembered);
  if (known) return { kind: 'one', display: known, candidates };
  return { kind: 'ask', candidates };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pickTv, screenName, tvRemember };
}
