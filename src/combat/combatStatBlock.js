// combatStatBlock.js — the stat block editor. bestiaryPage.js puts it on an entry's page and bestiaryCopy.js on a
// fight row's copy, which reaches the bestiary only through Save to Bestiary. combatTracker.js owns saving.

const CB_SECTIONS = ['Traits', 'Actions', 'Bonus actions', 'Reactions', 'Legendary actions', 'Mythic actions', 'Lair actions'];
const CB_ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const CB_LINES = [['ac', 'Armor Class'], ['hp', 'Hit Points'], ['speed', 'Speed']];
const CB_DETAILS = [['saves', 'Saving Throws'], ['skills', 'Skills'], ['vuln', 'Vulnerabilities'], ['resist', 'Damage Resistances'],
  ['immune', 'Immunities'], ['senses', 'Senses'], ['languages', 'Languages'], ['cr', 'Challenge']];

function cbNewBlock(name) {
  const id = combatNextBlockId(cbState.blocks);
  cbState.blocks[id] = Object.assign(combatBlankBlock(id, name), { uid: combatMintUid() });
  return cbState.blocks[id];
}

// A row typed by hand gets an empty copy of its own, for this fight only.
function cbRowBlock(row) {
  if (!row.sb) row.sb = combatSnapshot(combatBlankBlock('', combatBaseName(row.name)));
  return row.sb;
}

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
    // An emptied Table line is no line of the DM's own, so the pills come back.
    if (p === 'quick' && !b.quick.trim()) delete b.quick;
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
