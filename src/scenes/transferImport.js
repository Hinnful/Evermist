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

// The campaign note joins below the DM's own, as it always has. The places and roads follow the plan.
async function _tiAdoptCampaign(raw, readFailed, plans, shift, items, noNotes) {
  const parsed = notesParseCampaign(raw);
  const merged = notesMergeCampaign(notesCampaignGet(), parsed.text);
  if (merged.text !== notesCampaignGet()) notesCampaignSet(merged.text);
  worldPlacesImport(plans.places, shift.dx, shift.dy);
  const names = new Set(worldPlaceRecords().map(r => r.name));
  const placeSet = Object.create(null);
  for (const n of names) placeSet[n] = true;
  const sceneMap = Object.create(null);
  for (const s of allScenes) sceneMap[s.id] = s.id;
  for (const x of items) sceneMap[x.entry.id] = x.id;
  worldRoadsImport(plans.roads, sceneMap, placeSet, shift.dx, shift.dy);
  if (typeof refreshRoomPanel === 'function') refreshRoomPanel();

  const nl = String.fromCharCode(10), b = plans.broken, parts = [];
  if (noNotes.length) parts.push(t('These scenes had notes Evermist could not read, so they came back without them:') + nl + noNotes.join(nl));
  if (parsed.broken || readFailed) parts.push(t('The campaign notes in this file could not be read, so yours stay as they are.'));
  else if (merged.tooLong) parts.push(t('The campaign notes in this file would not fit beside yours, so yours stay as they are.'));
  if (b.places) parts.push(t('Some place outlines in this file could not be read, so those places are left out.'));
  if (b.roads) parts.push(t('Some roads in this file could not be read, so they are left out.'));
  if (b.roadNotes) parts.push(t('Some road notes in this file could not be read, so those roads came without them.'));
  if (b.placeNotes) parts.push(t('Some place notes in this file could not be read, so those places came without them.'));
  if (parts.length) messageDialog({ title: 'Some notes were not imported', message: parts.join(nl + nl) });
}

// What the DM is told: counts first, then each edit the file overwrote, by scene and room.
function _tiReport(r) {
  const nl = String.fromCharCode(10), lines = [];
  const n = (count, one, many) => { if (count) lines.push(t.plural(count, one, many)); };
  n(r.added.length, '{n} scene added', '{n} scenes added');
  n(r.updated.length, '{n} scene updated', '{n} scenes updated');
  n(r.kept.length, '{n} scene kept newer edits made here', '{n} scenes kept newer edits made here');
  n(r.places.added + r.places.updated, '{n} place changed', '{n} places changed');
  n(r.roads.added + r.roads.updated, '{n} road changed', '{n} roads changed');
  if (!lines.length) lines.push(t('Everything in the file was already here.'));
  const over = r.overwritten.map(o => o.scene + (o.room ? ' - ' + o.room : '') + ': ' + t(TP_PART_LABEL[o.part] || o.part));
  if (over.length) lines.push('', t('Edits made here that the file replaced with newer ones:'), ...over);
  return lines.join(nl);
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
  const incoming = _tiRead(raw);
  const existing = allScenes, noNotes = [];
  const items = tpSceneIds(manifest, new Set(existing.map(s => s.id)), id => TI_SAFE_ID.test(id), _tiMint);
  for (const x of items) {
    const local = x.matched ? await sceneStore.loadScene(x.id) : null;
    if (x.matched && !local) x.matched = false;
    const n = notesSanitize(x.entry.notes);
    if (n.dropped) noNotes.push(x.entry.name || t('Imported Scene'));
    x.entry = { ...x.entry, notes: n.dropped && local ? local.notes : n.text };
    if (!local) continue;
    const missing = x.entry.mapType === 'video' ? !(await window.electronAPI.getVideoFilePath(x.id)) : !local.mapBlob;
    x.local = local;
    x.plan = tpMergeScene(local, x.entry, moment, { localMapMissing: missing });
  }
  const plans = {
    places: tpMergePlaces(_tiLocalPlaces(), incoming.places, moment),
    roads: tpMergeRoads(_tiRoadMap(worldRoadsExport(), notesRoadsAll()), incoming.roads, moment),
    broken: incoming.broken,
  };
  // ⚠ BESIDE ONLY WHEN NOTHING MATCHED: a matched layout is the same layout, and moving it would split it.
  const matchedAny = items.some(x => x.matched) || plans.places.matched || plans.roads.matched;
  const shift = matchedAny ? { dx: 0, dy: 0 }
    : wmBesideOffset(existing.filter(s => wmCleanPos(s.worldPos)).map(s => s.worldPos), manifest.map(e => wmCleanPos(e && e.worldPos)).filter(Boolean));
  return { moment, raw, readFailed, items, plans, shift, noNotes };
}

