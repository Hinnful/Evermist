// bestiaryPage.js — a bestiary monster's page: AC and HP, the abilities, the lines, its traits and
// actions with a caster's spells as rows of crystals, then its lore and the DM's notes. It reads until Edit, which puts the stat block
// editor (combatStatBlock.js) in its place.

const BP_LINES = [['skills', 'Skills'], ['vuln', 'Vulnerabilities'], ['resist', 'Resistances'], ['immune', 'Immunities'],
  ['senses', 'Senses'], ['languages', 'Languages']];

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

function _bpEntry(e, spent) {
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

function _bpSection(key, title, body) {
  return `<div class="bp-sec ${_bpShut.has(key) ? 'shut' : ''}" data-fold="${key}">
    <div class="bp-sec-h"><span class="car">▼</span>${t(title)}</div><div class="bp-sec-b">${body}</div></div>`;
}

// The sign hangs to the left of the digits, so a column of numbers centres on the digits alone.
function _bpSigned(v) {
  const m = String(v).match(/^([+\-−])(.*)$/);
  return m ? `<span class="bp-sn"><span class="sg">${m[1]}</span>${_cbEsc(m[2])}</span>` : _cbEsc(v);
}

function _bpAbilities(b) {
  return `<div class="bp-ab-cap"><span class="t">${t('Abilities')}</span>
      <span class="bp-key"><span class="km">${t('Modifier')}</span><span class="ks">${t('Score')}</span><span class="kv">${t('Save')}</span></span></div>
    <div class="bp-ab">${CB_ABILITIES.map((k, i) => {
    const s = bsSave(b, i);
    return `<div class="bp-ab-c"><div class="k">${t(k)}</div><div class="m">${_bpSigned(combatAbilityMod(b.abil[i]))}</div>
      <div class="sc">${_cbEsc(b.abil[i])}</div><div class="s ${s.listed ? 'pro' : ''}">${_bpSigned(s.value)}</div></div>`;
  }).join('')}</div>`;
}

// AC and HP are the numbers reached for mid-fight: large, the armour or the dice under them.
function _bpBig(label, v) {
  const m = String(v || '').match(/^\s*(\d+)\s*(.*)$/);
  return `<div class="bp-big"><div class="k">${t(label)}</div><div class="v">${_cbEsc(m ? m[1] : v || '—')}</div>${
    m && m[2] ? `<div class="sub">${_bpMarked(m[2].replace(/^\((.*)\)$/, '$1'))}</div>` : ''}</div>`;
}

function _bpNotes(b) {
  return `<div class="bp-notes" data-notes placeholder="${_cbEsc(t('Tactics, where it lives in your campaign, what it knows'))}"></div>`;
}

function _bpRead(b, noNotes, spent) {
  const line = (label, v) => v ? `<div class="bp-kv"><b>${t(label)}:</b> ${_cbEsc(v)}</div>` : '';
  const secs = CB_SECTIONS.filter(s => b.secs[s] && b.secs[s].length);
  const lore = String(b.lore || '').split(/\n{2,}/).filter(Boolean);
  return `<div class="bp-read" data-no-i18n>
    ${b.meta ? `<div class="bp-meta">${_cbEsc(b.meta)}</div>` : ''}
    <div class="bp-vitals">${_bpBig('Armor Class', b.ac)}${_bpBig('Hit Points', b.hp)}
      <div class="bp-minor"><span class="k">${t('Initiative')}</span><b class="bp-hi">${_bpSigned(combatAbilityMod(b.abil[1]))}</b></div>
      <div class="bp-minor"><span class="k">${t('Speed')}</span><b>${_cbEsc(b.speed || '—')}</b></div></div>
    ${_bpAbilities(b)}
    <div class="bp-lines">${BP_LINES.map(([k, label]) => line(label, b[k])).join('')}
      <div class="bp-kv"><b>${t('Challenge')}:</b> <span class="bp-hi">${_cbEsc(b.cr || '—')}</span></div></div>
    ${secs.map(s => _bpSection(s, s, b.secs[s].map(e => _bpEntry(e, spent)).join(''))).join('')}
    ${_bpSection('lore', 'Lore', lore.length ? lore.map(p => `<p>${_cbEsc(p)}</p>`).join('')
      : '<p class="bp-none">' + t('No lore yet. An import keeps the page\'s own description here; Edit to write your own.') + '</p>')}
    ${noNotes ? '' : _bpSection('notes', 'Your notes', _bpNotes(b))}
  </div>`;
}

function _bpEdit(b, noNotes) {
  return `<div class="bp-editing">
    ${cbEditorHtml(b)}
    <div class="bp-sec-h bp-edit-h">Lore</div>
    <textarea class="bp-notes bp-lore" data-lore spellcheck="false" placeholder="What the monster is, where it lives, how it fights">${_cbEsc(b.lore || '')}</textarea>
    ${noNotes ? '' : `<div class="bp-sec-h bp-edit-h">Your notes</div>${_bpNotes(b)}`}
  </div>`;
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
  return editing ? _bpEdit(b, noNotes) : _bpRead(b, noNotes, spent);
}

// `ed` as cbWireEditor takes it, so the editor and the two text fields report the same way.
function bpWire(el, ed) {
  cbWireEditor(el, ed);
  el.addEventListener('input', e => {
    const b = ed.block(), f = e.target.dataset;
    if (!b || !(f.notes !== undefined || f.lore !== undefined)) return;
    if (f.notes !== undefined) { b.notes = neStoredText(e.target); mxBump(); } else b.lore = e.target.value;
    cbSaveSoon();
  });
  // The notes are one field with the Notes window's: read again on focus, and the last edit wins.
  el.addEventListener('focusin', e => {
    const b = ed.block();
    if (b && e.target.dataset && e.target.dataset.notes !== undefined && e.target.value !== (b.notes || '')) e.target.value = b.notes || '';
  });
  el.addEventListener('click', e => {
    const h = e.target.closest('.bp-sec-h');
    const sec = h && h.closest('[data-fold]');
    if (!sec) return;
    const k = sec.dataset.fold;
    if (_bpShut.has(k)) _bpShut.delete(k); else _bpShut.add(k);
    sec.classList.toggle('shut');
  });
}
