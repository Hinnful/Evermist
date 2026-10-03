'use strict';
// lights.js — a scene's lights: polygons the DM draws or seeds from the floor plan, and the soft
// outline drawn round their union under the fog on both screens. The Player is sent the outlines.

const LIGHT_RGB = '#ffd98a';
const LIGHT_TEX_MAX = 2048;
// The glow's strength; where it differs by screen is in ARCHITECTURE.md.
const LIGHT_STRENGTH = 0.6;

// ─── The lights ───────────────────────────────────────────────────────────────

// The light the Select tool holds, in Effects mode.
function selectedLightShape() {
  return placeMode === 'effects' && selectedPolygonId != null
    ? lightShapes.find(l => l.id === selectedPolygonId) || null : null;
}

function effectPreviewRgb() { return currentMaterial === 'light' ? LIGHT_OUTLINE_RGB : EFFECT_RGB; }
function effectPreviewEdge() { return currentMaterial === 'light' ? LIGHT_RGB : EFFECT_EDGE_COLOR; }

// ⚠ NOT `flattenRing`: fogGeometry.js owns that name and returns points, which made every outline NaN.
function _flatPoints(pts) {
  const out = new Array(pts.length * 2);
  pts.forEach((v, i) => { out[i * 2] = Math.round(v.x * 10) / 10; out[i * 2 + 1] = Math.round(v.y * 10) / 10; });
  return out;
}

// One light's rings, corners and curves resolved the way an effect's are, as flat lists.
function _lightRings(shape) {
  const out = [];
  let offset = 0;
  for (const ring of polyRings(shape)) {
    const pts = roundEffectRing(ring, shape.cornerRadius || 0, shape.cornerRadii || null, offset, shape.handles);
    out.push(_flatPoints(pts));
    offset += ring.length;
  }
  return out;
}

function _liveLightPolys() {
  if (lightsHidden) return [];
  return lightShapes.filter(l => l.vertices && l.vertices.length >= 3).map(_lightRings);
}

// Every change to the lights ends here. The caller owns the Player push and the save.
function lightsChanged() {
  if (!isPlayer) lightPolys = _liveLightPolys();
  _lightsTexDirty = true;
  cursorDirty = true;   // the editing outlines are on the overlay canvas
  if (typeof scheduleRender === 'function') scheduleRender();
  if (typeof refreshLightsControlUI === 'function') refreshLightsControlUI();
}

function setLightShapes(list) {
  lightShapes = (list || []).map(copyShapeRings);
  lightsChanged();
}

// The scene's light fields, read with a default so a scene saved before lights opens with none.
function loadSceneLights(scene) {
  lightsHidden = !!scene.lightsHidden;
  lightShapes = (Array.isArray(scene.lightShapes) ? scene.lightShapes : [])
    .filter(l => l && Array.isArray(l.vertices)).map(copyShapeRings);
  // A light shares its id space with the fires, and scenes saved before they shared it can collide.
  const taken = new Set(effects.map(e => e.id));
  for (const l of lightShapes) {
    if (l.id == null || taken.has(l.id)) l.id = nextEffectId++;
    taken.add(l.id);
  }
  nextEffectId = Math.max(nextEffectId, ...lightShapes.map(l => l.id + 1));
  lightsChanged();
}

function lightsSceneFields() {
  return { lightsHidden, lightShapes: lightShapes.map(copyShapeRings) };
}

// An undo entry's lights, applied.
function restoreLights(s) {
  lightsHidden = s.lightsHidden;
  setLightShapes(s.lightShapes);
  updateContextPanels();
}

// The Player: the outlines it is sent. An empty list is meaningful, so only undefined is ignored.
function setLightPolys(list) {
  lightPolys = Array.isArray(list) ? list : [];
  _lightsTexDirty = true;
  scheduleRender();
}

// A hand-drawn light, from the shape tools and the Light preset.
function addLightShape(vertices) {
  pushUndo();
  const id = nextEffectId++;
  const l = { id, vertices, cornerRadius: 0, light: true };
  lightShapes.push(l);
  lightsHidden = false;   // a light drawn while they are hidden would be invisible
  lightsChanged();
  scheduleAutoSync();
  return l;
}

// One edit: undo first, then the change, the Player and the save.
function editLights(change) {
  pushUndo();
  change();
  lightsChanged();
  scheduleAutoSync();
}

