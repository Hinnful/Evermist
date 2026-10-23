'use strict';
// tvControl.js — Show on TV: what sits over the minimap's picture. The off, waiting and live
// states, the buttons, the pill, TV setup, the screen question and the help box for a machine with
// one screen.
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
let _tvMenu = null;          // the open box in #tv-pop: 'ask' or 'help'
let _tvNote = '';
let _tvFit = 0;              // pill words dropped: 0 none, 1 Fullscreen's, 2 Send's, 3 the label shortens, 4 Stop's
let _tvSyncIcon = false;     // Sync has dropped its word
let _tvGoFit = 0;            // Show on TV: 1 its icon gone, 2 the short label, 3 small
let _tvKey = '';
let _tvSetup = false;        // TV setup is open
let _tvSetupSeen = false;    // it has opened once this launch; in memory, never saved
let _tvSetupDd = false;      // its screen list is open
let _tvSetupBusy = false;    // it is flying into the ··· button
let _tvHot = false;          // the ··· button glows for a moment after it
let _tvScreenPick = null;    // before the map is live: a display id, 'window', or null for the default
let _tvWantFull = false;     // before the map is live: the window opens fullscreen
let _tvFullAt = 0;           // when a window just opened is asked to go fullscreen

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
  _tvSetupSeen = true;
  _tvClose();
  const wasOpen = _tvLive();
  if (!wasOpen) _tvLegacy('btn-player');
  const api = window.electronAPI;
  const place = !!display && !!api && !!api.placePlayer;
  if (!place && !wasOpen && _tvWantFull) _tvFullAt = Date.now() + 700;
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

// What the screen choice is now: where the map is, or before it is live, the pick or the default.
function _tvSelected() {
  const pick = _tvPickNow();
  if (_tvLive()) {
    if (_tvRoute !== 'tv') return { kind: 'win' };
    const d = _tvDisplays.find(x => x.id === _tvScreenId);
    return d ? { kind: 'display', display: d } : { kind: 'none', pick };
  }
  if (_tvScreenPick === 'window') return { kind: 'win' };
  const chosen = pick.candidates.find(d => d.id === _tvScreenPick);
  if (chosen) return { kind: 'display', display: chosen };
  if (pick.kind === 'one') return { kind: 'display', display: pick.display };
  return { kind: 'none', pick };
}

function _tvGoSelected(sel) {
  if (sel.kind === 'none') _tvOpen(sel.pick.kind === 'ask' ? 'ask' : 'help');
  else _tvGoLive(sel.kind === 'win' ? null : sel.display);
}

// The first Show on TV of a launch opens TV setup; later ones go straight to the TV.
async function _tvShow() {
  if (_tvLive()) return;
  await _tvLoadDisplays();
  const sel = _tvSelected();
  if (sel.kind === 'none') _tvGoSelected(sel);
  else if (!_tvSetupSeen) _tvSetupOpen();
  else _tvGoSelected(sel);
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
  // A window the DM wanted fullscreen is asked once, when it has had time to load.
  if (_tvFullAt && Date.now() >= _tvFullAt) {
    _tvFullAt = 0;
    if (_tvLive() && _tvRoute === 'window' && !paneScope().playerIsFullscreen) _tvLegacy('btn-fullscreen-player');
  }
  // A Player window can close without telling us.
  if (!_tvLive() && _tvRoute) { _tvRoute = null; _tvScreenId = null; }
  tvRefresh();
}

// ─── The screen question and the help box ────────────────────────────────────

function _tvOpen(kind) {
  _tvMenu = kind;
  const pop = _tvEl('tv-pop');
  pop.textContent = '';
  pop.classList.toggle('help', kind === 'help');
  pop.append(kind === 'help' ? _tvHelp() : _tvAsk());
  pop.hidden = false;
  tvRefresh();
}

function _tvRow(cls, kids, onClick) { return _tvBtn('tv-row2' + (cls ? ' ' + cls : ''), '', kids, onClick); }

