'use strict';

// effects.js — map effects: the `effects` array's model, its flaming-border render path, and the
// material swatches the toolbar picker paints itself with. The array and its id counter live in
// state.js beside `polygons`.
//
// AN EFFECT IS A POLYGON: the same record as a room, carrying a `material` where a room carries a
// fog `mode`. That is what lets the Select tool, vertex and edge dragging, corner rounding and
// Delete serve both from one set of paths in tools.js.
//
// What crosses to the Player is that record, never pixels — the Player paints the same fire from
// the same material name.
//
// THE LOOK IS A FLAMING FRAME (docs/DECISIONS.md, docs/PRODUCT.md). The outline burns with tongues
// that lick INWARD and dissolve, so the zone reads as holding the hazard rather than spilling it.
// PROCEDURAL, with no image assets: readymade fire clips smear when stretched to a room.
//
// ⚠ THE FIRE IS A SHADER OVER THE POLYGON'S OWN DISTANCE FIELD, never strokes. One PIXI.Mesh per
// effect covers the bounding box, and the fragment shader grows fire in the band just inside the
// edge — which is why it survives any drawn shape, rounded or not.
//
// Effects draw UNDER the fog on both screens, so an effect in an unexplored room is hidden for
// free — no stripping guard.

// Flame reach INTO the zone, in map units, tied to the grid so the fire stays proportional to the
// map whatever its resolution. Tongues pack about one grid cell apart, for the same reason.
function _gridCell() { return (typeof gridSize !== 'undefined' && gridSize) ? gridSize : 70; }
// About a quarter of a grid cell of inward reach at the tuned heightMul.
function _flameHeight() { return Math.max(20, Math.min(140, _gridCell() * 0.55 * FX_LOOK.heightMul)); }
// Cinder seam packs tongues about a third of a cell apart along the edge.
function _flameAlong()  { return 2.2 / Math.max(24, _gridCell()); }

// ─── The effects array ────────────────────────────────────────────────────────

// Called by tools.js when a shape is committed in Effects mode. Takes the SAME vertex list a room
// would have been built from.
function addEffect(vertices) {
  pushUndo();
  const id = nextEffectId++;
  const mat = EFFECT_MATERIALS[currentMaterial] ? currentMaterial : 'fire';
  const e = { id, vertices, material: mat, cornerRadius: 0,
              name: mat.charAt(0).toUpperCase() + mat.slice(1) + ' ' + id };
  effects.push(e);
  effectsChanged();
  // Rides the Auto/Manual sync gate exactly as a fog reveal does. scheduleAutoSync sends fog and
  // effects together, so the two never disagree about when the Player updates.
  if (!isPlayer) { scheduleAutoSync(); scheduleAutoSave(); }
  return e;
}

// Replace the whole list — a scene load, an undo, or a Player receiving a push.
function setEffects(list) {
  effects = (list || []).map(copyShapeRings);
  effectsChanged();
}

function clearEffects() {
  if (!effects.length) return;
  effects = [];
  effectsChanged();
}

// The one hook that tells the render path the array changed. A function rather than a shared dirty
// flag, so the graphics bookkeeping stays inside this file.
let _effectSpritesDirty = false;
function effectsChanged() {
  _effectSpritesDirty = true;
  // The grid's ember relight (grid.js) lives on the grid canvas, not here, so a change to the
  // effects has to redraw the grid too. On the Player that promotes to a viewport redraw.
  if (typeof gridDirty !== 'undefined') gridDirty = true;
  // ⚠ AND ASK FOR THE FRAME. The fire rides the ticker, but the ember grid is Canvas-2D and only
  // paints inside doRender, which nothing else schedules when a new effect list arrives.
  if (typeof scheduleRender === 'function') scheduleRender();
}

// One PIXI.Mesh per effect, its geometry the shape's bounding box in MAP coordinates. The fragment
// shader does the rest from the polygon's vertices, passed as a uniform.
const _fxInstances = new Map();   // effect id → { mesh, geom, buf, verts:Float32Array, geomKey }
let _fxLayerRef = null;           // which pixiEffectsLayer the meshes were built against

