'use strict';
// notesAppears.js — the "Appears in" list that ends every note in the Notes window: the notes that mention the one
// shown, with a count. Folded or open is remembered with the window (notesWindow.js). The list is rebuilt only when
// what it shows changed, since a pointer move repaints the window a lot. The Bestiary page's list (bestiaryPage.js)
// is built from the same rows, and a row opens through neOpen.
//
// ⚠ EVERY NAME REACHES THE DOM THROUGH textContent.

let _naSig = '';

function _naEl() { return document.getElementById('nw-appears'); }

function _naRow(r) {
  const row = document.createElement('div'), small = document.createElement('small');
  row.className = 'ap';
  row.dataset.key = r.key;
  row.dataset.target = JSON.stringify(r.target);
  row.dataset.noI18n = '';
  const name = document.createElement('span');
  name.textContent = r.name;
  row.append(name);
  small.textContent = t(r.word) + (r.where ? ', ' + r.where : '');
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
  const head = document.createElement('div'), car = document.createElement('span'), label = document.createElement('span'), n = document.createElement('span');
  head.className = 'aph';
  car.className = 'car sm-chev' + (shut ? ' shut' : '');
  n.className = 'n';
  n.textContent = String(rows.length);
  label.textContent = t('Appears in');
  head.append(car, label, n);
  box.append(head);
  if (shut) return;
  naFill(box, rows, reading);
}

// The rows of an "Appears in" list put into `box`, or the line that says there are none (yet).
function naFill(box, rows, reading) {
  rows.forEach(r => box.append(_naRow(r)));
  const hint = !rows.length && !reading ? 'No note mentions this yet.' : reading ? 'Reading maps…' : '';
  if (hint) { const h = document.createElement('div'); h.className = 'hint'; h.textContent = t(hint); box.append(h); }
}

// A row clicked in either list: true when `e` landed on one.
function naClick(e) {
  const row = e.target.closest('.ap');
  if (row) neOpen(row.dataset.key, JSON.parse(row.dataset.target));
  return !!row;
}

function naInit() {
  const box = _naEl();
  if (!box) return;
  box.addEventListener('click', e => {
    if (naClick(e)) return;
    if (e.target.closest('.aph')) { nwSetAppearsShut(!nwAppearsShut()); _naSig = ''; refreshRoomPanel(); }
  });
}
