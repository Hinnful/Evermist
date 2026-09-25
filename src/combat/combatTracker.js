// combatTracker.js — the fight table on the DM's screen. One fight for the whole app, saved to
// localStorage as it changes, carried in backups (backup.js). Nothing here reaches the Player.

const CB_KEY = 'evermist.combat';
const CB_POS_KEY = 'evermist.combatPos';
const CB_COLS_KEY = 'evermist.combatCols';
const CB_COL_MIN = { name: 90, hp: 80, cond: 70 };
const CB_CONDITIONS = ['Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible',
  'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious', 'Concentrating'];
const CB_ICON_X = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="2.5" y1="2.5" x2="9.5" y2="9.5"/><line x1="9.5" y1="2.5" x2="2.5" y2="9.5"/></svg>';
const CB_ICON_GRIP = '<svg class="rp-grip" width="12" height="8" viewBox="0 0 12 8" fill="currentColor"><circle cx="1.5" cy="1.5" r="1.1"/><circle cx="6" cy="1.5" r="1.1"/><circle cx="10.5" cy="1.5" r="1.1"/><circle cx="1.5" cy="6.5" r="1.1"/><circle cx="6" cy="6.5" r="1.1"/><circle cx="10.5" cy="6.5" r="1.1"/></svg>';
const CB_ICON_ROWGRIP = '<svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor"><circle cx="2" cy="2" r="1.1"/><circle cx="6" cy="2" r="1.1"/><circle cx="2" cy="6" r="1.1"/><circle cx="6" cy="6" r="1.1"/><circle cx="2" cy="10" r="1.1"/><circle cx="6" cy="10" r="1.1"/></svg>';
const CB_ICON_DEL = '<svg width="12" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>';

let cbState = { rows: [], blocks: {}, nextId: 1 };
let _cbSaveTimer = null;
let _cbSaveFailed = false;

function cbZoom() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1.2;
}

// ── Saving ───────────────────────────────────────────────────────────────────

function cbSave() {
  clearTimeout(_cbSaveTimer);
  _cbSaveTimer = null;
  try {
    localStorage.setItem(CB_KEY, JSON.stringify(cbState));
  } catch (err) {
    console.error('Saving the fight failed:', err);
    // Once per session: a full store would otherwise raise a dialog on every keystroke.
    if (!_cbSaveFailed) messageDialog({ title: 'The fight is not being saved', message: 'Evermist could not write the fight table to disk, so it will be gone after a restart.\n\n' + (err.message || err) });
    _cbSaveFailed = true;
  }
}
function cbSaveSoon() {
  clearTimeout(_cbSaveTimer);
  _cbSaveTimer = setTimeout(cbSave, 400);
}

function _cbLoad() {
  let raw = null;
  try { raw = localStorage.getItem(CB_KEY); } catch (_) { return; }
  if (!raw) return;
  try {
    const d = JSON.parse(raw);
    cbState = { rows: Array.isArray(d.rows) ? d.rows : [], blocks: d.blocks || {}, nextId: d.nextId || 1 };
  } catch (err) {
    console.error('The saved fight could not be read:', err);
  }
}

// Null when there is nothing to carry, and the zip then looks exactly as it always did.
function cbBackupPayload() {
  if (!cbState.rows.length && !Object.keys(cbState.blocks).length) return null;
  return JSON.stringify(cbState);
}

function cbMergePayload(json) {
  let d;
  try { d = JSON.parse(json); } catch (err) { return { ok: false, error: 'The fight in this backup could not be read.' }; }
  cbState = combatMerge(cbState, { rows: Array.isArray(d.rows) ? d.rows : [], blocks: d.blocks || {} });
  cbSave();
  cbRender();
  return { ok: true };
}

// ── The table ────────────────────────────────────────────────────────────────

function _cbRowOf(el) {
  const r = el.closest('.cb-row');
  return r && cbState.rows.find(x => x.id === Number(r.dataset.id));
}

function _cbSumText(v) { return v === null ? '' : Number.isNaN(v) ? '?' : String(v); }

function _cbCondCell(r) {
  return r.conds.map(c => `<span class="cb-chip">${_cbEsc(c)}</span>`).join('');
}

