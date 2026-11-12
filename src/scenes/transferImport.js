'use strict';
// transferImport.js — Import: one .zip merged into the library (Electron-only). A scene both machines hold is
// updated part by part (transferPlan.js), a new one is added, and nothing is written until the whole plan is
// made. A stopped import puts every record back and deletes only what it created.

const TI_SAFE_ID = /^[0-9a-zA-Z_-]+$/;

function _tiMint() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function _tiRestoredPos(raw, shift) {
  const p = wmCleanPos(raw);
  return p ? { x: p.x + shift.dx, y: p.y + shift.dy } : undefined;
}

function _tiPictures(list, buffers) {
  const out = {};
  for (const p of Array.isArray(list) ? list : []) {
    const name = p && pictureZipName(p.id, p.type);
    if (name && buffers && buffers[name]) out[p.id] = new Blob([buffers[name]], { type: pictureType(p.type) });
  }
  return out;
}

function _tiLocalPlaces() {
  const all = worldPlacesExport(), notes = notesPlacesAll();
  return Object.keys(all).map(name => ({ name, rec: all[name], note: notes[name] || '' }));
}

function _tiRoadMap(roads, notes) {
  const out = Object.create(null);
  for (const k of Object.keys(roads)) out[k] = { rec: roads[k], note: notes[k] || '' };
  return out;
}

// The file's places and roads as the plan reads them, and what in the file was unreadable.
function _tiRead(raw) {
  const shapes = wmParseShapes(raw), notes = notesParsePlaces(raw), roads = wrParseRoads(raw), roadNotes = notesParseRoadNotes(raw);
  return {
    places: Object.keys(shapes.shapes).map(name => ({ name, rec: shapes.shapes[name], note: notes.places[name] || '' })),
    roads: _tiRoadMap(roads.roads, roadNotes.notes),
    broken: { places: shapes.broken, placeNotes: notes.broken, roads: roads.broken, roadNotes: roadNotes.broken },
  };
}

// The campaign note edited later wins (notesPickCampaign), and one that replaces text written here is reported
// in `over`. The places and roads follow the plan.
async function _tiAdoptCampaign(raw, readFailed, plans, shift, items, noNotes, say, mentions, over) {
  const parsed = notesParseCampaign(raw);
  parsed.text = mentions.remap(parsed.text);
  const merged = notesPickCampaign(notesCampaignGet(), notesCampaignAt(), parsed.text, parsed.at, plans.moment);
  if (merged.replaced) over.push({ scene: t('Campaign'), room: '', part: 'notes' });
  if (merged.text !== notesCampaignGet()) notesCampaignSet(merged.text, merged.at);
  const sceneMap = Object.create(null);
  for (const s of allScenes) sceneMap[s.id] = s.id;
  for (const x of items) sceneMap[x.entry.id] = x.id;
  tiAdoptWorld(raw, plans, shift, sceneMap, mentions.groupUids);
  const entries = notesParseEntries(raw);
  notesEntriesAdopt(entries.entries.map(e => (e && typeof e.note === 'string' ? { ...e, note: mentions.remap(e.note) } : e)), notesParseGone(raw).entries);
  notesOrderImport(raw, mentions.maps, mentions.groupRemap);
  if (typeof refreshRoomPanel === 'function') refreshRoomPanel();

  const nl = String.fromCharCode(10), b = plans.broken, parts = [];
  if (noNotes.length) parts.push(t('These maps had notes Evermist could not read, so they came back without them:') + nl + noNotes.join(nl));
  if (parsed.broken || readFailed) parts.push(t('The campaign notes in this file could not be read, so yours stay as they are.'));
  else if (merged.tooLong) parts.push(t('The campaign notes in this file would not fit beside yours, so yours stay as they are.'));
  if (b.places) parts.push(t('Some group outlines in this file could not be read, so those groups are left out.'));
  if (b.roads) parts.push(t('Some roads in this file could not be read, so they are left out.'));
  if (b.roadNotes) parts.push(t('Some road notes in this file could not be read, so those roads came without them.'));
  if (entries.broken) parts.push(t('The factions and lore in this file could not be read, so they are left out.'));
  if (b.placeNotes) parts.push(t('Some group notes in this file could not be read, so those groups came without them.'));
  if (mentions.skipped()) parts.push(t.plural(mentions.skipped(), '{n} link in the imported notes still points at the old map or group, because its note is full.', '{n} links in the imported notes still point at the old map or group, because their notes are full.'));
  if (parts.length) say({ title: 'Some notes were not imported', message: parts.join(nl + nl) });
}

