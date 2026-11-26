// combatTracker.js — the fight table on the DM's screen, saved to localStorage as it changes and
// carried in backups (backup.js). combatFights.js owns the list of fights. Nothing here reaches the Player.

const CB_KEY = 'evermist.combat';
const CB_FIGHTS_KEY = 'evermist.combatFights';
const CB_POS_KEY = 'evermist.combatPos';
// The widths moved to a new key when Conditions joined the Name column; the old key stays as the previous release left it.
const CB_COLS_KEY = 'evermist.fightCols';
const CB_COLS_OLD_KEY = 'evermist.combatCols';
const CB_COL_MIN = { init: 36, name: 90, hp: 80, ac: 36, atk: 110 };
// The table's margin from the window's edges, in window px.
const CB_EDGE = 8;
const CB_CONDITIONS = ['Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible',
  'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious', 'Concentrating'];
const CB_ICON_X = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="2.5" y1="2.5" x2="9.5" y2="9.5"/><line x1="9.5" y1="2.5" x2="2.5" y2="9.5"/></svg>';

let _cbSaveTimer = null;
let _cbSaveFailed = false;
let _cbDiskOpen = null;   // the fight whose rows CB_KEY holds on disk

function cbZoom() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1.2;
}

// ── Saving ───────────────────────────────────────────────────────────────────

// `quiet`: the caller reports a failure itself, and later saves still get their own dialog.
function cbSave(quiet) {
  clearTimeout(_cbSaveTimer);
  _cbSaveTimer = null;
  try {
    const p = combatSavedParts(combatStampEdits(cbState, Date.now()));
    // Two keys cannot be written as one: after a switch the list goes first with the open fight's rows in it too.
    if (_cbDiskOpen !== cbState.openId) localStorage.setItem(CB_FIGHTS_KEY, JSON.stringify(p.moving));
    localStorage.setItem(CB_KEY, JSON.stringify(p.combat));
    _cbDiskOpen = cbState.openId;
    localStorage.setItem(CB_FIGHTS_KEY, JSON.stringify(p.fights)); syncNoteLocal(CB_KEY); syncNoteLocal(CB_FIGHTS_KEY);
    return true;
  } catch (err) {
    if (quiet) return false;
    console.error('Saving the fight failed:', err);
    // Once per session: a full store would otherwise raise a dialog on every keystroke.
    if (!_cbSaveFailed) messageDialog({ title: 'The fight is not being saved', message: t('Evermist could not write the fight table to disk, so it will be gone after a restart.') + '\n\n' + (err.message || err) });
    _cbSaveFailed = true;
    return false;
  }
}
function cbSaveSoon() {
  clearTimeout(_cbSaveTimer);
  _cbSaveTimer = setTimeout(cbSave, 400);
}
for (const e of ['beforeunload', 'pagehide']) window.addEventListener(e, () => { if (_cbSaveTimer) cbSave(true); });   // no timer fires while closing

function _cbRead(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (err) {
    console.error('The saved fight could not be read:', err);
    return null;
  }
}

function _cbLoad() {
  const read = _cbRead(CB_KEY), d = read || {};
  cbState = Object.assign({ rows: Array.isArray(d.rows) ? d.rows : [], blocks: d.blocks || {}, nextId: d.nextId || 1, edits: d.edits },
    combatFightsFrom(_cbRead(CB_FIGHTS_KEY), combatFightId, d.openId));
  _cbDiskOpen = d.openId || cbState.openId;
  // Entries imported before statBlockJoinHp read a split HP as its first half.
  const copies = cbState.fights.flatMap(f => combatFightRows(cbState, f)).map(r => r.sb).filter(Boolean);
  for (const b of Object.values(cbState.blocks).concat(copies)) b.hp = statBlockJoinHp(b.hp);
  if (combatBackfillUids(cbState.blocks, combatMintUid)) cbSaveSoon();
  if (read) bpPruneEntrySpent(cbState.blocks);   // never on a save that failed to read
}

