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

// The DM has opened a map twice, stands on a map in Fog mode, and the map holds no effect yet.
function hintEffectsDue(s) { return s.opens >= 2 && !!s.fogMode && !!s.sceneOpen && !s.hasEffect; }

// The map shows nothing revealed yet: no brushed area, and every room still in shroud.
function hintRevealDue(s) { return !s.revealed; }

// A map opened (or repainted) with something revealed while the TV is not live.
function hintShowOnTvOpenDue(s) { return !!s.revealed && !s.tvLive; }

// The map has rooms (no effects, no lights) and every one is in shroud.
function hintRoomRevealDue(s) { return s.rooms >= 1 && s.shroudRooms === s.rooms; }

// A screen-read hint may show only once the quiet gap has passed since any hint closed.
function hintQuietOver(s) { return s.now - s.lastClosedAt >= s.gapMs; }

// The stored count of maps opened, one more: anything that is not a whole count starts again at one.
function hintOpensNext(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n + 1 : 1;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { hintOpenMapDue, hintShowOnTvDue, hintMusicDue, hintFightDue, hintStatBlockDue, hintGroupsDue, hintEffectsDue, hintRevealDue, hintShowOnTvOpenDue, hintRoomRevealDue, hintQuietOver, hintOpensNext };
}