function toggleLightsHidden() {
  editLights(() => { lightsHidden = !lightsHidden; });
}

// ─── From the floor plan ──────────────────────────────────────────────────────

function planLightCount() {
  return currentScene && currentScene.floorPlan ? planLights(currentScene.floorPlan, mapWidth).length : 0;
}

// One shape per light in the file, each as lightShapeFor works it out from the plan's rooms. The
// shapes are the DM's from then on: nothing follows the plan afterwards.
function applyPlanLights() {
  const lights = planLights(currentScene.floorPlan, mapWidth);
  if (!lights.length) return;
  const derived = describePlan(currentScene.floorPlan);
  const rooms = derived ? vttScaleRooms(derived.rooms, mapWidth, derived.srcW) : [];
  const seeded = seedLightShapes(lights, rooms);
  editLights(() => {
    lightShapes = seeded.map((s, i) => ({
      id: nextEffectId++, vertices: s.vertices, ...(s.holes ? { holes: s.holes } : {}), cornerRadius: 0, light: true,
    }));
    clearShapeSelection();
  });
  doAutoSave();
}

// A .dd2vtt picked in the Lights row: it becomes the scene's plan, as in the Rooms row, and its
// lights are drawn at once.
async function loadPlanLights(file) {
  if (!currentScene || !file) return;
  const text = await file.text().catch(() => '');
  if (!planLights(text, mapWidth).length) {
    messageDialog({ title: 'No lights in that file',
                    message: 'Evermist reads the lights in the .dd2vtt file Dungeon Alchemist exports beside a map. Nothing was changed.' });
    return;
  }
  currentScene.floorPlan = text;
  doAutoSave();
  refreshFloorPlanUI();
  drawPlanLights();
}

function drawPlanLights() {
  if (!planLightCount()) return;
  if (!lightShapes.length) { applyPlanLights(); return; }
  confirmDialog({
    title: 'Replace existing lights?',
    message: t('This scene has {n} drawn. Drawing from the floor plan removes them.',
               { n: t.plural(lightShapes.length, '{n} light', '{n} lights') }),
    confirmLabel: 'Replace them',
    cancelLabel: 'Keep them',
    danger: true,
    onConfirm: applyPlanLights,
  });
}

// ─── Fog on the TV ────────────────────────────────────────────────────────────

// Shrouded and half-shrouded ground draws no light on the TV. Half is the fog data's own partial
// alpha, so the cut sits just above 0.
const LIGHT_REVEALED_MAX_ALPHA = 3;
let _lightRevealBits = null, _lightRevealCanvas = null, _lightsFogDirty = false;

function lightsFogChanged() { _lightsFogDirty = true; }

function _refreshLightReveal() {
  _lightsFogDirty = false;
  if (!fogDataCanvas || !fogDataCtx) return;
  const w = fogDataCanvas.width, h = fogDataCanvas.height;
  const src = fogDataCtx.getImageData(0, 0, w, h).data;
  const bits = new Uint8Array(w * h);
  let changed = !_lightRevealBits || _lightRevealBits.length !== bits.length;
  for (let i = 0; i < bits.length; i++) {
    const b = src[i * 4 + 3] <= LIGHT_REVEALED_MAX_ALPHA ? 1 : 0;
    bits[i] = b;
    if (!changed && _lightRevealBits[i] !== b) changed = true;
  }
  if (!changed) return;
  _lightRevealBits = bits;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d'), img = cx.createImageData(w, h);
  for (let i = 0; i < bits.length; i++) if (bits[i]) img.data[i * 4 + 3] = 255;
  cx.putImageData(img, 0, 0);
  _lightRevealCanvas = c;
  _lightsTexDirty = true;
}

