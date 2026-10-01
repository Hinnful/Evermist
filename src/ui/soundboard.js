'use strict';

// soundboard.js — the Sounds pill beside the music pill and its panel of one-shot sounds. DM only.

const SB_VOL_KEY = 'evermist.sounds.volume';
const SB_STOP_S = 0.12;

let _sbOpen = false;
let _sbCtx = null;
let _sbMaster = null;
let _sbVolume = 0.5;
const _sbBuffers = {};
const _sbPlaying = {};     // file → [{ src, gain, start, dur }], oldest first
let _sbRaf = 0;

function _sbEl(id) { return document.getElementById(id); }

function initSoundboard() {
  if (!_sbEl('btn-sb-open')) return;

  const saved = parseFloat(localStorage.getItem(SB_VOL_KEY));
  if (isFinite(saved) && saved >= 0 && saved <= 1) _sbVolume = saved;
  const vol = _sbEl('sb-vol');
  vol.value = String(Math.round(_sbVolume * 100));
  _sbSyncSlider();
  vol.addEventListener('input', () => { _sbSetVolume(Number(vol.value) / 100); _sbSyncSlider(); });

  _sbEl('btn-sb-open').addEventListener('click', () => _sbSetOpen(!_sbOpen));
  // One panel under the pills at a time: opening the music list puts this one away.
  for (const id of ['btn-mu-open', 'btn-mu-chev']) {
    const b = _sbEl(id);
    if (b) b.addEventListener('click', () => _sbSetOpen(false));
  }
  document.addEventListener('keydown', (e) => {
    if (_sbOpen && e.code === 'Escape') _sbSetOpen(false);
  });
}

function _sbSyncSlider() {
  const range = _sbEl('sb-vol');
  const wrap = range.closest('.cp-slider');
  const pct = Math.min(100, Math.max(0, Number(range.value) || 0));
  wrap.querySelector('.cp-slider-fill').style.width = pct + '%';
  wrap.querySelector('.cp-slider-knob').style.left = pct + '%';
}

function _sbSetVolume(v) {
  _sbVolume = Math.min(1, Math.max(0, v));
  localStorage.setItem(SB_VOL_KEY, String(_sbVolume));
  if (_sbMaster) _sbMaster.gain.value = _sbVolume;
}

function _sbSetOpen(open) {
  _sbOpen = !!open;
  _sbEl('sb-panel').style.display = _sbOpen ? 'flex' : 'none';
  _sbEl('btn-sb-open').classList.toggle('sb-pill-on', _sbOpen);
  if (!_sbOpen) return;
  if (typeof _muSetOpen === 'function') _muSetOpen(false);
  _sbRender();
  // Decoded on open, so the first press of each sound plays at once.
  _sbEnsureCtx();
  for (const g of SOUND_GROUPS) for (const s of g.sounds) _sbBuffer(s.file).catch(() => {});
}

function _sbRender() {
  const cols = _sbEl('sb-cols');
  cols.innerHTML = '';
  for (let c = 0; c < 3; c++) {
    const col = document.createElement('div');
    col.className = 'sb-col';
    for (const g of SOUND_GROUPS.slice(c * 2, c * 2 + 2)) {
      const cap = document.createElement('div');
      cap.className = 'sb-cap';
      cap.textContent = t(g.name);
      col.appendChild(cap);
      for (const s of g.sounds) col.appendChild(_sbRow(s));
    }
    cols.appendChild(col);
  }
  for (const file of Object.keys(_sbPlaying)) _sbPaint(file);
}

function _sbRow(s) {
  const row = document.createElement('button');
  row.className = 'sb-row';
  row.dataset.file = s.file;
  row.title = t(s.name);
  row.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + s.icon + '</svg>' +
    '<span class="sb-name"></span><span class="sb-count"></span><span class="sb-bar"></span>';
  row.querySelector('.sb-name').textContent = t(s.name);
  row.addEventListener('click', () => _sbPlay(s));
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); _sbStopNewest(s.file); });
  return row;
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
    _sbBuffers[file] = window.electronAPI.readSound(file).then((bytes) => {
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
    messageDialog({ title: 'That sound will not play', message: t(s.name) });
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
  if (!_sbOpen) return;
  const row = _sbEl('sb-cols').querySelector('[data-file="' + file + '"]');
  if (!row) return;
  const list = _sbPlaying[file];
  const n = list ? list.length : 0;
  row.classList.toggle('sb-row-on', n > 0);
  const newest = n ? list[n - 1] : null;
  const left = newest ? Math.max(0, 1 - (performance.now() - newest.start) / newest.dur) : 0;
  row.querySelector('.sb-bar').style.width = (left * 100) + '%';
  row.querySelector('.sb-count').textContent = n > 1 ? '×' + n : '';
}
