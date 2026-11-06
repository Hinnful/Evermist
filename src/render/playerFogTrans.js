'use strict';
// playerFogTrans.js - a fog change on the TV. The shader blends the outgoing mask into the new one
// per pixel by a clock of its own, read from the order texture (uOrder: r = rank, g and b = start in
// ms on a 16-bit clock, a = direction). This file builds that texture when a change lands, keeps
// changes that overlap in time apart, and drops the outgoing mask once the last one has run its course.
// The order maths is fog/fogTransitionPlan.js, tested.
// Everything the CPU does is on a grid capped like the near copies, so a change costs one small read-back and
// some loops over that grid. The outgoing mask the shader reads stays full size and on the GPU: a grid copy
// of it drew a second, stepped edge beside every fog edge a change only passed near.

// A quarter of the near copies' 960x540: the rank is smooth noise read LINEAR, so it needs no more, and
// the work on it (read-back, noise, nearest-pixel sweep, rank) lands inside one frame.
const FOG_TRANS_AREA = 480 * 270;
// The edge effects read near copies blurred this wide (px at the near copies' scale), so order reaches
// this far past the changed pixels: the wall darkening and edge terms around a room then move with the
// fog beside them.
const FOG_TRANS_REACH = Math.max(...PLAYER_FOG_NEAR_BLUR);

// { gw, gh, data, rankData, owner, bt, rankBT, near, ext, take, prevA, prevData, old*, take*, curA, region, vals, fine, dist,
//   changes: [{ id, t0, code, ms }], nearDirty }. ms: how long the theme that started the change runs it. curA is the alpha of the mask last landed, null once a mask landed that no change was told of.
let ptState   = null;
let ptPending = null;   // { oldA, gw, gh, w, h, nearCopied }: the outgoing mask, from a change's start to its landing
let ptSmall   = [null, null];
let ptCvs     = null;

function pixiPlayerFogChanging() { return !!(ptState && ptState.changes.length); }

function ptGrid(cvs) {
  const k = Math.min(1, Math.sqrt(FOG_TRANS_AREA / (cvs.width * cvs.height)));
  return { gw: Math.max(8, Math.round(cvs.width * k)), gh: Math.max(8, Math.round(cvs.height * k)), k };
}

function ptTexture(data, gw, gh, scaleMode) {
  return new PIXI.BaseTexture(new PIXI.BufferResource(data, { width: gw, height: gh }), {
    scaleMode,
    alphaMode: PIXI.ALPHA_MODES.NPM,       // alpha here is data, never premultiplied
    mipmap: PIXI.MIPMAP_MODES.OFF,
  });
}

function ptEnsure(gw, gh) {
  if (ptState && ptState.gw === gw && ptState.gh === gh) return ptState;
  pixiPlayerFogTransReset();
  pixiPlayerFogTransDestroy();
  const n = gw * gh;
  const data = new Uint8Array(n * 4), prevData = new Uint8Array(n * 4), rankData = new Uint8Array(n * 4);
  const oldData = new Uint8Array(n * 4), takeData = new Uint8Array(n * 4);
  // Start and direction are numbers, never blended (NEAREST); the rank and the outgoing mask are smooth.
  const bt = ptTexture(data, gw, gh, PIXI.SCALE_MODES.NEAREST);
  const rankBT = ptTexture(rankData, gw, gh, PIXI.SCALE_MODES.LINEAR);
  const oldBT = ptTexture(oldData, gw, gh, PIXI.SCALE_MODES.NEAREST);
  const takeBT = ptTexture(takeData, gw, gh, PIXI.SCALE_MODES.NEAREST);
  pixiPFogUniforms.uniforms.uOrder = new PIXI.Texture(bt);
  pixiPFogUniforms.uniforms.uRank = new PIXI.Texture(rankBT);
  ptState = {
    gw, gh, data, rankData, owner: new Uint8Array(n), core: new Uint8Array(n), bt, rankBT,
    near: new Int32Array(n), ext: new Uint8Array(n), take: new Uint8Array(n),
    prevA: new Uint8Array(n), prevData,
    oldData, oldBT, oldTex: new PIXI.Texture(oldBT), takeData, takeBT, takeTex: new PIXI.Texture(takeBT),
    curA: null, region: new Uint8Array(n), vals: new Float32Array(n), fine: new Float32Array(n), dist: new Float32Array(n),
    changes: [], nearDirty: false,
  };
  return ptState;
}

