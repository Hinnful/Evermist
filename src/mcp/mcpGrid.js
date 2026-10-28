'use strict';
// mcpGrid.js — Claude's grid, effect and light tools. Every change goes through mcpEditMap (mcpMapEdit.js), so a
// map the DM has open changes on their screen, a closed one in the store, and the TV's map is refused.
// Effects live in `effects`, lights in `lightShapes`; the two share nextEffectId.

const _mcpSeenNow = s => (_mcpHolder(s.id) === 'here' ? ' The DM has it open and sees the change now.' : '');
const _mcpFxLabel = (e, i) => 'the effect ' + (i + 1) + ' (' + (e.name || mcpFxName(e.material || 'fire')) + ')';

async function _mcpSetGrid(args) {
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  const s = found.scene;
  let said = [];
  const edit = await mcpEditMap(s, 'changing its grid', ['grid'], d => {
    const r = mcpGridArgs(args, d.gridConfig, d.mapWidth, d.mapHeight);
    if (r.error) return r.error;
    d.gridConfig = r.cfg;
    said = r.said;
  });
  if (edit.no) return edit.no;
  return mcpDone('changed the grid of the map "' + s.name + '"', edit.undo,
    'Changed the grid of the map "' + s.name + '": ' + said.join(', ') + '.' + _mcpSeenNow(s));
}

// A shape from the call, measured against the map's own grid when it is a preset size.
async function _mcpFxShapeOf(s, args, d) {
  const grid = args.preset !== undefined ? (await _mcpSeeRecord(s)).gridConfig || captureGridConfig() : null;
  return mcpFxShape(args, d.mapWidth, d.mapHeight, mcpPxPerFt(grid));
}

async function _mcpCreateEffect(args) {
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  const mat = mcpFxMaterial(args.material);
  if (mat.error) return _mcpNo(mat.error);
  const s = found.scene;
  let index = 0;
  const edit = await mcpEditMap(s, 'adding an effect to it', ['effects'], async d => {
    const r = await _mcpFxShapeOf(s, args, d);
    if (r.error) return r.error;
    const id = d.nextEffectId++;
    index = d.effects.push({ id, vertices: r.vertices, ...(r.holes ? { holes: r.holes } : {}), material: mat.material,
      cornerRadius: 0, name: mcpFxName(mat.material) + ' ' + id });
  });
  if (edit.no) return edit.no;
  return mcpDone('added a ' + mcpFxName(mat.material) + ' effect to the map "' + s.name + '"', edit.undo,
    'Added a ' + mcpFxName(mat.material) + ' effect to the map "' + s.name + '", as effect ' + index + '.' + _mcpSeenNow(s));
}

async function _mcpEditEffect(args) {
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  const mat = args.material === undefined ? null : mcpFxMaterial(args.material);
  if (mat && mat.error) return _mcpNo(mat.error);
  const reshape = ['outline', 'circle', 'preset'].some(k => args[k] !== undefined);
  if (!mat && !reshape) return _mcpNo('Nothing to change: give material or a new shape (outline, circle or preset).');
  const s = found.scene;
  let label = '';
  const edit = await mcpEditMap(s, 'changing its effects', ['effects'], async d => {
    const pick = mcpPickOne(d.effects, args.effect, 'effect');
    if (pick.error) return pick.error;
    const e = d.effects[pick.i];
    label = _mcpFxLabel(e, pick.i);
    if (reshape) {
      const r = await _mcpFxShapeOf(s, args, d);
      if (r.error) return r.error;
      // The old corners, curves and holes belong to the old outline.
      for (const k of ['holes', 'cornerRadii', 'handles']) delete e[k];
      Object.assign(e, { vertices: r.vertices, cornerRadius: 0 }, r.holes ? { holes: r.holes } : {});
    }
    if (mat) e.material = mat.material;
  });
  if (edit.no) return edit.no;
  const what = [mat && 'made it ' + mcpFxName(mat.material), reshape && 'gave it a new shape'].filter(Boolean).join(' and ');
  return mcpDone('changed ' + label + ' on the map "' + s.name + '"', edit.undo,
    'Changed ' + label + ' on the map "' + s.name + '": ' + what + '.' + _mcpSeenNow(s));
}

