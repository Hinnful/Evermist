'use strict';
// mcpSee.js — Claude's eyes: view_scene draws a map, or an area of it, offscreen with a percent grid and the
// rooms' outlines, and read_scene lists what a map holds. Both read only.
// ⚠ NOTHING HERE TOUCHES THE DM'S CANVAS, THE TV OR THE OPEN SCENE'S STATE. The map is decoded or
// sought into canvases and a video element of its own, so the DM's view and the TV never flicker.

// A scene's contents wherever its live copy is. The open scene is read from the window's own state, since
// _mcpSceneRecord carries only its notes and rooms.
async function _mcpSeeRecord(scene) {
  if (_mcpHolder(scene.id) === 'here') {
    return { live: true, mapWidth, mapHeight, mapType: currentScene.mapType, polygons, effects, ...lightsSceneFields(), gridConfig: captureGridConfig(),
      floorPlan: currentScene.floorPlan, canvas: mapOffscreen };
  }
  const rec = await _mcpSceneRecord(scene.id);
  if (!rec.mapWidth) throw new Error('The map "' + scene.name + '" is no longer in the library.');
  return rec;
}

function _mcpSeeOnTv(scene) {
  return mcpOnTv({ playerOpen: !!(playerWindow && !playerWindow.closed), held: tvHeld, panes: panesActive,
    isOpen: !!(currentScene && currentScene.id === scene.id), inColumn: panesActive && !!paneColumnOf(scene.id) });
}

async function _mcpReadScene(args) {
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  const s = found.scene, rec = await _mcpSeeRecord(s);
  return _mcpOk(mcpSeeJson(mcpSeeRead({ name: s.name, group: s.group, mapW: rec.mapWidth, mapH: rec.mapHeight, mapType: rec.mapType,
    onTv: _mcpSeeOnTv(s), gridConfig: rec.gridConfig, polygons: rec.polygons, effects: rec.effects,
    lightShapes: rec.lightShapes, lightsHidden: rec.lightsHidden, floorPlan: rec.floorPlan })));
}

// A frame of an animated map's file, in a video element no page holds, drawn to `ctx` over `crop`.
async function _mcpSeeVideoFrame(id, ctx, crop, out, mapW) {
  const abs = window.electronAPI && await window.electronAPI.getVideoFilePath(id);
  if (!abs) throw new Error('The animated map\'s file is missing.');
  const video = document.createElement('video');
  video.muted = true; video.preload = 'auto';
  try {
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = () => reject(new Error('The animated map could not be read.'));
      setTimeout(() => reject(new Error('The animated map took too long to load.')), 10000);
      video.src = 'file:///' + abs.replace(/\\/g, '/');
    });
    await new Promise(resolve => {
      video.onseeked = resolve;
      video.currentTime = 0.001;
      setTimeout(resolve, 2000);
    });
    const k = video.videoWidth / mapW;
    ctx.drawImage(video, crop.sx * k, crop.sy * k, crop.sw * k, crop.sh * k, 0, 0, out.w, out.h);
  } finally {
    video.onloadeddata = video.onerror = video.onseeked = null;
    video.src = '';
  }
}

// The crop of the map on `ctx`. A still is decoded straight to the picture's size off the main thread; the open
// scene's own decoded canvas is cropped the same way, with no decode at all.
async function _mcpSeeDrawMap(s, rec, ctx, crop, out) {
  ctx.imageSmoothingQuality = 'high';
  const opts = { resizeWidth: out.w, resizeHeight: out.h, resizeQuality: 'high' };
  if (rec.live && rec.canvas) {
    const bmp = await createImageBitmap(rec.canvas, crop.sx, crop.sy, crop.sw, crop.sh, opts);
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
  } else if (rec.mapType === 'video') {
    await _mcpSeeVideoFrame(s.id, ctx, crop, out, rec.mapWidth);
  } else if (rec.mapBlob) {
    const bmp = await createImageBitmap(rec.mapBlob, crop.sx, crop.sy, crop.sw, crop.sh, opts);
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
  } else {
    throw new Error('The map "' + s.name + '" has no image to look at.');
  }
}

function _mcpSeePlate(ctx, text, x, y, size, align) {
  ctx.font = '600 ' + size + 'px sans-serif';
  const w = ctx.measureText(text).width + size * 0.7, h = size * 1.4;
  const left = Math.max(0, Math.min(ctx.canvas.width - w, align === 'center' ? x - w / 2 : x));
  const top = Math.max(0, Math.min(ctx.canvas.height - h, y));
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(left, top, w, h);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText(text, left + size * 0.35, top + h / 2);
}

// A thin light line over a dark one, so it shows on a pale map and a dark one.
function _mcpSeeStroke(ctx, draw, lw) {
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = lw + 2;
  draw(); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = lw;
  draw(); ctx.stroke();
}

