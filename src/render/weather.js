'use strict';
// weather.js - weather over a map. One full-screen mesh between the map and the fog, a second one
// that fades the outgoing preset away, a mask of every room so nothing falls indoors, and the push
// of the preset and that mask to the TV. The numbers are weatherPlan.js's, the shader weatherShader.js's.
//
// ⚠ UNDER THE FOG ON BOTH SCREENS, which is what keeps weather off ground nobody has revealed. The
// layer sits above the map and below the effects, because the pass REPLACES map pixels.
// ⚠ NO WEATHER MEANS NO DRAW: the meshes are hidden and the pump returns on its first test, once the
// puddles and settled snow of the last preset have dried.

const WEATHER_DM_STRENGTH = 1 / 3;
const WEATHER_MASK_CHECK_MS = 500;

let _wxLayerRef = null;
let _wxGeom = null, _wxMain = null, _wxOld = null;
let _wxSize = '';
let _wxPrev = null, _wxPrevLevel = 1, _wxSwitchAt = 0;
let _wxLast = performance.now(), _wxSim = 0;
const _wxT0 = performance.now();
let _wxLevels = { wet: 0, snow: 0 };
let _wxNextFlash = 0, _wxFlashAt = -1e9, _wxGustNext = 0, _wxGust = null, _wxGustAt = 0;

let _wxMaskCvs = null, _wxMaskTex = null, _wxMaskKey = '', _wxMaskCheckAt = 0;
let _wxMaskUrl = null, _wxMaskDirty = false, _wxMaskSent = false, _wxSendPending = false;

function _wxActive() {
  return weatherId !== 'none' || !!_wxPrev || _wxLevels.wet > 0.001 || _wxLevels.snow > 0.001;
}

// instant: a map opening, which starts at the preset's settled levels with no fade. Otherwise the
// old preset stays on screen and fades out over the new one. Answers whether anything changed.
function setWeather(id, instant) {
  const next = weatherNormalize(id);
  if (instant) {
    weatherId = next;
    _wxPrev = null;
    _wxLevels = weatherStartLevels(WEATHER_PRESETS[next], _wxSim);
    _wxNextFlash = 0; _wxGustNext = 0;
    return true;
  }
  if (next === weatherId) return false;
  const now = performance.now();
  const e = weatherFadeCurve((now - _wxSwitchAt) / WEATHER_FADE_MS);
  const h = weatherHandover(_wxPrev, weatherId, _wxPrevLevel, e);
  _wxPrev = h.out; _wxPrevLevel = h.level;
  _wxSwitchAt = now;
  weatherId = next;
  _wxNextFlash = 0; _wxGustNext = 0;
  _wxSendPending = true;
  return true;
}

// What the DM's control does: in two-map mode the selected column owns the map.
function chooseWeather(id) {
  if (paneForward('weather', { id })) { refreshWeatherUI(weatherNormalize(id)); return; }
  applyWeatherChoice(id);
}

function applyWeatherChoice(id) {
  if (setWeather(id, false)) scheduleAutoSave();
  if (typeof refreshWeatherUI === 'function') refreshWeatherUI();
}

// ─── The room mask ────────────────────────────────────────────────────────────

function _wxSetMask(cvs) {
  const old = _wxMaskTex;
  _wxMaskCvs = cvs;
  _wxMaskTex = new PIXI.Texture(PIXI.BaseTexture.from(cvs, { scaleMode: PIXI.SCALE_MODES.LINEAR }));
  for (const m of [_wxMain, _wxOld]) if (m) m.shader.uniforms.uRoom = _wxMaskTex;
  if (old) old.baseTexture.destroy();
}

function _wxEmptyMask() {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  return c;
}

// DM only. Every polygon of the scene, whatever its fog mode, at the fog stencil's scale, drawn
// through the same rounded path the fog uses so a rounded or holed room matches.
function _wxRefreshMask(now) {
  if (now < _wxMaskCheckAt) return;
  _wxMaskCheckAt = now + WEATHER_MASK_CHECK_MS;
  const key = weatherRoomsKey(polygons) + '|' + mapWidth + 'x' + mapHeight;
  if (key === _wxMaskKey) return;
  _wxMaskKey = key;
  const w = Math.max(1, Math.ceil(mapWidth / FOG_SCALE)), h = Math.max(1, Math.ceil(mapHeight / FOG_SCALE));
  const fresh = !_wxMaskCvs || _wxMaskCvs.width !== w || _wxMaskCvs.height !== h;
  const cvs = fresh ? Object.assign(document.createElement('canvas'), { width: w, height: h }) : _wxMaskCvs;
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  const scale = ring => ring.map(v => ({ x: v.x / FOG_SCALE, y: v.y / FOG_SCALE }));
  for (const p of polygons) {
    if (!p.vertices || p.vertices.length < 3) continue;
    const cr = (p.cornerRadius || 0) / FOG_SCALE;
    const pv = p.cornerRadii ? p.cornerRadii.map(r => (r != null ? r : (p.cornerRadius || 0)) / FOG_SCALE) : null;
    ctx.beginPath();
    buildRoundedPolyPath(ctx, scale(p.vertices), cr, pv, polyHoleRings(p).map(scale), scaleHandles(p.handles, 1 / FOG_SCALE));
    ctx.fill();
  }
  if (fresh) _wxSetMask(cvs); else _wxMaskTex.baseTexture.update();
  _wxMaskUrl = null;
  _wxMaskDirty = true;
}