// The places, roads and party marker of a campaign.json, as Import and sync both take them in. `sceneMap` is { id: id }
// for the maps a road's end or the marker may keep.
function tiAdoptWorld(raw, plans, shift, sceneMap, groupUids) {
  // Before the places come in: a rename there moves the uid with its group.
  mxGroupUidsWrite(groupUids);
  worldPlacesImport(plans.places, shift.dx, shift.dy);
  const placeSet = Object.create(null);
  for (const r of worldPlaceRecords()) placeSet[r.name] = true;
  worldRoadsImport(plans.roads, sceneMap, placeSet, shift.dx, shift.dy);
  worldPartyImport(wptParse(raw), sceneMap, shift.dx, shift.dy);
}

// What the DM is told: counts first, then each edit the file overwrote, by scene and room.
function _tiReport(r) {
  const nl = String.fromCharCode(10), lines = [];
  const n = (count, one, many) => { if (count) lines.push(t.plural(count, one, many)); };
  n(r.added.length, '{n} map added', '{n} maps added');
  n(r.updated.length, '{n} map updated', '{n} maps updated');
  n(r.kept.length, '{n} map kept newer edits made here', '{n} maps kept newer edits made here');
  n(r.places.added + r.places.updated, '{n} group changed', '{n} groups changed');
  n(r.roads.added + r.roads.updated, '{n} road changed', '{n} roads changed');
  if (!lines.length) lines.push(t('Everything in the file was already here.'));
  const over = r.overwritten.map(o => o.scene + (o.room ? ' - ' + o.room : '') + ': ' + t(TP_PART_LABEL[o.part] || o.part));
  if (over.length) lines.push('', t('Edits made here that the file replaced with newer ones:'), ...over);
  return lines.join(nl);
}

// A mention follows what it names: a map the import gives a new id, its rooms, and a group the library already holds
// under another uid. `remap(text)` rewrites a note and counts the mentions a full note could not take.
function _tiMentions(raw, items, incoming, moment) {
  const maps = Object.create(null);
  for (const x of items) if (x.entry && x.entry.id !== x.id) maps[x.entry.id] = x.id;
  const first = tpMergePlaces(_tiLocalPlaces(), incoming.places, moment);
  const renames = first.update.filter(u => u.rename).map(u => ({ from: u.name, to: u.rename }));
  const merged = mpGroupUidsMerge(mxGroupUids(), mpParseGroupUids(raw), renames);
  let skipped = 0;
  const remap = text => {
    if (typeof text !== 'string') return text;
    const r = mpRemap(text, maps, merged.remap, notesCap());
    skipped += r.skipped;
    return r.text;
  };
  for (const p of incoming.places) p.note = remap(p.note);
  for (const k of Object.keys(incoming.roads)) incoming.roads[k].note = remap(incoming.roads[k].note);
  return { remap, skipped: () => skipped, groupUids: merged.keep, maps, groupRemap: merged.remap };
}

// A campaign.json's places and roads against the library's, nothing written: the mentions remapped first, then the plan.
function tiWorldPlan(raw, items, moment) {
  const incoming = _tiRead(raw), gone = notesParseGone(raw);
  const mentions = _tiMentions(raw, items, incoming, moment);
  const plans = {
    places: tpMergePlaces(_tiLocalPlaces(), incoming.places, moment, { here: worldPlacesGone(), file: gone.places }),
    roads: tpMergeRoads(_tiRoadMap(worldRoadsExport(), notesRoadsAll()), incoming.roads, moment, { here: worldRoadsGone(), file: gone.roads }),
    broken: incoming.broken,
  };
  return { mentions, plans, gone };
}

