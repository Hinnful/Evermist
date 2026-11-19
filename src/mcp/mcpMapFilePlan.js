'use strict';
// mcpMapFilePlan.js — pure rules behind Claude's tools that touch a map's file: what a reply says about a map's size,
// the record a copied map gets, and a shrunk map's record with everything on it moved to the new size. No DOM. Tested.

const MF = (typeof module !== 'undefined' && module.exports)
  ? Object.assign({}, require('../scenes/mapConvert.js'), require('../notes/mentionPlan.js'), require('../shapes/roomPieces.js'))
  : { fitInsideBox, mpRemap, renewRoomUids };

const MCP_4K = { w: 3840, h: 2160 };

// A map's pixel size, and for an animated map past the 4K box a plain warning for the DM. `compressOn` is this
// computer's Compression setting; a new import past it means the setting is off.
function mcpSizeNote(rec, compressOn) {
  const w = Number(rec && rec.mapWidth) || 0, h = Number(rec && rec.mapHeight) || 0;
  const size = 'The map is ' + w + '×' + h + ' pixels.';
  if (!rec || rec.mapType !== 'video' || !MF.fitInsideBox(w, h, MCP_4K.w, MCP_4K.h).changed) return { size, big: false, text: size };
  const why = compressOn ? '' : ' Compression is off in this computer\'s Settings, so nothing shrank it.';
  return { size, big: true, text: size + ' That is larger than 4K (3840×2160), and an animated map this big can make a laptop at the table slow or hot.' + why +
    ' Tell the DM. shrink_map can make it smaller and keeps everything on it.' };
}

// The record a copy of `src` saves as: everything the map holds, under its own id, name, group, Campaign spot and
// file. Its edit times start fresh, so sync carries it as a new map. Mentions of the source map and its rooms in its
// own notes follow the copy.
function mcpSceneCopy(src, o) {
  const c = Object.assign({}, src, { id: o.id, name: o.name, group: o.group, worldPos: o.worldPos, sortOrder: o.sortOrder, createdAt: o.now });
  delete c.edits;
  if (o.mapPath) { c.mapPath = o.mapPath; delete c.mapBlob; }
  const ids = { [src.id]: o.id }, remap = t => MF.mpRemap(t, ids, null, Infinity).text;
  if (typeof c.notes === 'string') c.notes = remap(c.notes);
  if (Array.isArray(c.polygons)) c.polygons = MF.renewRoomUids(c.polygons.map(p => (typeof p.desc === 'string' ? Object.assign({}, p, { desc: remap(p.desc) }) : Object.assign({}, p))));
  if (Array.isArray(c.effects)) c.effects = MF.renewRoomUids(c.effects.map(e => Object.assign({}, e)));
  return c;
}

// The boxes shrink_map takes, the Compression setting's own sizes.
const MCP_SHRINK_BOXES = { '4K': { w: 3840, h: 2160 }, '2K': { w: 2560, h: 1440 }, '1080p': { w: 1920, h: 1080 } };

const _num = (o, k, f) => (typeof o[k] === 'number' ? { [k]: f(o[k]) } : {});

// ⚠ ADDITIVE, NEVER A KEY LIST: a field this does not know rides along untouched, as CLAUDE.md's "Rooms are polygons"
// asks. Doors are { edge, t } along their wall and need nothing; an old door's w and d are pixels.
function _scaleShape(s, k) {
  const pt = v => Object.assign({}, v, _num(v, 'x', n => n * k), _num(v, 'y', n => n * k));
  const o = Object.assign({}, s);
  if (Array.isArray(s.vertices)) o.vertices = s.vertices.map(pt);
  if (Array.isArray(s.holes)) o.holes = s.holes.map(h => (Array.isArray(h) ? h.map(pt) : h));
  if (Array.isArray(s.cornerRadii)) o.cornerRadii = s.cornerRadii.map(r => (typeof r === 'number' ? r * k : r));
  Object.assign(o, _num(s, 'cornerRadius', n => n * k));
  if (Array.isArray(s.handles)) o.handles = s.handles.map(h => (h && typeof h === 'object' ? Object.assign({}, h, ...['ix', 'iy', 'ox', 'oy'].map(q => _num(h, q, n => n * k))) : h));
  if (Array.isArray(s.doors)) o.doors = s.doors.map(d => Object.assign({}, d, _num(d, 'w', n => n * k), _num(d, 'd', n => n * k)));
  return o;
}

// The record after its map is re-encoded at outW×outH: every field in map pixels times the width ratio. The fog picture
// is drawn stretched onto the map's size and a floor plan scales by mapWidth, so neither changes.
function mcpRescaleScene(rec, outW, outH) {
  const k = outW / rec.mapWidth, list = a => (Array.isArray(a) ? a.map(s => _scaleShape(s, k)) : a);
  const out = Object.assign({}, rec, { mapWidth: outW, mapHeight: outH, polygons: list(rec.polygons), effects: list(rec.effects), lightShapes: list(rec.lightShapes) });
  for (const f of ['polygons', 'effects', 'lightShapes']) if (rec[f] === undefined) delete out[f];
  if (rec.gridConfig) out.gridConfig = Object.assign({}, rec.gridConfig, ...['cellSize', 'offsetX', 'offsetY'].map(q => _num(rec.gridConfig, q, n => n * k)));
  return out;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { MCP_4K, MCP_SHRINK_BOXES, mcpSizeNote, mcpSceneCopy, mcpRescaleScene };
