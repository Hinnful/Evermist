'use strict';

// backup.js — zip-based backup export and restore (Electron-only). Every IPC call needs
// window.electronAPI, and the app globals resolve lazily.

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveSceneName(desiredName, usedNames) {
  if (!usedNames.has(desiredName)) { usedNames.add(desiredName); return desiredName; }
  let n = 2;
  while (usedNames.has(`${desiredName} (${n})`)) n++;
  const name = `${desiredName} (${n})`;
  usedNames.add(name);
  return name;
}

function mapExtFromScene(scene) {
  if (scene.mapType === 'video') {
    const m = (scene.mapPath || '').match(/\.[^.]+$/);
    return m ? m[0] : '.webm';
  }
  const t = scene.mapBlob && scene.mapBlob.type ? scene.mapBlob.type : 'image/jpeg';
  if (t.includes('png')) return '.png';
  if (t.includes('gif')) return '.gif';
  return '.jpg';
}

async function blobToArrayBuffer(blob) {
  if (!blob) return null;
  return blob.arrayBuffer();
}

async function dataURLToArrayBuffer(dataURL) {
  try {
    const resp = await fetch(dataURL);
    return resp.arrayBuffer();
  } catch { return null; }
}

// ── Export logic ──────────────────────────────────────────────────────────────

// Scene SELECTION is the caller's job: it passes the ids straight in. `opts.partial` keeps only the places,
// roads and notes that belong to those scenes (worldPickPlan.js), and leaves the campaign note out.
async function doExport(selectedIds, opts) {
  if (!window.electronAPI) return;

  const now = new Date();
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const destPath = await window.electronAPI.showSaveDialog({
    title: t('Save Backup'),
    defaultPath: `evermist-backup-${ymd}.zip`,
    filters: [{ name: 'Evermist Backup', extensions: ['zip'] }],
  });
  if (!destPath) return;

  const unsubProgress = window.electronAPI.onBackupProgress(({ done, total }) => {
    updateMapProgress(Math.round((done / total) * 100));
  });

  setMapProgressRun('', destPath.split(/[\\/]/).pop());
  const job = mapJobStart({ title: 'Stop the backup?', message: 'The unfinished backup file is deleted.' },
    () => window.electronAPI.cancelBackup());
  showMapProgress('Creating backup…');
  try {
    // ⚠ The open scene saves 5s after its last edit, and the zip is read from the store.
    if (currentScene && selectedIds.includes(currentScene.id)) await doAutoSave();
    const scenesData = [];
    for (const id of selectedIds) {
      if (job.stopped) break;
      const scene = await sceneStore.loadScene(id);
      if (!scene) continue;

      const mapExt = mapExtFromScene(scene);
      const mapBuffer = scene.mapType !== 'video' ? await blobToArrayBuffer(scene.mapBlob) : null;

      let fogBuffer = null;
      if (scene.baseFogBlob) {
        fogBuffer = await blobToArrayBuffer(scene.baseFogBlob);
      } else if (scene.baseFogPNG) {
        fogBuffer = await dataURLToArrayBuffer(scene.baseFogPNG);
      }

      const thumbBuffer = await blobToArrayBuffer(scene.thumbnail);

      const picList = pictureBackupList(scene.polygons, scene.pictureBlobs || {});
      const pictures = [];
      for (const p of picList) {
        pictures.push({ name: pictureZipName(p.id, p.type), buffer: await blobToArrayBuffer(scene.pictureBlobs[p.id]) });
      }

      const mapMimeType = scene.mapBlob
        ? (scene.mapBlob.type || 'image/jpeg')
        : (mapExt === '.mp4' ? 'video/mp4' : 'video/webm');

      scenesData.push({
        id: scene.id,
        mapType: scene.mapType || 'image',
        mapExt,
        metadata: {
          id:            scene.id,
          name:          scene.name,
          group:         scene.group || '',
          worldPos:      scene.worldPos,
          mapType:       scene.mapType || 'image',
          mapWidth:      scene.mapWidth,
          mapHeight:     scene.mapHeight,
          mapMimeType,
          mapExt,
          polygons:      scene.polygons || [],
          nextPolygonId: scene.nextPolygonId || 1,
          notes:         scene.notes,
          pictures:      picList,
          effects:       scene.effects || [],
          nextEffectId:  scene.nextEffectId || 1,
          lightsHidden:  !!scene.lightsHidden,
          lightShapes:   scene.lightShapes || [],
          // ⚠ A WHITELIST: a field missing from it is silently dropped on export. The floor plan
          // has to survive, or a restored scene loses its Draw Rooms button.
          floorPlan:     scene.floorPlan,
          gridConfig:    scene.gridConfig || {},
          fogSettings:   scene.fogSettings,
          createdAt:     scene.createdAt || 0,
          sortOrder:     scene.sortOrder || 0,
        },
        mapBuffer,
        fogBuffer,
        thumbBuffer,
        pictures,
      });
    }

    if (!scenesData.length || job.stopped) { hideMapProgress(); return; }

    // The module text is CAMPAIGN-level, so it goes in once at the zip root, not per scene. Null
    // when nothing is loaded, and the zip then looks exactly as it always did.
    const moduleTextJson = typeof mtBackupPayload === 'function' ? mtBackupPayload() : null;

    const combatJson = typeof cbBackupPayload === 'function' ? cbBackupPayload() : null;
    const sub = opts && opts.partial
      ? wpSubset(selectedIds, allScenes.map(s => ({ id: s.id, group: sanitizeGroupName(s.group) })), worldPlacesExport(), worldRoadsExport(), notesPlacesAll(), notesRoadsAll())
      : null;
    const campaignJson = sub
      ? notesCampaignPayload('', sub.placeNotes, sub.shapes, sub.roads, sub.roadNotes)
      : notesCampaignPayload(notesCampaignGet(), notesPlacesAll(), worldPlacesExport(), worldRoadsExport(), notesRoadsAll());
    const worldBg = opts && opts.partial ? null : await worldBackgroundBackupPayload();
    const wrote = await window.electronAPI.createBackupZip(destPath, scenesData, moduleTextJson, combatJson, campaignJson, worldBg);
    hideMapProgress();
    if (wrote && wrote.cancelled) return;
    // ⚠ REPORTED, NEVER DROPPED: the record still exports, so the backup looks complete.
    const gone = (wrote && wrote.missingVideos) || [];
    if (gone.length) messageDialog({
      title: t.plural(gone.length, 'One map is not in the backup', '{n} maps are not in the backup'),
      message: t('Everything else was saved. These scenes had no map file left on disk, so they ' +
                 'went into the backup without one:') + String.fromCharCode(10, 10) + gone.join(String.fromCharCode(10)),
    });
  } catch (err) {
    hideMapProgress();
    if (job.stopped) return;
    console.error('Export failed:', err);
    messageDialog({
      title: 'Export failed',
      message: t('The backup file is incomplete, so delete it and try again.') + '\n\n' + (err.message || err),
    });
  } finally {
    mapJobEnd(job);
    setMapProgressRun('');
    unsubProgress();
  }
}

