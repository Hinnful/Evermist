'use strict';
// mcpMapEdit.js — the one way a Claude tool changes a map: live on the DM's screen when the DM has it open, in the
// store when it is closed. Refused when the TV shows it, a column of two maps holds it, or the DM is mid-gesture on it.
// ⚠ NOTHING HERE POSTS TO THE PLAYER. A live change takes the DM's own paths, which a closed or held TV gates.

const _MCP_FOG_FILL = '#1a1a2e';

// A drag, a shape being drawn, a brush stroke or the grid's calibration square in progress.
function _mcpDmEditing() {
  return isDrawing || !!activePolygon || selectDragging() || gridCalArmed;
}

// Why the map cannot be changed now, or null.
function _mcpMapBlocked(scene, what) {
  const tv = _mcpTvRefuse(scene, what);
  if (tv) return tv.text;
  const at = _mcpHolder(scene.id);
  if (at && at !== 'here') return 'Not done: "' + scene.name + '" is open in a column of two maps. Ask the DM to close the column first.';
  if (at === 'here' && _mcpDmEditing()) return 'Not done: the DM is editing "' + scene.name + '" right now. Try again in a moment.';
  return null;
}

function _mcpFogBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('The fog could not be encoded.'))), 'image/png'));
}

// The painted fog as a canvas of the fog's size, from a canvas or a Blob. Nothing, or a fog that will not
// decode, is fully fogged, as a scene load does.
async function _mcpFogCanvas(src, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  try {
    const img = src instanceof Blob ? await createImageBitmap(src) : src;
    ctx.drawImage(img, 0, 0, w, h);
    if (img !== src) img.close();
  } catch (_) {
    ctx.fillStyle = _MCP_FOG_FILL;
    ctx.fillRect(0, 0, w, h);
  }
  return c;
}

// The named fields in the plain shape, from the window's state or the store, with the map's size.
async function _mcpMapRead(scene, keys) {
  if (_mcpHolder(scene.id) === 'here') {
    const d = mcpMapSnapshot({ polygons, nextPolygonId, effects, nextEffectId, ...lightsSceneFields(),
      gridConfig: captureGridConfig(), fogSettings: captureFogSettings(), floorPlan: currentScene.floorPlan }, keys);
    if (keys.includes('fog')) d.fog = cloneCanvas(baseFogCanvas);
    return Object.assign(d, { mapWidth, mapHeight });
  }
  const rec = await sceneStore.loadScene(scene.id);
  if (!rec) throw new Error('The map "' + scene.name + '" is no longer in the library.');
  const d = mcpMapRecordRead(rec, keys, { grid: captureGridConfig(), fog: SCENE_FOG_DEFAULTS });
  if (keys.includes('fog')) {
    const src = rec.baseFogBlob || (rec.baseFogPNG ? await (await fetch(rec.baseFogPNG)).blob() : null);
    d.fog = await _mcpFogCanvas(src, Math.ceil(rec.mapWidth / FOG_SCALE), Math.ceil(rec.mapHeight / FOG_SCALE));
  }
  return Object.assign(d, { mapWidth: rec.mapWidth, mapHeight: rec.mapHeight });
}

// The open scene takes the fields through the DM's own undo, restore, grid and fog-settings paths, then saves.
function _mcpLiveWrite(keys, d) {
  const has = k => keys.includes(k);
  const shapes = ['polygons', 'effects', 'lightShapes', 'fog'].some(has);
  const settings = has('gridConfig') || (has('fogSettings') &&
    (d.fogSettings.pickedHex !== fogPickedHex || d.fogSettings.tintAlpha !== FOG_TINT_ALPHA));
  undoOutsideChange(shapes, settings, () => {
    if (shapes) {
      restoreState({
        baseFog: has('fog') ? d.fog : baseFogCanvas,
        polygons: has('polygons') ? d.polygons : polygons,
        nextPolygonId: has('nextPolygonId') ? d.nextPolygonId : nextPolygonId,
        effects: has('effects') ? d.effects : effects,
        nextEffectId: has('nextEffectId') ? d.nextEffectId : nextEffectId,
        lights: has('lightShapes') ? { lightsHidden: d.lightsHidden, lightShapes: d.lightShapes } : lightsSceneFields(),
      });
    }
    if (has('gridConfig')) { applyGridConfig(d.gridConfig); commitGridChange(); }
    if (has('fogSettings')) restoreSceneFogSettings({ fogSettings: d.fogSettings });
  });
  if (has('floorPlan')) { currentScene.floorPlan = d.floorPlan; refreshFloorPlanUI(); }
  scheduleAutoSave();
}

// `data`'s named fields put on the map wherever it lives now: a refusal's text, or null once written. `from` is
// where the map was when `data` was read, so a map opened or closed since is refused rather than half-written.
async function _mcpMapWrite(id, keys, data, what, from) {
  const scene = allScenes.find(s => s.id === id);
  if (!scene) return 'Not done: the map is no longer in the library.';
  const at = _mcpHolder(id);
  let fog;
  if (keys.includes('fog')) {
    fog = at === 'here' ? await _mcpFogCanvas(data.fog, baseFogCanvas.width, baseFogCanvas.height)
      : data.fog instanceof Blob ? data.fog : await _mcpFogBlob(data.fog);
  }
  const why = _mcpMapBlocked(scene, what);
  if (why) return why;
  if (_mcpHolder(id) !== at || (from !== undefined && from !== at)) {
    return 'Not done: the DM opened or closed "' + scene.name + '" while Claude was changing it. Try again.';
  }
  if (at === 'here') { _mcpLiveWrite(keys, { ...data, fog }); return null; }
  await sceneStore.updateScene(id, rec => {
    mcpMapRecordWrite(rec, data, keys);
    if (fog) { rec.baseFogBlob = fog; delete rec.baseFogPNG; }
  });
  return null;
}

// Changes one map wherever it lives. `parts` names what `change` may touch (MCP_MAP_PARTS, mcpMapPlan.js); `what`
// ends the TV refusal ("… and changing its rooms would change what the players see"). `change(data)` edits the
// plain shape in place, may be async, and returns a string to refuse with that text, nothing written.
// Resolves { no } with the reply, or { undo } for mcpDone; the undo writes the fields back through here.
async function mcpEditMap(scene, what, parts, change) {
  const keys = mcpMapKeys(parts);
  const why = _mcpMapBlocked(scene, what);
  if (why) return { no: _mcpNo(why) };
  const from = _mcpHolder(scene.id);
  const data = await _mcpMapRead(scene, keys);
  const before = mcpMapSnapshot(data, keys);
  if (data.fog) before.fog = await _mcpFogBlob(data.fog);
  const refused = await change(data);
  if (typeof refused === 'string') return { no: _mcpNo(refused) };
  const failed = await _mcpMapWrite(scene.id, keys, data, what, from);
  if (failed) return { no: _mcpNo(failed) };
  return { undo: async () => {
    const no = await _mcpMapWrite(scene.id, keys, before, 'undoing Claude\'s change');
    if (no) throw Object.assign(new Error(no), { mcpKeep: true });
  } };
}
