'use strict';

// ─── IndexedDB scene storage ───────────────────────────────────────────────────
// One object store 'scenes' keyed by id. Full scene record:
//   { id, name, mapBlob, mapWidth, mapHeight, polygons, nextPolygonId,
//     baseFogPNG, gridConfig, thumbnail, createdAt, sortOrder }
//
// listScenes() uses a cursor and returns only lightweight metadata so the heavy
// map Blobs (up to 50 MB each) are never pulled into JS heap during listing.
// IDB Blobs are lazy — they don't load their binary data until explicitly read.

const sceneStore = (() => {
  const DB_NAME    = 'evermist';
  const DB_VERSION = 1;
  const STORE_NAME = 'scenes';

  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE_NAME)) {
          d.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess  = e => resolve(e.target.result);
      req.onerror    = e => reject(e.target.error);
      req.onblocked  = ()  => reject(new Error('IndexedDB blocked'));
    });
  }

  async function initSceneDB() {
    db = await openDB();
  }

  function getStore(mode) {
    return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  }

  function idbRequest(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function saveScene(scene) {
    await idbRequest(getStore('readwrite').put(scene));
  }

  async function loadScene(id) {
    return idbRequest(getStore('readonly').get(id));
  }

  async function deleteScene(id) {
    await idbRequest(getStore('readwrite').delete(id));
  }

  // Returns only lightweight metadata — never the map blob or full fog PNG.
  // Uses a cursor so the full records are not simultaneously in memory.
  function listScenes() {
    return new Promise((resolve, reject) => {
      const results = [];
      const tx  = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).openCursor();
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (!cursor) { resolve(results); return; }
        const { id, name, thumbnail, sortOrder, createdAt } = cursor.value;
        results.push({ id, name, thumbnail, sortOrder, createdAt });
        cursor.continue();
      };
      req.onerror = e => reject(e.target.error);
    });
  }

  // Full scene as a JSON string with mapBlob converted to a base64 data URL.
  async function exportScene(id) {
    const scene = await loadScene(id);
    if (!scene) throw new Error('Scene not found: ' + id);

    // Convert map Blob → base64 data URL
    const mapDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read map blob'));
      reader.readAsDataURL(scene.mapBlob);
    });

    const exportObj = {
      version:      2,
      name:         scene.name,
      mapDataUrl,
      mapWidth:     scene.mapWidth,
      mapHeight:    scene.mapHeight,
      polygons:     scene.polygons,
      nextPolygonId: scene.nextPolygonId,
      baseFogPNG:   scene.baseFogPNG,
      gridConfig:   scene.gridConfig,
    };
    return JSON.stringify(exportObj);
  }

  // Import a scene from a JSON string.
  // Returns { newId } for version-2 full scenes.
  // Returns { legacy: true, fogPng, polygons, nextPolygonId } for old fog-only exports.
  async function importScene(jsonStr) {
    let data;
    try { data = JSON.parse(jsonStr); }
    catch { throw new Error('Invalid JSON'); }

    // Detect legacy fog-only format (version 1 / no mapDataUrl)
    if (!data.mapDataUrl) {
      return {
        legacy:       true,
        fogPng:       data.fogPng || null,
        polygons:     data.polygons || [],
        nextPolygonId: data.nextPolygonId || 1,
      };
    }

    // Version-2 full scene: convert base64 data URL → Blob
    const mapBlob = await fetch(data.mapDataUrl).then(r => r.blob());

    // Generate a new unique id so this never collides with an existing scene
    const newId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);

    const scene = {
      id:            newId,
      name:          data.name || 'Imported Scene',
      mapBlob,
      mapWidth:      data.mapWidth,
      mapHeight:     data.mapHeight,
      polygons:      data.polygons     || [],
      nextPolygonId: data.nextPolygonId || 1,
      baseFogPNG:    data.baseFogPNG   || null,
      gridConfig:    data.gridConfig   || null,
      thumbnail:     null,
      createdAt:     Date.now(),
      sortOrder:     Date.now(),
    };

    await saveScene(scene);
    return { newId };
  }

  return { initSceneDB, saveScene, loadScene, deleteScene, listScenes, exportScene, importScene };
})();