// Several screens and none remembered: which is the TV?
function _tvAsk() {
  const pick = _tvPickNow();
  const menu = _tvMake('div', 'tv-menu');
  menu.append(_tvText('q', t('Which screen is the TV?')));
  const blk = _tvMake('div', 'blk');
  blk.append(_tvText('lbl', t('Show the map on')));
  for (const d of pick.candidates) {
    const row = _tvRow('', [_tvName(d), _tvText('mt', _tvRes(d))], () => _tvGoLive(d));
    row.title = _tvScreenLabel(d);
    blk.append(row);
  }
  blk.append(_tvRow('', [_tvText('nm', t('A window I place myself'))], () => _tvGoLive(null)));
  menu.append(blk);
  return menu;
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

// ─── TV setup ────────────────────────────────────────────────────────────────

function _tvSetupOpen() {
  if (_tvSetup) return;
  _tvClose();
  _tvSetup = true;
  _tvSetupDd = false;
  _tvSetupBusy = false;
  const veil = _tvMake('div', 'tvs');
  veil.id = 'tv-setup';
  veil.style.right = _tvEl('dock-rail').getBoundingClientRect().width + 'px';
  veil.addEventListener('mousedown', e => { if (e.target === veil) _tvSetupClose(); });
  document.body.append(veil);
  tvRefresh();
  if (!veil.querySelector('.sm-win')) _tvSetupRender();
}

// Closing shrinks the window into the ··· button, which glows for a moment.
function _tvSetupClose(then) {
  if (!_tvSetup || _tvSetupBusy) return;
  _tvSetupBusy = true;
  _tvSetupSeen = true;
  _tvSetupDd = false;
  const veil = _tvEl('tv-setup');
  const win = veil && veil.querySelector('.sm-win');
  const more = document.querySelector('#tv-ui [data-tv-more]');
  const finish = () => {
    if (veil) veil.remove();
    _tvSetup = false;
    _tvSetupBusy = false;
    if (then) then();
    _tvHot = true;
    tvRefresh();
    setTimeout(() => { _tvHot = false; tvRefresh(); }, 900);
  };
  if (!win || !more) { finish(); return; }
  const a = win.getBoundingClientRect(), b = more.getBoundingClientRect(), z = _uiZoom();
  const dx = (b.left + b.width / 2 - (a.left + a.width / 2)) / z, dy = (b.top + b.height / 2 - (a.top + a.height / 2)) / z;
  win.classList.add('fly');
  win.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.06)';
  veil.style.background = 'transparent';
  setTimeout(finish, 450);
}

function _tvSetupGo() {
  _tvSetupClose(() => _tvGoSelected(_tvSelected()));
}

function _tvSeg(a, b, on, pick) {
  const seg = _tvMake('div', 'cp-tabs');
  for (const [label, val] of [[a, false], [b, true]]) {
    seg.append(_tvBtn('cp-segtab' + (on === val ? ' active' : ''), '', [document.createTextNode(label)], () => pick(val)));
  }
  return seg;
}

// A picture of the open map as the TV draws it with this turn. The tile is the TV's own 16:9 box and
// the seat turns it, so a side chair sees the TV the way it sits in the room.
function _tvTilePicture(scope, turn, w, h) {
  const c = document.createElement('canvas');
  c.width = w * 2; c.height = h * 2;
  c.className = 'tvp';
  c.style.rotate = seatTurn + 'deg';
  if (!scope.mapOffscreen || !scope.mapWidth || !scope.mapHeight) return c;
  const ctx = c.getContext('2d');
  const side = turn % 180 !== 0;
  const k = Math.min((side ? c.height : c.width) / scope.mapWidth, (side ? c.width : c.height) / scope.mapHeight);
  const mw = Math.max(1, Math.round(scope.mapWidth * k)), mh = Math.max(1, Math.round(scope.mapHeight * k));
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(turn * Math.PI / 180);
  ctx.drawImage(scope.mapOffscreen, -mw / 2, -mh / 2, mw, mh);
  if (scope.fogBlurCanvas && scope.fogBlurCanvas.width > 0) {
    const f = document.createElement('canvas');
    f.width = mw; f.height = mh;
    const fc = f.getContext('2d');
    fc.drawImage(scope.fogBlurCanvas, 0, 0, mw, mh);
    fc.globalCompositeOperation = 'source-in';
    fc.fillStyle = scope.fogBaseColor;
    fc.fillRect(0, 0, mw, mh);
    ctx.globalAlpha = 0.95;
    ctx.drawImage(f, -mw / 2, -mh / 2);
  }
  return c;
}

