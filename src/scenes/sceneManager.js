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

  // "+" merges New Scene and Import: media makes scenes, a lone .zip restores a backup.
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

  document.getElementById('btn-two-maps').onclick = toggleTwoMaps;

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

  document.querySelector('#scene-undo-toast .undo-btn').onclick = undoDelete;

  // The compress-on-import setting. mapConvert.js owns it; this flips it and paints the result.
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
  // ⚠ CONTAINMENT, NOT stopPropagation: capture runs top-down, before the menu's own handler.
  document.addEventListener('mousedown', e => {
    if (!smGroupMenuEl) return;
    if (smGroupMenuEl.contains(e.target)) return;
    if (e.target.closest && e.target.closest('#sm-sel-group')) return; // that button toggles it
    smCloseGroupMenu();
  }, true);

  // Escape drops a selection first and closes the library second, never both in one press.
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
  if (!el) return;
  if (panesActive) {
    // Reading order matches the columns. A column with no map yet says so, or the name reads
    // as one map while two columns are on screen.
    el.textContent = PANE_IDS
      .map(id => panes[id].sceneId
        ? ((allScenes.find(x => x.id === panes[id].sceneId) || {}).name || '?')
        : 'Pick a map')
      .join('  ·  ');
    return;
  }
  el.textContent = currentScene ? currentScene.name : (allScenes.length ? 'Select a scene' : 'No scenes');
}

// What the search shows. Bulk actions act on these, so "Select all" under a filter means it.
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

  // ⚠ ANCHOR THE RIGHT EDGE, NOT THE LEFT: #sm-panel is overflow: hidden, so a left-anchored menu
  // wider than the button is clipped.
  //
  // The panel carries the zoom, so the reported rect is screen px while the offset written back is
  // pre-zoom px. Divide by the ratio the anchor itself proves, never by --ui-zoom.
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

// Writes a group onto scenes, in memory as well as the store — doAutoSave writes wholesale.
function smAssignGroup(ids, group) {
  const g = sanitizeGroupName(group);
  for (const id of ids) {
    const s = allScenes.find(x => x.id === id);
    if (!s || sanitizeGroupName(s.group) === g) continue;
    s.group = g;
    if (currentScene && currentScene.id === id) currentScene.group = g;
    sceneStore.updateScene(id, sc => { sc.group = g; }).catch(console.error);
  }
  // ⚠ THE SELECTION IS NOT THIS FUNCTION'S TO CLEAR: a group rename comes through here too, and
  // clearing throws away ticks the DM is still gathering. The bulk menu clears its own.
  renderSceneManager();
}

// ⚠ THE SECOND COLUMN OPENS EMPTY and waits to be picked - see docs/ARCHITECTURE.md.
async function toggleTwoMaps() {
  if (panesActive) { await exitPanes(panes[panesSelected].sceneId); refreshTwoMapsButton(); return; }
  const openId = currentScene ? currentScene.id : null;
  if (!openId) {
    messageDialog({
      title: 'Open a map first',
      message: 'Two maps starts from the one you are on. Open a map, then press it again.',
    });
    return;
  }
  closeDropdown();
  await enterPanes(openId, null);
  refreshTwoMapsButton();
  openDropdown();   // the next thing to do is pick the second map, so the library is already up
}

function refreshTwoMapsButton() {
  const btn = document.getElementById('btn-two-maps');
  if (!btn) return;
  btn.classList.toggle('active', panesActive);
  btn.title = panesActive ? 'Back to one map' : 'Show a second map beside this one';
}

function renderSceneManager() {
  updateTriggerName();
  refreshTwoMapsButton();

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

  // Searching flattens the library: a group must never hide a map from a search.
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


async function initScenes() {
  try { await sceneStore.initSceneDB(); }
  catch (err) {
    // ⚠ REPORTED, NEVER JUST LOGGED. Every save and every import fails from here on, and a DM
    // who is told nothing finds out when a session's reveals are gone.
    messageDialog({
      title: 'Evermist cannot reach its map library',
      message: 'The scene database would not open, so maps cannot be saved or loaded this ' +
               'session. Restarting the app usually clears it. (' + ((err && err.message) || err) + ')',
    });
    return;
  }
  allScenes = await sceneStore.listScenes();
  allScenes.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  renderSceneManager();
  const lastId = isPane
    ? new URLSearchParams(window.location.search).get('scene')
    : localStorage.getItem('evermist-current-scene-id');
  if (lastId && allScenes.find(s => s.id === lastId)) await switchScene(lastId);
}



if (typeof module !== 'undefined') module.exports = { escHtml };
