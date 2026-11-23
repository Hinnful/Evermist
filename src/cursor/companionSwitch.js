'use strict';
// companionSwitch.js — Settings' "Crystal companion" switch and where it is kept.
// ⚠ Stored only when off, so a missing key means on and the previous release ignores it.

const COMPANION_OFF_KEY = 'evermist.companionOff';

function companionStoredOn() {
  try { return localStorage.getItem(COMPANION_OFF_KEY) !== '1'; } catch (_) { return true; }
}

function companionSwitchInit() {
  const host = document.getElementById('settings-companion');
  if (!host) return;
  host.innerHTML = '<div class="dk-swrow" data-no-i18n><span></span>' +
    '<button type="button" class="dk-switch" role="switch" aria-checked="false"></button></div>';
  const row = host.firstChild, sw = row.querySelector('.dk-switch');
  row.firstChild.textContent = t('Crystal companion');
  sw.setAttribute('aria-label', t('Crystal companion'));
  const paint = () => sw.setAttribute('aria-checked', String(companionStoredOn()));
  row.addEventListener('click', () => {
    const on = !companionStoredOn();
    try { if (on) localStorage.removeItem(COMPANION_OFF_KEY); else localStorage.setItem(COMPANION_OFF_KEY, '1'); } catch (_) {}
    companionSetOn(on);
    paint();
  });
  paint();
}
