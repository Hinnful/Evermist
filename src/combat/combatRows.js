'use strict';
// combatRows.js — the fight table's rows: each row's cells, conditions in the Name cell, the hover toolbar, the
// row's menu and the folded Defeated line. combatTracker.js owns saving and the table's wiring.

const CB_ICON_DUP = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><path d="M8.5 1.5h-6a1 1 0 0 0-1 1v6"/></svg>';

let _cbFoldOpen = false;   // the Defeated line, folded at every start

function _cbRowOf(el) {
  const r = el.closest('.cb-row');
  return r && cbState.rows.find(x => x.id === Number(r.dataset.id));
}

function _cbSumText(v) { return v === null ? '' : Number.isNaN(v) ? '?' : String(v); }

// The first condition as a chip, the rest as "+N"; hovering either lists them all.
function _cbCondChips(r) {
  if (!r.conds.length) return '';
  const all = _cbEsc(r.conds.map(c => t(c)).join(', '));
  return `<span class="cb-chip" data-cond title="${all}">${_cbEsc(r.conds[0])}</span>${
    r.conds.length > 1 ? `<span class="cb-chip more" data-cond title="${all}" data-no-i18n>+${r.conds.length - 1}</span>` : ''}`;
}

function _cbHpClass(hp) { return hp.down ? 'dead' : hp.bloodied ? 'low' : ''; }

// The DM's own line once written, else what the stat block's actions read as.
function _cbAtkCell(sb) {
  if (sb.quick !== undefined) return `<span class="cb-atk own" data-no-i18n>${_cbEsc(sb.quick)}</span>`;
  return `<span class="cb-atk pills" data-no-i18n>${combatAttacks(sb).map(cbAttackPill).join('')}</span>`;
}

function _cbRowHtml(r, shown, ex) {
  const sb = cbRowBlock(r), max = combatFirstNum(sb.hp), ac = combatFirstNum(sb.ac);
  const hp = combatRowHpState(max, r.hp), hint = max || ac ? combatAbilityMod(sb.abil[1]) : '';
  const cls = ['cb-row', 'side-' + (r.side === 'ally' ? 'ally' : 'enemy'), _cbHpClass(hp), r.id === shown ? 'shown' : '',
    combatIsDefeated(r) ? 'gone' : '', combatIsCleaned(r) ? 'cleaned' : ''].join(' ');
  return `<div class="${cls}" data-id="${r.id}">
      <div class="cb-cell num init"><input data-f="init" value="${_cbEsc(r.init)}" placeholder="${_cbEsc(hint)}" inputmode="numeric" spellcheck="false"></div>
      <div class="cb-cell name"><input data-f="name" value="${_cbEsc(r.name)}" placeholder="Name" spellcheck="false"><span class="cb-conds">${_cbCondChips(r)}</span><button class="cb-addcond" data-b="cond" title="Add condition">${uiIcon('plus', 12, 2)}</button></div>
      <div class="cb-cell hp">${max ? `<span class="max" title="Max HP, from the stat block">${max}</span>` : ''}<input data-f="hp" value="${_cbEsc(r.hp)}" spellcheck="false"${ex.includes(r) ? ` class="ex" placeholder="${t(ex[0] === r ? '-12 damage' : '+5 healing')}"` : ''}><span class="sum">${_cbSumText(hp.value)}</span></div>
      <div class="cb-cell num ac"><input data-f="ac" value="${_cbEsc(r.ac || ac)}" inputmode="numeric" spellcheck="false"${ac ? ' class="sbn"' : ''}></div>
      <div class="cb-cell atk" title="Double-click to write your own line">${_cbAtkCell(sb)}
        <span class="cb-acts">
          <button class="cb-iconbtn" data-b="stat" title="Stat block">${uiIcon('book', 14)}</button>
          <button class="cb-iconbtn" data-b="dup" title="Duplicate (Ctrl+D)">${CB_ICON_DUP}</button>
          <span class="cp-tabs cb-side-switch">${['enemy', 'ally'].map(s => `<button class="cp-segtab${(r.side === 'ally') === (s === 'ally') ? ' active' : ''}" data-b="side" data-side="${s}" title="${s === 'ally' ? 'Ally' : 'Enemy'}">${uiIcon(s === 'ally' ? 'angel' : 'devil', 14)}</button>`).join('')}</span>
          <button class="cb-iconbtn del" data-b="del" title="Delete">${uiIcon('trash', 14)}</button>
        </span></div>
    </div>`;
}

