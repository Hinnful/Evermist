'use strict';
// musicGroups.js — the Music pane's library: the order the DM gave the tracks, the names they gave them, and the
// groups. A group is a name a track carries, kept in evermist.musicGroups by file name, which the `music` sync record
// and the previous release read; the order and the names are evermist.musicOrder (libraryPlan.js), its own `local:`
// record. The files never move or change name. The order rules are sceneGroups.js's, the shared parts libraryList.js's.

const MU_GROUPS_KEY = 'evermist.musicGroups';

let _mgOf = {};      // file name → group name
let _mgOrder = [];   // group names in display order; Ungrouped is not one of them
let _mgShut = {};    // group name, '' for Ungrouped → folded shut
let _mgAt = 0;       // when a track's group, a name or the order last changed here
let _mo = null;      // evermist.musicOrder, or null until the folder was first read
let _mgList = null;  // the libraryList on #mu-list

function loadMusicGroups() {
  try {
    const s = JSON.parse(localStorage.getItem(MU_GROUPS_KEY) || '{}');
    _mgOf = s.of && typeof s.of === 'object' ? s.of : {};
    _mgOrder = Array.isArray(s.order) ? s.order.map(sanitizeGroupName).filter(Boolean) : [];
    _mgShut = s.shut && typeof s.shut === 'object' ? s.shut : {};
    _mgAt = Number.isFinite(s.at) ? s.at : 0;
  } catch (_) {}
  _mo = libParse(localStorage.getItem(LIB_MUSIC_KEY), cleanMusicOrder);
  // The upgrade: a group no track is in goes, since empty groups no longer exist.
  if (!_mo) { _mgOrder = musicGroupsUpgrade(_mgOrder, _mgOf); _mgSave(); }
}

// `edited`: the groups changed, not only what is folded shut.
function _mgSave(edited) {
  if (edited) _mgAt = Date.now();
  try { localStorage.setItem(MU_GROUPS_KEY, JSON.stringify({ order: _mgOrder, shut: _mgShut, of: _mgOf, at: _mgAt })); } catch (_) {}
  if (edited) syncNoteMusic();
}

// `edited`: the DM changed the order or a name now; otherwise the time stays what it was.
function _moSave(edited) {
  if (edited) _mo.at = Date.now();
  try { localStorage.setItem(LIB_MUSIC_KEY, JSON.stringify(_mo)); } catch (_) {}
  syncNoteLocal(LIB_MUSIC_KEY);
}

// The first read of the folder after an upgrade keeps the order it lists.
function musicOrderSeen(files) {
  if (_mo) return;
  _mo = musicOrderSeed(files);
  _moSave();
}

// The part sync carries, as stored.
function musicGroupsSynced() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(MU_GROUPS_KEY) || '{}') || {}; } catch (_) {}
  return { of: s.of && typeof s.of === 'object' ? s.of : {}, order: Array.isArray(s.order) ? s.order : [], at: Number.isFinite(s.at) ? s.at : 0 };
}

// Another computer's later edit, taken as it is: the time stays theirs.
function musicGroupsAdopt(g) {
  _mgOf = g.of;
  _mgOrder = g.order.map(sanitizeGroupName).filter(Boolean);
  _mgAt = g.at;
  _mgSave();
  _muRenderList();
}

function musicOrderAdopt(mo) {
  _mo = mo;
  _moSave();
  _muRenderList();
}

// Tracks another computer named before their files landed here, named now they have.
function musicOrderResolve(byHash) {
  const next = _mo && syLayoutResolve(_mo, byHash);
  if (next) musicOrderAdopt(cleanMusicOrder(next));
}

// What the DM reads for a track: the name they gave it, else its file name without the extension and video id.
function musicLabel(file) {
  return (_mo && _mo.labels[file]) || displayName(file);
}

function musicOwnLabel(file) { return (_mo && _mo.labels[file]) || ''; }

// The tracks present, in the order the pane shows them: Ungrouped first, then each group.
function musicOrdered() {
  return libSections(musicLib(), _mgPresent()).flatMap(s => s.items);
}

function musicGroupOf(name) { return sanitizeGroupName(_mgOf[name]); }

// A track gone for good: its group, place and name go too. A track in the Trash keeps all three.
function forgetMusicTrack(name) {
  delete _mgOf[name];
  _mgSave(true);
  if (!_mo) return;
  _mo.order = _mo.order.filter(k => k !== name);
  delete _mo.labels[name];
  _moSave(true);
}

function musicGroupNames() { return _mgOrder.slice(); }

// ─── The order as one layout ─────────────────────────────────────────────────

const _mgPresent = () => _muTracks.map(x => x.name);

function musicLib() {
  return libNormalize(musicToLib(_mo ? _mo.order : _mgPresent(), _mgOf, _mgOrder), _mgPresent());
}

function _mgCommit(L) {
  const m = musicFromLib(L);
  if (!_mo) _mo = musicOrderSeed([]);
  _mo.order = m.order;
  _moSave(true);
  const of = {};
  for (const k of Object.keys(m.of)) of[k] = m.of[k];
  if (esCanon(of) !== esCanon(_mgOf) || esCanon(m.groupOrder) !== esCanon(_mgOrder)) { _mgOf = of; _mgOrder = m.groupOrder; _mgSave(true); }
  _muRenderList();
}

// Puts tracks in a group, or in none when `group` is ''. Claude comes here.
function setMusicGroup(names, group) {
  _mgCommit(libMove(musicLib(), names, group || null, null));
}

