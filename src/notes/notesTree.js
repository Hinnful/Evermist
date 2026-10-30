'use strict';
// notesTree.js — the Notes window's tree: its rows, clicks, keys, right-click menu, drag for factions and lore, and
// what New, Rename, Delete and Show on map do for each kind. The tree's shape is notesTreePlan.js.
//
// ⚠ EVERY NAME REACHES THE DOM THROUGH textContent: map, room and monster names come from imported files.

const NT_ICONS = {
  campaign: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18"/>',
  place: '<path d="M12 21s-6-5.5-6-10a6 6 0 0112 0c0 4.5-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  room: '<rect x="4" y="4" width="16" height="16" rx="1"/>',
  road: '<path d="M5 21C8 14 9 9 7 3M19 21c-3-7-4-12-2-18"/>',
  monster: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  faction: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
  lore: '<path d="M6 3h10l4 4v14H6z"/><path d="M9 11h8M9 15h8"/>',
};
// The words are whole strings so each one has its Russian entry.
const NT_NEW_BTN = { monster: '+ New monster or NPC', faction: '+ New faction', lore: '+ New lore' };
const NT_NEW_TIP = { monster: 'New monster or NPC', faction: 'New faction', lore: 'New lore' };

let _ntRoot = null;
let _ntOpen = new Set();
let _ntSig = '';
let _ntSel = null;            // the shown node's key
let _ntCur = null;            // the key the keyboard is on
let _ntRows = [];
let _ntRenaming = null;
let _ntDrag = null;
let _ntMenu = null;
let _ntReadStarted = false;

const _ntList = () => document.getElementById('nw-tl');

function _ntInput() {
  const mentioned = mxMentionedMonsters();
  const known = knownGroupNames(), recs = worldPlaceRecords();
  const names = known.concat(recs.map(r => r.name).filter(n => !known.includes(n)));
  const rooms = {};
  for (const s of allScenes) { const r = searchRoomsOf(s.id); if (r) rooms[s.id] = r; }
  return {
    scenes: allScenes.map(s => ({ id: s.id, name: s.name, group: sanitizeGroupName(s.group) })),
    groups: names.map(name => { const rec = worldPlaceByName(name); return { name, outline: rec ? wmOutline(rec) : [] }; }),
    roads: worldRoadRecords().map(r => ({ uid: r.uid, name: r.name })),
    blocks: Object.values(cbState.blocks).map(b => ({ id: b.id, name: b.name, notes: (b.notes || '').trim() ? 'x' : '', listed: !!b.listed, mentioned: !!b.uid && mentioned.has(b.uid) })),
    entries: notesEntriesAll(), rooms,
  };
}

function _ntNode(key) { return _ntRoot ? notesTreeFind(_ntRoot, key) : null; }

// The shown node's path for the crumbs; a node the tree does not hold yet reads as the campaign and its own name.
function ntPathOf(m) {
  const path = _ntRoot ? notesTreePath(_ntRoot, m.key) : [];
  if (path.length) return path.map(n => ({ key: n.key, name: n.kind === 'section' ? t(n.name) : n.kind === 'campaign' ? t('Campaign') : n.name, go: n.kind !== 'section' }));
  return [{ key: 'campaign', name: t('Campaign'), go: true }, { key: m.key, name: m.name || t('Room'), go: false }];
}

function ntNameOf(key) { const n = _ntNode(key); return n ? n.name : ''; }