function cbRender() {
  const list = document.getElementById('cb-list');
  if (!list) return;
  const shown = cbStatRowId();
  list.innerHTML = cbState.rows.map(r => {
    const max = combatFirstNum(cbRowBlock(r).hp), hp = combatRowHpState(max, r.hp);
    const cls = ['cb-row', 'side-' + r.side, hp.down ? 'down' : '', hp.bloodied ? 'bloodied' : '', r.id === shown ? 'shown' : ''].join(' ');
    return `<div class="${cls}" data-id="${r.id}">
      <span class="cb-rowgrip" title="Drag to move">${CB_ICON_ROWGRIP}</span>
      <div class="cb-cell num init"><input data-f="init" value="${_cbEsc(r.init)}" inputmode="numeric" spellcheck="false"></div>
      <div class="cb-cell name"><input data-f="name" value="${_cbEsc(r.name)}" placeholder="Name" spellcheck="false"><button class="cb-open" data-open>OPEN</button></div>
      <div class="cb-cell hp">${max ? `<span class="max" title="Max HP, from the stat block">${max}</span>` : ''}<input data-f="hp" value="${_cbEsc(r.hp)}" spellcheck="false"><span class="sum">${_cbSumText(hp.value)}</span></div>
      <div class="cb-cell num"><input data-f="ac" value="${_cbEsc(r.ac)}" inputmode="numeric" spellcheck="false"></div>
      <div class="cb-cell cond" data-cond>${_cbCondCell(r)}</div>
      <button class="cb-iconbtn del" data-del title="Remove">${CB_ICON_DEL}</button>
    </div>`;
  }).join('');
}

function _cbAddRow(side) {
  const r = { id: cbState.nextId++, init: '', name: '', hp: '', ac: '', conds: [], side, sbChanged: false };
  cbState.rows.push(r);
  cbSave();
  cbRender();
  const inp = document.querySelector(`#cb-list .cb-row[data-id="${r.id}"] [data-f="name"]`);
  inp.focus();
  inp.scrollIntoView({ block: 'nearest' });
}

// A row edit is an edit to its copy: the popup, if it shows this row, follows without redrawing.
function _cbRowEdited(r, field) {
  r.sbChanged = true;
  if (cbStatRowId() !== r.id) return;
  const pop = document.getElementById('cb-stat');
  const f = pop.querySelector(`[data-p="${field}"]`);
  if (f) f.textContent = r.sb[field];
  const btn = pop.querySelector('[data-save]');
  btn.disabled = false;
  btn.textContent = 'Save to Bestiary';
}

// A row with no max HP yet gives its first typed number to the stat block, which then holds it.
function _cbTakeMax(r) {
  const sb = cbRowBlock(r);
  if (combatFirstNum(sb.hp)) return;
  const m = String(r.hp).trim().match(/^(\d+)\s*(.*)$/);
  if (!m) return;
  sb.hp = m[1];
  r.hp = m[2];
  _cbRowEdited(r, 'hp');
}

function _cbRemoveRow(r) {
  cbState.rows = cbState.rows.filter(x => x !== r);
  if (cbStatRowId() === r.id) cbCloseStat();
  cbSave();
  cbRender();
}

// ── Menus ────────────────────────────────────────────────────────────────────

// items: [{ label, pick, ticked? }]. A pick on a ticked menu leaves it open so several can be set.
// owner is the cell that opened it: a second click there closes the menu rather than reopening it.
let _cbMenuOwner = null, _cbClosedOn = null;
function cbMenu(items, rect, keepOpen, owner) {
  cbCloseMenu();
  const m = document.createElement('div');
  m.className = 'cb-menu';
  m.id = 'cb-menu';
  const draw = () => {
    m.innerHTML = items.map((it, i) => `<div data-i="${i}">${keepOpen ? `<span class="tick">${it.ticked() ? '✓' : ''}</span>` : ''}${_cbEsc(it.label)}</div>`).join('');
  };
  draw();
  m.addEventListener('mousedown', e => e.stopPropagation());
  m.addEventListener('click', e => {
    const d = e.target.closest('[data-i]');
    if (!d) return;
    items[+d.dataset.i].pick();
    if (keepOpen) draw(); else cbCloseMenu();
  });
  document.body.appendChild(m);
  const z = cbZoom();
  m.style.left = (rect.left / z) + 'px';
  m.style.top = ((rect.bottom + 4) / z) + 'px';
  const mr = m.getBoundingClientRect();
  if (mr.bottom > innerHeight) m.style.top = (Math.max(4, rect.top - mr.height - 4) / z) + 'px';
  _cbMenuOwner = owner || null;
  // Capture phase: the panels stop mousedown from bubbling, so a bubbling listener never heard a
  // click anywhere inside the table.
  setTimeout(() => {
    document.addEventListener('mousedown', _cbMenuOutside, true);
    document.addEventListener('keydown', _cbMenuKey, true);
  });
}
function _cbMenuOutside(e) {
  if (e.target.closest('#cb-menu')) return;
  _cbClosedOn = _cbMenuOwner && _cbMenuOwner.contains(e.target) ? _cbMenuOwner : null;
  cbCloseMenu();
}
function _cbMenuKey(e) {
  if (e.key !== 'Escape' && e.key !== 'Enter') return;
  e.stopPropagation();
  cbCloseMenu();
}
function cbCloseMenu() {
  const m = document.getElementById('cb-menu');
  if (m) m.remove();
  _cbMenuOwner = null;
  document.querySelectorAll('#cb-list .cb-cell.open').forEach(c => c.classList.remove('open'));
  document.removeEventListener('mousedown', _cbMenuOutside, true);
  document.removeEventListener('keydown', _cbMenuKey, true);
}

