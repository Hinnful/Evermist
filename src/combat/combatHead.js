'use strict';
// combatHead.js — the fight table's header: the fight picker's slot, the search that adds a bestiary monster as an
// enemy, Clean up and close (combatSort.js and initiativeTv.js put their buttons before close); and the bestiary
// suggestions the search and a row's Name field share.

function cbHeadHtml() {
  return `<div class="cb-head" data-drag><span id="cb-fightslot"></span>
      <label class="sm-field cb-search">${uiIcon('search')}<input id="cb-search" placeholder="Add creature" spellcheck="false" autocomplete="off"></label>
      <span class="cb-sp"></span>
      <button class="sm-hbtn primary ic n" id="cb-clean" title="Clean up: move the defeated to the end" hidden>${uiIcon('broom', 15)}<span data-no-i18n></span></button>
      <button class="sm-x" id="cb-close" title="Close">${uiIcon('x')}</button></div>`;
}

function initCombatHead() {
  const input = document.getElementById('cb-search');
  input.addEventListener('input', () => _cbSearch(input));
  input.addEventListener('keydown', e => {
    if (_cbSuggestKey(e)) return;
    // With the list shut (Esc), Enter adds what the open list's first row would have.
    if (e.key === 'Enter') _cbSearch(input, true);
  });
  input.addEventListener('blur', _cbSuggestClose);
  document.getElementById('cb-clean').addEventListener('click', cbCleanUp);
  cbHeadRefresh();
}

// Clean up shows, with its count, only while defeated enemies are still in the list.
function cbHeadRefresh() {
  const b = document.getElementById('cb-clean');
  if (!b) return;
  const n = combatToClean(cbState.rows);
  b.hidden = !n;
  b.querySelector('span').textContent = String(n);
}

function cbCleanUp() {
  if (!combatCleanUp(cbState.rows)) return;
  cbSave();
  cbRender();
}

// ── The search: a bestiary monster, or a new creature by the typed name, added as an enemy above the Defeated line ──

function _cbSearch(input, addFirst) {
  const q = input.value.trim();
  if (!q) { _cbSuggestClose(); return; }
  const items = combatSearchBlocks(cbState.blocks, q).slice(0, 8).map(b => ({ label: b.name, src: b.source || '', entry: b }));
  items.push({ label: t('New creature'), src: q, isNew: true });
  const pick = i => {
    const it = items[i], r = { id: cbState.nextId++, init: '', name: '', hp: '', ac: '', conds: [], side: 'enemy', sbChanged: false };
    if (it.isNew) r.name = q; else combatPickInto(r, it.entry, cbState.rows);
    const before = cbState.rows.length;
    cbState.rows.splice(combatAddIndex(cbState.rows), 0, r);
    input.value = '';
    cbSave();
    cbRender();
    cbFightsTitle(); hintsFightRowAdded(before, r.id);
    const el = document.querySelector(`#cb-list .cb-row[data-id="${r.id}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
    input.focus();
  };
  if (addFirst) pick(0); else _cbSuggestOpen(input, items, 0, pick);
}

// ── The suggestion list ──────────────────────────────────────────────────────

let _cbSug = null;   // { items, at, el, pick }

function _cbSuggestOpen(input, items, at, pick) {
  _cbSuggestClose();
  if (!items.length) return;
  const el = document.createElement('div');
  el.className = 'cb-menu';
  el.id = 'cb-suggest';
  el.dataset.noI18n = ''; el.dataset.keepsFocus = '';
  el.innerHTML = items.map((b, i) => `<div data-i="${i}" class="${i === at ? 'on' : ''}${b.isNew ? ' new' : ''}">${b.isNew ? uiIcon('plus') : ''}<span class="lb">${_cbEsc(b.label)}</span><span class="src">${_cbEsc(b.src)}</span></div>`).join('');
  // mousedown, not click: the field's blur would close the list first.
  el.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    const d = e.target.closest('[data-i]');
    if (d) _cbSuggestPick(+d.dataset.i);
  });
  el.addEventListener('mousemove', e => {
    const d = e.target.closest('[data-i]');
    if (!d || !_cbSug) return;
    _cbSug.at = +d.dataset.i;
    el.querySelectorAll('[data-i]').forEach((x, i) => x.classList.toggle('on', i === _cbSug.at));
  });
  document.body.appendChild(el);
  const z = cbZoom(), r = input.getBoundingClientRect();
  el.style.left = (r.left / z) + 'px';
  el.style.top = ((r.bottom + 4) / z) + 'px';
  _cbSug = { items, at, el, pick };
}

// A row's Name field: a pick replaces the row with a fresh copy of the entry, dropping whatever the row held.
function _cbSuggest(input, row) {
  const q = input.value.trim();
  const items = q ? combatSearchBlocks(cbState.blocks, q).slice(0, 8).map(b => ({ label: b.name, src: b.source || '', entry: b })) : [];
  if (!items.length) { _cbSuggestClose(); return; }
  // Enter picks only once the DM moves onto one, unless a pick wipes nothing.
  _cbSuggestOpen(input, items, combatRowIsFresh(row) ? 0 : -1, i => {
    combatPickInto(row, items[i].entry, cbState.rows.filter(r => r !== row));
    cbSave();
    bcRefresh(row);
    document.activeElement.blur();
    cbRender();
  });
}

function _cbSuggestClose() {
  if (_cbSug) _cbSug.el.remove();
  _cbSug = null;
}

function _cbSuggestKey(e) {
  if (!_cbSug) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    _cbSug.at = ((_cbSug.at < 0 && e.key === 'ArrowUp' ? 0 : _cbSug.at) + (e.key === 'ArrowDown' ? 1 : -1) + _cbSug.items.length) % _cbSug.items.length;
    _cbSug.el.querySelectorAll('[data-i]').forEach((d, i) => d.classList.toggle('on', i === _cbSug.at));
    return true;
  }
  if (e.key === 'Enter' && _cbSug.at >= 0) { e.preventDefault(); _cbSuggestPick(_cbSug.at); return true; }
  if (e.key === 'Escape') { e.stopPropagation(); _cbSuggestClose(); return true; }
  return false;
}

function _cbSuggestPick(i) {
  const { pick } = _cbSug;
  _cbSuggestClose();
  pick(i);
}