// The delete pattern for one effect or light: without confirmed it only answers with what would go.
async function _mcpDeleteOne(args, part, noun) {
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  const s = found.scene, key = part === 'effects' ? 'effects' : 'lightShapes';
  let label = '', would = null;
  const edit = await mcpEditMap(s, 'deleting its ' + noun + 's', [part], d => {
    const pick = mcpPickOne(d[key], args[noun], noun);
    if (pick.error) return pick.error;
    label = noun === 'effect' ? _mcpFxLabel(d[key][pick.i], pick.i) : 'the light ' + (pick.i + 1);
    if (args.confirmed !== true) { would = mcpFxWouldDelete(label, s.name); return would; }
    d[key].splice(pick.i, 1);
  });
  if (would) return _mcpOk(would);
  if (edit.no) return edit.no;
  return mcpDone('deleted ' + label + ' from the map "' + s.name + '"', edit.undo,
    'Deleted ' + label + ' from the map "' + s.name + '". Later ' + noun + 's moved up one index.' + _mcpSeenNow(s));
}

async function _mcpCreateLight(args) {
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  const s = found.scene;
  let index = 0;
  const edit = await mcpEditMap(s, 'adding a light to it', ['lights'], d => {
    const r = mcpPctRing(args.outline, d.mapWidth, d.mapHeight);
    if (r.error) return r.error;
    index = d.lightShapes.push({ id: d.nextEffectId++, vertices: r.vertices, cornerRadius: 0, light: true });
    d.lightsHidden = false;   // as addLightShape: a light drawn while they are hidden would be invisible
  });
  if (edit.no) return edit.no;
  return mcpDone('added a light to the map "' + s.name + '"', edit.undo,
    'Added a light to the map "' + s.name + '", as light ' + index + '. The map\'s lights are shown.' + _mcpSeenNow(s));
}

// The map's lights shown or hidden: the Scene control eye, which holds every light at once.
async function _mcpSetLights(args) {
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  if (typeof args.on !== 'boolean') return _mcpNo('on must be true or false.');
  const s = found.scene;
  const edit = await mcpEditMap(s, 'changing its lights', ['lights'], d => {
    if (!d.lightShapes.length) return 'The map "' + s.name + '" has no lights.';
    d.lightsHidden = !args.on;
  });
  if (edit.no) return edit.no;
  return mcpDone('turned the lights of the map "' + s.name + '" ' + (args.on ? 'on' : 'off'), edit.undo,
    'Turned the lights of the map "' + s.name + '" ' + (args.on ? 'on' : 'off') + '.' + _mcpSeenNow(s));
}

// The lights the app seeds from a floor plan (applyPlanLights, lights.js), replacing any drawn ones on a yes.
async function _mcpLightsFromPlan(args) {
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  const s = found.scene, plan = (await _mcpSeeRecord(s)).floorPlan;
  let made = 0, would = null, hidden = false;
  const edit = await mcpEditMap(s, 'changing its lights', ['lights'], d => {
    const lights = planLights(plan, d.mapWidth);
    if (!lights.length) return 'The map "' + s.name + '" has no floor plan with lights. The DM loads a .dd2vtt in the Lights row.';
    if (d.lightShapes.length && args.confirmed !== true) {
      would = mcpFxWouldDelete('its ' + d.lightShapes.length + ' drawn light' + (d.lightShapes.length === 1 ? '' : 's')
        + ', replaced by the floor plan\'s ' + lights.length, s.name);
      return would;
    }
    const derived = describePlan(plan);
    const rooms = derived ? vttScaleRooms(derived.rooms, d.mapWidth, derived.srcW) : [];
    d.lightShapes = seedLightShapes(lights, rooms).map(l => ({
      id: d.nextEffectId++, vertices: l.vertices, ...(l.holes ? { holes: l.holes } : {}), cornerRadius: 0, light: true }));
    made = d.lightShapes.length;
    hidden = d.lightsHidden;
  });
  if (would) return _mcpOk(would);
  if (edit.no) return edit.no;
  return mcpDone('drew the lights of the map "' + s.name + '" from its floor plan', edit.undo,
    'Drew ' + made + ' light' + (made === 1 ? '' : 's') + ' on the map "' + s.name + '" from its floor plan.'
    + (hidden ? ' The map\'s lights are turned off; set_lights turns them on.' : '') + _mcpSeenNow(s));
}

const MCP_GRID_TOOLS = { set_grid: _mcpSetGrid, create_effect: _mcpCreateEffect, edit_effect: _mcpEditEffect,
  delete_effect: args => _mcpDeleteOne(args, 'effects', 'effect'), create_light: _mcpCreateLight, set_lights: _mcpSetLights,
  lights_from_floor_plan: _mcpLightsFromPlan, delete_light: args => _mcpDeleteOne(args, 'lights', 'light') };