function _cbCondMenu(cell, r) {
  cell.classList.add('open');
  cbMenu(CB_CONDITIONS.map(c => ({
    label: c,
    ticked: () => r.conds.includes(c),
    pick: () => {
      r.conds = r.conds.includes(c) ? r.conds.filter(x => x !== c) : r.conds.concat(c);
      cell.innerHTML = _cbCondCell(r);
      cbSave();
    },
  })), cell.getBoundingClientRect(), true, cell);
}

// ── Dragging: the panels by their head, a row by its grip ────────────────────

function _cbDragPanel(el, e) {
  const z = cbZoom();
  const sx = e.clientX / z - parseFloat(el.style.left || 0), sy = e.clientY / z - parseFloat(el.style.top || 0);
  const move = m => {
    el.style.left = (m.clientX / z - sx) + 'px';
    el.style.top = Math.max(0, m.clientY / z - sy) + 'px';
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    if (el.id === 'cb-fight') {
      try { localStorage.setItem(CB_POS_KEY, JSON.stringify({ left: parseFloat(el.style.left), top: parseFloat(el.style.top) })); } catch (_) {}
    }
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up, { once: true });
}

function _cbDragRow(grip) {
  const list = document.getElementById('cb-list'), rowEl = grip.closest('.cb-row'), moving = _cbRowOf(grip);
  rowEl.classList.add('dragging');
  let target = null, below = false;
  const clear = () => list.querySelectorAll('.drop-above, .drop-below').forEach(x => x.classList.remove('drop-above', 'drop-below'));
  const move = m => {
    clear();
    target = null;
    const rows = [...list.querySelectorAll('.cb-row')];
    for (const el of rows) {
      const rc = el.getBoundingClientRect();
      if (m.clientY >= rc.top && m.clientY < rc.bottom) { target = el; below = m.clientY > rc.top + rc.height / 2; break; }
    }
    if (!target && rows.length) {
      const first = rows[0], last = rows[rows.length - 1];
      if (m.clientY < first.getBoundingClientRect().top) { target = first; below = false; }
      else if (m.clientY >= last.getBoundingClientRect().bottom) { target = last; below = true; }
    }
    if (target && target !== rowEl) target.classList.add(below ? 'drop-below' : 'drop-above');
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    clear();
    rowEl.classList.remove('dragging');
    if (target && target !== rowEl) {
      const dest = _cbRowOf(target);
      cbState.rows = cbState.rows.filter(x => x !== moving);
      cbState.rows.splice(cbState.rows.indexOf(dest) + (below ? 1 : 0), 0, moving);
      cbSave();
    }
    cbRender();
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up, { once: true });
}

// A column's width is a viewing preference, so it is kept apart from the fight and out of backups.
function _cbApplyCols(el) {
  let cols = {};
  try { cols = JSON.parse(localStorage.getItem(CB_COLS_KEY) || '{}') || {}; } catch (_) {}
  for (const k of Object.keys(CB_COL_MIN)) if (cols[k]) el.style.setProperty('--cb-' + k, cols[k] + 'px');
}

function _cbDragCol(handle, e) {
  const fight = document.getElementById('cb-fight'), col = handle.dataset.col, z = cbZoom();
  const start = handle.parentElement.getBoundingClientRect().width / z, x0 = e.clientX;
  let width = start;
  const move = m => {
    width = Math.round(Math.max(CB_COL_MIN[col], start + (m.clientX - x0) / z));
    fight.style.setProperty('--cb-' + col, width + 'px');
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    let cols = {};
    try { cols = JSON.parse(localStorage.getItem(CB_COLS_KEY) || '{}') || {}; } catch (_) {}
    cols[col] = width;
    try { localStorage.setItem(CB_COLS_KEY, JSON.stringify(cols)); } catch (_) {}
    _cbPlaceFight(fight);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up, { once: true });
}

