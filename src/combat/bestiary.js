// bestiary.js — the bestiary: every stat block the DM keeps, in a window of its own (bestiaryWindow.js). A table
// with a name search and filters, several picked at once, imports from links or a file, and the
// picked monster's page beside the table (bestiaryPage.js), or a fight row's copy (bestiaryCopy.js).

const BS_COLS = [['cr', 'CR', 'num'], ['name', 'Name'], ['size', 'Size'], ['type', 'Type'], ['ac', 'AC', 'num'], ['hp', 'HP', 'num'], ['source', 'Source']];

// `open` is the entry whose page shows, `copy` the fight row whose copy shows instead; never both.
const bs = { f: bsNoFilter(), more: false, sort: { k: 'name', d: 1 }, picked: new Set(), anchor: null, open: null, copy: null,
  editing: false, importing: false, fresh: new Set(), pop: null };
// Copies, not ids: a paste still works after the entries it came from are deleted.
let _bsClip = [];

const _bsEl = id => document.getElementById(id);
// Its keys are its own only while the focus is inside it, or in one of its lists.
function bsHasFocus() {
  const a = document.activeElement;
  return bsIsOpen() && !!a && (_bsEl('bs-panel').contains(a) || (!!bs.pop && bs.pop.contains(a)));
}
// A page being edited holds a synced bestiary back until the DM is done.
function bsEditing() { return bsIsOpen() && (bs.editing || _bsEl('bs-page').contains(document.activeElement)); }
function _bsAll() { return Object.values(cbState.blocks); }
function _bsShown() { return bsSorted(_bsAll().filter(b => bsMatches(b, bs.f)), bs.sort.k, bs.sort.d); }

function _bsFilterButton(F) {
  let val = '';
  if (F.range) { if (bs.f.cr[0] !== null || bs.f.cr[1] !== null) val = `${bs.f.cr[0] || '0'}–${bs.f.cr[1] || '30'}`; }
  else val = bs.f[F.k].length === 1 ? bs.f[F.k][0] : bs.f[F.k].length ? String(bs.f[F.k].length) : '';
  return `<button class="bs-f ${val ? 'on' : ''}" data-filter="${F.k}">${F.label}${val ? ` <span class="v" data-no-i18n>${_cbEsc(t(val))}</span>` : ''}<span class="car">▼</span></button>`;
}

function _bsQueueHtml() {
  return cbImportQueue.map(q => q.state === 'failed'
    ? `<div class="bs-q err"><span class="u">${_cbEsc(q.url)}<span class="why">${_cbEsc(t(q.why))}</span></span>
        <button data-q="retry" data-qid="${q.id}">Retry</button><button class="dim" data-q="drop" data-qid="${q.id}">Remove</button></div>`
    : `<div class="bs-q"><span class="bs-spin ${q.state === 'waiting' ? 'idle' : ''}"></span>
        <span class="u">${t(q.state === 'waiting' ? 'Waiting: {host}…' : 'Reading {host}…', { host: _cbEsc(q.host) })}</span><button data-q="drop" data-qid="${q.id}">Cancel</button></div>`).join('');
}

function _bsCell(b, k) {
  if (k === 'cr') return `<td class="num"><span class="bs-crb">${_cbEsc(bsCr(b))}</span></td>`;
  if (k === 'name') return `<td class="nm">${_cbEsc(b.name)}${bs.fresh.has(b.id) ? '<span class="bs-new">' + t('NEW') + '</span>' : ''}</td>`;
  if (k === 'size') return `<td>${_cbEsc(t(bsSize(b)))}</td>`;
  if (k === 'type') return `<td>${_cbEsc(t(bsType(b)))}</td>`;
  if (k === 'ac' || k === 'hp') return `<td class="num">${_cbEsc(combatFirstNum(b[k]) || '—')}</td>`;
  return `<td class="src">${_cbEsc(b.source || '')}</td>`;
}