// Everything read and decided before anything is written: the file's scenes against the library, the places
// and roads, and where new things land.
async function _tiPlan(zipPath, manifest) {
  const moment = Date.now();
  let raw = null, readFailed = false;
  try { raw = await window.electronAPI.readBackupCampaign(zipPath); } catch (err) {
    console.error('Reading the campaign notes from the file failed:', err);
    readFailed = true;
  }
  const existing = allScenes, noNotes = [];
  const items = tpSceneIds(manifest, new Set(existing.map(s => s.id)), id => TI_SAFE_ID.test(id), _tiMint);
  const { mentions, plans } = tiWorldPlan(raw, items, moment);
  for (const x of items) {
    const local = x.matched ? await sceneStore.loadScene(x.id) : null;
    if (x.matched && !local) x.matched = false;
    const n = notesSanitize(x.entry.notes);
    if (n.dropped) noNotes.push(x.entry.name || t('Imported Map'));
    const polygons = Array.isArray(x.entry.polygons) ? x.entry.polygons.map(p => (p && typeof p.desc === 'string' ? { ...p, desc: mentions.remap(p.desc) } : p)) : x.entry.polygons;
    x.entry = { ...x.entry, polygons, notes: n.dropped && local ? local.notes : mentions.remap(n.text) };
    if (!local) continue;
    const missing = x.entry.mapType === 'video' ? !(await window.electronAPI.getVideoFilePath(x.id)) : !local.mapBlob;
    x.local = local;
    x.plan = tpMergeScene(local, x.entry, moment, { localMapMissing: missing });
  }
  // ⚠ BESIDE ONLY WHEN NOTHING MATCHED: a matched layout is the same layout, and moving it would split it.
  const matchedAny = items.some(x => x.matched) || plans.places.matched || plans.roads.matched;
  const shift = matchedAny ? { dx: 0, dy: 0 }
    : wmBesideOffset(existing.filter(s => wmCleanPos(s.worldPos)).map(s => s.worldPos), manifest.map(e => wmCleanPos(e && e.worldPos)).filter(Boolean));
  return { moment, raw, readFailed, items, plans, shift, noNotes, mentions };
}

// The scene's own map, fog and thumbnail come out of the zip only where the plan takes them.
function _tiExtract(zipPath, x) {
  const take = x.matched ? x.plan.take : null;
  return window.electronAPI.extractBackupScene(zipPath, {
    newId: x.id, originalId: x.entry.id,
    mapType: x.entry.mapType || 'image', mapExt: x.entry.mapExt || '.jpg',
    pictures: (Array.isArray(x.entry.pictures) ? x.entry.pictures : []).map(p => p && pictureZipName(p.id, p.type)).filter(Boolean),
    want: take ? { map: take.map, fog: take.fog, thumb: take.map || take.fog } : undefined,
    temp: !!take && x.entry.mapType === 'video',
  });
}

// A matched scene: the local record with what the plan takes written over it.
function _tiMatchedRecord(x, got, run) {
  const e = x.entry, take = x.plan.take;
  const pictures = _tiPictures(e.pictures, got.pictures);
  const rec = { ...tpExtraFields(e), ...x.local, ...x.plan.record, pictureBlobs: { ...pictures, ...(x.local.pictureBlobs || {}) } };
  if (take.fog && got.fogBuffer) { rec.baseFogBlob = new Blob([got.fogBuffer], { type: 'image/png' }); delete rec.baseFogPNG; }
  if (got.thumbBuffer && (take.map || take.fog)) rec.thumbnail = new Blob([got.thumbBuffer], { type: 'image/jpeg' });
  if (take.map) {
    const size = { mapWidth: e.mapWidth, mapHeight: e.mapHeight };
    if (e.mapType === 'video' && got.mapWritten) {
      run.toSettle.push({ id: x.id, ext: e.mapExt || '.webm' });
      Object.assign(rec, size, { mapType: 'video', mapPath: `maps/${x.id}${e.mapExt || '.webm'}`, mapBlob: undefined });
    } else if (e.mapType !== 'video' && got.mapBuffer) {
      Object.assign(rec, size, { mapType: 'image', mapPath: undefined, mapBlob: new Blob([got.mapBuffer], { type: e.mapMimeType || 'image/jpeg' }) });
    }
  }
  if (rec.floorPlan === undefined) { rec.floorPlan = e.floorPlan; rec.floorPlanName = e.floorPlanName; }
  if (take.place) { rec.group = sanitizeGroupName(rec.group); rec.worldPos = _tiRestoredPos(rec.worldPos, { dx: 0, dy: 0 }); }
  return rec;
}

