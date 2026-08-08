'use strict';

// backup.js — zip-based backup export and restore (Electron-only)
// All IPC calls require window.electronAPI. References to allScenes,
// sceneStore, showMapProgress, etc. are resolved lazily (inline script loads last).

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

// Scene SELECTION is the scene dropdown's job: it passes the checked ids straight in.
async function doExport(selectedIds) {
  if (!window.electronAPI) return;

  const now = new Date();
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const destPath = await window.electronAPI.showSaveDialog({
    title: 'Save Backup',
    defaultPath: `evermist-backup-${ymd}.zip`,
    filters: [{ name: 'Evermist Backup', extensions: ['zip'] }],
  });
  if (!destPath) return;

  const unsubProgress = window.electronAPI.onBackupProgress(({ done, total }) => {
    updateMapProgress(Math.round((done / total) * 100));
  });

  showMapProgress('Creating backup…');
  try {
    const scenesData = [];
    for (const id of selectedIds) {
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
          mapType:       scene.mapType || 'image',
          mapWidth:      scene.mapWidth,
          mapHeight:     scene.mapHeight,
          mapMimeType,
          mapExt,
          polygons:      scene.polygons || [],
          nextPolygonId: scene.nextPolygonId || 1,
          // This list is a WHITELIST: a field missing from it is silently dropped on
          // export. The floor plan has to survive, or a restored scene loses its
          // Draw Rooms button with nothing to explain why.
          floorPlan:     scene.floorPlan,
          gridConfig:    scene.gridConfig || {},
          fogSettings:   scene.fogSettings,
          createdAt:     scene.createdAt || 0,
          sortOrder:     scene.sortOrder || 0,
        },
        mapBuffer,
        fogBuffer,
        thumbBuffer,
      });
    }

    if (!scenesData.length) { hideMapProgress(); return; }

    await window.electronAPI.createBackupZip(destPath, scenesData);
    hideMapProgress();
  } catch (err) {
    hideMapProgress();
    console.error('Export failed:', err);
    messageDialog({
      title: 'Export failed',
      message: 'The backup file is incomplete, so delete it and try again.\n\n' + (err.message || err),
    });
  } finally {
    unsubProgress();
  }
}

// ── Restore logic ─────────────────────────────────────────────────────────────

// Restore straight from a zip path — the scene "+" button's only route in, taken when the
// chosen file turns out to be a .zip.
async function restoreFromZipPath(zipPath) {
  if (!window.electronAPI || !zipPath) return;

  const unsubProgress = window.electronAPI.onBackupProgress(({ done, total }) => {
    updateMapProgress(Math.round((done / total) * 100));
  });

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

    const assignments = manifest.map(entry => {
      const newId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2);
      maxOrder++;
      return {
        newId,
        originalId: entry.id,
        resolvedName: resolveSceneName(entry.name || 'Imported Scene', usedNames),
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
      }))
    );

    const extractMap = {};
    extracted.forEach(e => { extractMap[e.newId] = e; });

    showMapProgress('Saving scenes…');
    updateMapProgress(0);

    const newSceneMeta = [];

    for (let i = 0; i < assignments.length; i++) {
      const { newId, resolvedName, sortOrder, entry } = assignments[i];
      const ex = extractMap[newId] || {};

      const fogBlob   = ex.fogBuffer   ? new Blob([ex.fogBuffer],   { type: 'image/png'  }) : null;
      const thumbBlob = ex.thumbBuffer ? new Blob([ex.thumbBuffer], { type: 'image/jpeg' }) : null;

      let mapBlob = undefined;
      let mapPath = undefined;

      if (entry.mapType === 'video') {
        mapPath = `maps/${newId}${entry.mapExt || '.webm'}`;
      } else if (ex.mapBuffer) {
        mapBlob = new Blob([ex.mapBuffer], { type: entry.mapMimeType || 'image/jpeg' });
      }

      const scene = {
        id:            newId,
        name:          resolvedName,
        mapType:       entry.mapType  || 'image',
        mapWidth:      entry.mapWidth  || 0,
        mapHeight:     entry.mapHeight || 0,
        mapBlob,
        mapPath,
        polygons:      entry.polygons      || [],
        nextPolygonId: entry.nextPolygonId || 1,
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
      newSceneMeta.push({ id: newId, name: resolvedName, thumbnail: thumbBlob, sortOrder, createdAt: scene.createdAt });
      updateMapProgress(Math.round(((i + 1) / assignments.length) * 100));
    }

    if (typeof allScenes !== 'undefined') {
      allScenes.push(...newSceneMeta);
      allScenes.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    }
    if (typeof renderSceneManager === 'function') renderSceneManager();

    hideMapProgress();
  } catch (err) {
    hideMapProgress();
    console.error('Restore failed:', err);
    messageDialog({
      title: 'Restore failed',
      message: 'Evermist stopped partway through the backup, so some scenes are missing.\n\n' + (err.message || err),
    });
  } finally {
    unsubProgress();
  }
}

if (typeof module !== 'undefined') module.exports = { resolveSceneName, mapExtFromScene };
