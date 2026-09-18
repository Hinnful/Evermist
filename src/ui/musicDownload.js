'use strict';

// musicDownload.js — the Add music panel: it reads a pasted YouTube link, lists what is behind
// it, and downloads the tracks ticked. Split out of music.js, which owns the bubble and
// playback. The seam is five named functions and no shared variable: `_muRefreshTracks`,
// `_muHaveIds` and `setMusicDownloadProgress` in, `initMusicDownload` and `openMusicDownload`
// out. Pure helpers live in musicPlan.js.

const MU_LOOKUP_DEBOUNCE_MS = 400;
const MU_SPINNER_AFTER_MS = 1000;

let _muLookup = null;      // { title, entries: [...] }
let _muPicked = new Set(); // video ids ticked for download
let _muQueue = [];
let _muQueueTotal = 0;     // what the pill's progress line is a fraction of
let _muBusy = false;
let _muProgress = {};
let _muMetaEls = {};       // video id → that row's meta cell
let _muLookupToken = 0;    // a stale lookup's result is dropped, whichever way it lands
let _muLookupTimer = 0;
let _muSpinTimer = 0;

function initMusicDownload() {
  const bind = (id, ev, fn) => { const el = _muEl(id); if (el) el.addEventListener(ev, fn); };
  bind('btn-mu-close', 'click', _muCloseDownload);
  bind('mu-backdrop', 'click', _muCloseDownload);
  bind('btn-mu-get', 'click', _muStartDownloads);
  bind('btn-mu-updater', 'click', _muUpdateDownloader);
  bind('btn-mu-selclear', 'click', () => { _muPicked.clear(); _muRenderLookup(); });
  bind('btn-mu-selall', 'click', _muToggleSelectAll);

  // A paste is read at once; typing waits for the field to go quiet. Both drop the previous
  // request rather than letting two reads race.
  bind('mu-url', 'paste', () => setTimeout(_muDoLookup, 0));
  bind('mu-url', 'input', () => {
    clearTimeout(_muLookupTimer);
    _muLookupTimer = setTimeout(_muDoLookup, MU_LOOKUP_DEBOUNCE_MS);
  });
  // Escape clears a selection first and closes on the second press, as the scene library does.
  bind('mu-modal', 'keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (_muPicked.size) { _muPicked.clear(); _muRenderLookup(); }
    else _muCloseDownload();
  });

  if (window.electronAPI && window.electronAPI.onMusicProgress) {
    // ⚠ ONE CELL, NOT A RE-RENDER. yt-dlp reports progress several times a second, and
    // rebuilding a hundred-row list that often locks the panel up.
    window.electronAPI.onMusicProgress((d) => {
      if (!d || !d.id) return;
      _muProgress[d.id] = d.percent;
      const cell = _muMetaEls[d.id];
      if (cell) cell.textContent = Math.round(d.percent) + '%';
      _muPushProgress();
    });
  }
}