// ── Restore logic ─────────────────────────────────────────────────────────────

// Merges rather than asks, because the module-text question may already be on screen: a stat
// block the DM has keeps theirs, and the backup's fight lands only on an empty table.
async function adoptCombatFromZip(zipPath) {
  let json = null;
  try {
    json = await window.electronAPI.readBackupCombat(zipPath);
  } catch (err) {
    console.error('Reading the fight from backup failed:', err);
    return;
  }
  if (!json || typeof cbMergePayload !== 'function') return;
  const st = cbMergePayload(json);
  if (!st.ok) messageDialog({ title: 'Fight table not restored', message: t('The scenes came back, but the fight table did not.') + '\n\n' + st.error });
}

// The campaign's notes never replace the DM's own: they join below a separator, once. Anything that
// could not come back is named in one dialog with the scenes whose notes were dropped.
async function adoptCampaignNotesFromZip(zipPath, droppedScenes, shift, sceneMap) {
  let raw = null, readFailed = false;
  try {
    raw = await window.electronAPI.readBackupCampaign(zipPath);
  } catch (err) {
    console.error('Reading the campaign notes from backup failed:', err);
    readFailed = true;
  }
  const parsed = notesParseCampaign(raw);
  const merged = notesMergeCampaign(notesCampaignGet(), parsed.text);
  if (merged.text !== notesCampaignGet()) notesCampaignSet(merged.text);
  const places = notesParsePlaces(raw);
  const placesMerged = notesMergePlaces(notesPlacesAll(), places.places);
  notesPlacesWrite(placesMerged.map);
  // The places move with the restored scenes, and a place the DM already has keeps its own.
  const incoming = wmParseShapes(raw);
  const adopted = worldPlacesMerge(incoming.shapes, shift ? shift.dx : 0, shift ? shift.dy : 0);
  // The roads follow the scenes and places that came back as the backup's own copies: a scene is now under
  // a new id, and a place the DM already had under that name is not the backup's.
  const roads = wrParseRoads(raw), roadNotes = notesParseRoadNotes(raw);
  const roadKeys = worldRoadsMerge(roads.roads, sceneMap || Object.create(null), adopted, shift ? shift.dx : 0, shift ? shift.dy : 0);
  notesRoadsWrite(Object.assign(notesPlacesNew(), notesRoadsAll(), notesRekey(roadNotes.notes, roadKeys)));
  if (typeof refreshRoomPanel === 'function') refreshRoomPanel();

  const nl = String.fromCharCode(10);
  const parts = [];
  if (droppedScenes.length) parts.push(t('These scenes had notes Evermist could not read, so they came back without them:') + nl + droppedScenes.join(nl));
  if (parsed.broken || readFailed) parts.push(t('The campaign notes in this backup could not be read, so yours stay as they are.'));
  else if (merged.tooLong) parts.push(t('The campaign notes in this backup would not fit beside yours, so yours stay as they are.'));
  if (incoming.broken) parts.push(t('Some place outlines in this backup could not be read, so those places come back as rectangles.'));
  if (roads.broken) parts.push(t('Some roads in this backup could not be read, so they came back without them.'));
  if (roadNotes.broken) parts.push(t('Some road notes in this backup could not be read, so those roads came back without them.'));
  if (places.broken) parts.push(t('Some place notes in this backup could not be read, so those places came back without them.'));
  if (placesMerged.tooLong.length) parts.push(t('These places had notes that would not fit beside yours, so yours stay as they are:') + nl + placesMerged.tooLong.join(nl));
  if (parts.length) messageDialog({ title: 'Some notes were not restored', message: parts.join(nl + nl) });
}