// The scene's own map, fog and thumbnail come out of the zip only where the plan takes them.
async function _tiExtract(zipPath, items) {
  const got = await window.electronAPI.extractBackupScenes(zipPath, items.map(x => {
    const take = x.matched ? x.plan.take : null;
    return {
      newId: x.id, originalId: x.entry.id,
      mapType: x.entry.mapType || 'image', mapExt: x.entry.mapExt || '.jpg',
      pictures: (Array.isArray(x.entry.pictures) ? x.entry.pictures : []).map(p => p && pictureZipName(p.id, p.type)).filter(Boolean),
      want: take ? { map: take.map, fog: take.fog, thumb: take.map || take.fog } : undefined,
      temp: !!take && x.entry.mapType === 'video',
    };
  }));
  const ex = {};
  got.forEach(e => { ex[e.newId] = e; });
  return ex;
}

// A matched scene: the local record with what the plan takes written over it.
function _tiMatchedRecord(x, got, run) {
  const e = x.entry, take = x.plan.take;
  const pictures = _tiPictures(e.pictures, got.pictures);
  const rec = { ...x.local, ...x.plan.record, pictureBlobs: { ...pictures, ...(x.local.pictureBlobs || {}) } };
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
  if (rec.floorPlan === undefined) rec.floorPlan = e.floorPlan;
  return rec;
}

// A scene the library did not hold, as the file has it, at the end of the order.
function _tiNewRecord(x, got, name, order, shift) {
  const e = x.entry;
  const mapPath = e.mapType === 'video' && got.mapWritten !== false ? `maps/${x.id}${e.mapExt || '.webm'}` : undefined;
  return {
    id: x.id, name, group: e.group || '', worldPos: _tiRestoredPos(e.worldPos, shift),
    mapType: e.mapType || 'image', mapWidth: e.mapWidth || 0, mapHeight: e.mapHeight || 0,
    mapBlob: e.mapType !== 'video' && got.mapBuffer ? new Blob([got.mapBuffer], { type: e.mapMimeType || 'image/jpeg' }) : undefined, mapPath,
    polygons: esWithUids(e.polygons), nextPolygonId: e.nextPolygonId || 1, notes: e.notes, pictureBlobs: _tiPictures(e.pictures, got.pictures),
    effects: esWithUids(e.effects), nextEffectId: e.nextEffectId || 1,
    lightsHidden: !!e.lightsHidden, lightShapes: e.lightShapes || [], floorPlan: e.floorPlan,
    baseFogBlob: got.fogBuffer ? new Blob([got.fogBuffer], { type: 'image/png' }) : null, gridConfig: e.gridConfig || {}, fogSettings: e.fogSettings,
    thumbnail: got.thumbBuffer ? new Blob([got.thumbBuffer], { type: 'image/jpeg' }) : null,
    createdAt: e.createdAt || Date.now(), sortOrder: order, edits: e.edits && typeof e.edits === 'object' ? e.edits : undefined,
  };
}