function _bsTableHtml(list) {
  if (!list.length) {
    return `<div class="bs-empty"><b>${_bsAll().length ? 'Nothing matches' : 'No monsters yet'}</b>${
      _bsAll().length ? 'Loosen a filter, or <button class="bs-link" data-a="clear">clear them all</button>.' : 'Import from a link or a PDF book, or add a new one.'}</div>`;
  }
  const cols = bswdCols();
  // The arrow in its own node: joined to the title it made "Name ↑" a text the translation has no key for.
  const arrow = k => bs.sort.k === k ? `<span class="ar">${bs.sort.d > 0 ? ' ↑' : ' ↓'}</span>` : '';
  return `<table class="bs-t"><thead data-no-i18n><tr><th class="cbc"></th>${cols.map(([k, l, c]) => `<th class="${c || ''}" data-sort="${k}">${_cbEsc(t(l))}${arrow(k)}</th>`).join('')}</tr></thead>
    <tbody data-no-i18n>${list.map(b => `<tr class="${bs.picked.has(b.id) ? 'sel' : ''} ${bs.open === b.id ? 'open' : ''}" data-id="${b.id}">
      <td class="cbc"><span class="bs-cb ${bs.picked.has(b.id) ? 'on' : ''}" data-tick></span></td>${cols.map(([k]) => _bsCell(b, k)).join('')}</tr>`).join('')}</tbody></table>`;
}

const BS_ICONS = {
  edit: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17z"/></svg>',
  done: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
};

// Reading, the head carries the page's three actions as one group; editing, it becomes a strip
// that says so and holds Done, as Figma's mode bar does.
function _bsPageHtml(b) {
  const head = bs.editing
    ? `<div class="bs-page-head editing"><div class="t"><span class="bs-mode">Editing</span><h2 data-no-i18n>${_cbEsc(b.name)}</h2></div>
        <button class="sm-hbtn primary bs-done" data-a="edit">${BS_ICONS.done}<span>Done</span></button></div>`
    : `<div class="bs-page-head"><div class="t"><h2 data-no-i18n>${_cbEsc(b.name)}<span class="bs-src">${_cbEsc(b.source || t('no source'))}</span></h2></div>
        <div class="bs-tools"><button class="bs-ib" data-a="edit" title="Edit">${BS_ICONS.edit}</button>
          <button class="bs-ib" data-a="dup-open" title="Duplicate (Ctrl+D)">${uiIcon('dup')}</button>
          <button class="bs-ib danger" data-a="del-open" title="Delete (Del)">${uiIcon('trash')}</button></div>
        <span class="bs-div"></span><button class="bs-ib" data-a="unpage" title="Close the page (Esc)">${uiIcon('collapse')}</button></div>`;
  return `${head}<div class="bs-page-body">${bpHtml(b, bs.editing, false, bpEntrySpent(b))}</div>`;
}

function bestiaryRender() {
  if (!bsIsOpen()) return;
  // An id comes free when its entry goes, and the next entry can take it; nothing may carry over.
  for (const set of [bs.picked, bs.fresh]) for (const id of set) if (!cbState.blocks[id]) set.delete(id);
  if (bs.open && !cbState.blocks[bs.open]) { bs.open = null; bs.editing = false; }
  const panel = _bsEl('bs-panel'), list = _bsShown();
  panel.classList.toggle('selecting', bs.picked.size > 0);
  panel.classList.toggle('paged', bswdPaged());
  bswdApply();
  panel.querySelector('.bs-picked').textContent = t('{n} selected', { n: bs.picked.size });
  const tick = _bsEl('bs-tickall'), all = list.length && list.every(b => bs.picked.has(b.id));
  tick.className = 'sm-tick' + (all ? ' on' : bs.picked.size ? ' part' : '');
  tick.title = bs.picked.size ? t('Clear the selection') : t('Select all');
  panel.querySelector('.bs-importbar').style.display = bs.importing ? '' : 'none';
  panel.querySelector('.bs-fbtns').innerHTML = BS_FILTERS.filter(F => !F.more || bs.more).map(_bsFilterButton).join('')
    + `<button class="bs-link" data-a="more">${bs.more ? 'Fewer filters' : 'More filters'}</button>`
    + (bsFiltered(bs.f) ? '<button class="bs-link" data-a="clear">Clear all</button>' : '');
  panel.querySelector('.bs-shown').textContent = t('{shown} of {all} monsters', { shown: list.length, all: _bsAll().length });
  const queue = _bsEl('bs-queue');
  queue.innerHTML = (cbBookReading ? `<div class="bs-q"><span class="bs-spin"></span><span class="u">${t('Reading {host}…', { host: _cbEsc(cbBookReading) })}</span></div>` : '') + _bsQueueHtml();
  queue.style.display = cbImportQueue.length || cbBookReading ? '' : 'none';
  const table = _bsEl('bs-table'), top = table.scrollTop;
  table.innerHTML = _bsTableHtml(list);
  table.scrollTop = top;
}

