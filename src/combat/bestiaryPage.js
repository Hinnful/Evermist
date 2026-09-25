// bestiaryPage.js — a bestiary monster's page: AC and HP, the abilities, the lines, its traits and
// actions, then its lore and the DM's notes. It reads until Edit, which puts the stat block
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

function _bpSection(key, title, body) {
  return `<div class="bp-sec ${_bpShut.has(key) ? 'shut' : ''}" data-fold="${key}">
    <div class="bp-sec-h"><span class="car">▼</span>${title}</div><div class="bp-sec-b">${body}</div></div>`;
}

// The sign hangs to the left of the digits, so a column of numbers centres on the digits alone.
function _bpSigned(v) {
  const m = String(v).match(/^([+\-−])(.*)$/);
  return m ? `<span class="bp-sn"><span class="sg">${m[1]}</span>${_cbEsc(m[2])}</span>` : _cbEsc(v);
}

function _bpAbilities(b) {
  return `<div class="bp-ab-cap"><span class="t">Abilities</span>
      <span class="bp-key"><span class="km">Modifier</span><span class="ks">Score</span><span class="kv">Save</span></span></div>
    <div class="bp-ab">${CB_ABILITIES.map((k, i) => {
    const s = bsSave(b, i);
    return `<div class="bp-ab-c"><div class="k">${k}</div><div class="m">${_bpSigned(combatAbilityMod(b.abil[i]))}</div>
      <div class="sc">${_cbEsc(b.abil[i])}</div><div class="s ${s.listed ? 'pro' : ''}">${_bpSigned(s.value)}</div></div>`;
  }).join('')}</div>`;
}

// AC and HP are the numbers reached for mid-fight: large, the armour or the dice under them.
function _bpBig(label, v) {
  const m = String(v || '').match(/^\s*(\d+)\s*(.*)$/);
  return `<div class="bp-big"><div class="k">${label}</div><div class="v">${_cbEsc(m ? m[1] : v || '—')}</div>${
    m && m[2] ? `<div class="sub">${_bpMarked(m[2].replace(/^\((.*)\)$/, '$1'))}</div>` : ''}</div>`;
}

function _bpNotes(b) {
  return `<textarea class="bp-notes" data-notes spellcheck="false" placeholder="Tactics, where it lives in your campaign, what it knows">${_cbEsc(b.notes || '')}</textarea>`;
}

function _bpRead(b) {
  const line = (label, v) => v ? `<div class="bp-kv"><b>${label}:</b> ${_cbEsc(v)}</div>` : '';
  const secs = CB_SECTIONS.filter(s => b.secs[s] && b.secs[s].length);
  const lore = String(b.lore || '').split(/\n{2,}/).filter(Boolean);
  return `<div class="bp-read">
    ${b.meta ? `<div class="bp-meta">${_cbEsc(b.meta)}</div>` : ''}
    <div class="bp-vitals">${_bpBig('Armor Class', b.ac)}${_bpBig('Hit Points', b.hp)}
      <div class="bp-minor"><span class="k">Initiative</span><b class="bp-hi">${_bpSigned(combatAbilityMod(b.abil[1]))}</b></div>
      <div class="bp-minor"><span class="k">Speed</span><b>${_cbEsc(b.speed || '—')}</b></div></div>
    ${_bpAbilities(b)}
    <div class="bp-lines">${BP_LINES.map(([k, label]) => line(label, b[k])).join('')}
      <div class="bp-kv"><b>Challenge:</b> <span class="bp-hi">${_cbEsc(b.cr || '—')}</span></div></div>
    ${secs.map(s => _bpSection(s, s, b.secs[s].map(e => `<p>${e.n ? `<span class="n">${_cbEsc(e.n)}.</span> ` : ''}${_bpMarked(e.t)}</p>`).join(''))).join('')}
    ${_bpSection('lore', 'Lore', lore.length ? lore.map(p => `<p>${_cbEsc(p)}</p>`).join('')
      : '<p class="bp-none">No lore yet. An import keeps the page\'s own description here; Edit to write your own.</p>')}
    ${_bpSection('notes', 'Your notes', _bpNotes(b))}
  </div>`;
}

function _bpEdit(b) {
  return `<div class="bp-editing">
    ${cbEditorHtml(b)}
    <div class="bp-sec-h bp-edit-h">Lore</div>
    <textarea class="bp-notes bp-lore" data-lore spellcheck="false" placeholder="What the monster is, where it lives, how it fights">${_cbEsc(b.lore || '')}</textarea>
    <div class="bp-sec-h bp-edit-h">Your notes</div>
    ${_bpNotes(b)}
  </div>`;
}

function bpHtml(b, editing) {
  return editing ? _bpEdit(b) : _bpRead(b);
}

// `ed` as cbWireEditor takes it, so the editor and the two text fields report the same way.
function bpWire(el, ed) {
  cbWireEditor(el, ed);
  el.addEventListener('input', e => {
    const b = ed.block(), f = e.target.dataset;
    if (!b || !(f.notes !== undefined || f.lore !== undefined)) return;
    if (f.notes !== undefined) b.notes = e.target.value; else b.lore = e.target.value;
    cbSaveSoon();
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
