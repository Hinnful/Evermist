'use strict';

// backup.js — zip-based export (Electron-only), and the pieces an import adopts around its scenes
// (transferImport.js). Every IPC call needs window.electronAPI, and the app globals resolve lazily.

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
// `opts.destPath` skips the save dialog, which no test can drive.
async function doExport(selectedIds, opts) {
  if (!window.electronAPI) return;

  const now = new Date();
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const destPath = (opts && opts.destPath) || await window.electronAPI.showSaveDialog({
    title: t('Save export'),
    defaultPath: `evermist-export-${ymd}.zip`,
    filters: [{ name: 'Evermist Export', extensions: ['zip'] }],
  });
  if (!destPath) return;

  const unsubProgress = window.electronAPI.onBackupProgress(({ done, total }) => {
    updateMapProgress(Math.round((done / total) * 100));
  });

  setMapProgressRun('', destPath.split(/[\\/]/).pop());
  const job = mapJobStart({ title: 'Stop the export?', message: 'The unfinished export file is deleted.' },
    () => window.electronAPI.cancelBackup());
  showMapProgress('Creating export…');
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
          polygons:      esWithUids(scene.polygons),
          nextPolygonId: scene.nextPolygonId || 1,
          notes:         scene.notes,
          pictures:      picList,
          effects:       esWithUids(scene.effects),
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
          // The part times an import compares. Absent on a record never saved since they existed.
          edits:         scene.edits,
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
    const worldBg = await worldBackgroundBackupPayload();
    // The gallery belongs to no scene, so an export of picked scenes leaves it out.
    const gallery = opts && opts.partial ? null : await galleryBackupPayload();
    const wrote = await window.electronAPI.createBackupZip(destPath, scenesData, moduleTextJson, combatJson, campaignJson, worldBg, gallery);
    hideMapProgress();
    if (wrote && wrote.cancelled) return;
    // ⚠ REPORTED, NEVER DROPPED: the record still exports, so the backup looks complete.
    const gone = (wrote && wrote.missingVideos) || [];
    if (gone.length) messageDialog({
      title: t.plural(gone.length, 'One map is not in the export', '{n} maps are not in the export'),
      message: t('Everything else was saved. These scenes had no map file left on disk, so they ' +
                 'went into the export without one:') + String.fromCharCode(10, 10) + gone.join(String.fromCharCode(10)),
    });
  } catch (err) {
    hideMapProgress();
    if (job.stopped) return;
    console.error('Export failed:', err);
    messageDialog({
      title: 'Export failed',
      message: t('The export file is incomplete, so delete it and try again.') + '\n\n' + (err.message || err),
    });
  } finally {
    mapJobEnd(job);
    setMapProgressRun('');
    unsubProgress();
  }
}

// ── Import logic ──────────────────────────────────────────────────────────────

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
  if (!st.ok) messageDialog({ title: 'Fight table not imported', message: t('The scenes came in, but the fight table did not.') + '\n\n' + st.error });
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
  const incomingName = (incoming && incoming.sourceName) || t('the module text in this file');
  const current = typeof mtLoadedSourceName === 'function' ? mtLoadedSourceName() : null;

  const adopt = () => {
    const st = mtRestorePayload(json);
    if (st.ok) return;
    // The scenes are already saved, so this is a footnote and not a failure.
    messageDialog({
      title: 'Module text not imported',
      message: t('The scenes came in, but the module text did not.') + '\n\n' + st.error,
    });
  };

  if (!current) { adopt(); return; }

  // Replace or keep, nothing in between - so name both books and let the DM choose.
  confirmDialog({
    title: 'Replace the module text?',
    message: t('This file carries “{incoming}”, and “{current}” is loaded now. ' +
               'Evermist holds one module at a time, so one of them goes.\n\nRoom names and ' +
               'descriptions already written to your maps stay as they are either way.',
               { incoming: incomingName, current: current }),
    confirmLabel: 'Use the file’s',
    cancelLabel: 'Keep what I have',
    onConfirm: adopt,
  });
}

// Imports a picked export. The real path comes from the preload bridge; main reads it off disk.
function restorePickedZip(f) {
  const zipPath = (window.electronAPI && window.electronAPI.getPathForFile)
    ? window.electronAPI.getPathForFile(f)
    : null;
  if (zipPath) {
    restoreFromZipPath(zipPath);
  } else {
    messageDialog({
      title: 'Import needs the desktop app',
      message: 'Importing a .zip reads it straight off disk, which the browser will not allow. Open Evermist as the app to import this.',
    });
  }
}

if (typeof module !== 'undefined') module.exports = { resolveSceneName, mapExtFromScene };
