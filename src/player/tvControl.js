'use strict';
// tvControl.js — Show on TV: what sits over the minimap's picture. The off, waiting and live
// states, the buttons, the pill, the TV menu and the help box for a machine with one screen.
// tvPick.js decides which screen; electron/displays.js moves the window. The legacy buttons in
// #cp-legacy stay the back end: this clicks them, so toolbar.js and the rig keep working.
//
// ⚠ A SCREEN'S NAME COMES FROM THE TV ITSELF: it reaches the DOM as text, never as markup.

const TV_SCREEN_KEY = 'evermist.tvScreen';   // the screen the DM picked last, for tvPick.js
const TV_WAIT_MS    = 15000;                 // how long a switch to a second screen is waited for
const TV_NOTE_MS    = 4000;

const TV_ICON = {
  tv:   '<svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"><rect x="1.6" y="3" width="10.8" height="7.4" rx="1.2"/><line x1="7" y1="10.4" x2="7" y2="12"/><line x1="4.6" y1="12" x2="9.4" y2="12"/></svg>',
  sync: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"><path d="M2.2 7a4.8 4.8 0 0 1 8.1-3.5L11.8 5"/><polyline points="11.8,1.6 11.8,5 8.4,5"/><path d="M11.8 7a4.8 4.8 0 0 1-8.1 3.5L2.2 9"/><polyline points="2.2,12.4 2.2,9 5.6,9"/></svg>',
  lock: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6.3" width="8" height="5.4" rx="1"/><path d="M4.7 6.3V4.6a2.3 2.3 0 0 1 4.6 0"/></svg>',
  more: '<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><circle cx="3" cy="7" r="1.15"/><circle cx="7" cy="7" r="1.15"/><circle cx="11" cy="7" r="1.15"/></svg>',
  send: '<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"><polygon points="3.5,2.3 11.8,7 3.5,11.7"/></svg>',
  stop: '<svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="2" width="8" height="8" rx="1.4"/></svg>',
  fs:   '<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5V2h3M9 2h3v3M12 9v3H9M5 12H2V9"/></svg>',
  exit: '<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2v3H2M12 5H9V2M9 12V9h3M2 9h3v3"/></svg>',
};

let _tvInited = false;
let _tvDisplays = [];        // every screen, as main reports them
let _tvDmId = null;          // the screen holding this window
let _tvRoute = null;         // how the open Player was started: 'tv' (placed) or 'window'
let _tvScreenId = null;      // the screen the Player was placed on
let _tvWaitSince = 0;        // nonzero while waiting for a second screen to appear
let _tvMenu = null;          // the open menu: 'tv', 'ask' or 'help'
let _tvNote = '';
let _tvFit = 0;              // pill words dropped: 0 none, 1 Fullscreen's, 2 Send's, 3 the label shortens
let _tvKey = '';

const _tvEl = id => document.getElementById(id);
const _tvLegacy = id => { const b = _tvEl(id); if (b) b.click(); refreshPlayerControlUI(); };

function _tvMake(tag, cls, kids) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const k of kids || []) el.append(k);
  return el;
}
const _tvIcon = svg => { const s = document.createElement('span'); s.className = 'tv-ic'; s.innerHTML = svg; return s; };
function _tvBtn(cls, title, kids, onClick) {
  const b = _tvMake('button', cls, kids);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', e => { e.stopPropagation(); onClick(e); });
  return b;
}
function _tvText(cls, text) { const s = _tvMake('span', cls); s.textContent = text; return s; }
// A screen's name as the DM reads it: the TV's own, or "Screen N" in their language.
function _tvScreenLabel(d) { return d.label && d.label.trim() ? d.name : t('Screen {n}', { n: d.number }); }
function _tvName(display) { const s = _tvText('nm', _tvScreenLabel(display)); s.setAttribute('data-no-i18n', ''); return s; }

// ─── What is true now ────────────────────────────────────────────────────────

function _tvLive() {
  return panesActive ? stageIsOpen() : !!(playerWindow && !playerWindow.closed);
}

function _tvRemembered() {
  try { return JSON.parse(localStorage.getItem(TV_SCREEN_KEY)); } catch (_) { return null; }
}

