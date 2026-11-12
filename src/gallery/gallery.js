'use strict';
// gallery.js — the Gallery pane: every picture the DM keeps, tied to no scene or room, and the one
// on the TV. Pictures decode through pictureDecode.js and live in galleryStore.js. Their order and groups are
// evermist.picturesLayout (libraryPlan.js), a `local:` sync record; the shared list parts are libraryList.js's.

let _gaPics = [];          // { id, name, blob, added }, newest first
let _gaLive = null;        // the id on the TV, or null
let _gaPaneLive = false;   // a column's copy: whether the DM window holds one on the TV
let _gaQuery = '';
let _gaPicked = null;       // the picture the search picked: marked, never shown on the TV
const _gaUrls = {};
const _gaTiles = {};
const GA_SHUT_KEY = 'evermist.picturesShut';
let _gaL = null;            // evermist.picturesLayout, null until the pictures were first read
let _gaShut = {};           // group key, '' for Ungrouped → folded shut, on this computer only

function _gaUrl(p) {
  if (!_gaUrls[p.id]) _gaUrls[p.id] = URL.createObjectURL(p.blob);
  return _gaUrls[p.id];
}

function _gaNewId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ─── The TV ──────────────────────────────────────────────────────────────────

// ⚠ In two-map mode the DM window has no Player of its own: the picture goes to the shell, which
// covers both halves.
function _gaSend(blob) {
  const msg = { type: 'tv-picture', blob };
  if (panesActive) { if (stageIsOpen()) _stageWindow.postMessage(msg, '*'); }
  else if (playerWindow && !playerWindow.closed) playerWindow.postMessage(msg, '*');
}

// Columns hold no gallery, but Escape typed inside one has to know whether a picture is up.
function _gaTellPanes(id) {
  const msg = { type: 'pane-gallery-live', on: _gaLive != null };
  if (id) sendToPane(msg, id); else broadcastToPanes(msg);
}

function galleryPaneLive(on) { _gaPaneLive = !!on; }

function galleryTellPane(id) { if (_gaLive != null) _gaTellPanes(id); }

function _gaSetLive(id) {
  _gaLive = id;
  _gaTellPanes();
  _gaRender();
}

function _gaShow(p) {
  searchRecentAdd('picture:' + p.id);
  _gaSend(p.blob);
  _gaSetLive(p.id);
}

// A Player that opened or reconnected holds nothing yet.
function galleryResend() {
  const p = _gaLive != null && _gaPics.find(x => x.id === _gaLive);
  if (p) _gaSend(p.blob);
}

// Escape's first stop. True when it took the picture down, or a column asked the DM window to.
function galleryTakeDown() {
  if (isPane) {
    if (!_gaPaneLive || parent === window) return false;
    parent.postMessage({ type: 'pane-gallery-down', pane: paneId }, '*');
    return true;
  }
  if (_gaLive == null) return false;
  _gaSend(null);
  _gaSetLive(null);
  return true;
}

// ─── Adding, renaming, removing ──────────────────────────────────────────────

// A file kept as a picture, or null when it will not read as one. The caller redraws the grid.
// The pictures deleted here and when (editStamps.js), so a backup deletes them on the other laptop too. An older
// build never reads this key.
const GA_GONE_KEY = 'evermist.gonePictures';

function _gaGoneRead() {
  try { return esGoneClean(JSON.parse(localStorage.getItem(GA_GONE_KEY) || 'null')); } catch (_) { return esGoneClean(null); }
}

function _gaGoneWrite(gone) {
  try {
    if (Object.keys(gone).length) localStorage.setItem(GA_GONE_KEY, JSON.stringify(gone)); else localStorage.removeItem(GA_GONE_KEY);
  } catch (_) { /* the picture is gone either way; only its record is not kept */ }
  syncNoteLocal(GA_GONE_KEY);
}

function galleryGone() { return _gaGoneRead(); }

