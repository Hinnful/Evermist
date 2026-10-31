'use strict';

// Rasterizes assets/icon.svg -> build/icon.png and assets/icon-mac.svg -> build/icon-mac.png (1024x1024)
// using an offscreen Electron window. No native image deps needed — electron-builder generates the
// platform .ico/.png set from build/icon.png, and the Mac's .icns from build/icon-mac.png, because the
// Dock expects a rounded square where Windows and Linux take the bare hexagon.
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
const outDir = path.join(root, 'build');
const JOBS = [['icon.svg', 'icon.png'], ['icon-mac.svg', 'icon-mac.png']];

app.disableHardwareAcceleration(); // more deterministic offscreen capture
// Each job destroys its window before the next one opens; without this the app quits after the first.
app.on('window-all-closed', () => {});

function render(svgPath, outPath) {
  return new Promise((resolve, reject) => {
    const svg = fs.readFileSync(svgPath, 'utf8');
    // Fill the viewport exactly; transparent page so the icon's own corners stay clear.
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
      resolve();
    };

    // Early frames can be blank, so keep the latest one and take it once the page has settled.
    let last = null;
    win.webContents.on('paint', (_e, _dirty, image) => {
      if (!image.isEmpty()) last = image;
    });
    win.webContents.on('did-finish-load', () => {
      win.webContents.invalidate();
      setTimeout(() => {
        if (done) return;
        if (last) { finish(last); return; }
        // Fallback: some setups deliver via capturePage rather than a paint frame.
        win.webContents.capturePage().then((img) => {
          if (!img.isEmpty()) finish(img);
        }).catch(() => {});
      }, 800);
    });

    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

    setTimeout(() => { if (!done) reject(new Error('Timed out rendering ' + svgPath)); }, 8000);
  });
}

app.whenReady().then(async () => {
  try {
    for (const [src, out] of JOBS) await render(path.join(root, 'assets', src), path.join(outDir, out));
    app.quit();
  } catch (err) {
    console.error(err.message);
    app.exit(1);
  }
});