function _tvPickNow() { return pickTv(_tvDisplays, _tvDmId, _tvRemembered()); }

function _tvRes(d) { return d.size.width + '×' + d.size.height; }

function _tvOs() {
  const p = navigator.platform || '';
  return /^Win/i.test(p) ? 'win' : /^Mac/i.test(p) ? 'mac' : 'other';
}

async function _tvLoadDisplays() {
  const api = window.electronAPI;
  if (!api || !api.listDisplays) return;
  try {
    const r = await api.listDisplays();
    _tvDisplays = (r && r.displays) || [];
    _tvDmId = r ? r.dmDisplayId : null;
  } catch (_) {}
}

// ─── Actions ─────────────────────────────────────────────────────────────────

function _tvClose() { _tvMenu = null; _tvEl('tv-pop').hidden = true; }

// Opens the Player if it is shut, then puts it on the screen. The rig's --offscreen answers
// `skipped`, and the Player then stays a window.
function _tvGoLive(display) {
  _tvWaitSince = 0;
  _tvClose();
  if (!_tvLive()) _tvLegacy('btn-player');
  const api = window.electronAPI;
  const place = !!display && !!api && !!api.placePlayer;
  _tvRoute = place ? 'tv' : 'window';
  _tvScreenId = place ? display.id : null;
  if (place) {
    try { localStorage.setItem(TV_SCREEN_KEY, JSON.stringify(tvRemember(display))); } catch (_) {}
    api.placePlayer(playerWindowName(), display.id).then(r => {
      if (r && r.skipped) { _tvRoute = 'window'; _tvScreenId = null; }
      tvRefresh();
    });
  }
  tvRefresh();
}

function _tvStop() {
  if (_tvLive()) _tvLegacy('btn-player');
  _tvRoute = null;
  _tvScreenId = null;
  tvRefresh();
}

async function _tvShow() {
  if (_tvLive()) return;
  await _tvLoadDisplays();
  const pick = _tvPickNow();
  if (pick.kind === 'one') _tvGoLive(pick.display);
  else _tvOpen(pick.kind === 'ask' ? 'ask' : 'help');
}

async function _tvSwitch() {
  const r = await window.electronAPI.extendDisplay();
  if (!r || r.skipped) return;
  _tvClose();
  if (r.ok) _tvWaitSince = Date.now();
  tvRefresh();
}

// The TV left while the map was on it.
function _tvUnplugged() {
  _tvStop();
  _tvNote = t('The TV was disconnected. The map is off it.');
  tvRefresh();
  setTimeout(() => { _tvNote = ''; tvRefresh(); }, TV_NOTE_MS);
}

async function _tvOnDisplays(e) {
  await _tvLoadDisplays();
  if (e && e.kind === 'removed' && _tvLive() && _tvRoute === 'tv' && !_tvDisplays.some(d => d.id === _tvScreenId)) {
    _tvUnplugged();
    return;
  }
  _tvTick();
}

// Every second: the screen list is read again while the Player is not live, so a TV the OS was still
// configuring at launch is found without a plug event. While waiting for a second screen, the first
// candidate that shows up takes the map.
async function _tvTick() {
  if (_tvWaitSince || !_tvLive()) await _tvLoadDisplays();
  if (_tvWaitSince) {
    const pick = _tvPickNow();
    if (pick.kind === 'one') _tvGoLive(pick.display);
    else if (pick.kind === 'ask') { _tvWaitSince = 0; _tvOpen('ask'); }
    else if (Date.now() - _tvWaitSince > TV_WAIT_MS) { _tvWaitSince = 0; _tvOpen('help'); }
  }
  // A Player window can close without telling us.
  if (!_tvLive() && _tvRoute) { _tvRoute = null; _tvScreenId = null; }
  tvRefresh();
}

// ─── The menus ───────────────────────────────────────────────────────────────

function _tvOpen(kind) {
  _tvMenu = kind;
  const pop = _tvEl('tv-pop');
  pop.textContent = '';
  pop.classList.toggle('help', kind === 'help');
  pop.append(kind === 'help' ? _tvHelp() : _tvTvMenu(kind === 'ask'));
  pop.hidden = false;
  tvRefresh();
}

