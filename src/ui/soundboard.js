'use strict';

// soundboard.js — the dock's Sounds pane: one-shot sounds over the music, as tiles. DM only. The DM's own files sit in
// "My sounds" above the built-in groups, each renamed by its name and sent to the Trash by its ×; they live in
// `userData/sounds` (electron/sounds.js) and sync like the music folder.

const SB_VOL_KEY = 'evermist.sounds.volume';
const SB_STOP_S = 0.12;

let _sbCtx = null;
let _sbMaster = null;
let _sbVolume = 0.5;
const _sbBuffers = {};
const _sbPlaying = {};     // file → [{ src, gain, start, dur }], oldest first
let _sbRaf = 0;
let _sbOwn = [];           // the DM's own sounds: file names straight off the folder
const SB_OWN = 'my/';      // an own sound's key, so it never meets a built-in file of the same name

function _sbEl(id) { return document.getElementById(id); }

function initSoundboard() {
  if (!_sbEl('dock-pane-sounds')) return;

  const saved = parseFloat(localStorage.getItem(SB_VOL_KEY));
  if (isFinite(saved) && saved >= 0 && saved <= 1) _sbVolume = saved;
  const vol = _sbEl('sb-vol');
  vol.value = String(Math.round(_sbVolume * 100));
  _sbSyncSlider();
  vol.addEventListener('input', () => { _sbSetVolume(Number(vol.value) / 100); _sbSyncSlider(); });

  _sbEl('btn-sb-add').addEventListener('click', _sbPickFiles);
  _sbRender();
  soundboardRefreshOwn();
  // Decoded when the pane opens, so the first press of each sound plays at once. The folder is read again too, so a
  // sound another computer sent shows.
  document.addEventListener('dockpane', e => {
    if (e.detail !== 'sounds') return;
    _sbEnsureCtx();
    for (const g of SOUND_GROUPS) for (const s of g.sounds) _sbBuffer(s.file).catch(() => {});
    soundboardRefreshOwn();
  });
}

// The folder is the list, so this read is the only source of truth.
async function soundboardRefreshOwn() {
  try { _sbOwn = (await window.electronAPI.listOwnSounds()) || []; } catch (_) { _sbOwn = []; }
  _sbRender();
  syncNoteSounds();
}

// The picker is native, so the copy is its own function, handed paths.
async function _sbPickFiles() {
  let paths;
  try { paths = await window.electronAPI.pickMusicFiles(); } catch (err) {
    messageDialog({ title: 'Sounds could not be added', message: (err && err.message) || String(err) });
    return;
  }
  if (paths && paths.length) await _sbAddFiles(paths);
}

async function _sbAddFiles(paths) {
  let res;
  try { res = await window.electronAPI.copyOwnSounds(paths); } catch (err) {
    messageDialog({ title: 'Sounds could not be added', message: (err && err.message) || String(err) });
    return null;
  }
  await soundboardRefreshOwn();
  const big = res.failed.filter(f => f.tooBig), bad = res.failed.filter(f => !f.tooBig);
  if (big.length) {
    messageDialog({
      title: 'That sound is too long',
      message: big.map(f => f.name).join('\n') + '\n\n' + t('A sound can be up to 10 MB. Add long tracks in the Music pane.'),
    });
  } else if (bad.length) {
    messageDialog({ title: 'Sounds could not be added', message: bad.map(f => f.name + ': ' + f.message).join('\n') });
  }
  return res;
}

function _sbSyncSlider() {
  const range = _sbEl('sb-vol');
  const wrap = range.closest('.cp-slider');
  const pct = Math.min(100, Math.max(0, Number(range.value) || 0));
  wrap.querySelector('.cp-slider-fill').style.width = pct + '%';
  wrap.querySelector('.cp-slider-knob').style.left = pct + '%';
  _sbEl('sb-vol-pct').textContent = String(Math.round(pct));
}

function _sbSetVolume(v) {
  _sbVolume = Math.min(1, Math.max(0, v));
  localStorage.setItem(SB_VOL_KEY, String(_sbVolume));
  if (_sbMaster) _sbMaster.gain.value = _sbVolume;
}

// Each group's sub-header, then its sounds as tiles two to a row: "My sounds" first, and only while it holds one.
function _sbRender() {
  const groups = _sbEl('sb-cols');
  groups.innerHTML = '';
  const group = (name, rows) => {
    const box = document.createElement('div');
    box.className = 'dk-sbg';
    const cap = document.createElement('div');
    cap.className = 'dk-sub';
    cap.textContent = name;
    const tiles = document.createElement('div');
    tiles.className = 'dk-tiles';
    tiles.append(...rows);
    box.append(cap, tiles);
    groups.appendChild(box);
    return box;
  };
  if (_sbOwn.length) group(t('My sounds'), _sbOwn.map(_sbOwnRow)).id = 'sb-own';
  for (const g of SOUND_GROUPS) group(t(g.name), g.sounds.map(s => _sbRow({ file: s.file, name: t(s.name) })));
  for (const file of Object.keys(_sbPlaying)) _sbPaint(file);
}

// `s`: { file, name } with the name as shown.
function _sbRow(s) {
  const row = document.createElement('button');
  row.className = 'sb-row dk-tile';
  _sbTile(row, s);
  row.querySelector('.sb-name').textContent = s.name;
  return row;
}

function _sbTile(row, s) {
  row.dataset.file = s.file;
  row.title = t('{name}: click plays one more, right-click stops the newest', { name: s.name });
  row.insertAdjacentHTML('beforeend', '<span class="sb-name"></span><span class="sb-count"></span><span class="sb-bar"></span>');
  row.addEventListener('click', e => { if (!e.target.closest('input, .sb-del')) _sbPlay(s); });
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); _sbStopNewest(s.file); });
}

