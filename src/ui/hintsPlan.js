'use strict';
// hintsPlan.js — pure kernel: when each first-use cue is due. A predicate reads the facts the caller
// hands it and answers whether the hint should show; hints.js decides once-ever, Hints Off and the rest.

// The Campaign is up, holds a map, and no map has been opened in this run.
function hintOpenMapDue(s) { return !!s.campaignUp && s.maps >= 1 && !s.opened; }

// A first brush stroke ended while the TV is not live.
function hintShowOnTvDue(s) { return !s.tvLive; }

// The Music pane is open and the library holds no track.
function hintMusicDue(s) { return !!s.paneOpen && s.tracks === 0; }

// The Fights window opened on a fight with no creatures.
function hintFightDue(s) { return !!s.open && s.creatures === 0; }

// A fight went from no creatures to some.
function hintStatBlockDue(s) { return s.before === 0 && s.after >= 1; }

// The Campaign is up with three or more maps and no group.
function hintGroupsDue(s) { return !!s.campaignUp && s.maps >= 3 && s.groups === 0; }

// The DM has opened a map twice, and stands on a map in Fog mode.
function hintEffectsDue(s) { return s.opens >= 2 && !!s.fogMode && !!s.sceneOpen; }

// The stored count of maps opened, one more: anything that is not a whole count starts again at one.
function hintOpensNext(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n + 1 : 1;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { hintOpenMapDue, hintShowOnTvDue, hintMusicDue, hintFightDue, hintStatBlockDue, hintGroupsDue, hintEffectsDue, hintOpensNext };
}
