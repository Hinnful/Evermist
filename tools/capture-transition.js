'use strict';

// Films a Player-view scene transition frame by frame, so the fog close/hold/clear can be
// LOOKED AT instead of reasoned about.
//
//   npx electron tools/capture-transition.js [outDir]
//
// Why this exists: the Player is the only view the transition happens in, it is reachable
// only as index.html?mode=player, and a dev-server preview strips the query string — so the
// transition could not be seen at all without launching Electron. This drives the real
// Player runtime with synthesised scene messages, exactly as viewport.js would post them,
// and captures the window every CAPTURE_EVERY_MS.
//
// The two maps are DELIBERATELY DIFFERENT SIZES. The cloud texture is anchored to the map,
// so a same-size swap hides the very discontinuity this rig is for.
//
// Frames land in the out dir as frame-0000-t0123ms.png plus a manifest.json carrying the
// fog state sampled at each frame (fogCoverT, whether a swap freeze was up, cloud offsets).
// Read the manifest first — it says WHEN something changed; the frames say WHAT it looked like.

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const root   = path.join(__dirname, '..');
const outDir = process.argv[2] || path.join(root, '.capture');

const W = 960, H = 540;
const CAPTURE_EVERY_MS = 60;
const RUN_MS           = 9000;   // comfortably past close + hold + clear

app.disableHardwareAcceleration();   // deterministic capture, same reason as render-icon.js

