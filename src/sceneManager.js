'use strict';

// ─── Scene management ─────────────────────────────────────────────────────────

let switchGeneration = 0;     // monotone counter; each switchScene call captures its
                               // own generation and aborts if a newer call has started

const thumbURLs = new Map(); // scene id → blob URL for thumbnail display

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function generateThumbnail(bitmap, w, h) {
  const W = 400, H = Math.round(W * h / w);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  c.getContext('2d').drawImage(bitmap, 0, 0, W, H);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
}


// ── Dropdown UI state (module-local; only sceneManager.js touches these) ──────
let smSelectedIds = new Set();   // ids checked for bulk actions
let smDragId = null;             // id of the card being dragged
let smDragEl = null;             // its DOM node (moved directly so the drag survives)
let smPending = null;            // deferred delete: { items:[{id,index,meta}], ids:[…] }
let smUndoTimer = null;
let smSearch = '';              // what the find field holds, cleared when the library closes
let smGroupMenuEl = null;        // the open move-to-group popover, if any

// ── Checkbox / trash glyphs (built once, injected by string) ──────────────────
const SM_CHECK = '<svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="#8fb6ff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 4.5l2 2 4-4"/></svg>';
const SM_PEN   = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17z"/></svg>';
const SM_TRASH = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>';

function smIsOpen() {
  const m = document.getElementById('sm-modal');
  return !!m && m.style.display !== 'none';
}

function openDropdown() {
  const m = document.getElementById('sm-modal');
  if (!m) return;
  if (typeof doAutoSave === 'function') doAutoSave(); // persist current fog before a possible switch
  m.style.display = '';
  const dd = document.getElementById('scene-dd');
  if (dd) dd.classList.add('open');
  renderSceneManager();
  const q = document.getElementById('sm-search');
  if (q) { q.value = smSearch; q.focus(); }
}

function closeDropdown() {
  const m = document.getElementById('sm-modal');
  if (!m) return;
  m.style.display = 'none';
  const dd = document.getElementById('scene-dd');
  if (dd) dd.classList.remove('open');
  smSearch = '';
  smCloseGroupMenu();
  if (smSelectedIds.size) { smSelectedIds.clear(); renderSceneManager(); }
  document.body.classList.remove('sm-selecting');
}

function toggleDropdown() { smIsOpen() ? closeDropdown() : openDropdown(); }

function initSceneManagerUI() {
  const modal = document.getElementById('sm-modal');
  if (!modal) return;
  const fileInput = document.getElementById('file-input');

  loadGroupPrefs();

  document.getElementById('scene-dd-toggle').onclick = toggleDropdown;
  document.getElementById('sm-add').onclick = () => fileInput.click();
  document.getElementById('sm-close').onclick = closeDropdown;

  // "+" merges New Scene + Import: images/videos → new scenes, a lone .zip → restore backup.
  // Many files at once are fine; importMapFiles runs them one after another.
  fileInput.onchange = e => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    openDropdown();
    if (files.length === 1 && isZipFile(files[0])) { restorePickedZip(files[0]); return; }
    importMapFiles(files);
  };

  // Search. stopPropagation because input.js reads bare letters as tool shortcuts.
  const q = document.getElementById('sm-search');
  q.oninput = () => { smSearch = q.value; renderSceneManager(); };
  q.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); q.value = ''; smSearch = ''; renderSceneManager(); }
  };

  document.getElementById('sm-new-group').onclick = () => {
    const name = addGroup('New group');
    renderSceneManager();
    const el = document.querySelector('.sm-group[data-group="' + cssEscapeAttr(name) + '"] .sm-group-name');
    if (el) { el.focus(); el.select(); }
  };

  // ── contextual action bar ──
  document.getElementById('sm-sel-clear').onclick = () => { smSelectedIds.clear(); renderSceneManager(); };
  document.getElementById('sm-sel-all').onclick = () => {
    const shown = smVisibleScenes();
    if (shown.length && shown.every(s => smSelectedIds.has(s.id))) smSelectedIds.clear();
    else shown.forEach(s => smSelectedIds.add(s.id));
    renderSceneManager();
  };
  document.getElementById('sm-sel-export').onclick = () => {
    const ids = [...smSelectedIds];
    if (ids.length && typeof doExport === 'function') doExport(ids);
  };
  document.getElementById('sm-sel-delete').onclick = () => {
    if (smSelectedIds.size) deleteScenesWithUndo([...smSelectedIds]);
  };
  document.getElementById('sm-sel-group').onclick = e => {
    e.stopPropagation();
    if (smGroupMenuEl) { smCloseGroupMenu(); return; }
    smOpenGroupMenu(e.currentTarget);
  };

  // Undo toast
  document.querySelector('#scene-undo-toast .undo-btn').onclick = undoDelete;

  // Footer: the compress-on-import setting. mapConvert.js owns the state, the persistence and
  // the one-per-run explainer, so this only flips it and paints the result.
  const compress = document.getElementById('sm-compress');
  if (compress && typeof compressBigVideosEnabled === 'function') {
    const paint = on => compress.classList.toggle('on', on);
    // A label wrapping no input, so the click is ours and needs no preventDefault.
    compress.addEventListener('click', () => paint(toggleCompressBigVideos()));
    paint(compressBigVideosEnabled());
  }

  // Allow drops in the gaps between cards
  document.getElementById('sm-list').addEventListener('dragover', e => e.preventDefault());

  // Click the veil to close; anything inside the panel is the panel's own business.
  modal.addEventListener('mousedown', e => { if (e.target === modal) closeDropdown(); });
  // ⚠ CONTAINMENT, NOT stopPropagation. This listener is on the capture phase, which runs
  // top-down, so it fires before the menu's own handler could stop anything.
  document.addEventListener('mousedown', e => {
    if (!smGroupMenuEl) return;
    if (smGroupMenuEl.contains(e.target)) return;
    if (e.target.closest && e.target.closest('#sm-sel-group')) return; // that button toggles it
    smCloseGroupMenu();
  }, true);

  // Escape: drop a selection first, close the library second. Two presses, never one that
  // does both, or cancelling a mis-click also throws away the panel.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !smIsOpen()) return;
    if (smGroupMenuEl) { smCloseGroupMenu(); return; }
    if (smSelectedIds.size) { smSelectedIds.clear(); renderSceneManager(); return; }
    closeDropdown();
  });

  window.addEventListener('beforeunload', commitPendingDelete);
}

