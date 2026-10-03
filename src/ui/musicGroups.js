'use strict';
// musicGroups.js — the Music pane's groups. A group is a name a track carries, kept in the app's
// settings by file name; the files never move, so a release without groups still lists every
// track. The pure half is sceneGroups.js's, shared with the scene library.

const MU_GROUPS_KEY = 'evermist.musicGroups';

let _mgOf = {};      // file name → group name
let _mgOrder = [];   // group names in display order; Ungrouped is not one of them
let _mgShut = {};    // group name, '' for Ungrouped → folded shut
let _mgDrag = null;  // the file name of the row being dragged

function loadMusicGroups() {
  try {
    const s = JSON.parse(localStorage.getItem(MU_GROUPS_KEY) || '{}');
    _mgOf = s.of && typeof s.of === 'object' ? s.of : {};
    _mgOrder = Array.isArray(s.order) ? s.order.map(sanitizeGroupName).filter(Boolean) : [];
    _mgShut = s.shut && typeof s.shut === 'object' ? s.shut : {};
  } catch (_) {}
}

function _mgSave() {
  try { localStorage.setItem(MU_GROUPS_KEY, JSON.stringify({ order: _mgOrder, shut: _mgShut, of: _mgOf })); } catch (_) {}
}

function musicGroupOf(name) { return sanitizeGroupName(_mgOf[name]); }

function forgetMusicTrack(name) {
  if (!(name in _mgOf)) return;
  delete _mgOf[name];
  _mgSave();
}

function newMusicGroup() {
  const n = uniqueGroupName(t('New group'), _mgOrder);
  _mgOrder.push(n);
  _mgSave();
  _muRenderList();
  const field = [...document.querySelectorAll('#mu-list input.mu-grp-name')].find(i => i.value === n);
  if (field) { field.focus(); field.select(); }
}

// Ungrouped leads, because a new download lands there. With no groups it is the whole list.
function musicSections(rows) {
  _mgOrder = mergeGroupOrder(_mgOrder, rows.map(r => r.group));
  const s = buildGroupSections(rows, _mgOrder);
  return [s.pop()].concat(s);
}

function musicRowDrag(row, name) {
  row.draggable = true;
  row.addEventListener('dragstart', e => { _mgDrag = name; e.dataTransfer.effectAllowed = 'move'; });
  row.addEventListener('dragend', () => {
    _mgDrag = null;
    document.querySelectorAll('#mu-list .mu-grp.drop').forEach(g => g.classList.remove('drop'));
  });
}

function _mgRename(from, to) {
  _mgOrder = _mgOrder.map(n => (n === from ? to : n)).filter((n, i, arr) => arr.indexOf(n) === i);
  for (const k in _mgOf) if (_mgOf[k] === from) _mgOf[k] = to;
  if (_mgShut[from]) { _mgShut[to] = true; delete _mgShut[from]; }
  _mgSave();
  _muRenderList();
}

function _mgDelete(name) {
  _mgOrder = _mgOrder.filter(n => n !== name);
  for (const k in _mgOf) if (_mgOf[k] === name) delete _mgOf[k];
  delete _mgShut[name];
  _mgSave();
  _muRenderList();
}

function buildMusicGroup(sec, filtering) {
  const g = sec.name;
  const wrap = document.createElement('div');
  wrap.className = 'mu-grp' + (_mgShut[g] && !filtering ? ' shut' : '');
  wrap.dataset.group = g;

  const head = document.createElement('div');
  head.className = 'mu-grp-h';
  head.innerHTML = '<svg class="car" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>' +
    (sec.ungrouped ? '<span class="mu-grp-name"></span>' : '<input class="mu-grp-name" spellcheck="false">') +
    '<span class="c">' + sec.scenes.length + '</span><span class="sp"></span>' +
    (sec.ungrouped ? '' : '<button class="mu-grp-btn mu-grp-del">' + uiIcon('trash') + '</button>');
  const nameEl = head.querySelector('.mu-grp-name');
  head.onclick = e => {
    if (e.target.closest('input') || e.target.closest('button')) return;
    if (_mgShut[g]) delete _mgShut[g]; else _mgShut[g] = true;
    _mgSave();
    _muRenderList();
  };

  if (sec.ungrouped) nameEl.textContent = t('Ungrouped');
  else {
    nameEl.value = g;
    nameEl.title = t('Click to rename this group');
    nameEl.onkeydown = e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); nameEl.value = g; nameEl.blur(); }
    };
    nameEl.onblur = () => {
      const next = sanitizeGroupName(nameEl.value);
      if (!next || next === g) { nameEl.value = g; return; }
      if (!_mgOrder.includes(next)) { _mgRename(g, next); return; }
      confirmDialog({
        title: 'Merge these groups?',
        message: t('“{next}” already exists. Both groups end up under that one heading, and “{old}” ' +
                   'goes away. No track is deleted.', { next: next, old: g }),
        confirmLabel: 'Merge',
        onConfirm: () => _mgRename(g, next),
        onCancel: () => { nameEl.value = g; },
      });
    };
    const del = head.querySelector('.mu-grp-del');
    del.title = t('Delete this group');
    del.onclick = () => {
      if (!sec.scenes.length) { _mgDelete(g); return; }
      confirmDialog({
        title: 'Delete this group?',
        message: t('“{name}” goes away and its tracks move to Ungrouped. No track is deleted.', { name: g }),
        confirmLabel: 'Delete',
        onConfirm: () => _mgDelete(g),
      });
    };
  }
  wrap.appendChild(head);

  const body = document.createElement('div');
  body.className = 'mu-grp-b';
  for (const track of sec.scenes) _muRenderRow(body, track);
  if (!sec.scenes.length) {
    const hole = document.createElement('div');
    hole.className = 'mu-grp-empty';
    hole.textContent = t('Drag tracks here');
    body.appendChild(hole);
  }
  wrap.appendChild(body);

  wrap.addEventListener('dragover', e => {
    if (!_mgDrag) return;
    e.preventDefault();
    wrap.classList.add('drop');
  });
  wrap.addEventListener('dragleave', e => { if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('drop'); });
  wrap.addEventListener('drop', e => {
    e.preventDefault();
    if (!_mgDrag) return;
    if (g) _mgOf[_mgDrag] = g; else delete _mgOf[_mgDrag];
    _mgDrag = null;
    _mgSave();
    _muRenderList();
  });
  return wrap;
}