// An own sound's tile: its name is the rename field (a button cannot hold one), and × on hover sends it to the Trash.
function _sbOwnRow(name) {
  const s = { file: SB_OWN + name, name: displayName(name) };
  const row = document.createElement('div');
  row.className = 'sb-row dk-tile sb-own';
  row.setAttribute('role', 'button');
  _sbTile(row, s);
  const field = document.createElement('input');
  field.className = 'sb-name sb-rename';
  field.spellcheck = false;
  field.value = s.name;
  field.title = t('Click to rename this sound');
  field.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); field.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); field.value = s.name; field.blur(); }
  };
  field.onblur = () => { if (field.value.trim() && field.value.trim() !== s.name) _sbRename(name, field.value); else field.value = s.name; };
  row.querySelector('.sb-name').replaceWith(field);
  const del = document.createElement('button');
  del.className = 'sb-del';
  del.title = t('Delete this sound');
  del.innerHTML = uiIcon('x');
  del.addEventListener('click', e => { e.stopPropagation(); _sbDelete(name); });
  row.insertBefore(del, row.querySelector('.sb-bar'));
  return row;
}

async function _sbRename(name, typed) {
  try { await window.electronAPI.renameOwnSound(name, typed); } catch (err) {
    messageDialog({ title: 'That sound could not be renamed', message: (err && err.message) || String(err) });
  }
  delete _sbBuffers[SB_OWN + name];
  await soundboardRefreshOwn();
}

// No question: the sound goes to the Trash, and the toast's Undo brings it back under its name.
async function _sbDelete(name) {
  const key = SB_OWN + name;
  while (_sbPlaying[key]) _sbStopNewest(key);
  delete _sbBuffers[key];
  let id = null;
  try { id = await sceneTrash.trashSound(name); } catch (err) {
    messageDialog({ title: 'Could not delete that sound', message: (err && err.message) || String(err) });
  }
  await soundboardRefreshOwn();
  if (id) await showTrackUndo(id, 'sounds', displayName(name));
}

// ─── Playback ────────────────────────────────────────────────────────────────
// ⚠ DECODED BUFFERS, NEVER AN <audio> PER COPY. One file open on two elements stalls Chromium's
// media pipeline (music.js), and copies of one sound overlap by design. Main hands over the bytes,
// so no file:// URL reaches Web Audio and nothing is tainted into silence.
function _sbEnsureCtx() {
  if (!_sbCtx) {
    _sbCtx = new AudioContext();
    _sbMaster = _sbCtx.createGain();
    _sbMaster.gain.value = _sbVolume;
    _sbMaster.connect(_sbCtx.destination);
  }
  if (_sbCtx.state === 'suspended') _sbCtx.resume();
}

function _sbBuffer(file) {
  if (!_sbBuffers[file]) {
    const read = file.startsWith(SB_OWN) ? window.electronAPI.readOwnSound(file.slice(SB_OWN.length)) : window.electronAPI.readSound(file);
    _sbBuffers[file] = read.then((bytes) => {
      if (!bytes) throw new Error(file);
      return _sbCtx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    });
    _sbBuffers[file].catch(() => { delete _sbBuffers[file]; });
  }
  return _sbBuffers[file];
}

async function _sbPlay(s) {
  _sbEnsureCtx();
  let buf;
  try { buf = await _sbBuffer(s.file); } catch (_) {
    messageDialog({ title: 'That sound will not play', message: s.name });
    return;
  }
  const gain = _sbCtx.createGain();
  gain.connect(_sbMaster);
  const src = _sbCtx.createBufferSource();
  src.buffer = buf;
  src.connect(gain);
  const copy = { src, gain, start: performance.now(), dur: buf.duration * 1000 };
  const list = _sbPlaying[s.file] || (_sbPlaying[s.file] = []);
  list.push(copy);
  src.onended = () => {
    gain.disconnect();
    const i = list.indexOf(copy);
    if (i !== -1) list.splice(i, 1);
    if (!list.length && _sbPlaying[s.file] === list) delete _sbPlaying[s.file];
    _sbPaint(s.file);
  };
  src.start();
  _sbPaint(s.file);
  if (!_sbRaf) _sbRaf = requestAnimationFrame(_sbTick);
}

function _sbStopNewest(file) {
  const list = _sbPlaying[file];
  if (!list || !list.length) return;
  const copy = list.pop();
  if (!list.length) delete _sbPlaying[file];
  const now = _sbCtx.currentTime;
  copy.gain.gain.setValueAtTime(copy.gain.gain.value, now);
  copy.gain.gain.linearRampToValueAtTime(0, now + SB_STOP_S);
  copy.src.stop(now + SB_STOP_S);
  _sbPaint(file);
}

function _sbTick() {
  _sbRaf = 0;
  const files = Object.keys(_sbPlaying);
  if (!files.length) return;
  for (const file of files) _sbPaint(file);
  _sbRaf = requestAnimationFrame(_sbTick);
}

function _sbPaint(file) {
  const row = _sbEl('sb-cols').querySelector('[data-file="' + CSS.escape(file) + '"]');
  if (!row) return;
  const list = _sbPlaying[file];
  const n = list ? list.length : 0;
  row.classList.toggle('sb-row-on', n > 0);
  const newest = n ? list[n - 1] : null;
  const left = newest ? Math.max(0, 1 - (performance.now() - newest.start) / newest.dur) : 0;
  row.querySelector('.sb-bar').style.width = (left * 100) + '%';
  row.querySelector('.sb-count').textContent = n > 1 ? '×' + n : '';
}
