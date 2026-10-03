// combatStatBlock.js — the stat block editor, and the popup beside the fight table that holds it.
// The popup edits that row's own copy, which reaches the bestiary only through Save to Bestiary;
// bestiaryPage.js puts the same editor on an entry's page. combatTracker.js owns saving.

const CB_SECTIONS = ['Traits', 'Actions', 'Bonus actions', 'Reactions', 'Legendary actions', 'Mythic actions', 'Lair actions'];
const CB_ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const CB_LINES = [['ac', 'Armor Class'], ['hp', 'Hit Points'], ['speed', 'Speed']];
const CB_DETAILS = [['saves', 'Saving Throws'], ['skills', 'Skills'], ['vuln', 'Vulnerabilities'], ['resist', 'Damage Resistances'],
  ['immune', 'Immunities'], ['senses', 'Senses'], ['languages', 'Languages'], ['cr', 'Challenge']];

const CB_STAT_MIN = { w: 320, h: 120 };

let _cbStatRowId = null;

function cbNewBlock(name) {
  const id = combatNextBlockId(cbState.blocks);
  cbState.blocks[id] = combatBlankBlock(id, name);
  return cbState.blocks[id];
}

// A row typed by hand gets an empty copy of its own, for this fight only.
function cbRowBlock(row) {
  if (!row.sb) row.sb = combatSnapshot(combatBlankBlock('', combatBaseName(row.name)));
  return row.sb;
}

function cbStatRowId() { return _cbStatRowId; }

function _cbEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// plaintext-only keeps a paste from a website from bringing its markup in with it.
function _cbEd(path, val, ph, cls, tag) {
  const tg = tag || 'span';
  return `<${tg} class="${cls || ''}" contenteditable="plaintext-only" spellcheck="false" data-p="${path}" data-ph="${_cbEsc(t(ph))}">${_cbEsc(val)}</${tg}>`;
}

function cbEditorHtml(b) {
  const secs = CB_SECTIONS.filter(s => b.secs[s]).map(s => `
    <div class="cb-sb-sec" data-sec="${s}">
      <div class="cb-sb-sechd">${s}<button class="cb-iconbtn" data-delsec title="Remove section">${CB_ICON_X}</button></div>
      ${b.secs[s].map((en, i) => `<div class="cb-sb-entry">${_cbEd(`secs.${s}.${i}.n`, en.n, 'Name.', 'n')} ${_cbEd(`secs.${s}.${i}.t`, en.t, 'What it does')}
        <button class="cb-iconbtn x" data-delentry="${i}" title="Remove">${CB_ICON_X}</button></div>`).join('')}
      <div class="cb-sb-add" data-addentry>+ Add</div>
    </div>`).join('');
  return `
    <div class="cb-sb">
      ${_cbEd('name', b.name, 'Name', 'cb-sb-name', 'div')}
      ${_cbEd('meta', b.meta, 'Size, type, alignment', 'cb-sb-meta', 'div')}
      <div class="cb-sb-source">Source ${_cbEd('source', b.source, 'none')}</div>
      <div class="cb-sb-rule"></div>
      ${CB_LINES.map(([k, label]) => `<div class="cb-sb-line"><b>${label}</b> ${_cbEd(k, b[k], '—')}</div>`).join('')}
      <div class="cb-sb-rule"></div>
      <div class="cb-sb-abil">${CB_ABILITIES.map((k, i) => `<div><div class="k">${k}</div>
        ${_cbEd('abil.' + i, b.abil[i], '10', 'v')}<div class="m" data-mod="${i}">(${combatAbilityMod(b.abil[i])})</div></div>`).join('')}</div>
      <div class="cb-sb-rule"></div>
      ${CB_DETAILS.map(([k, label]) => `<div class="cb-sb-line"><b>${label}</b> ${_cbEd(k, b[k], '—')}</div>`).join('')}
      <div class="cb-sb-line"><b>Table line</b> ${_cbEd('quick', b.quick === undefined ? '' : b.quick, b.quick === undefined ? combatAttackLine(b) || '—' : '—')}</div>
      ${secs}
      <div class="cb-sb-add cb-sb-addsec" data-addsec>+ Add section</div>
    </div>`;
}

function cbOpenStat(row) {
  _cbStatRowId = row.id;
  const el = document.getElementById('cb-stat');
  el.innerHTML = `
    <div class="cb-head" data-drag>
      <div class="cp-tabs cb-side-switch">
        <button class="cp-segtab ${row.side === 'enemy' ? 'active' : ''}" data-side="enemy">Enemy</button>
        <button class="cp-segtab ${row.side === 'ally' ? 'active' : ''}" data-side="ally">Ally</button>
      </div>
      <button class="sm-hbtn cb-save" data-save ${row.sbChanged ? '' : 'disabled'}>Save to Bestiary</button>
      <button class="cb-iconbtn" data-close title="Close">${uiIcon('x')}</button>
    </div>
    ${cbEditorHtml(cbRowBlock(row))}
    <i class="cb-rs" data-rs="r"></i><i class="cb-rs" data-rs="b"></i><i class="cb-rs" data-rs="br"></i>`;
  if (el.style.display !== 'block') _cbPlaceBeside(el, document.getElementById('cb-fight'));
  cbRender();
}

function cbCloseStat() {
  document.getElementById('cb-stat').style.display = 'none';
  _cbStatRowId = null;
}

function _cbPlaceBeside(el, beside) {
  const z = cbZoom(), p = beside.getBoundingClientRect();
  el.style.display = 'block';
  const w = el.getBoundingClientRect().width;
  let left = p.left - w - 10;
  if (left < 8) left = p.right + 10 + w < innerWidth ? p.right + 10 : 8;
  el.style.left = (left / z) + 'px';
  el.style.top = (Math.max(8, p.top) / z) + 'px';
}

