// mapImport.js — a picked or dropped file on its way to being a scene.

// The "+" picker and a drop on the window both land in importMapFiles. THE LOOP LIVES HERE, in
// the module that owns scene creation — never a second one in toolbar.js.

// What either route accepts, so the picker and a drop cannot disagree about what imports.
const MAP_FILE_RE = /\.(jpe?g|png|gif|bmp|webp|svg|mp4|webm)$/i;

function isImportableMapFile(f) {
  return !!f && (MAP_FILE_RE.test(f.name) ||
                 !!(f.type && (f.type.startsWith('image/') || f.type.startsWith('video/'))));
}

function isZipFile(f) {
  return !!f && (/\.zip$/i.test(f.name) || f.type === 'application/zip' ||
                 f.type === 'application/x-zip-compressed');
}

// ⚠ A SECOND IMPORT WAITS FOR THE FIRST, including the batch's closing switch: both load a video,
// and each load's cleanupVideo revokes the other's URL, so the later map "could not be played".
let _importQueue = Promise.resolve();
function importMapFiles(files) {
  const run = _importQueue.then(() => _importMapFiles(files));
  _importQueue = run.catch(() => {});
  return run;
}

// Imports every file, STRICTLY ONE AFTER ANOTHER.
//
// Nothing appears at the end of a clean run. A run with failures ends in ONE dialog naming what
// did not make it, and each map's own dialog is suppressed so nothing stops an unattended run.
async function _importMapFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  const batch = list.length > 1;

  // ⚠ A ZIP IN A CROWD IMPORTS NOTHING. Restoring carries the module text, of which the app holds
  // one, so it is a blocking question in the middle of an unattended run. Alone it still restores.
  const zip = list.find(isZipFile);
  if (zip) {
    messageDialog({
      title: 'Import the backup on its own',
      message: '“' + zip.name + '” is a backup, and restoring one is its own job. Import it by ' +
               'itself, then come back for the maps.',
    });
    return;
  }

  // Filtered UP FRONT, before anything loads: the picker does no type filtering of its own, so
  // without this an unimportable file reaches createNewScene and reports from inside the run.
  const failures = [];
  const queue = [];
  for (const f of list) {
    if (isImportableMapFile(f)) queue.push(f);
    else failures.push('“' + f.name + '” is not an image or an animated map.');
  }

  const ids = [];
  try {
    for (let i = 0; i < queue.length; i++) {
      const f = queue[i];
      if (batch) {
        setMapProgressPrefix('Map ' + (i + 1) + ' of ' + queue.length + ' - ' + sceneNameForFile(f));
        showMapProgress('Reading the map…');
      }
      // ⚠ THE ORIGINALLY PICKED File, STRAIGHT THROUGH: findPlanForFile needs its path on disk, so
      // a rebuilt File arrives with no floor plan. Caught per file, so one bad map costs one map.
      let r = null;
      try { r = await createNewScene(f, { quiet: batch }); }
      catch (err) { console.error('[importMapFiles] import threw', err); }
      if (r && r.ok) ids.push(r.id);
      else failures.push('“' + f.name + '” ' + ((r && r.reason) || 'would not open.'));
    }
  } finally {
    setMapProgressPrefix('');
    hideMapProgress();
  }

  // A single import lands on its map, exactly as it always has. A batch lands on the FIRST of
  // the batch, and that is the one map whose floor plan gets offered.
  if (batch && ids.length) {
    if (ids.length > 1) await switchScene(ids[0]).catch(err => console.error('switchScene failed:', err));
    if (typeof offerStoredFloorPlan === 'function') offerStoredFloorPlan();
  }

  // ⚠ THE OVERLAY IS z-index 10000 AND THE DIALOG ANCHOR IS 620, so a dialog raised under it is
  // invisible. It is already down (the finally above) and this is the last thing to run.
  if (batch && failures.length) {
    messageDialog({
      title: failures.length === 1 ? 'One map did not make it' : failures.length + ' maps did not make it',
      message: failures.join('\n'),
    });
  }
}

// The scene name a file will get, so a batch's progress label and the scene it creates agree.
function sceneNameForFile(file) {
  return file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim() || 'New Scene';
}