async function _gaAddOne(f) {
  const blob = await decodePicture(f);
  if (!blob) return null;
  const p = { id: _gaNewId(), name: galleryNameFromFile(f.name) || t('Picture'), blob, added: Date.now() };
  await galleryStore.put(p);
  _gaPics.unshift(p);
  return p;
}

async function _gaAdd(files) {
  const failed = [];
  for (const f of files) if (!await _gaAddOne(f)) failed.push(f.name);
  _gaRender();
  if (failed.length) messageDialog({
    title: t.plural(failed.length, 'One picture was not added', '{n} pictures were not added'),
    message: t('Evermist could not read these as pictures:') + '\n\n' + failed.join('\n'),
  });
}

function _gaRename(p, name) {
  name = name.trim();
  if (!name || name === p.name) return;
  p.name = name;
  p.named = Date.now();   // an import takes the name edited later
  galleryStore.put(p);
}

// No question: the whole picture goes to the Trash first, then leaves Pictures, and keeps its place for a restore. A
// picture on the TV comes down.
async function _gaRemove(p) {
  if (_gaLive === p.id) galleryTakeDown();
  const id = await sceneTrash.putPicture(p, Date.now());
  await galleryDrop(p.id);
  await showTrackUndo(id, 'picture', p.name);
}

// What Claude's picture tools (src/mcp/mcpGallery.js) use. None of them touches the TV: a picture on the TV is
// never removed from here.
function galleryList() { return _gaPics.map(p => ({ id: p.id, name: p.name, added: p.added, type: p.blob.type, size: p.blob.size })); }
function galleryOnTv(id) { return _gaLive === id; }

// The search's pick: the filter cleared, the picture marked and scrolled to.
function galleryPickPicture(id) {
  _gaPicked = id;
  _gaQuery = '';
  const f = document.getElementById('ga-filter');
  if (f) f.value = '';
  _gaRender();
  const tile = _gaTiles[id];
  if (tile) tile.scrollIntoView({ block: 'center' });
}

async function galleryAddFile(f) {
  const p = await _gaAddOne(f);
  if (p) _gaRender();
  return p;
}

function galleryRenameTo(id, name) {
  const p = _gaPics.find(x => x.id === id);
  if (!p) return;
  p.name = name;
  p.named = Date.now();
  galleryStore.put(p);
  _gaRender();
}

// A picture taken out, and the whole entry back for an undo.
async function galleryDrop(id) {
  const p = _gaPics.find(x => x.id === id);
  if (!p) return null;
  await galleryStore.remove(id);
  _gaGoneWrite(esGoneNote(_gaGoneRead(), [id], [], Date.now()));
  _gaPics = _gaPics.filter(x => x !== p);
  if (_gaUrls[id]) { URL.revokeObjectURL(_gaUrls[id]); delete _gaUrls[id]; }
  delete _gaTiles[id];
  _gaRender();
  return p;
}

// A restored picture is an edit now, so a deletion made earlier does not take it out again.
async function galleryRestore(p) {
  p.named = Date.now();
  _gaGoneWrite(esGoneNote(_gaGoneRead(), [], [p.id], Date.now()));
  await galleryStore.put(p);
  _gaPics = [..._gaPics.filter(x => x.id !== p.id), p].sort((a, b) => b.added - a.added);
  _gaRender();
}

// Pictures that arrived from outside the pane: the migration, a restored backup.
async function galleryReload() {
  try { _gaPics = (await galleryStore.all()).sort((a, b) => b.added - a.added); }
  catch (_) { _gaPics = []; }
  // The upgrade: newest first, as the gallery always listed them, until the DM changes it.
  if (!_gaL) _gaL = libParse(localStorage.getItem(LIB_PICTURES_KEY), cleanPicturesLayout);
  if (!_gaL) { _gaL = picturesSeed(_gaPics); _gaSave(); }
  for (const id of Object.keys(_gaTiles)) delete _gaTiles[id];   // ⚠ a kept tile's clicks hold the old object
  _gaRender();
}

// ─── Backup ──────────────────────────────────────────────────────────────────