// Trace the outline as POINTS with the corners rounded — buildRoundedPolyPath's fillet geometry,
// sampled into vertices the distance shader can walk, which is what rounds an effect's fire. Each
// corner becomes a short arc, decimated to fit the shader's vertex cap.
function _roundRing(verts, defaultR, perVertR, offset, handles) {
  const n = verts.length;
  if (n < 3) return verts.map(v => ({ x: v.x, y: v.y }));
  // An anchor with handles is sharp, matching buildRoundedPolyPath: a radius needs two straight
  // tangents and a bent wall gives it neither.
  const getR = i => handleAt(handles, offset + i) ? 0
                  : ((perVertR && perVertR[offset + i] != null) ? perVertR[offset + i] : defaultR);
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = getR(i) || 0;
    const prev = verts[(i - 1 + n) % n], curr = verts[i], next = verts[(i + 1) % n];
    const dPrev = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const dNext = Math.hypot(next.x - curr.x, next.y - curr.y);
    if (r <= 0 || dPrev === 0 || dNext === 0) { out.push({ x: curr.x, y: curr.y }); pushCurve(i); continue; }
    const maxR = Math.min(r, dPrev / 2, dNext / 2);
    const ux = (prev.x - curr.x) / dPrev, uy = (prev.y - curr.y) / dPrev;
    const vx = (next.x - curr.x) / dNext, vy = (next.y - curr.y) / dNext;
    let bx = ux + vx, by = uy + vy;
    const bl = Math.hypot(bx, by);
    if (bl < 1e-4) { out.push({ x: curr.x, y: curr.y }); continue; }   // straight run, no corner
    bx /= bl; by /= bl;
    const dot = Math.max(-1, Math.min(1, ux * vx + uy * vy));
    const sinHalf = Math.sqrt(Math.max(1e-6, (1 - dot) / 2));
    const distC = maxR / sinHalf;
    const cx = curr.x + bx * distC, cy = curr.y + by * distC;
    const t1x = curr.x + ux * maxR, t1y = curr.y + uy * maxR;
    const t2x = curr.x + vx * maxR, t2y = curr.y + vy * maxR;
    let a1 = Math.atan2(t1y - cy, t1x - cx), a2 = Math.atan2(t2y - cy, t2x - cx);
    let da = a2 - a1;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const steps = Math.max(2, Math.round(Math.abs(da) / 0.4));
    for (let s = 0; s <= steps; s++) {
      const a = a1 + da * (s / steps);
      out.push({ x: cx + Math.cos(a) * maxR, y: cy + Math.sin(a) * maxR });
    }
    pushCurve(i);
  }
  return out;

  // The wall LEAVING vertex i, sampled when it is bent. The shader walks straight points only, so
  // a curved effect spends more of the vertex cap than a straight one and decimates sooner.
  function pushCurve(i) {
    const j = (i + 1) % n;
    if (!edgeIsCurved(handles, offset + i, offset + j)) return;
    const c = edgeCubic(verts[i], verts[j], handleAt(handles, offset + i), handleAt(handles, offset + j));
    const pts = sampleCubic(c[0], c[1], c[2], c[3], CURVE_SAMPLE_STEPS);
    pts.pop();                        // the wall's far anchor is the next turn's own point
    for (const pt of pts) out.push(pt);
  }
}

function _decimate(ring, cap) {
  if (ring.length <= cap) return ring;
  const keep = [], stride = ring.length / cap;
  for (let i = 0; i < cap; i++) keep.push(ring[Math.floor(i * stride)]);
  return keep;
}

// ⚠ EACH RING IS DECIMATED ON ITS OWN, never the concatenation: one stride walks over a ring
// boundary and can leave a small hole with a single point. The budget is shared in proportion to
// raw ring length, with a floor of three points per ring.
function _roundedPolyRings(poly, defaultR, perVertR) {
  const rings = polyRings(poly);
  const rounded = [];
  let offset = 0;
  for (const ring of rings) {
    rounded.push(_roundRing(ring, defaultR, perVertR, offset, poly.handles));
    offset += ring.length;
  }
  const total = rounded.reduce((t, r) => t + r.length, 0);
  if (total <= MAX_FX_VERTS) return rounded;
  const floor = 3;
  const spare = MAX_FX_VERTS - floor * rounded.length;
  if (spare <= 0) return rounded.map(r => _decimate(r, Math.max(1, Math.floor(MAX_FX_VERTS / rounded.length))));
  const caps = rounded.map(r => floor + Math.floor(spare * (r.length / total)));
  return rounded.map((r, i) => _decimate(r, caps[i]));
}

// The bounding box, padded to give the atmosphere room: a little on the sides for spark drift and
// the soft edge, and MORE on top (smaller y) so haze can climb above the zone.
function _fxQuad(verts, cell) {
  let loX = Infinity, loY = Infinity, hiX = -Infinity, hiY = -Infinity;
  for (const v of verts) {
    if (v.x < loX) loX = v.x; if (v.x > hiX) hiX = v.x;
    if (v.y < loY) loY = v.y; if (v.y > hiY) hiY = v.y;
  }
  const side = cell * 0.9, top = cell * 2.7;
  loX -= side; hiX += side; hiY += side; loY -= top;
  return new Float32Array([loX, loY, hiX, loY, hiX, hiY, loX, hiY]);
}

function _fxGeomKey(e) {
  // Corner radius is part of the shape now, so a rounding change reloads the outline.
  let k = (e.cornerRadius || 0) + '|' + (e.cornerRadii ? e.cornerRadii.join(',') : '') + '|';
  for (const ring of polyRings(e)) {
    for (const v of ring) k += (v.x | 0) + ',' + (v.y | 0) + ';';
    k += '/';
  }
  return k;
}

function _destroyFxInstance(inst) {
  for (const m of [inst.meshLight, inst.meshDark]) {
    if (m.parent) m.parent.removeChild(m);
    m.destroy();          // leaves the shared geometry and the cached shader alone
  }
  inst.geom.destroy();
}