// Adopt the campaign's module text out of a restored zip. ⚠ Runs only AFTER every scene is saved
// and the bar is down: a dialog must not open over the progress bar, and a module-text problem must
// not strand a half-restore.

async function adoptModuleTextFromZip(zipPath) {
  let json = null;
  try {
    json = await window.electronAPI.readBackupModuleText(zipPath);
  } catch (err) {
    console.error('Reading module text from backup failed:', err);
    return;
  }
  // No entry is the NORMAL case, and the only correct response is to do nothing: that is every
  // backup written before module text shipped.
  if (!json) return;
  if (typeof mtRestorePayload !== 'function') return;

  const incoming = typeof mtDeserialize === 'function' ? mtDeserialize(json) : null;
  const incomingName = (incoming && incoming.sourceName) || t('the module text in this backup');
  const current = typeof mtLoadedSourceName === 'function' ? mtLoadedSourceName() : null;

  const adopt = () => {
    const st = mtRestorePayload(json);
    if (st.ok) return;
    // The scenes are already saved, so this is a footnote and not a failure.
    messageDialog({
      title: 'Module text not restored',
      message: t('The scenes came back, but the module text did not.') + '\n\n' + st.error,
    });
  };

  if (!current) { adopt(); return; }

  // Replace or keep, nothing in between - so name both books and let the DM choose.
  confirmDialog({
    title: 'Replace the module text?',
    message: t('This backup carries “{incoming}”, and “{current}” is loaded now. ' +
               'Evermist holds one module at a time, so one of them goes.\n\nRoom names and ' +
               'descriptions already written to your maps stay as they are either way.',
               { incoming: incomingName, current: current }),
    confirmLabel: 'Use the backup’s',
    cancelLabel: 'Keep what I have',
    onConfirm: adopt,
  });
}

function _restoredPos(raw, shift) {
  const p = wmCleanPos(raw);
  return p ? { x: p.x + shift.dx, y: p.y + shift.dy } : undefined;
}

function _restoredPictures(list, buffers) {
  const out = {};
  for (const p of Array.isArray(list) ? list : []) {
    const name = p && pictureZipName(p.id, p.type);
    if (name && buffers && buffers[name]) out[p.id] = new Blob([buffers[name]], { type: pictureType(p.type) });
  }
  return out;
}