function _wxMaskDataUrl() {
  if (!_wxMaskUrl && _wxMaskCvs) _wxMaskUrl = _wxMaskCvs.toDataURL('image/png');
  return _wxMaskUrl;
}

// Player: the mask arrives as a PNG. A null clears it.
function _wxLoadMaskUrl(url) {
  if (!url) { _wxSetMask(_wxEmptyMask()); return; }
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    _wxSetMask(c);
  };
  img.src = url;
}

// ─── To the TV ────────────────────────────────────────────────────────────────

// Riding a map's first delivery (playerWindow.js): the preset and, when something falls, the mask.
function weatherPayload() {
  _wxSendPending = false;
  if (!_wxActive()) { _wxMaskSent = false; return { weather: weatherId, weatherMask: null }; }
  _wxMaskCheckAt = 0;
  _wxRefreshMask(performance.now());
  _wxMaskDirty = false;
  _wxMaskSent = true;
  return { weather: weatherId, weatherMask: _wxMaskDataUrl() };
}

// A preset change reaches the TV at once, never held for Send. ⚠ AN EDITED MASK IS HELD IN MANUAL like
// the rooms' fog: it carries the outline of a room the DM is still prepping. `send` is Send itself.
function _wxFlushToPlayer(send) {
  if (!_wxSendPending && !_wxMaskDirty) return;
  if (!playerWindow || playerWindow.closed || !playerMapSent || tvShowsOtherMap()) { _wxSendPending = false; return; }
  const hasMask = _wxActive() && (!_wxMaskSent || (_wxMaskDirty && (autoSync || send)));
  if (!_wxSendPending && !hasMask) return;
  const msg = { type: 'weather', weather: weatherId };
  if (hasMask) msg.mask = _wxMaskDataUrl();
  _wxSendPending = false;
  playerWindow.postMessage(msg, '*');
  if (hasMask) { _wxMaskSent = true; _wxMaskDirty = false; }
}

// Send in Manual: the room outlines held since the last one.
function weatherSendHeld() { _wxFlushToPlayer(true); }

// Both ends of the push: the Player's inbox and the first delivery.
function applyWeatherMessage(msg) {
  if (msg.weather !== undefined) setWeather(msg.weather, !!msg.instant);
  if (msg.mask !== undefined) _wxLoadMaskUrl(msg.mask);
}

// ─── The meshes ───────────────────────────────────────────────────────────────

function _wxMakeMesh() {
  const shader = PIXI.Shader.from(WEATHER_VERT, WEATHER_FRAG, {
    uMap: PIXI.Texture.WHITE, uRoom: _wxMaskTex,
    uT: 0, uSim: 0, uWind: 0, uAspect: 1, uInt: 0, uCell: 0, uLines: 0, uBeams: 0, uAlpha: 1, uGustA: 0,
    uDark: 0, uFlash: 0, uWet: 0, uSnowC: 0, uStr: 1, uOverlay: 0,
    uGustC: new Float32Array(2), uMapSize: new Float32Array(2),
    uRect: new Float32Array(4), uP1: new Float32Array(4), uP2: new Float32Array(4), uW: 3,
  });
  const mesh = new PIXI.Mesh(_wxGeom, shader);
  mesh.blendMode = PIXI.BLEND_MODES.NORMAL;
  mesh.visible = false;
  pixiWeatherLayer.addChild(mesh);
  return mesh;
}

function _wxBuild() {
  _wxGeom = new PIXI.Geometry()
    .addAttribute('aPos', new PIXI.Buffer(new Float32Array(8), false, false), 2)
    .addIndex([0, 1, 2, 0, 2, 3]);
  if (!_wxMaskTex) _wxSetMask(_wxEmptyMask());
  _wxMain = _wxMakeMesh();
  _wxOld = _wxMakeMesh();
  _wxSize = '';
}

function _wxDrop() {
  _wxMain = _wxOld = _wxGeom = null;
  _wxMaskTex = null; _wxMaskCvs = null; _wxMaskKey = '';
}

