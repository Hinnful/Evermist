// bestiary.js — the bestiary: every stat block the DM keeps, in a window over the map. A table
// with a name search and filters, several picked at once, imports from links or a file, and the
// picked monster's page beside the table (bestiaryPage.js). bestiaryPlan.js holds the rules.

const BS_COLS = [['cr', 'CR', 'num'], ['name', 'Name'], ['size', 'Size'], ['type', 'Type'], ['ac', 'AC', 'num'], ['hp', 'HP', 'num'], ['source', 'Source']];
const BS_NARROW = ['cr', 'name', 'type'];
const BS_CLOSE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const BS_FIND = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>';

const bs = { f: bsNoFilter(), more: false, sort: { k: 'name', d: 1 }, picked: new Set(), anchor: null, open: null,
  editing: false, importing: false, fresh: new Set(), pop: null };
// Copies, not ids: a paste still works after the entries it came from are deleted.
let _bsClip = [];

const _bsEl = id => document.getElementById(id);
function bsIsOpen() { const m = _bsEl('bs-modal'); return !!m && m.style.display !== 'none'; }
function _bsAll() { return Object.values(cbState.blocks); }
function _bsShown() { return bsSorted(_bsAll().filter(b => bsMatches(b, bs.f)), bs.sort.k, bs.sort.d); }

function _bsFilterButton(F) {
  let val = '';
  if (F.range) { if (bs.f.cr[0] !== null || bs.f.cr[1] !== null) val = `${bs.f.cr[0] || '0'}–${bs.f.cr[1] || '30'}`; }
  else val = bs.f[F.k].length === 1 ? bs.f[F.k][0] : bs.f[F.k].length ? String(bs.f[F.k].length) : '';
  return `<button class="bs-f ${val ? 'on' : ''}" data-filter="${F.k}">${F.label}${val ? ` <span class="v">${_cbEsc(val)}</span>` : ''}<span class="car">▼</span></button>`;
}

function _bsQueueHtml() {
  return cbImportQueue.map(q => q.state === 'failed'
    ? `<div class="bs-q err"><span class="u">${_cbEsc(q.url)}<span class="why">${_cbEsc(q.why)}</span></span>
        <button data-q="retry" data-qid="${q.id}">Retry</button><button class="dim" data-q="drop" data-qid="${q.id}">Remove</button></div>`
    : `<div class="bs-q"><span class="bs-spin ${q.state === 'waiting' ? 'idle' : ''}"></span>
        <span class="u">${q.state === 'waiting' ? 'Waiting: ' : 'Reading '}${_cbEsc(q.host)}…</span><button data-q="drop" data-qid="${q.id}">Cancel</button></div>`).join('');
}

function _bsCell(b, k) {
  if (k === 'cr') return `<td class="num"><span class="bs-crb">${_cbEsc(bsCr(b))}</span></td>`;
  if (k === 'name') return `<td class="nm">${_cbEsc(b.name)}${bs.fresh.has(b.id) ? '<span class="bs-new">NEW</span>' : ''}</td>`;
  if (k === 'size') return `<td>${_cbEsc(bsSize(b))}</td>`;
  if (k === 'type') return `<td>${_cbEsc(bsType(b))}</td>`;
  if (k === 'ac' || k === 'hp') return `<td class="num">${_cbEsc(combatFirstNum(b[k]) || '—')}</td>`;
  return `<td class="src">${_cbEsc(b.source || '')}</td>`;
}

function _bsTableHtml(list) {
  if (!list.length) {
    return `<div class="bs-empty"><b>${_bsAll().length ? 'Nothing matches' : 'No monsters yet'}</b>${
      _bsAll().length ? 'Loosen a filter, or <button class="bs-link" data-a="clear">clear them all</button>.' : 'Import one from a link, or add a new one.'}</div>`;
  }
  const cols = bs.open ? BS_COLS.filter(c => BS_NARROW.includes(c[0])) : BS_COLS;
  const arrow = k => bs.sort.k === k ? (bs.sort.d > 0 ? ' ↑' : ' ↓') : '';
  return `<table class="bs-t"><thead><tr><th class="cbc"></th>${cols.map(([k, l, c]) => `<th class="${c || ''}" data-sort="${k}">${l}${arrow(k)}</th>`).join('')}</tr></thead>
    <tbody>${list.map(b => `<tr class="${bs.picked.has(b.id) ? 'sel' : ''} ${bs.open === b.id ? 'open' : ''}" data-id="${b.id}">
      <td class="cbc"><span class="bs-cb ${bs.picked.has(b.id) ? 'on' : ''}" data-tick></span></td>${cols.map(([k]) => _bsCell(b, k)).join('')}</tr>`).join('')}</tbody></table>`;
}

