'use strict';
// syncSettings.js — Settings' Google Drive line: the status and how full the Drive is under the name, and one button,
// Connect or Disconnect; and the question before a computer's first sync. It tells trashPanel.js whether the Drive's
// Recently deleted joins the list. syncSettingsInit runs only where sync has a Google client, so without one the line
// stays hidden. The engine is sync.js; this only shows it and calls it.

let _ssSigned = null;     // signed in here, as the main process last said
let _ssKept = null;       // false where the sign-in is not remembered across restarts (no secure store)
let _ssTrashAt = -1;      // the last sync Recently deleted was read after
let _ssSyncAt = -1;       // the last sync the Campaign map's kept pictures were read after
let _ssBusy = false;      // a button's call is running

const _ssEl = id => document.getElementById(id);
const _ssPaneOpen = () => !_ssEl('dock-pane-settings').hidden;

function _ssWhen(at) {
  const d = new Date(at), today = new Date().toDateString() === d.toDateString();
  const o = today ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
  return new Intl.DateTimeFormat(I18N_LANG, o).format(d);
}

function _ssStatus() {
  const st = syncEngine.status();
  if (st.state === 'signedOut') _ssSigned = false;
  const s = syStatusLine(st);
  const note = _ssKept === false && st.state !== 'syncing' ? ' ' + t('Sign-in is not remembered on this computer.') : '';
  const line = _ssEl('sy-line');
  line.textContent = t(s.text, Object.assign({}, s.vars, s.when ? { time: _ssWhen(s.when) } : {})) + note;
  // How full the Drive is, from 70%; the full Drive's own message says it already.
  const space = ['full', 'off', 'signedOut'].includes(st.state) ? null : syDriveSpace(st.space);
  if (space) {
    const dot = document.createElement('span'), pct = document.createElement('span');
    dot.className = 'dim';
    dot.textContent = ' · ';
    pct.className = 'sp ' + space.level;
    pct.textContent = t('{n}% full', { n: space.pct });
    line.append(dot, pct);
  }
  line.title = st.state === 'error' ? st.message : line.textContent;
  line.classList.toggle('on', st.state === 'idle' && !!st.last);
  const signed = _ssSigned !== false;
  _ssEl('sy-connect').hidden = signed;
  _ssEl('sy-disconnect').hidden = !signed;
  _ssEl('sy-connect').disabled = _ssEl('sy-disconnect').disabled = _ssBusy;
  trashPanelDrive(signed);
  if (signed && st.state !== 'syncing' && st.last !== _ssTrashAt) { _ssTrashAt = st.last; trashPanelRefresh(); }
}

// One button's call at a time; the list and the line catch up after it.
async function _ssRun(fn) {
  if (_ssBusy) return;
  _ssBusy = true;
  _ssStatus();
  try { await fn(); } catch (err) { console.error('[sync]', err); }
  _ssBusy = false;
  _ssTrashAt = -1;
  _ssStatus();
}

async function _ssConnect() {
  let r;
  try { r = await syncEngine.connect(); } catch (err) { r = { ok: false, code: err.code }; }
  if (r.ok) { _ssSigned = true; if (r.first) _ssAskFirst(r.first); return; }
  const say = { denied: 'The sign-in was cancelled in the browser.', timeout: 'The sign-in in the browser took too long. Try again.' };
  messageDialog({ title: 'Could not connect to Google', message: t(say[r.code] || 'Check the network and try again.') });
}

// Before this computer's first sync: what each side holds, and that the merge deletes nothing. Cancel signs out again.
function _ssAskFirst(c) {
  const parts = [c.here ? t.plural(c.here, 'This computer holds one map.', 'This computer holds {n} maps.') : t('This computer holds no maps yet.')];
  if (c.maps) parts.push(t.plural(c.maps, 'Your Google Drive holds one map.', 'Your Google Drive holds {n} maps.'), t.plural(c.computers, 'Sent from one other computer.', 'Sent from {n} other computers.'));
  else parts.push(t('Your Google Drive holds no Evermist maps yet.'));
  parts.push(t('They will be merged: every map ends up on every computer, and nothing is deleted.'));
  confirmDialog({
    title: 'Start syncing this computer?',
    message: parts.join(' '),
    confirmLabel: 'Start syncing',
    onConfirm: () => _ssRun(() => syncEngine.confirmFirst()),
    onCancel: () => _ssRun(async () => { await syncEngine.cancelFirst(); _ssSigned = false; }),
  });
}

// After every sync, whatever is open: a sync may have replaced a map picture the Campaign map's menu offers back.
function _ssAfterSync() {
  const st = syncEngine.status();
  if (st.state === 'syncing' || st.last === _ssSyncAt) return;
  _ssSyncAt = st.last;
  worldMapKeptRefresh();
}

async function syncSettingsInit() {
  _ssEl('sy-group').hidden = false;
  try { _ssSigned = await syncEngine.signedIn(); } catch (_) { _ssSigned = null; }
  try { _ssKept = await syncEngine.remembered(); } catch (_) { _ssKept = null; }
  _ssEl('sy-connect').addEventListener('click', () => _ssRun(_ssConnect));
  _ssEl('sy-disconnect').addEventListener('click', () => _ssRun(async () => { await syncEngine.disconnect(); _ssSigned = false; }));
  document.addEventListener('dockpane', e => { if (e.detail === 'settings') { _ssTrashAt = -1; _ssStatus(); } });
  setInterval(() => { _ssAfterSync(); if (_ssPaneOpen()) _ssStatus(); }, 1000);
  if (_ssPaneOpen()) _ssStatus();
}