// Null when there is nothing to carry, and the zip then looks exactly as it always did.
function cbBackupPayload() {
  const empty = cbState.fights.every(f => !combatFightRows(cbState, f).length);
  // A deletion is something to carry too, or deleting the last fight never leaves this computer.
  const gone = cbState.edits && (cbState.edits.goneFights || cbState.edits.goneBlocks);
  if (empty && cbState.fights.length < 2 && !Object.keys(cbState.blocks).length && !gone) return null;
  return JSON.stringify(combatBackupData(cbState));
}

function cbMergePayload(json) {
  let d;
  try { d = JSON.parse(json); if (!d || typeof d !== 'object') throw d; } catch (err) { return { ok: false, error: t('The fight in this file could not be read.') }; }
  cbState = combatMerge(cbState, { rows: Array.isArray(d.rows) ? d.rows : [], blocks: d.blocks || {},
    fights: Array.isArray(d.fights) ? d.fights : [], openId: d.openId, edits: d.edits }, combatFightId, Date.now());
  cbSave();
  cbRender();
  cbFightsTitle();
  return { ok: true };
}
// ── Row edits ────────────────────────────────────────────────────────────────

function _cbAddRow(side) {
  const r = { id: cbState.nextId++, init: '', name: '', hp: '', ac: '', conds: [], side, sbChanged: false };
  const before = cbState.rows.length;
  cbState.rows.splice(combatAddIndex(cbState.rows), 0, r);
  cbSave();
  cbRender();
  cbFightsTitle(); hintsFightRowAdded(before, r.id);
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
  r.side = r.side === 'ally' ? 'enemy' : 'ally';
  cbSave();
  cbRender();
}

