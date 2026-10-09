'use strict';
// worldBackground.js — the world map's backdrop: one image behind the places, chosen in Settings. The
// picture lives in its own IndexedDB (up to 30MB cannot sit in localStorage); where it sits, its size
// and its opacity live in localStorage. The TV never sees it. A backup of everything carries it.
//
// ⚠ A SEPARATE DATABASE, never the scenes' store: that store lists every record as a scene.

const WB_META_KEY = 'evermist.worldBg';
const WB_DB = 'evermist-world';
const WB_MAX_BYTES = 30 * 1024 * 1024;

let _wbMeta = null;              // { x, y, scale, alpha, w, h, name }: x and y are the image's centre
let _wbUrl = null;
let _wbMoving = false;

function _wbDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(WB_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('bg');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function _wbStore(mode, fn) {
  const db = await _wbDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('bg', mode);
    const req = fn(tx.objectStore('bg'));
    tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

function _wbMetaSave() {
  try { localStorage.setItem(WB_META_KEY, JSON.stringify(_wbMeta)); } catch (_) { /* full or blocked */ }
}

function _wbMetaLoad() {
  try {
    const m = JSON.parse(localStorage.getItem(WB_META_KEY) || 'null');
    const ok = k => m && typeof m[k] === 'number' && isFinite(m[k]);
    return ok('x') && ok('y') && ok('scale') && ok('alpha') && ok('w') && ok('h') && m.w > 0 && m.h > 0 ? m : null;
  } catch (_) { return null; }
}

function _wbApply() {
  const el = document.getElementById('wm-bgimg');
  if (!el) return;
  const have = !!(_wbMeta && _wbUrl);
  el.style.display = have ? '' : 'none';
  if (have) {
    const m = _wbMeta;
    el.style.backgroundImage = 'url("' + _wbUrl + '")';
    el.style.width = m.w + 'px';
    el.style.height = m.h + 'px';
    el.style.transform = 'translate(' + (m.x - m.w * m.scale / 2) + 'px,' + (m.y - m.h * m.scale / 2) + 'px) scale(' + m.scale + ')';
    el.style.opacity = m.alpha;
  }
  worldMapExtentReset();
  worldMistPicture();
  document.getElementById('wm-bg-clear').hidden = !have;
  document.getElementById('wm-bg-controls').hidden = !have;
  const pick = document.getElementById('wm-bg-pick');
  pick.classList.toggle('none', !have);
  pick.querySelector('.nm').textContent = have ? (typeof _wbMeta.name === 'string' && _wbMeta.name ? _wbMeta.name : t('Background image')) : t('Choose image…');
  pick.title = t(have ? 'Replace the image' : 'Choose a picture for behind the places. The TV never shows it.');
  if (have) {
    document.getElementById('wm-bg-scale-num').value = Math.round(_wbMeta.scale * 100);
    document.getElementById('wm-bg-alpha-num').value = Math.round(_wbMeta.alpha * 100);
  }
}

// ─── In a backup ─────────────────────────────────────────────────────────────

// What a backup of everything carries: the numbers and the picture, or null with none.
async function worldBackgroundBackupPayload() {
  if (!_wbMeta || !_wbUrl) return null;
  try {
    const blob = await _wbStore('readonly', s => s.get('image'));
    if (!blob) return null;
    return { meta: JSON.stringify({ ..._wbMeta, type: blob.type || '' }), buffer: await blob.arrayBuffer() };
  } catch (_) { return null; }
}

// A restored backdrop joins only when there is none: the DM's own picture is never replaced.
async function worldBackgroundAdopt(zipPath, shift) {
  let got = null;
  try { got = await window.electronAPI.readBackupWorldBackground(zipPath); } catch (err) {
    console.error('Reading the background from backup failed:', err);
    return;
  }
  if (!got) return;
  if (_wbMeta) {
    messageDialog({ title: 'Background image kept', message: t('This backup carries a world map background, and you already have one, so yours stays.') });
    return;
  }
  let m = null;
  try { m = JSON.parse(got.meta); } catch (_) { m = null; }
  const ok = k => m && typeof m[k] === 'number' && isFinite(m[k]);
  if (!(ok('x') && ok('y') && ok('scale') && ok('alpha') && ok('w') && ok('h') && m.w > 0 && m.h > 0)) return;
  const blob = new Blob([got.buffer], { type: typeof m.type === 'string' ? m.type : '' });
  if (blob.size > WB_MAX_BYTES) return;
  try { await _wbStore('readwrite', s => s.put(blob, 'image')); } catch (_) {
    messageDialog({ title: 'Nothing changed', message: t('The image could not be saved.') });
    return;
  }
  _wbUrl = URL.createObjectURL(blob);
  _wbMeta = {
    x: m.x + (shift ? shift.dx : 0), y: m.y + (shift ? shift.dy : 0), scale: m.scale, alpha: m.alpha, w: m.w, h: m.h,
    name: typeof m.name === 'string' ? m.name.slice(0, 120) : '',
  };
  _wbMetaSave();
  _wbApply();
}

// The picture where it sits, in world units, for the mist's own copy of it.
function worldBackgroundPicture() {
  if (!_wbMeta || !_wbUrl) return null;
  const m = _wbMeta, w = m.w * m.scale, h = m.h * m.scale;
  return { url: _wbUrl, x: m.x - w / 2, y: m.y - h / 2, w, h, alpha: m.alpha };
}

function worldBackgroundMoving() { return _wbMoving && !!_wbMeta; }

function worldBackgroundMoveSet(on) {
  _wbMoving = on && !!_wbMeta;
  const btn = document.getElementById('wm-bg-move');
  btn.classList.toggle('live', _wbMoving);
  btn.setAttribute('aria-pressed', _wbMoving ? 'true' : 'false');
  document.getElementById('wm-bg-move-label').textContent = t(_wbMoving ? 'Done moving' : 'Move on the map');
  document.getElementById('wm-bg-hint').hidden = !_wbMoving;
  if (typeof _wm !== 'undefined' && _wm) _wm.classList.toggle('bgmove', _wbMoving);
}

// The picture as it was when a drag began, moved by a distance in world units.
function worldBackgroundDragTo(from, dx, dy) {
  if (!_wbMeta) return;
  _wbMeta.x = from.x + dx;
  _wbMeta.y = from.y + dy;
  _wbApply();
}

function worldBackgroundDragEnd() { _wbMetaSave(); }
function worldBackgroundMeta() { return _wbMeta ? { x: _wbMeta.x, y: _wbMeta.y } : null; }

function _wbRead(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob), img = new Image();
    img.onload = () => resolve({ url, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
    img.src = url;
  });
}

// A new picture lands over the scenes: centred on them, and sized to cover them with room to spare.
function _wbStart(read, name) {
  const hull = wmHullRect(allScenes.filter(s => wmCleanPos(s.worldPos)).map(s => s.worldPos));
  const cx = hull ? hull.x + hull.w / 2 : 0, cy = hull ? hull.y + hull.h / 2 : 0;
  const need = hull ? Math.max((hull.w + 800) / read.w, (hull.h + 600) / read.h) : 1;
  return { x: Math.round(cx), y: Math.round(cy), scale: Math.max(0.05, Math.min(4, need)), alpha: 0.6, w: read.w, h: read.h, name };
}

async function _wbChoose(file) {
  if (!file) return;
  if (file.size > WB_MAX_BYTES) {
    messageDialog({ title: 'Image too large', message: t('The background can be up to 30 MB.') });
    return;
  }
  let read;
  try { read = await _wbRead(file); } catch (_) {
    messageDialog({ title: 'Nothing changed', message: t('That file could not be read as an image.') });
    return;
  }
  try { await _wbStore('readwrite', s => s.put(file, 'image')); } catch (_) {
    URL.revokeObjectURL(read.url);
    messageDialog({ title: 'Nothing changed', message: t('The image could not be saved.') });
    return;
  }
  if (_wbUrl) URL.revokeObjectURL(_wbUrl);
  _wbUrl = read.url;
  _wbMeta = _wbStart(read, file.name);
  _wbMetaSave();
  _wbApply();
}

async function _wbClear() {
  worldBackgroundMoveSet(false);
  if (_wbUrl) URL.revokeObjectURL(_wbUrl);
  _wbUrl = null;
  _wbMeta = null;
  try { localStorage.removeItem(WB_META_KEY); } catch (_) { /* blocked */ }
  try { await _wbStore('readwrite', s => s.delete('image')); } catch (_) { /* nothing was kept */ }
  _wbApply();
}

// A typed or scrubbed number, clamped to its range.
function _wbBind(numId, key, min, max, toValue) {
  const num = document.getElementById(numId);
  num.addEventListener('change', () => {
    if (!_wbMeta) return;
    _wbMeta[key] = toValue(Math.max(min, Math.min(max, parseInt(num.value, 10) || min)));
    _wbMetaSave();
    _wbApply();
  });
  num.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') num.blur(); });
}

async function worldBackgroundInit() {
  const file = document.getElementById('wm-bg-file');
  document.getElementById('wm-bg-pick').addEventListener('click', () => file.click());
  file.addEventListener('change', () => { const f = file.files && file.files[0]; file.value = ''; _wbChoose(f); });
  document.getElementById('wm-bg-clear').addEventListener('click', () => confirmDialog({
    title: 'Remove the background image?',
    message: t('The picture is deleted from Evermist and cannot be brought back. Your places, scenes and roads stay as they are.'),
    confirmLabel: 'Remove', danger: true, onConfirm: _wbClear,
  }));
  document.getElementById('wm-bg-move').addEventListener('click', () => {
    if (!_wbMeta) return;
    if (!_wbMoving && !worldMapOpen) worldMapShow();    worldBackgroundMoveSet(!_wbMoving);
  });
  _wbBind('wm-bg-scale-num', 'scale', 5, 400, v => v / 100);
  _wbBind('wm-bg-alpha-num', 'alpha', 5, 100, v => v / 100);
  _wbMeta = _wbMetaLoad();
  _wbApply();
  if (!_wbMeta) return;
  try {
    const blob = await _wbStore('readonly', s => s.get('image'));
    if (!blob) { _wbMeta = null; _wbApply(); return; }
    _wbUrl = URL.createObjectURL(blob);
    _wbApply();
  } catch (_) { _wbMeta = null; _wbApply(); }
}
