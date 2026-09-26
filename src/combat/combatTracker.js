// combatTracker.js — the fight table on the DM's screen, saved to localStorage as it changes and
// carried in backups (backup.js). combatFights.js owns the list of fights. Nothing here reaches the Player.

const CB_KEY = 'evermist.combat';
const CB_FIGHTS_KEY = 'evermist.combatFights';
const CB_POS_KEY = 'evermist.combatPos';
const CB_COLS_KEY = 'evermist.combatCols';
const CB_COL_MIN = { name: 90, hp: 80, cond: 70, atk: 110 };
const CB_CONDITIONS = ['Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible',
  'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious', 'Concentrating'];
const CB_ICON_X = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="2.5" y1="2.5" x2="9.5" y2="9.5"/><line x1="9.5" y1="2.5" x2="2.5" y2="9.5"/></svg>';
const CB_ICON_GRIP = '<svg class="rp-grip" width="12" height="8" viewBox="0 0 12 8" fill="currentColor"><circle cx="1.5" cy="1.5" r="1.1"/><circle cx="6" cy="1.5" r="1.1"/><circle cx="10.5" cy="1.5" r="1.1"/><circle cx="1.5" cy="6.5" r="1.1"/><circle cx="6" cy="6.5" r="1.1"/><circle cx="10.5" cy="6.5" r="1.1"/></svg>';
const CB_ICON_DEL = '<svg width="12" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>';
const CB_ICON_BOOK = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M2 2.5h3.5A1.5 1.5 0 0 1 7 4v8a1 1 0 0 0-1-1H2z"/><path d="M12 2.5H8.5A1.5 1.5 0 0 0 7 4v8a1 1 0 0 1 1-1h4z"/></svg>';
const CB_ICON_DUP = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><path d="M8.5 1.5h-6a1 1 0 0 0-1 1v6"/></svg>';
const CB_ICON_SWAP = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5h9M8.5 2l2.5 2.5L8.5 7"/><path d="M12 9.5H3M5.5 7L3 9.5 5.5 12"/></svg>';

// `rows` is the open fight's; the other fights carry their own in `fights` (fightPlan.js).
let cbState = { rows: [], blocks: {}, nextId: 1, openId: null, fights: [] };
let _cbSaveTimer = null;
let _cbSaveFailed = false;

function cbZoom() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1.2;
}

// ── Saving ───────────────────────────────────────────────────────────────────

// `quiet`: the caller reports a failure itself, and later saves still get their own dialog.
function cbSave(quiet) {
  clearTimeout(_cbSaveTimer);
  _cbSaveTimer = null;
  try {
    const p = combatSavedParts(cbState);
    localStorage.setItem(CB_KEY, JSON.stringify(p.combat));
    localStorage.setItem(CB_FIGHTS_KEY, JSON.stringify(p.fights));
    return true;
  } catch (err) {
    if (quiet) return false;
    console.error('Saving the fight failed:', err);
    // Once per session: a full store would otherwise raise a dialog on every keystroke.
    if (!_cbSaveFailed) messageDialog({ title: 'The fight is not being saved', message: 'Evermist could not write the fight table to disk, so it will be gone after a restart.\n\n' + (err.message || err) });
    _cbSaveFailed = true;
    return false;
  }
}
function cbSaveSoon() {
  clearTimeout(_cbSaveTimer);
  _cbSaveTimer = setTimeout(cbSave, 400);
}

function _cbRead(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (err) {
    console.error('The saved fight could not be read:', err);
    return null;
  }
}

function _cbLoad() {
  const d = _cbRead(CB_KEY) || {};
  cbState = Object.assign({ rows: Array.isArray(d.rows) ? d.rows : [], blocks: d.blocks || {}, nextId: d.nextId || 1 },
    combatFightsFrom(_cbRead(CB_FIGHTS_KEY), combatFightId));
  // Entries imported before statBlockJoinHp read a split HP as its first half.
  const copies = cbState.fights.flatMap(f => combatFightRows(cbState, f)).map(r => r.sb).filter(Boolean);
  for (const b of Object.values(cbState.blocks).concat(copies)) b.hp = statBlockJoinHp(b.hp);
}

