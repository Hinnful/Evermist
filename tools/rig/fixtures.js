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

// ⚠ A RECORDING IS CHECKED BEFORE IT IS CACHED, and this is not belt and braces. The cache is
// keyed by SIZE and shared across the whole run, so one truncated clip is handed to every
// scenario that asks for that size — and none of them says so. The app just never finishes
// loading the map, and each one dies 180s later on a wait that names the map rather than the
// file. A gate run lost five scenarios and 15 minutes to a single bad 900x600 recording, and the
// only clue was a console error about a byte range on a blob.
//
// The test is STRUCTURAL, never a byte count: a healthy one-second clip runs from 4KB to 10KB
// depending on what moved, so any floor big enough to catch a truncation also fails a good file.
// An mp4 the browser can seek carries all three atoms, and a cut-short recording loses mdat's
// payload first, which is exactly what the byte-range error is.
function _validMp4(buf) {
  if (buf.length < 512) return 'it is only ' + buf.length + ' bytes';
  for (const atom of ['ftyp', 'moov', 'mdat']) {
    if (buf.indexOf(Buffer.from(atom)) === -1) return 'it carries no ' + atom + ' atom';
  }
  const mdat = buf.indexOf(Buffer.from('mdat'));
  if (buf.length - mdat < 256) return 'its mdat holds ' + (buf.length - mdat) + ' bytes of picture';
  return null;
}

function _validPng(buf) {
  if (buf.length < 128) return 'it is only ' + buf.length + ' bytes';
  if (buf.indexOf(Buffer.from('IEND')) === -1) return 'it has no IEND, so it was cut short';
  return null;
}

// Cached ON DISK, not just in memory: the runner boots a fresh app per scenario, so an in-memory
// cache would re-record every clip in real time for every file. The fixture directory is shared
// across the whole run.
async function _cached(file, meta, make) {
  const check = meta.type === 'video/mp4' ? _validMp4 : _validPng;
  if (!fs.existsSync(file)) {
    // One retry. A truncation is transient, so re-recording turns a 15-minute red run into a
    // two-second hiccup; a second failure is real and says so here rather than downstream.
    let why = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const dataUrl = await make();
      const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
      why = check(bytes);
      if (!why) { fs.writeFileSync(file, bytes); break; }
    }
    if (why) {
      throw new Error('the ' + meta.w + 'x' + meta.h + ' fixture came back unusable twice: ' +
                      why + '. Every scenario at that size would have timed out waiting for a ' +
                      'map that can never load.');
    }
  }
  const buf = fs.readFileSync(file);
  const why = check(buf);
  if (why) {
    // A cached file that no longer passes: thrown away rather than handed on, so the next caller
    // records a fresh one instead of inheriting the fault.
    fs.unlinkSync(file);
    throw new Error('the cached ' + meta.w + 'x' + meta.h + ' fixture is unusable: ' + why +
                    '. It has been deleted; the next scenario will record a new one.');
  }
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


// ─── The map every acceptance scenario imports ───────────────────────────────
// ANIMATED, BECAUSE ANIMATED IS THE ONLY KIND THE DM EVER USES. Every acceptance scenario used to
// generate a still PNG, so the whole suite proved the app worked in a case that never happens and
// said nothing about the one that always does. The two paths genuinely differ: an animated map is
// a composited DOM <video> on the DM rather than a GPU texture, the Player redraws its picture
// from the video every frame, fog composites over a moving image, and pan and zoom move the video
// with a CSS transform instead of the PixiJS camera.
//
// Deliberately SMALLER than MAP_BOX_W/H, so an import does not trigger the shrink. Exercising the
// shrink is smoke.js's job and it costs a real-time re-encode; every scenario paying for that
// would make the suite slow enough to stop being run.
//
// One second, and cached on disk per size for the whole run: a scenario that wants the same size
// as another pays nothing. `seconds` is real recording time, so it stays at the floor.
//
// A caller that needs a STILL map asks for one explicitly (stillMap), and smoke.js does — block 2
// there holds the animated render path against the still one, which needs both.
// Every recording option is a DEFAULT here, not a fixed value: a caller that wants a longer clip
// says so and gets one. Forcing them silently meant a scenario could ask for four seconds, get
// one, and read the mismatch as an app bug.
//
// The cache key is the SIZE, so two scenarios at the same size share one recording. A caller that
// overrides a recording option must name its own fixture too, or it would collide with the shared
// one and get whichever was recorded first.
async function tableMap(session, outDir, opts) {
  const o = Object.assign({ w: 1600, h: 1000, seconds: 1, fps: 15, bitrate: 1500000 }, opts || {});
  return animatedMap(session, outDir, {
    w: o.w, h: o.h, seconds: o.seconds, fps: o.fps, bitrate: o.bitrate,
    name: o.name || ('rig-table-' + o.w + 'x' + o.h + '.mp4'),
  });
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

module.exports = { stillMap, animatedMap, tableMap, asFileExpr, REC_MIME };
