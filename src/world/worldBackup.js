'use strict';
// worldBackup.js — Export and Import in Settings' Campaign section. Export saves the scenes picked on
// the map, or everything when none is picked, to a .zip (backup.js); Import takes a .zip from a picker,
// or dropped on the world map (transferImport.js).

function _wbkIds() { return worldMapOpen ? worldMapPicked() : []; }

// The button wears what a click saves: the pick, or everything with none.
function worldBackupSync() {
  const btn = document.getElementById('wm-bk-export');
  if (!btn) return;
  const ids = _wbkIds();
  document.getElementById('wm-bk-export-label').textContent = ids.length ? t.plural(ids.length, 'Export {n} map', 'Export {n} maps') : t('Export');
  btn.disabled = !allScenes.length;
}

// `ids` is a pick, or empty for the whole world. A pick that is every scene is the whole world too.
function worldBackupExport(ids) {
  const all = allScenes.map(s => s.id), pick = ids && ids.length ? ids : all;
  doExport(pick, { partial: pick.length < all.length });
}

// A dropped file counts only when it could be an export: drag events do not show a name, so an unnamed
// type passes and the import itself refuses what is not a zip.
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
  veil.textContent = t('Drop to import this file');
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