// The rows are rebuilt only when what they show changed; a pointer move repaints the page a lot.
function ntSync(selKey) {
  if (!_ntReadStarted) {
    _ntReadStarted = true;
    searchReadScenes().then(() => { _ntSig = ''; if (nwIsOpen()) refreshRoomPanel(); });
  }
  const input = _ntInput();
  if (selKey !== _ntSel) {
    _ntSel = selKey;
    _ntCur = selKey;
    const root = notesTreeBuild({ ...input, roomLabel: n => t('Room {n}', { n }) });
    for (const n of notesTreePath(root, selKey)) if (n.kind !== 'section') _ntOpen.add(n.key);
  }
  const sig = JSON.stringify(input) + '|' + [..._ntOpen].join('\u0001') + '|' + _ntSel + '|' + _ntCur + '|' + t('Room {n}', { n: 0 });
  if (sig === _ntSig || _ntRenaming) return;
  _ntSig = sig;
  _ntRoot = notesTreeBuild({ ...input, roomLabel: n => t('Room {n}', { n }) });
  _ntDraw();
  _ntNewLabel();
}

function _ntIcon(kind) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.innerHTML = NT_ICONS[kind] || '';
  return s;
}

function _ntRow(r) {
  const n = r.node, sec = n.kind === 'section';
  const row = document.createElement('div');
  row.className = 'nw-row' + (sec ? ' sec' : '') + (n.key === _ntSel ? ' sel' : '') + (n.key === _ntCur && n.key !== _ntSel ? ' cur' : '');
  row.dataset.key = n.key;
  row.style.paddingLeft = (r.depth * 11) + 'px';
  const tw = document.createElement('span');
  tw.className = 'nw-tw';
  if (!sec && r.hasKids && n.key !== 'campaign') {
    tw.innerHTML = uiIcon('chev', 14, 2);
    tw.dataset.tog = n.key;
    if (!r.open) tw.classList.add('shut');
  }
  row.appendChild(tw);
  if (!sec) { const ic = document.createElement('span'); ic.className = 'nw-ti'; ic.appendChild(_ntIcon(n.kind)); row.appendChild(ic); }
  const nm = document.createElement('span');
  nm.className = 'nw-tn';
  nm.textContent = sec ? t(n.name) : n.kind === 'campaign' ? t('Campaign') : n.name;
  nm.dataset.noI18n = '';
  row.appendChild(nm);
  const addable = sec ? NT_NEW_TIP[n.sec] : n.kind === 'faction' || n.kind === 'lore' ? 'New inside' : '';
  if (addable) {
    const a = document.createElement('span');
    a.className = 'nw-ta';
    a.textContent = '+';
    a.dataset.add = n.key;
    a.title = t(addable);
    row.appendChild(a);
  }
  if ((n.kind === 'faction' || n.kind === 'lore') && n.id) row.draggable = true;
  return row;
}