function cssEscapeAttr(s) { return String(s).replace(/["\\]/g, '\\$&'); }

function updateTriggerName() {
  const el = document.getElementById('scene-dd-name');
  if (el) el.textContent = currentScene ? currentScene.name : (allScenes.length ? 'Select a scene' : 'No scenes');
}

// Scenes the search currently shows. Bulk actions act on these and never on the whole
// library, so "Select all" under a filter means what it says.
function smVisibleScenes() {
  const q = smSearch.trim().toLowerCase();
  if (!q) return allScenes.slice();
  return allScenes.filter(s => String(s.name || '').toLowerCase().includes(q));
}

// ── Move-to-group menu (bulk) ────────────────────────────────────────────────
function smCloseGroupMenu() {
  if (smGroupMenuEl) { smGroupMenuEl.remove(); smGroupMenuEl = null; }
}

function smOpenGroupMenu(anchor) {
  smCloseGroupMenu();
  const panel = document.getElementById('sm-panel');
  if (!panel) return;

  // Ungrouped IS a group row. "Remove from group" said the same thing a second way.
  const rows = [{ label: 'Ungrouped', group: '' }]
    .concat(knownGroupNames().map(n => ({ label: n, group: n })));
  rows.push({ sep: true });
  rows.push({ label: 'New group…', group: null, fresh: true });

  const menu = document.createElement('div');
  menu.className = 'sm-menu';
  menu.innerHTML = rows.map((r, i) => r.sep
    ? '<div class="sm-menu-sep"></div>'
    : '<button class="sm-menu-row" data-i="' + i + '">' + escHtml(r.label) + '</button>'
  ).join('');

  // ⚠ ANCHOR THE RIGHT EDGE, NOT THE LEFT. The button sits near the panel's right edge and
  // #sm-panel is overflow: hidden, so a left-anchored menu wider than the button is clipped.
  //
  // The panel carries the zoom and the menu is its child, so the rect the browser reports is
  // in screen px while the offset written back is in pre-zoom px. Divide by the ratio the
  // anchor itself proves, rather than reading --ui-zoom and hoping it is current.
  const a = anchor.getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  const z = anchor.offsetHeight ? (a.height / anchor.offsetHeight) : 1;
  menu.style.top   = ((a.bottom - p.top) / z + 6) + 'px';
  menu.style.right = ((p.right - a.right) / z) + 'px';

  menu.addEventListener('mousedown', e => e.stopPropagation());
  menu.onclick = e => {
    const btn = e.target.closest('.sm-menu-row');
    if (!btn) return;
    const row = rows[+btn.dataset.i];
    const target = row.fresh ? addGroup('New group') : row.group;
    const ids = [...smSelectedIds];
    smCloseGroupMenu();
    smSelectedIds.clear();   // the move is what the selection was gathered for
    smAssignGroup(ids, target);
  };

  panel.appendChild(menu);
  smGroupMenuEl = menu;
}

// Writes a group onto scenes, in memory and in the store. The in-memory record moves too,
// for the same reason persistSceneOrder does it: doAutoSave writes currentScene wholesale.
function smAssignGroup(ids, group) {
  const g = sanitizeGroupName(group);
  for (const id of ids) {
    const s = allScenes.find(x => x.id === id);
    if (!s || sanitizeGroupName(s.group) === g) continue;
    s.group = g;
    if (currentScene && currentScene.id === id) currentScene.group = g;
    sceneStore.updateScene(id, sc => { sc.group = g; }).catch(console.error);
  }
  // ⚠ THE SELECTION IS NOT THIS FUNCTION'S TO CLEAR. A group rename comes through here too,
  // and clearing here threw away ticks the DM was still gathering. The bulk menu clears its
  // own selection, because there the move IS the action the selection was for.
  renderSceneManager();
}

function renderSceneManager() {
  updateTriggerName();

  const list = document.getElementById('sm-list');
  if (!list) return;

  // sync thumbnail blob URLs with the current scene set
  const ids = new Set(allScenes.map(s => s.id));
  for (const [id, url] of thumbURLs) {
    if (!ids.has(id)) { URL.revokeObjectURL(url); thumbURLs.delete(id); }
  }
  for (const s of allScenes) {
    if (!thumbURLs.has(s.id) && s.thumbnail) thumbURLs.set(s.id, URL.createObjectURL(s.thumbnail));
  }

  const selecting = smSelectedIds.size > 0;
  document.body.classList.toggle('sm-selecting', selecting);
  const selCount = document.getElementById('sm-sel-count');
  if (selCount) selCount.textContent = smSelectedIds.size + ' selected';

  const shown = smVisibleScenes();
  const q = smSearch.trim();
  const countEl = document.getElementById('sm-count');
  if (countEl) countEl.textContent = q ? shown.length + ' / ' + allScenes.length : String(allScenes.length);

  list.innerHTML = '';
  if (!allScenes.length) {
    list.innerHTML = '<div id="sm-empty">No scenes yet. Add a map to start.</div>';
    return;
  }
  if (!shown.length) {
    list.innerHTML = '<div id="sm-empty">No scene matches “' + escHtml(q) + '”.</div>';
    return;
  }

  // Searching flattens the library on purpose: a group must never be able to hide a map
  // from a search, and a heading over a single match is noise.
  if (q) {
    const grid = document.createElement('div');
    grid.className = 'sm-grid';
    for (const s of shown) grid.appendChild(buildSceneCard(s));
    list.appendChild(grid);
    smSizeNameFields(list);
    return;
  }

  for (const sec of sceneGroupSections(allScenes)) list.appendChild(buildGroupSection(sec));
  smSizeNameFields(list);
}

// ⚠ AN INPUT DOES NOT SHRINK TO ITS TEXT. It takes a default width of about twenty
// characters whatever it holds, which parked a group's count that far from its name. So the
// text is measured and the width written back; the same measurement runs while typing.
// ⚠ THE MEASURING CONTEXT IS LAZY. This file is require()d by its own unit test, where
// there is no document, so building a canvas at module scope breaks the test run.
let _smTextMeasure = null;
const SM_GROUP_FONT = '600 13px system-ui, -apple-system, sans-serif';
function smFitGroupName(el) {
  if (!_smTextMeasure) _smTextMeasure = document.createElement('canvas').getContext('2d');
  _smTextMeasure.font = SM_GROUP_FONT;
  const w = _smTextMeasure.measureText(el.value || '').width;
  el.style.width = Math.min(300, Math.max(48, Math.ceil(w) + 16)) + 'px';
}

// A textarea has no intrinsic height and a name may run to three lines. Measured after
// insertion, because scrollHeight is 0 on a node that is not in the document yet.
function smSizeName(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function smSizeNameFields(root) {
  for (const el of root.querySelectorAll('.sm-name')) smSizeName(el);
  for (const el of root.querySelectorAll('input.sm-group-name')) smFitGroupName(el);
}

function buildGroupSection(sec) {
  const wrap = document.createElement('div');
  wrap.className = 'sm-group' + (isGroupShut(sec.name) ? ' shut' : '');
  wrap.dataset.group = sec.name;

  const head = document.createElement('div');
  head.className = 'sm-group-head';
  head.innerHTML =
    '<svg class="sm-group-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>' +
    (sec.ungrouped
      ? '<span class="sm-group-name">Ungrouped</span>'
      : '<input class="sm-group-name" spellcheck="false" title="Click to rename this group">') +
    '<span class="sm-group-n">' + sec.scenes.length + '</span>' +
    '<span class="sm-group-sp"></span>' +
    // The name field alone was the rename, and nobody found it. The pencil is the
    // affordance; it just puts the caret in that field.
    (sec.ungrouped ? '' :
      '<button class="sm-bare sm-group-ren" title="Rename this group">' + SM_PEN + '</button>' +
      '<button class="sm-bare danger sm-group-del" title="Delete this group">' + SM_TRASH + '</button>');

  // The chevron, the count and the empty space collapse. The NAME does not — it is the
  // rename field, and a click that both renamed and collapsed would do neither cleanly.
  head.onclick = e => {
    if (e.target.closest('.sm-group-name') || e.target.closest('.sm-bare')) return;
    // Ungrouped collapses too. It carries no rename and no delete, but it is a heading over
    // a pile of cards like any other, so refusing to fold it away is an arbitrary exception.
    toggleGroupShut(sec.name);
    renderSceneManager();
  };

  if (!sec.ungrouped) {
    const nameEl = head.querySelector('input.sm-group-name');
    nameEl.value = sec.name;
    let orig = sec.name;
    smFitGroupName(nameEl);
    nameEl.oninput = () => smFitGroupName(nameEl);
    nameEl.onfocus = () => { orig = sec.name; nameEl.select(); };
    nameEl.onkeydown = e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); nameEl.value = orig; nameEl.blur(); }
    };
    nameEl.onblur = () => {
      const next = sanitizeGroupName(nameEl.value);
      if (!next || next === sec.name) { nameEl.value = sec.name; return; }
      const apply = () => {
        const final = renameGroupInOrder(sec.name, next);
        smAssignGroup(sec.scenes.map(s => s.id), final);
      };
      // Typing a name another group already wears MERGES the two, and merging cannot be
      // undone — the old heading is gone from every scene that wore it. So it is a question.
      if (!knownGroupNames().some(n => n !== sec.name && n === next)) { apply(); return; }
      confirmDialog({
        title: 'Merge these groups?',
        message: '“' + next + '” already exists. Both groups end up under that one heading, ' +
                 'and “' + sec.name + '” goes away. No map is deleted, and the merge has no undo.',
        confirmLabel: 'Merge',
        onConfirm: apply,
        onCancel: () => { nameEl.value = sec.name; },
      });
    };

    head.querySelector('.sm-group-ren').onclick = e => {
      e.stopPropagation();
      nameEl.focus(); nameEl.select();
    };
    head.querySelector('.sm-group-del').onclick = e => {
      e.stopPropagation();
      deleteGroup(sec);
    };
  }

  wrap.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'sm-grid';
  if (sec.scenes.length) {
    for (const s of sec.scenes) grid.appendChild(buildSceneCard(s));
  } else {
    const hole = document.createElement('div');
    hole.className = 'sm-group-empty';
    hole.textContent = 'Drag scenes here';
    grid.appendChild(hole);
  }
  wrap.appendChild(grid);

  // Dropping anywhere in the section files the dragged scene under this heading.
  wrap.addEventListener('dragover', e => {
    if (!smDragEl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    wrap.classList.add('drop');
    // An empty section holds no card to insert against, so the grid itself takes the node.
    if (!grid.contains(smDragEl) && !grid.querySelector('.sm-card')) grid.appendChild(smDragEl);
  });
  wrap.addEventListener('dragleave', e => {
    if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('drop');
  });
  wrap.addEventListener('drop', e => {
    e.preventDefault();
    wrap.classList.remove('drop');
    if (smDragEl && !grid.contains(smDragEl)) grid.appendChild(smDragEl);
  });

  return wrap;
}

// Deletes the heading, never the maps. Everything filed under it falls back to Ungrouped,
// which is why an empty group goes without a question and a full one asks.
function deleteGroup(sec) {
  const finish = () => {
    forgetGroup(sec.name);
    smAssignGroup(sec.scenes.map(s => s.id), '');
    renderSceneManager();
  };
  if (!sec.scenes.length) { finish(); return; }
  confirmDialog({
    title: 'Delete this group?',
    message: '“' + sec.name + '” holds ' + sec.scenes.length + ' scene' +
             (sec.scenes.length === 1 ? '' : 's') +
             '. The group goes away and they move to Ungrouped. No map is deleted.',
    confirmLabel: 'Delete group',
    danger: true,
    onConfirm: finish,
  });
}

function buildSceneCard(s) {
  const isActive   = currentScene && currentScene.id === s.id;
  const isSelected = smSelectedIds.has(s.id);

  const card = document.createElement('div');
  card.className = 'sm-card' + (isActive ? ' active' : '') + (isSelected ? ' selected' : '');
  card.dataset.id = s.id;
  // ⚠ NOT DRAGGABLE UNDER A SEARCH. A filtered list holds part of the library, and an order
  // read back off it renumbers scenes that were never on screen — see commitDragOrder.
  card.draggable = !smSearch.trim();

  card.innerHTML =
    '<div class="sm-frame"><div class="sm-thumb">' +
      '<div class="sm-scrim"></div>' +
      (isActive ? '<span class="sm-badge"><i></i>Live</span>' : '') +
      '<div class="sm-cb' + (isSelected ? ' checked' : '') + '">' + (isSelected ? SM_CHECK : '') + '</div>' +
      '<div class="sm-botrow">' +
        '<textarea class="sm-name" rows="1" spellcheck="false"></textarea>' +
        '<button class="sm-trash" title="Delete scene">' + SM_TRASH + '</button>' +
      '</div>' +
    '</div></div>';

  const thumbURL = thumbURLs.get(s.id);
  if (thumbURL) card.querySelector('.sm-thumb').style.backgroundImage = 'url("' + thumbURL + '")';

  const nameEl = card.querySelector('.sm-name');
  nameEl.value = s.name;

  // checkbox → toggle selection
  card.querySelector('.sm-cb').onclick = e => { e.stopPropagation(); toggleSelect(s.id); };

  // trash → delete with undo
  const trash = card.querySelector('.sm-trash');
  trash.onmousedown = e => e.stopPropagation();
  trash.onclick = e => { e.stopPropagation(); deleteScenesWithUndo([s.id]); };

  // inline rename — clicking the name edits it (no rename button)
  let orig = s.name;
  nameEl.onmousedown = e => e.stopPropagation();
  nameEl.onclick     = e => e.stopPropagation();
  nameEl.onfocus     = () => { orig = s.name; nameEl.select(); };
  nameEl.oninput     = () => { s.name = nameEl.value; smSizeName(nameEl); };
  nameEl.onkeydown   = e => {
    e.stopPropagation();
    // Enter commits rather than inserting the newline a textarea would otherwise take.
    if (e.key === 'Enter')  { e.preventDefault(); nameEl.blur(); }
    else if (e.key === 'Escape') { s.name = orig; nameEl.value = orig; nameEl.blur(); }
  };
  // ⚠ RESIZE THE FIELD HERE, AND NEVER RE-RENDER THE LIST ON A BLUR. A blur is caused by the
  // mousedown of the click that follows it, so rebuilding #sm-list here detaches the node that
  // mousedown landed on; mouseup then lands on a fresh one and no click event ever fires —
  // editing a name and then pressing that card's delete did nothing at all.
  nameEl.onblur = () => { commitSceneName(s, nameEl); smSizeName(nameEl); };

  // card click → select (in selection mode) or switch scene
  card.onclick = e => {
    if (e.target.closest('.sm-name') || e.target.closest('.sm-trash') || e.target.closest('.sm-cb')) return;
    if (smSelectedIds.size > 0) { toggleSelect(s.id); return; }
    if (!isActive) switchScene(s.id).catch(err => console.error('switchScene failed:', err));
  };

  // drag to reorder, and to refile (never starts from the name field)
  card.ondragstart = e => {
    if (e.target && e.target.tagName === 'TEXTAREA') { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'move';
    smDragId = s.id; smDragEl = card;
    card.classList.add('dragging');
  };
  card.ondragover = e => {
    e.preventDefault();
    if (!smDragEl || smDragId === s.id) return;
    // A grid, so the insert side is HORIZONTAL. The old vertical test belonged to a single
    // column; in a grid it puts a card at the end of the row above whenever the pointer is
    // in the top half of a card one row down.
    const r = card.getBoundingClientRect();
    const before = (e.clientX - r.left) < r.width / 2;
    card.parentNode.insertBefore(smDragEl, before ? card : card.nextSibling);
  };
  card.ondragend = () => {
    if (smDragEl) smDragEl.classList.remove('dragging');
    document.querySelectorAll('.sm-group.drop').forEach(g => g.classList.remove('drop'));
    commitDragOrder();
    smDragId = null; smDragEl = null;
  };

  return card;
}

function toggleSelect(id) {
  if (smSelectedIds.has(id)) smSelectedIds.delete(id);
  else smSelectedIds.add(id);
  renderSceneManager();
}

function commitSceneName(s, input) {
  const v = (input.value || '').replace(/\s+/g, ' ').trim() || 'Untitled';
  s.name = v; input.value = v;
  if (currentScene && currentScene.id === s.id) currentScene.name = v;
  // updateScene, never load-then-save: the two are separate transactions and doAutoSave()
  // fits between them, so the save half would write back the record read before it.
  sceneStore.updateScene(s.id, sc => { sc.name = v; }).catch(console.error);
  updateTriggerName();
}

// Reads BOTH facts back out of the DOM at once: the section a card ended up in is its group,
// and the order across every section is the sort order. Splitting them would need the drop
// target threaded through the drag, which the browser does not hand over.
function commitDragOrder() {
  const list = document.getElementById('sm-list');
  if (!list) return;
  const order = [];
  const groupOf = {};
  for (const sec of list.querySelectorAll('.sm-group')) {
    const g = sanitizeGroupName(sec.dataset.group);
    for (const el of sec.querySelectorAll('.sm-card')) { order.push(el.dataset.id); groupOf[el.dataset.id] = g; }
  }
  // ⚠ REFUSE A PARTIAL VIEW, NEVER RENUMBER FROM ONE. order.indexOf answers -1 for a scene
  // the DOM does not hold, which sorts every hidden scene to the FRONT and then writes that
  // order to the store — a reorder the DM never made, of maps they could not see. A search
  // flattens the list into one grid with no sections, which is exactly that case; cards are
  // not draggable while one is active, and this is the backstop if that ever slips.
  if (order.length !== allScenes.length) return;

  allScenes.sort((a, b) => order.indexOf(String(a.id)) - order.indexOf(String(b.id)));
  allScenes.forEach((s, i) => {
    s.sortOrder = i;
    if (Object.prototype.hasOwnProperty.call(groupOf, s.id)) s.group = groupOf[s.id];
  });
  persistSceneOrder();
  renderSceneManager();
}

function persistSceneOrder() {
  for (const s of allScenes) {
    const g = sanitizeGroupName(s.group);
    // The IN-MEMORY record moves too. doAutoSave() writes currentScene wholesale, so a
    // sortOrder written only to the store is reverted by the next autosave — the reorder
    // survives until the DM reveals something, then quietly undoes itself.
    if (currentScene && currentScene.id === s.id) { currentScene.sortOrder = s.sortOrder; currentScene.group = g; }
    // One transaction per scene, and no write at all where the record is already right.
    sceneStore.updateScene(s.id, sc => {
      if (sc.sortOrder === s.sortOrder && sanitizeGroupName(sc.group) === g) return false;
      sc.sortOrder = s.sortOrder;
      sc.group = g;
    }).catch(console.error);
  }
}

async function initScenes() {
  try { await sceneStore.initSceneDB(); }
  catch (err) { console.warn('IndexedDB unavailable, scene persistence disabled:', err); return; }
  allScenes = await sceneStore.listScenes();
  allScenes.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  renderSceneManager();
  const lastId = localStorage.getItem('evermist-current-scene-id');
  if (lastId && allScenes.find(s => s.id === lastId)) await switchScene(lastId);
}

// Restores a picked backup. Electron 32 removed File.path, so the real path comes from the
// preload bridge; there is no bytes fallback, because main reads the archive off disk.
function restorePickedZip(f) {
  const zipPath = (window.electronAPI && window.electronAPI.getPathForFile)
    ? window.electronAPI.getPathForFile(f)
    : null;
  if (zipPath && typeof restoreFromZipPath === 'function') {
    restoreFromZipPath(zipPath);
  } else {
    messageDialog({
      title: 'Backups need the desktop app',
      message: 'Restoring a .zip reads it straight off disk, which the browser will not allow. Open Evermist as the app to import this.',
    });
  }
}

// ─── Importing maps ───────────────────────────────────────────────────────────
// The "+" picker and a drop on the window both land in importMapFiles. THE LOOP LIVES HERE,
// in the module that owns scene creation — never a second one in toolbar.js.

// What either route accepts, tested the same way for both so the picker and a drop can never
// disagree about what is importable.
const MAP_FILE_RE = /\.(jpe?g|png|gif|bmp|webp|svg|mp4|webm)$/i;

function isImportableMapFile(f) {
  return !!f && (MAP_FILE_RE.test(f.name) ||
                 !!(f.type && (f.type.startsWith('image/') || f.type.startsWith('video/'))));
}

function isZipFile(f) {
  return !!f && (/\.zip$/i.test(f.name) || f.type === 'application/zip' ||
                 f.type === 'application/x-zip-compressed');
}

// Imports every file, STRICTLY ONE AFTER ANOTHER. Ten maps, walk away, come back done.
//
// Nothing appears at the end of a clean run. A run with failures ends in ONE dialog naming
// exactly what did not make it, and each map's own dialog is suppressed while a batch is on, so
// one bad file cannot stop an unattended run to ask about itself.
async function importMapFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  const batch = list.length > 1;

  // ⚠ A ZIP IN A CROWD IMPORTS NOTHING. Restoring appends scenes and carries the module text, of
  // which the app holds one — so it is a blocking question in the middle of a run nobody is
  // watching. On its own it still restores, through the caller.
  const zip = list.find(isZipFile);
  if (zip) {
    messageDialog({
      title: 'Import the backup on its own',
      message: '“' + zip.name + '” is a backup, and restoring one is its own job. Import it by ' +
               'itself, then come back for the maps.',
    });
    return;
  }

  // Filtered UP FRONT, before anything loads: the picker does no type filtering of its own, so
  // without this an unimportable file reaches createNewScene and reports from inside the run.
  const failures = [];
  const queue = [];
  for (const f of list) {
    if (isImportableMapFile(f)) queue.push(f);
    else failures.push('“' + f.name + '” is not an image or an animated map.');
  }

  const ids = [];
  try {
    for (let i = 0; i < queue.length; i++) {
      const f = queue[i];
      if (batch) {
        setMapProgressPrefix('Map ' + (i + 1) + ' of ' + queue.length + ' - ' + sceneNameForFile(f));
        showMapProgress('Reading the map…');
      }
      // ⚠ THE ORIGINALLY PICKED File, STRAIGHT THROUGH. findPlanForFile needs its path on disk,
      // so a File rebuilt on the way here arrives with no floor plan — see createNewScene.
      // Caught per file, so one map that throws on its way in costs that map and not the run.
      let r = null;
      try { r = await createNewScene(f, { quiet: batch }); }
      catch (err) { console.error('[importMapFiles] import threw', err); }
      if (r && r.ok) ids.push(r.id);
      else failures.push('“' + f.name + '” ' + ((r && r.reason) || 'would not open.'));
    }
  } finally {
    setMapProgressPrefix('');
    hideMapProgress();
  }

  // A single import lands on its map, exactly as it always has. A batch lands on the FIRST of
  // the batch, and that is the one map whose floor plan gets offered.
  if (batch && ids.length) {
    if (ids.length > 1) await switchScene(ids[0]).catch(err => console.error('switchScene failed:', err));
    if (typeof offerStoredFloorPlan === 'function') offerStoredFloorPlan();
  }

  // ⚠ THE OVERLAY IS z-index 10000 AND THE DIALOG ANCHOR IS 620, so a dialog raised under it is
  // invisible. It is already down (the finally above) and this is the last thing to run.
  if (batch && failures.length) {
    messageDialog({
      title: failures.length === 1 ? 'One map did not make it' : failures.length + ' maps did not make it',
      message: failures.join('\n'),
    });
  }
}

// The scene name a file will get, so a batch's progress label and the scene it creates agree.
function sceneNameForFile(file) {
  return file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim() || 'New Scene';
}

// Resolves { ok, id, name, reason } once the map is either on screen or refused — NEVER BEFORE,
// and never not at all. That is what lets importMapFiles run a batch strictly one at a time: the
// loaders are callback-based, so without this the second import would start while the first was
// still in cleanupVideo.
//
// ⚠ SETTLE ON EVERY FAILURE EXIT. There are four — loadVideoFromFile's falsy-file return,
// loadMapFromFile's unmatched-type return, and each loader's decode failure — plus anything the
// save path itself throws. Miss one and a single bad file hangs the whole batch on a promise that
// never settles, with the progress overlay up.
//
// opts.quiet: a batch is doing the reporting, so no dialog and no floor-plan notice from here.
async function createNewScene(file, opts) {
  const o = opts || {};
  const isVid = isVideoFile(file);
  const name = sceneNameForFile(file);

  // ⚠ THE FLOOR PLAN IS RESOLVED FIRST, FROM THE FILE THE DM ACTUALLY PICKED. findPlanForFile
  // needs getPathForFile, and a File built in-page has no path on disk — so converting first
  // loses the plan silently, with no notice and no Draw Rooms button, on exactly the oversized
  // exports that ship a .dd2vtt.
  const floorPlan = typeof findPlanForFile === 'function' ? await findPlanForFile(file) : null;

  // Then shrink it, if the setting in the scene dropdown is on. No confirmation: it is a
  // setting, and a setting that asks every time is a question wearing the wrong clothes.
  // The overlay is raised from onStart rather than here, so a map that already fits the box
  // never flashes a progress bar.
  let shrunk = null;
  if (isVid && typeof convertVideoForImport === 'function' && compressBigVideosEnabled()) {
    shrunk = await convertVideoForImport(file, {
      onStart: () => showMapProgress('Shrinking the animated map…'),
      onProgress: updateMapProgress,
    });
    if (shrunk.converted) file = shrunk.file;
    else shrunk = null;
    hideMapProgress();
  }

  if (!isVid) showMapProgress('Loading map…');
  if (currentScene) doAutoSave();
  cleanupVideo();
  const maxOrder = allScenes.length > 0 ? Math.max(...allScenes.map(s => s.sortOrder ?? 0)) : -1;

  // One deferred, settled by whichever of the paths below gets there first.
  let settle = null;
  const settled = new Promise(r => { settle = r; });
  const finish = result => {
    if (!settle) return;
    const answer = settle; settle = null;
    if (!result.ok) {
      hideMapProgress();
      if (!o.quiet) messageDialog({
        title: isVid ? 'Animated map would not play' : 'Map would not open',
        message: '“' + file.name + '” ' + result.reason,
      });
    }
    answer(result);
  };

  const onLoaded = async (bitmap, blob) => {
   try {
    const thumb = await generateThumbnail(bitmap, mapWidth, mapHeight);
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);

    let mapBlob = undefined;
    let mapPath = undefined;
    if (isVid && window.electronAPI) {
      // A statement of what happened, carried on the label of the longest step that follows it,
      // so it is on screen long enough to read. Never a dialog: nothing here needs an answer.
      showMapProgress(shrunk
        ? 'Saving — shrunk ' + shrunk.srcW + '×' + shrunk.srcH + ' to ' + shrunk.outW + '×' + shrunk.outH
        : 'Saving animated map…');
      const mimeType = file.type || (file.name.endsWith('.mp4') ? 'video/mp4' : 'video/webm');
      try {
        mapPath = await persistVideoMap(file, id, mimeType);
      } catch (err) {
        // Never leave the progress overlay up: an unhandled rejection here is exactly
        // what made a failed save look like a permanent "Saving video map…" hang.
        // Falling back to the legacy in-IndexedDB blob keeps the import working; the
        // lazy migration in switchScene retries moving it to disk later.
        console.error('[createNewScene] saving video map to disk failed', err);
        mapBlob = mapVideoBlob;
      }
      hideMapProgress();
    } else {
      mapBlob = isVid ? mapVideoBlob : blob;
    }

    // floorPlan was captured at the top of createNewScene, before conversion. It could not be
    // read here in any case: persistVideoMap has just copied the map into userData/maps, so it
    // no longer sits beside its .dd2vtt and a disk lookup would find nothing.
    const scene = {
      id, name,
      group:         '',   // a new map is Ungrouped; the DM files it, never the import
      mapBlob, mapPath,
      mapType:       isVid ? 'video' : 'image',
      mapWidth, mapHeight,
      floorPlan,
      polygons:      [],
      nextPolygonId: 1,
      baseFogBlob:   await fogToBlob(),
      // NOT captureGridConfig(): the live cell size and offset belong to the map that was on
      // screen a moment ago, and inheriting them is what made the grid look shared between
      // scenes. freshGridConfig (grid.js) keeps the look and resets the fit.
      gridConfig:    freshGridConfig(),
      thumbnail:     thumb,
      createdAt:     Date.now(),
      sortOrder:     maxOrder + 1,
    };
    allScenes.push({ id, name, group: '', thumbnail: thumb, sortOrder: scene.sortOrder, createdAt: scene.createdAt, mapType: scene.mapType });
    await sceneStore.saveScene(scene);
    hideMapProgress();
    // Reload through the proven scene-switch path. The direct drop-load path leaves the
    // PixiJS fog/video uninitialised until a manual switch (map renders fully revealed,
    // shroud has no effect, video frozen). switchScene() rebuilds everything correctly.
    currentScene = null;
    await switchScene(id);
    // AFTER the switch, never before: mapWidth is not known until the map has loaded, and
    // switchScene applies the scene's stored gridConfig on its way in. Only the import runs
    // this — Draw Rooms pressed later must leave a hand-tuned grid alone (floorPlan.js).
    if (typeof applyPlanGridSize === 'function') applyPlanGridSize();
    // Asked only once the map is actually on screen, so the DM is deciding about something
    // they can see. Cancel means "later" — the Fog tab's Draw Rooms is the second chance.
    // Suppressed during a batch: nine notices would flicker past and be discarded, so the
    // loop shows one for the map the DM lands on.
    if (!o.quiet && typeof offerStoredFloorPlan === 'function') offerStoredFloorPlan();
    finish({ ok: true, id, name });
   } catch (err) {
    // The fifth way this ends: the save path itself throwing. Left unhandled that is an
    // unsettled promise with the overlay up, which is a hang rather than a failure.
    console.error('[createNewScene] import failed', err);
    finish({ ok: false, name, reason: 'could not be saved. ' + (err && err.message ? err.message : '') });
   }
  };
  if (isVid) loadVideoFromFile(file, onLoaded, reason => finish({ ok: false, name, reason }));
  else loadMapFromFile(file, onLoaded, reason => finish({ ok: false, name, reason }));
  return settled;
}

// Writes a picked video map into userData/maps and returns its relative mapPath.
//
// Two routes, because Electron 32 removed File.path: prefer a real filesystem path
// (webUtils via preload) so main can STREAM the copy with progress and no large
// allocation; fall back to shipping the bytes for a File that has no path on disk.
// Both main-process handlers already existed — only the renderer was still asking
// for the removed File.path, which rejected and hung the import.
async function persistVideoMap(file, sceneId, mimeType) {
  const ext = mimeType === 'video/mp4' ? '.mp4' : '.webm';
  const srcPath = window.electronAPI.getPathForFile
    ? window.electronAPI.getPathForFile(file)
    : null;
  if (srcPath) {
    await window.electronAPI.saveVideoFile(srcPath, sceneId, mimeType);
  } else {
    const ab = await file.arrayBuffer();
    await window.electronAPI.saveVideoBlob(sceneId, ab, mimeType);
  }
  return 'maps/' + sceneId + ext;
}

async function replaceSceneMap(file) {
  if (!currentScene) { createNewScene(file); return; }
  const isVid = isVideoFile(file);

  // ⚠ NEVER SHRINK ONTO A SCENE THAT ALREADY HAS SHAPES. This function rewrites mapWidth and
  // mapHeight but never touches currentScene.polygons or currentScene.effects, and switchScene
  // restores their vertices verbatim, so a shrink would move every one of them by the scale
  // factor — a silent displacement, not an error.
  //
  // EFFECTS COUNT, NOT JUST ROOMS. An effect is the same record with a material where a room
  // has a fog mode (effects.js), so its vertices are map-space too. Checking rooms alone left
  // a scene carrying only fires free to convert and move every fire.
  const hasShapes = (Array.isArray(currentScene.polygons) && currentScene.polygons.length > 0) ||
                    (Array.isArray(currentScene.effects)  && currentScene.effects.length  > 0);
  let shrunk = null;
  if (isVid && !hasShapes && typeof convertVideoForImport === 'function' && compressBigVideosEnabled()) {
    shrunk = await convertVideoForImport(file, {
      onStart: () => showMapProgress('Shrinking the animated map…'),
      onProgress: updateMapProgress,
    });
    if (shrunk.converted) file = shrunk.file;
    else shrunk = null;
    hideMapProgress();
  }

  cleanupVideo();
  const onLoaded = async (bitmap, blob) => {
    if (isVid && window.electronAPI) {
      // Delete old video file if this scene had one
      if (currentScene.mapPath) {
        window.electronAPI.deleteVideoFile(currentScene.id).catch(() => {});
      }
      showMapProgress(shrunk
        ? 'Saving — shrunk ' + shrunk.srcW + '×' + shrunk.srcH + ' to ' + shrunk.outW + '×' + shrunk.outH
        : 'Saving animated map…');
      const mimeType = file.type || (file.name.endsWith('.mp4') ? 'video/mp4' : 'video/webm');
      try {
        currentScene.mapPath = await persistVideoMap(file, currentScene.id, mimeType);
        currentScene.mapBlob = undefined;
      } catch (err) {
        console.error('[replaceSceneMap] saving video map to disk failed', err);
        currentScene.mapPath = undefined;
        currentScene.mapBlob = mapVideoBlob;
      }
      hideMapProgress();
    } else {
      currentScene.mapBlob = isVid ? mapVideoBlob : blob;
      currentScene.mapPath = undefined;
    }
    currentScene.mapType    = isVid ? 'video' : 'image';
    currentScene.mapWidth   = mapWidth;
    currentScene.mapHeight  = mapHeight;
    currentScene.baseFogBlob = await fogToBlob();
    const thumb = await generateThumbnail(bitmap, mapWidth, mapHeight);
    currentScene.thumbnail = thumb;
    const meta = allScenes.find(s => s.id === currentScene.id);
    if (meta) meta.thumbnail = thumb;
    await sceneStore.saveScene(currentScene);
    renderSceneManager();
    // Reload through the proven scene-switch path (see createNewScene): the direct
    // drop-load path leaves PixiJS fog/video uninitialised until a manual switch.
    const sid = currentScene.id;
    currentScene = null;
    await switchScene(sid);
  };
  if (isVid) loadVideoFromFile(file, onLoaded);
  else loadMapFromFile(file, onLoaded);
}

async function switchScene(id, _isRecovery = false) {
  if (currentScene && currentScene.id === id) return;
  const myGen = ++switchGeneration;
  if (currentScene) doAutoSave();
  const prevId = currentScene ? currentScene.id : null;
  currentScene = null;
  cleanupVideo();
  // Abort any in-flight reveal/shroud crossfade from the outgoing scene so its
  // tick can't keep running against orphaned snapshot canvases. The drifting
  // anim loop is persistent + idempotent — leave it running across the switch.
  stopFogTransition();
  if (!isPlayer && playerWindow && !playerWindow.closed) {
    playerWindow.postMessage({ type: 'scene-transition', phase: 'out' }, '*');
    _sceneOutPostedAt = Date.now();
  }
  try {
  const scene = await sceneStore.loadScene(id);
  if (myGen !== switchGeneration) return;
  if (!scene) throw new Error('Scene not found.');

  // Send the destination fog colour AS SOON AS IT IS KNOWN, so the Player can arrive at it
  // while the fog is still closing. This has to beat applyFogSettingsFromScene further down,
  // which pushes the same colour as an ordinary live change and would land it in one frame.
  if (!isPlayer && playerWindow && !playerWindow.closed) {
    const destHex = scene.fogSettings && scene.fogSettings.pickedHex;
    if (destHex) playerWindow.postMessage({ type: 'scene-transition', phase: 'tint', pickedHex: destHex }, '*');
  }

  if (mapBitmap) { mapBitmap.close(); mapBitmap = null; }
  mapWidth   = scene.mapWidth;
  mapHeight  = scene.mapHeight;

  // Lazy migration: move legacy IDB video blob to filesystem on first access
  if (scene.mapType === 'video' && scene.mapBlob && !scene.mapPath && window.electronAPI) {
    showMapProgress('Moving the animated map to disk…');
    const ab = await scene.mapBlob.arrayBuffer();
    if (myGen !== switchGeneration) return;
    const mime = scene.mapBlob.type || 'video/webm';
    const ext = mime === 'video/mp4' ? '.mp4' : '.webm';
    await window.electronAPI.saveVideoBlob(scene.id, ab, mime);
    if (myGen !== switchGeneration) return;
    scene.mapPath = 'maps/' + scene.id + ext;
    scene.mapBlob = undefined;
    await sceneStore.saveScene(scene);
    if (myGen !== switchGeneration) return;
    hideMapProgress();
  }

  if (scene.mapType === 'video') {
    if (scene.mapPath && window.electronAPI) {
      const absPath = await window.electronAPI.getVideoFilePath(scene.id);
      if (myGen !== switchGeneration) return;
      if (!absPath) throw new Error('The video file is missing. It may have been moved or deleted.');
      mapVideoUrl = 'file:///' + absPath.replace(/\\/g, '/');
    } else if (scene.mapBlob) {
      mapVideoUrl = URL.createObjectURL(scene.mapBlob);
    } else {
      throw new Error('Video data not found for this scene.');
    }
    const video = document.createElement('video');
    video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'auto';
    video.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;pointer-events:none;';
    document.body.appendChild(video);
    await new Promise((resolve, reject) => {
      let settled = false;
      video.onerror = () => {
        if (settled) return;
        settled = true;
        video.onerror = null; video.oncanplay = null;
        video.pause(); video.src = '';
        if (video.parentNode) video.parentNode.removeChild(video);
        cleanupVideo();
        reject(new Error('Video load failed'));
      };
      video.oncanplay = function() {
        if (settled) return;
        settled = true;
        video.onerror = null; video.oncanplay = null;
        resolve();
      };
      video.src = mapVideoUrl;
    });
    if (myGen !== switchGeneration) {
      video.pause(); video.src = '';
      if (video.parentNode) video.parentNode.removeChild(video);
      return;
    }
    // Seek to near-zero and wait for decoded frame before extracting
    await new Promise(resolve => {
      video.onseeked = function() { video.onseeked = null; resolve(); };
      video.currentTime = 0.001;
      setTimeout(() => { if (video.onseeked) { video.onseeked = null; resolve(); } }, 2000);
    });
    if (myGen !== switchGeneration) {
      video.pause(); video.src = '';
      if (video.parentNode) video.parentNode.removeChild(video);
      return;
    }
    const extractCanvas = document.createElement('canvas');
    extractCanvas.width = mapWidth; extractCanvas.height = mapHeight;
    extractCanvas.getContext('2d').drawImage(video, 0, 0, mapWidth, mapHeight);
    mapOffscreen = extractCanvas;
    bindVideoFrameTexture(extractCanvas, mapWidth, mapHeight);
    mapVideo = video;
    attachVideoListeners(video);
    mapVideoBlob = scene.mapBlob || null;

    // Fog canvases (needs mapWidth/mapHeight, already set above)
    fogDataCanvas = document.createElement('canvas');
    fogDataCanvas.width  = Math.ceil(mapWidth  / FOG_SCALE);
    fogDataCanvas.height = Math.ceil(mapHeight / FOG_SCALE);
    fogDataCtx = fogDataCanvas.getContext('2d');
    baseFogCanvas = document.createElement('canvas');
    baseFogCanvas.width  = fogDataCanvas.width;
    baseFogCanvas.height = fogDataCanvas.height;
    baseFogCtx = baseFogCanvas.getContext('2d');

    await loadFogFromScene(scene);
    if (myGen !== switchGeneration) return;
  } else {
    // Fog canvases created before bitmap await — only needs mapWidth/mapHeight
    fogDataCanvas = document.createElement('canvas');
    fogDataCanvas.width  = Math.ceil(mapWidth  / FOG_SCALE);
    fogDataCanvas.height = Math.ceil(mapHeight / FOG_SCALE);
    fogDataCtx = fogDataCanvas.getContext('2d');
    baseFogCanvas = document.createElement('canvas');
    baseFogCanvas.width  = fogDataCanvas.width;
    baseFogCanvas.height = fogDataCanvas.height;
    baseFogCtx = baseFogCanvas.getContext('2d');

    // Decode map bitmap and fog simultaneously
    const [bitmap] = await Promise.all([
      createImageBitmap(scene.mapBlob),
      loadFogFromScene(scene),
    ]);
    if (myGen !== switchGeneration) { bitmap.close(); return; }

    mapOffscreen = document.createElement('canvas');
    mapOffscreen.width  = mapWidth;
    mapOffscreen.height = mapHeight;
    mapOffscreen.getContext('2d').drawImage(bitmap, 0, 0);
    pixiSetMap(prepareTextureCanvas(mapOffscreen, mapWidth, mapHeight), mapWidth, mapHeight);
    bitmap.close();
    mapBitmap = null;
  }

  // Progressive render (DM only): show map immediately while fog rebuilds below.
  // fogDataCanvas/baseFogCanvas are already filled so the render pipeline is safe.
  if (!isPlayer) {
    fitToScreen();
    minimapSeedView();
    viewportDirty = true; gridDirty = true; fogDirty = true;
    scheduleRender();
    landing.style.display = 'none';
    container.style.cursor = 'crosshair';
  }

  // normalizeRoomFields backfills `name` on scenes saved before rooms had names
  // (roomPanel.js). Both spreads are additive — a field whitelist here would drop cornerRadii.
  polygons      = normalizeRoomFields(scene.polygons || []).map(p => ({ ...p, vertices: p.vertices.map(v => ({ ...v })) }));
  nextPolygonId = scene.nextPolygonId || 1;
  selectedPolygonId   = null;
  selectedVertexIndex = -1;
  activePolygon = null;
  // Same additive spread the rooms above take, for the same reason: a field whitelist here
  // would drop cornerRadii from every saved effect on load. A scene saved before effects
  // existed carries none, which clears the outgoing scene's rather than inheriting them.
  setEffects(scene.effects || []);
  nextEffectId = scene.nextEffectId || 1;
  if (scene.gridConfig) applyGridConfig(scene.gridConfig);

  rebuildFogFromPolygons();
  if (!cloudPattern) generateCloudFrames(512, CLOUD_FRAME_COUNT);
  rebuildFogEffect();
  if (!isPlayer) { pixiInitFog(fogDataCanvas, fogBlurCanvas, cloudBlendCanvas, mapWidth, mapHeight); pixiFlushTexturePool(); }

  if (!isPlayer) restoreSceneFogSettings(scene); // fog.js

  undoStack = []; redoStack = [];
  playerMapSent = false;
  currentScene = scene;
  localStorage.setItem('evermist-current-scene-id', id);
  landing.style.display = 'none';
  if (!isPlayer) container.style.cursor = 'crosshair';
  fitToScreen();
  viewportDirty = true; gridDirty = true; fogDirty = true;
  scheduleRender();
  renderSceneManager();
  // Selection was cleared above, so close the room card rather than leaving it floating
  // over the new scene with the previous scene's room in it.
  if (typeof resetRoomLabelCache === 'function') resetRoomLabelCache();
  if (typeof refreshRoomPanel === 'function') refreshRoomPanel();
  // Draw Rooms belongs to the scene, not the session: it enables only where this
  // particular map came with a floor plan.
  if (typeof refreshFloorPlanUI === 'function') refreshFloorPlanUI();
  if (mapVideo) mapVideo.play().then(() => startVideoLoop()).catch(() => {});
  // HOLD THE PAYLOAD until the Player's fog has finished closing over the outgoing map. The
  // Player rewrites its map size and camera the moment this lands, and doing that under a
  // half-closed cover shows the swap the cover exists to hide. A cached scene loads in well
  // under the close, so without this the race is the common case, not the rare one.
  if (autoSync) {
    const closedIn = _sceneOutPostedAt
      ? Math.max(0, FOG_SCENE_COVER_MS - (Date.now() - _sceneOutPostedAt))
      : 0;
    setTimeout(() => sendToPlayer(false, true), Math.max(150, closedIn));
  }
  onSceneLoaded(); // viewport.js: flush pending player resync if Player asked while loading
  } catch (err) {
    if (myGen !== switchGeneration) return;
    mapOffscreen = null;
    fogDataCanvas = null; fogDataCtx = null;
    baseFogCanvas = null; baseFogCtx = null;
    cleanupVideo();
    onSwitchSceneError(prevId, _isRecovery, err); // scenes.js
  }
}

// ── Delete with undo ──────────────────────────────────────────────────────────
// The card/bulk trash removes scenes from the list immediately but DEFERS the real
// IndexedDB deletion ~4s so Undo can cancel it. A new delete finalises the previous
// one; closing the app finalises via the beforeunload listener in initSceneManagerUI.
function deleteScenesWithUndo(ids) {
  const items = ids
    .map(id => ({ id, index: allScenes.findIndex(s => s.id === id), meta: allScenes.find(s => s.id === id) }))
    .filter(x => x.index !== -1 && x.meta)
    .sort((a, b) => a.index - b.index);
  if (!items.length) return;

  commitPendingDelete(); // finalise anything still pending from a previous delete

  const idset = new Set(items.map(x => x.id));
  allScenes = allScenes.filter(s => !idset.has(s.id));
  smSelectedIds.clear();

  // If the loaded scene was among those deleted, switch away (data stays in IDB
  // until the delete is committed, so Undo can still bring it back).
  if (currentScene && idset.has(currentScene.id)) handleCurrentDeleted();

  smPending = { items, ids: items.map(x => x.id) };
  showUndoToast(items.length === 1 ? `"${items[0].meta.name}" removed` : `${items.length} scenes removed`);
  clearTimeout(smUndoTimer);
  smUndoTimer = setTimeout(commitPendingDelete, 4200);
  renderSceneManager();
}

function handleCurrentDeleted() {
  currentScene = null;
  cleanupVideo();
  if (mapBitmap) { try { mapBitmap.close(); } catch (e) {} }
  mapBitmap = null; mapOffscreen = null; mapWidth = 0; mapHeight = 0;
  polygons = []; nextPolygonId = 1;
  clearEffects(); nextEffectId = 1;
  selectedPolygonId = null; selectedVertexIndex = -1;
  if (typeof resetRoomLabelCache === 'function') resetRoomLabelCache();
  if (typeof refreshRoomPanel === 'function') refreshRoomPanel();
  landing.style.display = '';
  if (!isPlayer) container.style.cursor = 'default';
  localStorage.removeItem('evermist-current-scene-id');
  if (allScenes.length) switchScene(allScenes[0].id).catch(err => console.error('switchScene failed:', err));
}

function undoDelete() {
  if (!smPending) return;
  clearTimeout(smUndoTimer);
  for (const it of smPending.items) {
    allScenes.splice(Math.min(it.index, allScenes.length), 0, it.meta);
  }
  allScenes.forEach((s, i) => { s.sortOrder = i; });
  persistSceneOrder();
  smPending = null;
  hideUndoToast();
  renderSceneManager();
}

function commitPendingDelete() {
  if (!smPending) return;
  const ids = smPending.ids;
  smPending = null;
  clearTimeout(smUndoTimer);
  hideUndoToast();
  for (const id of ids) {
    sceneStore.deleteScene(id).catch(() => {});
    if (window.electronAPI) window.electronAPI.deleteVideoFile(id).catch(() => {});
    if (thumbURLs.has(id)) { URL.revokeObjectURL(thumbURLs.get(id)); thumbURLs.delete(id); }
  }
}

function showUndoToast(msg) {
  const t = document.getElementById('scene-undo-toast');
  if (!t) return;
  t.querySelector('.undo-msg').textContent = msg;
  t.style.display = '';
  const bar = t.querySelector('.undo-bar');
  bar.style.animation = 'none';
  void bar.offsetWidth; // reflow so the 4s timer bar restarts on each delete
  bar.style.animation = 'smUndoTimer 4s linear forwards';
}

function hideUndoToast() {
  const t = document.getElementById('scene-undo-toast');
  if (t) t.style.display = 'none';
}

if (typeof module !== 'undefined') module.exports = { escHtml };
