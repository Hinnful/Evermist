'use strict';

// Rasterizes assets/icon.svg -> build/icon.png (1024x1024) using an offscreen
// Electron window. No native image deps needed — electron-builder generates the
// platform .ico/.icns/png set from this single build/icon.png.
//
//   npx electron tools/render-icon.js
//
// offscreen:true forces the renderer to paint even though the window is never
// shown, so the 'paint' event delivers the full frame as a NativeImage.

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const SIZE = 1024;
const root = path.join(__dirname, '..');
const svgPath = path.join(root, 'assets', 'icon.svg');
const outDir = path.join(root, 'build');
const outPath = path.join(outDir, 'icon.png');

app.disableHardwareAcceleration(); // more deterministic offscreen capture

app.whenReady().then(() => {
  const svg = fs.readFileSync(svgPath, 'utf8');
  // Fill the viewport exactly; transparent page so the rounded-tile corners stay clear.
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>html,body{margin:0;padding:0;background:transparent}
    svg{display:block;width:${SIZE}px;height:${SIZE}px}</style></head>
    <body>${svg}</body></html>`;

  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    webPreferences: { offscreen: true },
  });

  let done = false;
  const finish = (image) => {
    if (done) return;
    done = true;
    fs.mkdirSync(outDir, { recursive: true });
    const out = (image.getSize().width !== SIZE)
      ? image.resize({ width: SIZE, height: SIZE, quality: 'best' })
      : image;
    fs.writeFileSync(outPath, out.toPNG());
    console.log('Wrote ' + outPath + ' (' + out.getSize().width + 'x' + out.getSize().height + ')');
    win.destroy();
    app.quit();
  };

  win.webContents.on('paint', (_e, _dirty, image) => {
    if (!image.isEmpty()) finish(image);
  });
  // Fallback: some setups deliver via capturePage rather than a paint frame.
  win.webContents.on('did-finish-load', () => {
    setTimeout(() => {
      if (done) return;
      win.webContents.capturePage().then((img) => {
        if (!img.isEmpty()) finish(img);
      }).catch(() => {});
    }, 600);
  });

  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  setTimeout(() => { if (!done) { console.error('Timed out rendering icon'); app.exit(1); } }, 8000);
});