// The alpha of a mask on the grid: drawn down on the GPU, then only the grid is read back.
function ptReadAlpha(cvs, slot, gw, gh) {
  let c = ptSmall[slot];
  if (!c) c = ptSmall[slot] = document.createElement('canvas');
  if (c.width !== gw || c.height !== gh) { c.width = gw; c.height = gh; }
  const g = c.getContext('2d');
  g.clearRect(0, 0, gw, gh);
  g.imageSmoothingQuality = 'high';
  g.drawImage(cvs, 0, 0, gw, gh);
  const px = g.getImageData(0, 0, gw, gh).data, out = new Uint8Array(gw * gh);
  for (let i = 0; i < out.length; i++) out[i] = px[i * 4 + 3];
  return out;
}

// The bake shader (playerFogShader.js) in the theme in use, drawn into rt (w x h).
let ptBake = null;   // { geom, mesh, w, h }
function ptBakeInto(rt, w, h, oldTex, takeTex, full, now) {
  const sh = pixiPFogBakeShaders[pixiPFogThemeId];
  if (!ptBake) {
    const geom = new PIXI.Geometry()
      .addAttribute('aPos', new PIXI.Buffer(new Float32Array(8), false, false), 2)
      .addIndex([0, 1, 2, 0, 2, 3]);
    ptBake = { geom, mesh: new PIXI.Mesh(geom, sh), w: 0, h: 0 };
  }
  if (ptBake.w !== w || ptBake.h !== h) {
    ptBake.w = w; ptBake.h = h;
    ptBake.geom.getBuffer('aPos').update(new Float32Array([0, 0, w, 0, w, h, 0, h]));
  }
  ptBake.mesh.shader = sh;
  sh.uniforms.uOldCur = oldTex;
  sh.uniforms.uTake = takeTex;
  sh.uniforms.uFull = full ? 1 : 0;
  sh.uniforms.uGrid[0] = w; sh.uniforms.uGrid[1] = h;
  sh.uniforms.uBakeNow = now % 65536;
  pixiApp.renderer.render(ptBake.mesh, { renderTexture: rt, clear: true });
}

// What the TV shows on each grid pixel right now, with oldA the mask before the one just landed, read back.
let ptGridRT = null;
function pixiBakePlayerFogShown(st, oldA, now) {
  const gw = st.gw, gh = st.gh;
  for (let i = 0; i < oldA.length; i++) st.oldData[i * 4 + 3] = oldA[i];
  st.oldBT.update();
  if (!ptGridRT || ptGridRT.width !== gw || ptGridRT.height !== gh) {
    if (ptGridRT) ptGridRT.destroy(true);
    ptGridRT = PIXI.RenderTexture.create({ width: gw, height: gh });
  }
  ptBakeInto(ptGridRT, gw, gh, st.oldTex, PIXI.Texture.WHITE, false, now);
  const px = pixiApp.renderer.extract.pixels(ptGridRT), out = new Uint8Array(gw * gh);
  for (let i = 0; i < out.length; i++) out[i] = px[i * 4];
  return out;
}

// The outgoing mask at the mask's own size, on the GPU: prev is what the shader reads, old the mask as a change
// began, spare the target of the next bake.
let ptFull = null;   // { w, h, prev, old, spare }
function ptFullEnsure() {
  const w = pixiPFogMaskBT.realWidth, h = pixiPFogMaskBT.realHeight;
  if (ptFull && ptFull.w === w && ptFull.h === h) return ptFull;
  ptFullDestroy();
  const mk = () => PIXI.RenderTexture.create({ width: w, height: h });
  return (ptFull = { w, h, prev: mk(), old: mk(), spare: mk() });
}
function ptFullDestroy() {
  if (!ptFull) return;
  ptFull.prev.destroy(true); ptFull.old.destroy(true); ptFull.spare.destroy(true);
  ptFull = null;
}