// A scene the library did not hold, as the file has it, at the end of the order.
function _tiNewRecord(x, got, name, order, shift) {
  const e = x.entry;
  const mapPath = e.mapType === 'video' && got.mapWritten !== false ? `maps/${x.id}${e.mapExt || '.webm'}` : undefined;
  return {
    ...tpExtraFields(e),
    id: x.id, name, group: e.group || '', worldPos: _tiRestoredPos(e.worldPos, shift),
    mapType: e.mapType || 'image', mapWidth: e.mapWidth || 0, mapHeight: e.mapHeight || 0,
    mapBlob: e.mapType !== 'video' && got.mapBuffer ? new Blob([got.mapBuffer], { type: e.mapMimeType || 'image/jpeg' }) : undefined, mapPath,
    polygons: esWithUids(e.polygons), nextPolygonId: e.nextPolygonId || 1, notes: e.notes, pictureBlobs: _tiPictures(e.pictures, got.pictures),
    effects: esWithUids(e.effects), nextEffectId: e.nextEffectId || 1,
    lightsHidden: !!e.lightsHidden, lightShapes: e.lightShapes || [], floorPlan: e.floorPlan, floorPlanName: e.floorPlanName,
    baseFogBlob: got.fogBuffer ? new Blob([got.fogBuffer], { type: 'image/png' }) : null, gridConfig: e.gridConfig || {}, fogSettings: e.fogSettings, fogTheme: e.fogTheme, weather: e.weather, timeOfDay: e.timeOfDay, tvFit: e.tvFit,
    thumbnail: got.thumbBuffer ? new Blob([got.thumbBuffer], { type: 'image/jpeg' }) : null,
    createdAt: e.createdAt || Date.now(), sortOrder: order, edits: e.edits && typeof e.edits === 'object' ? e.edits : undefined,
  };
}

// Every scene extracted and written, in the file's order. Answers what happened to each, or null once the DM stopped it.
// ⚠ ONE SCENE AT A TIME, its buffers dropped once saved: the whole library at once kills the renderer.
async function _tiWrite(zipPath, plan, run, job) {
  const existing = allScenes, usedNames = new Set(existing.map(s => s.name));
  let order = existing.length ? Math.max(...existing.map(s => s.sortOrder ?? 0)) : -1;
  const out = { noMap: [], newMeta: [], pictured: [], added: [], updated: [], kept: [], overwritten: [] };
  for (let i = 0; i < plan.items.length; i++) {
    if (job.stopped) return null;
    const x = plan.items[i], got = await _tiExtract(zipPath, x);
    if (job.stopped) return null;
    if (x.matched) {
      run.snapshots.set(x.id, x.local);
      const rec = _tiMatchedRecord(x, got, run);
      await sceneStore.putScene(rec);
      const meta = existing.find(s => s.id === x.id);
      if (meta) Object.assign(meta, { name: rec.name, thumbnail: rec.thumbnail, group: rec.group || '', worldPos: rec.worldPos });
      if (thumbURLs.has(x.id)) { URL.revokeObjectURL(thumbURLs.get(x.id)); thumbURLs.delete(x.id); }
      out.pictured.push({ polygons: rec.polygons, pictureBlobs: rec.pictureBlobs });
      if (x.plan.touched) out.updated.push(x.id);
      if (x.plan.report.kept.length) out.kept.push(rec.name);
      for (const o of x.plan.report.overwritten) out.overwritten.push({ id: x.id, scene: rec.name, room: o.room, part: o.part });
    } else {
      order++;
      const name = resolveSceneName(x.entry.name || t('Imported Map'), usedNames);
      const scene = _tiNewRecord(x, got, name, order, plan.shift);
      if (x.entry.mapType === 'video' && got.mapWritten === false) out.noMap.push(name);
      await sceneStore.putScene(scene);
      run.created.push(x.id);
      out.added.push(x.id);
      out.pictured.push({ polygons: scene.polygons, pictureBlobs: scene.pictureBlobs });
      out.newMeta.push({ id: x.id, name, group: scene.group, thumbnail: scene.thumbnail, sortOrder: order, createdAt: scene.createdAt, mapType: scene.mapType, worldPos: scene.worldPos });
    }
    updateMapProgress(Math.round(((i + 1) / plan.items.length) * 100));
  }
  return out;
}

