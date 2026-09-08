'use strict';

// music.js — the music bubble: the track library, playback, and the YouTube download panel.
// DM window only. Nothing here reaches the Player and no scene switch touches it. Pure helpers
// live in musicPlan.js.

const MU_FADE_MS = 2000;
const MU_TICK_MS = 40;
const MU_VOL_KEY = 'evermist.music.volume';

let _muTracks = [];        // [{ name, size, url }] straight off the folder
let _muPlaying = null;     // the file name playing, or null
let _muOpen = false;
let _muDecks = null;       // exactly two, so a crossfade has somewhere to go
let _muActive = 0;
let _muVolume = 0.7;
let _muDurations = {};     // name → seconds, for this run only

let _muLookup = null;      // { title, entries: [{ id, title, duration, size, have }] }
let _muPicked = {};
let _muQueue = [];
let _muBusy = false;
let _muProgress = {};
let _muMetaEls = {};       // video id → that row's meta cell

function _muEl(id) { return document.getElementById(id); }

function initMusic() {
  const pill = _muEl('mu-pill');
  if (!pill) return;

  const saved = parseFloat(localStorage.getItem(MU_VOL_KEY));
  if (isFinite(saved) && saved >= 0 && saved <= 1) _muVolume = saved;
  const vol = _muEl('mu-vol');
  if (vol) {
    vol.value = String(Math.round(_muVolume * 100));
    vol.addEventListener('input', () => _muSetVolume(Number(vol.value) / 100));
  }

  pill.addEventListener('click', () => _muSetOpen(!_muOpen));
  const stop = _muEl('btn-mu-stop');
  if (stop) stop.addEventListener('click', (e) => { e.stopPropagation(); _muStop(); });
  const filter = _muEl('mu-filter');
  if (filter) filter.addEventListener('input', _muRenderList);
  const add = _muEl('btn-mu-add');
  if (add) add.addEventListener('click', _muOpenDownload);

  _muInitDownloadPanel();
  _muRenderPill();
  _muRefreshTracks();
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
  if (bubble) bubble.classList.toggle('mu-resting', !_muPlaying);
  const label = _muPlaying ? displayName(_muPlaying) : '';
  const name = _muEl('mu-pill-name');
  if (name) name.textContent = label;
  const now = _muEl('mu-now-name');
  if (now) now.textContent = label || 'Nothing playing';
  const stop = _muEl('btn-mu-stop');
  if (stop) stop.disabled = !_muPlaying;
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
    empty.className = 'mu-empty';
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
    del.className = 'mu-row-del';
    del.title = 'Delete this track';
    del.textContent = '×';
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

// The TOTAL, never the filtered count: a placeholder is invisible while the field has text in it.
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
  return { el: el, phase: 0, target: 0, timer: 0 };
}

function _muEnsureDecks() {
  if (!_muDecks) _muDecks = [_muDeck(), _muDeck()];
}

function _muRampTo(deck, target) {
  deck.target = target;
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
  if (deck.phase === 0) {
    deck.el.pause();
    try { deck.el.removeAttribute('src'); deck.el.load(); } catch (_) {}
  }
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

  _muRampTo(incoming, 1);
  _muRampTo(outgoing, 0);
  _muActive = 1 - _muActive;
  _muPlaying = track.name;
  _muRenderPill();
  // The list too, or the picked row is not lit until something else happens to re-render it.
  _muRenderList();
  _muSetOpen(false);
}

