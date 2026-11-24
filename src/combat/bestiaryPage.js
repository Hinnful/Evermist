// bestiaryPage.js — a bestiary monster's page: AC and HP, the abilities, the lines, its traits and
// actions with a caster's spells as rows of crystals, then its lore and the DM's notes. Edit keeps the same page and
// makes each value typeable in place (combatStatBlock.js wires the typing).
const BP_LINES = [['skills', 'Skills'], ['vuln', 'Vulnerabilities'], ['resist', 'Resistances'], ['immune', 'Immunities'],
  ['senses', 'Senses'], ['languages', 'Languages']];

// Every line edit mode can show, in the order "Add line" offers the missing ones.
const BP_EDIT_LINES = [['saves', 'Saving Throws'], ['skills', 'Skills'], ['vuln', 'Vulnerabilities'], ['resist', 'Resistances'],
  ['immune', 'Immunities'], ['senses', 'Senses'], ['languages', 'Languages'], ['cr', 'Challenge'], ['quick', 'Table line']];

const _bpShut = new Set();

function _bpMarked(text) {
  return _cbEsc(text)
    .replace(/(\d+\s*[dк]\s*\d+(\s*[+\-−]\s*\d+)?)/g, '<span class="bp-hi">$1</span>')
    .replace(/([+\-−]\d+)(?=\s(to hit|к попаданию))/g, '<span class="bp-hi">$1</span>')
    .replace(/\n/g, '<br>');
}

// ── Spells as rows (BACKLOG 304) ──
// A crystal spent on an entry belongs to this computer: its own key, outside sync and backup, never an edit of the
// entry. A fight copy's live on the row, `spent`, and travel with the fight.
const BP_SPENT_KEY = 'evermist.entrySpent';
const BP_GEM = '<svg viewBox="0 0 9 13"><polygon class="f" points="4.5,0.6 8.4,4 8.4,9 4.5,12.4 0.6,9 0.6,4"/><polygon class="t" points="4.5,0.6 8.4,4 4.5,5.4 0.6,4"/><polygon class="o" points="4.5,0.8 8.3,4.05 8.3,8.95 4.5,12.2 0.7,8.95 0.7,4.05"/></svg>';