// ── Open, close, wiring ──────────────────────────────────────────────────────

function _cbPlaceFight(el) {
  const z = cbZoom();
  let pos = null;
  try { pos = JSON.parse(localStorage.getItem(CB_POS_KEY) || 'null'); } catch (_) {}
  const rect = el.getBoundingClientRect(), w = rect.width / z, h = rect.height / z;
  const maxL = innerWidth / z - w - 8, maxT = innerHeight / z - Math.min(h, 120);
  const left = pos ? pos.left : maxL - 8, top = pos ? pos.top : 64 / z;
  el.style.left = Math.max(8, Math.min(maxL, left)) + 'px';
  el.style.top = Math.max(8, Math.min(maxT, top)) + 'px';
}

function cbSetOpen(open) {
  const el = document.getElementById('cb-fight');
  el.style.display = open ? 'block' : 'none';
  document.getElementById('btn-combat').classList.toggle('active', open);
  if (open) { cbRender(); _cbPlaceFight(el); return; }
  cbCloseMenu();
  if (cbStatRowId()) cbCloseStat();
}

function initCombatTracker() {
  _cbLoad();
  const fight = document.createElement('div');
  fight.id = 'cb-fight';
  fight.className = 'cb-panel';
  fight.innerHTML = `
    <div class="cb-head" data-drag>${CB_ICON_GRIP}<span class="cb-title">Fight</span>
      <button class="cb-iconbtn" id="cb-close" title="Close">${CB_ICON_X}</button></div>
    <div class="cb-colhdr"><span class="c sortable" id="cb-sort" title="Sort by initiative">Init ↓</span><span>Name<i class="cb-colsize" data-col="name"></i></span><span>HP<i class="cb-colsize" data-col="hp"></i></span><span class="c">AC</span><span>Conditions<i class="cb-colsize" data-col="cond"></i></span><span></span></div>
    <div id="cb-list"></div>
    <div class="cb-foot"><button class="cb-add" data-add="enemy">+ Add enemy</button><button class="cb-add" data-add="ally">+ Add ally</button></div>`;
  const stat = document.createElement('div');
  stat.id = 'cb-stat';
  stat.className = 'cb-panel';
  document.body.append(fight, stat);
  _cbApplyCols(fight);

  for (const el of [fight, stat]) {
    // The map's own handlers listen on the document; nothing typed or clicked here is theirs.
    el.addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); });
    el.addEventListener('mousedown', e => {
      e.stopPropagation();
      const size = e.target.closest('.cb-colsize');
      if (size) { e.preventDefault(); _cbDragCol(size, e); return; }
      const head = e.target.closest('[data-drag]');
      if (head && !e.target.closest('button')) { e.preventDefault(); _cbDragPanel(el, e); }
    });
  }

  const list = document.getElementById('cb-list');
  list.addEventListener('input', e => {
    const f = e.target.dataset.f, r = _cbRowOf(e.target);
    if (!f || !r) return;
    r[f] = e.target.value;
    const sb = cbRowBlock(r);
    if (f === 'hp') {
      const hp = combatRowHpState(combatFirstNum(sb.hp), r.hp), rowEl = e.target.closest('.cb-row');
      e.target.nextElementSibling.textContent = _cbSumText(hp.value);
      rowEl.classList.toggle('bloodied', hp.bloodied);
    }
    if (f === 'ac') { sb.ac = combatSetFirstNum(sb.ac, r.ac.trim()); _cbRowEdited(r, 'ac'); }
    if (f === 'name') {
      sb.name = combatBaseName(r.name);
      _cbRowEdited(r, 'name');
      _cbSuggest(e.target, r);
    }
    cbSaveSoon();
  });
  list.addEventListener('focusin', e => {
    if (e.target.dataset.f !== 'hp') return;
    const i = e.target;
    setTimeout(() => i.setSelectionRange(i.value.length, i.value.length));
  });
  list.addEventListener('keydown', e => {
    if (_cbSuggestKey(e)) return;
    if (e.key === 'Enter' && e.target.dataset.f) e.target.blur();
  });
  // Grey-out waits until the field is left, so a row never changes under the caret.
  list.addEventListener('focusout', e => {
    if (!e.target.dataset.f) return;
    _cbSuggestClose();
    const r = _cbRowOf(e.target);
    if (r && e.target.dataset.f === 'hp') _cbTakeMax(r);
    cbSave();
    setTimeout(() => { if (!list.contains(document.activeElement)) cbRender(); });
  });
  list.addEventListener('mousedown', e => {
    const grip = e.target.closest('.cb-rowgrip');
    if (grip) { e.preventDefault(); _cbDragRow(grip); }
  });
  list.addEventListener('click', e => {
    const t = e.target, r = _cbRowOf(t);
    if (!r) return;
    if (t.closest('[data-del]')) _cbRemoveRow(r);
    else if (t.closest('[data-open]')) { if (cbStatRowId() === r.id) { cbCloseStat(); cbRender(); } else cbOpenStat(r); }
    else if (t.closest('[data-cond]')) {
      const cell = t.closest('[data-cond]');
      if (_cbClosedOn === cell) _cbClosedOn = null;
      else _cbCondMenu(cell, r);
    }
  });
  list.addEventListener('contextmenu', e => {
    const r = _cbRowOf(e.target);
    if (!r || e.target.closest('input')) return;
    e.preventDefault();
    const set = side => () => { r.side = side; cbSave(); cbRender(); if (cbStatRowId() === r.id) cbOpenStat(r); };
    cbMenu([{ label: 'Enemy', ticked: () => r.side === 'enemy', pick: set('enemy') },
            { label: 'Ally', ticked: () => r.side === 'ally', pick: set('ally') }],
           { left: e.clientX, top: e.clientY, bottom: e.clientY }, true);
  });

  document.getElementById('cb-sort').addEventListener('click', () => { cbState.rows = combatSortByInit(cbState.rows); cbSave(); cbRender(); });
  fight.querySelector('.cb-foot').addEventListener('click', e => { const b = e.target.closest('[data-add]'); if (b) _cbAddRow(b.dataset.add); });
  document.getElementById('cb-close').addEventListener('click', () => cbSetOpen(false));
  document.getElementById('btn-combat').addEventListener('click', () => cbSetOpen(fight.style.display !== 'block'));

  initCombatStatBlock();
  initBestiary();
}