const BS_ICONS = {
  edit: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17z"/></svg>',
  done: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  dup: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/></svg>',
  del: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>',
};

// Reading, the head carries the page's three actions as one group; editing, it becomes a strip
// that says so and holds Done, as Figma's mode bar does.
function _bsPageHtml(b) {
  const head = bs.editing
    ? `<div class="bs-page-head editing"><div class="t"><span class="bs-mode">Editing</span><h2>${_cbEsc(b.name)}</h2></div>
        <button class="sm-hbtn primary bs-done" data-a="edit">${BS_ICONS.done} Done</button></div>`
    : `<div class="bs-page-head"><div class="t"><h2>${_cbEsc(b.name)}<span class="bs-src">${_cbEsc(b.source || 'no source')}</span></h2></div>
        <div class="bs-tools"><button class="bs-ib" data-a="edit" title="Edit">${BS_ICONS.edit}</button>
          <button class="bs-ib" data-a="dup-open" title="Duplicate (Ctrl+D)">${BS_ICONS.dup}</button>
          <button class="bs-ib danger" data-a="del-open" title="Delete (Del)">${BS_ICONS.del}</button></div>
        <span class="bs-div"></span><button class="bs-ib" data-a="unpage" title="Close the page (Esc)">${BS_CLOSE}</button></div>`;
  return `${head}<div class="bs-page-body">${bpHtml(b, bs.editing)}</div>`;
}

function bestiaryRender() {
  if (!bsIsOpen()) return;
  // An id comes free when its entry goes, and the next entry can take it; nothing may carry over.
  for (const set of [bs.picked, bs.fresh]) for (const id of set) if (!cbState.blocks[id]) set.delete(id);
  if (bs.open && !cbState.blocks[bs.open]) { bs.open = null; bs.editing = false; }
  const panel = _bsEl('bs-panel'), list = _bsShown();
  panel.classList.toggle('selecting', bs.picked.size > 0);
  panel.classList.toggle('paged', !!bs.open);
  panel.querySelector('.bs-count').textContent = _bsAll().length;
  panel.querySelector('.bs-picked').textContent = `${bs.picked.size} selected`;
  panel.querySelector('[data-a="pick-all"]').textContent = `Select all ${list.length}`;
  panel.querySelector('.bs-importbar').style.display = bs.importing ? '' : 'none';
  panel.querySelector('.bs-fbtns').innerHTML = BS_FILTERS.filter(F => !F.more || bs.more).map(_bsFilterButton).join('')
    + `<button class="bs-link" data-a="more">${bs.more ? 'Fewer filters' : 'More filters'}</button>`
    + (bsFiltered(bs.f) ? '<button class="bs-link" data-a="clear">Clear all</button>' : '');
  panel.querySelector('.bs-shown').textContent = `${list.length} of ${_bsAll().length}`;
  const queue = _bsEl('bs-queue');
  queue.innerHTML = _bsQueueHtml();
  queue.style.display = cbImportQueue.length ? '' : 'none';
  const table = _bsEl('bs-table'), top = table.scrollTop;
  table.innerHTML = _bsTableHtml(list);
  table.scrollTop = top;
}

// The page redraws only when what it shows changes, or typing in it would lose the caret.
function _bsRenderPage() {
  const page = _bsEl('bs-page'), b = cbState.blocks[bs.open];
  page.innerHTML = b ? _bsPageHtml(b) : '';
  page.style.display = b ? '' : 'none';
  bestiaryRender();
}