function _mcpSeeRooms(ctx, polys, crop, out, size) {
  const kx = out.w / crop.sw, ky = out.h / crop.sh;
  const X = x => (x - crop.sx) * kx, Y = y => (y - crop.sy) * ky;
  const lw = Math.max(1, out.w / 900);
  const plates = [];
  for (const p of polys) {
    const outer = p.vertices || [];
    if (outer.length < 3) continue;
    const rings = [outer].concat((p.holes || []).filter(h => h && h.length >= 3));
    _mcpSeeStroke(ctx, () => {
      ctx.beginPath();
      for (const ring of rings) { ring.forEach((v, i) => (i ? ctx.lineTo(X(v.x), Y(v.y)) : ctx.moveTo(X(v.x), Y(v.y)))); ctx.closePath(); }
    }, lw);
    if (!p.name) continue;
    const c = mcpSeeAnchor(outer), x = X(c.x), y = Y(c.y);
    if (x >= 0 && y >= 0 && x <= out.w && y <= out.h) plates.push({ text: p.name, x, y });
  }
  for (const t of plates) _mcpSeePlate(ctx, t.text, t.x, t.y - size * 0.7, size, 'center');
}

function _mcpSeeGrid(ctx, area, step, out, size) {
  const X = pct => (pct - area.x) / area.w * out.w, Y = pct => (pct - area.y) / area.h * out.h;
  const xs = mcpSeeLines(area.x, area.w, step), ys = mcpSeeLines(area.y, area.h, step);
  const lw = Math.max(1, out.w / 1400);
  for (const p of xs) _mcpSeeStroke(ctx, () => { ctx.beginPath(); ctx.moveTo(X(p), 0); ctx.lineTo(X(p), out.h); }, lw);
  for (const p of ys) _mcpSeeStroke(ctx, () => { ctx.beginPath(); ctx.moveTo(0, Y(p)); ctx.lineTo(out.w, Y(p)); }, lw);
  ctx.font = '600 ' + size + 'px sans-serif';
  const width = ctx.measureText('100.0%').width + size, tall = size * 1.6;
  const keepX = mcpSeeLabelKeep(xs.map(X), width, 4), keepY = mcpSeeLabelKeep(ys.map(Y), tall, 2);
  xs.forEach((p, i) => { if (keepX[i]) _mcpSeePlate(ctx, mcpSeeLabel(p), X(p) + 2, 2, size, 'left'); });
  ys.forEach((p, i) => { if (keepY[i]) _mcpSeePlate(ctx, mcpSeeLabel(p), 2, Y(p) + 2, size, 'left'); });
}

function _mcpSeeEncode(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('The picture could not be encoded.'))), 'image/jpeg', quality));
}

function _mcpSeeBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('The picture could not be read.'));
    r.readAsDataURL(blob);
  });
}

// One draw at size `out`: the map, the rooms, then the grid on top.
async function _mcpSeeFrame(s, rec, view, out) {
  const canvas = document.createElement('canvas');
  canvas.width = out.w; canvas.height = out.h;
  const ctx = canvas.getContext('2d');
  await _mcpSeeDrawMap(s, rec, ctx, view.px, out);
  const size = Math.max(11, Math.min(18, Math.round(out.w / 70)));
  _mcpSeeRooms(ctx, rec.polygons || [], view.px, out, size);
  _mcpSeeGrid(ctx, view.area, view.step, out, size);
  return canvas;
}

async function _mcpViewScene(args) {
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  const asked = mcpSeeArea(args.area);
  if (asked.error) return _mcpNo(asked.error);
  const s = found.scene, rec = await _mcpSeeRecord(s);
  const area = asked.area, px = mcpSeePixels(area, rec.mapWidth, rec.mapHeight);
  const view = { area, px, step: mcpSeeStep(area, rec.mapWidth, rec.mapHeight) };
  let out = mcpSeeOutSize(px.sw, px.sh), blob = null;
  // Quality falls before the picture shrinks, and the draw happens once per size.
  for (let pass = 0; pass < 3 && !blob; pass++) {
    const canvas = await _mcpSeeFrame(s, rec, view, out);
    for (const q of MCP_SEE_QUALITY) {
      const b = await _mcpSeeEncode(canvas, q);
      if (b.size <= MCP_SEE_MAX_BYTES) { blob = b; break; }
    }
    if (!blob) out = mcpSeeShrink(out, 0.75);
  }
  if (!blob) return _mcpNo('The picture stayed too large to send. Ask for a smaller area.');
  const polys = (rec.polygons || []).filter(p => (p.vertices || []).length >= 3);
  const text = mcpSeeViewText({ name: s.name, mapW: rec.mapWidth, mapH: rec.mapHeight, area, px, out, step: view.step,
    roomCount: polys.length, rooms: polys.map(p => p.name) });
  return { text, image: { data: await _mcpSeeBase64(blob), mimeType: 'image/jpeg' } };
}

const MCP_SEE_TOOLS = { view_scene: _mcpViewScene, read_scene: _mcpReadScene };
