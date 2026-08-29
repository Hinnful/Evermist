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

// ─── Materials ────────────────────────────────────────────────────────────────
// A material is a warmth (0 = red ember, 1 = white-hot) plus the swatch colours.
//
// ⚠ FIRE IS THE ONLY ONE, AND A SECOND ENTRY IS NOT ENOUGH TO ADD ONE. The shader's colour ramp is
// hardcoded orange and reads only `warm`, so a green entry ships a green button that paints orange
// fire. Make the ramp read the material's own colours first.
// `glow` and `core` reach the swatch and nothing else. They are what the ramp will need.
const EFFECT_MATERIALS = {
  fire: { warm: 0.30, glow: 0xff5a1e, core: 0xffe0a0 },
};

// The settled look — the "Cinder seam" border plus the interior and atmosphere. ⚠ The app's one
// look, with no UI that edits it. Change a value only on a fresh look call from the DM.
// The grid relight is separate, in grid.js, because the map grid is a canvas above this layer.
const FX_LOOK = { heightMul: 0.50, speed: 1.00, diss: 0.55, fill: 0.20,
                  spark: 1.00, smoke: 0.40, haze: 0.70, gridGlow: 0.60 };

// The editing outline for a selected or previewed effect, separate from the burning render. A
// different colour family from POLY_EDGE_COLORS, so an effect never reads as a fourth fog state.
const EFFECT_EDGE_COLOR = '#ff8a3d';

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
  effects = (list || []).map(e => ({ ...e, vertices: e.vertices.map(v => ({ ...v })) }));
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

// ─── Rendering ────────────────────────────────────────────────────────────────
// One PIXI.Mesh per effect, its geometry the shape's bounding box in MAP coordinates. The fragment
// shader does the rest from the polygon's vertices, passed as a uniform.
const MAX_FX_VERTS = 64;
const _fxInstances = new Map();   // effect id → { mesh, geom, buf, verts:Float32Array, geomKey }
let _fxLayerRef = null;           // which pixiEffectsLayer the meshes were built against

const _FX_VERT = `
attribute vec2 aVertexPosition;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
varying vec2 vMap;
void main(){
  vMap = aVertexPosition;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

// Shared prefix for both passes: uniforms and the geometry/colour helpers.
const _FX_COMMON = `
precision highp float;
varying vec2 vMap;
uniform vec2 uVerts[${MAX_FX_VERTS}];
uniform int uCount;
uniform float uTime, uHeight, uSpeed, uAlong, uDiss, uWarm;
uniform float uFill;    // interior warm-wash opacity
uniform float uG;       // grid cell in map units — the scale unit for sparks/haze
uniform float uSpark;   // ember sparks over the zone
uniform float uSmoke;   // dark smoke-flames on the border
uniform float uHaze;    // soft haze rising above the zone
uniform vec2  uCentroid;// zone centre, so haze knows which way is "above"

float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  float a=hash(i), b=hash(i+vec2(1.,0.)), c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.));
  vec2 u=f*f*(3.-2.*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.03+vec2(11.,7.); a*=.5; } return v; }