// Resolves { ok, id, name, reason } once the map is on screen or refused — NEVER BEFORE, and never
// not at all. That is what lets importMapFiles run a batch one at a time, since the loaders are
// callback-based.
//
// ⚠ SETTLE ON EVERY FAILURE EXIT: both loaders' early returns, both decode failures, and anything
// the save path throws. Miss one and a single bad file hangs the batch with the overlay up.
//
// opts.quiet: a batch is doing the reporting, so no dialog and no floor-plan notice from here.
async function createNewScene(file, opts) {
  const o = opts || {};
  const isVid = isVideoFile(file);
  const name = sceneNameForFile(file);

  // ⚠ THE FLOOR PLAN IS RESOLVED FIRST, FROM THE FILE THE DM PICKED. findPlanForFile needs
  // getPathForFile, and a File built in-page has none, so converting first loses the plan silently
  // on exactly the oversized exports that ship a .dd2vtt.
  const floorPlan = typeof findPlanForFile === 'function' ? await findPlanForFile(file) : null;

  // Then shrink it, if the scene dropdown's setting is on. No confirmation — it is a setting.
  // The overlay is raised from onStart, so a map that already fits never flashes a progress bar.
  let shrunk = null;
  if (isVid && typeof convertVideoForImport === 'function' && compressBigVideosEnabled()) {
    shrunk = await convertVideoForImport(file, {
      onStart: () => showMapProgress('Shrinking the animated map…'),
      onProgress: updateMapProgress,
    });
    if (shrunk.converted) file = shrunk.file;
    else shrunk = null;
    hideMapProgress();
  }

  if (!isVid) showMapProgress('Loading map…');
  if (currentScene) doAutoSave();
  cleanupVideo();
  const maxOrder = allScenes.length > 0 ? Math.max(...allScenes.map(s => s.sortOrder ?? 0)) : -1;

  // One deferred, settled by whichever of the paths below gets there first.
  let settle = null;
  const settled = new Promise(r => { settle = r; });
  const finish = result => {
    if (!settle) return;
    const answer = settle; settle = null;
    if (!result.ok) {
      hideMapProgress();
      if (!o.quiet) messageDialog({
        title: isVid ? 'Animated map would not play' : 'Map would not open',
        message: '“' + file.name + '” ' + result.reason,
      });
    }
    answer(result);
  };

  const onLoaded = async (bitmap, blob) => {
   try {
    const thumb = await generateThumbnail(bitmap, mapWidth, mapHeight);
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);

    let mapBlob = undefined;
    let mapPath = undefined;
    if (isVid && window.electronAPI) {
      // A statement of what happened, carried on the label of the longest step that follows it,
      // so it is on screen long enough to read. Never a dialog: nothing here needs an answer.
      showMapProgress(shrunk
        ? 'Saving — shrunk ' + shrunk.srcW + '×' + shrunk.srcH + ' to ' + shrunk.outW + '×' + shrunk.outH
        : 'Saving animated map…');
      const mimeType = file.type || (file.name.endsWith('.mp4') ? 'video/mp4' : 'video/webm');
      try {
        mapPath = await persistVideoMap(file, id, mimeType);
      } catch (err) {
        // ⚠ Never leave the progress overlay up: an unhandled rejection here reads as a permanent
        // "Saving video map…" hang. The legacy in-IndexedDB blob keeps the import working, and
        // switchScene's lazy migration retries the move to disk.
        console.error('[createNewScene] saving video map to disk failed', err);
        mapBlob = mapVideoBlob;
      }
      hideMapProgress();
    } else {
      mapBlob = isVid ? mapVideoBlob : blob;
    }

    // floorPlan was captured at the top of createNewScene, before conversion — persistVideoMap has
    // since copied the map into userData/maps, away from its .dd2vtt.
    const scene = {
      id, name,
      group:         '',   // a new map is Ungrouped; the DM files it, never the import
      mapBlob, mapPath,
      mapType:       isVid ? 'video' : 'image',
      mapWidth, mapHeight,
      floorPlan,
      polygons:      [],
      nextPolygonId: 1,
      baseFogBlob:   await fogToBlob(),
      // ⚠ NOT captureGridConfig(): the live cell size and offset belong to the previous map, and
      // inheriting them makes the grid look shared. freshGridConfig keeps the look, resets the fit.
      gridConfig:    freshGridConfig(),
      thumbnail:     thumb,
      createdAt:     Date.now(),
      sortOrder:     maxOrder + 1,
    };
    allScenes.push({ id, name, group: '', thumbnail: thumb, sortOrder: scene.sortOrder, createdAt: scene.createdAt, mapType: scene.mapType });
    await sceneStore.saveScene(scene);
    hideMapProgress();
    // ⚠ Reload through switchScene. The direct drop-load path leaves the PixiJS fog and video
    // uninitialised: the map renders fully revealed, shroud does nothing, video is frozen.
    currentScene = null;
    await switchScene(id);
    // AFTER the switch, never before: mapWidth is unknown until the map loads, and switchScene
    // applies the stored gridConfig on its way in. Import only — Draw Rooms later leaves the grid.
    if (typeof applyPlanGridSize === 'function') applyPlanGridSize();
    // Asked once the map is on screen, so the DM is deciding about something they can see. Cancel
    // means "later", via the Fog tab's Draw Rooms. Suppressed during a batch, which shows one.
    if (!o.quiet && typeof offerStoredFloorPlan === 'function') offerStoredFloorPlan();
    finish({ ok: true, id, name });
   } catch (err) {
    // The fifth way this ends: the save path itself throwing. Left unhandled that is an
    // unsettled promise with the overlay up, which is a hang rather than a failure.
    console.error('[createNewScene] import failed', err);
    finish({ ok: false, name, reason: 'could not be saved. ' + (err && err.message ? err.message : '') });
   }
  };
  if (isVid) loadVideoFromFile(file, onLoaded, reason => finish({ ok: false, name, reason }));
  else loadMapFromFile(file, onLoaded, reason => finish({ ok: false, name, reason }));
  return settled;
}

// Writes a picked video map into userData/maps and returns its relative mapPath.
//
// Two routes, because Electron 32 removed File.path: prefer a real filesystem path (webUtils via
// preload) so main can STREAM the copy with progress; fall back to shipping the bytes for a File
// that has no path on disk.
async function persistVideoMap(file, sceneId, mimeType) {
  const ext = mimeType === 'video/mp4' ? '.mp4' : '.webm';
  const srcPath = window.electronAPI.getPathForFile
    ? window.electronAPI.getPathForFile(file)
    : null;
  if (srcPath) {
    await window.electronAPI.saveVideoFile(srcPath, sceneId, mimeType);
  } else {
    const ab = await file.arrayBuffer();
    await window.electronAPI.saveVideoBlob(sceneId, ab, mimeType);
  }
  return 'maps/' + sceneId + ext;
}