function _tvTurnRow() {
  const s = paneScope();
  const cur = fitTile(s.tvFit);
  const sideSeat = seatTurn % 180 !== 0;
  const row = _tvMake('div', 'tv-turn' + (sideSeat ? ' side' : ''));
  for (let i = 0; i < 3; i++) {
    const b = _tvBtn(i === cur ? 'on' : '', '', [_tvTilePicture(s, fitForTile(i).turn, sideSeat ? 107 : 102, sideSeat ? 60 : 57)], () => {
      setSceneFit(i);
      _tvSetupRender();
      // A column answers a message later; its state is read again once it has.
      if (panesActive) setTimeout(() => { if (_tvSetup) _tvSetupRender(); }, 150);
    });
    b.setAttribute('data-tv-turn', i);
    row.append(b);
  }
  return row;
}

function _tvSetupRender() {
  const veil = _tvEl('tv-setup');
  if (!veil) return;
  const live = _tvLive();
  const sel = _tvSelected();
  const sub = text => _tvText('sm-sub', text);
  const win = _tvMake('div', 'sm-win w-s');
  // The pop-in plays once, when the window first appears, not on each rebuild of its parts.
  if (veil.querySelector('.sm-win')) win.style.animation = 'none';
  const x = _tvBtn('sm-x', t('Close'), [], () => _tvSetupClose());
  x.innerHTML = uiIcon('x');
  win.append(_tvMake('div', 'sm-whead', [_tvText('sm-wtitle', t('TV setup')), _tvMake('span', 'sm-sp'), x]));
  win.addEventListener('mousedown', e => {
    const dd = _tvEl('tb-dd');
    if (_tvSetupDd && dd && !e.target.closest('.ddw')) { _tvSetupDd = false; dd.remove(); }
  });

  const body = _tvMake('div', 'sm-wbody');
  body.append(sub(t('Screen')));
  const label = sel.kind === 'win' ? t('A window') : sel.kind === 'display' ? _tvScreenLabel(sel.display)
    : _tvPickNow().kind === 'ask' ? t('Pick a screen') : t('No TV found');
  const name = _tvText('', label);
  if (sel.kind === 'display') name.setAttribute('data-no-i18n', '');
  const kids = [name];
  if (sel.kind === 'display') kids.push(_tvText('sm-dim', _tvRes(sel.display)));
  kids.push(_tvMake('span', 'sm-sp'), _tvMake('span', 'sm-chev'));
  const ddw = _tvMake('div', 'ddw');
  const trigger = _tvBtn('sm-hbtn dd', '', kids, () => { _tvSetupDd = !_tvSetupDd; _tvSetupRender(); });
  trigger.setAttribute('data-tv-screen', '');
  ddw.append(trigger);
  if (_tvSetupDd) {
    const list = _tvMake('div');
    list.id = 'tb-dd';
    const item = (on, nm, mt, go) => {
      list.append(_tvBtn('dd-it', '', [_tvText('ck', on ? '✓' : ''), nm, _tvText('ky', mt)], () => {
        _tvSetupDd = false;
        go();
        _tvSetupRender();
      }));
    };
    for (const d of _tvPickNow().candidates) {
      item(sel.kind === 'display' && sel.display.id === d.id, _tvName(d), _tvRes(d), () => (live ? _tvGoLive(d) : (_tvScreenPick = d.id)));
    }
    item(sel.kind === 'win', _tvText('nm', t('A window')), '', () => (live ? _tvGoLive(null) : (_tvScreenPick = 'window')));
    ddw.append(list);
  }
  body.append(ddw);

  if (sel.kind === 'win') {
    body.append(sub(t('Fullscreen')));
    const on = live ? !!paneScope().playerIsFullscreen : _tvWantFull;
    body.append(_tvSeg(t('Off'), t('On'), on, v => {
      if (live) { if (v !== on) _tvLegacy('btn-fullscreen-player'); } else _tvWantFull = v;
      _tvSetupRender();
    }));
  }

  body.append(sub(t('Updates')));
  body.append(_tvSeg(t('Auto'), t('Manual'), !autoSync, v => {
    if (autoSync === v) _tvLegacy('btn-auto-sync');
    _tvSetupRender();
  }));

  body.append(sub(t('Turn')), _tvTurnRow());
  const note = _tvMake('p', 'tvs-note');
  const parts = t('You can open this again with {more} on the minimap.').split('{more}');
  const more = _tvMake('span', 'kmore');
  more.innerHTML = TV_ICON.more;
  note.append(document.createTextNode(parts[0]), more, document.createTextNode(parts[1] || ''));
  body.append(note);
  win.append(body);

  const foot = _tvMake('div', 'sm-wfoot');
  if (live) foot.append(_tvBtn('sm-hbtn primary', '', [document.createTextNode(t('Done'))], () => _tvSetupClose()));
  else {
    foot.append(_tvBtn('sm-hbtn', '', [document.createTextNode(t('Cancel'))], () => _tvSetupClose()),
      _tvBtn('sm-hbtn primary', '', [_tvIcon(TV_ICON.tv), document.createTextNode(t('Show on TV'))], _tvSetupGo));
  }
  win.append(foot);

  const old = veil.querySelector('.sm-win');
  if (old) old.replaceWith(win); else veil.append(win);
}