// Live rows in their order, then the Defeated line with the cleaned rows, folded until the DM opens it.
// A redraw while rows glide (a sort, a drop) turns them from where they stand instead of snapping them.
function cbRender() {
  const list = document.getElementById('cb-list');
  if (list) motionRedraw(list, '.cb-row', el => el.dataset.id, () => _cbDraw(list));
}

function _cbDraw(list) {
  if (combatReviveRows(cbState.rows)) cbSaveSoon();
  const shown = bcRowId(), ex = cbState.rows.filter(r => r.side !== 'ally' && !String(r.hp || '').trim() && combatFirstNum(cbRowBlock(r).hp)).slice(0, 2);   // the HP line's sample
  const { live, gone } = combatRenderOrder(cbState.rows);
  list.innerHTML = (cbState.rows.length ? '' : '<div class="cb-empty">No creatures yet.</div>') + live.map(r => _cbRowHtml(r, shown, ex)).join('') +
    (gone.length ? `<div class="cb-fold${_cbFoldOpen ? ' open' : ''}" data-fold><span class="sm-chev"></span><span>Defeated</span><span class="n" data-no-i18n>${gone.length}</span></div>` +
      (_cbFoldOpen ? gone.map(r => _cbRowHtml(r, shown, ex)).join('') : '') : '');
  _cbFitHp([...list.querySelectorAll('[data-f="hp"]')]);
  cbSortRefresh(); cbHeadRefresh();
}

function cbToggleFold() {
  _cbFoldOpen = !_cbFoldOpen;
  cbRender();
}

// ── The HP field: out of focus a line too long for the cell reads "… -4 -9"; focused it widens over AC and Attacks ──

// Measured on a canvas, every width read before any field is written: a field written and read back per step forced a
// layout per step per row.
let _cbMeasure = null;
function _cbFitHp(inputs) {
  if (!inputs.length) return;
  const cs = getComputedStyle(inputs[0]);
  _cbMeasure = _cbMeasure || document.createElement('canvas').getContext('2d');
  _cbMeasure.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const fits = (s, room) => Math.ceil(_cbMeasure.measureText(s).width) <= room;
  const room = inputs.map(i => { const s = getComputedStyle(i); return i.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight); });
  const shown = inputs.map((input, n) => {
    const full = input.value;
    if (fits(full, room[n])) return null;
    const hits = combatHpHits(full);
    let k = hits.length - 1;
    while (k > 1 && !fits(combatHpTail(full, k), room[n])) k--;
    return k >= 1 ? combatHpTail(full, k) : full;
  });
  inputs.forEach((input, n) => {
    input.dataset.full = input.value;
    if (shown[n] === null) return;
    input.value = shown[n];
    input.classList.add('short');
  });
}

function cbHpFocus(input) {
  const r = _cbRowOf(input);
  if (input.classList.contains('short')) { input.value = r ? r.hp : input.dataset.full; input.classList.remove('short'); }
  cbHpWiden(input);
}

function cbHpWiden(input) {
  const cell = input.closest('.cb-cell.hp'), row = cell.closest('.cb-row');
  cell.classList.remove('wide');
  cell.style.marginRight = '';
  if (input.scrollWidth <= input.clientWidth) return;
  const z = cbZoom(), over = ['.ac', '.atk'].reduce((w, c) => w + row.querySelector('.cb-cell' + c).getBoundingClientRect().width / z, 0);
  cell.classList.add('wide');
  cell.style.marginRight = -over + 'px';
}

