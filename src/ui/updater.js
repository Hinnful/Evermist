'use strict';

// updater.js — what the DM sees about updates: a toast on screen, and the line in the About footer.
//
// DM only: main sends the status to the DM window alone, and the Player carries no UI.
// Nothing here downloads. Main does that, so quitting mid-download costs nothing and the
// next start resumes it.

const UP_SEEN_KEY = 'evermistSeenVersion';
const UP_MOVE_KEY = 'evermistMoveOffered';
const UP_INSTALLED_MS = 12000;

let _upToast = null;
let _upHideTimer = 0;

// ⚠ THE DM WINDOW ALONE. A two-column pane is an <iframe> of this same page with isPlayer false,
// so without the isPane guard each pane raises its own toast over its map — and they share one
// localStorage, so whichever ran first would eat the announcement for all of them.
function initUpdater() {
  if (typeof isPlayer !== 'undefined' && isPlayer) return;
  if (typeof isPane !== 'undefined' && isPane) return;

  const slot = document.getElementById('about-update');
  const api = window.electronAPI;
  if (!slot || !api || !api.onUpdateStatus) return;

  function showDownloading(status) {
    slot.textContent = typeof status.percent === 'number'
      ? t('Downloading update {pct}%', { pct: status.percent })
      : 'Downloading update';
  }

  function showReady(status) {
    slot.textContent = '';
    const label = document.createElement('span');
    label.textContent = t('Version {v} is ready', { v: status.version });

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'about-update-btn';
    btn.textContent = 'Restart to update';
    btn.addEventListener('click', () => api.installUpdate());

    slot.append(label, btn);
    upToast(t('Version {v} is ready to install', { v: status.version }), 'Restart now',
      () => api.installUpdate(), 0);
  }

  function showManual() {
    slot.textContent = '';
    const label = document.createElement('span');
    label.textContent = 'Updates are manual on this platform';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'about-update-btn';
    btn.textContent = 'Open releases page';
    btn.addEventListener('click', () => api.openReleasesPage());

    slot.append(label, btn);
  }

  // A Mac copy outside Applications cannot replace itself. The toast offers the move once; the
  // About line keeps offering it.
  function showMove() {
    slot.textContent = '';
    const label = document.createElement('span');
    label.textContent = 'Move to Applications to get updates';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'about-update-btn';
    btn.textContent = 'Move and restart';
    btn.addEventListener('click', () => api.moveToApplications());

    slot.append(label, btn);
    let offered = true;
    try { offered = !!localStorage.getItem(UP_MOVE_KEY); localStorage.setItem(UP_MOVE_KEY, '1'); } catch (_) {}
    if (!offered) {
      upToast('Move Evermist to Applications so it can update itself', 'Move and restart',
        () => api.moveToApplications(), 0);
    }
  }

  function render(status) {
    const state = status && status.state;

    if (state === 'downloading') showDownloading(status);
    else if (state === 'ready') showReady(status);
    else if (state === 'manual') showManual();
    else if (state === 'move') showMove();
    else {
      // 'none' and 'error' both show nothing. Being offline is the usual error and there is
      // nothing the DM can do about it from the table.
      slot.style.display = 'none';
      return;
    }

    slot.style.display = '';
  }

  api.onUpdateStatus(render);
  api.getUpdateState().then(render).catch(() => {});
  announceInstalledVersion();
}

// The app never learns that it restarted INTO a new version — electron-updater installs on quit
// and the fresh process starts clean. So the version is remembered here and compared on the next
// start. A first-ever run records the version silently; there is nothing new to show yet.
function announceInstalledVersion() {
  const api = window.electronAPI;
  if (!api || !api.getAppVersion) return;

  api.getAppVersion().then(version => {
    if (!version) return;
    let seen = null;
    try { seen = localStorage.getItem(UP_SEEN_KEY); } catch (_) { return; }
    try { localStorage.setItem(UP_SEEN_KEY, version); } catch (_) {}
    if (!seen || seen === version) return;
    upToast(t('Updated to {v}', { v: version }), 'What\'s new', openChangelog, UP_INSTALLED_MS);
  }).catch(() => {});
}

// One at a time. hideMs 0 keeps it up until the DM dismisses it, for an action still pending.
function upToast(message, ctaLabel, onCta, hideMs) {
  if (!_upToast) _upToast = toastEl('up-toast', 'download');
  clearTimeout(_upHideTimer);
  _upToast.innerHTML = uiIcon('download', 16);

  const msg = document.createElement('span');
  msg.className = 'm';
  msg.textContent = message;

  const cta = document.createElement('button');
  cta.type = 'button';
  cta.className = 'sm-hbtn primary';
  cta.textContent = ctaLabel;
  cta.addEventListener('click', () => { hideUpdateToast(); onCta(); });

  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'sm-x';
  x.title = 'Dismiss';
  x.setAttribute('aria-label', 'Dismiss');
  x.innerHTML = uiIcon('x');
  x.addEventListener('click', hideUpdateToast);

  _upToast.append(msg, cta, x);
  showToast(_upToast);
  if (hideMs) _upHideTimer = setTimeout(hideUpdateToast, hideMs);
}

function hideUpdateToast() {
  clearTimeout(_upHideTimer);
  if (_upToast) _upToast.style.display = 'none';
}