// One draw of one preset. `alpha` is what the fade lets through.
function _wxDraw(mesh, p, I, flash, alpha, f) {
  const u = mesh.shader.uniforms;
  u.uMap = f.tex; u.uOverlay = f.overlay;
  u.uRect.set(f.rect); u.uMapSize[0] = mapWidth; u.uMapSize[1] = mapHeight;
  u.uAspect = mapWidth / mapHeight;
  u.uT = f.t; u.uSim = _wxSim; u.uWind = p.wind * Math.PI / 180;
  u.uInt = I; u.uCell = p.cell; u.uLines = p.lines; u.uBeams = p.w === 2 ? 1 : 0;
  u.uAlpha = alpha; u.uStr = f.str;
  u.uGustA = f.gust.a; u.uGustC[0] = f.gust.x; u.uGustC[1] = f.gust.y;
  u.uDark = p.dark; u.uFlash = flash;
  u.uWet = _wxLevels.wet; u.uSnowC = _wxLevels.snow;
  u.uW = p.w; u.uP1.set(p.p1); u.uP2.set(p.p2);
  mesh.visible = true;
}

// Runs on the PixiJS ticker through render.js's pumpDirtyRender, sharing the app's one clock and cap.
function pumpWeather() {
  if (!pixiWeatherLayer) return;
  if (_wxLayerRef !== pixiWeatherLayer) { _wxLayerRef = pixiWeatherLayer; _wxDrop(); }
  const now = performance.now();
  const dt = Math.min(0.1, (now - _wxLast) / 1000);
  _wxLast = now;
  // ⚠ NOT MID-DRAG: a drag edits the outlines live, and every rebuild re-encodes a map-sized PNG for
  // the TV on this thread. The mask catches up when the gesture lands.
  if (!isPlayer && _wxActive() && !selectDragging()) _wxRefreshMask(now);
  else _wxMaskCheckAt = 0;
  if (!isPlayer) _wxFlushToPlayer();
  if (!_wxActive() || !mapWidth || !mapHeight) {
    if (_wxMain) _wxMain.visible = _wxOld.visible = false;
    if (!_wxActive()) _wxMaskKey = '';
    return;
  }
  if (!_wxMain) _wxBuild();
  _wxSim += dt;

  const p = WEATHER_PRESETS[weatherId];
  const I = weatherStrength(p, _wxSim);
  _wxLevels = weatherStepGround(_wxLevels, dt, p, I);
  let k = 1;
  if (_wxPrev) { k = (now - _wxSwitchAt) / WEATHER_FADE_MS; if (k >= 1) { _wxPrev = null; k = 1; } }
  const e = weatherFadeCurve(k);

  if (p.flash) {
    if (!_wxNextFlash) _wxNextFlash = now + 3000;
    if (now >= _wxNextFlash) { _wxFlashAt = now; _wxNextFlash = now + 10000 + Math.random() * 15000; }
  }
  const flash = p.flash ? weatherFlashAmp((now - _wxFlashAt) / 1000) : 0;
  if (!_wxGustNext) _wxGustNext = now + 5000;
  if (now >= _wxGustNext) { _wxGust = { x: 0.2 + Math.random() * 0.7, y: 0.2 + Math.random() * 0.6 }; _wxGustAt = now; _wxGustNext = now + 20000 + Math.random() * 20000; }

  const size = mapWidth + 'x' + mapHeight;
  if (size !== _wxSize) {
    _wxSize = size;
    _wxGeom.getBuffer('aPos').update(new Float32Array([0, 0, mapWidth, 0, mapWidth, mapHeight, 0, mapHeight]));
  }
  const tex = pixiMapTexture && pixiMapSprite ? pixiMapTexture : null;
  const f = {
    tex: tex || PIXI.Texture.WHITE, overlay: tex ? 0 : 1, t: (now - _wxT0) / 1000,
    rect: tex ? [pixiMapSprite.x, pixiMapSprite.y, Math.max(1, pixiMapSprite.width), Math.max(1, pixiMapSprite.height)] : [0, 0, mapWidth, mapHeight],
    str: isPlayer || playersViewOn ? 1 : WEATHER_DM_STRENGTH,
    gust: weatherGustAt(_wxGust, (now - _wxGustAt) / 4500),
  };

  // The new preset lies under; fading in from nothing it is let through by the curve instead.
  const idle = weatherId === 'none' && _wxLevels.wet <= 0.001 && _wxLevels.snow <= 0.001;
  if (idle) _wxMain.visible = false;
  else _wxDraw(_wxMain, p, I, flash, weatherInAlpha(_wxPrevLevel, e), f);
  if (_wxPrev && _wxPrev !== 'none') {
    const pp = WEATHER_PRESETS[_wxPrev];
    _wxDraw(_wxOld, pp, weatherStrength(pp, _wxSim), 0, _wxPrevLevel * (1 - e), f);
  } else _wxOld.visible = false;
}
