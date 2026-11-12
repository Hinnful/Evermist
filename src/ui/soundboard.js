'use strict';

// soundboard.js — the dock's Sounds pane: one-shot sounds over the music, as rows in groups, the card that names what
// plays and stops it all. DM only. Built-in sounds and the DM's own (`userData/sounds`, electron/sounds.js) are items
// alike: renamed, moved, grouped and deleted the same way. The layout is evermist.soundsLayout (libraryPlan.js), its
// own `local:` sync record; a deleted built-in is hidden and waits in the Trash. A rename changes the name shown, never
// the file.

const SB_VOL_KEY = 'evermist.sounds.volume';
const SB_SHUT_KEY = 'evermist.soundsShut';
const SB_STOP_S = 0.12;

let _sbCtx = null;
let _sbMaster = null;
let _sbVolume = 0.5;
const _sbBuffers = {};
const _sbPlaying = {};     // file → [{ src, gain, start, dur }], oldest first
let _sbRaf = 0;
let _sbOwn = null;         // the DM's own sounds: file names straight off the folder, null until first read
let _sbL = null;           // evermist.soundsLayout, cleaned
let _sbShut = {};          // group key, '' for Ungrouped → folded shut, on this computer only
const SB_OWN = 'my/';      // an own sound's play id, so it never meets a built-in file of the same name
const _SB_BUILTIN = {};    // built-in file → { name, group } in English

function _sbEl(id) { return document.getElementById(id); }

function initSoundboard() {
  if (!_sbEl('dock-pane-sounds')) return;
  for (const g of SOUND_GROUPS) for (const s of g.sounds) _SB_BUILTIN[s.file] = { name: s.name, group: g.name };
  _sbL = libParse(localStorage.getItem(LIB_SOUNDS_KEY), cleanSoundsLayout);
  try { _sbShut = JSON.parse(localStorage.getItem(SB_SHUT_KEY) || '{}') || {}; } catch (_) { _sbShut = {}; }

  const saved = parseFloat(localStorage.getItem(SB_VOL_KEY));
  if (isFinite(saved) && saved >= 0 && saved <= 1) _sbVolume = saved;
  const vol = _sbEl('sb-vol');
  vol.value = String(Math.round(_sbVolume * 100));
  _sbSyncSlider();
  vol.addEventListener('input', () => { _sbSetVolume(Number(vol.value) / 100); _sbSyncSlider(); });

  _sbEl('btn-sb-add').addEventListener('click', _sbPickFiles);
  _sbEl('btn-sb-stop').addEventListener('click', soundsStopAll);
  _sbEl('sb-filter').addEventListener('input', _sbRender);
  _sbEl('sb-filter').addEventListener('keydown', e => e.stopPropagation());
  libDropFiles(_sbEl('dock-pane-sounds'), _sbAddFiles);
  _sbListInit();
  _sbRender();
  _sbCard();
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

// The folder is the list of own sounds, so this read is the only source of truth for them.
async function soundboardRefreshOwn() {
  try { _sbOwn = (await window.electronAPI.listOwnSounds()) || []; } catch (_) { _sbOwn = []; }
  // The upgrade: the starting layout, own sounds in "My sounds", until the DM changes it.
  if (!_sbL) { _sbL = soundsSeedLayout(SOUND_GROUPS, _sbOwn); _sbSave(); }
  _sbRender();
  syncNoteSounds();
}

// `edited`: the DM changed it now; otherwise the time stays what it was.
function _sbSave(edited) {
  if (edited) _sbL.at = Date.now();
  try { localStorage.setItem(LIB_SOUNDS_KEY, JSON.stringify(_sbL)); } catch (_) {}
  syncNoteLocal(LIB_SOUNDS_KEY);
}

// ─── Names and the layout ────────────────────────────────────────────────────

// Until the DM renames it, a built-in sound or group follows the interface language.
function soundLabel(key) {
  const own = _sbL && _sbL.labels[key];
  if (own) return own;
  const file = libBuiltinOf(key);
  if (file) return _SB_BUILTIN[file] ? t(_SB_BUILTIN[file].name) : file;
  return displayName(key);
}

function _sbGroupName(gk) {
  const g = _sbL && _sbL.groups[gk];
  if (g && g.name) return g.name;
  return libIsBuiltin(gk) ? t(libBuiltinOf(gk)) : gk;
}

function _sbPresent() {
  const hidden = new Set(_sbL ? _sbL.hidden : []);
  const builtins = SOUND_GROUPS.flatMap(g => g.sounds.map(s => s.file)).filter(f => !hidden.has(f)).map(libBuiltinKey);
  return (_sbOwn || []).concat(builtins);
}

const _sbLib = () => libNormalize(_sbL || libEmpty(), _sbPresent());

function _sbCommit(L) {
  Object.assign(_sbL, { order: L.order, groups: L.groups, groupOrder: L.groupOrder });
  _sbSave(true);
  _sbRender();
}

const _sbPlayId = key => libBuiltinOf(key) || SB_OWN + key;

// Another computer's later layout. A built-in hidden there lands in this computer's Trash; one shown there again leaves it.
async function soundsLayoutAdopt(theirs, mine) {
  const was = mine || _sbL;
  _sbL = theirs;
  _sbSave();
  _sbRender();
  const change = syHiddenChange(was ? was.hidden : [], theirs.hidden);
  for (const f of change.trash) await sceneTrash.putBuiltin(f, theirs.at || Date.now(), soundLabel(libBuiltinKey(f)));
  for (const f of change.back) await sceneTrash.dropBuiltin(f);
}

function soundsLayoutResolve(byHash) {
  const next = _sbL && syLayoutResolve(_sbL, byHash);
  if (next) { _sbL = cleanSoundsLayout(next); _sbSave(); _sbRender(); }
}

// A built-in sound back from the Trash, where it was.
function soundsUnhide(file) {
  if (!_sbL) return;
  _sbL.hidden = _sbL.hidden.filter(f => f !== file);
  _sbSave(true);
  _sbRender();
}

// ─── Adding ──────────────────────────────────────────────────────────────────

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

// ─── The list ────────────────────────────────────────────────────────────────

function _sbRender() {
  const list = _sbEl('sb-cols');
  if (!list || !_sbL || libHold(list)) return;
  const q = _sbEl('sb-filter').value.trim().toLocaleLowerCase();
  const sections = libSections(_sbLib(), _sbPresent());
  list.textContent = '';
  const groups = sections.length > 1;
  for (const sec of sections) {
    const items = sec.items.filter(k => !q || soundLabel(k).toLocaleLowerCase().includes(q));
    if (q && !items.length) continue;
    if (!groups) { items.forEach(k => list.appendChild(_sbRow(k))); continue; }
    const el = libSection(sec.key, sec.key ? _sbGroupName(sec.key) : t('Ungrouped'), items.length, !q && !!_sbShut[sec.key || '']);
    if (!items.length) el.classList.add('lib-empty');
    for (const k of items) el.querySelector('.lib-body').appendChild(_sbRow(k));
    list.appendChild(el);
  }
  for (const file of Object.keys(_sbPlaying)) _sbPaint(file);
}

function _sbRow(key) {
  const file = _sbPlayId(key), name = soundLabel(key);
  const row = document.createElement('div');
  row.className = 'mu-row sb-row';
  row.dataset.libKey = key;
  row.dataset.file = file;
  row.title = t('{name}: click plays one more, right-click stops the newest', { name });
  row.innerHTML = '<svg class="lib-ico" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/></svg><span class="mu-row-name lib-name"></span><span class="sb-count"></span>';
  row.querySelector('.lib-name').textContent = name;
  row.append(libMoreBtn());
  row.insertAdjacentHTML('beforeend', '<span class="sb-bar"></span>');
  row.addEventListener('click', () => _sbPlay({ file, name: soundLabel(key) }));
  row.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); _sbStopNewest(file); });
  return row;
}