// Once the scenes are in: the file's other parts, the open scene reloaded, and the report.
async function _tiFinish(zipPath, plan, done, say, claude) {
  if (done.noMap.length) say({
    title: t.plural(done.noMap.length, 'One map came back without its image', '{n} maps came back without their images'),
    message: t('The file carried no image for these, so they came in empty. Everything else came in:') + String.fromCharCode(10, 10) + done.noMap.join(String.fromCharCode(10)),
  });
  if (done.mapFailed.length) say({
    title: 'A map could not be replaced',
    message: t('The file had a newer image for these maps, but it could not be put in place, so they kept their old one:') + String.fromCharCode(10, 10) + done.mapFailed.join(String.fromCharCode(10)),
  });
  await adoptModuleTextFromZip(zipPath, claude ? say : undefined);
  await adoptCombatFromZip(zipPath, say, plan.mentions.remap);
  await _tiAdoptCampaign(plan.raw, plan.readFailed, { ...plan.plans, moment: plan.moment }, plan.shift, plan.items, plan.noNotes, say, plan.mentions, done.overwritten);
  await worldBackgroundImport(zipPath, plan.shift, plan.moment, say);
  try {
    await galleryAdoptBackup(zipPath, notesParseGone(plan.raw).pictures);
    await galleryAdoptScenes(done.pictured);
  } catch (err) { console.error('Importing the gallery failed:', err); }
  if (done.reopen) await switchScene(done.reopen);
  const names = id => (allScenes.find(s => s.id === id) || {}).name;
  if (done.added.length || done.updated.length) worldMapShowScenes(done.added.concat(done.updated));
  say({
    title: 'Import finished',
    message: _tiReport({
      added: done.added.map(names), updated: done.updated.map(names), kept: done.kept, overwritten: done.overwritten,
      places: { added: plan.plans.places.report.added.length, updated: plan.plans.places.report.updated.length },
      roads: { added: plan.plans.roads.report.added.length, updated: plan.plans.roads.report.updated.length },
    }),
  });
}

// What importing the file would do, nothing written: the names of maps added and updated, the animated maps whose
// video file it would replace, and the group and road counts. Null for a file with no maps.
async function zipImportPreview(zipPath) {
  const manifest = await window.electronAPI.readBackupManifest(zipPath);
  if (!Array.isArray(manifest) || !manifest.length) return null;
  const plan = await _tiPlan(zipPath, manifest);
  const r = plan.plans;
  return {
    added: plan.items.filter(x => !x.matched).map(x => x.entry.name || t('Imported Map')),
    updated: plan.items.filter(x => x.matched && x.plan.touched).map(x => x.id),
    replacesVideo: plan.items.filter(x => x.matched && x.local && x.local.mapType === 'video' && x.plan.take && x.plan.take.map).map(x => x.local.name),
    places: { added: r.places.report.added.length, updated: r.places.report.updated.length },
    roads: { added: r.roads.report.added.length, updated: r.roads.report.updated.length },
  };
}