// ── The name field's suggestions from the bestiary ───────────────────────────

let _cbSug = null;   // { row, items, at, el }

function _cbSuggest(input, row) {
  _cbSuggestClose();
  const q = input.value.trim();
  const items = q ? combatSearchBlocks(cbState.blocks, q).slice(0, 8) : [];
  if (!items.length) return;
  const el = document.createElement('div');
  el.className = 'cb-menu';
  el.id = 'cb-suggest';
  el.innerHTML = items.map((b, i) => `<div data-i="${i}" class="${i ? '' : 'on'}">${_cbEsc(b.name)}<span class="src">${_cbEsc(b.source || '')}</span></div>`).join('');
  // mousedown, not click: the field's blur would close the list first.
  el.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    const d = e.target.closest('[data-i]');
    if (d) _cbSuggestPick(+d.dataset.i);
  });
  document.body.appendChild(el);
  const z = cbZoom(), r = input.getBoundingClientRect();
  el.style.left = (r.left / z) + 'px';
  el.style.top = ((r.bottom + 4) / z) + 'px';
  _cbSug = { row, items, at: 0, el };
}

function _cbSuggestClose() {
  if (_cbSug) _cbSug.el.remove();
  _cbSug = null;
}

function _cbSuggestKey(e) {
  if (!_cbSug) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    _cbSug.at = (_cbSug.at + (e.key === 'ArrowDown' ? 1 : -1) + _cbSug.items.length) % _cbSug.items.length;
    _cbSug.el.querySelectorAll('[data-i]').forEach((d, i) => d.classList.toggle('on', i === _cbSug.at));
    return true;
  }
  if (e.key === 'Enter') { e.preventDefault(); _cbSuggestPick(_cbSug.at); return true; }
  if (e.key === 'Escape') { e.stopPropagation(); _cbSuggestClose(); return true; }
  return false;
}

// A pick replaces the row with a fresh copy of the entry, dropping whatever the row held.
function _cbSuggestPick(i) {
  const { row, items } = _cbSug;
  _cbSuggestClose();
  Object.assign(row, combatRowFromEntry(items[i], cbState.rows.filter(r => r !== row)));
  cbSave();
  if (cbStatRowId() === row.id) cbOpenStat(row);
  document.activeElement.blur();
  cbRender();
}