// Null when there is nothing to carry, and the zip then looks exactly as it always did.
function cbBackupPayload() {
  const empty = cbState.fights.every(f => !combatFightRows(cbState, f).length);
  if (empty && cbState.fights.length < 2 && !Object.keys(cbState.blocks).length) return null;
  return JSON.stringify(combatBackupData(cbState));
}

function cbMergePayload(json) {
  let d;
  try { d = JSON.parse(json); } catch (err) { return { ok: false, error: 'The fight in this backup could not be read.' }; }
  cbState = combatMerge(cbState, { rows: Array.isArray(d.rows) ? d.rows : [], blocks: d.blocks || {},
    fights: Array.isArray(d.fights) ? d.fights : [], openId: d.openId }, combatFightId);
  cbSave();
  cbRender();
  cbFightsTitle();
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

function _cbHpClass(hp) { return hp.down ? 'dead' : hp.bloodied ? 'low' : ''; }

// The DM's own line once written, else what the stat block's actions read as.
function _cbAtkCell(sb) {
  if (sb.quick !== undefined) return `<span class="cb-atk own">${_cbEsc(sb.quick)}</span>`;
  const atks = combatAttacks(sb);
  return `<span class="cb-atk" title="${_cbEsc(atks.map(a => `${a.n}: ${a.hit} to hit, ${a.dmg} ${a.type} damage`).join('\n'))}">${
    atks.map(a => `<span class="an">${_cbEsc(a.n)}</span> <span class="ah">${_cbEsc(a.hit)}</span> <span class="ad">${_cbEsc(a.dmg)}</span>${
      a.type ? ` <span class="at">${_cbEsc(a.type)}</span>` : ''}`).join('\n')}</span>`;
}

function cbRender() {
  const list = document.getElementById('cb-list');
  if (!list) return;
  const shown = cbStatRowId();
  list.innerHTML = (cbState.rows.length ? '' : '<div class="cb-empty">No creatures yet.</div>') + cbState.rows.map(r => {
    const sb = cbRowBlock(r), max = combatFirstNum(sb.hp), ac = combatFirstNum(sb.ac);
    const hp = combatRowHpState(max, r.hp), hint = max || ac ? combatAbilityMod(sb.abil[1]) : '';
    const cls = ['cb-row', 'side-' + r.side, _cbHpClass(hp), r.id === shown ? 'shown' : ''].join(' ');
    return `<div class="${cls}" data-id="${r.id}">
      <div class="cb-cell num init"><input data-f="init" value="${_cbEsc(r.init)}" placeholder="${_cbEsc(hint)}" inputmode="numeric" spellcheck="false"></div>
      <div class="cb-cell name"><input data-f="name" value="${_cbEsc(r.name)}" placeholder="Name" spellcheck="false"></div>
      <div class="cb-cell hp">${max ? `<span class="max" title="Max HP, from the stat block">${max}</span>` : ''}<input data-f="hp" value="${_cbEsc(r.hp)}" spellcheck="false"><span class="sum">${_cbSumText(hp.value)}</span></div>
      <div class="cb-cell num ac"><input data-f="ac" value="${_cbEsc(r.ac)}" inputmode="numeric" spellcheck="false"${ac ? ' readonly title="From the stat block. Change it there."' : ''}></div>
      <div class="cb-cell cond" data-cond>${_cbCondCell(r)}</div>
      <div class="cb-cell atk" title="Double-click to write your own line">${_cbAtkCell(sb)}
        <span class="cb-acts">
          <button class="cb-iconbtn" data-b="stat" title="Stat block">${CB_ICON_BOOK}</button>
          <button class="cb-iconbtn" data-b="dup" title="Duplicate (Ctrl+D)">${CB_ICON_DUP}</button>
          <button class="cb-iconbtn" data-b="side" title="Switch enemy / ally">${CB_ICON_SWAP}</button>
          <button class="cb-iconbtn del" data-b="del" title="Delete">${CB_ICON_DEL}</button>
        </span></div>
    </div>`;
  }).join('') + '<div class="cb-addrow" data-add>+ Add creature</div>';
}

function _cbAddRow(side) {
  const r = { id: cbState.nextId++, init: '', name: '', hp: '', ac: '', conds: [], side, sbChanged: false };
  cbState.rows.push(r);
  cbSave();
  cbRender();
  cbFightsTitle();
  const inp = document.querySelector(`#cb-list .cb-row[data-id="${r.id}"] [data-f="name"]`);
  inp.focus();
  inp.scrollIntoView({ block: 'nearest' });
}

function _cbDuplicateRow(r) {
  const c = combatDuplicateRow(r, cbState.rows, cbState.nextId++);
  cbState.rows.splice(cbState.rows.indexOf(r) + 1, 0, c);
  cbSave();
  cbRender();
  cbFightsTitle();
  return c;
}

function _cbSwitchSide(r) {
  r.side = r.side === 'enemy' ? 'ally' : 'enemy';
  cbSave();
  if (cbStatRowId() === r.id) cbOpenStat(r); else cbRender();
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
  cbFightsTitle();
}

function _cbRowItems(r) {
  return [
    { label: 'Open stat block', pick: () => cbOpenStat(r) },
    { label: 'Duplicate', key: 'Ctrl+D', pick: () => _cbDuplicateRow(r) },
    { label: r.side === 'enemy' ? 'Make ally' : 'Make enemy', pick: () => _cbSwitchSide(r) },
    { sep: true },
    ..._cbAddItems(),
    { sep: true },
    { label: 'Delete', danger: true, pick: () => _cbRemoveRow(r) },
  ];
}
function _cbAddItems() {
  return [{ label: 'Add enemy', pick: () => _cbAddRow('enemy') }, { label: 'Add ally', pick: () => _cbAddRow('ally') }];
}

// ── Menus ────────────────────────────────────────────────────────────────────

// items: [{ label, pick, key?, danger?, sep?, checked? }]. A menu of checkboxes stays open for
// several picks; any other closes on its pick. owner is the element that opened it: a second click
// there closes the menu rather than reopening it.
let _cbMenuOwner = null, _cbClosedOn = null;
function cbMenu(items, rect, owner) {
  cbCloseMenu();
  const multi = items.some(it => it.checked);
  const m = document.createElement('div');
  m.className = 'cb-menu';
  m.id = 'cb-menu';
  const draw = () => {
    m.innerHTML = items.map((it, i) => it.sep ? '<hr>' : `<div data-i="${i}" class="${it.danger ? 'danger' : ''}">${
      multi ? `<span class="box${it.checked() ? ' on' : ''}"></span>` : ''}${_cbEsc(it.label)}${it.key ? `<span class="key">${it.key}</span>` : ''}</div>`).join('');
  };
  draw();
  m.addEventListener('mousedown', e => e.stopPropagation());
  m.addEventListener('contextmenu', e => e.preventDefault());
  m.addEventListener('click', e => {
    const d = e.target.closest('[data-i]');
    if (!d) return;
    const it = items[+d.dataset.i];
    if (multi) { it.pick(); draw(); return; }
    cbCloseMenu();
    it.pick();
  });
  document.body.appendChild(m);
  const z = cbZoom();
  m.style.left = (rect.left / z) + 'px';
  m.style.top = ((rect.bottom + 4) / z) + 'px';
  const mr = m.getBoundingClientRect();
  if (mr.bottom > innerHeight) m.style.top = (Math.max(4, rect.top - mr.height - 4) / z) + 'px';
  if (mr.right > innerWidth) m.style.left = (Math.max(4, innerWidth - mr.width - 4) / z) + 'px';
  _cbMenuOwner = owner || null;
  if (owner) owner.classList.add('open');
  // Capture phase: the panels stop mousedown from bubbling, so a bubbling listener never heard a
  // click anywhere inside the table.
  // A menu picked before this tick is gone, and listeners added for it would swallow the next Enter.
  setTimeout(() => {
    if (!m.isConnected) return;
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
  if (_cbMenuOwner) _cbMenuOwner.classList.remove('open');
  _cbMenuOwner = null;
  document.removeEventListener('mousedown', _cbMenuOutside, true);
  document.removeEventListener('keydown', _cbMenuKey, true);
}

function _cbCondMenu(cell, r) {
  cbMenu(CB_CONDITIONS.map(c => ({
    label: c,
    checked: () => r.conds.includes(c),
    pick: () => {
      r.conds = r.conds.includes(c) ? r.conds.filter(x => x !== c) : r.conds.concat(c);
      cell.innerHTML = _cbCondCell(r);
      cbSave();
    },
  })), cell.getBoundingClientRect(), cell);
}

// ── Dragging: the panels by their head, a row by a press that travels ────────

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

// A row has no grip: a press becomes a drag once it has travelled 5px, so a click still lands in the field.
function _cbPressRow(rowEl, e) {
  const x0 = e.clientX, y0 = e.clientY;
  const move = m => {
    if (Math.hypot(m.clientX - x0, m.clientY - y0) < 5) return;
    stop();
    if (document.activeElement) document.activeElement.blur();
    getSelection().removeAllRanges();
    _cbDragRow(rowEl);
  };
  const stop = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', stop); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', stop);
}

function _cbDragRow(rowEl) {
  const list = document.getElementById('cb-list'), moving = _cbRowOf(rowEl);
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
  if (cols.listH) el.style.setProperty('--cb-list-h', cols.listH + 'px');
}

function _cbSaveCols(set) {
  let cols = {};
  try { cols = JSON.parse(localStorage.getItem(CB_COLS_KEY) || '{}') || {}; } catch (_) {}
  try { localStorage.setItem(CB_COLS_KEY, JSON.stringify(Object.assign(cols, set))); } catch (_) {}
}

// The table resizes from its right edge, bottom edge and corner. Width goes to the Attacks column,
// the one with the most to show; height is the rows' own, and they scroll inside it.
function _cbResizePanel(handle, e) {
  const fight = document.getElementById('cb-fight'), list = document.getElementById('cb-list'), z = cbZoom();
  const dir = handle.dataset.rs, x0 = e.clientX, y0 = e.clientY;
  const atk0 = fight.querySelector('.cb-colhdr > span:last-child').getBoundingClientRect().width / z;
  const h0 = list.getBoundingClientRect().height / z;
  let atk = atk0, h = h0;
  const move = m => {
    if (dir !== 'b') fight.style.setProperty('--cb-atk', (atk = Math.round(Math.max(CB_COL_MIN.atk, atk0 + (m.clientX - x0) / z))) + 'px');
    if (dir !== 'r') fight.style.setProperty('--cb-list-h', (h = Math.round(Math.max(40, h0 + (m.clientY - y0) / z))) + 'px');
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    _cbSaveCols(dir === 'r' ? { atk } : dir === 'b' ? { listH: h } : { atk, listH: h });
    _cbPlaceFight(fight);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up, { once: true });
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
    _cbSaveCols({ [col]: width });
    _cbPlaceFight(fight);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up, { once: true });
}

// ── The Attacks cell: a double-click writes the DM's own line into the row's copy ──

function _cbEditAttacks(cell, r) {
  const sb = cbRowBlock(r), span = cell.querySelector('.cb-atk'), before = sb.quick !== undefined ? sb.quick : combatAttackLine(sb);
  span.textContent = before;
  span.contentEditable = 'plaintext-only';
  span.classList.add('editing');
  span.focus();
  getSelection().selectAllChildren(span);
  getSelection().collapseToEnd();
  const done = keep => {
    span.removeEventListener('keydown', key);
    span.removeEventListener('blur', blur);
    const t = span.textContent.trim();
    if (keep && t !== before) {
      sb.quick = t;
      r.sbChanged = true;
      cbSave();
      if (cbStatRowId() === r.id) cbOpenStat(r);
    }
    cbRender();
  };
  const key = e => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); done(true); }
    if (e.key === 'Escape') { e.preventDefault(); done(false); }
  };
  const blur = () => done(true);
  span.addEventListener('keydown', key);
  span.addEventListener('blur', blur);
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
  cbCloseFights();
  if (cbStatRowId()) cbCloseStat();
}

