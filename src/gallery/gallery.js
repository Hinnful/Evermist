'use strict';
// gallery.js — the Gallery pane: every picture the DM keeps, tied to no scene or room, and the one
// on the TV. Pictures decode through pictureDecode.js and live in galleryStore.js.

let _gaPics = [];          // { id, name, blob, added }, newest first
let _gaLive = null;        // the id on the TV, or null
let _gaPaneLive = false;   // a column's copy: whether the DM window holds one on the TV
let _gaQuery = '';
const _gaUrls = {};
const _gaTiles = {};

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

async function _gaAdd(files) {
  const failed = [];
  for (const f of files) {
    const blob = await decodePicture(f);
    if (!blob) { failed.push(f.name); continue; }
    const p = { id: _gaNewId(), name: galleryNameFromFile(f.name) || t('Picture'), blob, added: Date.now() };
    await galleryStore.put(p);
    _gaPics.unshift(p);
  }
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
  galleryStore.put(p);
}

function _gaRemove(p) {
  confirmDialog({
    title: t('Remove this picture?'),
    message: t('“{name}” leaves the gallery for good.', { name: p.name }),
    confirmLabel: t('Remove'),
    danger: true,
    onConfirm: async () => {
      if (_gaLive === p.id) galleryTakeDown();
      await galleryStore.remove(p.id);
      _gaPics = _gaPics.filter(x => x !== p);
      if (_gaUrls[p.id]) { URL.revokeObjectURL(_gaUrls[p.id]); delete _gaUrls[p.id]; }
      delete _gaTiles[p.id];
      _gaRender();
    },
  });
}

// Pictures that arrived from outside the pane: the migration, a restored backup.
async function galleryReload() {
  try { _gaPics = (await galleryStore.all()).sort((a, b) => b.added - a.added); }
  catch (_) { _gaPics = []; }
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

// Adds the backup's pictures the gallery does not hold. Never removes or replaces one.
async function galleryAdoptBackup(zipPath) {
  const got = await window.electronAPI.readBackupGallery(zipPath);
  if (!got) return 0;
  const list = [];
  for (const m of galleryParseMeta(got.meta)) {
    const buf = got.files[pictureZipName(m.id, m.type)];
    if (buf) list.push({ id: m.id, name: m.name, added: m.added || Date.now(), blob: new Blob([buf], { type: m.type }) });
  }
  const added = await galleryStore.addMissing(list);
  if (added.length) await galleryReload();
  return added.length;
}

// A restored scene's room pictures join the gallery too: an older backup holds no other copy.
async function galleryAdoptScenes(scenes) {
  const added = await galleryStore.addMissing(galleryFromScenes(scenes));
  if (added.length) await galleryReload();
}

// ─── The grid ────────────────────────────────────────────────────────────────

function _gaEditName(p, label) {
  const input = document.createElement('input');
  input.className = 'ga-name-edit';
  input.value = p.name;
  label.replaceWith(input);
  delete _gaTiles[p.id];
  input.focus(); input.select();
  let done = false;
  const finish = keep => {
    if (done) return;
    done = true;
    if (keep) _gaRename(p, input.value);
    _gaRender();
  };
  input.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  };
  input.onblur = () => finish(true);
}

function _gaRender() {
  const grid = document.getElementById('ga-grid');
  if (!grid) return;
  grid.textContent = '';
  document.getElementById('ga-top').style.display = _gaPics.length ? '' : 'none';
  if (!_gaPics.length) {
    grid.className = 'ga-grid ga-empty';
    grid.innerHTML = `<div class="ga-well">${uiIcon('plus', 18)}<b></b><span></span></div>`;
    grid.querySelector('b').textContent = t('Drop pictures here');
    grid.querySelector('span').textContent = t('Portraits, monsters, letters. A click shows one on the TV.');
    grid.querySelector('.ga-well').onclick = () => document.getElementById('ga-input').click();
    return;
  }
  grid.className = 'ga-grid';
  const words = _gaQuery.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = _gaPics.filter(p => words.every(w => p.name.toLowerCase().includes(w)));
  if (!shown.length) {
    const none = document.createElement('div');
    none.className = 'ga-none';
    none.textContent = t('No picture has that name.');
    grid.appendChild(none);
    return;
  }
  grid.replaceChildren(...shown.map(p => {
    const tile = _gaTile(p);
    tile.classList.toggle('on', p.id === _gaLive);
    tile.querySelector('.ga-name').textContent = p.name;
    return tile;
  }));
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
  const x = document.createElement('button');
  x.className = 'ga-x';
  x.title = t('Remove picture');
  x.innerHTML = uiIcon('trash', 12);
  th.append(img, x);
  const name = document.createElement('div');
  name.className = 'ga-name';
  name.title = t('Double-click to rename');
  tile.append(th, name);
  th.onclick = e => {
    if (e.target.closest('.ga-x')) return;
    if (p.id === _gaLive) galleryTakeDown(); else _gaShow(p);
  };
  x.onclick = e => { e.stopPropagation(); _gaRemove(p); };
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
  filter.oninput = () => { _gaQuery = filter.value; _gaRender(); };
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
