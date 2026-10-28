'use strict';
// mcpImportPlan.js — pure rules behind Claude's floor plan, module text and zip import: a module entry found by its
// heading, the entries listed with an excerpt, a room filled from an entry, and the replies that count what a floor
// plan or a zip would change. No DOM. Tested.

const MI = (typeof module !== 'undefined' && module.exports)
  ? Object.assign({}, require('../content/moduleText.js'), require('../rooms/roomPanel.js'))
  : { mtFold, mtFilterEntries, sanitizeRoomName, sanitizeRoomDesc };

const MCP_ENTRY_EXCERPT = 160;
const MCP_ENTRY_LIST_MAX = 60;

const _miCount = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const _miList = names => names.map(n => '"' + n + '"').join(', ');

// An entry's body cut to its first words, on one line.
function mcpEntryExcerpt(body, max) {
  const s = String(body || '').replace(/\s+/g, ' ').trim();
  const cap = max || MCP_ENTRY_EXCERPT;
  return s.length <= cap ? s : s.slice(0, cap).replace(/\s+\S*$/, '') + '…';
}

// Entries as Claude reads them, at most `max`, filtered the way the name-field dropdown filters.
function mcpEntryList(entries, query, max) {
  const hits = MI.mtFilterEntries(entries, query || '');
  return { total: hits.length, entries: hits.slice(0, max || MCP_ENTRY_LIST_MAX).map(e => ({ heading: e.title, excerpt: mcpEntryExcerpt(e.body) })) };
}

// One entry by its heading: the whole heading, its key (K12) or its name, folded as the dropdown folds. Else the
// dropdown's search, when it finds exactly one. { entry } or { error }.
function mcpEntryFind(entries, heading) {
  const list = Array.isArray(entries) ? entries : [];
  const q = MI.mtFold(heading);
  if (!q) return { error: 'Give the heading of a module entry.' };
  for (const field of ['title', 'num', 'name']) {
    const hits = list.filter(e => MI.mtFold(e[field]) === q);
    if (hits.length === 1) return { entry: hits[0] };
    if (hits.length > 1) return { error: 'More than one entry is headed "' + heading + '": ' + _miList(hits.map(e => e.title)) + '. Give the whole heading.' };
  }
  const near = MI.mtFilterEntries(list, heading);
  if (near.length === 1) return { entry: near[0] };
  if (!near.length) return { error: 'No module entry is headed "' + heading + '". list_module_entries lists them.' };
  return { error: 'More than one entry matches "' + heading + '": ' + _miList(near.slice(0, 5).map(e => e.title)) + (near.length > 5 ? ' and more' : '') + '. Give the whole heading.' };
}

// The room's name and notes once linked, as the dropdown's pick fills them: the name always, the notes when the
// room has none, or `replaceNotes`. `kept` says the room's own notes stayed.
function mcpLinkFill(poly, entry, fallbackName, replaceNotes) {
  const name = MI.sanitizeRoomName(entry.title, fallbackName);
  const desc = MI.sanitizeRoomDesc(entry.body);
  const cur = poly.desc == null ? '' : poly.desc;
  const kept = desc !== cur && !!cur && !replaceNotes;
  return { name, desc: kept ? cur : desc, kept };
}

// "4 rooms, 3 doors and 2 lights", leaving out a part at zero except the rooms.
function mcpPlanParts(c) {
  const parts = [_miCount(c.rooms, 'room', 'rooms')];
  if (c.doors) parts.push(_miCount(c.doors, 'door', 'doors'));
  if (c.lights) parts.push(_miCount(c.lights, 'light', 'lights'));
  return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0];
}

// What a floor plan would replace on a map that already holds rooms or lights. `c`: { name, roomsNow, lightsNow,
// rooms, doors, lights }.
function mcpPlanWould(c) {
  const gone = [c.roomsNow && _miCount(c.roomsNow, 'room', 'rooms'), c.lights && c.lightsNow && _miCount(c.lightsNow, 'light', 'lights')].filter(Boolean);
  return 'Nothing changed yet. "' + c.name + '" has ' + gone.join(' and ') + ' drawn. Loading the floor plan removes '
    + (gone.length > 1 ? 'them' : 'it') + ' and draws ' + mcpPlanParts(c) + ' from the plan. Tell the DM, get their yes, then call again with confirmed: true.';
}

// The plan's open walls as the kernel reports them, in percent of the map and grid squares. `derived` is
// vttDerivePlan's answer.
function mcpPlanOpenWalls(derived) {
  const w = derived.srcW, h = derived.srcH, sq = derived.gridPx;
  if (!(w > 0 && h > 0)) return [];
  const r1 = v => Math.round(v * 10) / 10;
  return (derived.openWalls || []).map(o => ({ x: r1(o.x / w * 100), y: r1(o.y / h * 100), gapSquares: sq > 0 ? r1(o.gapPx / sq) : null }));
}

// What an import of a zip would do (zipImportPreview, transferImport.js), as the question before it runs.
function mcpZipWould(p) {
  if (p.replacesVideo && p.replacesVideo.length) return 'Not imported: the file would replace the animation of ' + _miList(p.replacesVideo)
    + ', and Claude cannot bring an animation back. Ask the DM to import it in Evermist.';
  const bits = [];
  if (p.added.length) bits.push('add ' + _miCount(p.added.length, 'map', 'maps') + ' (' + _miList(p.added) + ')');
  if (p.updated.length) bits.push('update ' + _miCount(p.updated.length, 'map', 'maps') + ' already here (' + _miList(p.updated) + ')');
  const g = p.places.added + p.places.updated, r = p.roads.added + p.roads.updated;
  if (g) bits.push('add or change ' + _miCount(g, 'group', 'groups'));
  if (r) bits.push('add or change ' + _miCount(r, 'road', 'roads'));
  if (!bits.length) return 'Nothing changed. Everything in the file is already here.';
  return 'Nothing changed yet. Importing the file would ' + bits.join(', ') + '. An updated map takes the file\'s newer parts over the ones here. Tell the DM, get their yes, then call again with confirmed: true.';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MCP_ENTRY_EXCERPT, MCP_ENTRY_LIST_MAX, mcpEntryExcerpt, mcpEntryList, mcpEntryFind, mcpLinkFill,
    mcpPlanParts, mcpPlanWould, mcpPlanOpenWalls, mcpZipWould };
}