function openMusicDownload() {
  const modal = _muEl('mu-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  const backdrop = _muEl('mu-backdrop');
  if (backdrop) backdrop.style.display = 'block';
  // ⚠ A RUNNING QUEUE SURVIVES A REOPEN. Clearing the lookup here would mean pasting the link
  // again to see how far a download that is still going has got.
  if (!_muBusy) {
    const url = _muEl('mu-url');
    if (url) { url.value = ''; url.focus(); }
    _muLookup = null;
    _muPicked.clear();
    _muProgress = {};
    _muSetStatus('');
  }
  _muRenderLookup();
  _muCheckDownloaderVersion();
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

function _muSpin(on) {
  clearTimeout(_muSpinTimer);
  const el = _muEl('mu-spin');
  if (!el) return;
  if (!on) { el.style.display = 'none'; return; }
  _muSpinTimer = setTimeout(() => { el.style.display = ''; }, MU_SPINNER_AFTER_MS);
}

async function _muDoLookup() {
  clearTimeout(_muLookupTimer);
  const field = _muEl('mu-url');
  if (!field) return;
  const parsed = parseMusicUrl(field.value);
  const token = ++_muLookupToken;

  if (!parsed.mode) {
    _muSpin(false);
    _muLookup = null;
    _muPicked.clear();
    const typed = !!field.value.trim();
    _muSetStatus(typed ? 'That is not a link this can read. Paste a YouTube video or playlist address.' : '', typed);
    _muRenderLookup();
    return;
  }

  _muSpin(true);
  _muSetStatus(parsed.mode === 'playlist' ? 'Reading the playlist…' : 'Reading the video…');
  try {
    const id = parsed.mode === 'playlist' ? parsed.playlistId : parsed.videoId;
    const res = await window.electronAPI.musicLookup(parsed.mode, id, parsed.url);
    // A second paste already superseded this one, so its answer is not the panel's any more.
    if (token !== _muLookupToken) return;
    const have = _muHaveIds();
    const entries = ((res && res.entries) || []).map(e => ({
      id: e.id, title: e.title, duration: e.duration, size: e.size, url: e.url,
      have: !!have[e.id],
    }));
    _muLookup = { title: (res && res.title) || '', entries: entries };
    _muPicked.clear();
    // A single video is the one thing a video link asks for, so it arrives ticked.
    if (parsed.mode === 'video' && entries.length === 1 && !entries[0].have) _muPicked.add(entries[0].id);
    const haveCount = entries.filter(e => e.have).length;
    _muSetStatus([
      _muLookup.title,
      entries.length + (entries.length === 1 ? ' track' : ' tracks'),
      haveCount ? haveCount + ' already downloaded' : '',
    ].filter(Boolean).join(' · '));
  } catch (err) {
    if (token !== _muLookupToken) return;
    _muLookup = null;
    _muPicked.clear();
    _muSetStatus((err && err.message) || String(err), true);
  }
  _muSpin(false);
  _muRenderLookup();
}

// Every entry that could still be downloaded. Select all means these, and nothing else.
function _muSelectable() {
  return _muLookup ? _muLookup.entries.filter(e => !e.have && !e.done) : [];
}

function _muToggleSelectAll() {
  const pickable = _muSelectable();
  if (pickable.length && pickable.every(e => _muPicked.has(e.id))) _muPicked.clear();
  else pickable.forEach(e => _muPicked.add(e.id));
  _muRenderLookup();
}

function _muRenderLookup() {
  const list = _muEl('mu-picklist');
  if (!list) return;

  list.innerHTML = '';
  _muMetaEls = {};
  if (!_muLookup || !_muLookup.entries.length) {
    list.style.display = 'none';
    _muRenderActionBar();
    return;
  }
  list.style.display = 'block';

  for (const entry of _muLookup.entries) {
    const done = entry.have || entry.done;
    const row = document.createElement('div');
    row.className = 'mu-pick' + (done ? ' mu-pick-have' : '') +
                    (_muPicked.has(entry.id) ? ' checked' : '');

    if (done) {
      const mark = document.createElement('span');
      mark.className = 'mu-havemark';
      mark.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M4 12.5l5 5L20 6.5"/></svg>';
      row.appendChild(mark);
    } else {
      // .sm-cb, the scene library's checkbox, at this list's own 15px.
      const box = document.createElement('div');
      box.className = 'sm-cb' + (_muPicked.has(entry.id) ? ' checked' : '');
      if (_muPicked.has(entry.id)) {
        box.innerHTML = '<svg width="7" height="7" viewBox="0 0 9 9" fill="none" stroke="#dbe8ff" ' +
          'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 4.5l2 2 4-4"/></svg>';
      }
      row.appendChild(box);
    }

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

    if (!done && !_muBusy) {
      row.addEventListener('click', () => {
        if (_muPicked.has(entry.id)) _muPicked.delete(entry.id);
        else _muPicked.add(entry.id);
        _muRenderLookup();
      });
    }
    list.appendChild(row);
  }
  _muRenderActionBar();
}

function _muRenderActionBar() {
  const modal = _muEl('mu-modal');
  if (modal) modal.classList.toggle('mu-selecting', _muPicked.size > 0 || _muBusy);

  const count = _muEl('mu-selcount');
  if (count) count.textContent = _muBusy
    ? 'Downloading, ' + _muQueue.length + ' left'
    : _muPicked.size + ' selected';

  const all = _muEl('btn-mu-selall');
  if (all) {
    const pickable = _muSelectable();
    all.disabled = _muBusy || !pickable.length;
    all.textContent = pickable.length && pickable.every(e => _muPicked.has(e.id))
      ? 'Deselect all' : 'Select all';
  }

  const go = _muEl('btn-mu-get');
  const label = _muEl('mu-getlabel');
  if (go) go.disabled = _muBusy || !_muPicked.size;
  if (label) {
    let bytes = 0;
    if (_muLookup) for (const e of _muLookup.entries) if (_muPicked.has(e.id)) bytes += e.size || 0;
    const size = formatBytes(bytes);
    label.textContent = 'Download ' + _muPicked.size + (size ? ' · ' + size : '');
  }
}

// ⚠ ONE AT A TIME. YouTube rate-limits parallel requests, so twenty jobs at once is slower
// than twenty in a row plus failures.
function _muStartDownloads() {
  if (_muBusy || !_muLookup) return;
  _muQueue = _muLookup.entries.filter(e => _muPicked.has(e.id));
  if (!_muQueue.length) return;
  _muBusy = true;
  _muQueueTotal = _muQueue.length;
  _muSetStatus('Downloading…');
  _muPushProgress();
  _muRenderLookup();
  _muQueueStep();
}

// Whole tracks finished plus the current one's share of a track, so fifteen downloads move the
// line fifteen times rather than snapping between 0 and 100.
function _muPushProgress() {
  if (typeof setMusicDownloadProgress !== 'function') return;
  if (!_muBusy || !_muQueueTotal) { setMusicDownloadProgress(null); return; }
  const left = _muQueue.length;
  const partial = Object.values(_muProgress).reduce((a, p) => a + (p || 0), 0) / 100;
  const done = _muQueueTotal - left - Object.keys(_muProgress).length;
  setMusicDownloadProgress((done + partial) / _muQueueTotal);
}

async function _muQueueStep() {
  const entry = _muQueue.shift();
  if (!entry) {
    _muBusy = false;
    _muQueueTotal = 0;
    _muPushProgress();
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
  _muPushProgress();
  _muRenderLookup();
  try {
    await window.electronAPI.musicDownload(entry.id, entry.url);
    entry.done = true;
    _muPicked.delete(entry.id);
  } catch (err) {
    // ⚠ A failure must never kill the batch: a removed, age-gated or region-locked video is
    // one row's problem, and the DM comes back to the rest downloaded.
    entry.failed = true;
    entry.error = (err && err.message) || String(err);
  }
  delete _muProgress[entry.id];
  _muPushProgress();
  _muRenderLookup();
  _muQueueStep();
}

// The footer exists only when there is something newer to move to, because a button offering an
// update that does not exist is worse than no button.
async function _muCheckDownloaderVersion() {
  const foot = _muEl('mu-pickfoot');
  if (!foot || !window.electronAPI || !window.electronAPI.musicYtdlpLatest) return;
  foot.style.display = 'none';
  try {
    const v = await window.electronAPI.musicYtdlpLatest();
    if (ytdlpOutdated(v && v.current, v && v.latest)) foot.style.display = 'flex';
  } catch (_) {}
}

function _muUpdateDownloader() {
  const btn = _muEl('btn-mu-updater');
  if (btn) btn.disabled = true;
  _muSetStatus('Updating the downloader…');
  window.electronAPI.musicYtdlpUpdate()
    .then(msg => {
      _muSetStatus(msg || 'The downloader is up to date.');
      _muCheckDownloaderVersion();
    })
    .catch(err => _muSetStatus((err && err.message) || String(err), true))
    .then(() => { if (btn) btn.disabled = false; });
}