function _ntDraw() {
  const list = _ntList(), top = list.scrollTop;
  _ntRows = notesTreeRows(_ntRoot, _ntOpen);
  list.textContent = '';
  for (const r of _ntRows) list.appendChild(_ntRow(r));
  list.scrollTop = top;
  const sel = list.querySelector('.nw-row.sel');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function _ntNewLabel() {
  const n = _ntNode(_ntSel);
  document.getElementById('nw-new').textContent = t((n && NT_NEW_BTN[n.kind]) || '+ New');
}

// ─── Where a click goes ──────────────────────────────────────────────────────

function _ntTarget(n) {
  if (n.kind === 'campaign') return { kind: 'campaign' };
  if (n.kind === 'faction' || n.kind === 'lore') return { kind: 'entry', id: n.id };
  if (n.kind === 'room') return { kind: 'room', id: n.id, scene: n.scene };
  return { kind: n.kind, id: n.id };
}

// "Open" means held: the map on screen, or either column's map in two-map mode.
function _ntHeld(sceneId) {
  return panesActive ? !!paneColumnOf(sceneId) : !!(currentScene && currentScene.id === sceneId);
}

// A room of a held map is picked on that map, as Figma's layers pick; any other only shows its note.
function _ntGoRoom(n) {
  if (!_ntHeld(n.scene) || worldMapOpen) { notesLevelPick = _ntTarget(n); refreshRoomPanel(); return; }
  if (panesActive) {
    const col = paneColumnOf(n.scene);
    selectPane(col);
    sendToPane({ type: 'pane-room-select', id: n.id }, col);
    notesLevelPick = null;
    return;
  }
  selectedPolygonId = n.id;
  leaveShapeEditMode();
  notesLevelPick = null;
  refreshRoomPanel();
  drawCursor(lastScreenX, lastScreenY);
  scheduleRender();
}

function ntGo(n) {
  if (n.kind === 'section') return;
  notesPanelFlush();
  if (n.kind === 'room') _ntGoRoom(n);
  else { notesLevelPick = _ntTarget(n); refreshRoomPanel(); }
}

function ntGoKey(key) {
  const n = _ntNode(key);
  if (n) ntGo(n);
  return !!n;
}

// Changes whenever the tree's rows would: what the labels in a note repaint on.
function ntSig() { return _ntSig; }

// ─── Rename, delete, new ─────────────────────────────────────────────────────

function _ntRenamePlace(from, to) {
  const next = sanitizeGroupName(to);
  if (!next || next === from) return;
  const shown = _ntSel === 'place:' + from;   // the rename repaints the window before it can be pointed at the new name
  renameGroupAsking(from, next);
  if (shown && knownGroupNames().includes(next)) notesLevelPick = { kind: 'place', id: next };
}

function ntRenameKey(key, name) {
  const n = _ntNode(key), v = String(name).trim();
  if (!n || !v || n.kind === 'campaign' || n.kind === 'section') return;
  if (n.kind === 'place') _ntRenamePlace(n.id, v);
  else if (n.kind === 'map') renameScene(n.id, v);
  else if (n.kind === 'road') worldRoadRename(n.id, v);
  else if (n.kind === 'room') notesRoomPatch(n.scene, n.id, { name: v });
  else if (n.kind === 'monster') {
    const b = cbState.blocks[n.id], others = Object.assign({}, cbState.blocks);
    delete others[n.id];
    b.name = combatUniqueName(others, v, b.source || '');
    cbSave();
  } else notesEntryRename(n.id, v);
  if (worldMapOpen) worldMapRefresh();
  _ntSig = '';
  refreshRoomPanel();
}

function ntRenameStart(n) {
  if (n.kind === 'campaign' || n.kind === 'section') return;
  const row = _ntList().querySelector('.nw-row[data-key="' + CSS.escape(n.key) + '"]');
  if (!row) return;
  const nm = row.querySelector('.nw-tn'), input = document.createElement('input');
  input.type = 'text';
  input.value = n.unnamed ? '' : n.name;
  input.maxLength = 60;
  input.spellcheck = false;
  _ntRenaming = n.key;
  nm.textContent = '';
  nm.appendChild(input);
  const done = commit => {
    if (_ntRenaming !== n.key) return;
    _ntRenaming = null;
    if (commit) ntRenameKey(n.key, input.value);
    _ntSig = '';
    refreshRoomPanel();
  };
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); done(true); }
    else if (e.key === 'Escape') { e.preventDefault(); done(false); }
  });
  input.addEventListener('blur', () => done(true));
  input.addEventListener('mousedown', e => e.stopPropagation());
  input.addEventListener('click', e => e.stopPropagation());
  input.focus();
  input.select();
}

function _ntLeaves(n) { return [n.key].concat(...n.children.map(_ntLeaves)); }

// After a delete, the window moves to the nearest thing still there: what the deleted entry sat under, else the campaign.
function _ntAfterDelete(n, to) {
  const shown = _ntSel && _ntLeaves(n).includes(_ntSel);
  if (shown || (notesLevelPick && notesLevelPick.kind === n.kind && notesLevelPick.id === n.id)) notesLevelPick = to || { kind: 'campaign' };
  _ntSig = '';
  refreshRoomPanel();
}