// ─── The picture's controls ──────────────────────────────────────────────────

function _tvTools(live) {
  const tl = _tvMake('div', 'tv-row tl tv-tools');
  tl.append(_tvBtn('tv-ov sq' + (minimapLocked ? ' active' : ''),
    minimapLocked ? t('Minimap locked. Click to unlock') : t("Lock the minimap so a stray drag can't move the view"),
    [_tvIcon(TV_ICON.lock)], () => _tvLegacy('btn-minimap-lock')));
  const tr = _tvMake('div', 'tv-row tr tv-tools');
  if (live) {
    const word = _tvSyncIcon ? [] : [document.createTextNode(t('Sync'))];
    tr.append(_tvBtn(_tvSyncIcon ? 'tv-ov sq' : 'tv-ov wd', t('Match the TV to my view'), [_tvIcon(TV_ICON.sync)].concat(word),
      () => _tvLegacy('btn-sync-view')));
  }
  const more = _tvBtn('tv-ov sq' + (_tvHot ? ' hot' : '') + (_tvSetup ? ' active' : ''), t('TV setup'), [_tvIcon(TV_ICON.more)], _tvSetupOpen);
  more.setAttribute('data-tv-more', '');
  tr.append(more);
  return [tl, tr];
}

function _tvCaption(pick) {
  const sel = _tvSelected();
  if (sel.kind === 'win') return t('A window');
  if (sel.kind === 'display') return _tvScreenLabel(sel.display);
  return pick.kind === 'ask' ? t('Pick a screen') : t('No TV found');
}