// Claude's way to a group's end state: a name at a place in the order, with its tracks.
function putMusicGroup(name, index, members) {
  for (const n of members) _mgOf[n] = name;
  _mgOrder = _mgOrder.filter(n => n !== name);
  _mgOrder.splice(Math.min(index, _mgOrder.length), 0, name);
  _mgSave(true);
  _mgCommit(musicLib());
}

// Claude's move: tracks into a group (or none) at a position among the tracks shown there.
function moveMusicTracks(names, group, index) {
  _mgCommit(libMoveTo(musicLib(), names, group || null, index, _mgPresent()));
}

// Each list back in the order `files` held, for Claude's undo of a move.
function musicRestoreOrder(files) {
  const at = new Map(files.map((f, i) => [f, i])), by = (a, b) => (at.has(a) ? at.get(a) : 1e9) - (at.has(b) ? at.get(b) : 1e9);
  const L = musicLib();
  L.order.sort(by);
  for (const g of L.groupOrder) L.groups[g].members.sort(by);
  _mgCommit(L);
}

function renameMusicGroup(from, to) { _mgRename(from, to); }
function deleteMusicGroup(name) { _mgCommit(libUngroup(musicLib(), name)); }

function setMusicLabel(file, text) {
  if (!_mo) _mo = musicOrderSeed(_mgPresent());
  const name = libLabelClean(text);
  if (name && name !== displayName(file)) _mo.labels[file] = name; else delete _mo.labels[file];
  _moSave(true);
  _muRenderList();
}

function _mgRename(from, to) {
  _mgOrder = _mgOrder.map(n => (n === from ? to : n)).filter((n, i, arr) => arr.indexOf(n) === i);
  for (const k in _mgOf) if (_mgOf[k] === from) _mgOf[k] = to;
  if (_mgShut[from]) { _mgShut[to] = true; delete _mgShut[from]; }
  _mgSave(true);
  _mgCommit(musicLib());
}

// ─── The pane's calls back from the list ─────────────────────────────────────

function _mgRow(file) { return [..._muEl('mu-list').querySelectorAll('.mu-row')].find(r => r.dataset.track === file); }

function _mgRenameTrack(file) {
  const row = _mgRow(file);
  if (row) libEditName(row.querySelector('.lib-name'), musicLabel(file), text => { if (text) setMusicLabel(file, text); });
}

// Renaming onto a name in use merges the two groups, after the DM says yes.
function _mgRenameGroup(g) {
  libEditGroup(_muEl('mu-list'), g, g, typed => {
    const next = sanitizeGroupName(typed);
    if (!next || next === g) return;
    const clash = _mgOrder.find(n => n !== g && n.toLocaleLowerCase() === next.toLocaleLowerCase());
    if (!clash) { _mgRename(g, next); return; }
    confirmDialog({
      title: 'Merge these groups?',
      message: t('“{next}” already exists. Both groups end up under that one heading, and “{old}” ' +
                 'goes away. No track is deleted.', { next: clash, old: g }),
      confirmLabel: 'Merge',
      onConfirm: () => _mgRename(g, clash),
    });
  });
}

function _mgHold(drag, target) {
  const name = uniqueGroupName(t('New group'), _mgOrder);
  const r = libHoldGroup(musicLib(), drag, target, name, name);
  _mgCommit(r.L);
  if (r.made) _mgRenameGroup(name);
}

function musicListInit() {
  _mgList = libraryList(_muEl('mu-list'), {
    scroller: _muEl('mu-list').closest('.dk-scroll'),
    redraw: _muRenderList,
    filtering: () => !!_muEl('mu-filter').value.trim(),
    groups: () => _mgOrder.filter(n => _muTracks.some(x => musicGroupOf(x.name) === n)).map(n => ({ key: n, name: n })),
    rename: _mgRenameTrack,
    del: file => { const x = _muTracks.find(y => y.name === file); if (x) _muDelete(x); },
    moveTo: (file, g) => _mgCommit(libMove(musicLib(), [file], g, null)),
    move: (file, g, before) => _mgCommit(libMove(musicLib(), [file], g, before)),
    hold: _mgHold,
    groupRename: _mgRenameGroup,
    ungroup: g => _mgCommit(libUngroup(musicLib(), g)),
    fold: g => { const k = g || ''; if (_mgShut[k]) delete _mgShut[k]; else _mgShut[k] = true; _mgSave(); _muRenderList(); },
  });
}

// The sections as drawn: Ungrouped first, with no heading while there are no groups. A filter opens every group and
// leaves out the ones with no match. Ungrouped with nothing in it shows only while a drag is on, as a place to drop.
function musicRenderSections(list, shown, filtering) {
  const sections = libSections(musicLib(), _mgPresent());
  const want = new Set(shown.map(x => x.name)), byName = new Map(shown.map(x => [x.name, x]));
  if (sections.length === 1) { sections[0].items.filter(k => want.has(k)).forEach(k => _muRenderRow(list, byName.get(k))); return; }
  for (const sec of sections) {
    const items = sec.items.filter(k => want.has(k));
    if (filtering && !items.length) continue;
    const el = libSection(sec.key, sec.key ? sec.name : t('Ungrouped'), items.length, !filtering && !!_mgShut[sec.key || '']);
    if (!items.length) el.classList.add('lib-empty');
    for (const k of items) _muRenderRow(el.querySelector('.lib-body'), byName.get(k));
    list.appendChild(el);
  }
}