function _tvRow(cls, kids, onClick) { return _tvBtn('tv-row2' + (cls ? ' ' + cls : ''), '', kids, onClick); }

function _tvTvMenu(asking) {
  const pick = _tvPickNow();
  const live = _tvLive();
  const menu = _tvMake('div', 'tv-menu');
  menu.append(_tvText(asking ? 'q' : 'ttl', asking ? t('Which screen is the TV?') : t('TV')));
  const blk = _tvMake('div', 'blk');
  blk.append(_tvText('lbl', t('Show the map on')));
  if (!pick.candidates.length) blk.append(_tvText('tv-row2 none', t('No second screen found')));
  for (const d of pick.candidates) {
    const on = !asking && ((live && _tvRoute === 'tv') ? d.id === _tvScreenId : (!live && pick.display && pick.display.id === d.id));
    const row = _tvRow(on ? 'on' : '', [_tvName(d), _tvText('mt', _tvRes(d))], () => _tvGoLive(d));
    row.title = _tvScreenLabel(d);
    blk.append(row);
  }
  blk.append(_tvRow(live && _tvRoute === 'window' ? 'on' : '', [_tvText('nm', t('A window I place myself'))], () => _tvGoLive(null)));
  if (!pick.candidates.length) blk.append(_tvRow('', [_tvText('nm', t('How do I connect a TV?'))], () => _tvOpen('help')));
  menu.append(blk);
  if (!asking) {
    const fit = _tvFitBlock();
    if (fit) menu.append(fit);
    menu.append(_tvUpdates());
  }
  return menu;
}

// Fit to TV: the open map's own turn of the TV picture, stepped Off, Fitted, Flipped (tvFit.js). With
// two maps it acts on the selected column's map, against that column's half of the TV.
function _tvFitBlock() {
  const s = paneScope();
  if (!(s.mapWidth > 0) || !s.tvFit) return null;
  const tv = minimapSelectedHalf().tv;
  const fits = fitDisabled(s.tvFit, crossesTv(s.mapWidth, s.mapHeight, tv.w, tv.h, s.tvFit.turn));
  const state = [t('Off'), t('Fitted'), t('Flipped')][s.tvFit.step];
  const hint = [t('Lays a tall map along the TV, upright from your seat.'), t('Click again to turn it the other way.'),
                t('Click again to put the map back as it was.')][s.tvFit.step];
  const blk = _tvMake('div', 'blk');
  blk.append(_tvText('lbl', t('This map')));
  const row = _tvRow(s.tvFit.step ? 'on' : '', [_tvText('nm', t('Fit to TV')), _tvText('mt', fits ? t('Already fits') : state)], () => {
    stepSceneFit();
    _tvOpen('tv');
    // A column answers a message later; its state is read again once it has.
    if (panesActive) setTimeout(() => { if (_tvMenu === 'tv') _tvOpen('tv'); }, 150);
  });
  row.disabled = fits;
  blk.append(row, _tvText('hint', fits ? t('The map already lies along the TV.') : hint));
  return blk;
}

function _tvUpdates() {
  const blk = _tvMake('div', 'blk');
  blk.append(_tvText('lbl', t('Updates')));
  const seg = _tvMake('div', 'seg');
  for (const [on, label] of [[true, t('Auto')], [false, t('Manual')]]) {
    const b = _tvBtn(autoSync === on ? 'on' : '', '', [document.createTextNode(label)], () => {
      if (autoSync !== on) _tvLegacy('btn-auto-sync');
      _tvOpen('tv');
    });
    seg.append(b);
  }
  blk.append(seg, _tvText('hint', autoSync ? t('Every reveal reaches the TV as you make it.') : t('Changes wait until you press Send.')));
  return blk;
}

