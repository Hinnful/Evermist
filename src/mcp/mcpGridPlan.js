'use strict';
// mcpGridPlan.js — pure rules behind Claude's grid, effect and light tools: a grid line crossing in percent turned
// into the stored phase, the grid's look checked, an effect's or a light's shape read from percent, and one found
// by its index. No DOM. Tested.

const MG = (typeof module !== 'undefined' && module.exports)
  ? Object.assign({}, require('../fog/fogGeometry.js'), require('../shapes/presetGeometry.js'), require('./mcpPlan.js'),
    require('../render/effectMaterials.js'))
  : { circleVertices, presetRings, EFFECT_PRESETS, GRID_FT, mcpCleanHex, EFFECT_MATERIALS };

const MCP_GRID_TYPES = { square: 'square', hex: 'hex-pointy' };
// Off drawGridLines (grid.js): a hex grid's cellSize is the corner radius, which is also a side's length.
const MCP_GRID_HEX = { stepX: Math.sqrt(3), stepY: 1.5 };
const MCP_GRID_CELL = { min: 10, max: 400 };
const MCP_GRID_LINE = { min: 1, max: 10 };
// The effect shapes with a size, in the DM's words, and the preset each is.
const MCP_FX_PRESETS = { square: 'rect', circle: 'circle', cone: 'cone', line: 'line', wall: 'wall', ring: 'ring' };

const _mgPhase = (v, step) => ((v % step) + step) % step;
const _mgR2 = n => Math.round(n * 100) / 100;
const _mgNum = v => (v === null || v === undefined || v === '' ? NaN : Number(v));
const mcpFxName = m => (MG.EFFECT_MATERIALS[m] && MG.EFFECT_MATERIALS[m].label) || m.charAt(0).toUpperCase() + m.slice(1);

// The stored phase that puts a grid crossing at (x, y) in map px, as gridCalWrite (gridCalibrate.js) stores a
// calibration. A hex grid's crossing is a cell's top corner, so that cell's centre lies one side length below it.
// ⚠ A hex lattice staggers every other row by half a step, so the x phase depends on the row.
function mcpGridPhase(mode, cell, x, y) {
  if (mode !== 'hex-pointy') return { offsetX: _mgPhase(x, cell), offsetY: _mgPhase(y, cell) };
  const px = cell * MCP_GRID_HEX.stepX, py = cell * MCP_GRID_HEX.stepY, cy = y + cell;
  const offsetY = _mgPhase(cy, py);
  const row = Math.round((cy - offsetY) / py);
  return { offsetX: _mgPhase(x - (row & 1) * px / 2, px), offsetY };
}

// A point given as { x, y } or [x, y] in percent of the map, as map px, or null when it is not one inside the map.
function mcpPctPoint(raw, mapW, mapH) {
  const [x, y] = Array.isArray(raw) ? raw.map(_mgNum) : raw && typeof raw === 'object' ? [_mgNum(raw.x), _mgNum(raw.y)] : [NaN, NaN];
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) return null;
  return { x: x / 100 * mapW, y: y / 100 * mapH };
}