// The page redraws only when what it shows changes, or typing in it would lose the caret.
function _bsRenderPage() {
  if (!bsIsOpen()) return;
  const page = _bsEl('bs-page'), b = cbState.blocks[bs.open], row = bcRow();
  if (bs.copy !== null && !row) bs.copy = null;
  // The same page drawn again keeps its scroll: a table edit or a synced change redraws it while the DM reads.
  const key = row ? 'c' + row.id : b ? 'e' + b.id : '', body = page.querySelector('.bs-page-body');
  const top = key && key === page.dataset.key && body ? body.scrollTop : 0;
  if (row) bcMount(page, row);
  else { page.innerHTML = b ? _bsPageHtml(b) : ''; if (b) bpMount(page, b); }
  page.dataset.key = key;
  if (top) page.querySelector('.bs-page-body').scrollTop = top;
  page.style.display = b || row ? '' : 'none';
  bswCrumbs(row ? bcCrumbs(row) : [t('Bestiary')].concat(b ? [b.name] : []));
  bestiaryRender();
}

// An import opens its page and keeps NEW; the DM's own click on a row is what clears it.
function _bsShow(id, editing) {
  searchRecentAdd('monster:' + id);
  bs.open = id;
  bs.copy = null;
  bs.editing = !!editing;
  bswRecord('e:' + id);
  _bsRenderPage();
  cbRender();
}

function _bsClosePop() { if (bs.pop) { bs.pop.remove(); bs.pop = null; } }

function _bsPlace(el, anchor) {
  document.body.appendChild(el);
  el.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { _bsClosePop(); _bsEl('bs-panel').focus(); } });
  const z = cbZoom(), r = anchor.getBoundingClientRect();
  el.style.left = (Math.max(8, Math.min(r.left, innerWidth - el.getBoundingClientRect().width - 8)) / z) + 'px';
  el.style.top = ((r.bottom + 6) / z) + 'px';
  bs.pop = el;
}

