'use strict';

// fixtures.js — the test maps, made at runtime inside the running app and written to the rig's
// temp directory. NEVER COMMITTED: a fresh clone regenerates every one of them, and nothing
// binary goes into git.
//
// This is what removes "point the rig at one of your real maps" as a precondition. The still map
// is a canvas drawn in-page and saved as PNG; the animated one is recorded in-page with
// MediaRecorder, at whatever size the caller asks for — so the oversized-import path is reachable
// without a 40 MB Dungeon Alchemist export sitting in the repo.
//
// ⚠ THE BYTES TRAVEL AS BASE64 OVER CDP, NOT AS A FILE PATH. `DOM.setFileInputFiles` does not
// populate a file input in an Electron renderer (it reports success and leaves files.length at 0),
// and the page cannot fetch a file:// URL under the app's real security posture. So a fixture is
// pushed back into the page as bytes and handed to createNewScene as a File built in-page — which
// is also the honest import path: a File with no path on disk takes the saveVideoBlob IPC route.

const fs = require('fs');
const path = require('path');

// H.264 High 5.1. The app asserts the same string; a lower level caps resolution below the box
// and MediaRecorder rejects it outright.
const REC_MIME = 'video/mp4;codecs=avc1.640033';

// Cached ON DISK, not just in memory: the runner boots a fresh app per scenario, so an in-memory
// cache would re-record every clip in real time for every file. The fixture directory is shared
// across the whole run.
async function _cached(file, meta, make) {
  if (!fs.existsSync(file)) {
    const dataUrl = await make();
    fs.writeFileSync(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
  }
  const buf = fs.readFileSync(file);
  return Object.assign({ path: file, base64: buf.toString('base64'), bytes: buf.length }, meta);
}

// ─── A still map ─────────────────────────────────────────────────────────────
// Four distinct quadrants over a dark ground, so a fog assertion can name a place ("the
// top-left quarter") and a screenshot is readable at a glance.

async function stillMap(session, outDir, opts) {
  const o = Object.assign({ w: 2000, h: 1200, name: 'rig-still.png' }, opts || {});
  return _cached(path.join(outDir, o.name), { name: o.name, w: o.w, h: o.h, type: 'image/png' },
    () => session.readBig(`(async () => {
      const c = document.createElement('canvas');
      c.width = ${o.w}; c.height = ${o.h};
      const x = c.getContext('2d');
      x.fillStyle = '#20242e'; x.fillRect(0, 0, c.width, c.height);
      const quads = ['#8d5524', '#3a6b35', '#2f4b7c', '#7a2f4b'];
      for (let i = 0; i < 4; i++) {
        x.fillStyle = quads[i];
        x.fillRect((i % 2) * c.width / 2, Math.floor(i / 2) * c.height / 2, c.width / 2, c.height / 2);
      }
      x.strokeStyle = 'rgba(255,255,255,0.22)'; x.lineWidth = 2;
      for (let gx = 0; gx <= c.width; gx += 100) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, c.height); x.stroke(); }
      for (let gy = 0; gy <= c.height; gy += 100) { x.beginPath(); x.moveTo(0, gy); x.lineTo(c.width, gy); x.stroke(); }
      return c.toDataURL('image/png');
    })()`));
}

// ─── An animated map ─────────────────────────────────────────────────────────
// Recorded in real time from a canvas, so `seconds` is also roughly how long this takes. Keep it
// short: the app re-encodes an oversized import in real time too, so every second here is paid
// for twice.

async function animatedMap(session, outDir, opts) {
  const o = Object.assign({ w: 1280, h: 720, seconds: 2, fps: 15, bitrate: 2000000,
                            name: 'rig-anim.mp4' }, opts || {});
  return _cached(path.join(outDir, o.name), { name: o.name, w: o.w, h: o.h, type: 'video/mp4' },
    () => session.readBig(`(async () => {
      if (!MediaRecorder.isTypeSupported(${JSON.stringify(REC_MIME)})) throw new Error('no H.264 recorder');
      const c = document.createElement('canvas');
      c.width = ${o.w}; c.height = ${o.h};
      const x = c.getContext('2d');
      const stream = c.captureStream(${o.fps});
      const rec = new MediaRecorder(stream, { mimeType: ${JSON.stringify(REC_MIME)},
                                              videoBitsPerSecond: ${o.bitrate} });
      const chunks = [];
      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise(r => { rec.onstop = r; });
      rec.start();
      const t0 = performance.now();
      await new Promise(done => {
        const frame = () => {
          const t = (performance.now() - t0) / 1000;
          x.fillStyle = '#20242e'; x.fillRect(0, 0, c.width, c.height);
          const quads = ['#8d5524', '#3a6b35', '#2f4b7c', '#7a2f4b'];
          for (let i = 0; i < 4; i++) {
            x.fillStyle = quads[i];
            x.fillRect((i % 2) * c.width / 2, Math.floor(i / 2) * c.height / 2, c.width / 2, c.height / 2);
          }
          // One moving element, so the clip is genuinely animated rather than a still in a
          // container — a frozen video and a working one look identical without it.
          x.fillStyle = '#ffd479';
          x.beginPath();
          x.arc(c.width * (0.2 + 0.6 * (t / ${o.seconds})), c.height / 2, c.height * 0.08, 0, Math.PI * 2);
          x.fill();
          if (t >= ${o.seconds}) { done(); return; }
          requestAnimationFrame(frame);
        };
        frame();
      });
      rec.stop();
      await stopped;
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: 'video/mp4' });
      return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
    })()`));
}

// ─── Handing a fixture to the app ────────────────────────────────────────────
// Pushes the bytes into the page and leaves `__rigMakeFile()` behind, which builds the File the
// app's own createNewScene takes. Returns the expression that calls it.

async function asFileExpr(session, fixture) {
  await session.writeBig('__rigB64', fixture.base64);
  await session.evaluate(`globalThis.__rigMakeFile = () => {
    const bin = atob(globalThis.__rigB64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new File([u8], ${JSON.stringify(fixture.name)}, { type: ${JSON.stringify(fixture.type)} });
  }; 0`);
  return '__rigMakeFile()';
}

module.exports = { stillMap, animatedMap, asFileExpr, REC_MIME };
