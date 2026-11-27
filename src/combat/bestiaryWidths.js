'use strict';
// bestiaryWidths.js — what the Bestiary window shows at its own width. Wide keeps the header's search and buttons,
// the filter row across the window and the columns; medium moves the search into the list's top, folds the filters into
// one button and turns New monster and Import into icons; narrow, or the list hidden, shows the page alone.

// In the window's own px. A page needs 300 beside a list, or its stat boxes scroll sideways.
const BSWD_WIDE = 860;
const BSWD_PAGE_MIN = 300;
let _bswdMode = 'wide';

function bswdMode() { return _bswdMode; }
function bswdPaged() { return !!bs.open || bs.copy !== null; }

// The list of a page wide enough for both: every column but Size beside a page, all of them alone.
function bswdCols() {
  if (_bswdMode !== 'wide') return BS_COLS.filter(c => c[0] === 'cr' || c[0] === 'name');
  return bswdPaged() ? BS_COLS.filter(c => c[0] !== 'size') : BS_COLS;
}

function _bswdMove(el, parent, before) {
  if (el.parentNode !== parent) parent.insertBefore(el, before || null);
}

// Answers whether the width class changed, so the table redraws its columns.
function bswdApply() {
  const p = _bsEl('bs-panel'), paged = bswdPaged(), w = p.offsetWidth;
  const mode = paged && (bswListHidden() || w - bswListWidth('medium') < BSWD_PAGE_MIN) ? 'narrow' : w >= BSWD_WIDE ? 'wide' : 'medium';
  const changed = mode !== _bswdMode;
  _bswdMode = mode;
  for (const m of ['wide', 'medium', 'narrow']) p.classList.toggle('w-' + m, m === mode);
  const list = _bsEl('bs-list'), table = _bsEl('bs-table'), wide = mode === 'wide';
  _bswdMove(_bsEl('bs-search').closest('label'), wide ? _bsEl('bs-hslot') : _bsEl('bs-ltop'), wide ? null : _bsEl('bs-ltop').firstChild);
  for (const el of [p.querySelector('.bs-filters'), _bsEl('bs-queue')]) _bswdMove(el, wide ? _bsEl('bs-top') : list, wide ? null : table);
  list.style.width = paged && mode !== 'narrow' ? bswListWidth(mode) + 'px' : '';
  const btn = _bsEl('bs-list-btn'), shown = mode !== 'narrow';
  btn.classList.toggle('on', shown);
  btn.disabled = !paged;
  btn.title = t(shown ? 'Hide the list' : 'Show the list');
  _bsEl('bs-fold').classList.toggle('on', bsFiltered(Object.assign({}, bs.f, { q: '' })));
  bpFitHead(_bsEl('bs-page'));
  return changed;
}

function bswdToggleList() {
  const shown = _bswdMode !== 'narrow';
  if (shown) bs.picked.clear();
  bswToggleList(_bswdMode, shown);
  bestiaryRender();
}

// The folded filters: the same buttons, More filters and Clear all, in one list under the button.
function _bswdFoldHtml() {
  return BS_FILTERS.filter(F => !F.more || bs.more).map(_bsFilterButton).join('')
    + `<button class="bs-link" data-a="more">${t(bs.more ? 'Fewer filters' : 'More filters')}</button>`
    + (bsFiltered(Object.assign({}, bs.f, { q: '' })) ? `<button class="bs-link" data-a="clear">${t('Clear all')}</button>` : '');
}

function bswdFoldPop(anchor) {
  const same = bs.pop && bs.pop.dataset.k === 'fold';
  _bsClosePop();
  if (same) return;
  const el = document.createElement('div');
  el.className = 'bs-pop bs-fold';
  el.dataset.k = 'fold';
  el.innerHTML = _bswdFoldHtml();
  el.addEventListener('click', e => {
    const f = e.target.closest('[data-filter]'), a = e.target.closest('[data-a]');
    if (f) { _bsFilterPop(anchor, f.dataset.filter); return; }
    if (a && a.dataset.a === 'more') bs.more = !bs.more;
    else if (a && a.dataset.a === 'clear') bs.f = Object.assign(bsNoFilter(), { q: bs.f.q });
    else return;
    el.innerHTML = _bswdFoldHtml();
    bestiaryRender();
  });
  _bsPlace(el, anchor);
}

function bswdInit() {
  _bsEl('bs-list-btn').addEventListener('click', bswdToggleList);
  _bsEl('bs-fold').addEventListener('click', e => bswdFoldPop(e.currentTarget));
}
