'use strict';

// music.js — the music bubble: the track library and playback. The Add music panel it opens
// lives in musicDownload.js. DM window only: nothing here reaches the Player and no scene
// switch touches it. Pure helpers live in musicPlan.js.

const MU_FADE_MS = 2000;
const MU_TICK_MS = 40;
const MU_VOL_KEY = 'evermist.music.volume';

let _muTracks = [];        // [{ name, size, url }] straight off the folder
let _muPlaying = null;     // the file name loaded, playing or paused
let _muPaused = false;
let _muOpen = false;
let _muDecks = null;       // exactly two, so a crossfade has somewhere to go
let _muActive = 0;
let _muVolume = 0.7;
let _muDurations = {};     // name → seconds, for this run only

function _muEl(id) { return document.getElementById(id); }

function initMusic() {
  if (!_muEl('mu-pill')) return;

  const saved = parseFloat(localStorage.getItem(MU_VOL_KEY));
  if (isFinite(saved) && saved >= 0 && saved <= 1) _muVolume = saved;

  const vol = _muEl('mu-vol');
  if (vol) {
    vol.value = String(Math.round(_muVolume * 100));
    _muSyncSlider();
    vol.addEventListener('input', () => { _muSetVolume(Number(vol.value) / 100); _muSyncSlider(); });
  }

  const bind = (id, ev, fn) => { const el = _muEl(id); if (el) el.addEventListener(ev, fn); };
  bind('btn-mu-open', 'click', () => _muSetOpen(!_muOpen));
  bind('btn-mu-chev', 'click', () => _muSetOpen(!_muOpen));
  bind('btn-mu-pause', 'click', _muTogglePause);
  bind('mu-filter', 'input', _muRenderList);
  bind('btn-mu-add', 'click', () => { _muSetOpen(false); openMusicDownload(); });

  // A click anywhere but the bubble shuts the panel. mousedown rather than click, so a drag
  // on the map closes it as the drag starts rather than when it ends.
  document.addEventListener('mousedown', (e) => {
    if (!_muOpen) return;
    const bubble = _muEl('music-bubble');
    if (bubble && !bubble.contains(e.target)) _muSetOpen(false);
  });

  _muRenderPill();
  _muRefreshTracks();
  // Last, the way toolbar.js calls initRoomPanel and initControlPanel: the panel it wires reads
  // this module's track list, so nothing there runs before the list exists.
  initMusicDownload();
}

// The app's own slider is a div track with an invisible range over it, so the fill and knob are
// positioned by hand. Same arithmetic as _cpFancy in controlPanel.js.
function _muSyncSlider() {
  const range = _muEl('mu-vol');
  if (!range) return;
  const wrap = range.closest('.cp-slider');
  if (!wrap) return;
  const pct = Math.min(100, Math.max(0, Number(range.value) || 0));
  const fill = wrap.querySelector('.cp-slider-fill');
  const knob = wrap.querySelector('.cp-slider-knob');
  if (fill) fill.style.width = pct + '%';
  if (knob) knob.style.left = pct + '%';
}

// The folder is the library, so this read is the only source of truth.
async function _muRefreshTracks() {
  if (!window.electronAPI || !window.electronAPI.listMusicFiles) return;
  try {
    _muTracks = (await window.electronAPI.listMusicFiles()) || [];
  } catch (err) {
    _muTracks = [];
    messageDialog({ title: 'Music folder unreadable', message: (err && err.message) || String(err) });
  }
  _muRenderList();
  _muScanDurations();
}

// Durations come off the files rather than a store, because a store means a database.
function _muScanDurations() {
  const pending = _muTracks.filter(t => _muDurations[t.name] === undefined);
  if (!pending.length) return;
  const probe = document.createElement('audio');
  probe.preload = 'metadata';
  probe.muted = true;
  let i = 0;
  const next = () => {
    if (i >= pending.length) return;
    const track = pending[i++];
    const done = (secs) => {
      _muDurations[track.name] = secs || 0;
      probe.onloadedmetadata = probe.onerror = null;
      _muRenderList();
      next();
    };
    probe.onloadedmetadata = () => done(probe.duration);
    probe.onerror = () => done(0);
    probe.src = track.url;
  };
  next();
}

