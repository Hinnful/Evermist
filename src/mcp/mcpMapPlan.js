'use strict';
// mcpMapPlan.js — pure rules behind Claude changing a map, open or closed: which fields each part of a map
// names, the copy taken before a change, and a stored record read into the plain shape and written back. No DOM. Tested.

const MM = (typeof module !== 'undefined' && module.exports)
  ? (require('../fog/themes/default.js'), require('../fog/themes/blood.js'), require('../fog/themes/toxic.js'), require('../fog/themes/ice.js'), require('../fog/themes/fire.js'),
     Object.assign({}, require('../fog/fogGeometry.js'), require('../scenes/editStamps.js'), require('../render/weatherPlan.js'), require('../fog/themes/fogThemes.js')))
  : { copyShapeRings, decodeShapeFromSave, encodeShapeForSave, esAssignUids, weatherNormalize, fogThemeNormalize };

// The fields a change may touch, per part. Lights share their id space with effects, so both carry nextEffectId.
const MCP_MAP_PARTS = {
  rooms: ['polygons', 'nextPolygonId'],
  effects: ['effects', 'nextEffectId'],
  lights: ['lightShapes', 'lightsHidden', 'nextEffectId'],
  grid: ['gridConfig'],
  fogSettings: ['fogTheme', 'weather'],
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

// A stored record's named fields in the shape the open map holds them: rooms decoded, the fog theme known.
// `defaults` is { grid } for a record saved before it existed. The painted fog is the caller's.
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
  if (has('fogTheme')) out.fogTheme = MM.fogThemeNormalize(rec.fogTheme);
  if (has('weather')) out.weather = MM.weatherNormalize(rec.weather);
  return out;
}

// The named fields written onto a stored record the way a save writes them: rooms get uids and the
// downgrade-safe encoding. A field the plain shape leaves undefined is removed. The painted fog is the caller's.
function mcpMapRecordWrite(rec, data, keys) {
  for (const k of keys) {
    if (k === 'fog') continue;
    const v = data[k];
    // Absent is none, the way a save writes it.
    if (v === undefined || (k === 'weather' && v === 'none') || (k === 'fogTheme' && v === 'default')) { delete rec[k]; continue; }
    if (k === 'polygons') rec.polygons = MM.esAssignUids(v.map(p => MM.copyShapeRings(structuredClone(p)))).map(MM.encodeShapeForSave);
    else rec[k] = structuredClone(v);
  }
  return rec;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MCP_MAP_PARTS, mcpMapKeys, mcpMapSnapshot, mcpMapRecordRead, mcpMapRecordWrite };
}
