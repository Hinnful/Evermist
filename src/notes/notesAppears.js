'use strict';
// notesAppears.js — the "Appears in" list that ends every note in the Notes window: the notes that mention the one
// shown, with a count. Folded or open is remembered with the window (notesWindow.js). The list is rebuilt only when
// what it shows changed, since a pointer move repaints the window a lot.
//
// ⚠ EVERY NAME REACHES THE DOM THROUGH textContent.

let _naSig = '';

function _naEl() { return document.getElementById('nw-appears'); }

function _naRow(r) {
  const row = document.createElement('div'), small = document.createElement('small');
  row.className = 'ap';
  row.dataset.key = r.key;
  row.dataset.noI18n = '';
  row.append(r.name);
  small.textContent = t(r.word) + (r.where ? ' · ' + r.where : '');
  row.append(small);
  return row;
}

// `m` is the shown note's meta (notesPanel.js _npMeta).
function naSync(m) {
  const box = _naEl();
  if (!box) return;
  const shut = nwAppearsShut(), reading = searchReading();
  const sig = m.key + '|' + mxRev() + '|' + (reading ? 1 : 0) + '|' + (shut ? 1 : 0) + '|' + ntSig();
  if (sig === _naSig) return;
  _naSig = sig;
  const rows = mxAppearsIn(mxRefOf(m), m.key);
  box.hidden = false;
  box.textContent = '';
  const head = document.createElement('div'), car = document.createElement('span'), n = document.createElement('span');
  head.className = 'aph';
  car.className = 'car';
  car.textContent = shut ? '▸' : '▾';
  n.className = 'n';
  n.textContent = String(rows.length);
  head.append(car, t('Appears in') + ' ', n);
  box.append(head);
  if (shut) return;
  rows.forEach(r => box.append(_naRow(r)));
  if (!rows.length && !reading) { const h = document.createElement('div'); h.className = 'hint'; h.textContent = t('No note mentions this yet.'); box.append(h); }
  if (reading) { const h = document.createElement('div'); h.className = 'hint'; h.textContent = t('Reading maps…'); box.append(h); }
}

function naInit() {
  const box = _naEl();
  if (!box) return;
  box.addEventListener('click', e => {
    const row = e.target.closest('.ap');
    if (row) { ntGoKey(row.dataset.key); return; }
    if (e.target.closest('.aph')) { nwSetAppearsShut(!nwAppearsShut()); _naSig = ''; refreshRoomPanel(); }
  });
}