// An import opens its page and keeps NEW; the DM's own click on a row is what clears it.
function _bsShow(id, editing) {
  bs.open = id;
  bs.editing = !!editing;
  _bsRenderPage();
}

function _bsClosePop() { if (bs.pop) { bs.pop.remove(); bs.pop = null; } }

function _bsPlace(el, anchor) {
  document.body.appendChild(el);
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
        <div class="opts">${bsOptions(_bsAll(), bs.f, k).map(o => `<div class="o" data-v="${_cbEsc(o.value)}">
          <span class="bs-cb ${bs.f[k].includes(o.value) ? 'on' : ''}"></span>${_cbEsc(o.value)}<span class="c">${o.count}</span></div>`).join('')}</div>`;
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
    <div class="it" data-m="file">From a file<small>Monsters exported from Evermist</small></div>
    <div class="it off">From a PDF book<small>Later: every stat block in the book, ticked before import</small></div>`;
  el.addEventListener('click', e => {
    const m = e.target.closest('[data-m]');
    if (!m) return;
    _bsClosePop();
    if (m.dataset.m === 'file') { _bsEl('bs-file').click(); return; }
    bs.importing = true;
    bestiaryRender();
    _bsEl('bs-links').focus();
  });
  _bsPlace(el, anchor);
}

// An import has landed: its row is marked NEW and its page opens so the DM sees what was read.
function _bsImported(id) {
  if (id) { bs.fresh.add(id); _bsShow(id); } else bestiaryRender();
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
  if (bs.picked.size) return [...bs.picked].map(id => cbState.blocks[id]);
  return bs.open ? [cbState.blocks[bs.open]] : [];
}

function _bsDelete(ids) {
  if (!ids.length) return;
  confirmDialog({
    title: ids.length === 1 ? `Delete ${cbState.blocks[ids[0]].name}?` : `Delete ${ids.length} monsters?`,
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
  const b = cbNewBlock(combatUniqueName(cbState.blocks, 'New monster', ''));
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

function bestiarySetOpen(open) {
  _bsEl('bs-modal').style.display = open ? '' : 'none';
  _bsEl('btn-bestiary').classList.toggle('active', open);
  _bsClosePop();
  if (!open) { bs.picked.clear(); bs.editing = false; return; }
  _bsRenderPage();
  _bsEl('bs-search').focus();
}

// Escape steps back one thing per press, Figma-style: a list, the picks, editing, the page, the window.
function _bsEscape() {
  if (bs.pop) _bsClosePop();
  else if (bs.importing) { bs.importing = false; bestiaryRender(); }
  else if (bs.picked.size) { bs.picked.clear(); bestiaryRender(); }
  else if (bs.editing) { bs.editing = false; _bsRenderPage(); }
  else if (bs.open) { bs.open = null; _bsRenderPage(); }
  else bestiarySetOpen(false);
}

function _bsKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); _bsEscape(); return; }
  if (e.target.closest('input, textarea, select, [contenteditable]')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.code === 'KeyA') { e.preventDefault(); _bsShown().forEach(b => bs.picked.add(b.id)); bestiaryRender(); }
  else if (mod && e.code === 'KeyC') _bsClip = _bsTargets().map(combatSnapshot);
  else if (mod && e.code === 'KeyV') _bsAdd(_bsClip);
  else if (mod && e.code === 'KeyD') { e.preventDefault(); _bsAdd(_bsTargets()); }
  else if (e.code === 'Delete') _bsDelete(_bsTargets().map(b => b.id));
}

