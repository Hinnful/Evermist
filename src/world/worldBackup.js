'use strict';
// worldBackup.js — Export and Restore in Settings' World map section. Export saves the scenes picked on
// the map, or everything when none is picked, in the library's own backup (backup.js); Restore takes a
// .zip from a picker, or dropped on the world map.

function _wbkIds() { return worldMapOpen ? worldMapPicked() : []; }

function _wbkScenes() { return allScenes.map(s => ({ id: s.id, group: sanitizeGroupName(s.group) })); }

// The button wears what a click saves, and the line says what that holds.
function worldBackupSync() {
  const btn = document.getElementById('wm-bk-export'), line = document.getElementById('wm-bk-line');
  if (!btn || !line) return;
  const ids = _wbkIds(), c = wpCounts(ids, _wbkScenes(), worldPlacesExport(), worldRoadsExport());
  btn.textContent = ids.length ? t.plural(ids.length, 'Export {n} scene', 'Export {n} scenes') : t('Export everything');
  btn.disabled = !allScenes.length;
  const parts = [t.plural(c.scenes, '{n} scene', '{n} scenes')];
  if (c.places) parts.push(t.plural(c.places, '{n} place', '{n} places'));
  if (c.roads) parts.push(t.plural(c.roads, '{n} road', '{n} roads'));
  line.textContent = allScenes.length
    ? t('A backup would hold {what}, with their notes.', { what: parts.join(', ') })
    : t('Nothing to back up yet.');
}

// `ids` is a pick, or empty for the whole world. A pick that is every scene is the whole world too.
function worldBackupExport(ids) {
  const all = allScenes.map(s => s.id), pick = ids && ids.length ? ids : all;
  doExport(pick, { partial: pick.length < all.length });
}

// A dropped file counts only when it could be a backup: drag events do not show a name, so an unnamed
// type passes and the restore itself refuses what is not a zip.
function _wbkMayBeZip(e) {
  const items = Array.from((e.dataTransfer && e.dataTransfer.items) || []);
  return items.length === 1 && items[0].kind === 'file' && (!items[0].type || /zip/.test(items[0].type));
}

function worldBackupInit() {
  const file = document.getElementById('wm-bk-file');
  document.getElementById('wm-bk-export').addEventListener('click', () => worldBackupExport(_wbkIds()));
  document.getElementById('wm-bk-restore').addEventListener('click', () => file.click());
  file.addEventListener('change', () => { const f = file.files && file.files[0]; file.value = ''; if (f) restorePickedZip(f); });
  document.addEventListener('dockpane', e => { if (e.detail === 'settings') worldBackupSync(); });

  const veil = document.createElement('div');
  veil.id = 'wm-dropveil';
  veil.textContent = t('Drop to restore this backup');
  _wm.appendChild(veil);
  _wm.addEventListener('dragover', e => {
    if (!_wbkMayBeZip(e)) return;
    e.preventDefault();
    _wm.classList.add('bkdrop');
  });
  _wm.addEventListener('dragleave', e => { if (!_wm.contains(e.relatedTarget)) _wm.classList.remove('bkdrop'); });
  _wm.addEventListener('drop', e => {
    _wm.classList.remove('bkdrop');
    if (!_wbkMayBeZip(e)) return;
    e.preventDefault();
    e.stopPropagation();
    restorePickedZip(e.dataTransfer.files[0]);
  });
  worldBackupSync();
}