// ── Clicks: the toolbar, a chip or the add-condition +, the Defeated line, the Attacks cell, right-click ──

function initCombatRows(fight, list) {
  list.addEventListener('click', e => {
    const t = e.target;
    if (t.closest('[data-fold]')) { cbToggleFold(); return; }
    const r = _cbRowOf(t);
    if (!r) return;
    const b = t.closest('[data-b]');
    if (b) {
      const a = b.dataset.b;
      if (a === 'stat') bcOpen(r);
      if (a === 'dup') _cbDuplicateRow(r);
      if (a === 'side' && b.dataset.side !== (r.side === 'ally' ? 'ally' : 'enemy')) _cbSwitchSide(r);
      if (a === 'del') _cbRemoveRow(r);
      if (a !== 'cond') return;
    }
    const chip = t.closest('[data-cond], [data-b="cond"]');
    if (!chip) return;
    if (_cbClosedOn === chip) _cbClosedOn = null;
    else _cbCondMenu(r, chip.getBoundingClientRect(), chip);
  });
  list.addEventListener('dblclick', e => {
    const cell = e.target.closest('.cb-cell.atk');
    if (cell && !e.target.closest('.cb-acts')) _cbEditAttacks(cell, _cbRowOf(cell));
  });
  fight.addEventListener('contextmenu', e => {
    if (e.target.closest('.cb-head') || e.target.closest('.cb-atk.editing')) return;
    e.preventDefault();
    const r = _cbRowOf(e.target);
    cbMenu(r ? _cbRowItems(r) : _cbTableItems(), { left: e.clientX, top: e.clientY, bottom: e.clientY });
  });
}

// ── Menus ────────────────────────────────────────────────────────────────────

function _cbRowItems(r) {
  return [
    { label: 'Open stat block', pick: () => bcOpen(r) },
    { label: 'Duplicate', key: 'Ctrl+D', pick: () => _cbDuplicateRow(r) },
    { label: r.side === 'ally' ? 'Make enemy' : 'Make ally', pick: () => _cbSwitchSide(r) },
    { label: 'Conditions', key: '›', pick: rect => _cbCondMenu(r, rect) },
    ...(combatIsCleaned(r) ? [{ label: 'Return to fight', pick: () => { combatReturnRow(r); cbSave(); cbRender(); } }] : []),
    { sep: true },
    ..._cbTableItems(),
    { sep: true },
    { label: 'Delete', danger: true, pick: () => _cbRemoveRow(r) },
  ];
}

// What the header does, and the two adds, from anywhere in the table.
function _cbTableItems() {
  return [
    ...(combatToClean(cbState.rows) ? [{ label: 'Clean up', pick: cbCleanUp }] : []),
    { label: 'Sort', pick: cbSortRows },
    { label: initiativeTvOn() ? 'End fight' : 'Start fight', pick: () => initiativeTvSet(!initiativeTvOn()) },
    { sep: true },
    { label: 'Add enemy', pick: () => _cbAddRow('enemy') }, { label: 'Add ally', pick: () => _cbAddRow('ally') },
  ];
}

// Today's checklist, from a chip, the add-condition + or the row's menu; the chips follow each tick in place.
function _cbCondMenu(r, rect, owner) {
  cbMenu(CB_CONDITIONS.map(c => ({
    label: c,
    checked: () => r.conds.includes(c),
    pick: () => {
      r.conds = r.conds.includes(c) ? r.conds.filter(x => x !== c) : r.conds.concat(c);
      const box = document.querySelector(`#cb-list .cb-row[data-id="${r.id}"] .cb-conds`);
      if (box) box.innerHTML = _cbCondChips(r);
      cbSave();
    },
  })), rect, owner);
}