function _lightMaskedByFog(canvas) {
  if (!isPlayer || !_lightRevealCanvas) return canvas;
  const c = canvas.getContext('2d');
  c.globalCompositeOperation = 'destination-in';
  c.drawImage(_lightRevealCanvas, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// ─── The outline ──────────────────────────────────────────────────────────────

let _lightSprite = null, _lightsTexDirty = true, _lightLayerRef = null, _lightGridKey = 0;

// The union of the lit areas, drawn as light pooled along the inside of its edge: the area less its
// own blurred copy, so it is bright at the border and fades inward. A wide dim glow sits under a tight
// bright one for a smooth falloff. No fill and no line.
// Work canvases kept between rebuilds: a drag redraws on every move, and fresh ones are garbage.
const _lightScratch = [];
function _scratchLayer(i, W, H) {
  let k = _lightScratch[i];
  if (!k || k.width !== W || k.height !== H) { k = document.createElement('canvas'); k.width = W; k.height = H; _lightScratch[i] = k; }
  const c = k.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.filter = 'none';
  c.clearRect(0, 0, W, H);
  return k;
}

function _buildLightTexture(polys) {
  const scale = Math.min(1, LIGHT_TEX_MAX / Math.max(mapWidth, mapHeight));
  const W = Math.max(1, Math.round(mapWidth * scale)), H = Math.max(1, Math.round(mapHeight * scale));
  const cell = (gridSize > 0 ? gridSize : mapWidth / 30) * scale;
  const layer = () => { const k = document.createElement('canvas'); k.width = W; k.height = H; return k; };

  const mask = _scratchLayer(0, W, H), m = mask.getContext('2d');
  m.fillStyle = '#fff';
  for (const rings of polys) {
    m.beginPath();
    for (const flat of rings) {
      for (let i = 0; i < flat.length; i += 2) {
        if (i) m.lineTo(flat[i] * scale, flat[i + 1] * scale); else m.moveTo(flat[0] * scale, flat[1] * scale);
      }
      m.closePath();
    }
    m.fill('evenodd');
  }

  const out = layer(), o = out.getContext('2d');
  const glow = (blurPx, alpha) => {
    const blurred = _scratchLayer(1, W, H), b = blurred.getContext('2d');
    b.filter = `blur(${blurPx}px)`; b.drawImage(mask, 0, 0);
    const g = _scratchLayer(2, W, H), c = g.getContext('2d');
    c.drawImage(mask, 0, 0);
    c.globalCompositeOperation = 'destination-out'; c.drawImage(blurred, 0, 0);
    c.globalCompositeOperation = 'source-in'; c.fillStyle = LIGHT_RGB; c.fillRect(0, 0, W, H);
    o.globalAlpha = alpha; o.drawImage(g, 0, 0);
  };
  const k = _lightStrength();
  glow(cell * 0.85, 0.45 * k);
  glow(cell * 0.2, 0.9 * k);
  return out;
}

// Whole while a light is in hand on the DM map, picked or about to be drawn, otherwise 60%.
let _lightStrengthNow = LIGHT_STRENGTH;
function _lightStrength() {
  const inHand = placeMode === 'effects' && (currentMaterial === 'light' || selectedLightShape());
  return isPlayer || !inHand ? LIGHT_STRENGTH : 1;
}

// On the PixiJS ticker via pumpDirtyRender. Rebuilds only when the outlines, the map or the grid
// cell changed, never per frame.
function pumpLights() {
  if (!pixiEffectsLayer || !mapWidth) return;
  if (_lightLayerRef !== pixiEffectsLayer) {
    _lightLayerRef = pixiEffectsLayer; _lightSprite = null; _lightsTexDirty = true;
  }
  if (isPlayer && _lightsFogDirty) _refreshLightReveal();
  const gridKey = mapWidth * 1e6 + mapHeight * 1e3 + gridSize;
  if (gridKey !== _lightGridKey) { _lightGridKey = gridKey; _lightsTexDirty = true; }
  if (_lightStrength() !== _lightStrengthNow) { _lightStrengthNow = _lightStrength(); _lightsTexDirty = true; }
  if (!_lightsTexDirty) return;
  _lightsTexDirty = false;
  if (!lightPolys.length) { if (_lightSprite) _lightSprite.visible = false; return; }
  const tex = PIXI.Texture.from(_lightMaskedByFog(_buildLightTexture(lightPolys)));
  if (!_lightSprite) {
    _lightSprite = new PIXI.Sprite(tex);
    pixiEffectsLayer.addChildAt(_lightSprite, 0);
  } else {
    const old = _lightSprite.texture;
    _lightSprite.texture = tex;
    old.destroy(true);
  }
  _lightSprite.width = mapWidth; _lightSprite.height = mapHeight;
  _lightSprite.visible = true;
}

