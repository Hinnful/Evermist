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
  host.innerHTML = '<span class="dk-sub"></span><div class="cp-tabs" data-no-i18n>' +
    '<button type="button" class="cp-segtab" data-on="1"></button><button type="button" class="cp-segtab" data-on="0"></button></div>';
  host.firstChild.textContent = t('Crystal companion');
  const tabs = host.querySelectorAll('.cp-segtab');
  tabs[0].textContent = t('On');
  tabs[1].textContent = t('Off');
  const paint = () => tabs.forEach(b => b.classList.toggle('active', (b.dataset.on === '1') === companionStoredOn()));
  tabs.forEach(b => b.addEventListener('click', () => {
    const on = b.dataset.on === '1';
    try { if (on) localStorage.removeItem(COMPANION_OFF_KEY); else localStorage.setItem(COMPANION_OFF_KEY, '1'); } catch (_) {}
    companionSetOn(on);
    paint();
  }));
  paint();
}