function _tvHelp() {
  const os = _tvOs();
  const box = _tvMake('div', 'tv-help');
  const body = _tvMake('div', 'tv-help-body');
  body.append(document.createTextNode(t('If the TV is plugged in, it is copying this screen.') + ' '));
  if (os === 'win') body.append(document.createTextNode(t('Make it a second screen and the map goes there.')));
  if (os === 'mac') {
    body.append(document.createTextNode(t('Set the TV to') + ' '), _tvText('b', t('Extended display')),
                document.createTextNode(' ' + t('in System Settings › Displays, or press') + ' '),
                _tvText('kbd', '⌘'), document.createTextNode(' '), _tvText('kbd', 'F1'));
  }
  box.append(_tvText('t', t('Evermist sees only this screen')), body);
  const act = _tvMake('div', 'act');
  if (os !== 'other') {
    act.append(_tvBtn('tv-go small', '', [document.createTextNode(os === 'mac' ? t('Open Display settings') : t('Use the TV as a second screen'))], _tvSwitch));
  }
  act.append(_tvBtn('tv-btn', '', [document.createTextNode(t('Not now'))], _tvClose));
  box.append(act, _tvBtn('tv-lnk', '', [document.createTextNode(t('Open in a window instead'))], () => _tvGoLive(null)));
  return box;
}

// ─── The picture's controls ──────────────────────────────────────────────────

function _tvTools(live) {
  const tl = _tvMake('div', 'tv-row tl tv-tools');
  tl.append(_tvBtn('tv-ov sq' + (minimapLocked ? ' active' : ''),
    minimapLocked ? t('Minimap locked. Click to unlock') : t("Lock the minimap so a stray drag can't move the view"),
    [_tvIcon(TV_ICON.lock)], () => _tvLegacy('btn-minimap-lock')));
  const tr = _tvMake('div', 'tv-row tr tv-tools');
  tr.append(_tvBtn('tv-ov sq' + (playersViewOn ? ' active' : ''), t("Players' view (hold H) - see your map the way the TV shows it"),
    [_tvIcon(TV_ICON.tv)], togglePlayersView));
  if (live) tr.append(_tvBtn('tv-ov sq', t('Match the TV to my view'), [_tvIcon(TV_ICON.sync)], () => _tvLegacy('btn-sync-view')));
  tr.append(_tvBtn('tv-ov sq', t('Screen and updates'), [_tvIcon(TV_ICON.more)], () => (_tvMenu === 'tv' ? _tvClose() : _tvOpen('tv'))));
  return [tl, tr];
}

function _tvCaption(pick) {
  if (pick.kind === 'one') return _tvScreenLabel(pick.display);
  return pick.kind === 'ask' ? t('Pick a screen') : t('No TV found');
}

function _tvCta(pick) {
  const cta = _tvMake('div', 'tv-cta');
  const cap = _tvCaption(pick);
  const label = _tvText('nm', cap);
  if (pick.kind === 'one') label.setAttribute('data-no-i18n', '');
  const sub = _tvBtn('tv-sub', cap, [label, _tvText('car', '▼')], () => (_tvMenu === 'tv' ? _tvClose() : _tvOpen('tv')));
  const go = _tvBtn('tv-go' + (pick.kind === 'none' ? ' none' : ''), '', [_tvIcon(TV_ICON.tv), document.createTextNode(t('Show on TV'))], _tvShow);
  go.id = 'tv-go';   // the show-on-tv hint points at it
  cta.append(go, sub);
  return cta;
}

