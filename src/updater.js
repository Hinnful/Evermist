'use strict';

// updater.js — the update line in the About footer, and the button that installs.
//
// DM only: main sends the status to the DM window alone, and the Player carries no UI.
// Nothing here downloads. Main does that, so quitting mid-download costs nothing and the
// next start resumes it.

function initUpdater() {
  if (typeof isPlayer !== 'undefined' && isPlayer) return;

  const slot = document.getElementById('about-update');
  const api = window.electronAPI;
  if (!slot || !api || !api.onUpdateStatus) return;

  function showDownloading(status) {
    slot.textContent = typeof status.percent === 'number'
      ? 'Downloading update ' + status.percent + '%'
      : 'Downloading update';
  }

  function showReady(status) {
    slot.textContent = '';
    const label = document.createElement('span');
    label.textContent = 'Version ' + status.version + ' is ready';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'about-update-btn';
    btn.textContent = 'Restart to update';
    btn.addEventListener('click', () => api.installUpdate());

    slot.append(label, btn);
  }

  function render(status) {
    const state = status && status.state;

    if (state === 'downloading') showDownloading(status);
    else if (state === 'ready') showReady(status);
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
}
