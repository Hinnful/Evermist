'use strict';
// trashPanel.js — Campaign's Trash line and its pop-out: this computer's maps, tracks, sounds and pictures
// (sceneTrash.js), plus, while sync is signed in, the ones only the Drive holds (syncEngine.trash()). Each row: name,
// days left, Restore; then Empty now, which asks first. Works with no Google client.

let _tpReady = false;
let _tpDrive = false;     // sync signed in here (syncSettings.js says): Drive entries join, Empty now reaches every computer
let _tpBusy = false;
let _tpGen = 0;           // a refresh that a newer one overtook draws nothing

const _tpEl = id => document.getElementById(id);

function trashPanelDrive(on) {
  if (on === _tpDrive) return;
  _tpDrive = on;
  trashPanelRefresh();
}

function _tpRow(item) {
  const row = document.createElement('div');
  row.className = 'dk-trash-row';
  row.innerHTML = '<span class="dk-int-tx"><span class="nm"></span><span class="mt"></span></span><button class="dk-intbtn"></button>';
  row.querySelector('.nm').textContent = item.name || t('Unnamed map');
  row.querySelector('.mt').textContent = t.plural(trashDaysLeft(item.at, Date.now()), '{n} day left', '{n} days left');
  const back = row.querySelector('button');
  back.textContent = t('Restore');
  back.dataset.restore = item.id;
  back.addEventListener('click', () => _tpRun(() => _tpRestore(item)));
  return row;
}

// This computer's copy, so Restore works offline and nothing is downloaded. ⚠ THE DELETION RECORD IS MARKED RESTORED
// FIRST, wherever sync has run here: a tick between the copy coming back and the mark would drop the map again. The
// tick after it tells the other computers. A row only the Drive holds comes back from it.
async function _tpRestore(item) {
  if (!item.local) { await syncEngine.restore(item.id); return; }
  const synced = syncIndex.isOn(), kind = trashKindOf(item.id);
  // Each comes back as an edit made now, which the next tick carries to every computer.
  if (kind === 'picture' || kind === 'builtin') {
    await (kind === 'picture' ? sceneTrash.restorePicture(item.id) : sceneTrash.restoreBuiltin(item.id));
    if (synced) syncEngine.now().catch(() => {});
    return;
  }
  if (kind === 'track') {
    const back = () => sceneTrash.restoreTrack(item.id);
    const folder = item.kind === 'sounds' ? syncSounds : syncMusic;
    if (synced) { await folder.restoreHere(item.hash, back); syncEngine.now().catch(() => {}); } else await back();
    return;
  }
  if (synced) await syncEngine.markRestored(item.id);
  await sceneTrash.restore(item.id);
  if (synced) syncEngine.now().catch(() => {});
}

// A map another computer emptied from the Drive leaves this computer's trash too. The index opens after sign-in.
async function _tpDrivePurged() {
  if (!syncIndex.isOn()) return;
  for (const g of await syncIndex.goneRecords()) if (g.purged) await sceneTrash.purge(g.id);
}

async function trashPanelRefresh() {
  if (!_tpReady) return;
  const gen = ++_tpGen;
  let drive = [];
  if (_tpDrive) {
    try { await _tpDrivePurged(); } catch (err) { console.error('[trash]', err); }
    try { drive = await syncEngine.trash(); } catch (_) { drive = null; }
  }
  let local = [];
  try { local = await sceneTrash.list(); } catch (err) { console.error('[trash]', err); }
  if (gen !== _tpGen) return;
  const list = trashRows(local, drive);
  _tpEl('sy-trash').replaceChildren(...list.map(_tpRow));
  const open = _tpEl('sy-trash-open');
  open.disabled = _tpEl('sy-empty').disabled = !list.length;
  _tpEl('sy-empty').title = t(_tpDrive ? 'Delete everything in the Trash for good, on every computer.' : 'Delete everything in the Trash for good.');
  _tpEl('sy-trash-count').textContent = list.length ? String(list.length) : t(drive === null ? 'Offline' : 'Empty');
  if (open.disabled && open.classList.contains('open')) dockClosePop();
}

// One button's call at a time; the list catches up after it.
async function _tpRun(fn) {
  if (_tpBusy) return;
  _tpBusy = true;
  try { await fn(); } catch (err) { console.error('[trash]', err); }
  _tpBusy = false;
  trashPanelRefresh();
}

function _tpEmpty() {
  if (!_tpEl('sy-trash').children.length) return;
  confirmDialog({
    title: 'Empty the Trash?',
    message: _tpDrive
      ? 'Everything in the Trash is deleted for good, on every computer. This cannot be undone.'
      : 'Everything in the Trash is deleted for good. This cannot be undone.',
    confirmLabel: 'Empty now', danger: true,
    onConfirm: () => _tpRun(async () => { await sceneTrash.emptyAll(); if (_tpDrive) await syncEngine.emptyNow(); }),
  });
}

function trashPanelInit() {
  if (isPlayer || isPane) return;
  _tpReady = true;
  _tpEl('sy-trash-open').hidden = false;
  _tpEl('sy-empty').addEventListener('click', _tpEmpty);
  document.addEventListener('dockpane', e => { if (e.detail === 'settings') trashPanelRefresh(); });
  trashPanelRefresh();
}