function _ntDoDelete(n) {
  if (n.kind === 'map') {
    if (worldMapOpen) worldMapSelect({ sceneId: null, place: '' });
    deleteScenesWithUndo([n.id]);
  } else if (n.kind === 'place') {
    const rec = worldPlaceByName(n.id);
    if (rec) worldPlaceUngroup(rec.id);
    else deleteGroup({ name: n.id, scenes: allScenes.filter(s => sanitizeGroupName(s.group) === n.id) });
  } else if (n.kind === 'road') worldMapRoadDelete(n.id);
  else if (n.kind === 'room') {
    if (panesActive) {
      const col = paneColumnOf(n.scene);
      sendToPane({ type: 'pane-room-select', id: n.id }, col);
      sendToPane({ type: 'pane-room-edit', op: 'delete', id: n.id }, col);
    } else { selectedPolygonId = n.id; deleteSelectedPolygon(); }
  } else if (n.kind === 'monster') {
    const b = cbState.blocks[n.id];
    if (b) { b.notes = ''; delete b.listed; cbSave(); }
  } else {
    const to = notesEntryDelete(n.id);
    return _ntAfterDelete(n, to ? { kind: 'entry', id: to } : null);
  }
  _ntAfterDelete(n, null);
}

function _ntDeleteWords(n) {
  const name = n.unnamed || !n.name ? t('Room') : n.name, v = { name };
  if (n.kind === 'map') return [t('Delete “{name}”?', v), t('Its rooms and notes go with it. Right after, you can undo it.')];
  if (n.kind === 'place') return [t('Delete the group “{name}”?', v), t('The group and its notes go. Its maps stay.')];
  if (n.kind === 'road') return [t('Delete the road “{name}”?', v), t('The road and its notes go. Its maps stay where they are.')];
  if (n.kind === 'room') return [t('Delete “{name}”?', v), t('The room and its notes go from the map.')];
  if (n.kind === 'monster') return [t('Clear the note on “{name}”?', v), t('Your note goes and it leaves this list. Its stat block stays in the Bestiary.')];
  const inside = n.children.length ? _ntLeaves(n).length - 1 : 0;
  return [t('Delete “{name}”?', v), inside ? t.plural(inside, 'It and the {n} entry inside it go, with their notes.', 'It and the {n} entries inside it go, with their notes.') : t('Its note goes with it.')];
}

function ntDelete(n) {
  if (n.kind === 'campaign' || n.kind === 'section' || (n.kind === 'room' && !_ntHeld(n.scene))) return;
  const w = _ntDeleteWords(n);
  confirmDialog({ title: w[0], message: w[1], confirmLabel: 'Delete', danger: true, onConfirm: () => _ntDoDelete(n) });
}

// A new blank one of `kind` under `parent` (a section's kind or an entry id), named and ready to type.
function _ntMake(kind, parent) {
  let tg;
  if (kind === 'monster') {
    const b = cbNewBlock(combatUniqueName(cbState.blocks, t('New monster'), ''));
    b.listed = true;
    cbSave();
    tg = { kind: 'monster', id: b.id };
  } else {
    const e = notesEntryAdd(kind, t(kind === 'faction' ? 'New faction' : 'New lore'), parent || kind);
    if (parent && parent !== kind) _ntOpen.add('entry:' + parent);
    tg = { kind: 'entry', id: e.id };
  }
  notesLevelPick = tg;
  _ntSig = '';
  refreshRoomPanel();
  const title = document.getElementById('nw-title');
  title.focus();
  title.select();
}

function ntNewHere() {
  const n = _ntNode(_ntSel);
  if (n && n.kind === 'monster') { _ntMake('monster'); return; }
  if (n && (n.kind === 'faction' || n.kind === 'lore')) { _ntMake(n.kind, notesEntryGet(n.id).parent); return; }
  const b = document.getElementById('nw-new').getBoundingClientRect();
  ntMenuAt(b, [{ label: 'Monster or NPC', run: () => _ntMake('monster') }, { label: 'Faction', run: () => _ntMake('faction') }, { label: 'Lore', run: () => _ntMake('lore') }]);
}

function _ntNewFromRow(key) {
  const n = _ntNode(key);
  if (!n) return;
  if (n.kind === 'section') _ntMake(n.sec);
  else _ntMake(n.kind, n.id);
}