// ─── The bubble ──────────────────────────────────────────────────────────────
function _muSetOpen(open) {
  _muOpen = !!open;
  const panel = _muEl('mu-panel');
  if (panel) panel.style.display = _muOpen ? 'flex' : 'none';
  const chev = _muEl('mu-chev');
  if (chev) chev.classList.toggle('mu-chev-up', _muOpen);
  if (_muOpen) _muRefreshTracks();
}

function _muRenderPill() {
  const bubble = _muEl('music-bubble');
  if (bubble) {
    bubble.classList.toggle('mu-resting', !_muPlaying);
    bubble.classList.toggle('mu-paused', !!_muPaused);
  }
  const name = _muEl('mu-pill-name');
  // ⚠ A LABEL, NEVER AN EMPTY STRING: with no text the pill collapses to a bare square.
  if (name) name.textContent = _muPlaying ? displayName(_muPlaying) : 'Music';
  const pause = _muEl('btn-mu-pause');
  if (pause) pause.title = _muPaused ? 'Play' : 'Pause';
  const icoPause = _muEl('mu-ico-pause');
  const icoPlay = _muEl('mu-ico-play');
  if (icoPause) icoPause.style.display = _muPaused ? 'none' : '';
  if (icoPlay) icoPlay.style.display = _muPaused ? '' : 'none';
}

function _muRenderList() {
  const list = _muEl('mu-list');
  if (!list) return;
  const filter = _muEl('mu-filter');
  const rows = filterTracks(
    _muTracks.map(t => ({ name: t.name, display: displayName(t.name), url: t.url, size: t.size })),
    filter ? filter.value : ''
  );

  list.innerHTML = '';
  if (!_muTracks.length) {
    const empty = document.createElement('div');
    empty.className = 'mt-status mu-empty';
    empty.textContent = 'No music yet. Add from YouTube, or drop audio files into the app’s music folder.';
    list.appendChild(empty);
    _muRenderCount();
    return;
  }

  for (const track of rows) {
    const row = document.createElement('div');
    row.className = 'mu-row' + (track.name === _muPlaying ? ' mu-row-on' : '');

    const label = document.createElement('span');
    label.className = 'mu-row-name';
    label.textContent = track.display;
    label.title = track.display;
    row.appendChild(label);

    const meta = document.createElement('span');
    meta.className = 'mu-row-meta';
    const secs = _muDurations[track.name];
    meta.textContent = secs ? formatDuration(secs) : formatBytes(track.size);
    row.appendChild(meta);

    const del = document.createElement('button');
    del.className = 'cp-btn cp-btn-outline cp-btn-icon mu-row-del';
    del.title = 'Delete this track';
    del.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/>' +
      '<path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>';
    del.addEventListener('click', (e) => { e.stopPropagation(); _muAskDelete(track); });
    row.appendChild(del);

    // ⚠ The row IS the play control, and a click on the row already playing does NOTHING.
    // Opening a second element on one file starves Chromium's media pipeline - the same
    // landmine that makes the Player buffer its own copy of a video map.
    row.addEventListener('click', () => { if (track.name !== _muPlaying) _muPlay(track); });
    list.appendChild(row);
  }
  _muRenderCount();
}

// The placeholder carries the TOTAL, never the filtered count: it is invisible while the field
// has text in it, which is exactly when a filtered count would be wanted.
function _muRenderCount() {
  const filter = _muEl('mu-filter');
  if (!filter) return;
  const total = _muTracks.length;
  filter.placeholder = 'Filter ' + total + (total === 1 ? ' track' : ' tracks');
}

// ─── Playback ────────────────────────────────────────────────────────────────
// ⚠ TWO <audio> ELEMENTS AND A VOLUME RAMP, not Web Audio. `createMediaElementSource` taints a
// source read as cross-origin into silence, and this page is served from opaque-origin `file://`.
// One element also cannot play the outgoing and incoming track at once. Each deck owns its own
// ramp timer, because a shared one gets cleared by the next pick and leaves a deck at zero.
function _muDeck() {
  const el = document.createElement('audio');
  el.loop = true;
  el.preload = 'auto';
  el.volume = 0;
  return { el: el, phase: 0, target: 0, timer: 0, keep: false };
}

function _muEnsureDecks() {
  if (!_muDecks) _muDecks = [_muDeck(), _muDeck()];
}