function _sbListInit() {
  const root = _sbEl('sb-cols');
  libraryList(root, {
    scroller: root.closest('.dk-scroll'),
    redraw: _sbRender,
    filtering: () => !!_sbEl('sb-filter').value.trim(),
    groups: () => libSections(_sbLib(), _sbPresent()).filter(s => s.key).map(s => ({ key: s.key, name: _sbGroupName(s.key) })),
    rename: key => {
      const row = root.querySelector('[data-lib-key="' + CSS.escape(key) + '"]');
      if (row) libEditName(row.querySelector('.lib-name'), soundLabel(key), text => { if (text) _sbRename(key, text); });
    },
    del: key => _sbDelete(key),
    moveTo: (key, g) => _sbCommit(libMove(_sbLib(), [key], g, null)),
    move: (key, g, before) => _sbCommit(libMove(_sbLib(), [key], g, before)),
    hold: _sbHold,
    groupRename: _sbRenameGroup,
    ungroup: g => _sbCommit(libUngroup(_sbLib(), g)),
    fold: g => {
      const k = g || '';
      if (_sbShut[k]) delete _sbShut[k]; else _sbShut[k] = true;
      try { localStorage.setItem(SB_SHUT_KEY, JSON.stringify(_sbShut)); } catch (_) {}
      _sbRender();
    },
  });
}

function _sbRename(key, text) {
  const name = libLabelClean(text);
  const plain = libBuiltinOf(key) ? '' : displayName(key);
  if (name && name !== plain) _sbL.labels[key] = name; else delete _sbL.labels[key];
  _sbSave(true);
  _sbRender();
}

