'use strict';
// mcpImport.js — Claude's import tools: a floor plan drawn onto a map, module text loaded and its entries linked to
// rooms, and an export zip merged into the library. Each goes through the app's own path: the floor plan through
// Draw Rooms' builders and mcpEditMap, module text through the import panel's reader, a zip through Import.

const _mcpFileName = p => String(p).split(/[\\/]/).pop();

// A plan file named by path, as text, or { error }.
async function _mcpPlanFile(path) {
  const read = await window.electronAPI.readPrepFile(String(path), 'plan');
  if (read.error) return { error: read.error };
  return { text: new TextDecoder('utf-8').decode(read.bytes) };
}

async function _mcpLoadFloorPlan(args) {
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  const s = found.scene;
  let text = null;
  if (args.path) {
    const read = await _mcpPlanFile(args.path);
    if (read.error) return _mcpNo(read.error);
    if (!describePlan(read.text)) return _mcpNo('Not done: "' + _mcpFileName(args.path) + '" is not a floor plan Evermist can draw rooms from. It reads the .dd2vtt file Dungeon Alchemist exports beside a map.');
    text = read.text;
  }
  let would = null, c = null, derived = null, size = null;
  const edit = await mcpEditMap(s, 'loading a floor plan onto it', ['plan', 'rooms', 'lights', 'grid'], d => {
    const plan = text || d.floorPlan;
    if (!plan) return 'Not done: "' + s.name + '" has no floor plan stored with it. Give path: the full path of its .dd2vtt file.';
    derived = describePlan(plan);
    if (!derived) return 'Not done: the floor plan stored with "' + s.name + '" draws no rooms.';
    size = planGridSize(plan, d.mapWidth);
    const grid = size == null ? d.gridConfig : { ...d.gridConfig, cellSize: size };
    const rooms = planPolygons(derived, d.mapWidth, grid);
    const lights = planLightShapes(plan, d.mapWidth, d.nextEffectId);
    c = { name: s.name, roomsNow: d.polygons.length, lightsNow: d.lightShapes.length, rooms: rooms.length,
      doors: rooms.reduce((n, p) => n + (p.doors || []).length, 0), lights: lights.length };
    if ((c.roomsNow || (c.lights && c.lightsNow)) && args.confirmed !== true) { would = mcpPlanWould(c); return would; }
    d.floorPlan = plan;
    d.gridConfig = grid;
    d.polygons = rooms;
    d.nextPolygonId = rooms.length + 1;
    if (lights.length) { d.lightShapes = lights; d.nextEffectId += lights.length; }
    return undefined;
  });
  if (would) return _mcpOk(would);
  if (edit.no) return edit.no;
  const open = mcpPlanOpenWalls(derived);
  const gaps = open.length ? ' The plan has ' + open.length + ' open wall' + (open.length === 1 ? '' : 's') + ' (a gap no room closes, so the room behind it was not drawn), at '
    + open.map(o => 'x ' + o.x + '%, y ' + o.y + '%' + (o.gapSquares ? ' (' + o.gapSquares + ' squares)' : '')).join('; ') + '.' : '';
  const replaced = c.roomsNow ? ' It replaced the ' + c.roomsNow + ' room' + (c.roomsNow === 1 ? '' : 's') + ' drawn before.' : '';
  const here = _mcpHolder(s.id) === 'here' ? ' The DM has it open and sees the change now.' : '';
  return mcpDone('loaded the floor plan onto "' + s.name + '"', edit.undo, 'Loaded the floor plan onto "' + s.name + '": ' + mcpPlanParts(c)
    + ', every room hidden.' + (size != null ? ' Grid cell size ' + size + ' px, from the plan.' : '') + replaced + gaps + here);
}

// A module file's text: a PDF through the app's PDF reader, anything else decoded as the import panel decodes it.
async function _mcpModuleFileText(path) {
  const read = await window.electronAPI.readPrepFile(path, 'module');
  if (read.error) return { error: read.error };
  const buf = read.pdf ? null : read.bytes.buffer.slice(read.bytes.byteOffset, read.bytes.byteOffset + read.bytes.byteLength);
  if (read.pdf || _mtIsPdf(buf)) {
    const res = read.pdf ? await window.electronAPI.extractPdfTextPath(path) : await window.electronAPI.extractPdfText(buf);
    if (!res || !res.ok) return { error: 'Could not read that PDF' + (res && res.error ? ': ' + res.error : '.') };
    return { text: res.text, blockText: res.blockText };
  }
  return mtBytesToText(buf);
}