// A row edit is an edit to its copy, and the copy's page in the Bestiary follows it.
function _cbRowEdited(r, field) {
  r.sbChanged = true;
  bcRowEdited(r, field);
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

// Ctrl+Z in the table puts a deleted row back where it was, while its fight is still the open one.
let _cbDeleted = [];   // [{ fightId, row, at }]

function _cbRenderKeepFocus(to) {
  const rowEl = to && to.closest && to.closest('#cb-list .cb-row'), f = to && to.dataset && to.dataset.f;
  cbRender();
  if (!rowEl || !f) return;
  const inp = document.querySelector(`#cb-list .cb-row[data-id="${rowEl.dataset.id}"] [data-f="${f}"]`);
  if (!inp) return;
  inp.focus();
  inp.setSelectionRange(inp.value.length, inp.value.length);
}

function _cbRemoveRow(r) {
  _cbDeleted.push({ fightId: cbState.openId, row: r, at: cbState.rows.indexOf(r) });
  cbState.rows = cbState.rows.filter(x => x !== r);
  document.getElementById('cb-fight').focus({ preventScroll: true });
  bcClose(r.id);
  cbSave();
  cbRender();
  cbFightsTitle();
}

function _cbUndoDelete() {
  const d = _cbDeleted.pop();
  if (!d) return false;
  if (d.fightId !== cbState.openId) { _cbDeleted = []; return false; }
  cbState.rows.splice(Math.min(d.at, cbState.rows.length), 0, d.row);
  cbSave();
  cbRender();
  cbFightsTitle();
  return true;
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
      multi ? `<span class="box${it.checked() ? ' on' : ''}"></span>` : ''}<span class="lb">${_cbEsc(it.label)}</span>${
      it.key ? `<span class="key">${it.key}</span>` : ''}${it.sub ? `<span class="sub">${uiIcon('next')}</span>` : ''}</div>`).join('');
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
    it.pick(rect);
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
  motionShow(m, 'menu', { from: owner || rect });
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
  // Its id goes at the press: whatever asks for #cb-menu from then on is asking about a menu that is shut.
  if (m) { m.removeAttribute('id'); motionHide(m, 'menu', { done: () => m.remove() }); }
  if (_cbMenuOwner) _cbMenuOwner.classList.remove('open');
  _cbMenuOwner = null;
  document.removeEventListener('mousedown', _cbMenuOutside, true);
  document.removeEventListener('keydown', _cbMenuKey, true);
}

// ── Dragging: the panels by their head, a row by a press that travels ────────

function _cbDragPanel(el, e) {
  const z = cbZoom();
  const sx = e.clientX / z - parseFloat(el.style.left || 0), sy = e.clientY / z - parseFloat(el.style.top || 0);
  const move = m => (el.id === 'cb-fight' ? _cbClampFight : cbClampPanel)(el, m.clientX / z - sx, m.clientY / z - sy);
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
    const rows = [...list.querySelectorAll('.cb-row:not(.cleaned)')];   // drag never reaches into the Defeated line
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
  // The neighbours slide apart and the dropped row settles into its place.
  const up = () => {
    window.removeEventListener('mousemove', move);
    clear();
    rowEl.classList.remove('dragging');
    motionRows(list, '.cb-row', el => el.dataset.id, () => {
      if (target && target !== rowEl) {
        const dest = _cbRowOf(target);
        cbState.rows = cbState.rows.filter(x => x !== moving);
        cbState.rows.splice(cbState.rows.indexOf(dest) + (below ? 1 : 0), 0, moving);
        cbSave();
      }
      cbRender();
    });
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up, { once: true });
}

// A column's width is a viewing preference, so it is kept apart from the fight and out of backups.
function cbCols() {
  let raw = null, old = null;
  try { raw = localStorage.getItem(CB_COLS_KEY); old = localStorage.getItem(CB_COLS_OLD_KEY); } catch (_) {}
  return combatReadCols(raw, old);
}

// A column _cbFitWidth shrank on a narrower window goes back to its saved or default width first.
function _cbApplyCols(el) {
  const cols = cbCols();
  for (const k of Object.keys(CB_COL_MIN)) {
    if (cols[k]) el.style.setProperty('--cb-' + k, cols[k] + 'px'); else el.style.removeProperty('--cb-' + k);
  }
  if (cols.listH) el.style.setProperty('--cb-list-h', cols.listH + 'px');
}

function _cbSaveCols(set) {
  const cols = cbCols();
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
    if (dir !== 'b') atk = _cbSetCol(fight, 'atk', atk0 + (m.clientX - x0) / z);
    if (dir !== 'r') {
      h = Math.min(Math.floor(_cbFitList(fight)), Math.round(Math.max(40, h0 + (m.clientY - y0) / z)));
      fight.style.setProperty('--cb-list-h', h + 'px');
    }
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    _cbSaveCols(dir === 'r' ? { atk } : dir === 'b' ? { listH: h } : { atk, listH: h });
    _cbPlaceFight(fight);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up, { once: true });
}

// A wider column never takes the table past the window: a right edge that would pass it pins there and the table
// moves left, and at the window's width less both margins the column stops. Returns the width written.
function _cbSetCol(fight, col, want) {
  const z = cbZoom();
  let width = Math.round(Math.max(CB_COL_MIN[col], want));
  fight.style.setProperty('--cb-' + col, width + 'px');
  const over = fight.getBoundingClientRect().width - (innerWidth - 2 * CB_EDGE);
  if (over > 0) fight.style.setProperty('--cb-' + col, (width = Math.max(CB_COL_MIN[col], Math.floor(width - over / z))) + 'px');
  _cbClampFight(fight, parseFloat(fight.style.left), parseFloat(fight.style.top));
  return width;
}

// Widths saved on a wider window give way, Attacks first, without touching what is saved.
function _cbFitWidth(el) {
  const z = cbZoom(), spans = el.querySelectorAll('.cb-colhdr > span');
  for (const k of ['atk', 'name', 'hp', 'ac', 'init']) {
    const over = el.getBoundingClientRect().width - (innerWidth - 2 * CB_EDGE);
    if (over <= 0) return;
    const w = spans[Object.keys(CB_COL_MIN).indexOf(k)].getBoundingClientRect().width / z;
    el.style.setProperty('--cb-' + k, Math.max(CB_COL_MIN[k], Math.floor(w - over / z)) + 'px');
  }
}

function _cbDragCol(handle, e) {
  const fight = document.getElementById('cb-fight'), col = handle.dataset.col, z = cbZoom();
  const start = handle.parentElement.getBoundingClientRect().width / z, x0 = e.clientX;
  let width = start;
  const move = m => { width = _cbSetCol(fight, col, start + (m.clientX - x0) / z); };
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
  span.dataset.ph = t('Attacks, spells, save DCs');
  span.focus();
  getSelection().selectAllChildren(span);
  getSelection().collapseToEnd();
  const done = keep => {
    span.removeEventListener('keydown', key);
    span.removeEventListener('blur', blur);
    const t = span.textContent.trim();
    if (keep && t !== before) {
      if (t) sb.quick = t; else delete sb.quick;
      r.sbChanged = true;
      cbSave();
      bcRefresh(r);
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

// The list grows down to the window's bottom edge from wherever the panel sits; a taller saved height scrolls in it.
function _cbFitList(el) {
  const z = cbZoom(), list = document.getElementById('cb-list'), lr = list.getBoundingClientRect();
  const room = (innerHeight - CB_EDGE - lr.top - (el.getBoundingClientRect().bottom - lr.bottom)) / z;
  list.style.maxHeight = Math.max(0, Math.floor(room)) + 'px';
  return room;
}

// A panel stays CB_EDGE inside the window. `keepH` is the height, in window px, that must stay in view
// downwards; the whole panel's when omitted.
function cbClampPanel(el, left, top, keepH) {
  const z = cbZoom(), r = el.getBoundingClientRect(), m = CB_EDGE / z;
  el.style.left = Math.max(m, Math.min(innerWidth / z - r.width / z - m, left)) + 'px';
  el.style.top = Math.max(m, Math.min(innerHeight / z - m - (keepH === undefined ? r.height : keepH) / z, top)) + 'px';
}

// Downwards the fight table keeps its header, column titles and one row in view, and the list gives up the rest.
function _cbClampFight(el, left, top) {
  const z = cbZoom(), list = document.getElementById('cb-list');
  const r = el.getBoundingClientRect(), lr = list.getBoundingClientRect();
  const row = list.firstElementChild ? list.firstElementChild.getBoundingClientRect().height : 40 * z;
  cbClampPanel(el, left, top, lr.top - r.top + row + r.bottom - lr.bottom);
  _cbFitList(el);
}

function _cbPlaceFight(el) {
  const z = cbZoom();
  let pos = null;
  try { pos = JSON.parse(localStorage.getItem(CB_POS_KEY) || 'null'); } catch (_) {}
  _cbApplyCols(el);
  _cbFitWidth(el);
  const w = el.getBoundingClientRect().width / z;
  _cbClampFight(el, pos ? pos.left : innerWidth / z - w - CB_EDGE / z, pos ? pos.top : 64 / z);
}

function cbIsOpen() { return motionOpen(document.getElementById('cb-fight')); }

function cbSetOpen(open) {
  const el = document.getElementById('cb-fight'), btn = document.getElementById('btn-combat');
  if (open) motionShow(el, 'window', { from: btn, reveal: () => { el.style.display = 'block'; cbRender(); cbFightsTitle(); _cbPlaceFight(el); } });
  else motionHide(el, 'window', { from: btn, glow: true, done: () => { el.style.display = 'none'; } });
  btn.classList.toggle('active', open);
  dockRefreshRail();
  if (open) { hintsFightOpened(cbState.rows.length); return; }
  cbCloseMenu(); cbCloseFights(); hintsFightClosed();
  bcClose();
}

function _cbColHead(label, col, attrs = '') {
  return `<span${attrs}><span class="lbl">${label}</span><i class="cb-colsize" data-col="${col}"></i></span>`;
}

function initCombatTracker() {
  _cbLoad();
  const fight = document.createElement('div');
  fight.id = 'cb-fight';
  fight.className = 'cb-panel';
  fight.tabIndex = -1;
  fight.innerHTML = `
    ${cbHeadHtml()}
    <div class="cb-colhdr">${_cbColHead('Init', 'init', ' class="c cb-initsort" title="Sort by initiative"')}${_cbColHead('Name', 'name')}${
      _cbColHead('HP', 'hp')}${_cbColHead('AC', 'ac', ' class="c"')}<span><span class="lbl">Attacks</span></span></div>
    <div id="cb-list"></div>
    <i class="cb-rs" data-rs="r"></i><i class="cb-rs" data-rs="b"></i><i class="cb-rs" data-rs="br"></i>`;
  document.body.append(fight);
  _cbApplyCols(fight);
  window.addEventListener('resize', () => { if (cbIsOpen()) _cbPlaceFight(fight); });

  // The map's own handlers listen on the document; nothing typed or clicked here is theirs.
  fight.addEventListener('keydown', e => {
    if (e.key !== 'Escape') e.stopPropagation();
    const text = e.target.matches('input, textarea, [contenteditable]:not([contenteditable="false"])');
    if (!text && (e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey && _cbUndoDelete()) e.preventDefault();
  });
  fight.addEventListener('mousedown', e => {
    e.stopPropagation();
    const size = e.target.closest('.cb-colsize');
    if (size) { e.preventDefault(); _cbDragCol(size, e); return; }
    const rs = e.target.closest('.cb-rs');
    if (rs) { e.preventDefault(); _cbResizePanel(rs, e); return; }
    // A press on a control or a field is that control's; only the header's empty space drags.
    const head = e.target.closest('[data-drag]');
    if (head && !e.target.closest('button, input, label, .sm-field, [contenteditable]')) { e.preventDefault(); _cbDragPanel(fight, e); }
  });

  const list = document.getElementById('cb-list');
  list.addEventListener('input', e => {
    const f = e.target.dataset.f, r = _cbRowOf(e.target);
    if (!f || !r) return;
    r[f] = e.target.value;
    const sb = cbRowBlock(r);
    if (f === 'hp') {
      const hp = combatRowHpState(combatFirstNum(sb.hp), r.hp), rowEl = e.target.closest('.cb-row');
      e.target.nextElementSibling.innerHTML = _cbSumHtml(hp.value);
      rowEl.classList.remove('low', 'dead');
      if (_cbHpClass(hp)) rowEl.classList.add(_cbHpClass(hp));
      cbHpWiden(e.target);
    }
    if (f === 'ac') { sb.ac = combatSetFirstNum(sb.ac, r.ac.trim()); _cbRowEdited(r, 'ac'); }
    if (f === 'name') {
      sb.name = combatBaseName(r.name);
      _cbRowEdited(r, 'name');
      _cbSuggest(e.target, r);
    }
    cbSaveSoon(); cbSortRefresh();
  });
  list.addEventListener('focusin', e => {
    if (e.target.dataset.f !== 'hp') return;
    const i = e.target;
    cbHpFocus(i);
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
    if (r && e.target.dataset.f === 'hp') {
      _cbTakeMax(r);
      const cell = e.target.closest('.cb-cell.hp');
      cell.classList.remove('wide');
      cell.style.marginRight = '';
      const revived = combatReviveRows([r]);
      e.target.closest('.cb-row').classList.toggle('gone', combatIsDefeated(r));
      cbHeadRefresh();
      // A row that leaves the Defeated line moves at once, and the field the DM moved to keeps the focus.
      if (revived) {
        cbSave();
        _cbRenderKeepFocus(e.relatedTarget);
        return;
      }
    }
    cbSave();
    setTimeout(() => { if (!list.contains(document.activeElement)) cbRender(); });
  });
  list.addEventListener('mousedown', e => {
    const rowEl = e.target.closest('.cb-row:not(.cleaned)');
    // A focused action button would light the Attacks cell's :focus-within ring as if it were being edited.
    if (e.target.closest('.cb-acts button, .cb-addcond')) e.preventDefault();
    if (rowEl && e.button === 0 && !e.target.closest('button, .cb-atk.editing')) _cbPressRow(rowEl, e);
  });
  initCombatRows(fight, list);

  document.getElementById('cb-close').addEventListener('click', () => cbSetOpen(false));
  document.getElementById('btn-combat').addEventListener('click', () => cbSetOpen(!cbIsOpen()));

  initBestiary();
  initCombatHead(); initCombatFights(); initCombatSort(); initInitiativeTv();
}