// Import a zip: the scene "+" button's route in for a .zip, and the world map's Import. Claude passes `say`, which
// takes every dialog instead (a question keeps what is there), and gets back { run, done } once the maps are in.
async function restoreFromZipPath(zipPath, say) {
  const claude = !!say;
  say = say || messageDialog;
  if (!window.electronAPI || !zipPath) return;
  // ⚠ An import rewrites the library underneath whatever is open, and a column holds a scene record this
  // one is about to replace. Back to one map first.
  if (typeof panesActive !== 'undefined' && panesActive) await exitPanes(panes[panesSelected].sceneId);
  // ⚠ A pending delete is finished and the open scene saved first, so the plan reads what the store holds.
  commitPendingDelete();
  await doAutoSave();

  setMapProgressRun('', zipPath.split(/[\\/]/).pop());
  const job = mapJobStart({ title: 'Stop importing?', message: 'Your maps stay as they were before the import.' },
    () => window.electronAPI.cancelBackup());
  // What a stop puts back: matched records as they were, and only what this import created.
  const run = { snapshots: new Map(), created: [], createdVideos: [], temps: [], toSettle: [] };
  let committed = false;   // past this point the scenes are in, and a stop or a failure puts nothing back
  // ⚠ The open scene, when the file updates it, is detached before the first write, so no autosave (a minimise)
  // writes its old copy over the merged record. It comes back from the store however the import ends, or every
  // later edit to it goes unsaved.
  let reopen = null;
  const reattach = async () => { if (reopen && !currentScene) await switchScene(reopen); };
  const undo = async () => {
    for (const [, rec] of run.snapshots) {
      await sceneStore.putScene(rec).catch(err => console.error('[import] undo', err));
      // The card too: the write gave it the file's name, thumbnail, group and spot.
      const meta = allScenes.find(s => s.id === rec.id);
      if (meta) Object.assign(meta, { name: rec.name, thumbnail: rec.thumbnail, group: rec.group || '', worldPos: rec.worldPos });
    }
    for (const id of run.created) await sceneStore.deleteScene(id).catch(err => console.error('[import] undo', err));
    for (const id of run.createdVideos) await window.electronAPI.deleteVideoFile(id);
    for (const x of run.temps) await window.electronAPI.settleImportVideo(x.id, x.ext, false).catch(() => {});
    hideMapProgress();
    sceneListChanged();
    await reattach();
  };
  showMapProgress('Reading export…');
  try {
    const manifest = await window.electronAPI.readBackupManifest(zipPath);
    if (!Array.isArray(manifest) || !manifest.length) {
      hideMapProgress();
      say({ title: 'Nothing in this file', message: 'The file holds no maps, or it did not come from Evermist.' });
      return;
    }
    const plan = await _tiPlan(zipPath, manifest);
    if (job.stopped) return undo();
    reopen = currentScene && plan.items.some(x => x.matched && x.plan.touched && x.id === currentScene.id) ? currentScene.id : null;
    if (reopen) { clearTimeout(autoSaveTimer); currentScene = null; await autoSavesSettled(); }
    showMapProgress('Extracting maps…');
    updateMapProgress(0);
    for (const x of plan.items) if (x.matched && x.entry.mapType === 'video' && x.plan.take.map) run.temps.push({ id: x.id, ext: x.entry.mapExt || '.webm' });
    // Before extraction writes them, so a stop or a failure partway deletes every new animated map's file.
    for (const x of plan.items) if (!x.matched && x.entry.mapType === 'video') run.createdVideos.push(x.id);
    const done = await _tiWrite(zipPath, plan, run, job);
    if (!done || job.stopped) return undo();
    committed = true;
    // A rename that fails (a video being played) puts that scene's whole record back, so record and file agree
    // and the rooms and fog stay with the map they were drawn on. The report then leaves it out.
    done.mapFailed = [];
    for (const x of run.toSettle) {
      try { await window.electronAPI.settleImportVideo(x.id, x.ext, true); } catch (err) {
        console.error('[import] settle', err);
        const old = run.snapshots.get(x.id), meta = allScenes.find(s => s.id === x.id);
        await sceneStore.putScene(old);
        await window.electronAPI.settleImportVideo(x.id, x.ext, false).catch(() => {});
        if (meta) Object.assign(meta, { name: old.name, thumbnail: old.thumbnail, group: old.group || '', worldPos: old.worldPos });
        done.updated = done.updated.filter(id => id !== x.id);
        done.overwritten = done.overwritten.filter(o => o.id !== x.id);
        done.mapFailed.push(old.name);
      }
    }
    done.reopen = reopen;
    mapJobEnd(job);
    allScenes.push(...done.newMeta);
    allScenes.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    sceneListChanged();
    hideMapProgress();
    await _tiFinish(zipPath, plan, done, say, claude);
    return { run, done };
  } catch (err) {
    if (job.stopped && !committed) return undo();
    hideMapProgress();
    console.error('Import failed:', err);
    if (!committed) await undo();
    else await reattach();
    say({
      title: 'Import failed',
      message: (committed ? t('The maps came in, but Evermist stopped before the rest of the file.')
                          : t('Evermist stopped partway through the file and put your maps back as they were.')) + '\n\n' + (err.message || err),
    });
  } finally {
    mapJobEnd(job);
    setMapProgressRun('');
  }
}
