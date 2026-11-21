'use strict';
// bestiaryCopy.js — a fight row's copy of its stat block, shown as a page in the Bestiary window. It reads as an
// entry's page, says it is the fight's copy and how it differs from its entry, saves to the Bestiary as a new entry,
// and its book opens the entry. The stat fields are the row's own copy; "Your notes" are the entry's.

let _bcSavedRow = null;   // the row whose copy was just saved, until its next edit

function bcRowId() { return bs.copy; }
function bcRow() { return bs.copy === null ? null : cbState.rows.find(r => r.id === bs.copy) || null; }
function _bcEntry(row) { return combatEntryOf(cbState.blocks, row && row.sb); }

// The row's book button and menu item: beside the table with the list hidden, or where the window already is.
function bcOpen(row) {
  hintClose('stat-block');
  cbRowBlock(row);
  if (!bestiarySetOpen(true, true)) return;
  bcShow(row.id);
}

function bcShow(rowId) {
  if (!cbState.rows.some(r => r.id === rowId)) return false;
  if (bs.copy !== rowId) bs.editing = false;
  bs.copy = rowId;
  bs.open = null;
  bswRecord('c:' + rowId);
  _bsRenderPage();
  cbRender();
  return true;
}

// A row deleted, a fight switched or the table closed: that copy's page goes, and so does its place in the history.
// Without an id every copy goes. A window the fight opened shuts with its page.
function bcClose(rowId) {
  const all = rowId === undefined;
  for (const r of cbState.rows) if (all || r.id === rowId) bswForget('c:' + r.id);
  if (bs.copy === null || (!all && bs.copy !== rowId)) return;
  bs.copy = null;
  bs.editing = false;
  if (bswFromFight()) bestiarySetOpen(false); else _bsRenderPage();
  cbRender();
}

// An edit in the table reaches the page: a field being edited follows in place, a read page redraws.
function bcRowEdited(row, field) {
  if (bs.copy !== row.id) return;
  _bcSavedRow = null;
  if (!bs.editing) { _bsRenderPage(); return; }
  const f = _bsEl('bs-page').querySelector(`[data-p="${field}"]`);
  if (f) f.textContent = row.sb[field];
  _bcHeadSync(row);
}

function bcRefresh(row) { if (bs.copy === row.id) _bsRenderPage(); }

function _bcStripHtml(row, e) {
  const d = combatCopyDiffs(row.sb, e), v = x => _cbEsc(x || '—');
  const say = [_cbEsc(t('The fight’s copy.'))];
  if (d.ac) say.push(`<b>${_cbEsc(t('AC'))} ${v(d.ac[0])}</b>, ${_cbEsc(t('the entry has {n}.', { n: d.ac[1] || '—' }))}`);
  if (d.hp) say.push(`<b>${_cbEsc(t('HP'))} ${v(d.hp[0])}</b>, ${_cbEsc(t('the entry has {n}.', { n: d.hp[1] || '—' }))}`);
  const saved = _bcSavedRow === row.id && !row.sbChanged;
  return `<span class="t" data-no-i18n>${say.join(' ')}</span><button class="sm-hbtn cb-save" data-save ${row.sbChanged ? '' : 'disabled'}>`
    + `<span data-no-i18n>${_cbEsc(t(saved ? 'Saved' : 'Save to Bestiary'))}</span></button>`;
}

function bcHtml(row) {
  const e = _bcEntry(row), name = `<h2 data-no-i18n>${_cbEsc(row.name)}</h2>`;
  const head = bs.editing
    ? `<div class="bs-page-head editing"><div class="t"><span class="bs-mode">Editing</span>${name}</div>
        <button class="sm-hbtn primary bs-done" data-c="edit">${BS_ICONS.done}<span>Done</span></button></div>`
    : `<div class="bs-page-head"><div class="t">${name}</div><div class="bs-tools">
        <button class="bs-ib" data-c="edit" title="Edit">${BS_ICONS.edit}</button>${
  e ? `<button class="bs-ib" data-c="book" title="Open the Bestiary entry">${uiIcon('book')}</button>` : ''}</div></div>`;
  return `${head}<div class="bc-strip">${_bcStripHtml(row, e)}</div><div class="bs-page-body">${bpHtml(cbRowBlock(row), bs.editing, !e, row.spent)}</div>`;
}

function bcMount(page, row) {
  page.innerHTML = bcHtml(row);
  const e = _bcEntry(row);
  if (e) bpMount(page, e);
}

function bcCrumbs(row) { const f = _cfOpen(); return [f ? _cfName(f) : '', row.name]; }

function _bcHeadSync(row) {
  const page = _bsEl('bs-page'), h = page.querySelector('.bs-page-head h2');
  if (h) h.textContent = row.name;
  page.querySelector('.bc-strip').innerHTML = _bcStripHtml(row, _bcEntry(row));
  bswCrumbs(bcCrumbs(row));
}

// An edit to a row's copy lights Save to Bestiary, and its name, AC and max HP are the row's too.
function _bcCopyEdited(row, field) {
  const sb = row.sb;
  if (field === 'name') {
    const n = (row.name.match(/\s+\d+$/) || [''])[0];
    row.name = sb.name.trim() + n;
  }
  if (field === 'ac') row.ac = combatFirstNum(sb.ac);
  row.sbChanged = true;
  _bcSavedRow = null;
  _bcHeadSync(row);
  // An action's text and DEX feed the row's pills and Init hint.
  if (field === 'name' || field === 'ac' || field === 'hp' || field === 'quick' || field === 'secs' || field === 'abil') cbRender();
}

// Add-only, as the popup's was; the copy then points at the new entry, so the strip and the book follow it.
function _bcSave(row) {
  const e = combatAddEntry(cbState.blocks, row.sb);
  row.sb.uid = e.uid;
  row.sbChanged = false;
  _bcSavedRow = row.id;
  cbSave();
  _bsRenderPage();
}

function bcInit(page) {
  cbWireEditor(page, {
    block: () => { const r = bcRow(); return r && cbRowBlock(r); },
    edited: f => { const r = bcRow(); if (r) _bcCopyEdited(r, f); },
    redraw: _bsRenderPage,
  });
  page.addEventListener('input', e => {
    const r = bcRow(), f = e.target.dataset;
    if (!r) return;
    if (f.lore !== undefined) { r.sb.lore = e.target.value; _bcCopyEdited(r, 'lore'); cbSaveSoon(); }
    const en = f.notes !== undefined && _bcEntry(r);
    if (en) { en.notes = neStoredText(e.target); mxBump(); cbSaveSoon(); }
  });
  // The notes are the entry's, one field with the Notes window's: read again on focus.
  page.addEventListener('focusin', e => {
    const r = bcRow(), en = r && e.target.dataset && e.target.dataset.notes !== undefined && _bcEntry(r);
    if (en && e.target.value !== (en.notes || '')) e.target.value = en.notes || '';
  });
  page.addEventListener('click', e => {
    const r = bcRow(), c = e.target.closest('[data-c]');
    if (!r) return;
    if (c && c.dataset.c === 'edit') { bs.editing = !bs.editing; _bsRenderPage(); return; }
    const en = c && c.dataset.c === 'book' && _bcEntry(r);
    if (en) { _bsShow(en.id); return; }
    if (e.target.closest('[data-save]')) _bcSave(r);
  });
}