function _bpSpentAll() {
  try { const v = JSON.parse(localStorage.getItem(BP_SPENT_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; }
}

function bpEntrySpent(b) { return (b && b.uid && _bpSpentAll()[b.uid]) || {}; }

function _bpWriteSpent(all) {
  try { localStorage.setItem(BP_SPENT_KEY, JSON.stringify(all)); } catch (err) { console.error('Saving spent spell slots failed:', err); }
}

function _bpSetEntrySpent(b, spent) {
  if (!b || !b.uid) return;
  const all = _bpSpentAll();
  if (Object.keys(spent).length) all[b.uid] = spent; else delete all[b.uid];
  _bpWriteSpent(all);
}

// At start-up: a deleted entry's crystals go with it.
function bpPruneEntrySpent(blocks) {
  const all = _bpSpentAll(), uids = new Set(Object.values(blocks).map(b => b.uid));
  const gone = Object.keys(all).filter(u => !uids.has(u));
  if (!gone.length) return;
  for (const u of gone) delete all[u];
  _bpWriteSpent(all);
}

function _bpCellClass(i, n, s) { return i >= n - s ? 'off' : ''; }

function _bpCells(key, n, spent) {
  const s = spellSpent(spent, key, n);
  let h = `<span class="sp-pp" data-sk="${_cbEsc(key)}" data-sn="${n}">`;
  for (let i = 0; i < n; i++) h += `<i class="${_bpCellClass(i, n, s)}">${BP_GEM}</i>`;
  return h + '</span>';
}

function _bpChip(g) {
  const n = g.kind === 'slots' ? (g.label.replace(/^l/, '1').match(/\d/) || [''])[0] : g.n;
  const chip = g.kind === 'will' ? '∞' : t(g.kind === 'slots' ? '{n} lvl' : g.kind === 'day' ? '{n}/day' : '{n}/day each', { n });
  return g.qual ? chip + ' ' + g.qual : chip;
}

function _bpSpells(e, r, spent) {
  const keys = spellKeys(e.n, r.groups);
  const rows = r.groups.map((g, gi) => {
    const key = keys[gi].key;
    const lv = `<span class="sp-lv" title="${_cbEsc(g.label)}"><span class="tx">${_cbEsc(_bpChip(g))}</span>${g.kind === 'slots' || g.kind === 'day' ? _bpCells(key, g.n, spent) : ''}</span>`;
    return `<div class="sp-grp">${lv}${g.spells.map((sp, si) => {
      const each = g.kind === 'dayEach', k = each ? keys[gi].spells[si] : '';
      return `<span class="sp-sp${each && spellSpent(spent, k, g.n) >= g.n ? ' done' : ''}"><span class="tx">${_cbEsc(sp.name)}${
        sp.note ? ` <span class="tag">${_cbEsc(sp.note)}</span>` : ''}</span>${each ? _bpCells(k, g.n, spent) : ''}</span>`;
    }).join('')}</div>`;
  }).join('');
  return `<div class="sp-cast"><p class="lead">${e.n ? `<span class="n">${_cbEsc(e.n)}.</span> ` : ''}${_bpMarked(r.lead)}</p>${rows}${
    r.tail ? `<p>${_bpMarked(r.tail)}</p>` : ''}</div>`;
}

// Editing, a caster's spells are its text again, so the rows come back from what was typed.
function _bpEntry(e, spent, ed) {
  if (ed) {
    const p = `secs.${ed.sec}.${ed.i}`;
    return `<p class="bp-ent">${_cbEd(p + '.n', e.n, 'Entry name', 'n')}<span class="n bp-dot">.</span> ${_cbEd(p + '.t', e.t, 'What it does', 'bp-t')}`
      + `<button tabindex="-1" class="cb-iconbtn bp-x" data-delentry="${ed.i}" title="${_cbEsc(t('Remove'))}">${CB_ICON_X}</button></p>`;
  }
  const r = spellcastingRead(e.n, e.t);
  return r ? _bpSpells(e, r, spent) : `<p>${e.n ? `<span class="n">${_cbEsc(e.n)}.</span> ` : ''}${_bpMarked(e.t)}</p>`;
}

// One listener for both pages, so a click is counted once: the open page says whose crystals they are.
function bpWireSpells(el) {
  el.addEventListener('click', e => {
    const cell = e.target.closest('.sp-pp > i');
    if (!cell || bs.editing) return;
    const pp = cell.parentElement, key = pp.dataset.sk, n = +pp.dataset.sn, row = bcRow(), b = !row && cbState.blocks[bs.open];
    if (!row && !b) return;
    const spent = spellToggle(row ? row.spent : bpEntrySpent(b), key, n, !cell.classList.contains('off'));
    if (row) { if (Object.keys(spent).length) row.spent = spent; else delete row.spent; cbSave(); } else _bpSetEntrySpent(b, spent);
    const s = spellSpent(spent, key, n);
    [...pp.children].forEach((c, i) => { c.className = _bpCellClass(i, n, s); });
    if (pp.parentElement.classList.contains('sp-sp')) pp.parentElement.classList.toggle('done', s >= n);
  });
}

function _bpSection(key, title, body, del) {
  return `<div class="bp-sec ${_bpShut.has(key) ? 'shut' : ''}" data-fold="${key}"${del ? ` data-sec="${key}"` : ''}>
    <div class="bp-sec-h"><span class="car">▼</span>${t(title)}${del
  ? `<button tabindex="-1" class="cb-iconbtn bp-sx" data-delsec title="${_cbEsc(t('Remove section'))}">${CB_ICON_X}</button>` : ''}</div><div class="bp-sec-b">${body}</div></div>`;
}

// The sign hangs to the left of the digits, so a column of numbers centres on the digits alone.
function _bpSigned(v) {
  const m = String(v).match(/^([+\-−])(.*)$/);
  return m ? `<span class="bp-sn"><span class="sg">${m[1]}</span>${_cbEsc(m[2])}</span>` : _cbEsc(v);
}

function _bpAbMod(b, i) { return _bpSigned(combatAbilityMod(b.abil[i])); }
function _bpAbSave(b, i) { return _bpSigned(bsSave(b, i).value); }

// A score typed in edit mode moves its modifier, its save and Initiative at once.
function bpAbilSync(el, b, i) {
  const set = (sel, html) => { const x = el.querySelector(sel); if (x) x.innerHTML = html; };
  set(`[data-mod="${i}"]`, _bpAbMod(b, i));
  set(`[data-save="${i}"]`, _bpAbSave(b, i));
  if (+i === 1) set('[data-init]', _bpAbMod(b, 1));
}

function _bpAbilities(b, ed) {
  return `<div class="bp-ab-cap"><span class="t">${t('Abilities')}</span>
      <span class="bp-key"><span class="km">${t('Modifier')}</span><span class="ks">${t('Score')}</span><span class="kv">${t('Save')}</span></span></div>
    <div class="bp-ab">${CB_ABILITIES.map((k, i) => {
    const s = bsSave(b, i);
    return `<div class="bp-ab-c"><div class="k">${t(k)}</div><div class="m" data-mod="${i}">${_bpAbMod(b, i)}</div>
      ${ed ? _cbEd('abil.' + i, b.abil[i], '10', 'sc', 'div') : `<div class="sc">${_cbEsc(b.abil[i])}</div>`}<div class="s ${s.listed ? 'pro' : ''}" data-save="${i}">${_bpSigned(s.value)}</div></div>`;
  }).join('')}</div>`;
}

// AC and HP are the numbers reached for mid-fight: large, the armour or the dice under them.
// Editing, the number and the note are two values that combatJoinBig puts back into one line.
function _bpBig(label, v, key) {
  if (key) {
    const p = combatSplitBig(v);
    return `<div class="bp-big"><div class="k">${t(label)}</div>${_cbEd(key + '.n', p.n, '—', 'v', 'div')}${_cbEd(key + '.note', p.note, '', 'sub', 'div')}</div>`;
  }
  const m = String(v || '').match(/^\s*(\d+)\s*(.*)$/);
  return `<div class="bp-big"><div class="k">${t(label)}</div><div class="v">${_cbEsc(m ? m[1] : v || '—')}</div>${
    m && m[2] ? `<div class="sub">${_bpMarked(m[2].replace(/^\((.*)\)$/, '$1'))}</div>` : ''}</div>`;
}

function _bpNotes(b) {
  return `<div class="bp-notes" data-notes placeholder="${_cbEsc(t('Tactics, where it lives in your campaign, what it knows'))}"></div>`;
}

// Every line the page shows editing: one with a value, or one "Add line" just put there.
function _bpEditLines(b, shown) {
  const has = k => k === 'quick' ? b.quick !== undefined : !!String(b[k] || '').trim();
  const lines = BP_EDIT_LINES.filter(([k]) => has(k) || shown.has(k));
  const ph = k => k === 'quick' ? combatAttackLine(b) || '—' : '—';
  return lines.map(([k, label]) => `<div class="bp-kv" data-line="${k}"><b>${t(label)}:</b> ${_cbEd(k, b[k] === undefined ? '' : b[k], ph(k))}</div>`).join('')
    + (lines.length < BP_EDIT_LINES.length ? `<button tabindex="-1" class="dk-addb bp-addline" data-addline>${uiIcon('plus')}<span>${t('Add line')}</span><span class="sm-chev"></span></button>` : '');
}

function _bpEditSecs(b) {
  const secs = CB_SECTIONS.filter(s => b.secs[s]);
  const add = `<button tabindex="-1" class="dk-addb bp-add" data-addentry>${uiIcon('plus')}<span>${t('Add')}</span></button>`;
  return secs.map(s => _bpSection(s, s, b.secs[s].map((e, i) => _bpEntry(e, null, { sec: s, i })).join('') + add, true)).join('')
    + (secs.length < CB_SECTIONS.length ? `<button tabindex="-1" class="dk-addb bp-addsec" data-addsec>${uiIcon('plus')}<span>${t('Add section')}</span></button>` : '');
}

// `ed` is edit mode: the same page with each value typeable, and the lines "Add line" has put there.
function _bpRead(b, noNotes, spent, ed) {
  const line = (label, v) => v ? `<div class="bp-kv"><b>${t(label)}:</b> ${_cbEsc(v)}</div>` : '';
  const secs = CB_SECTIONS.filter(s => b.secs[s] && b.secs[s].length);
  const lore = String(b.lore || '').split(/\n{2,}/).filter(Boolean);
  const meta = ed ? `<div class="bp-meta">${_cbEd('meta', b.meta, 'Size, type, alignment')}</div>` : b.meta ? `<div class="bp-meta">${_cbEsc(b.meta)}</div>` : '';
  return `<div class="bp-read${ed ? ' bp-ed' : ''}" data-no-i18n>
    ${meta}
    <div class="bp-vitals">${_bpBig('Armor Class', b.ac, ed && 'ac')}${_bpBig('Hit Points', b.hp, ed && 'hp')}
      <div class="bp-minor"><span class="k">${t('Initiative')}</span><b class="bp-hi" data-init>${_bpAbMod(b, 1)}</b></div>
      <div class="bp-minor"><span class="k">${t('Speed')}</span><b>${ed ? _cbEd('speed', b.speed, '—') : b.speed ? _cbEsc(b.speed) : uiIcon('dash', 16, 2.4)}</b></div></div>
    ${_bpAbilities(b, ed)}
    <div class="bp-lines">${ed ? _bpEditLines(b, ed.lines) : BP_LINES.map(([k, label]) => line(label, b[k])).join('')
      + `<div class="bp-kv"><b>${t('Challenge')}:</b> <span class="bp-hi">${_cbEsc(b.cr || '—')}</span></div>`}</div>
    ${ed ? _bpEditSecs(b) : secs.map(s => _bpSection(s, s, b.secs[s].map(e => _bpEntry(e, spent)).join(''))).join('')}
    ${_bpSection('lore', 'Lore', ed ? `<p class="bp-lore-ed">${_cbEd('lore', b.lore, 'What the monster is, where it lives, how it fights', 'bp-t')}</p>`
    : lore.length ? lore.map(p => `<p>${_cbEsc(p)}</p>`).join('')
      : '<p class="bp-none">' + t('No lore yet. An import keeps the page\'s own description here; Edit to write your own.') + '</p>')}
    ${noNotes ? '' : _bpSection('notes', 'Your notes', _bpNotes(b))}
  </div>`;
}

// Editing, the head's strip says how to edit, and the name and the source in it are values too.
function bpEditHead(b) {
  return `<span class="bs-mode" data-no-i18n><span>${t('Editing')}</span><span class="bs-hint">${t('Click a value to change it')}</span></span>`
    + `<h2 data-no-i18n>${_cbEd('name', b.name, 'Name')}<span class="bs-src">${_cbEd('source', b.source, 'no source')}</span></h2>`;
}

// The lines "Add line" put on the page while it is edited; a fresh Edit, or another page, starts with none.
const bpAddedLines = new Set();
let _bpLinesOf = null;

// The lines drawn again after one is added or emptied, the caret kept in the value it was in or put in `focus`.
function bpLinesRedraw(el, b, focus) {
  const box = el.querySelector('.bp-ed .bp-lines');
  if (!box) return;
  const a = document.activeElement, k = focus || (a && box.contains(a) && a.dataset.p);
  box.innerHTML = _bpEditLines(b, bpAddedLines);
  const f = k && box.querySelector(`[data-p="${k}"]`);
  if (!f) return;
  f.focus();
  document.getSelection().selectAllChildren(f);
  document.getSelection().collapseToEnd();
}

// The notes field is the Notes window's editor, filled from the stored text after the page is drawn.
function bpMount(page, b) {
  const f = page.querySelector('[data-notes]');
  if (!f) return;
  neInit(f);
  f.dataset.neKey = 'monster:' + b.id;
  f.value = b.notes || '';
}

// `noNotes` for a fight's copy with no entry behind it: the notes are an entry's, and it has none. `spent` is whose
// crystals the page shows: the entry's on this computer, or the fight row's.
function bpHtml(b, editing, noNotes, spent) {
  if (!editing || _bpLinesOf !== b) { bpAddedLines.clear(); _bpLinesOf = editing ? b : null; }
  return _bpRead(b, noNotes, spent, editing && { lines: bpAddedLines });
}

// `ed` as cbWireEditor takes it, so the values and the notes field report the same way.
function bpWire(el, ed) {
  cbWireEditor(el, ed);
  el.addEventListener('input', e => {
    const b = ed.block(), f = e.target.dataset;
    if (!b || f.notes === undefined) return;
    b.notes = neStoredText(e.target);
    mxBump();
    cbSaveSoon();
  });
  // The notes are one field with the Notes window's: read again on focus, and the last edit wins.
  el.addEventListener('focusin', e => {
    const b = ed.block();
    if (b && e.target.dataset && e.target.dataset.notes !== undefined && e.target.value !== (b.notes || '')) e.target.value = b.notes || '';
  });
  el.addEventListener('click', e => {
    const h = !e.target.closest('button') && e.target.closest('.bp-sec-h');
    const sec = h && h.closest('[data-fold]');
    if (!sec) return;
    const k = sec.dataset.fold;
    if (_bpShut.has(k)) _bpShut.delete(k); else _bpShut.add(k);
    sec.classList.toggle('shut');
  });
}
