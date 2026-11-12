'use strict';
// notesMapDrop.js — a map dropped in the Notes tree: its place among its group's rows, and when the drop names another
// group, its card moved on the Campaign so the outlines file it there (a group is geometry, never a field set by hand).
// A map dropped on a loose map makes a group of the two, as the Campaign's own drop does. Works with the Campaign shut.

// Which drops a map takes: a road holds its map in place, so that one only reorders and is never grouped with.
function nmAim(a, b, zone) {
  const held = !!worldRoadOfScene(a.id), from = _ndParent(a);
  if (b.kind === 'place' && zone === 'middle') return held ? null : 'in';
  if (b.kind === 'map' && zone === 'middle') return !held && !worldRoadOfScene(b.id) && _ndParent(b).kind === 'campaign' ? 'hold' : null;
  if (!_ndCampaign(b)) return null;
  return held && _ndParent(b) !== from ? null : 'line';
}

// What opening the Campaign makes sure of: every map has a spot and every group an outline.
function _nmReady() {
  worldEnsurePositions();
  worldEnsureShapes();
}

const _nmOutlines = () => {
  const out = Object.create(null);
  for (const r of worldPlaceRecords()) out[r.name] = wmOutline(r);
  return out;
};

// The card into a clear spot inside `name`'s outline. ⚠ A GROUP NESTED INSIDE IS TAKEN SPACE: a card set down in it
// would be filed under that group instead. False when no spot is left that the outline alone holds.
function _nmJoin(id, name) {
  const outlines = _nmOutlines(), outline = outlines[name];
  if (!outline) return false;
  const inner = Object.keys(outlines).filter(n => n !== name && outlines[n].every(v => wmPointInPoly(v, outline))).map(n => wmPolyBounds(outlines[n]));
  const cards = allScenes.filter(s => s.id !== id && wmCleanPos(s.worldPos)).map(s => wmCardRect(s.worldPos));
  const at = wmSlotInPoly(outline, cards.concat(inner)) || wmSpotInOutline(outline, cards);
  if (!at || wmPlaceOf(wmCardRect(at), outlines) !== name) return false;
  worldSceneSet(id, { worldPos: at });
  worldAssignAll();
  return true;
}

// The card out of every outline, by the free-spot rule Claude's scene tools use.
function _nmLeave(id) {
  worldSceneSet(id, { worldPos: _mcpSpot('', new Set([id])) });
  worldAssignAll();
}

// Before or after a row, or into a group: the map's place there, and its card moved when its group changes.
// ⚠ THE TREE IS READ BEFORE THE CAMPAIGN CHANGES: a Campaign refresh rebuilds it, and these nodes would be stale.
function nmDrop(a, b, zone) {
  if (zone === 'hold') { _nmPair(a, b); return; }
  const to = zone === 'in' ? b : _ndParent(b), from = _ndParent(a), world = worldSnapshotTake();
  const lk = _ndListKey(to);
  const next = notesOrderMove(_ndFilled(to, lk), a.id, null, zone === 'in' ? null : _ndBefore(b, zone, a.id), Date.now());
  if (to !== from) {
    _nmReady();
    const group = to.kind === 'place' ? to.id : '';
    if (group && !_nmJoin(a.id, group)) {
      messageDialog({ title: 'Nothing changed', message: t('“{name}” has no room for another map outside the groups inside it. Make it bigger on the Campaign.', { name: group }) });
      return;
    }
    if (!group) _nmLeave(a.id);
    if (worldMapOpen) worldMapRefresh();
  }
  _ndWriteList(lk, next, to !== from ? world : null);
}

// Held on a loose map: the two make a new group where the target stood, and its name opens in the tree.
function _nmPair(a, b) {
  _nmReady();
  const mate = allScenes.find(s => s.id === b.id);
  if (!mate || !wmCleanPos(mate.worldPos)) return;
  const world = worldSnapshotTake(), pair = wmPairPlace(mate.worldPos), campaign = _ndFilled(_ndParent(b), 'campaign');
  worldUndoPush();   // the Campaign's own Ctrl+Z takes the pair back too, as one step
  worldRoadsDetach(a.id);
  worldSceneSet(a.id, { worldPos: pair.pos });
  const name = worldPlaceCreate(pair.shape);
  worldUndoDropLast();
  if (worldMapOpen) worldMapRefresh();
  const uid = mxGroupUidFor(name), now = Date.now(), inner = 'place:' + uid;
  const top = notesOrderMove(campaign, uid, null, b.id, now);
  ntUndoPush({ lists: [{ key: 'campaign', was: notesOrderGet('campaign') }, { key: inner, was: notesOrderGet(inner) }], world });
  notesOrderPut('campaign', top);
  notesOrderPut(inner, notesOrderMove(notesOrderFill(null, [b.id, a.id]), a.id, null, null, now));
  ntRefresh();
  ntOpenKey('place:' + name);
  ntRenameStartKey('place:' + name);
}

// Move to group for a map: every group of the Campaign, and No group while it is in one.
function nmMoveRows(n) {
  const here = _ndParent(n), places = [];
  const walk = x => { for (const c of x.children) if (c.kind === 'place') { if (c !== here) places.push(c); walk(c); } };
  walk(_ntRoot);
  const rows = places.map(p => ({ label: p.name, raw: true, run: () => nmDrop(n, p, 'in') }));
  if (here && here.kind === 'place') rows.push({ sep: true }, { label: 'No group', run: () => nmDrop(n, _ntRoot, 'in') });
  return rows.length ? rows : [{ label: 'No groups yet', off: true, run: () => {} }];
}