async function _mcpLoadModuleText(args) {
  const path = String(args.path || '');
  if (!path) return _mcpNo('Give path: the full path of a module text file (.txt, .md or .pdf).');
  const read = await _mcpModuleFileText(path);
  if (read.error) return _mcpNo('Nothing was loaded. ' + read.error);
  const name = _mcpFileName(path);
  const prev = { entries: mtEntries, src: mtSourceName };
  const r = mtImportText(read.text, name, read.blockText);
  const ids = r.mon.added.map(e => e.id);
  const stored = r.n > 0 && !r.error;
  if (!stored && !ids.length) {
    return _mcpNo('Nothing was loaded. ' + (r.error || 'No numbered locations in that file. Evermist splits the text at headings like "K12. Chapel", so try one chapter at a time.'));
  }
  _mtRenderModal();
  const list = mcpEntryList(mtEntries, '');
  const said = [];
  if (stored) {
    said.push('Loaded ' + r.n + ' module entr' + (r.n === 1 ? 'y' : 'ies') + ' from "' + name + '"' + (prev.entries.length ? ', replacing "' + (prev.src || 'Module text') + '"' : '') + ':\n'
      + list.entries.map(e => '- ' + e.heading + ': ' + e.excerpt).join('\n') + (list.total > list.entries.length ? '\n(' + (list.total - list.entries.length) + ' more; list_module_entries lists them.)' : ''));
  } else said.push('No module entries were loaded: ' + (r.error || 'the file has no numbered locations.'));
  if (ids.length) said.push(ids.length + ' monster(s) added to the bestiary.');
  if (r.mon.skipped) said.push('Skipped ' + r.mon.skipped + ' monster(s) the bestiary already has.');
  if (r.mon.unread.length) said.push('Skipped, not read cleanly: ' + r.mon.unread.join(', ') + '.');
  return mcpDone('loaded module text from "' + name + '"', async () => {
    if (stored) {
      if (prev.entries.length) mtStore(prev.entries, prev.src); else mtClearStored();
      _mtRenderModal();
    }
    if (ids.length) _mcpDropEntries(ids);
  }, said.join('\n'));
}

function _mcpListModuleEntries(args) {
  if (!mtEntries.length) return _mcpNo('No module text is loaded. load_module_text loads one.');
  const list = mcpEntryList(mtEntries, args.query);
  return _mcpOk({ source: mtSourceName, matching: list.total, entries: list.entries });
}

async function _mcpLinkRoom(args) {
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  const s = found.scene;
  if (!mtEntries.length) return _mcpNo('No module text is loaded. load_module_text loads one.');
  const links = Array.isArray(args.links) && args.links.length ? args.links : [{ room: args.room, index: args.index, heading: args.heading }];
  const picks = [];
  for (const l of links) {
    const e = mcpEntryFind(mtEntries, l.heading);
    if (e.error) return _mcpNo('Nothing was linked. ' + e.error);
    picks.push({ link: l, entry: e.entry });
  }
  const done = [], kept = [];
  const edit = await mcpEditMap(s, 'linking its rooms', ['rooms'], d => {
    for (const { link, entry } of picks) {
      const f = mcpRoomFind(d.polygons, link.room, link.index, s.name);
      if (f.error) return 'Nothing was linked. ' + f.error;
      const was = f.room.name || _rpFallbackName(f.room);
      const fill = mcpLinkFill(f.room, entry, _rpFallbackName(f.room), args.replaceNotes === true);
      f.room.name = fill.name;
      f.room.desc = fill.desc;
      done.push('"' + was + '" is now "' + fill.name + '"');
      if (fill.kept) kept.push('"' + fill.name + '"');
    }
    return undefined;
  });
  if (edit.no) return edit.no;
  const keptSaid = kept.length ? ' ' + kept.join(', ') + ' kept the notes already written there; call again with replaceNotes: true to put the module text in their place.' : '';
  return mcpDone('linked ' + done.length + ' room(s) on "' + s.name + '" to module text', edit.undo,
    'Linked on "' + s.name + '": ' + done.join('; ') + '.' + keptSaid);
}

// What an import changes beyond maps, groups and roads, as it is before: the campaign note, module text, the fight
// table, the gallery's picture ids and the backdrop.
async function _mcpZipParts() {
  return { note: notesCampaignGet(), mod: { entries: mtEntries, src: mtSourceName }, fights: JSON.parse(JSON.stringify(cbState)),
    pics: new Set((await galleryStore.all()).map(p => p.id)), backdrop: await worldBackgroundTake() };
}

// The pictures an import added, found once it is done.
async function _mcpZipPictures(before) {
  return (await galleryStore.all()).map(p => p.id).filter(id => !before.has(id));
}