const _sbNewKey = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function _sbHold(drag, target) {
  const names = _sbLib().groupOrder.map(_sbGroupName);
  const r = libHoldGroup(_sbLib(), drag, target, _sbNewKey(), uniqueGroupName(t('New group'), names));
  _sbCommit(r.L);
  if (r.made) _sbRenameGroup(r.group);
}

// Renaming onto a name in use merges the two groups, after the DM says yes.
function _sbRenameGroup(gk) {
  libEditGroup(_sbEl('sb-cols'), gk, _sbGroupName(gk), typed => {
    const next = sanitizeGroupName(typed);
    if (!next) return;
    const L = _sbLib(), clash = libGroupNamed(L, next, _sbGroupName, gk);
    if (!clash) { _sbCommit(libRenameGroup(L, gk, next)); return; }
    libAskMerge(_sbGroupName(clash), _sbGroupName(gk), () => _sbCommit(libMergeGroups(_sbLib(), gk, clash)));
  });
}

// No question: an own sound's file goes to the Trash, a built-in is hidden and its entry goes there; either keeps its
// place, so Undo or Restore puts it back where it was.
// `quiet`: Claude's delete, which shows its own toast. Answers the Trash entry's id, or null.
async function _sbDelete(key, quiet) {
  const file = _sbPlayId(key), label = soundLabel(key), builtin = libBuiltinOf(key);
  while (_sbPlaying[file]) _sbStopNewest(file);
  let id = null;
  if (builtin) {
    _sbL.hidden = _sbL.hidden.concat([builtin]);
    _sbSave(true);
    _sbRender();
    id = await sceneTrash.putBuiltin(builtin, Date.now(), label);
    if (id && !quiet) await showTrackUndo(id, 'builtin', label);
    return id;
  }
  delete _sbBuffers[file];
  try { id = await sceneTrash.trashSound(key); } catch (err) {
    messageDialog({ title: 'Could not delete that sound', message: (err && err.message) || String(err) });
  }
  await soundboardRefreshOwn();
  if (id && !quiet) await showTrackUndo(id, 'sounds', label);
  return id;
}

// What Claude's sound tools read and change (mcpSounds.js): every sound shown, built-in and own.
function soundsList() {
  const L = _sbLib();
  return libSections(L, _sbPresent()).flatMap(s => s.items.map(key => ({ key, label: soundLabel(key), builtin: libIsBuiltin(key),
    group: s.key ? _sbGroupName(s.key) : null, groupKey: s.key })));
}
function soundsGroups() { return _sbLib().groupOrder.filter(g => libSections(_sbLib(), _sbPresent()).some(s => s.key === g)).map(g => ({ key: g, name: _sbGroupName(g) })); }
function soundsLayoutNow() { return _sbLib(); }
function soundsCommit(L) { _sbCommit(L); }
function soundsRename(key, text) { _sbRename(key, text); }
function soundsOwnLabel(key) { return (_sbL && _sbL.labels[key]) || ''; }
function soundsNewGroupKey() { return _sbNewKey(); }
function soundsGroupName(gk) { return _sbGroupName(gk); }
function soundsPresent() { return _sbPresent(); }
function soundsDelete(key) { return _sbDelete(key, true); }

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
  const copy = { src, gain, start: performance.now(), dur: buf.duration * 1000, name: s.name };
  const list = _sbPlaying[s.file] || (_sbPlaying[s.file] = []);
  list.push(copy);
  src.onended = () => {
    gain.disconnect();
    const i = list.indexOf(copy);
    if (i !== -1) list.splice(i, 1);
    if (!list.length && _sbPlaying[s.file] === list) delete _sbPlaying[s.file];
    _sbPaint(s.file);
    _sbCard();
  };
  src.start();
  _sbPaint(s.file);
  _sbCard();
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
  _sbCard();
}

// The card's round button: every copy of every sound stops.
function soundsStopAll() {
  for (const file of Object.keys(_sbPlaying)) while (_sbPlaying[file]) _sbStopNewest(file);
}

// The card names what plays, ×N for copies, and how many in all; with nothing playing its button greys out.
function _sbCard() {
  const files = Object.keys(_sbPlaying), n = files.reduce((a, f) => a + _sbPlaying[f].length, 0);
  _sbEl('sb-card').classList.toggle('sb-resting', !n);
  _sbEl('btn-sb-stop').disabled = !n;
  _sbEl('sb-now').textContent = n ? files.map(f => {
    const list = _sbPlaying[f], row = _sbEl('sb-cols').querySelector('[data-file="' + CSS.escape(f) + '"]');
    const name = row ? row.querySelector('.lib-name').textContent : list[list.length - 1].name;
    return list.length > 1 ? name + ' ×' + list.length : name;
  }).join(', ') : t('Nothing playing');
  _sbEl('sb-state').textContent = n ? t.plural(n, '{n} playing', '{n} playing') : t('Click a sound to play it');
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