// The state and its way back in one pill; Fullscreen and Send join it when they apply.
function _tvPill() {
  const window_ = _tvRoute !== 'tv';
  const fs = !!paneScope().playerIsFullscreen;
  const screen = _tvDisplays.find(d => d.id === _tvScreenId);
  const where = _tvFit >= 3 ? t('Live') : window_ ? t('Live in a window') : t('Live on TV');
  const full = window_ ? t('Live in a window') : t('Live on TV');
  const grp = _tvMake('div', 'tv-grp' + (_tvFit >= 2 ? ' tight' : ''));
  const parts = [];
  if (window_) {
    const word = fs ? t('Windowed') : t('Fullscreen');
    const hint = fs ? t('Leave fullscreen (Esc on that window)') : t('Fill the screen that window is on (F11 or a double-click on it)');
    parts.push(_tvBtn('sd', word + ' - ' + hint, [_tvIcon(fs ? TV_ICON.exit : TV_ICON.fs)].concat(_tvFit >= 1 ? [] : [document.createTextNode(word)]),
      () => _tvLegacy('btn-fullscreen-player')));
  }
  if (!autoSync) {
    const word = t('Send');
    const kids = [_tvIcon(TV_ICON.send)].concat(_tvFit >= 2 ? [] : [document.createTextNode(word)]);
    if (playerUnsent) kids.push(_tvMake('span', 'unsent'));
    parts.push(_tvBtn('sd', word + ' - ' + t('Send your changes to the TV'), kids, () => _tvLegacy('btn-send')));
  }
  const stop = _tvFit >= 3 ? t('Stop') : t('Stop showing');
  const lv = _tvBtn(['lv', 'sw', parts.length ? '' : 'solo'].join(' ').trim(),
    [full, screen && !window_ ? _tvScreenLabel(screen) : ''].filter(Boolean).join(' - ') + '. ' + t('Stop showing'),
    [_tvMake('span', 'st', [_tvMake('i'), document.createTextNode(where)]),
     _tvMake('span', 'ac', [_tvIcon(TV_ICON.stop), document.createTextNode(stop)])], _tvStop);
  grp.append(lv, ...parts);
  const row = _tvMake('div', 'tv-row bl');
  row.append(grp);
  return row;
}

function _tvWait() {
  const w = _tvMake('div', 'tv-wait', [_tvMake('span', 'tv-spin'), document.createTextNode(t('Waiting for the TV…'))]);
  w.append(_tvBtn('tv-btn', '', [document.createTextNode(t('Cancel'))], () => { _tvWaitSince = 0; tvRefresh(); }));
  return w;
}

// ─── Render ──────────────────────────────────────────────────────────────────

function _tvTooWide() {
  const grp = document.querySelector('#tv-ui .tv-grp');
  return !!grp && grp.scrollWidth > _tvEl('minimap-panel').offsetWidth - 14;
}

// Rebuilds only when something it shows has changed, so a button is never replaced between the
// press and the release of a click.
function tvRefresh() {
  if (!_tvInited) return;
  const panel = _tvEl('minimap-panel');
  const live = _tvLive();
  const pick = _tvPickNow();
  minimapSetShape(live ? null : (pick.kind === 'one' ? { w: pick.display.size.width, h: pick.display.size.height } : null));
  if (live) hintClose('show-on-tv');
  panel.classList.toggle('tv-live', live);
  panel.classList.toggle('tv-off', !live);
  panel.classList.toggle('minimap-locked', minimapLocked);
  const base = [live, !!_tvWaitSince, _tvRoute, live ? '' : _tvCaption(pick), autoSync, playerUnsent, minimapLocked, playersViewOn,
    live && !!paneScope().playerIsFullscreen, _tvNote, _tvMenu, panel.offsetWidth, _tvScreenId, _tvDisplays.map(d => d.id).join(','), pick.kind].join('|');
  if (base === _tvKey) return;
  _tvFit = 0;
  _tvKey = base;
  const ui = _tvEl('tv-ui');
  for (;;) {
    ui.textContent = '';
    if (_tvWaitSince && !live) ui.append(_tvWait());
    else if (live) ui.append(..._tvTools(true), _tvPill());
    else ui.append(..._tvTools(false), _tvCta(pick));
    if (_tvNote) ui.append(_tvText('tv-note', _tvNote));
    if (!live || !_tvTooWide() || _tvFit >= 3) break;
    _tvFit++;
  }
}

function initTvControl() {
  if (_tvInited) return;
  _tvInited = true;
  document.addEventListener('mousedown', e => {
    if (_tvMenu && !e.target.closest('#tv-pop, #tv-ui')) { _tvClose(); tvRefresh(); }
  });
  document.addEventListener('keydown', e => {
    if (e.code === 'Escape' && _tvMenu) { _tvClose(); tvRefresh(); }
  });
  new ResizeObserver(tvRefresh).observe(_tvEl('minimap-panel'));
  if (window.electronAPI && window.electronAPI.onDisplaysChanged) window.electronAPI.onDisplaysChanged(_tvOnDisplays);
  setInterval(_tvTick, 1000);
  _tvLoadDisplays().then(tvRefresh);
  tvRefresh();
}