// prevA into the pixels the outgoing near copies are built from.
function ptUploadPrev(st) {
  for (let i = 0; i < st.prevA.length; i++) st.prevData[i * 4 + 3] = st.prevA[i];
}

// A fog update that starts a change is about to rebuild the mask: keep the alpha it replaces, and
// the near copies, which still hold it.
function pixiPlayerFogChangeBegin(cvs) {
  ptPending = null;
  if (!cvs || !pixiPFogUniforms) return;
  const g = ptGrid(cvs);
  const st = ptEnsure(g.gw, g.gh);
  const oldA = st.curA || ptReadAlpha(cvs, 0, g.gw, g.gh);
  const nearCopied = !st.changes.length;
  if (nearCopied) pixiCopyPlayerFogNearPrev();
  // The mask texture still holds the mask this change replaces.
  const full = ptFullEnsure(), spr = new PIXI.Sprite(new PIXI.Texture(pixiPFogMaskBT));
  spr.width = full.w; spr.height = full.h;
  pixiApp.renderer.render(spr, { renderTexture: full.old, clear: true });
  spr.destroy();
  ptPending = { oldA, gw: g.gw, gh: g.gh, w: cvs.width, h: cvs.height, nearCopied };
}

// Every change has run: show the new mask everywhere and release the outgoing one.
function ptClear(st) {
  st.changes = [];
  st.data.fill(0);
  st.rankData.fill(0);
  st.owner.fill(0);
  st.bt.update();
  st.rankBT.update();
  st.nearDirty = false;
  pixiClearPlayerFogPrev();
}

// The new mask has landed (pixiSyncPlayerFog). Finds what changed against the outgoing one and
// starts it travelling.
function pixiPlayerFogChangeLand(cvs) {
  const pend = ptPending;
  ptPending = null;
  const st = ptState;
  if (!pend || !st || !pixiPFogUniforms || st.gw !== pend.gw || pend.w !== cvs.width || pend.h !== cvs.height) {
    if (st) st.curA = null;
    return;
  }
  pixiPlayerFogTransStep();   // changes that ended since the last frame hand their pixels over first
  const gw = st.gw, gh = st.gh, region = st.region;
  const newA = ptReadAlpha(cvs, 1, gw, gh);
  st.curA = newA;
  const count = fogChangedRegion(pend.oldA, newA, region);
  if (!count) return;

  // Blobs about a fifth of the screen's height, in grid pixels, shaped by the theme's own rank, then
  // ranked over the region so its first pixels start at once however small it is.
  const tr = fogThemeRecord(fogTheme).trans;
  const k = gw / cvs.width;
  const cell = Math.max(3, window.innerHeight / ((zoom > 0 ? zoom : 1) * FOG_SCALE) * k / 5);
  const vals = st.vals;
  fogOrderField(region, gw, gh, cell, vals);
  fogShapeRank(region, gw, gh, cell, tr.rank, vals, st.fine, st.dist);
  fogRankNormalise(vals, region, count);
  // The ring around the region follows the nearest changed pixel: its rank, start and direction.
  const near = st.near, ext = st.ext;
  const nearK = Math.min(1, Math.sqrt(PLAYER_FOG_NEAR_AREA / (cvs.width * cvs.height)));
  fogNearestRegion(region, gw, gh, Math.ceil(FOG_TRANS_REACH * k / nearK), near);
  for (let i = 0; i < ext.length; i++) {
    const s = near[i];
    if (s < 0) { ext[i] = 0; continue; }
    ext[i] = region[s];
    vals[i] = vals[s];
  }

  const now = performance.now();
  const take = st.take;
  const full = ptFull;
  if (!st.changes.length) {
    st.prevA.set(pend.oldA);
    take.set(ext);
    [full.prev, full.old] = [full.old, full.prev];
    if (!pend.nearCopied) st.nearDirty = true;
  } else {
    // Pixels another change is still moving must not pop: the new change starts from what the TV shows
    // there right now, through the theme's own fogStep, on the grid for the CPU and full size for the shader.
    const shown = fogChangeOverlaps(region, st.owner) ? pixiBakePlayerFogShown(st, pend.oldA, now) : null;
    if (fogTakePixels(st.prevA, pend.oldA, region, ext, st.owner, st.core, shown, take)) st.nearDirty = true;
    for (let i = 0; i < take.length; i++) st.takeData[i * 4 + 3] = take[i] ? 255 : 0;
    st.takeBT.update();
    ptBakeInto(full.spare, full.w, full.h, full.old, st.takeTex, true, now);
    [full.prev, full.spare] = [full.spare, full.prev];
  }
  pixiPFogUniforms.uniforms.uMaskPrev = full.prev;
  ptUploadPrev(st);

  let id = 1;
  while (st.changes.some(c => c.id === id)) id++;
  const start = Math.floor(now) % 65536;
  let reveals = 0;
  for (let i = 0; i < ext.length; i++) {
    if (!take[i]) continue;
    st.rankData[i * 4] = Math.round(vals[i] * 255);
    st.data[i * 4 + 1] = start >> 8;
    st.data[i * 4 + 2] = start & 255;
    st.data[i * 4 + 3] = ext[i];
    st.owner[i] = id;
    st.core[i] = region[i] ? 1 : 0;
    if (region[i] === FOG_ORDER_REVEAL) reveals++;
  }
  st.changes.push({ id, t0: now, code: reveals * 2 >= count ? FOG_ORDER_REVEAL : FOG_ORDER_HIDE, ms: Math.max(tr.dur[0], tr.dur[1]) });
  st.bt.update();
  st.rankBT.update();
}

