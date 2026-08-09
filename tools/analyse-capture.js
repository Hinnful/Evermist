'use strict';

// Scores a capture-transition.js run for JUMPS.
//
//   npx electron tools/analyse-capture.js [captureDir]
//
// Mean absolute pixel difference between consecutive frames. Fog drifting and fog closing are
// gradual, so they sit low and flat; anything that snaps — a cloud texture changing scale in
// one frame, a map appearing — spikes. Reports the worst offenders with their timestamps so a
// spike can be traced back to what the manifest says was happening at that moment.
//
// Reading the numbers: what matters is a spike RELATIVE to its neighbours, not its absolute
// size. A run whose peak is ~2x the median is smooth; ~10x is a visible snap.

const { app, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const dir = process.argv[2] || path.join(__dirname, '..', '.capture');

app.disableHardwareAcceleration();

app.whenReady().then(() => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const rows = [];
  let prev = null;

  for (const f of manifest) {
    const img = nativeImage.createFromPath(path.join(dir, f.file));
    const buf = img.toBitmap();
    if (prev && prev.length === buf.length) {
      let sum = 0;
      // Every 4th pixel is plenty for a jump metric and keeps a 90-frame run quick.
      for (let i = 0; i < buf.length; i += 16) sum += Math.abs(buf[i] - prev[i]);
      rows.push({ t: f.t, diff: sum / (buf.length / 16), state: f });
    }
    prev = buf;
  }

  const sorted = rows.map(r => r.diff).slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const peak = rows.reduce((a, b) => (b.diff > a.diff ? b : a), rows[0]);

  console.log(`frames compared: ${rows.length}`);
  console.log(`median frame-to-frame diff: ${median.toFixed(3)}`);
  console.log(`peak: ${peak.diff.toFixed(3)} at ${peak.t}ms  (${(peak.diff / (median || 1)).toFixed(1)}x median)\n`);

  console.log('worst 8 frames:');
  rows.slice().sort((a, b) => b.diff - a.diff).slice(0, 8).forEach(r => {
    const s = r.state;
    console.log(`  ${String(r.t).padStart(5)}ms  diff=${r.diff.toFixed(3).padStart(7)}` +
      `  ${(r.diff / (median || 1)).toFixed(1)}x   coverT=${String(s.coverT).padEnd(5)}` +
      ` held=${s.cloudHeld ? 'Y' : '.'} morph=${s.cloudMorphing ? 'Y' : '.'} mapW=${s.mapW}`);
  });

  app.quit();
}).catch(err => { console.error(err); app.exit(1); });