// What a backup of everything carries: the list, and each picture's bytes under its zip name.
async function galleryBackupPayload() {
  const pics = await galleryStore.all();
  const meta = galleryBackupMeta(pics);
  const files = [];
  for (const m of meta) {
    const p = pics.find(x => x.id === m.id);
    files.push({ name: pictureZipName(m.id, m.type), buffer: await p.blob.arrayBuffer() });
  }
  return meta.length ? { meta: JSON.stringify(meta), files } : null;
}

// Adds the backup's pictures the gallery does not hold, and takes a name renamed later in the file. `goneFile` is the
// file's deletion records: a picture deleted there after its last edit here goes, and one deleted here after the
// file's last edit stays out. A backup with no gallery can still delete.
async function galleryAdoptBackup(zipPath, goneFile) {
  const got = await window.electronAPI.readBackupGallery(zipPath);
  const meta = got ? galleryParseMeta(got.meta) : [], now = Date.now();
  const have = await galleryStore.all();
  const plan = galleryGoneApply(have, meta, _gaGoneRead(), goneFile, now);
  const list = [];
  for (const m of meta) {
    const buf = got.files[pictureZipName(m.id, m.type)];
    if (buf && !plan.skip.includes(m.id)) list.push({ id: m.id, name: m.name, added: m.added || now, named: m.named, blob: new Blob([buf], { type: m.type }) });
  }
  const added = await galleryStore.addMissing(list);
  const renamed = galleryRenames(have, meta, now).filter(r => !plan.remove.includes(r.id));
  for (const r of renamed) await galleryStore.put(Object.assign(have.find(p => p.id === r.id), { name: r.name, named: r.named }));
  await _gaDropGone(plan);
  if (added.length || renamed.length || plan.remove.length) await galleryReload();
  return added.length;
}

// A picture deleted elsewhere moves into this computer's Trash, its time the deletion's.
async function _gaDropGone(plan) {
  const have = plan.remove.length ? await galleryStore.all() : [];
  for (const id of plan.remove) {
    if (_gaLive === id) galleryTakeDown();
    const rec = have.find(p => p.id === id);
    if (rec) await sceneTrash.putPicture(rec, (plan.gone && plan.gone[id]) || Date.now());
    await galleryStore.remove(id);
    if (_gaUrls[id]) { URL.revokeObjectURL(_gaUrls[id]); delete _gaUrls[id]; }
  }
  _gaGoneWrite(plan.gone);
}

// Another computer's deletion records, which sync carries apart from the pictures: the same rule as a backup's.
async function galleryAdoptGone(goneFile) {
  const plan = galleryGoneApply(await galleryStore.all(), [], _gaGoneRead(), goneFile, Date.now());
  if (!plan.remove.length && esCanon(plan.gone) === esCanon(_gaGoneRead())) return 0;
  await _gaDropGone(plan);
  if (plan.remove.length) await galleryReload();
  return plan.remove.length;
}

// A restored scene's room pictures join the gallery too: an older backup holds no other copy.
async function galleryAdoptScenes(scenes) {
  // A picture deleted from Pictures stays out, though a room still holds its bytes.
  const gone = _gaGoneRead();
  const added = await galleryStore.addMissing(galleryFromScenes(scenes).filter(p => !(p.id in gone)));
  if (added.length) await galleryReload();
}

// ─── The grid ────────────────────────────────────────────────────────────────

function _gaEditName(p, label) {
  const input = document.createElement('input');
  input.className = 'ga-name-edit';
  input.value = p.name;
  input.style.minWidth = label.offsetWidth + 'px';
  label.replaceWith(input);
  delete _gaTiles[p.id];
  input.focus(); input.select();
  let done = false;
  const finish = keep => {
    if (done) return;
    done = true;
    if (keep) _gaRename(p, input.value);
    input.remove();
    _gaRender();
  };
  input.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  };
  input.onblur = () => finish(true);
  input.onmousedown = input.onclick = e => e.stopPropagation();
}

