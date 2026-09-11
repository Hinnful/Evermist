'use strict';

// changelog.js — the What's new panel: every release, newest first, from changelogData.js.
//
// DM only; the Player carries no UI. The list is GENERATED at release time, so nothing here
// knows how to write an entry — see tools/build-changelog.js.

let _clRoot = null;
let _clVersion = '';

function _clBuild() {
  if (_clRoot) return;

  _clRoot = document.createElement('div');
  _clRoot.id = 'cl-anchor';
  _clRoot.style.display = 'none';
  _clRoot.innerHTML =
    '<div id="cl-backdrop"></div>' +
    '<div id="cl-modal" tabindex="-1">' +
      '<div class="cl-head">' +
        '<span class="cl-title">What\'s new</span>' +
        '<button type="button" class="cl-x" id="cl-close" title="Close" aria-label="Close">✕</button>' +
      '</div>' +
      '<div id="cl-body"></div>' +
    '</div>';
  document.body.appendChild(_clRoot);

  document.getElementById('cl-backdrop').addEventListener('click', closeChangelog);
  document.getElementById('cl-close').addEventListener('click', closeChangelog);
}

// ⚠ CAPTURE, AT THE DOCUMENT. The map shortcuts hang off a document keydown with no idea a panel
// is up, so Delete pressed while the DM reads would take out the room they had selected.
function _clKeys(e) {
  e.stopPropagation();
  if (e.key === 'Escape') closeChangelog();
}

function _clFill() {
  const body = document.getElementById('cl-body');
  body.innerHTML = '';

  for (const entry of (typeof CHANGELOG !== 'undefined' ? CHANGELOG : [])) {
    const row = document.createElement('div');
    row.className = 'cl-entry';

    const ver = document.createElement('span');
    ver.className = 'cl-ver';
    ver.textContent = entry.version;
    if (entry.version === _clVersion) {
      const chip = document.createElement('span');
      chip.className = 'cl-chip';
      chip.textContent = 'installed';
      ver.appendChild(chip);
    }
    const date = document.createElement('span');
    date.className = 'cl-date';
    date.textContent = entry.date;

    const line = document.createElement('div');
    line.className = 'cl-line';
    line.append(ver, date);

    const note = document.createElement('div');
    note.className = 'cl-note';
    note.textContent = entry.note;

    // The whole header is the control: a caret alone is a 12px target in a list of 68 rows.
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'cl-head-btn';
    head.setAttribute('aria-expanded', 'false');
    head.append(line, note);

    const full = document.createElement('div');
    full.className = 'cl-full';
    full.hidden = true;

    if (entry.body) {
      const text = document.createElement('div');
      text.className = 'cl-text';
      text.textContent = entry.body;
      full.appendChild(text);
    }

    // Only a tagged version has a page to open; the rest released nothing.
    if (entry.tag && window.electronAPI && window.electronAPI.openReleasePage) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'cl-github';
      link.textContent = 'View on GitHub';
      link.addEventListener('click', () => window.electronAPI.openReleasePage(entry.tag));
      full.appendChild(link);
    }

    // A caret on a release with nothing under it opens an empty box, so a bare entry gets none.
    if (full.childElementCount) {
      row.classList.add('cl-has-more');
      head.addEventListener('click', () => {
        full.hidden = !full.hidden;
        head.setAttribute('aria-expanded', full.hidden ? 'false' : 'true');
        row.classList.toggle('cl-open', !full.hidden);
      });
    }

    row.append(head, full);
    body.appendChild(row);
  }
}

// The installed version marks its own entry, and is read once on the first open.
function openChangelog() {
  const api = window.electronAPI;
  if (_clVersion || !api || !api.getAppVersion) { _clOpen(); return; }
  api.getAppVersion().then(v => { _clVersion = v || ''; _clOpen(); }).catch(_clOpen);
}

function _clOpen() {
  _clBuild();
  _clFill();
  _clRoot.style.display = '';
  document.getElementById('cl-body').scrollTop = 0;
  document.getElementById('cl-modal').focus();
  document.addEventListener('keydown', _clKeys, true);
}

function closeChangelog() {
  document.removeEventListener('keydown', _clKeys, true);
  if (_clRoot) _clRoot.style.display = 'none';
}
