'use strict';
// notesTreeDrag.js — the Notes tree on the shared list parts (libraryList.js): the ⋯ menu, Move to group, which row may
// go where, and what a drop writes. Rooms, roads and monsters order and group in evermist.notesOrder (notesOrder.js),
// factions and lore nest in their own key, and a map's drop moves its card on the Campaign (notesMapDrop.js). Every
// drop leaves one step on the tree's undo (notesTree.js).

const _ndParent = n => { const p = notesTreePath(_ntRoot, n.key); return p.length > 1 ? p[p.length - 2] : null; };
const _ndEntry = n => n.kind === 'faction' || n.kind === 'lore';
const _ndListed = n => n.kind === 'room' || n.kind === 'road' || n.kind === 'monster';
const _ndCampaign = n => n.kind === 'map' || n.kind === 'place';

// The node whose children are the top of the list `n` sits in: a Notes group's own parent for one of its members.
function _ndTop(n) {
  const p = _ndParent(n);
  return p && p.kind === 'ngroup' ? _ndParent(p) : p;
}

// The list key of a node's children, a group's uid minted the first time it is ordered.
function _ndListKey(top) { return top.kind === 'place' ? 'place:' + mxGroupUidFor(top.id) : top.list; }

// A row's item in evermist.notesOrder, minting the uid it needs. Null when it cannot have one yet.
function _ndKey(n) {
  if (n.kind === 'ngroup' || n.kind === 'map' || n.kind === 'road') return n.id;
  if (n.kind === 'place') return mxGroupUidFor(n.id);
  if (n.kind === 'monster') { const b = cbState.blocks[n.id]; return b ? mxMonsterUid(b) : null; }
  if (n.kind === 'room') return _ndRoomKey(n);
  return null;
}

// ⚠ A ROOM IS KEYED BY ITS UID, never its numeric id: a re-imported floor plan reuses the numbers.
function _ndRoomKey(n) {
  const r = (searchRoomsOf(n.scene) || []).find(x => x.id === n.id);
  if (!r) return null;
  const col = !r.uid && panesActive ? paneColumnOf(n.scene) : null;
  if (col) {
    // A column holds the map, so the uid reaches the room through it: the one every machine reads it by.
    r.uid = esLegacyUid(r);
    sendToPane({ type: 'pane-room-uid', id: r.id, uid: r.uid }, col);
  }
  const uid = mxRoomUid(n.scene, r);
  return uid ? n.scene + ':' + uid : null;
}

// The stored list under `top` with every row shown there added, so a move lands between the rows the DM sees.
function _ndFilled(top, lk) {
  const keys = [];
  for (const c of top.children) {
    if (c.kind === 'section') continue;
    for (const m of c.kind === 'ngroup' ? c.children : [c]) keys.push(_ndKey(m));
  }
  return notesOrderFill(notesOrderGet(lk), keys.filter(Boolean));
}

// The token a drop before or after `b` goes in front of; null at the end.
function _ndBefore(b, zone, dragKey) {
  if (zone === 'before') return _ndKey(b);
  const sibs = _ndParent(b).children.filter(c => c.kind !== 'section');
  let i = sibs.indexOf(b) + 1;
  while (sibs[i] && _ndKey(sibs[i]) === dragKey) i++;
  return sibs[i] ? _ndKey(sibs[i]) : null;
}

const _ndGroupOf = b => { const p = _ndParent(b); return p && p.kind === 'ngroup' ? p.id : null; };

// One list written and its old value kept for the tree's undo.
function _ndWriteList(lk, next, world, after) {
  ntUndoPush({ lists: [{ key: lk, was: notesOrderGet(lk) }], world: world || null });
  notesOrderPut(lk, next);
  ntRefresh();
  if (after) after();
}

// ─── Which row may go where ──────────────────────────────────────────────────

const _ndUnder = (b, a) => notesTreePath(_ntRoot, b.key).includes(a);

function ntDragAim(dragKey, overKey, zone) {
  const a = _ntNode(dragKey), b = _ntNode(overKey);
  if (!a || !b || a === b) return null;
  if (_ndEntry(a)) {
    if (b.kind === 'section') return b.sec === a.kind ? 'in' : null;
    if (b.kind !== a.kind || _ndUnder(b, a)) return null;
    return zone === 'middle' ? 'in' : 'line';
  }
  if (a.kind === 'ngroup') return zone !== 'middle' && _ndParent(b) === _ndParent(a) ? 'line' : null;
  if (_ndListed(a)) {
    if (_ndTop(b) !== _ndTop(a) || (b.kind !== a.kind && b.kind !== 'ngroup')) return null;
    if (b.kind === 'ngroup') return zone === 'middle' ? 'in' : 'line';
    return zone === 'middle' ? 'hold' : 'line';
  }
  if (a.kind === 'place') return zone !== 'middle' && _ndCampaign(b) && _ndParent(b) === _ndParent(a) ? 'line' : null;
  if (a.kind === 'map') return nmAim(a, b, zone);
  return null;
}

function ntCanDrag(key) {
  const n = _ntNode(key);
  return !!n && n.kind !== 'campaign' && n.kind !== 'section' && (!_ndEntry(n) || !!n.id) && _ntRenaming === null;
}