async function _mcpUndoZipParts(rest) {
  const fights = mcpCombatUndoImport(cbState, rest.before.fights);
  if (fights.error) throw Object.assign(new Error(fights.error), { mcpKeep: true });
  const onTv = rest.pics.find(id => galleryOnTv(id));
  if (onTv) throw Object.assign(new Error('A picture the import added is on the TV. Ask the DM to take it down first.'), { mcpKeep: true });
  cbState = fights.state;
  cbSave(); cbRender(); cbFightsTitle();
  for (const id of rest.pics) await galleryDrop(id);
  notesCampaignSet(rest.before.note);
  if (rest.before.mod.entries.length) mtStore(rest.before.mod.entries, rest.before.mod.src); else mtClearStored();
  _mtRenderModal();
  await worldBackgroundPut(rest.before.backdrop);
  if (typeof refreshRoomPanel === 'function') refreshRoomPanel();
}

// Puts back every map the import updated, takes out what it made, and the Campaign as it was.
async function _mcpUndoZip(run, done, snap, rest) {
  const back = done.updated.map(id => run.snapshots.get(id)).filter(Boolean);
  for (const rec of back) {
    const sc = allScenes.find(x => x.id === rec.id);
    const why = sc && _mcpMapBlocked(sc, 'undoing the import');
    if (why) throw Object.assign(new Error(why), { mcpKeep: true });
  }
  if (panesActive && run.created.some(id => paneColumnOf(id))) throw Object.assign(new Error('A map the import made is open in a column. Ask the DM to close the column first.'), { mcpKeep: true });
  const reopen = currentScene && back.some(r => r.id === currentScene.id) ? currentScene.id : null;
  // ⚠ The open map's copy is dropped first, as the import drops it, or an autosave writes it over the record put back.
  if (reopen) { clearTimeout(autoSaveTimer); currentScene = null; }
  for (const rec of back) {
    await sceneStore.putScene(rec);
    const meta = allScenes.find(x => x.id === rec.id);
    if (meta) { meta.name = rec.name; meta.thumbnail = rec.thumbnail; }
    if (thumbURLs.has(rec.id)) { URL.revokeObjectURL(thumbURLs.get(rec.id)); thumbURLs.delete(rec.id); }
  }
  await _mcpRemoveScenes(run.created.filter(id => allScenes.some(x => x.id === id)));
  worldSnapshotPut(snap);
  await _mcpUndoZipParts(rest);
  if (reopen) await switchScene(reopen);
  sceneListChanged();
  _mcpWorldRefresh();
}

async function _mcpImportZip(args) {
  const path = String(args.path || '');
  if (!/\.zip$/i.test(path)) return _mcpNo('Give path: the full path of an Evermist export .zip.');
  if (panesActive) return _mcpNo('Not done: two maps are open in columns. Ask the DM to close the column first.');
  let pre;
  try { pre = await zipImportPreview(path); } catch (err) { return _mcpNo('Nothing changed: "' + _mcpFileName(path) + '" could not be read as an Evermist export. ' + ((err && err.message) || err)); }
  if (!pre) return _mcpNo('Nothing changed: the file holds no maps, or it did not come from Evermist.');
  const updated = pre.updated.map(id => allScenes.find(x => x.id === id)).filter(Boolean);
  for (const sc of updated) {
    const why = _mcpMapBlocked(sc, 'importing over it');
    if (why) return _mcpNo(why);
  }
  const would = mcpZipWould({ ...pre, updated: updated.map(x => x.name) });
  if (pre.replacesVideo.length) return _mcpNo(would);
  const nothing = !pre.added.length && !updated.length && !(pre.places.added + pre.places.updated + pre.roads.added + pre.roads.updated);
  if (args.confirmed !== true || nothing) return _mcpOk(would);
  const snap = worldSnapshotTake(), before = await _mcpZipParts(), said = [];
  const got = await restoreFromZipPath(path, d => said.push(d.title + '. ' + d.message));
  if (!got) return _mcpNo('Nothing was imported: the DM stopped it, or it failed, and the maps are as they were. ' + said.join('\n\n'));
  const pics = await _mcpZipPictures(before.pics);
  return mcpDone('imported "' + _mcpFileName(path) + '"', async () => _mcpUndoZip(got.run, got.done, snap, { before, pics }),
    'Imported "' + _mcpFileName(path) + '".\n\n' + said.join('\n\n') + '\n\nUndo puts back the maps, the Campaign, the campaign note, module text, fights, pictures and backdrop as they were.');
}

const MCP_IMPORT_TOOLS = { load_floor_plan: _mcpLoadFloorPlan, load_module_text: _mcpLoadModuleText,
  list_module_entries: _mcpListModuleEntries, link_room: _mcpLinkRoom, import_maps_zip: _mcpImportZip };
