'use strict';
// syncSettings.js — Settings' Google Drive line: the status under the name and one button, Connect or Disconnect;
// Campaign's Recently deleted line and its pop-out, with Restore per map and Empty now; and the question before a
// computer's first sync. syncSettingsInit runs only where sync has a Google client, so without one both lines stay
// hidden. The engine is sync.js; this only shows it and calls it.

let _ssSigned = null;     // signed in here, as the main process last said
let _ssKept = null;       // false where the sign-in is not remembered across restarts (no secure store)
let _ssTrashAt = -1;      // the last sync the Recently deleted list was read after
let _ssSyncAt = -1;       // the last sync the Campaign map's kept pictures were read after
let _ssBusy = false;      // a button's call is running

const _ssEl = id => document.getElementById(id);
const _ssPaneOpen = () => !_ssEl('dock-pane-settings').hidden;

function _ssWhen(at, withTime) {
  const d = new Date(at), today = new Date().toDateString() === d.toDateString();
  const o = withTime ? (today ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : { day: 'numeric', month: 'short' };
  return new Intl.DateTimeFormat(I18N_LANG, o).format(d);
}

function _ssStatus() {
  const st = syncEngine.status();
  if (st.state === 'signedOut') _ssSigned = false;
  const s = syStatusLine(st);
  const note = _ssKept === false && st.state !== 'syncing' ? ' ' + t('Sign-in is not remembered on this computer.') : '';
  const line = _ssEl('sy-line');
  line.textContent = t(s.text, Object.assign({}, s.vars, s.when ? { time: _ssWhen(s.when, true) } : {})) + note;
  line.title = st.state === 'error' ? st.message : line.textContent;
  line.classList.toggle('on', st.state === 'idle' && !!st.last);
  const signed = _ssSigned !== false;
  _ssEl('sy-connect').hidden = signed;
  _ssEl('sy-disconnect').hidden = !signed;
  _ssEl('sy-connect').disabled = _ssEl('sy-disconnect').disabled = _ssBusy;
  _ssEl('sy-trash-open').hidden = !signed;
  if (!signed && _ssEl('sy-trash-open').classList.contains('open')) dockClosePop();
  if (signed && st.state !== 'syncing' && st.last !== _ssTrashAt) { _ssTrashAt = st.last; _ssTrash(); }
}

function _ssRow(item) {
  const row = document.createElement('div');
  row.className = 'dk-trash-row';
  row.innerHTML = '<span class="dk-int-tx"><span class="nm"></span><span class="mt"></span></span><button class="dk-intbtn"></button>';
  row.querySelector('.nm').textContent = item.name || t('Unnamed map');
  row.querySelector('.mt').textContent = _ssWhen(item.at, false);
  const back = row.querySelector('button');
  back.textContent = t('Restore');
  back.dataset.restore = item.id;
  back.addEventListener('click', () => _ssRun(() => syncEngine.restore(item.id)));
  return row;
}

// Signed in, the line reads the count, "Empty", or "Offline" while the Drive cannot be read; only a count opens it.
async function _ssTrash() {
  let list = null;
  try { list = await syncEngine.trash(); } catch (_) { list = null; }
  _ssEl('sy-trash').replaceChildren(...(list || []).map(_ssRow));
  _ssEl('sy-empty').disabled = !list || !list.length;
  const open = _ssEl('sy-trash-open');
  open.disabled = !list || !list.length;
  _ssEl('sy-trash-count').textContent = !list ? t('Offline') : list.length ? String(list.length) : t('Empty');
  if (open.disabled && open.classList.contains('open')) dockClosePop();
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

function _ssEmpty() {
  const n = _ssEl('sy-trash').children.length;
  if (!n) return;
  confirmDialog({
    title: 'Empty Recently deleted?',
    message: t.plural(n, 'One map is deleted for good, on every computer. This cannot be undone.', '{n} maps are deleted for good, on every computer. This cannot be undone.'),
    confirmLabel: 'Empty now', danger: true,
    onConfirm: () => _ssRun(() => syncEngine.emptyNow()),
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
  _ssEl('sy-empty').addEventListener('click', _ssEmpty);
  document.addEventListener('dockpane', e => { if (e.detail === 'settings') { _ssTrashAt = -1; _ssStatus(); } });
  setInterval(() => { _ssAfterSync(); if (_ssPaneOpen()) _ssStatus(); }, 1000);
  if (_ssPaneOpen()) _ssStatus();
}