function _gaRender() {
  const grid = document.getElementById('ga-grid');
  if (!grid || libHold(grid)) return;
  grid.textContent = '';
  document.getElementById('ga-top').style.display = _gaPics.length ? '' : 'none';
  if (!_gaPics.length) {
    grid.className = 'ga-list ga-empty';
    grid.innerHTML = `<div class="ga-well">${uiIcon('plus', 18)}<b></b><span></span></div>`;
    grid.querySelector('b').textContent = t('Drop pictures here');
    grid.querySelector('span').textContent = t('Portraits, monsters, letters. A click shows one on the TV.');
    grid.querySelector('.ga-well').onclick = () => document.getElementById('ga-input').click();
    return;
  }
  grid.className = 'ga-list mu-list';
  const words = _gaQuery.toLowerCase().split(/\s+/).filter(Boolean);
  const byId = new Map(_gaPics.map(p => [p.id, p]));
  const match = id => words.every(w => byId.get(id).name.toLowerCase().includes(w));
  const sections = libSections(_gaLib(), _gaPics.map(p => p.id));
  let any = false;
  for (const sec of sections) {
    const items = sec.items.filter(match);
    if (words.length && !items.length) continue;
    any = any || items.length > 0;
    const tiles = document.createElement('div');
    tiles.className = 'ga-grid';
    tiles.append(...items.map(id => {
      const p = byId.get(id), tile = _gaTile(p);
      tile.classList.toggle('on', p.id === _gaLive);
      tile.classList.toggle('picked', p.id === _gaPicked);
      tile.querySelector('.ga-name').textContent = p.name;
      return tile;
    }));
    if (sections.length === 1) { grid.appendChild(tiles); continue; }
    const el = libSection(sec.key, sec.key ? sec.name : t('Ungrouped'), items.length, !words.length && !!_gaShut[sec.key || '']);
    if (!items.length) el.classList.add('lib-empty');
    el.querySelector('.lib-body').appendChild(tiles);
    grid.appendChild(el);
  }
  if (!any) {
    const none = document.createElement('div');
    none.className = 'ga-none';
    none.textContent = t('No picture has that name.');
    grid.replaceChildren(none);
  }
}

// Built once per picture and reused: a rebuilt <img> paints blank for a frame on every keystroke.
function _gaTile(p) {
  if (_gaTiles[p.id]) return _gaTiles[p.id];
  const tile = document.createElement('div');
  tile.className = 'ga-tile';
  const th = document.createElement('div');
  th.className = 'ga-th';
  const img = document.createElement('img');
  img.src = _gaUrl(p);
  img.draggable = false;
  const name = document.createElement('div');
  name.className = 'ga-name lib-name';
  name.title = t('Double-click to rename');
  th.append(img, libMoreBtn(), name);
  tile.append(th);
  tile.dataset.libKey = p.id;
  th.onclick = e => {
    if (e.target.closest('.lib-more, input')) return;
    if (p.id === _gaLive) galleryTakeDown(); else _gaShow(p);
  };
  name.onclick = e => e.stopPropagation();
  name.ondblclick = () => _gaEditName(p, name);
  return (_gaTiles[p.id] = tile);
}

async function initGallery() {
  const pane = document.getElementById('dock-pane-gallery');
  const input = document.getElementById('ga-input');
  const filter = document.getElementById('ga-filter');
  document.getElementById('btn-ga-add').onclick = () => input.click();
  input.onchange = () => {
    const files = Array.from(input.files || []);
    input.value = '';
    if (files.length) _gaAdd(files);
  };
  try { _gaShut = JSON.parse(localStorage.getItem(GA_SHUT_KEY) || '{}') || {}; } catch (_) { _gaShut = {}; }
  _gaListInit();
  filter.oninput = () => { _gaQuery = filter.value; _gaPicked = null; _gaRender(); };
  filter.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Escape') { filter.value = ''; _gaQuery = ''; _gaRender(); filter.blur(); }
  };
  document.addEventListener('dockpane', e => { if (e.detail === 'gallery' && _gaPics.length) filter.focus(); });

  // ⚠ STOPPED HERE, so a picture dropped on the pane is never imported as a map.
  const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.items || []).some(i => i.kind === 'file');
  let depth = 0;
  pane.addEventListener('dragenter', e => { if (hasFiles(e)) { depth++; pane.classList.add('ga-dragging'); } });
  pane.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; pane.classList.remove('ga-dragging'); } });
  pane.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); } });
  pane.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); e.stopPropagation();
    depth = 0; pane.classList.remove('ga-dragging');
    const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length) _gaAdd(files);
  });

  await galleryReload();
}