function _muStop() {
  if (!_muPlaying || !_muDecks) return;
  _muRampTo(_muDecks[_muActive], 0);
  _muPlaying = null;
  _muRenderPill();
  _muRenderList();
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
      if (track.name === _muPlaying) _muStop();
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

// ─── The download panel ──────────────────────────────────────────────────────
function _muInitDownloadPanel() {
  const bind = (id, ev, fn) => { const el = _muEl(id); if (el) el.addEventListener(ev, fn); };
  bind('btn-mu-close', 'click', _muCloseDownload);
  bind('mu-backdrop', 'click', _muCloseDownload);
  bind('btn-mu-look', 'click', _muDoLookup);
  bind('btn-mu-get', 'click', _muStartDownloads);
  bind('btn-mu-updater', 'click', _muUpdateDownloader);
  bind('mu-url', 'keydown', (e) => { if (e.key === 'Enter') _muDoLookup(); });

  if (window.electronAPI && window.electronAPI.onMusicProgress) {
    // ⚠ ONE CELL, NOT A RE-RENDER. yt-dlp reports progress several times a second, and
    // rebuilding a hundred-row list that often locks the panel up.
    window.electronAPI.onMusicProgress((d) => {
      if (!d || !d.id) return;
      _muProgress[d.id] = d.percent;
      const cell = _muMetaEls[d.id];
      if (cell) cell.textContent = Math.round(d.percent) + '%';
    });
  }
}

function _muOpenDownload() {
  const modal = _muEl('mu-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  const backdrop = _muEl('mu-backdrop');
  if (backdrop) backdrop.style.display = 'block';
  const url = _muEl('mu-url');
  if (url) { url.value = ''; url.focus(); }
  _muLookup = null;
  _muPicked = {};
  _muProgress = {};
  _muSetStatus('');
  _muRenderLookup();
}

function _muCloseDownload() {
  // ⚠ Shuts the panel, never the queue: a close would lose 50MB already waited for.
  const modal = _muEl('mu-modal');
  if (modal) modal.style.display = 'none';
  const backdrop = _muEl('mu-backdrop');
  if (backdrop) backdrop.style.display = 'none';
}

function _muSetStatus(text, isError) {
  const el = _muEl('mu-status');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('mt-err', !!isError);
}

async function _muDoLookup() {
  const field = _muEl('mu-url');
  if (!field) return;
  const parsed = parseMusicUrl(field.value);
  if (!parsed.mode) {
    _muLookup = null;
    _muSetStatus('That is not a link this can read. Paste a YouTube video or playlist address.', true);
    _muRenderLookup();
    return;
  }

  _muSetStatus(parsed.mode === 'playlist' ? 'Reading the playlist…' : 'Reading the video…');
  const look = _muEl('btn-mu-look');
  if (look) look.disabled = true;
  try {
    const id = parsed.mode === 'playlist' ? parsed.playlistId : parsed.videoId;
    const res = await window.electronAPI.musicLookup(parsed.mode, id, parsed.url);
    const have = {};
    for (const t of _muTracks) {
      const vid = videoIdFromFileName(t.name);
      if (vid) have[vid] = true;
    }
    const entries = ((res && res.entries) || []).map(e => ({
      id: e.id, title: e.title, duration: e.duration, size: e.size, url: e.url,
      have: !!have[e.id],
    }));
    _muLookup = { title: (res && res.title) || '', entries: entries };
    _muPicked = {};
    // A single video is the one thing a video link asks for, so it arrives ticked.
    if (parsed.mode === 'video' && entries.length === 1 && !entries[0].have) _muPicked[entries[0].id] = true;
    const haveCount = entries.filter(e => e.have).length;
    _muSetStatus(entries.length + (entries.length === 1 ? ' track' : ' tracks') +
                 (haveCount ? ' · ' + haveCount + ' already downloaded' : ''));
  } catch (err) {
    _muLookup = null;
    _muSetStatus((err && err.message) || String(err), true);
  }
  if (look) look.disabled = false;
  _muRenderLookup();
}

function _muRenderLookup() {
  const list = _muEl('mu-picklist');
  const foot = _muEl('mu-pickfoot');
  if (!list) return;

  list.innerHTML = '';
  _muMetaEls = {};
  if (!_muLookup || !_muLookup.entries.length) {
    list.style.display = 'none';
    if (foot) foot.style.display = 'none';
    return;
  }
  list.style.display = 'block';
  if (foot) foot.style.display = 'flex';

  if (_muLookup.title) {
    const head = document.createElement('div');
    head.className = 'mu-picktitle';
    head.textContent = _muLookup.title;
    list.appendChild(head);
  }

  for (const entry of _muLookup.entries) {
    const row = document.createElement('div');
    row.className = 'mu-pick' + (entry.have || entry.done ? ' mu-pick-have' : '');

    const box = document.createElement('span');
    box.className = 'mu-check' + (_muPicked[entry.id] ? ' mu-check-on' : '');
    row.appendChild(box);

    const label = document.createElement('span');
    label.className = 'mu-pick-name';
    label.textContent = entry.title || entry.id;
    label.title = entry.error || label.textContent;
    row.appendChild(label);

    const meta = document.createElement('span');
    meta.className = 'mu-pick-meta';
    if (entry.failed) meta.textContent = 'failed';
    else if (_muProgress[entry.id] !== undefined) meta.textContent = Math.round(_muProgress[entry.id]) + '%';
    else if (entry.done) meta.textContent = 'done';
    else if (entry.have) meta.textContent = 'have it';
    else meta.textContent = entry.duration ? formatDuration(entry.duration) : formatBytes(entry.size);
    _muMetaEls[entry.id] = meta;
    row.appendChild(meta);

    if (!entry.have && !entry.done && !_muBusy) {
      row.addEventListener('click', () => {
        if (_muPicked[entry.id]) delete _muPicked[entry.id];
        else _muPicked[entry.id] = true;
        _muRenderLookup();
      });
    }
    list.appendChild(row);
  }

  const picked = Object.keys(_muPicked).length;
  const count = _muEl('mu-pickcount');
  if (count) count.textContent = _muBusy ? _muQueue.length + ' left' : picked + ' selected';
  const go = _muEl('btn-mu-get');
  if (go) {
    go.disabled = _muBusy || !picked;
    go.textContent = picked && !_muBusy ? 'Download ' + picked : 'Download';
  }
}

// ⚠ ONE AT A TIME. YouTube rate-limits parallel requests, so twenty jobs at once is slower
// than twenty in a row plus failures.
function _muStartDownloads() {
  if (_muBusy || !_muLookup) return;
  _muQueue = _muLookup.entries.filter(e => _muPicked[e.id]);
  if (!_muQueue.length) return;
  _muBusy = true;
  _muSetStatus('Downloading…');
  _muRenderLookup();
  _muQueueStep();
}

async function _muQueueStep() {
  const entry = _muQueue.shift();
  if (!entry) {
    _muBusy = false;
    const failed = _muLookup ? _muLookup.entries.filter(e => e.failed) : [];
    _muSetStatus(failed.length
      ? failed.length + (failed.length === 1 ? ' track failed' : ' tracks failed') +
        ' · hover a row for the reason'
      : 'Done.', failed.length > 0);
    _muRefreshTracks();
    _muRenderLookup();
    return;
  }

  _muProgress[entry.id] = 0;
  _muRenderLookup();
  try {
    await window.electronAPI.musicDownload(entry.id, entry.url);
    entry.done = true;
    delete _muPicked[entry.id];
  } catch (err) {
    // ⚠ A failure must never kill the batch: a removed, age-gated or region-locked video is
    // one row's problem, and the DM comes back to the rest downloaded.
    entry.failed = true;
    entry.error = (err && err.message) || String(err);
  }
  delete _muProgress[entry.id];
  _muRenderLookup();
  _muQueueStep();
}

function _muUpdateDownloader() {
  const btn = _muEl('btn-mu-updater');
  if (btn) btn.disabled = true;
  _muSetStatus('Updating the downloader…');
  window.electronAPI.musicYtdlpUpdate()
    .then(msg => _muSetStatus(msg || 'The downloader is up to date.'))
    .catch(err => _muSetStatus((err && err.message) || String(err), true))
    .then(() => { if (btn) btn.disabled = false; });
}
