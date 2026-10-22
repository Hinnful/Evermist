'use strict';
// hintsCues.js — the first-use cues that point a new DM at what the app already has: the Campaign's Open and Group,
// Show on TV, Effects, the Music and Sounds panes, and the fight table. Built on hints.js; when each is due is
// hintsPlan.js. A cue the DM's own action answers (a stroke, a pane opening) shows at once and replaces the toast up;
// one read off the screen (the Campaign, a map opened) waits while another is up.

const HC_OPENS_KEY = 'evermist.mapOpens';
let _hcOpened = false;     // a map has opened in this run
let _hcOpens = null;       // maps opened across launches, read once

function _hcLive() { return !isPane && !panesActive; }

function _hcOpenCount() {
  if (_hcOpens === null) { try { _hcOpens = hintOpensNext(localStorage.getItem(HC_OPENS_KEY)) - 1; } catch (_) { _hcOpens = 0; } }
  return _hcOpens;
}

// ─── Maps opened: the Campaign's Open hint ends, Effects counts ──────────────

// A scene finished loading (switchScene).
function hintsMapOpened() {
  if (isPane || isPlayer) return;   // a column or the TV opening a scene is not the DM opening a map
  _hcOpened = true;
  hintClose('open-map');
  _hcOpens = _hcOpenCount() + 1;
  try { localStorage.setItem(HC_OPENS_KEY, String(_hcOpens)); } catch (_) {}
  hintsCuesSync();
}

// ─── The Campaign and the map, read off the screen ───────────────────────────

const _hcFirstCard = () => {
  const s = allScenes[0], el = s && _wmEls.get('c' + s.id), r = el && el.getBoundingClientRect();
  return r && r.width ? r : null;
};

// Every frame while the Campaign is up (worldMapFollow), and on each repaint of the map (hintsFirstSync).
function hintsCuesSync() {
  if (!_hcLive()) return;
  if (worldMapOpen) { _hcCampaign(); return; }
  hintClose('open-map');
  hintClose('groups');
  if (_hintCur || !hintEffectsDue({ opens: _hcOpenCount(), fogMode: placeMode === 'rooms', sceneOpen: !!currentScene })) return;
  _hintShow('effects', 'Fire, acid and light',
    'Switch to Effects to draw a fire, a cone of acid or a light. The players see it on the TV.',
    'btn-place-effects', _hintNear(_hintRectOf('btn-place-effects'), 'above'));
}

function _hcCampaign() {
  hintClose('effects');
  hintClose('show-on-tv');
  const facts = { campaignUp: true, maps: allScenes.length, opened: _hcOpened, groups: worldPlaceRecords().length };
  const openDue = hintOpenMapDue(facts), group = hintGroupsDue(facts);
  // A hint is spent the moment it shows, so "due" ends it and "may show" only decides whether it starts.
  const open = openDue && _hintsMayShow('open-map');
  if (!openDue) hintClose('open-map');
  if (!group) hintClose('groups');
  if (_hintCur) { if (_hintCur.id === 'open-map' || _hintCur.id === 'groups') _hintReplace(); return; }
  if (open && !_hcFirstCard()) return;
  if (!open && group && !_hintRectOf('btn-shape')()) return;
  if (open) {
    _hintShow('open-map', 'Open a map', 'Double-click a map, or pick it and press Open.', null, _hintNear(_hcFirstCard, 'right'));
  } else if (group) {
    _hintShow('groups', 'Gather maps into a group',
      'Draw a group around maps that belong together: a village, a dungeon, one tavern. A map dropped inside joins it.',
      'btn-shape', _hintNear(_hintRectOf('btn-shape'), 'above'));
  }
}

// ─── Show on TV: the first brush stroke ──────────────────────────────────────

// A brush stroke ended (settleFogAfterStroke). True when the hint showed, so the Rooms hint waits for the next stroke.
function hintsShowOnTvAsk() {
  if (!_hcLive() || worldMapOpen || !currentScene || !hintShowOnTvDue({ tvLive: _tvLive() })) return false;
  if (!_hintsMayShow('show-on-tv')) return false;   // spent: a toast still up from the first stroke is not this stroke's
  _hintShow('show-on-tv', 'Put it on the TV', 'Press Show on TV. The players see only what you reveal.',
    'tv-go', _hintNear(_hintRectOf('tv-go'), 'above'));
  return !!_hintCur && _hintCur.id === 'show-on-tv';
}

// ─── Music and Sounds ────────────────────────────────────────────────────────

// The track list was read (music.js). The hint needs the pane open and the library empty, and ends with a first track.
function hintsMusicSync(tracks) {
  const paneOpen = dockActivePane() === 'music';
  if (!paneOpen || tracks > 0) hintClose('music');
  if (!_hcLive() || !hintMusicDue({ paneOpen, tracks })) return;
  _hintShow('music', 'Add your music', 'Add files from this computer, or paste a YouTube link. A track loops until you pick another.',
    null, _hintPlaceBeside('btn-mu-files', false));
}

// A music track started playing (music.js).
function hintsMusicStarted() {
  if (!_hcLive() || dockActivePane() === 'sounds') return;
  _hintShow('sounds', 'Sounds play over the music', 'Open Sounds for a door, a scream or thunder. Each click plays one more.',
    'dock-tab-sounds', _hintPlaceBeside('dock-tab-sounds', true));
}

// ─── The fight table ─────────────────────────────────────────────────────────

// The table was opened (cbSetOpen), with this many creatures in the open fight.
function hintsFightOpened(creatures) {
  if (!_hcLive() || !hintFightDue({ open: true, creatures })) return;
  _hintShow('fight', 'Run a fight here', 'Add creatures from the Bestiary, then sort by initiative. HP takes sums like 45-12.',
    null, _hintNear(_hintRectOf('cb-add'), 'below'));
}

function hintsFightClosed() { hintClose('fight'); hintClose('stat-block'); }

// The row's stat block icon, which shows only under the pointer: its own box, else where it will be, at the row's end.
const _hcStatIcon = id => () => {
  const row = document.querySelector('#cb-list .cb-row[data-id="' + id + '"]'), b = row && row.querySelector('[data-b="stat"]');
  const r = b && b.getBoundingClientRect();
  if (r && r.width) return r;
  const w = row && row.getBoundingClientRect();
  return w && w.width ? { left: w.right - 26, right: w.right, top: w.top, bottom: w.bottom } : null;
};

// A creature was added (_cbAddRow); `before` is how many the fight held.
function hintsFightRowAdded(before, rowId) {
  hintClose('fight');
  if (!_hcLive() || !hintStatBlockDue({ before, after: before + 1 })) return;
  _hintShow('stat-block', 'Its stat block is one click away', 'Press the book on a row to read or edit that creature.',
    null, _hintNear(_hcStatIcon(rowId), 'below'));
}

// ─── Panes closing under a toast ─────────────────────────────────────────────

function hintsCuesInit() {
  document.addEventListener('dockpane', e => {
    if (e.detail !== 'music') hintClose('music');
    if (e.detail === 'sounds') hintClose('sounds');
  });
}