// Load an effect's vertices into both meshes: the polygon into each shader uniform, the bounding
// box into the shared geometry. Called on create and whenever the shape moves.
function _loadFxGeometry(inst, e) {
  const rings = _roundedPolyRings(e, e.cornerRadius || 0, e.cornerRadii || null);
  // ⚠ uBreak IS DERIVED AFTER DECIMATION, or a ring that lost points closes in the wrong place.
  inst.verts.fill(0);
  inst.breaks.fill(0);
  let n = 0;
  for (const ring of rings) {
    if (ring.length < 3 || n >= MAX_FX_VERTS) continue;
    inst.breaks[n] = 1;
    for (const v of ring) {
      if (n >= MAX_FX_VERTS) break;
      inst.verts[n * 2] = v.x; inst.verts[n * 2 + 1] = v.y; n++;
    }
  }
  const warm = (EFFECT_MATERIALS[e.material] || EFFECT_MATERIALS.fire).warm;
  const ramp = effectRamp(e.material);
  let cx = 0, cy = 0;
  for (const v of e.vertices) { cx += v.x; cy += v.y; }
  const cen = [cx / e.vertices.length, cy / e.vertices.length];
  for (const m of [inst.meshLight, inst.meshDark]) {
    const u = m.shader.uniforms;
    u.uVerts = inst.verts; u.uBreak = inst.breaks; u.uCount = n;
    u.uWarm = warm; u.uCentroid = cen; u.uRamp = ramp;
  }
  inst.geom.getBuffer('aVertexPosition').update(_fxQuad(rings[0] || e.vertices, _gridCell()));
}

function _syncFxInstances() {
  _effectSpritesDirty = false;
  const live = new Set(effects.map(e => e.id));
  for (const [id, inst] of _fxInstances) {
    if (!live.has(id)) { _destroyFxInstance(inst); _fxInstances.delete(id); }
  }
  for (const e of effects) {
    if (!e.vertices || e.vertices.length < 3) continue;
    let inst = _fxInstances.get(e.id);
    if (!inst) {
      const verts = new Float32Array(MAX_FX_VERTS * 2);
      const breaks = new Float32Array(MAX_FX_VERTS);
      const geom = new PIXI.Geometry()
        .addAttribute('aVertexPosition', new Float32Array(8), 2)
        .addIndex([0, 1, 2, 0, 2, 3]);
      const mkShader = frag => PIXI.Shader.from(_FX_VERT, frag, {
        uVerts: verts, uBreak: breaks,
        uCount: 0, uTime: 0, uHeight: 40, uSpeed: FX_LOOK.speed, uAlong: 0.03,
        uDiss: FX_LOOK.diss, uWarm: 0.30, uFill: FX_LOOK.fill, uG: 70, uRamp: effectRamp('fire'),
        uSpark: FX_LOOK.spark, uSmoke: FX_LOOK.smoke, uHaze: FX_LOOK.haze, uCentroid: [0, 0],
      });
      // Two meshes over one shape: the light pass adds fire/sparks, the dark pass (on top) darkens
      // with smoke/haze. Dark last so its smoke reads over the fire.
      const meshLight = new PIXI.Mesh(geom, mkShader(_FX_FRAG_LIGHT));
      meshLight.blendMode = PIXI.BLEND_MODES.ADD;
      const meshDark = new PIXI.Mesh(geom, mkShader(_FX_FRAG_DARK));
      meshDark.blendMode = PIXI.BLEND_MODES.NORMAL;
      pixiEffectsLayer.addChild(meshLight);
      pixiEffectsLayer.addChild(meshDark);
      inst = { meshLight, meshDark, geom, verts, breaks, geomKey: null };
      _fxInstances.set(e.id, inst);
    }
    const key = _fxGeomKey(e);
    if (inst.geomKey !== key) { inst.geomKey = key; _loadFxGeometry(inst, e); }
  }
}

// Runs on the PixiJS ticker via render.js's pumpDirtyRender, so it shares the app's one clock and
// its frame cap. Returns immediately when nothing is placed.
function pumpEffects() {
  if (!pixiEffectsLayer) return;
  // A renderer teardown leaves every mesh ref pointing at a destroyed display list. Rebuild
  // against the new layer rather than trying to salvage them.
  if (_fxLayerRef !== pixiEffectsLayer) {
    _fxInstances.clear();
    _fxLayerRef = pixiEffectsLayer;
    _effectSpritesDirty = true;
  }
  if (_effectSpritesDirty) _syncFxInstances();
  if (!_fxInstances.size) return;

  const t = performance.now() / 1000;
  const height = _flameHeight(), along = _flameAlong(), cell = _gridCell();
  for (const e of effects) {
    const inst = _fxInstances.get(e.id);
    if (!inst) continue;
    // Only the four that move: the clock, and the three tied to grid size, which the DM can change
    // under a placed effect. FX_LOOK is seeded once in mkShader.
    for (const m of [inst.meshLight, inst.meshDark]) {
      const u = m.shader.uniforms;
      u.uTime = t; u.uHeight = height; u.uAlong = along; u.uG = cell;
    }
  }
}