function _bsFilterPop(anchor, k) {
  const same = bs.pop && bs.pop.dataset.k === k;
  _bsClosePop();
  if (same) return;
  const F = BS_FILTERS.find(x => x.k === k), el = document.createElement('div');
  el.className = 'bs-pop';
  el.dataset.k = k;
  if (F.range) {
    const opts = (v, none) => `<option value="">${none}</option>` + BS_CRS.map(c => `<option ${v === c ? 'selected' : ''}>${c}</option>`).join('');
    el.innerHTML = `<div class="top"><span class="lbl">Challenge rating</span><button data-p="none">Clear</button></div>
      <div class="range"><select data-r="0">${opts(bs.f.cr[0], 'From 0')}</select><span>to</span><select data-r="1">${opts(bs.f.cr[1], 'Up to 30')}</select></div>`;
    el.addEventListener('change', e => { bs.f.cr[+e.target.dataset.r] = e.target.value || null; bestiaryRender(); });
  } else {
    const draw = () => {
      el.innerHTML = `<div class="top"><button data-p="all">Select all</button><button data-p="none">Clear</button></div>
        <div class="opts" data-no-i18n>${bsOptions(_bsAll(), bs.f, k).map(o => `<div class="o" data-v="${_cbEsc(o.value)}">
          <span class="bs-cb ${bs.f[k].includes(o.value) ? 'on' : ''}"></span>${_cbEsc(t(o.value))}<span class="c">${o.count}</span></div>`).join('')}</div>`;
    };
    draw();
    el.addEventListener('click', e => {
      const o = e.target.closest('[data-v]');
      if (e.target.closest('[data-p="all"]')) bs.f[k] = bsOptions(_bsAll(), bs.f, k).map(x => x.value);
      else if (o) bs.f[k] = bs.f[k].includes(o.dataset.v) ? bs.f[k].filter(v => v !== o.dataset.v) : bs.f[k].concat(o.dataset.v);
      else if (!e.target.closest('[data-p="none"]')) return;
      draw();
      bestiaryRender();
    });
  }
  el.addEventListener('click', e => {
    if (!e.target.closest('[data-p="none"]')) return;
    if (F.range) bs.f.cr = [null, null]; else bs.f[k] = [];
    bestiaryRender();
    _bsClosePop();
  });
  _bsPlace(el, anchor);
}

function _bsImportMenu(anchor) {
  _bsClosePop();
  const el = document.createElement('div');
  el.className = 'bs-pop bs-menu';
  el.innerHTML = `<div class="it" data-m="links">Paste links<small>One or many monster pages, from any site</small></div>
    <div class="it" data-m="file">From a file<small>An Evermist export (.json) or a PDF book</small></div>`;
  el.addEventListener('click', e => {
    const m = e.target.closest('[data-m]');
    if (!m) return;
    _bsClosePop();
    if (m.dataset.m === 'file') { _bsEl('bs-file').value = ''; _bsEl('bs-file').click(); return; }
    bs.importing = true;
    bestiaryRender();
    _bsEl('bs-links').focus();
  });
  _bsPlace(el, anchor);
}

function bestiaryMarkNew(ids) {
  ids.forEach(id => bs.fresh.add(id));
  bestiaryRender();
}

// An import has landed: its row is marked NEW and its page opens so the DM sees what was read,
// unless another page is open, which the DM may be editing.
function _bsImported(id) {
  if (id) bs.fresh.add(id);
  if (id && !bs.open) _bsShow(id); else bestiaryRender();
}

function _bsStartImport() {
  // One link a line; a line that is not a link fails on its own row, whole.
  const field = _bsEl('bs-links'), links = field.value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!links.length) return;
  field.value = '';
  bs.importing = false;
  cbImportLinks(links, _bsImported);
}

// New copies are picked, as Figma selects what it just duplicated; a single one opens instead.
function _bsAdd(blocks) {
  if (!blocks.length) return;
  const added = blocks.map(b => combatAddEntry(cbState.blocks, b));
  cbSave();
  bs.picked.clear();
  if (added.length === 1) { bs.fresh.add(added[0].id); _bsShow(added[0].id); return; }
  added.forEach(b => { bs.picked.add(b.id); bs.fresh.add(b.id); });
  bestiaryRender();
}

// The picked entries, or else the one whose page is open.
function _bsTargets() {
  if (bs.copy !== null) return [];
  if (bs.picked.size) return [...bs.picked].map(id => cbState.blocks[id]);
  return bs.open ? [cbState.blocks[bs.open]] : [];
}

function _bsDelete(ids) {
  if (!ids.length) return;
  confirmDialog({
    title: ids.length === 1 ? t('Delete {name}?', { name: cbState.blocks[ids[0]].name }) : t('Delete {n} monsters?', { n: ids.length }),
    message: 'Monsters already in the fight keep their own copies.',
    confirmLabel: 'Delete', danger: true,
    onConfirm: () => {
      for (const id of ids) delete cbState.blocks[id];
      bs.picked.clear();
      cbSave();
      _bsRenderPage();
    },
  });
}