// A map as a data URL: a coloured grid, so any shift of the MAP is obvious, drawn at the
// requested size so the two scenes differ in aspect and scale.
function mapDataUrl(w, h, hue) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<rect width="${w}" height="${h}" fill="hsl(${hue},45%,42%)"/>` +
    Array.from({ length: Math.ceil(w / 120) }, (_, i) =>
      `<rect x="${i * 120}" y="0" width="4" height="${h}" fill="hsl(${hue},60%,72%)"/>`).join('') +
    Array.from({ length: Math.ceil(h / 120) }, (_, i) =>
      `<rect x="0" y="${i * 120}" width="${w}" height="4" fill="hsl(${hue},60%,72%)"/>`).join('') +
    `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 5}" fill="hsl(${hue},70%,85%)"/>` +
    `</svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

// The fog stencil the Player expects: ALPHA is the fog, so a cleared area must be alpha 0.
// Painting a transparent circle over an opaque rect does NOT do that — it paints nothing and
// leaves the rect opaque, i.e. a map that never reveals. A radial gradient from transparent
// centre to opaque edge is what actually punches the hole.
function fogDataUrl(w, h) {
  const fw = Math.ceil(w / 4), fh = Math.ceil(h / 4);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fw}" height="${fh}">` +
    `<defs><radialGradient id="g" cx="0.5" cy="0.5" r="0.5">` +
    `<stop offset="0" stop-color="#000" stop-opacity="0"/>` +
    `<stop offset="0.55" stop-color="#000" stop-opacity="0"/>` +
    `<stop offset="0.8" stop-color="#000" stop-opacity="1"/>` +
    `<stop offset="1" stop-color="#000" stop-opacity="1"/>` +
    `</radialGradient></defs>` +
    `<rect width="${fw}" height="${fh}" fill="url(#g)"/>` +
    `</svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

const SCENE_A = { w: 2000, h: 1200, hue: 205, name: 'The Drowned Hall' };
const SCENE_B = { w: 3400, h: 1600, hue: 30,  name: 'The Sunken Chapel' };

const sceneMsg = (s, sceneChange) => ({
  type: 'fog-update',
  mapUrl: mapDataUrl(s.w, s.h, s.hue),
  mapType: 'image',
  mapWidth: s.w,
  mapHeight: s.h,
  fogDataUrl: fogDataUrl(s.w, s.h),
  sceneChange,
  fogChanged: true,
  isShroud: false,
});

// Sampled every frame. Everything here is a plain global in the Player runtime.
const PROBE = `(() => { try { return JSON.stringify({
  coverT: +fogCoverT.toFixed(3),
  coverRaf: fogCoverRafId !== null,
  cloudHeld: !!fogCloudHold,
  cloudAdjK: +fogCloudAdj.k.toFixed(4),
  cloudScale: fogCloudLast ? +fogCloudLast.s.toFixed(4) : null,
  mapW: mapWidth, zoom: +zoom.toFixed(4), panX: Math.round(panX), panY: Math.round(panY),
  fogDataW: fogDataCanvas ? fogDataCanvas.width : null,
  cloudPos: typeof cloudFramePos !== 'undefined' ? +cloudFramePos.toFixed(3) : null,
  cloudOff0: (typeof fogAnimOffsets !== 'undefined' && fogAnimOffsets[0])
    ? [Math.round(fogAnimOffsets[0].x), Math.round(fogAnimOffsets[0].y)] : null,
  covered: document.getElementById('scene-fade').classList.contains('dark'),
  blind: document.getElementById('scene-fade').classList.contains('blind')
}); } catch (e) { return JSON.stringify({ error: String(e) }); } })()`;

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));

  const win = new BrowserWindow({
    width: W, height: H, show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(root, 'preload.js'),
    },
  });

  win.webContents.on('console-message', (_e, _lvl, message) => {
    if (/error|Error/.test(message)) console.log('  [page]', message);
  });

  // Absolute: loadFile resolves relative paths against THIS script's dir, not the repo root.
  await win.loadFile(path.join(root, 'index.html'), { query: { mode: 'player' } });
  await new Promise(r => setTimeout(r, 900));   // let PixiJS + the player runtime settle

  const post = (msg) =>
    win.webContents.executeJavaScript(
      `window.postMessage(${JSON.stringify(msg)}, '*'); true;`);

  // Scene A, as a first open: no 'out' phase, which is the path that has no fog to cover with.
  console.log('scene A (first open)');
  await post(sceneMsg(SCENE_A, false));
  // Long enough for scene A's own cover + hold + reveal to finish, or the run under test
  // starts on top of one still in flight.
  await new Promise(r => setTimeout(r, 5500));

  // Throw the first capture away. capturePage() on a window that has not been captured yet
  // returns a stale compositor frame — it showed as a 45x spike that no state change could
  // explain, i.e. a rig artefact indistinguishable from the bug this rig exists to find.
  await win.webContents.capturePage();
  await new Promise(r => setTimeout(r, 150));

  const frames = [];
  const t0 = Date.now();
  let n = 0;
  const timer = setInterval(async () => {
    const t = Date.now() - t0;
    try {
      const [img, probeRaw] = await Promise.all([
        win.webContents.capturePage(),
        win.webContents.executeJavaScript(PROBE),
      ]);
      const name = `frame-${String(n).padStart(4, '0')}-t${String(t).padStart(4, '0')}ms.png`;
      fs.writeFileSync(path.join(outDir, name), img.toPNG());
      frames.push(Object.assign({ frame: n, t, file: name }, JSON.parse(probeRaw)));
      n++;
    } catch (e) { /* window busy mid-swap — skip the frame rather than abort the run */ }
  }, CAPTURE_EVERY_MS);

  // The transition under test: 'out' starts the close, then the payload lands after the close
  // has had its time — the same hold sceneManager.js applies.
  console.log('transition A -> B');
  await post({ type: 'scene-transition', phase: 'out' });
  const coverMs = await win.webContents.executeJavaScript('FOG_SCENE_COVER_MS');
  await new Promise(r => setTimeout(r, coverMs));
  await post(sceneMsg(SCENE_B, true));

  await new Promise(r => setTimeout(r, RUN_MS - coverMs));
  clearInterval(timer);
  await new Promise(r => setTimeout(r, 250));

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(frames, null, 1));
  console.log(`\n${frames.length} frames -> ${outDir}`);
  app.quit();
}).catch(err => { console.error(err); app.exit(1); });
