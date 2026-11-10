'use strict';
// timeOfDay.js - Time of day on a live window: the pick, its 8-second fade, the two textures the weather
// pass grades the map with (the rooms' blurred glow and the lamp mask), and the DM's animated map, which
// is a video under the canvas. The numbers are timeOfDayPlan.js's; the grade itself runs in weatherShader.js.
//
// ⚠ BOTH TEXTURES ARE BUILT ON THE CPU ONCE PER MAP OR ROOM CHANGE, never per frame.

let _todFrom = [0, 0, 0], _todTo = [0, 0, 0], _todAt = 0, _todFading = false;
let _todGlowCvs = null, _todGlowTex = null;
let _todLampTex = null, _todLampFor = null;
let _todVideoFilter = '';

function todActive() {
  return timeOfDayId !== 'none' || _todFading;
}

// [day, dusk, night] on screen now.
function todWeightsNow(now) {
  if (!_todFading) return _todTo;
  const k = (now - _todAt) / WEATHER_FADE_MS;
  if (k >= 1) { _todFading = false; return _todTo; }
  return todWeightsMix(_todFrom, _todTo, weatherFadeCurve(k));
}

// instant: a map opening. Otherwise the grade fades from what is on screen. Answers whether anything changed.
function setTimeOfDay(id, instant) {
  const next = timeOfDayNormalize(id);
  if (instant) {
    timeOfDayId = next;
    _todTo = todWeights(next); _todFading = false;
    return true;
  }
  if (next === timeOfDayId) return false;
  const now = performance.now();
  _todFrom = todWeightsNow(now).slice();
  _todTo = todWeights(next); _todAt = now; _todFading = true;
  timeOfDayId = next;
  weatherMarkSend();
  return true;
}

// What the DM's control does: in two-map mode the selected column owns the map.
function chooseTimeOfDay(id) {
  if (paneForward('time-of-day', { id })) { refreshTimeOfDayUI(timeOfDayNormalize(id)); return; }
  applyTimeOfDayChoice(id);
}

function applyTimeOfDayChoice(id) {
  if (setTimeOfDay(id, false)) scheduleAutoSave();
  if (typeof refreshTimeOfDayUI === 'function') refreshTimeOfDayUI();
}

// ─── The rooms' glow ──────────────────────────────────────────────────────────

// The room mask blurred as the board's window glow; the shader takes the room itself back out.
function todRoomGlow(maskCvs) {
  const w = maskCvs.width, h = maskCvs.height;
  const fresh = !_todGlowCvs || _todGlowCvs.width !== w || _todGlowCvs.height !== h;
  if (fresh) _todGlowCvs = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = _todGlowCvs.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.filter = 'blur(' + (TOD.glowBlur * w / 1.7).toFixed(2) + 'px)';
  ctx.drawImage(maskCvs, 0, 0);
  ctx.filter = 'none';
  if (fresh || !_todGlowTex) {
    const old = _todGlowTex;
    _todGlowTex = new PIXI.Texture(PIXI.BaseTexture.from(_todGlowCvs, { scaleMode: PIXI.SCALE_MODES.LINEAR }));
    if (old) old.baseTexture.destroy();
  } else _todGlowTex.baseTexture.update();
}

function todGlowTexture() { return _todGlowTex || PIXI.Texture.EMPTY; }

// ─── The lamp mask ────────────────────────────────────────────────────────────

// One still of the map: an animated map's current frame, else the picture the map texture holds.
function _todLampSource() {
  if (mapVideo && mapVideo.videoWidth && mapVideo.readyState >= 2) return mapVideo;
  const r = pixiMapTexture && pixiMapTexture.baseTexture && pixiMapTexture.baseTexture.resource;
  return (r && r.source) || null;
}

// Only Day reads it, so it is built the first time Day is on screen for this map.
function todLampTexture(weights) {
  const src = weights[0] > 0 ? _todLampSource() : null;
  if (!src) return _todLampTex || PIXI.Texture.EMPTY;
  const key = src === mapVideo ? src.currentSrc : src;
  if (key === _todLampFor) return _todLampTex;
  _todLampFor = key;
  const sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
  const w = Math.min(TOD.lamp.width, sw), h = Math.max(1, Math.round(sh * w / sw));
  const cvs = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = cvs.getContext('2d', { willReadFrequently: true });
  let mask = null;
  try {
    ctx.drawImage(src, 0, 0, w, h);
    mask = todLampMaskRgba(ctx.getImageData(0, 0, w, h).data, w, h);
  } catch (_) { mask = null; }   // a still the page may not read leaves Day without its lamp correction
  const img = ctx.createImageData(w, h);
  if (mask) for (let i = 0; i < mask.length; i++) { img.data[i * 4] = Math.round(mask[i] * 255); img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  const old = _todLampTex;
  _todLampTex = new PIXI.Texture(PIXI.BaseTexture.from(cvs, { scaleMode: PIXI.SCALE_MODES.LINEAR }));
  if (old) old.baseTexture.destroy();
  return _todLampTex;
}

// ─── The DM's animated map ────────────────────────────────────────────────────
// The video plays under the canvas, so the pass has no picture to grade. Day is a CSS filter on the
// video (it covers rooms anyway); Dusk and Night are the pass's tint over it, rooms cut out.

// brightness and contrast fitted to Day's tone curve in sRGB at full strength.
const TOD_DAY_CSS = { brightness: 1.11, contrast: 0.82, saturate: 1.04 };

function todVideoFilterFor(dayWeight, str) {
  const k = dayWeight * str;
  if (k <= 0.001) return '';
  const at = v => (1 + (v - 1) * k).toFixed(3);
  return 'contrast(' + at(TOD_DAY_CSS.contrast) + ') brightness(' + at(TOD_DAY_CSS.brightness) + ') saturate(' + at(TOD_DAY_CSS.saturate) + ')';
}

function todSyncVideoFilter(weights, str) {
  const want = !isPlayer && videoDOMActive && mapVideo ? todVideoFilterFor(weights[0], str) : '';
  if (mapVideo && (want !== _todVideoFilter || mapVideo.style.filter !== want)) mapVideo.style.filter = want;
  _todVideoFilter = want;
}

function todDrop() {
  _todGlowTex = null; _todGlowCvs = null;
  _todLampTex = null; _todLampFor = null;
}