// Restore straight from a zip path — the scene "+" button's only route in, taken when the
// chosen file turns out to be a .zip.
async function restoreFromZipPath(zipPath) {
  if (!window.electronAPI || !zipPath) return;
  // ⚠ A restore rewrites the library underneath whatever is open, and a column holds a scene
  // record this one is about to replace. Back to one map first, then restore as it always did.
  if (typeof panesActive !== 'undefined' && panesActive) await exitPanes(panes[panesSelected].sceneId);

  const unsubProgress = window.electronAPI.onBackupProgress(({ done, total }) => {
    updateMapProgress(Math.round((done / total) * 100));
  });

  setMapProgressRun('', zipPath.split(/[\\/]/).pop());
  const job = mapJobStart({ title: 'Stop restoring?', message: 'Your scenes go back to how they were before the restore.' },
    () => window.electronAPI.cancelBackup());
  // A stopped restore leaves nothing: every scene saved so far and every map file written.
  let assignments = [];
  const saved = [];
  const undo = async () => {
    for (const id of saved) await sceneStore.deleteScene(id).catch(err => console.error('[restore] undo', err));
    for (const a of assignments) if (a.entry.mapType === 'video') await window.electronAPI.deleteVideoFile(a.newId);
    hideMapProgress();
  };
  showMapProgress('Reading backup…');
  try {
    const manifest = await window.electronAPI.readBackupManifest(zipPath);
    if (!Array.isArray(manifest) || !manifest.length) {
      hideMapProgress();
      messageDialog({
        title: 'Nothing in this backup',
        message: 'The file holds no scenes, or it did not come from Evermist.',
      });
      return;
    }

    const existingScenes = typeof allScenes !== 'undefined' ? allScenes : [];
    const usedNames = new Set(existingScenes.map(s => s.name));
    let maxOrder = existingScenes.length ? Math.max(...existingScenes.map(s => s.sortOrder ?? 0)) : -1;

    if (job.stopped) return undo();
    assignments = manifest.map(entry => {
      const newId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2);
      maxOrder++;
      return {
        newId,
        originalId: entry.id,
        resolvedName: resolveSceneName(entry.name || t('Imported Scene'), usedNames),
        sortOrder: maxOrder,
        entry,
      };
    });

    showMapProgress('Extracting scenes…');
    updateMapProgress(0);

    const extracted = await window.electronAPI.extractBackupScenes(
      zipPath,
      assignments.map(a => ({
        newId:      a.newId,
        originalId: a.originalId,
        mapType:    a.entry.mapType || 'image',
        mapExt:     a.entry.mapExt  || '.jpg',
        pictures:   (Array.isArray(a.entry.pictures) ? a.entry.pictures : [])
                      .map(p => p && pictureZipName(p.id, p.type)).filter(Boolean),
      }))
    );

    if (job.stopped) return undo();
    const extractMap = {};
    extracted.forEach(e => { extractMap[e.newId] = e; });
    const noMap = [];   // names, which is what the DM is told at the end
    const noNotes = [];   // scenes whose notes were not a string

    showMapProgress('Saving scenes…');
    updateMapProgress(0);

    const newSceneMeta = [];
    let restoreShift = { dx: 0, dy: 0 };
    // ⚠ A restore into a library with a layout lands beside it as one block, never on top of it.
    const shift = wmBesideOffset(existingScenes.filter(s => wmCleanPos(s.worldPos)).map(s => s.worldPos),
                                 manifest.map(e => wmCleanPos(e && e.worldPos)).filter(Boolean));
    restoreShift = shift;

    for (let i = 0; i < assignments.length; i++) {
      if (job.stopped) return undo();
      const { newId, resolvedName, sortOrder, entry } = assignments[i];
      const ex = extractMap[newId] || {};

      const fogBlob   = ex.fogBuffer   ? new Blob([ex.fogBuffer],   { type: 'image/png'  }) : null;
      const thumbBlob = ex.thumbBuffer ? new Blob([ex.thumbBuffer], { type: 'image/jpeg' }) : null;

      let mapBlob = undefined;
      let mapPath = undefined;

      if (entry.mapType === 'video') {
        // ⚠ ONLY WHERE THE FILE LANDED: a claimed path the zip never held opens once, then fails.
        if (ex.mapWritten === false) noMap.push(resolvedName);
        else mapPath = `maps/${newId}${entry.mapExt || '.webm'}`;
      } else if (ex.mapBuffer) {
        mapBlob = new Blob([ex.mapBuffer], { type: entry.mapMimeType || 'image/jpeg' });
      }

      const notes = notesSanitize(entry.notes);
      if (notes.dropped) noNotes.push(resolvedName);

      const scene = {
        id:            newId,
        name:          resolvedName,
        // Absent in every zip written before groups existed, which restores as Ungrouped.
        group:         entry.group || '',
        worldPos:      _restoredPos(entry.worldPos, shift),
        mapType:       entry.mapType  || 'image',
        mapWidth:      entry.mapWidth  || 0,
        mapHeight:     entry.mapHeight || 0,
        mapBlob,
        mapPath,
        polygons:      entry.polygons      || [],
        nextPolygonId: entry.nextPolygonId || 1,
        notes:         notes.text,
        // Absent in every zip written before pictures, and a room's refs then point at nothing.
        pictureBlobs:  _restoredPictures(entry.pictures, ex.pictures),
        // Absent in every zip written before effects existed, which restores as a scene with
        // none — the same shape a scene that never had one has.
        effects:       entry.effects       || [],
        nextEffectId:  entry.nextEffectId  || 1,
        // Absent in every zip written before lights: a scene with none.
        lightsHidden:  !!entry.lightsHidden,
        lightShapes:   entry.lightShapes   || [],
        // Absent in every zip written before floor plans existed, which is exactly the
        // no-plan case: the button stays disabled and nothing else changes.
        floorPlan:     entry.floorPlan,
        baseFogBlob:   fogBlob,
        gridConfig:    entry.gridConfig    || {},
        fogSettings:   entry.fogSettings,
        thumbnail:     thumbBlob,
        createdAt:     entry.createdAt     || Date.now(),
        sortOrder,
      };

      await sceneStore.saveScene(scene);
      saved.push(newId);
      newSceneMeta.push({ id: newId, name: resolvedName, group: scene.group, thumbnail: thumbBlob, sortOrder, createdAt: scene.createdAt, mapType: scene.mapType, worldPos: scene.worldPos });
      updateMapProgress(Math.round(((i + 1) / assignments.length) * 100));
    }

    if (job.stopped) return undo();
    mapJobEnd(job);
    if (typeof allScenes !== 'undefined') {
      allScenes.push(...newSceneMeta);
      allScenes.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    }
    sceneListChanged();

    hideMapProgress();

    if (noMap.length) messageDialog({
      title: t.plural(noMap.length, 'One scene came back without its map', '{n} scenes came back without their maps'),
      message: t('The backup carried no map file for these, so they restored empty. Everything ' +
                 'else came back:') + String.fromCharCode(10, 10) + noMap.join(String.fromCharCode(10)),
    });

    // Last, and deliberately: the scenes are safe by this point and the progress bar is gone, so
    // this can ask a question or report a storage failure without either being in the way.
    await adoptModuleTextFromZip(zipPath);
    await adoptCombatFromZip(zipPath);
    const sceneMap = Object.create(null);
    for (const a of assignments) sceneMap[a.originalId] = a.newId;
    await adoptCampaignNotesFromZip(zipPath, noNotes, restoreShift, sceneMap);
    await worldBackgroundAdopt(zipPath, restoreShift);
  } catch (err) {
    if (job.stopped) return undo();
    hideMapProgress();
    console.error('Restore failed:', err);
    messageDialog({
      title: 'Restore failed',
      message: t('Evermist stopped partway through the backup, so some scenes are missing.') + '\n\n' + (err.message || err),
    });
  } finally {
    mapJobEnd(job);
    setMapProgressRun('');
    unsubProgress();
  }
}



// Restores a picked backup. The real path comes from the preload bridge; main reads it off disk.
function restorePickedZip(f) {
  const zipPath = (window.electronAPI && window.electronAPI.getPathForFile)
    ? window.electronAPI.getPathForFile(f)
    : null;
  if (zipPath) {
    restoreFromZipPath(zipPath);
  } else {
    messageDialog({
      title: 'Backups need the desktop app',
      message: 'Restoring a .zip reads it straight off disk, which the browser will not allow. Open Evermist as the app to import this.',
    });
  }
}

if (typeof module !== 'undefined') module.exports = { resolveSceneName, mapExtFromScene };
