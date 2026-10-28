'use strict';
// mcpMapPlan.js — pure rules behind Claude changing a map, open or closed: which fields each part of a map
// names, the copy taken before a change, and a stored record read into the plain shape and written back. No DOM. Tested.

const MM = (typeof module !== 'undefined' && module.exports)
  ? Object.assign({}, require('../fog/fogGeometry.js'), require('../fog/fogColor.js'), require('../scenes/editStamps.js'))
  : { copyShapeRings, decodeShapeFromSave, encodeShapeForSave, parseSceneFogSettings, esAssignUids };

// The fields a change may touch, per part. Lights share their id space with effects, so both carry nextEffectId.
const MCP_MAP_PARTS = {
  rooms: ['polygons', 'nextPolygonId'],
  effects: ['effects', 'nextEffectId'],
  lights: ['lightShapes', 'lightsHidden', 'nextEffectId'],
  grid: ['gridConfig'],
  fogSettings: ['fogSettings'],
  fog: ['fog'],
  plan: ['floorPlan'],
};

// The fields a list of parts names, each once. An unknown part is a builder's mistake, so it throws.
function mcpMapKeys(parts) {
  const keys = [];
  for (const p of parts || []) {
    if (!MCP_MAP_PARTS[p]) throw new Error('No map part is called "' + p + '".');
    for (const k of MCP_MAP_PARTS[p]) if (!keys.includes(k)) keys.push(k);
  }
  return keys;
}

// A deep copy of the named fields. The painted fog is a canvas or a Blob, which the caller copies itself.
function mcpMapSnapshot(data, keys) {
  const out = {};
  for (const k of keys) if (k !== 'fog') out[k] = data[k] === undefined ? undefined : structuredClone(data[k]);
  return out;
}

// A stored record's named fields in the shape the open map holds them: rooms decoded, fog settings complete.
// `defaults` is { grid, fog } for a record saved before either existed. The painted fog is the caller's.
function mcpMapRecordRead(rec, keys, defaults) {
  const out = {};
  const has = k => keys.includes(k);
  if (has('polygons')) out.polygons = (rec.polygons || []).map(p => MM.decodeShapeFromSave(MM.copyShapeRings(structuredClone(p))));
  if (has('nextPolygonId')) out.nextPolygonId = rec.nextPolygonId || 1;
  if (has('effects')) out.effects = structuredClone(rec.effects || []);
  if (has('nextEffectId')) out.nextEffectId = rec.nextEffectId || 1;
  if (has('lightShapes')) out.lightShapes = structuredClone((rec.lightShapes || []).filter(l => l && Array.isArray(l.vertices)));
  if (has('lightsHidden')) out.lightsHidden = !!rec.lightsHidden;
  if (has('floorPlan')) out.floorPlan = rec.floorPlan;
  if (has('gridConfig')) out.gridConfig = structuredClone(rec.gridConfig || defaults.grid);
  if (has('fogSettings')) {
    const f = MM.parseSceneFogSettings(rec, defaults.fog);
    out.fogSettings = { pickedHex: f.hex, tintAlpha: f.alpha, anim: f.anim };
  }
  return out;
}

// The named fields written onto a stored record the way a save writes them: rooms get uids and the
// downgrade-safe encoding. A field the plain shape leaves undefined is removed. The painted fog is the caller's.
function mcpMapRecordWrite(rec, data, keys) {
  for (const k of keys) {
    if (k === 'fog') continue;
    const v = data[k];
    if (v === undefined) { delete rec[k]; continue; }
    if (k === 'polygons') rec.polygons = MM.esAssignUids(v.map(p => MM.copyShapeRings(structuredClone(p)))).map(MM.encodeShapeForSave);
    else rec[k] = structuredClone(v);
  }
  return rec;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MCP_MAP_PARTS, mcpMapKeys, mcpMapSnapshot, mcpMapRecordRead, mcpMapRecordWrite };
}