function _cbColHead(label, col) {
  return `<span><span class="lbl">${label}</span><i class="cb-colsize" data-col="${col}"></i></span>`;
}

function initCombatTracker() {
  _cbLoad();
  const fight = document.createElement('div');
  fight.id = 'cb-fight';
  fight.className = 'cb-panel';
  fight.innerHTML = `
    <div class="cb-head" data-drag><span id="cb-fightslot"></span>
      <button class="cb-iconbtn" id="cb-close" title="Close">${CB_ICON_X}</button></div>
    <div class="cb-colhdr"><span class="c sortable" id="cb-sort" title="Sort by initiative">Init ↓</span>${_cbColHead('Name', 'name')}${
      _cbColHead('HP', 'hp')}<span class="c">AC</span>${_cbColHead('Conditions', 'cond')}${_cbColHead('Attacks', 'atk')}</div>
    <div id="cb-list"></div>
    <i class="cb-rs" data-rs="r"></i><i class="cb-rs" data-rs="b"></i><i class="cb-rs" data-rs="br"></i>`;
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
      const rs = e.target.closest('.cb-rs');
      if (rs) { e.preventDefault(); _cbResizePanel(rs, e); return; }
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
      rowEl.classList.remove('low', 'dead');
      if (_cbHpClass(hp)) rowEl.classList.add(_cbHpClass(hp));
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
    if (e.ctrlKey && e.code === 'KeyD' && e.target.dataset.f) {
      const r = _cbRowOf(e.target);
      if (!r) return;
      e.preventDefault();
      const c = _cbDuplicateRow(r);
      const next = document.querySelector(`#cb-list .cb-row[data-id="${c.id}"] [data-f="${e.target.dataset.f}"]`);
      if (next) next.focus();
      return;
    }
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
    const rowEl = e.target.closest('.cb-row');
    if (rowEl && e.button === 0 && !e.target.closest('button, .cb-atk.editing')) _cbPressRow(rowEl, e);
  });
  list.addEventListener('click', e => {
    const t = e.target;
    if (t.closest('[data-add]')) { _cbAddRow('enemy'); return; }
    const r = _cbRowOf(t);
    if (!r) return;
    const b = t.closest('[data-b]');
    if (b) {
      const a = b.dataset.b;
      if (a === 'stat') { if (cbStatRowId() === r.id) { cbCloseStat(); cbRender(); } else cbOpenStat(r); }
      if (a === 'dup') _cbDuplicateRow(r);
      if (a === 'side') _cbSwitchSide(r);
      if (a === 'del') _cbRemoveRow(r);
      return;
    }
    const cell = t.closest('[data-cond]');
    if (!cell) return;
    if (_cbClosedOn === cell) _cbClosedOn = null;
    else _cbCondMenu(cell, r);
  });
  list.addEventListener('dblclick', e => {
    const cell = e.target.closest('.cb-cell.atk');
    if (cell && !e.target.closest('.cb-acts')) _cbEditAttacks(cell, _cbRowOf(cell));
  });
  fight.addEventListener('contextmenu', e => {
    if (e.target.closest('.cb-head') || e.target.closest('.cb-atk.editing')) return;
    e.preventDefault();
    const r = _cbRowOf(e.target);
    cbMenu(r ? _cbRowItems(r) : _cbAddItems(), { left: e.clientX, top: e.clientY, bottom: e.clientY });
  });

  document.getElementById('cb-sort').addEventListener('click', () => { cbState.rows = combatSortByInit(cbState.rows); cbSave(); cbRender(); });
  document.getElementById('cb-close').addEventListener('click', () => cbSetOpen(false));
  document.getElementById('btn-combat').addEventListener('click', () => cbSetOpen(fight.style.display !== 'block'));

  initCombatStatBlock();
  initBestiary();
  initCombatFights();
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