// ─── Menu ────────────────────────────────────────────────────────────────────

function ntCloseMenu() {
  if (_ntMenu) { _ntMenu.remove(); _ntMenu = null; }
}

// `at` is a rect or a point; rows are { label, run, off, danger, raw, hint, sep }.
function ntMenuAt(at, rows) {
  ntCloseMenu();
  if (!rows.length) return;
  const menu = document.createElement('div');
  menu.className = 'sm-menu nw-menu';
  menu.dataset.noI18n = '';
  for (const r of rows) {
    if (r.sep) { menu.insertAdjacentHTML('beforeend', '<div class="sm-msep"></div>'); continue; }
    const b = document.createElement('button');
    b.className = 'sm-mi' + (r.danger ? ' danger' : '');
    b.textContent = r.raw ? r.label : t(r.label);
    b.disabled = !!r.off;
    // A greyed row says why in the row itself: a disabled button shows no tooltip.
    if (r.off && r.hint) { b.classList.add('why'); const w = document.createElement('span'); w.className = 'nw-why'; w.textContent = r.hint; b.appendChild(w); }
    b.addEventListener('click', () => { ntCloseMenu(); r.run(); });
    menu.appendChild(b);
  }
  menu.addEventListener('mousedown', e => e.stopPropagation());
  menu.addEventListener('contextmenu', e => e.preventDefault());
  menu.addEventListener('keydown', e => e.stopPropagation());
  document.body.appendChild(menu);
  menu.style.zIndex = 400;
  const w = menu.offsetWidth, h = menu.offsetHeight, x = at.left !== undefined ? at.left : at.x, y = at.bottom !== undefined ? at.bottom + 2 : at.y;
  menu.style.left = Math.max(4, Math.min(x, innerWidth - w - 4)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, innerHeight - h - 4)) + 'px';
  _ntMenu = menu;
}

function _ntRowsFor(n) {
  if (n.kind === 'campaign') {
    return [{ label: 'Expand all', run: () => { for (const k of notesTreeFoldable(_ntRoot)) _ntOpen.add(k); _ntSig = ''; ntSync(_ntSel); } },
      { label: 'Collapse all', run: () => { _ntOpen.clear(); _ntSig = ''; ntSync(_ntSel); } }];
  }
  if (n.kind === 'section') return [];
  const far = n.kind === 'room' && !_ntHeld(n.scene), show = ['place', 'map', 'room', 'road'].includes(n.kind);
  const rows = [{ label: 'Rename', run: () => ntRenameStart(n) }];
  if (n.kind === 'faction' || n.kind === 'lore') rows.push({ label: 'New inside', run: () => _ntMake(n.kind, n.id) });
  if (show) rows.push({ label: 'Show on map', run: () => searchShowOnMap({ ...n, sceneName: (allScenes.find(s => s.id === n.scene) || {}).name }) });
  rows.push({ sep: true }, { label: 'Delete', danger: true, off: far, hint: far ? t('Open the map to delete') : '', run: () => ntDelete(n) });
  return rows;
}

// ─── Keys, drag and wiring ───────────────────────────────────────────────────

function _ntMoveCursor(d) {
  const i = Math.max(0, _ntRows.findIndex(r => r.node.key === _ntCur));
  const next = _ntRows[Math.max(0, Math.min(_ntRows.length - 1, i + d))];
  if (next) { _ntCur = next.node.key; _ntSig = ''; ntSync(_ntSel); }
}