function initBestiary() {
  const btn = document.createElement('button');
  btn.id = 'btn-bestiary';
  btn.textContent = 'Bestiary';
  document.getElementById('btn-combat').after(btn);

  const modal = document.createElement('div');
  modal.id = 'bs-modal';
  modal.style.display = 'none';
  modal.innerHTML = `<div id="bs-panel" tabindex="-1">
    <div class="bs-head bs-norm">
      <span class="bs-title">Bestiary</span><span class="bs-count"></span><span class="bs-sp"></span>
      <button class="sm-hbtn" data-a="new">New monster</button>
      <button class="sm-hbtn primary" data-a="import">Import ▾</button>
      <button class="sm-bare" data-a="close" title="Close (Esc)">${BS_CLOSE}</button>
    </div>
    <div class="bs-head bs-act">
      <button class="sm-bare" data-a="unpick" title="Cancel selection (Esc)">${BS_CLOSE}</button>
      <span class="bs-picked"></span>
      <button class="sm-hbtn" data-a="pick-all"></button>
      <button class="sm-hbtn" data-a="dup">Duplicate</button>
      <button class="sm-hbtn" data-a="export">Export</button>
      <button class="sm-hbtn danger" data-a="del">Delete</button>
    </div>
    <div class="bs-importbar">
      <textarea id="bs-links" spellcheck="false" placeholder="Paste one or more monster page links, one per line"></textarea>
      <div class="col"><button class="sm-hbtn primary" data-a="go">Import</button><button class="sm-hbtn" data-a="no-import">Cancel</button></div>
    </div>
    <div class="bs-filters">
      <label class="sm-field">${BS_FIND}<input id="bs-search" placeholder="Search by name" spellcheck="false" autocomplete="off"></label>
      <span class="bs-fbtns"></span>
      <span class="bs-shown"></span>
    </div>
    <div id="bs-queue" class="bs-queue" style="display:none"></div>
    <div class="bs-wrap"><div id="bs-table"></div><div id="bs-page" style="display:none"></div></div>
    <input type="file" id="bs-file" accept=".json,application/json" style="display:none">
  </div>`;
  document.body.appendChild(modal);
  const panel = _bsEl('bs-panel');

  bpWire(_bsEl('bs-page'), {
    block: () => cbState.blocks[bs.open],
    // The page's own heading and the table follow a rename without redrawing the editor.
    edited: field => {
      if (field !== 'name' && field !== 'source' && field !== 'meta' && field !== 'cr' && field !== 'ac' && field !== 'hp') return;
      const b = cbState.blocks[bs.open];
      const h = _bsEl('bs-page').querySelector('.bs-page-head h2');
      h.textContent = b.name;
      bestiaryRender();
    },
    redraw: _bsRenderPage,
  });

  btn.addEventListener('click', () => bestiarySetOpen(!bsIsOpen()));
  modal.addEventListener('mousedown', e => {
    if (e.target === modal) { bestiarySetOpen(false); return; }
    if (bs.pop && !bs.pop.contains(e.target) && !e.target.closest('[data-filter], [data-a="import"]')) _bsClosePop();
    // Shift+click picks a range; without this the browser selects the text between.
    if (e.shiftKey && e.target.closest('tbody tr')) e.preventDefault();
    // Keys go to the window, not to the map, whatever was clicked inside it.
    if (!e.target.closest('input, textarea, select, button, [contenteditable]')) setTimeout(() => panel.focus());
  });
  // The map listens on the document; nothing pressed in here is the map's.
  modal.addEventListener('keydown', e => { _bsKey(e); e.stopPropagation(); });
  // A key pressed with nothing focused lands on the body, outside the window, while it is open.
  document.addEventListener('keydown', e => {
    if (!bsIsOpen() || modal.contains(e.target) || (bs.pop && bs.pop.contains(e.target))) return;
    _bsKey(e);
    e.stopPropagation();
  }, true);

  modal.addEventListener('click', e => {
    const t = e.target, a = t.closest('[data-a]'), act = a && a.dataset.a;
    if (act === 'close') return bestiarySetOpen(false);
    if (act === 'new') return _bsNew();
    if (act === 'import') return _bsImportMenu(a);
    if (act === 'go') return _bsStartImport();
    if (act === 'no-import') { bs.importing = false; return bestiaryRender(); }
    if (act === 'unpick') { bs.picked.clear(); return bestiaryRender(); }
    if (act === 'pick-all') { _bsShown().forEach(b => bs.picked.add(b.id)); return bestiaryRender(); }
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
    const f = t.closest('[data-filter]');
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
  });
  _bsEl('bs-search').addEventListener('input', e => { bs.f.q = e.target.value; bestiaryRender(); });
  _bsEl('bs-links').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) _bsStartImport(); });
  _bsEl('bs-file').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) _bsImportFile(file);
  });
}