// The popup resizes from its right edge, bottom edge and corner, and the next one opens at that size.
function cbResizeStat(handle, e) {
  const el = document.getElementById('cb-stat'), sb = el.querySelector('.cb-sb'), z = cbZoom();
  const dir = handle.dataset.rs, x0 = e.clientX, y0 = e.clientY;
  const box = el.getBoundingClientRect(), sbBox = sb.getBoundingClientRect();
  const w0 = box.width / z, h0 = sbBox.height / z;
  const wMax = (innerWidth - box.left) / z - 8, hMax = (innerHeight - sbBox.top) / z - 8;
  let w = w0, h = h0;
  const move = m => {
    if (dir !== 'b') el.style.setProperty('--cb-stat-w', (w = Math.round(Math.min(wMax, Math.max(CB_STAT_MIN.w, w0 + (m.clientX - x0) / z)))) + 'px');
    if (dir !== 'r') el.style.setProperty('--cb-stat-h', (h = Math.round(Math.min(hMax, Math.max(CB_STAT_MIN.h, h0 + (m.clientY - y0) / z)))) + 'px');
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    _cbSaveCols(dir === 'r' ? { statW: w } : dir === 'b' ? { statH: h } : { statW: w, statH: h });
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up, { once: true });
}

function _cbStatRow() { return cbState.rows.find(r => r.id === _cbStatRowId); }

// An edit to a row's copy lights Save to Bestiary, and its name, AC and max HP are the row's too.
function _cbCopyEdited(row, field) {
  const sb = row.sb;
  if (field === 'name') {
    const n = (row.name.match(/\s+\d+$/) || [''])[0];
    row.name = sb.name.trim() + n;
  }
  if (field === 'ac') row.ac = combatFirstNum(sb.ac);
  if (!row.sbChanged) {
    row.sbChanged = true;
    const btn = document.querySelector('#cb-stat [data-save]');
    if (btn) { btn.disabled = false; btn.textContent = 'Save to Bestiary'; }
  }
  if (field === 'name' || field === 'ac' || field === 'hp' || field === 'quick') cbRender();
}

function _cbSaveToBestiary(row) {
  combatAddEntry(cbState.blocks, row.sb);
  row.sbChanged = false;
  cbSave();
  cbOpenStat(row);
  document.querySelector('#cb-stat [data-save]').textContent = 'Saved';
}

// The editor's typing and its section buttons, wherever it sits. `ed.block()` is what it edits,
// `ed.edited(field)` hears every change, and `ed.redraw()` puts the editor back after one.
function cbWireEditor(el, ed) {
  el.addEventListener('input', e => {
    const p = e.target.dataset.p, b = ed.block();
    if (!p || !b) return;
    const parts = p.split('.');
    let o = b;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = e.target.textContent;
    if (parts[0] === 'abil') el.querySelector(`[data-mod="${parts[1]}"]`).textContent = `(${combatAbilityMod(e.target.textContent)})`;
    ed.edited(parts[0]);
    cbSaveSoon();
  });
  el.addEventListener('keydown', e => {
    // Enter ends a one-line field; an entry's description keeps its line breaks.
    if (e.key === 'Enter' && e.target.dataset.p && !/\.t$/.test(e.target.dataset.p)) { e.preventDefault(); e.target.blur(); }
  });
  el.addEventListener('click', e => {
    const t = e.target, b = ed.block();
    if (!b) return;
    const secEl = t.closest('[data-sec]'), sec = secEl && secEl.dataset.sec;
    const changed = () => { ed.edited('secs'); cbSave(); ed.redraw(); };
    if (t.closest('[data-delsec]')) { delete b.secs[sec]; return changed(); }
    const del = t.closest('[data-delentry]');
    if (del) { b.secs[sec].splice(+del.dataset.delentry, 1); return changed(); }
    if (t.closest('[data-addentry]')) {
      b.secs[sec].push({ n: '', t: '' });
      changed();
      const names = el.querySelectorAll(`[data-sec="${sec}"] .n`);
      names[names.length - 1].focus();
      return;
    }
    if (t.closest('[data-addsec]')) {
      const open = CB_SECTIONS.filter(s => !b.secs[s]);
      if (!open.length) return;
      cbMenu(open.map(s => ({ label: s, pick: () => { b.secs[s] = [{ n: '', t: '' }]; changed(); } })), t.getBoundingClientRect());
    }
  });
}

function initCombatStatBlock() {
  const el = document.getElementById('cb-stat');
  let cols = {};
  try { cols = JSON.parse(localStorage.getItem(CB_COLS_KEY) || '{}') || {}; } catch (_) {}
  if (cols.statW) el.style.setProperty('--cb-stat-w', cols.statW + 'px');
  if (cols.statH) el.style.setProperty('--cb-stat-h', cols.statH + 'px');
  cbWireEditor(el, {
    block: () => { const row = _cbStatRow(); return row && cbRowBlock(row); },
    edited: field => { const row = _cbStatRow(); if (row) _cbCopyEdited(row, field); },
    redraw: () => { const row = _cbStatRow(); if (row) cbOpenStat(row); },
  });
  el.addEventListener('click', e => {
    const t = e.target, row = _cbStatRow();
    if (t.closest('[data-close]')) { cbCloseStat(); cbRender(); return; }
    if (!row) return;
    const side = t.closest('[data-side]');
    if (side) { row.side = side.dataset.side; cbSave(); cbOpenStat(row); return; }
    if (t.closest('[data-save]')) _cbSaveToBestiary(row);
  });
}