function _ntKey(e) {
  const n = _ntNode(_ntCur);
  const open = n && _ntOpen.has(n.key);
  if (e.key === 'ArrowDown') _ntMoveCursor(1);
  else if (e.key === 'ArrowUp') _ntMoveCursor(-1);
  else if (e.key === 'ArrowRight' && n && n.children.length && n.kind !== 'section' && !open) { _ntOpen.add(n.key); _ntSig = ''; ntSync(_ntSel); }
  else if (e.key === 'ArrowLeft' && n) {
    if (open) _ntOpen.delete(n.key);
    else { const p = notesTreePath(_ntRoot, n.key).slice(-2, -1)[0]; if (p && p.key !== 'campaign') _ntCur = p.key; }
    _ntSig = '';
    ntSync(_ntSel);
  } else if (e.key === 'Enter' && n) ntGo(n);
  else if (e.ctrlKey && e.code === 'KeyR' && n) ntRenameStart(n);
  else return;
  e.preventDefault();
}

// Over a row: its top quarter puts the dragged entry before it, its bottom quarter after, the middle inside it.
function _ntZone(e, row) {
  const r = row.getBoundingClientRect(), f = (e.clientY - r.top) / r.height;
  return row.classList.contains('sec') ? 'in' : f < 0.25 ? 'before' : f > 0.75 ? 'after' : 'in';
}

function _ntDrop(e) {
  const row = e.target.closest('.nw-row'), from = _ntDrag;
  _ntDrag = null;
  _ntList().querySelectorAll('.over-in, .over-before, .over-after').forEach(r => r.classList.remove('over-in', 'over-before', 'over-after'));
  const to = row && _ntNode(row.dataset.key);
  if (!from || !to || !from.id) return;
  e.preventDefault();
  const z = _ntZone(e, row);
  if (to.kind === 'section') { notesEntryMove(from.id, to.sec); }
  else if (z === 'in') { notesEntryMove(from.id, to.id); _ntOpen.add(to.key); }
  else {
    const t0 = notesEntryGet(to.id);
    const sibs = neChildren(notesEntriesAll(), t0.parent).filter(s => s.id !== from.id);
    const at = sibs.findIndex(s => s.id === to.id);
    notesEntryMove(from.id, t0.parent, z === 'before' ? to.id : (sibs[at + 1] || {}).id);
  }
  _ntSig = '';
  refreshRoomPanel();
}

function ntInit() {
  const list = _ntList();
  if (!list) return;
  list.addEventListener('click', e => {
    const row = e.target.closest('.nw-row');
    if (!row) return;
    const key = row.dataset.key;
    if (e.target.closest('[data-add]')) { _ntNewFromRow(key); return; }
    if (e.target.closest('[data-tog]')) { if (_ntOpen.has(key)) _ntOpen.delete(key); else _ntOpen.add(key); _ntSig = ''; ntSync(_ntSel); return; }
    ntGoKey(key);
  });
  list.addEventListener('contextmenu', e => {
    e.preventDefault();
    const row = e.target.closest('.nw-row'), n = row && _ntNode(row.dataset.key);
    if (n) ntMenuAt({ x: e.clientX, y: e.clientY }, _ntRowsFor(n));
  });
  list.addEventListener('keydown', _ntKey);
  list.addEventListener('dragstart', e => {
    const row = e.target.closest('.nw-row');
    _ntDrag = row ? _ntNode(row.dataset.key) : null;
    if (_ntDrag && e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', _ntDrag.key); }
  });
  list.addEventListener('dragover', e => {
    const row = e.target.closest('.nw-row'), to = row && _ntNode(row.dataset.key), from = _ntDrag;
    list.querySelectorAll('.over-in, .over-before, .over-after').forEach(r => r.classList.remove('over-in', 'over-before', 'over-after'));
    if (!from || !to || (to.kind !== from.kind && !(to.kind === 'section' && to.sec === from.kind))) return;
    e.preventDefault();
    row.classList.add('over-' + _ntZone(e, row));
  });
  list.addEventListener('drop', _ntDrop);
  list.addEventListener('dragend', () => { _ntDrag = null; });
  document.getElementById('nw-new').addEventListener('click', ntNewHere);
  window.addEventListener('mousedown', e => { if (_ntMenu && !_ntMenu.contains(e.target)) ntCloseMenu(); }, true);
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && _ntMenu) { ntCloseMenu(); e.stopImmediatePropagation(); } }, true);
}