// `keep` is what separates a pause from a crossfade: both fade to zero, but only a crossfade
// gives the file up. Pausing has to leave currentTime where it was.
function _muRampTo(deck, target, keep) {
  deck.target = target;
  deck.keep = !!keep;
  if (deck.timer) return;
  deck.timer = setInterval(() => _muTick(deck), MU_TICK_MS);
}

function _muTick(deck) {
  const step = MU_TICK_MS / MU_FADE_MS;
  deck.phase = deck.phase < deck.target
    ? Math.min(deck.target, deck.phase + step)
    : Math.max(deck.target, deck.phase - step);
  deck.el.volume = fadeLevel(deck.phase) * _muVolume;
  if (deck.phase !== deck.target) return;
  clearInterval(deck.timer);
  deck.timer = 0;
  if (deck.phase !== 0) return;
  deck.el.pause();
  if (deck.keep) return;
  try { deck.el.removeAttribute('src'); deck.el.load(); } catch (_) {}
}

function _muPlay(track) {
  _muEnsureDecks();
  const incoming = _muDecks[1 - _muActive];
  const outgoing = _muDecks[_muActive];

  const failed = () => {
    incoming.el.onerror = null;
    incoming.target = 0;
    messageDialog({
      title: 'That track will not play',
      message: displayName(track.name) + '\n\nThe file may be incomplete, or in a format this ' +
               'app cannot decode. Delete it and download it again.',
    });
    _muPlaying = null;
    _muPaused = false;
    _muRenderPill();
    _muRenderList();
  };

  // Reusing a deck that still holds the previous src: setting src releases it, so a file is
  // never open on two elements at once.
  incoming.el.onerror = failed;
  incoming.el.src = track.url;
  incoming.el.volume = fadeLevel(incoming.phase) * _muVolume;
  const started = incoming.el.play();
  if (started && typeof started.catch === 'function') started.catch(failed);

  _muRampTo(incoming, 1, false);
  _muRampTo(outgoing, 0, false);
  _muActive = 1 - _muActive;
  _muPlaying = track.name;
  _muPaused = false;
  _muRenderPill();
  _muRenderList();
  _muSetOpen(false);
}

function _muTogglePause() {
  if (!_muPlaying || !_muDecks) return;
  const deck = _muDecks[_muActive];
  if (_muPaused) {
    const started = deck.el.play();
    if (started && typeof started.catch === 'function') started.catch(() => {});
    _muRampTo(deck, 1, true);
  } else {
    _muRampTo(deck, 0, true);
  }
  _muPaused = !_muPaused;
  _muRenderPill();
}

function _muSetVolume(v) {
  _muVolume = Math.min(1, Math.max(0, v));
  localStorage.setItem(MU_VOL_KEY, String(_muVolume));
  // Applied through the fade level, so a nudge mid-crossfade keeps both decks on their curve.
  if (_muDecks) for (const d of _muDecks) d.el.volume = fadeLevel(d.phase) * _muVolume;
}

function _muAskDelete(track) {
  confirmDialog({
    title: 'Delete this track?',
    message: displayName(track.name) + '\n\nThe file leaves the music folder. There is no undo, ' +
             'and downloading it again is one paste.',
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: async () => {
      if (track.name === _muPlaying) {
        _muPlaying = null;
        _muPaused = false;
        if (_muDecks) _muRampTo(_muDecks[_muActive], 0, false);
        _muRenderPill();
      }
      try {
        await window.electronAPI.deleteMusicFile(track.name);
      } catch (err) {
        messageDialog({ title: 'Could not delete that track', message: (err && err.message) || String(err) });
      }
      delete _muDurations[track.name];
      _muRefreshTracks();
    },
  });
}

// How far the download queue has got, drawn on the pill because that is the one control always
// on screen. `null` takes the line away.
function setMusicDownloadProgress(fraction) {
  const bubble = _muEl('music-bubble');
  const bar = _muEl('mu-dlbar');
  if (bubble) bubble.classList.toggle('mu-downloading', fraction !== null);
  if (bar && fraction !== null) {
    const pct = Math.min(100, Math.max(0, fraction * 100));
    bar.firstElementChild.style.width = pct + '%';
  }
}

// The video ids already on disk, which is what tells the download panel which rows to mark as
// "have it". Kept behind a function so `_muTracks` stays this module's own.
function _muHaveIds() {
  const have = {};
  for (const t of _muTracks) {
    const id = videoIdFromFileName(t.name);
    if (id) have[id] = true;
  }
  return have;
}