// The grid config `cfg` with the call's changes, and the words for each. Every field the DM can set: on, type,
// colour, opacity (percent), line width, cell size (percent of the map's width) and the crossing it is fitted to.
function mcpGridArgs(a, cfg, mapW, mapH) {
  const out = { ...cfg }, said = [];
  const no = error => ({ error });
  if (a.on !== undefined) {
    if (typeof a.on !== 'boolean') return no('on must be true or false.');
    out.enabled = a.on;
    said.push(a.on ? 'turned it on' : 'turned it off');
  }
  if (a.type !== undefined) {
    const mode = MCP_GRID_TYPES[String(a.type).trim().toLowerCase()];
    if (!mode) return no('type must be square or hex.');
    out.mode = mode;
    said.push('made it ' + (mode === 'square' ? 'square' : 'hex'));
  }
  if (a.color !== undefined) {
    const hex = MG.mcpCleanHex(a.color);
    if (!hex) return no('color must be a hex colour such as #ffffff.');
    out.color = hex;
    said.push('colour ' + hex);
  }
  if (a.opacity !== undefined) {
    const n = _mgNum(a.opacity);
    if (!Number.isFinite(n) || n < 0 || n > 100) return no('opacity must be a percent from 0 to 100.');
    out.opacity = Math.round(n) / 100;
    said.push('opacity ' + Math.round(n) + '%');
  }
  if (a.lineWidth !== undefined) {
    const n = _mgNum(a.lineWidth);
    if (!Number.isInteger(n) || n < MCP_GRID_LINE.min || n > MCP_GRID_LINE.max) return no('lineWidth must be a whole number from 1 to 10.');
    out.lineWidth = n;
    said.push('line width ' + n);
  }
  if (a.cell !== undefined) {
    const n = _mgNum(a.cell), px = _mgR2(n / 100 * mapW);
    if (!Number.isFinite(n) || px < MCP_GRID_CELL.min || px > MCP_GRID_CELL.max) {
      return no('cell must make a cell of ' + MCP_GRID_CELL.min + ' to ' + MCP_GRID_CELL.max + ' map pixels: ' + _mgR2(MCP_GRID_CELL.min / mapW * 100)
        + '% to ' + _mgR2(MCP_GRID_CELL.max / mapW * 100) + '% of this map\'s width.');
    }
    out.cellSize = px;
    said.push('cell ' + px + ' px');
  }
  if (a.crossing !== undefined) {
    const at = mcpPctPoint(a.crossing, mapW, mapH);
    if (!at) return no('crossing must be { x, y } in percent of the map, each from 0 to 100.');
    Object.assign(out, mcpGridPhase(out.mode, out.cellSize, at.x, at.y));
    said.push('lined up on the crossing at ' + _mgR2(at.x / mapW * 100) + '%, ' + _mgR2(at.y / mapH * 100) + '%');
  }
  if (!said.length) return no('Nothing to change: give on, type, color, opacity, lineWidth, cell or crossing.');
  return { cfg: out, said };
}

// Map px per foot for a preset size, as presetPxPerFt (toolPreset.js) reads it: a hex cell is measured across.
function mcpPxPerFt(cfg) {
  const cell = Number(cfg && cfg.cellSize) || 70;
  return (String(cfg && cfg.mode || 'square').startsWith('hex') ? cell * MCP_GRID_HEX.stepX : cell) / MG.GRID_FT;
}

// An outline of at least three points in percent of the map, as map px, enclosing some area.
function mcpPctRing(raw, mapW, mapH) {
  if (!Array.isArray(raw) || raw.length < 3) return { error: 'outline must be a list of at least 3 points [x, y] in percent of the map.' };
  const pts = raw.map(p => mcpPctPoint(p, mapW, mapH));
  if (pts.some(p => !p)) return { error: 'Every outline point must be [x, y] in percent of the map, each from 0 to 100.' };
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
  if (Math.abs(a) < 1) return { error: 'The outline encloses no area: its points lie on one line.' };
  return { vertices: pts };
}