// Once a frame. The near copies of a bake are rebuilt here, a frame after it, not inside the landing.
// A change that has run its course gives its pixels to the current mask; the last one out clears the
// order data (its clock wraps after 65 s) and the outgoing mask.
function pixiPlayerFogTransStep() {
  const st = ptState;
  if (!st || !st.changes.length) return;
  if (st.nearDirty) {
    st.nearDirty = false;
    if (!ptCvs) ptCvs = document.createElement('canvas');
    ptCvs.width = st.gw; ptCvs.height = st.gh;
    ptCvs.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(st.prevData.buffer), st.gw, st.gh), 0, 0);
    pixiSetPlayerFogNearPrev(ptCvs);
  }
  const now = performance.now();
  const done = st.changes.filter(c => now - c.t0 >= c.ms);
  if (!done.length) return;
  if (done.length === st.changes.length) { ptClear(st); return; }
  const ids = new Uint8Array(256);
  for (const c of done) ids[c.id] = 1;
  for (let i = 0; i < st.owner.length; i++) {
    if (!ids[st.owner[i]]) continue;
    st.owner[i] = 0; st.data[i * 4 + 3] = 0;
    if (st.curA) st.prevA[i] = st.curA[i];   // shown as the current mask from here on
  }
  st.changes = st.changes.filter(c => !done.includes(c));
  st.bt.update();
}

// A scene switch or a closed window: nothing carries over.
function pixiPlayerFogTransReset() {
  ptPending = null;
  if (ptState) {
    ptState.curA = null;
    if (ptState.changes.length) ptClear(ptState);
  }
}

function pixiPlayerFogTransDestroy() {
  ptPending = null;
  if (ptState) { ptState.bt.destroy(); ptState.rankBT.destroy(); ptState.oldBT.destroy(); ptState.takeBT.destroy(); ptState = null; }
  if (ptBake) { ptBake.mesh.destroy(); ptBake = null; }
  if (ptGridRT) { ptGridRT.destroy(true); ptGridRT = null; }
  ptFullDestroy();
}