// ─── What a drop writes ──────────────────────────────────────────────────────

function _ndDropEntry(a, b, zone) {
  const e = notesEntryGet(a.id), sibs0 = neChildren(notesEntriesAll(), e.parent);
  ntUndoPush({ entry: { id: a.id, parent: e.parent, before: (sibs0[sibs0.findIndex(s => s.id === a.id) + 1] || {}).id } });
  if (b.kind === 'section') notesEntryMove(a.id, b.sec);
  else if (zone === 'in') { notesEntryMove(a.id, b.id); ntOpenKey(b.key); }
  else {
    const t0 = notesEntryGet(b.id);
    const sibs = neChildren(notesEntriesAll(), t0.parent).filter(s => s.id !== a.id);
    const at = sibs.findIndex(s => s.id === b.id);
    notesEntryMove(a.id, t0.parent, zone === 'before' ? b.id : (sibs[at + 1] || {}).id);
  }
  ntRefresh();
}

// A room, road or monster: before or after a row, into a Notes group, or held on another to make one.
function _ndDropListed(a, b, zone) {
  const top = _ndTop(a), lk = _ndListKey(top), key = _ndKey(a), now = Date.now();
  if (!key || !lk) return;
  let l = _ndFilled(top, lk);
  if (zone === 'hold') {
    const target = _ndKey(b), gid = notesOrderNewGid();
    if (!target) return;
    const made = !_ndGroupOf(b);
    l = notesOrderHold(l, key, target, gid, t('New group'), now);
    _ndWriteList(lk, l, null, () => {
      const k = 'ng:' + lk + ':' + (made ? gid : _ndGroupOf(b));
      ntOpenKey(k);
      if (made) ntRenameStartKey(k);
    });
    return;
  }
  if (zone === 'in') l = notesOrderMove(l, key, b.id, null, now);
  else l = notesOrderMove(l, key, _ndGroupOf(b), _ndBefore(b, zone, key), now);
  _ndWriteList(lk, l);
}

function _ndDropGroup(a, b, zone) {
  const top = _ndParent(a), lk = _ndListKey(top);
  _ndWriteList(lk, notesOrderMove(_ndFilled(top, lk), a.id, null, _ndBefore(b, zone, a.id), Date.now()));
}

// A group of the Campaign keeps its outline; only its place among its parent's rows changes.
function _ndDropPlace(a, b, zone) {
  const top = _ndParent(a), lk = _ndListKey(top), key = _ndKey(a);
  _ndWriteList(lk, notesOrderMove(_ndFilled(top, lk), key, null, _ndBefore(b, zone, key), Date.now()));
}

function ntDragDrop(dragKey, at) {
  const a = _ntNode(dragKey), b = _ntNode(at.key);
  if (!a || !b || !ntDragAim(dragKey, at.key, at.zone === 'in' || at.zone === 'hold' ? 'middle' : at.zone)) return;
  notesPanelFlush();
  if (_ndEntry(a)) _ndDropEntry(a, b, at.zone);
  else if (a.kind === 'ngroup') _ndDropGroup(a, b, at.zone);
  else if (_ndListed(a)) _ndDropListed(a, b, at.zone);
  else if (a.kind === 'place') _ndDropPlace(a, b, at.zone);
  else if (a.kind === 'map') nmDrop(a, b, at.zone);
}

// ─── Notes groups: Move to group, Rename, Ungroup ────────────────────────────

function _ndMoveRows(n) {
  const top = _ndTop(n), here = _ndGroupOf(n);
  const groups = top.children.filter(c => c.kind === 'ngroup' && c.id !== here);
  const rows = groups.map(g => ({ label: g.name, raw: true, run: () => _ndDropListed(n, g, 'in') }));
  if (here) rows.push({ sep: true }, { label: 'No group', run: () => _ndDropListed(n, _ndParent(n), 'after') });
  return rows.length ? rows : [{ label: 'No groups yet', off: true, run: () => {} }];
}

function ntGroupRename(n, name) {
  const lk = n.list, list = notesOrderGet(lk);
  if (!list || !noName(name)) return;
  notesOrderPut(lk, notesOrderRename(list, n.id, name, Date.now()));
  ntRefresh();
}

function ntGroupUngroup(n) {
  const lk = n.list, list = notesOrderGet(lk);
  if (list) _ndWriteList(lk, notesOrderUngroup(list, n.id, Date.now()));
}

// The ⋯ and right-click rows of a row: the tree's own, with Move to group where the row can be grouped.
function ntMenuRows(n) {
  if (n.kind === 'section') return [];
  if (n.kind === 'ngroup') return [{ label: 'Rename', key: 'Ctrl+R', run: () => ntRenameStart(n) }, { label: 'Ungroup', run: () => ntGroupUngroup(n) }];
  const rows = ntRowsFor(n);
  const move = _ndListed(n) ? () => _ndMoveRows(n) : n.kind === 'map' && !worldRoadOfScene(n.id) ? () => nmMoveRows(n) : null;
  if (rows[0] && rows[0].label === 'Rename') rows[0].key = 'Ctrl+R';
  if (move) rows.splice(1, 0, { label: 'Move to group', key: '›', sub: move });
  return rows;
}