function _bsExport() {
  const list = _bsTargets();
  if (!list.length) return;
  const url = URL.createObjectURL(new Blob([bsExportFile(list)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = list.length === 1 ? `${list[0].name}.json` : 'bestiary.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function _bsImportFile(file) {
  const monsters = bsReadFile(await file.text());
  if (!monsters) {
    messageDialog({ title: 'That file is not a bestiary', message: 'Evermist can import a file that its own Export wrote. Nothing was added.' });
    return;
  }
  _bsAdd(monsters);
}

function _bsNew() {
  const b = cbNewBlock(combatUniqueName(cbState.blocks, t('New monster'), ''));
  cbSave();
  _bsShow(b.id, true);
  const name = _bsEl('bs-page').querySelector('.cb-sb-name');
  name.focus();
  document.getSelection().selectAllChildren(name);
}

function _bsPick(id, e) {
  const ids = [..._bsEl('bs-table').querySelectorAll('tbody tr')].map(r => r.dataset.id);
  if (e.shiftKey && bs.anchor && ids.includes(bs.anchor)) {
    const [a, b] = [ids.indexOf(bs.anchor), ids.indexOf(id)].sort((x, y) => x - y);
    ids.slice(a, b + 1).forEach(x => bs.picked.add(x));
  } else if (e.ctrlKey || e.metaKey || e.target.closest('[data-tick]') || bs.picked.size) {
    if (bs.picked.has(id)) bs.picked.delete(id); else bs.picked.add(id);
    bs.anchor = id;
  } else {
    bs.anchor = id;
    bs.fresh.delete(id);
    if (bs.open === id) { bs.open = null; bs.editing = false; _bsRenderPage(); } else _bsShow(id);
    return;
  }
  bestiaryRender();
}

// Answers whether it is open. Already open, it stays where it is; `fromFight` opens it beside the fight table.
function bestiarySetOpen(open, fromFight) {
  if (!!open === bsIsOpen()) return !!open;
  if (open && !bswShow(fromFight)) return false;
  if (!open) bswHide();
  _bsEl('btn-bestiary').classList.toggle('active', !!open);
  dockRefreshRail();
  _bsClosePop();
  if (!open) { bs.picked.clear(); bs.editing = false; bs.copy = null; cbRender(); return false; }
  // Opened with no page, it shows the list's first monster rather than an empty half.
  if (!fromFight && !bs.open && bs.copy === null) { const first = _bsShown()[0]; if (first) { bs.open = first.id; bswRecord('e:' + first.id); } }
  _bsRenderPage();
  const search = _bsEl('bs-search');
  (search.offsetParent ? search : _bsEl('bs-panel')).focus();
  return true;
}

// Escape steps back one thing per press, Figma-style: a list, the picks, editing, the page, the window.
function _bsEscape() {
  if (bs.pop) _bsClosePop();
  else if (bs.importing) { bs.importing = false; bestiaryRender(); }
  else if (bs.picked.size) { bs.picked.clear(); bestiaryRender(); }
  else if (bs.editing) { bs.editing = false; _bsRenderPage(); }
  else if (bswdPaged() && !bswListHidden()) { bs.open = null; bs.copy = null; _bsRenderPage(); cbRender(); }
  else bestiarySetOpen(false);
}

// A copy is not an entry, so on its page the list's Delete, Copy and Duplicate have nothing to act on.
function _bsKey(e) {
  if (e.key === 'Escape' && nePickerOpen()) return;
  if (e.key === 'Escape') { e.preventDefault(); _bsEscape(); return; }
  if (e.target.closest('input, textarea, select, [contenteditable]')) return;
  const mod = e.ctrlKey || e.metaKey, del = e.code === 'Delete' || e.code === 'Backspace';
  if (bs.copy !== null && (del || (mod && (e.code === 'KeyC' || e.code === 'KeyD')))) return;
  if (mod && e.code === 'KeyA') { e.preventDefault(); _bsShown().forEach(b => bs.picked.add(b.id)); bestiaryRender(); }
  else if (mod && e.code === 'KeyC') _bsClip = _bsTargets().map(combatSnapshot);
  else if (mod && e.code === 'KeyV') _bsAdd(_bsClip);
  else if (mod && e.code === 'KeyD') { e.preventDefault(); _bsAdd(_bsTargets()); }
  else if (del) _bsDelete(_bsTargets().map(b => b.id));
}

function _bsClick(e) {
  const t = e.target, a = t.closest('[data-a]'), act = a && a.dataset.a;
  if (act === 'close') return bestiarySetOpen(false);
  if (act === 'new') return _bsNew();
  if (act === 'import') return _bsImportMenu(a);
  if (act === 'go') return _bsStartImport();
  if (act === 'no-import') { bs.importing = false; return bestiaryRender(); }
  if (t.closest('#bs-tickall')) {
    if (bs.picked.size) bs.picked.clear(); else _bsShown().forEach(b => bs.picked.add(b.id));
    return bestiaryRender();
  }
  if (act === 'dup' || act === 'dup-open') return _bsAdd(act === 'dup' ? [...bs.picked].map(id => cbState.blocks[id]) : [cbState.blocks[bs.open]]);
  if (act === 'del' || act === 'del-open') return _bsDelete(act === 'del' ? [...bs.picked] : [bs.open]);
  if (act === 'export') return _bsExport();
  if (act === 'edit') { bs.editing = !bs.editing; return _bsRenderPage(); }
  if (act === 'unpage') { bs.open = null; bs.editing = false; return _bsRenderPage(); }
  if (act === 'more') { bs.more = !bs.more; return bestiaryRender(); }
  if (act === 'clear') { bs.f = bsNoFilter(); _bsEl('bs-search').value = ''; return bestiaryRender(); }
  const q = t.closest('[data-q]');
  if (q) {
    if (q.dataset.q === 'retry') cbImportRetry(+q.dataset.qid, _bsImported);
    else { cbImportDrop(+q.dataset.qid); bestiaryRender(); }
    return;
  }
  const f = t.closest('#bs-panel .bs-fbtns [data-filter]');
  if (f) return _bsFilterPop(f, f.dataset.filter);
  const th = t.closest('[data-sort]');
  if (th) {
    const k = th.dataset.sort;
    // A first press on CR shows the strongest first; everything else starts A to Z.
    bs.sort = { k, d: bs.sort.k === k ? -bs.sort.d : (k === 'cr' ? -1 : 1) };
    return bestiaryRender();
  }
  const row = t.closest('#bs-table tbody tr');
  if (row) _bsPick(row.dataset.id, e);
}

// A history step: an entry's page, or a fight row's copy while that row is still in the open fight.
function _bsGo(key) {
  const id = key.slice(2);
  if (key[0] === 'c') return bcShow(+id);
  if (!cbState.blocks[id]) return false;
  _bsShow(id);
  return true;
}

function initBestiary() {
  const btn = document.getElementById('btn-bestiary');
  const panel = document.createElement('div');
  panel.id = 'bs-panel';
  panel.className = 'bsw';
  panel.tabIndex = -1;
  panel.hidden = true;
  const ib = (a, icon, title) => `<button class="nw-ib bsw-ic" data-a="${a}" title="${title}">${uiIcon(icon)}</button>`;
  panel.innerHTML = bswHtml(`<span class="bsw-hslot" id="bs-hslot"></span>
      <button class="sm-hbtn bsw-lb" data-a="new">${uiIcon('plus')}<span>New monster</span></button>
      <button class="sm-hbtn primary bsw-lb" data-a="import"><span>Import</span><span class="sm-chev"></span></button>
      ${ib('new', 'plus', 'New monster')}${ib('import', 'download', 'Import')}`,
  `<div class="bs-importbar">
      <textarea id="bs-links" spellcheck="false" placeholder="Paste one or more monster page links, one per line"></textarea>
      <div class="col"><button class="sm-hbtn primary" data-a="go"><span>Import</span></button><button class="sm-hbtn" data-a="no-import"><span>Cancel</span></button></div>
    </div>
    <div class="bsw-top" id="bs-top">
    <div class="sm-ltb bs-filters">
      <span class="sm-tick" id="bs-tickall"></span>
      <span class="bs-fbtns"></span>
      <span class="bs-acts"><span class="cnt on bs-picked"></span>
        <button class="sm-hbtn" data-a="dup" title="Duplicate">${uiIcon('dup')}<span>Duplicate</span></button>
        <button class="sm-hbtn" data-a="export" title="Export">${uiIcon('export')}<span>Export</span></button>
        <button class="sm-hbtn danger" data-a="del" title="Delete">${uiIcon('trash')}<span>Delete</span></button></span>
      <span class="end bs-shown"></span>
    </div>
    <div id="bs-queue" class="bs-queue" style="display:none"></div></div>`,
  `<div class="bsw-ltop" id="bs-ltop"><label class="sm-field">${uiIcon('search')}<input id="bs-search" placeholder="Search by name" spellcheck="false" autocomplete="off"></label>
      <button class="sm-hbtn bsw-fold" id="bs-fold" title="Filters">${uiIcon('filter')}</button></div>
    <div id="bs-table"></div>`,
  `<div id="bs-page" style="display:none"></div>
    <input type="file" id="bs-file" accept=".json,.pdf,application/json,application/pdf" style="display:none">`);
  document.body.appendChild(panel);

  bpWire(_bsEl('bs-page'), {
    block: () => cbState.blocks[bs.open],
    // The page's own heading and the table follow a rename without redrawing the editor.
    edited: field => {
      if (field !== 'name' && field !== 'source' && field !== 'meta' && field !== 'cr' && field !== 'ac' && field !== 'hp') return;
      const b = cbState.blocks[bs.open];
      _bsEl('bs-page').querySelector('.bs-page-head h2').textContent = b.name;
      bswCrumbs([t('Bestiary'), b.name]);
      bestiaryRender();
    },
    redraw: _bsRenderPage,
  });
  bcInit(_bsEl('bs-page'));
  bpWireSpells(_bsEl('bs-page'));
  bswInit(_bsGo, bswdMode, bswdApply);
  bswdInit();

  btn.addEventListener('click', () => bestiarySetOpen(!bsIsOpen()));
  panel.addEventListener('mousedown', e => {
    // The map's own handlers listen on the document; nothing pressed in here is theirs.
    e.stopPropagation();
    // Shift+click picks a range; without this the browser selects the text between.
    if (e.shiftKey && e.target.closest('tbody tr')) e.preventDefault();
    // Keys go to the window, not to the map, whatever was clicked inside it.
    if (!e.target.closest('input, textarea, select, button, [contenteditable]')) setTimeout(() => panel.focus());
  });
  document.addEventListener('mousedown', e => {
    if (bs.pop && !bs.pop.contains(e.target) && !e.target.closest('#bs-panel [data-filter], #bs-panel [data-a="import"], #bs-fold')) _bsClosePop();
  }, true);
  // Only from inside the window: a key on the map or anywhere else is never the Bestiary's.
  panel.addEventListener('keydown', e => { _bsKey(e); e.stopPropagation(); });
  panel.addEventListener('click', _bsClick);
  _bsEl('bs-search').addEventListener('input', e => { bs.f.q = e.target.value; bestiaryRender(); });
  _bsEl('bs-links').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) _bsStartImport(); });
  // One input for both kinds: the extension says whether it is an export or a book.
  _bsEl('bs-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) { e.target.value = ''; _bsImportFile(file); return; }
    if (cbBookReading) { noticeToast(t('A book is already being read. Try again when it is done.')); return; }
    cbImportBook(file, bestiaryRender);
  });
}
