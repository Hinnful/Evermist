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
    '<div id="cl-modal" class="sm-win w-m" tabindex="-1">' +
      '<div class="sm-whead">' +
        '<span class="sm-wtitle">What\'s new</span><span class="sm-sp"></span>' +
        '<button type="button" class="sm-x" id="cl-close" title="Close" aria-label="Close">' + uiIcon('x') + '</button>' +
      '</div>' +
      '<div id="cl-body" class="sm-wbody" data-no-i18n></div>' +
    '</div>';
  document.body.appendChild(_clRoot);

  document.getElementById('cl-backdrop').addEventListener('click', closeChangelog);
  document.getElementById('cl-close').addEventListener('click', closeChangelog);
}

// ⚠ CAPTURE, AT THE DOCUMENT. The map shortcuts hang off a document keydown with no idea a panel
// is up, so Delete pressed while the DM reads would take out the room they had selected.
function _clKeys(e) {
  e.stopPropagation();
  if (e.code === 'Escape') closeChangelog();
}

// A body written one point a line reads as a list; an older one, wrapped mid-sentence, stays prose.
function _clBodyEl(body) {
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.some(l => /^[a-z]/.test(l))) {
    const text = document.createElement('div');
    text.className = 'cl-text';
    text.textContent = body;
    return text;
  }
  const ul = document.createElement('ul');
  for (const l of lines) { const li = document.createElement('li'); li.textContent = l; ul.appendChild(li); }
  return ul;
}

function _clFill() {
  const body = document.getElementById('cl-body');
  body.innerHTML = '';
  const day = new Intl.DateTimeFormat(I18N_LANG, { day: 'numeric', month: 'short' });

  for (const entry of (typeof CHANGELOG !== 'undefined' ? CHANGELOG : [])) {
    const row = document.createElement('div');
    row.className = 'cl-entry';

    // The whole row is the control: a chevron alone is a 10px target in a list of 68 rows.
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'cl-row';
    head.setAttribute('aria-expanded', 'false');
    head.innerHTML = '<span class="v"></span><span class="n"></span>';
    head.querySelector('.v').textContent = entry.version;
    head.querySelector('.n').textContent = entry.note;
    if (entry.version === _clVersion) {
      const chip = document.createElement('span');
      chip.className = 'sm-chip on';
      chip.textContent = t('Installed');
      head.appendChild(chip);
    }
    const date = document.createElement('span');
    date.className = 'd';
    const when = new Date(entry.date + 'T00:00:00');
    date.textContent = isNaN(when) ? entry.date : day.format(when);
    head.appendChild(date);

    const full = document.createElement('div');
    full.className = 'cl-body';
    full.hidden = true;
    if (entry.body) full.appendChild(_clBodyEl(entry.body));

    // Only a tagged version has a page to open; the rest released nothing.
    if (entry.tag && window.electronAPI && window.electronAPI.openReleasePage) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'sm-hbtn';
      link.innerHTML = uiIcon('external') + '<span></span>';
      link.lastChild.textContent = t('View on GitHub');
      link.addEventListener('click', () => window.electronAPI.openReleasePage(entry.tag));
      full.appendChild(link);
    }

    // A chevron on a release with nothing under it opens an empty box, so a bare entry gets none.
    if (full.childElementCount) {
      head.insertAdjacentHTML('beforeend', '<span class="sm-chev"></span>');
      head.addEventListener('click', () => {
        full.hidden = !full.hidden;
        head.setAttribute('aria-expanded', full.hidden ? 'false' : 'true');
        row.classList.toggle('cl-open', !full.hidden);
      });
    } else {
      head.classList.add('bare');
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