function _tvCta(pick) {
  const cta = _tvMake('div', 'tv-cta');
  const cap = _tvCaption(pick);
  const label = _tvText('nm', cap);
  if (_tvSelected().kind === 'display') label.setAttribute('data-no-i18n', '');
  const sub = _tvBtn('tv-sub', cap, [label, _tvText('car', '▼')], _tvSetupOpen);
  const go = _tvBtn('tv-go' + (pick.kind === 'none' ? ' none' : '') + (_tvGoFit >= 3 ? ' small' : ''), '',
    (_tvGoFit >= 1 ? [] : [_tvIcon(TV_ICON.tv)]).concat(document.createTextNode(_tvGoFit >= 2 && I18N_LANG === 'ru' ? t('Show on TV short') : t('Show on TV'))), _tvShow);
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
     _tvMake('span', 'ac', [_tvIcon(TV_ICON.stop)].concat(_tvFit >= 4 ? [] : [document.createTextNode(stop)]))], _tvStop);
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
  // ⚠ scrollWidth stops inside the outline, so the outline's own width is added back.
  return !!grp && grp.scrollWidth + grp.offsetWidth - grp.clientWidth > _tvEl('minimap-panel').offsetWidth - 14;
}

// Rebuilds only when something it shows has changed, so a button is never replaced between the
// press and the release of a click. The words drop in steps until each row fits: Sync before it
// touches Lock, the pill's words, then Show on TV's icon, its long label, its size.
function tvRefresh() {
  if (!_tvInited) return;
  const panel = _tvEl('minimap-panel');
  const live = _tvLive();
  const pick = _tvPickNow();
  const sel = _tvSelected();
  minimapSetShape(live ? null : (sel.kind === 'display' ? { w: sel.display.size.width, h: sel.display.size.height } : null));
  if (live) hintClose('show-on-tv');
  panel.classList.toggle('tv-live', live);
  panel.classList.toggle('tv-off', !live);
  panel.classList.toggle('minimap-locked', minimapLocked);
  const base = [live, !!_tvWaitSince, _tvRoute, live ? '' : _tvCaption(pick), autoSync, paneScope().playerUnsent, minimapLocked,
    live && !!paneScope().playerIsFullscreen, _tvNote, _tvMenu, panel.offsetWidth, _tvScreenId, _tvDisplays.map(d => d.id).join(','),
    pick.kind, _tvSetup, _tvHot, I18N_LANG, seatTurn].join('|');
  if (base === _tvKey) return;
  _tvFit = 0; _tvSyncIcon = false; _tvGoFit = 0;
  _tvKey = base;
  const ui = _tvEl('tv-ui');
  for (;;) {
    ui.textContent = '';
    if (_tvWaitSince && !live) ui.append(_tvWait());
    else if (live) ui.append(..._tvTools(true), _tvPill());
    else ui.append(..._tvTools(false), _tvCta(pick));
    if (_tvNote) ui.append(_tvText('tv-note', _tvNote));
    if (_tvWaitSince && !live) break;
    if (!live) {
      const go = ui.querySelector('.tv-go');
      if (go && _tvGoFit < 3 && go.offsetWidth > panel.offsetWidth - 24) { _tvGoFit++; continue; }
      break;
    }
    const l = ui.querySelector('.tv-row.tl').getBoundingClientRect(), r = ui.querySelector('.tv-row.tr').getBoundingClientRect();
    if (!_tvSyncIcon && l.right + 4 > r.left) { _tvSyncIcon = true; continue; }
    if (_tvTooWide() && _tvFit < 4) { _tvFit++; continue; }
    break;
  }
  if (_tvSetup && !_tvSetupBusy) _tvSetupRender();
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
  // Captured, so Esc ends the window and does not also drop the room the DM had picked.
  document.addEventListener('keydown', e => {
    if (e.code !== 'Escape' || !_tvSetup) return;
    e.preventDefault();
    e.stopPropagation();
    if (_tvSetupDd) { _tvSetupDd = false; _tvSetupRender(); } else _tvSetupClose();
  }, true);
  new ResizeObserver(tvRefresh).observe(_tvEl('minimap-panel'));
  if (window.electronAPI && window.electronAPI.onDisplaysChanged) window.electronAPI.onDisplaysChanged(_tvOnDisplays);
  setInterval(_tvTick, 1000);
  _tvLoadDisplays().then(tvRefresh);
  tvRefresh();
}