// Every scene written, in the file's order. Answers what happened to each, or null once the DM stopped it.
async function _tiWrite(plan, ex, run, job) {
  const existing = allScenes, usedNames = new Set(existing.map(s => s.name));
  let order = existing.length ? Math.max(...existing.map(s => s.sortOrder ?? 0)) : -1;
  const out = { noMap: [], newMeta: [], pictured: [], added: [], updated: [], kept: [], overwritten: [] };
  showMapProgress('Saving scenes…');
  updateMapProgress(0);
  for (let i = 0; i < plan.items.length; i++) {
    if (job.stopped) return null;
    const x = plan.items[i], got = ex[x.id] || {};
    if (x.matched) {
      run.snapshots.set(x.id, x.local);
      const rec = _tiMatchedRecord(x, got, run);
      await sceneStore.putScene(rec);
      const meta = existing.find(s => s.id === x.id);
      if (meta) { meta.name = rec.name; meta.thumbnail = rec.thumbnail; }
      if (thumbURLs.has(x.id)) { URL.revokeObjectURL(thumbURLs.get(x.id)); thumbURLs.delete(x.id); }
      out.pictured.push({ polygons: rec.polygons, pictureBlobs: rec.pictureBlobs });
      if (x.plan.touched) out.updated.push(x.id);
      if (x.plan.report.kept.length) out.kept.push(rec.name);
      for (const o of x.plan.report.overwritten) out.overwritten.push({ scene: rec.name, room: o.room, part: o.part });
    } else {
      order++;
      const name = resolveSceneName(x.entry.name || t('Imported Scene'), usedNames);
      const scene = _tiNewRecord(x, got, name, order, plan.shift);
      if (x.entry.mapType === 'video') { if (got.mapWritten === false) out.noMap.push(name); else run.createdVideos.push(x.id); }
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
async function _tiFinish(zipPath, plan, done) {
  if (done.noMap.length) messageDialog({
    title: t.plural(done.noMap.length, 'One scene came back without its map', '{n} scenes came back without their maps'),
    message: t('The file carried no map for these, so they came in empty. Everything else came in:') + String.fromCharCode(10, 10) + done.noMap.join(String.fromCharCode(10)),
  });
  if (done.mapFailed.length) messageDialog({
    title: 'A map could not be replaced',
    message: t('The file had a newer map for these scenes, but it could not be put in place, so they kept their old map:') + String.fromCharCode(10, 10) + done.mapFailed.join(String.fromCharCode(10)),
  });
  await adoptModuleTextFromZip(zipPath);
  await adoptCombatFromZip(zipPath);
  await _tiAdoptCampaign(plan.raw, plan.readFailed, plan.plans, plan.shift, plan.items, plan.noNotes);
  await worldBackgroundImport(zipPath, plan.shift, plan.moment);
  try {
    await galleryAdoptBackup(zipPath);
    await galleryAdoptScenes(done.pictured);
  } catch (err) { console.error('Importing the gallery failed:', err); }
  if (done.reopen) await switchScene(done.reopen);
  const names = id => (allScenes.find(s => s.id === id) || {}).name;
  if (done.added.length || done.updated.length) worldMapShowScenes(done.added.concat(done.updated));
  messageDialog({
    title: 'Import finished',
    message: _tiReport({
      added: done.added.map(names), updated: done.updated.map(names), kept: done.kept, overwritten: done.overwritten,
      places: { added: plan.plans.places.report.added.length, updated: plan.plans.places.report.updated.length },
      roads: { added: plan.plans.roads.report.added.length, updated: plan.plans.roads.report.updated.length },
    }),
  });
}

// Import a zip: the scene "+" button's route in for a .zip, and the world map's Import.
async function restoreFromZipPath(zipPath) {
  if (!window.electronAPI || !zipPath) return;
  // ⚠ An import rewrites the library underneath whatever is open, and a column holds a scene record this
  // one is about to replace. Back to one map first.
  if (typeof panesActive !== 'undefined' && panesActive) await exitPanes(panes[panesSelected].sceneId);
  // ⚠ A pending delete is finished and the open scene saved first, so the plan reads what the store holds.
  commitPendingDelete();
  await doAutoSave();

  const unsubProgress = window.electronAPI.onBackupProgress(({ done, total }) => updateMapProgress(Math.round((done / total) * 100)));
  setMapProgressRun('', zipPath.split(/[\\/]/).pop());
  const job = mapJobStart({ title: 'Stop importing?', message: 'Your scenes stay as they were before the import.' },
    () => window.electronAPI.cancelBackup());
  // What a stop puts back: matched records as they were, and only what this import created.
  const run = { snapshots: new Map(), created: [], createdVideos: [], temps: [], toSettle: [] };
  let committed = false;   // past this point the scenes are in, and a stop or a failure puts nothing back
  const undo = async () => {
    for (const [, rec] of run.snapshots) await sceneStore.putScene(rec).catch(err => console.error('[import] undo', err));
    for (const id of run.created) await sceneStore.deleteScene(id).catch(err => console.error('[import] undo', err));
    for (const id of run.createdVideos) await window.electronAPI.deleteVideoFile(id);
    for (const x of run.temps) await window.electronAPI.settleImportVideo(x.id, x.ext, false).catch(() => {});
    hideMapProgress();
  };
  showMapProgress('Reading export…');
  try {
    const manifest = await window.electronAPI.readBackupManifest(zipPath);
    if (!Array.isArray(manifest) || !manifest.length) {
      hideMapProgress();
      messageDialog({ title: 'Nothing in this file', message: 'The file holds no scenes, or it did not come from Evermist.' });
      return;
    }
    const plan = await _tiPlan(zipPath, manifest);
    if (job.stopped) return undo();
    showMapProgress('Extracting scenes…');
    updateMapProgress(0);
    for (const x of plan.items) if (x.matched && x.entry.mapType === 'video' && x.plan.take.map) run.temps.push({ id: x.id, ext: x.entry.mapExt || '.webm' });
    const ex = await _tiExtract(zipPath, plan.items);
    if (job.stopped) return undo();
    const done = await _tiWrite(plan, ex, run, job);
    if (!done || job.stopped) return undo();
    committed = true;
    // A rename that fails (a video being played) puts that scene's record back, so record and file agree.
    done.mapFailed = [];
    for (const x of run.toSettle) {
      try { await window.electronAPI.settleImportVideo(x.id, x.ext, true); } catch (err) {
        console.error('[import] settle', err);
        await sceneStore.putScene(run.snapshots.get(x.id));
        await window.electronAPI.settleImportVideo(x.id, x.ext, false).catch(() => {});
        done.mapFailed.push(allScenes.find(s => s.id === x.id).name);
      }
    }
    // ⚠ The open scene's in-memory copy is dropped now, so no autosave in the awaits that follow can write it
    // over the merged record. _tiFinish reloads it from the store.
    done.reopen = currentScene && done.updated.includes(currentScene.id) ? currentScene.id : null;
    if (done.reopen) { clearTimeout(autoSaveTimer); currentScene = null; }
    mapJobEnd(job);
    allScenes.push(...done.newMeta);
    allScenes.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    sceneListChanged();
    hideMapProgress();
    await _tiFinish(zipPath, plan, done);
  } catch (err) {
    if (job.stopped && !committed) return undo();
    hideMapProgress();
    console.error('Import failed:', err);
    if (!committed) await undo();
    messageDialog({
      title: 'Import failed',
      message: (committed ? t('The scenes came in, but Evermist stopped before the rest of the file.')
                          : t('Evermist stopped partway through the file and put your scenes back as they were.')) + '\n\n' + (err.message || err),
    });
  } finally {
    mapJobEnd(job);
    setMapProgressRun('');
    unsubProgress();
  }
}