// An effect's shape from exactly one of outline, circle { x, y, radius } (radius in percent of the map's width) or
// preset { shape, feet, x, y, angle } as the Effects row offers it. `pxPerFt` is the map's (mcpPxPerFt).
function mcpFxShape(a, mapW, mapH, pxPerFt) {
  const given = ['outline', 'circle', 'preset'].filter(k => a[k] !== undefined);
  if (given.length !== 1) return { error: 'Give exactly one shape: outline, circle or preset.' };
  if (a.outline !== undefined) return mcpPctRing(a.outline, mapW, mapH);
  if (a.circle !== undefined) {
    const c = mcpPctPoint(a.circle, mapW, mapH), r = _mgNum(a.circle && a.circle.radius) / 100 * mapW;
    if (!c || !(r >= 1)) return { error: 'circle must be { x, y, radius } in percent of the map, its centre inside it and a radius above 0.' };
    return { vertices: MG.circleVertices(c, { x: c.x + r, y: c.y }) };
  }
  const p = a.preset || {}, kind = MCP_FX_PRESETS[String(p.shape || '').trim().toLowerCase()];
  if (!kind) return { error: 'preset.shape must be one of ' + Object.keys(MCP_FX_PRESETS).join(', ') + '.' };
  const sizes = MG.EFFECT_PRESETS[kind], size = sizes.find(z => z.s === _mgNum(p.feet));
  if (!size) return { error: 'A ' + p.shape + ' comes in ' + sizes[0].s + ' to ' + sizes[sizes.length - 1].s + ' feet, in steps of ' + MG.GRID_FT + '.' };
  const at = mcpPctPoint(p, mapW, mapH);
  if (!at) return { error: 'preset needs x and y in percent of the map, each from 0 to 100.' };
  const angle = p.angle === undefined ? 0 : _mgNum(p.angle);
  if (!Number.isFinite(angle)) return { error: 'preset.angle must be a number of degrees.' };
  const r = MG.presetRings(kind, size.s, size.w, at, angle * Math.PI / 180, pxPerFt);
  return r.holes ? { vertices: r.vertices, holes: r.holes } : { vertices: r.vertices };
}

// The effect material a name points at: { material } or { error }. Light is not an effect but a light.
function mcpFxMaterial(raw) {
  const m = String(raw || '').trim().toLowerCase();
  if (m === 'light') return { error: 'Light is a light, not an effect: use create_light.' };
  // The DM's name for a material (its label) names it as much as its key does.
  const key = Object.keys(MG.EFFECT_MATERIALS).find(k => k === m || MG.EFFECT_MATERIALS[k].label.toLowerCase() === m);
  if (key) return { material: key };
  return { error: 'material must be one of ' + Object.keys(MG.EFFECT_MATERIALS).map(mcpFxName).join(', ') + '.' };
}

// The one effect or light a call names: its index from read_scene (from 1), or for an effect its material when the
// map has only one of that. { i } (from 0) or { error }.
function mcpPickOne(list, raw, noun) {
  if (!list.length) return { error: 'The map has no ' + noun + 's.' };
  const range = 'an index from 1 to ' + list.length + ', as read_scene lists the ' + noun + 's';
  if (typeof raw === 'number' || /^\s*\d+\s*$/.test(String(raw))) {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= list.length ? { i: n - 1 } : { error: 'The ' + noun + ' must be ' + range + '.' };
  }
  const m = String(raw || '').trim().toLowerCase();
  if (noun !== 'effect' || !m) return { error: 'Give the ' + noun + ' as ' + range + '.' };
  const hits = list.map((e, i) => ((e.material || 'fire') === m ? i : -1)).filter(i => i >= 0);
  if (hits.length === 1) return { i: hits[0] };
  if (!hits.length) return { error: 'No effect on the map is ' + mcpFxName(m) + '. Give ' + range + '.' };
  return { error: 'The map has ' + hits.length + ' ' + mcpFxName(m) + ' effects, at indexes ' + hits.map(i => i + 1).join(', ') + '. Give the index.' };
}

// The answer to a delete without confirmed.
function mcpFxWouldDelete(what, mapName) {
  return 'Would delete ' + what + ' from the map "' + mapName + '". Nothing was deleted. Tell the DM what goes and, on their yes, call again with confirmed: true.';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MCP_GRID_HEX, mcpGridPhase, mcpPctPoint, mcpGridArgs, mcpPxPerFt, mcpPctRing, mcpFxShape, mcpFxMaterial, mcpFxName,
    mcpPickOne, mcpFxWouldDelete };
}