// Signed distance to the polygon (negative inside), the outward normal, and the nearest outline
// point. ⚠ Carries the previous vertex across the loop, so only the loop index touches the uniform
// array — WebGL1 does not guarantee dynamic array indexing.
void polyInfo(vec2 p, out float sd, out vec2 nrm, out vec2 near){
  vec2 vlast = uVerts[0];
  for(int i=0;i<${MAX_FX_VERTS};i++){ if(i>=uCount) break; vlast = uVerts[i]; }
  float dmin = 1e12, s = 1.0; vec2 closest = p, vb = vlast;
  for(int i=0;i<${MAX_FX_VERTS};i++){
    if(i>=uCount) break;
    vec2 va = uVerts[i];
    vec2 e = vb - va, w = p - va;
    float t = clamp(dot(w,e)/max(dot(e,e),1e-6), 0.0, 1.0);
    vec2 pr = w - e*t;
    float dd = dot(pr,pr);
    if(dd < dmin){ dmin = dd; closest = va + e*t; }
    bvec3 c = bvec3(p.y>=va.y, p.y<vb.y, e.x*w.y > e.y*w.x);
    if(all(c) || all(not(c))) s = -s;
    vb = va;
  }
  sd = s*sqrt(dmin);
  near = closest;
  nrm = normalize((p - closest) + 1e-5) * s;   // s flips it to point OUT of the shape
}
vec3 fireRamp(float t){
  t = clamp(t,0.,1.);
  vec3 c = mix(vec3(0.05,0.01,0.0), vec3(0.55,0.06,0.01), smoothstep(0.0,0.22,t));
  c = mix(c, vec3(1.0,0.36,0.05), smoothstep(0.18,0.5,t));
  c = mix(c, vec3(1.0,0.72,0.22), smoothstep(0.5,0.78,t));
  c = mix(c, mix(vec3(1.0,0.85,0.5), vec3(1.0,0.97,0.85), uWarm), smoothstep(0.78,1.0,t));
  return c;
}
// Straight-alpha "over" for the dark pass's premultiplied accumulation.
void over(inout vec4 dst, vec3 c, float a){
  a = clamp(a, 0.0, 1.0);
  dst.rgb = c*a + dst.rgb*(1.0 - a);
  dst.a   = a + dst.a*(1.0 - a);
}
`;

// LIGHT pass (ADD blend): fire, interior fill and sparks — everything that emits light. Kept
// additive so the border keeps the glow the DM approved; a normal blend dimmed it.
const _FX_FRAG_LIGHT = _FX_COMMON + `
void main(){
  vec2 p = vMap;
  float d; vec2 n, seed;
  polyInfo(p, d, n, seed);
  if(d > 1.5) discard;                         // light only inside the zone
  float inside = smoothstep(1.5, -2.0, d);
  float inward = -d;

  vec3 acc = vec3(0.0);

  // interior wash
  float fillFall = clamp(1.0 - inward/(uHeight*3.0), 0.0, 1.0);
  acc += inside * uFill * (0.45 + 0.55*fillFall) * fireRamp(0.5);

  // flaming border: tongues licking inward, tips dissolving into embers
  float hf = 0.30 + 0.95*fbm(seed*uAlong + vec2(uTime*uSpeed*0.9, 0.0));
  hf *= 0.70 + 0.55*fbm(seed*uAlong*2.6 + vec2(uTime*uSpeed*2.2, 5.0));
  float k = inward / max(3.0, uHeight*hf);
  float inten = 1.0 - k;
  inten *= smoothstep(-1.0, 1.5, inward);
  float ember = fbm(p*0.02 - n*uTime*uSpeed*1.6);
  inten -= smoothstep(0.25, 1.0, k) * ember * uDiss;
  inten = clamp(inten, 0.0, 1.0);
  inten *= smoothstep(0.03, 0.16, inten);
  inten *= inten;
  acc += fireRamp(inten) * inten;

  // sparks: embers scattered over the zone, rising and wandering on their own life cycle
  if(uSpark > 0.001 && inside > 0.01){
    float CS = uG * 0.95;
    vec2 cell = floor(p / CS);
    float r1 = hash(cell), r2 = hash(cell + 7.3), r3 = hash(cell + 3.1);
    float on = step(0.60, r2);
    float age = fract(uTime * (0.18 + 0.22*r3) + r1);
    vec2 base = (cell + 0.5) * CS + (vec2(r1,r2) - 0.5) * CS * 0.7;
    float wander = fbm(base*(2.0/uG) + uTime*0.2 + r1*10.0) - 0.5;
    vec2 pos = base + vec2(wander * uG*0.7, -age * uG*1.2)
                    + vec2(sin(uTime*1.6 + r1*20.0), cos(uTime*1.3 + r2*17.0)) * uG*0.08;
    float dot = smoothstep(uG*0.045, 0.0, length(p - pos));
    float life = sin(age * 3.14159);
    acc += uSpark * dot * life * on * inside * vec3(1.0,0.72,0.35) * 2.2;
  }

  float a = clamp(max(acc.r, max(acc.g, acc.b)), 0.0, 1.0);
  if(a <= 0.001) discard;
  gl_FragColor = vec4(acc, a);   // ADD blend: this light is added to the map
}`;

// DARK pass (NORMAL blend): smoke and haze — the layers that DARKEN the map, which an additive
// pass cannot do. Runs on its own mesh over the same shape, on top of the light pass.
const _FX_FRAG_DARK = _FX_COMMON + `
void main(){
  vec2 p = vMap;
  float d; vec2 n, seed;
  polyInfo(p, d, n, seed);
  float hazeReach = uG * 2.5;                   // how far above the zone haze can climb
  if(d > hazeReach) discard;
  float inward = -d;

  vec4 R = vec4(0.0);                           // premultiplied, composited back-to-front

  // haze: soft grey over the WHOLE zone, thinning as it climbs above the top edge.
  // ⚠ NEVER GATE IT ON BEING NEAR THE EDGE, or it reads as a second smoke band on the outline.
  if(uHaze > 0.001){
    float within = smoothstep(1.0, -2.0, d);                  // full strength anywhere inside
    float above  = smoothstep(0.0, -uG*2.2, p.y - uCentroid.y);
    float rise   = smoothstep(hazeReach, 0.0, d) * above;     // outside, and only overhead
    float hz = smoothstep(0.35, 0.9, fbm(p*(1.6/uG) + vec2(uTime*0.15, -uTime*uSpeed*0.6)));
    over(R, vec3(0.10,0.10,0.12), uHaze * max(within, rise) * hz * 0.7);
  }

  // smoke: a second layer of dark flames on the border, over the fire
  if(uSmoke > 0.001){
    float shf = 0.30 + 0.95*fbm(seed*uAlong*0.85 + vec2(uTime*uSpeed*0.5 + 40.0, 0.0));
    shf *= 0.70 + 0.55*fbm(seed*uAlong*1.9 + vec2(uTime*uSpeed*1.1, 20.0));
    float smk = clamp(1.0 - inward / max(6.0, uHeight*1.5*shf), 0.0, 1.0);
    smk *= smoothstep(-1.5, 2.0, inward);
    smk *= smoothstep(0.06, 0.35, smk);
    over(R, vec3(0.03,0.03,0.035), uSmoke * smk * 0.8);
  }

  if(R.a <= 0.001) discard;
  gl_FragColor = R;   // NORMAL blend, premultiplied: darkens the map
}`;

// Trace the outline as POINTS with the corners rounded — buildRoundedPolyPath's fillet geometry,
// sampled into vertices the distance shader can walk, which is what rounds an effect's fire. Each
// corner becomes a short arc, decimated to fit the shader's vertex cap.
function _roundedPolyPoints(verts, defaultR, perVertR) {
  const n = verts.length;
  if (n < 3) return verts.map(v => ({ x: v.x, y: v.y }));
  const getR = i => (perVertR && perVertR[i] != null) ? perVertR[i] : defaultR;
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = getR(i) || 0;
    const prev = verts[(i - 1 + n) % n], curr = verts[i], next = verts[(i + 1) % n];
    const dPrev = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const dNext = Math.hypot(next.x - curr.x, next.y - curr.y);
    if (r <= 0 || dPrev === 0 || dNext === 0) { out.push({ x: curr.x, y: curr.y }); continue; }
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
  }
  // Fit the shader's vertex cap by even decimation, never a hard truncation that would leave a
  // gap where the outline wrapped.
  if (out.length <= MAX_FX_VERTS) return out;
  const keep = [], stride = out.length / MAX_FX_VERTS;
  for (let i = 0; i < MAX_FX_VERTS; i++) keep.push(out[Math.floor(i * stride)]);
  return keep;
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
  for (const v of e.vertices) k += (v.x | 0) + ',' + (v.y | 0) + ';';
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
  const pts = _roundedPolyPoints(e.vertices, e.cornerRadius || 0, e.cornerRadii || null);
  const n = Math.min(pts.length, MAX_FX_VERTS);
  inst.verts.fill(0);
  for (let i = 0; i < n; i++) { inst.verts[i * 2] = pts[i].x; inst.verts[i * 2 + 1] = pts[i].y; }
  const warm = (EFFECT_MATERIALS[e.material] || EFFECT_MATERIALS.fire).warm;
  let cx = 0, cy = 0;
  for (const v of e.vertices) { cx += v.x; cy += v.y; }
  const cen = [cx / e.vertices.length, cy / e.vertices.length];
  for (const m of [inst.meshLight, inst.meshDark]) {
    const u = m.shader.uniforms;
    u.uVerts = inst.verts; u.uCount = n; u.uWarm = warm; u.uCentroid = cen;
  }
  inst.geom.getBuffer('aVertexPosition').update(_fxQuad(pts, _gridCell()));
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
      const geom = new PIXI.Geometry()
        .addAttribute('aVertexPosition', new Float32Array(8), 2)
        .addIndex([0, 1, 2, 0, 2, 3]);
      const mkShader = frag => PIXI.Shader.from(_FX_VERT, frag, {
        uVerts: verts, uCount: 0, uTime: 0, uHeight: 40, uSpeed: FX_LOOK.speed, uAlong: 0.03,
        uDiss: FX_LOOK.diss, uWarm: 0.30, uFill: FX_LOOK.fill, uG: 70,
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
      inst = { meshLight, meshDark, geom, verts, geomKey: null };
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
