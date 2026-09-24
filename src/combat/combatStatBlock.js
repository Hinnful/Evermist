// combatStatBlock.js — the stat block that opens beside the fight table, and the library of
// blocks behind it. combatTracker.js owns saving; this file reads and edits cbState.blocks.

const CB_SECTIONS = ['Traits', 'Actions', 'Bonus actions', 'Reactions', 'Legendary actions', 'Lair actions'];
const CB_ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const CB_LINES = [['ac', 'Armor Class'], ['hp', 'Hit Points'], ['speed', 'Speed']];
const CB_DETAILS = [['saves', 'Saving Throws'], ['skills', 'Skills'], ['resist', 'Damage Resistances'],
  ['immune', 'Immunities'], ['senses', 'Senses'], ['languages', 'Languages'], ['cr', 'Challenge']];

let _cbStatRowId = null;

function _cbBlankBlock(name) {
  return { name, meta: '', ac: '', hp: '', speed: '', abil: ['10', '10', '10', '10', '10', '10'],
    saves: '', skills: '', resist: '', immune: '', senses: '', languages: '', cr: '', secs: {} };
}

// Filed under the row's name without its copy number, so all four skeletons open one block.
function cbBlockFor(row) {
  const key = combatBaseName(row.name) || 'Unnamed';
  if (!cbState.blocks[key]) cbState.blocks[key] = _cbBlankBlock(key);
  return cbState.blocks[key];
}

function cbStatRowId() { return _cbStatRowId; }

function _cbEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// plaintext-only keeps a paste from a website from bringing its markup in with it.
function _cbEd(path, val, ph, cls, tag) {
  const t = tag || 'span';
  return `<${t} class="${cls || ''}" contenteditable="plaintext-only" spellcheck="false" data-p="${path}" data-ph="${ph}">${_cbEsc(val)}</${t}>`;
}

function cbOpenStat(row) {
  _cbStatRowId = row.id;
  const b = cbBlockFor(row), el = document.getElementById('cb-stat');
  const shared = cbState.rows.filter(r => (combatBaseName(r.name) || 'Unnamed') === b.name).length;
  const secs = CB_SECTIONS.filter(s => b.secs[s]).map(s => `
    <div class="cb-sb-sec" data-sec="${s}">
      <div class="cb-sb-sechd">${s}<button class="cb-iconbtn" data-delsec title="Remove section">${CB_ICON_X}</button></div>
      ${b.secs[s].map((en, i) => `<div class="cb-sb-entry">${_cbEd(`secs.${s}.${i}.n`, en.n, 'Name.', 'n')} ${_cbEd(`secs.${s}.${i}.t`, en.t, 'What it does')}
        <button class="cb-iconbtn x" data-delentry="${i}" title="Remove">${CB_ICON_X}</button></div>`).join('')}
      <div class="cb-sb-add" data-addentry>+ Add</div>
    </div>`).join('');
  el.innerHTML = `
    <div class="cb-head" data-drag>
      ${CB_ICON_GRIP}
      <div class="cp-tabs cb-side-switch">
        <button class="cp-segtab ${row.side === 'enemy' ? 'active' : ''}" data-side="enemy">Enemy</button>
        <button class="cp-segtab ${row.side === 'ally' ? 'active' : ''}" data-side="ally">Ally</button>
      </div>
      <button class="cb-iconbtn" data-close title="Close">${CB_ICON_X}</button>
    </div>
    <div class="cb-sb">
      <div class="cb-sb-name">${_cbEsc(b.name)}</div>
      ${_cbEd('meta', b.meta, 'Size, type, alignment', 'cb-sb-meta', 'div')}
      <div class="cb-sb-rule"></div>
      ${CB_LINES.map(([k, label]) => `<div class="cb-sb-line"><b>${label}</b> ${_cbEd(k, b[k], '—')}</div>`).join('')}
      <div class="cb-sb-rule"></div>
      <div class="cb-sb-abil">${CB_ABILITIES.map((k, i) => `<div><div class="k">${k}</div>
        ${_cbEd('abil.' + i, b.abil[i], '10', 'v')}<div class="m" data-mod="${i}">(${combatAbilityMod(b.abil[i])})</div></div>`).join('')}</div>
      <div class="cb-sb-rule"></div>
      ${CB_DETAILS.map(([k, label]) => `<div class="cb-sb-line"><b>${label}</b> ${_cbEd(k, b[k], '—')}</div>`).join('')}
      ${secs}
      <div class="cb-sb-add cb-sb-addsec" data-addsec>+ Add section</div>
      ${shared > 1 ? `<div class="cb-sb-shared">${shared} rows in this fight share this block. An edit here changes all of them.</div>` : ''}
    </div>`;
  if (el.style.display !== 'block') _cbPlaceBeside(el);
  cbRender();
}

function cbCloseStat() {
  document.getElementById('cb-stat').style.display = 'none';
  _cbStatRowId = null;
}

function _cbPlaceBeside(el) {
  const z = cbZoom(), p = document.getElementById('cb-fight').getBoundingClientRect();
  el.style.display = 'block';
  const w = el.getBoundingClientRect().width;
  let left = p.left - w - 10;
  if (left < 8) left = p.right + 10 + w < innerWidth ? p.right + 10 : 8;
  el.style.left = (left / z) + 'px';
  el.style.top = (Math.max(8, p.top) / z) + 'px';
}

function _cbStatRow() { return cbState.rows.find(r => r.id === _cbStatRowId); }

function initCombatStatBlock() {
  const el = document.getElementById('cb-stat');
  el.addEventListener('input', e => {
    const p = e.target.dataset.p, row = _cbStatRow();
    if (!p || !row) return;
    const parts = p.split('.');
    let o = cbBlockFor(row);
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = e.target.textContent;
    if (parts[0] === 'abil') el.querySelector(`[data-mod="${parts[1]}"]`).textContent = `(${combatAbilityMod(e.target.textContent)})`;
    cbSaveSoon();
  });
  el.addEventListener('keydown', e => {
    // Enter ends a one-line field; an entry's description keeps its line breaks.
    if (e.key === 'Enter' && e.target.dataset.p && !/\.t$/.test(e.target.dataset.p)) { e.preventDefault(); e.target.blur(); }
  });
  el.addEventListener('click', e => {
    const t = e.target, row = _cbStatRow();
    if (t.closest('[data-close]')) { cbCloseStat(); cbRender(); return; }
    if (!row) return;
    const b = cbBlockFor(row);
    const side = t.closest('[data-side]');
    if (side) { row.side = side.dataset.side; cbSave(); cbOpenStat(row); return; }
    const secEl = t.closest('[data-sec]'), sec = secEl && secEl.dataset.sec;
    if (t.closest('[data-delsec]')) { delete b.secs[sec]; cbSave(); cbOpenStat(row); return; }
    const del = t.closest('[data-delentry]');
    if (del) { b.secs[sec].splice(+del.dataset.delentry, 1); cbSave(); cbOpenStat(row); return; }
    if (t.closest('[data-addentry]')) {
      b.secs[sec].push({ n: '', t: '' }); cbSave(); cbOpenStat(row);
      const names = el.querySelectorAll(`[data-sec="${sec}"] .n`);
      names[names.length - 1].focus();
      return;
    }
    if (t.closest('[data-addsec]')) {
      const open = CB_SECTIONS.filter(s => !b.secs[s]);
      if (!open.length) return;
      cbMenu(open.map(s => ({ label: s, pick: () => { b.secs[s] = [{ n: '', t: '' }]; cbSave(); cbOpenStat(row); } })), t.getBoundingClientRect());
    }
  });
}