// ─── Order and groups ────────────────────────────────────────────────────────

// `edited`: the DM changed it now; otherwise the time stays what it was.
function _gaSave(edited) {
  if (edited) _gaL.at = Date.now();
  try { localStorage.setItem(LIB_PICTURES_KEY, JSON.stringify(_gaL)); } catch (_) {}
  syncNoteLocal(LIB_PICTURES_KEY);
}

const _gaLib = () => libNormalize(_gaL || libEmpty(), _gaPics.map(p => p.id));

function _gaCommit(L) {
  if (!_gaL) _gaL = picturesSeed(_gaPics);
  Object.assign(_gaL, { order: L.order, groups: L.groups, groupOrder: L.groupOrder });
  _gaSave(true);
  _gaRender();
}

function picturesLayoutAdopt(theirs) {
  _gaL = theirs;
  _gaSave();
  _gaRender();
}

const _gaGroupName = gk => (_gaL && _gaL.groups[gk] ? _gaL.groups[gk].name : gk);

function _gaRenameGroup(gk) {
  libEditGroup(document.getElementById('ga-grid'), gk, _gaGroupName(gk), typed => {
    const next = sanitizeGroupName(typed);
    if (!next) return;
    const L = _gaLib(), clash = libGroupNamed(L, next, _gaGroupName, gk);
    if (!clash) { _gaCommit(libRenameGroup(L, gk, next)); return; }
    libAskMerge(_gaGroupName(clash), _gaGroupName(gk), () => _gaCommit(libMergeGroups(_gaLib(), gk, clash)));
  });
}

function _gaHold(drag, target) {
  const L = _gaLib(), gk = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const r = libHoldGroup(L, drag, target, gk, uniqueGroupName(t('New group'), L.groupOrder.map(_gaGroupName)));
  _gaCommit(r.L);
  if (r.made) _gaRenameGroup(r.group);
}

function _gaListInit() {
  const root = document.getElementById('ga-grid');
  libraryList(root, {
    grid: true,
    redraw: _gaRender,
    scroller: root.closest('.dk-scroll'),
    filtering: () => !!_gaQuery.trim(),
    groups: () => libSections(_gaLib(), _gaPics.map(p => p.id)).filter(s => s.key).map(s => ({ key: s.key, name: s.name })),
    rename: id => { const tile = _gaTiles[id], p = _gaPics.find(x => x.id === id); if (tile && p) _gaEditName(p, tile.querySelector('.ga-name')); },
    del: id => { const p = _gaPics.find(x => x.id === id); if (p) _gaRemove(p); },
    moveTo: (id, g) => _gaCommit(libMove(_gaLib(), [id], g, null)),
    move: (id, g, before) => _gaCommit(libMove(_gaLib(), [id], g, before)),
    hold: _gaHold,
    groupRename: _gaRenameGroup,
    ungroup: g => _gaCommit(libUngroup(_gaLib(), g)),
    fold: g => {
      const k = g || '';
      if (_gaShut[k]) delete _gaShut[k]; else _gaShut[k] = true;
      try { localStorage.setItem(GA_SHUT_KEY, JSON.stringify(_gaShut)); } catch (_) {}
      _gaRender();
    },
  });
}

// What Claude's picture tools (mcpGallery.js) read and change of the order and groups.
function galleryLayoutNow() { return _gaLib(); }
function galleryCommit(L) { _gaCommit(L); }
function galleryGroupName(gk) { return _gaGroupName(gk); }
function galleryNewGroupKey() { return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
