// fogClouds.js — the noise texture the fog drifts.

// The set a sibling document copies instead of building its own; a bare `let` never crosses.
function cloudFrameSet() {
  return { frames: cloudFrames, warp: cloudSetWarp };
}

// ⚠ ONE DOCUMENT BUILDS THE SET AND THE REST COPY IT. Two-map mode opens four Player documents on
// one thread, and four builds of sixteen noise frames stall every window for seconds.
function adoptCloudFrames(size, numFrames) {
  const sources = [];
  const add = (w) => { try { if (w && w !== window) sources.push(w); } catch (e) {} };
  add(window.parent);
  add(window.opener);
  try { add(window.parent !== window && window.parent.opener); } catch (e) {}
  // ⚠ READ AND COPY INSIDE THE GUARD. A source torn down mid-copy would otherwise throw out of
  // generateCloudFrames, which runs inside initPlayer and would take the rest of init with it.
  for (const w of sources) {
    try {
      const set = typeof w.cloudFrameSet === 'function' ? w.cloudFrameSet() : null;
      if (!set || !set.warp || set.frames.length !== numFrames) continue;
      if (set.frames[0].width !== size) continue;
      // ⚠ THE WARP COMES WITH THE FRAMES. Every new document starts on the defaults and its real
      // numbers arrive later, so refusing the copy on a mismatch builds a set nobody sees and then
      // the right one. `set.warp` is what the frames were BUILT with, so the pair stays consistent.
      const copies = set.frames.map((f) => {
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        c.getContext('2d').drawImage(f, 0, 0);
        return c;
      });
      cloudFrames = copies;
      cloudCanvas = copies[0];
      cloudSetWarp = { strength: set.warp.strength, radius: set.warp.radius };
      // ⚠ AFTER THE COPY, which throws when the source goes away mid-read. Set above, a failed
      // attempt leaves this document building its own frames at a warp it never chose.
      cloudWarpStrength = set.warp.strength;
      cloudWarpRadius   = set.warp.radius;
      cloudBlendCanvas = document.createElement('canvas');
      cloudBlendCanvas.width = size; cloudBlendCanvas.height = size;
      cloudBlendCtx = cloudBlendCanvas.getContext('2d');
      cloudBlendCtx.drawImage(copies[0], 0, 0);
      cloudPattern = copies[0].getContext('2d').createPattern(cloudBlendCanvas, 'repeat');
      return true;
    } catch (e) { /* that window went away; try the next source, else build */ }
  }
  return false;
}

function generateCloudFrames(size, numFrames) {
  if (!generateCloudFrames._initialized && adoptCloudFrames(size, numFrames)) {
    generateCloudFrames._initialized = true;
    return;
  }

  function makeGrid(n) {
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = Math.random();
    return g;
  }

  const layers = [
    { grid: makeGrid(7),  n: 7,  scale: 1.0  },
    { grid: makeGrid(13), n: 13, scale: 0.5  },
    { grid: makeGrid(23), n: 23, scale: 0.25 },
    { grid: makeGrid(37), n: 37, scale: 0.12 },
    { grid: makeGrid(53), n: 53, scale: 0.06 },
  ];

  function turbulence(px, py) { return fogTurbulence(layers, px, py); }

  function renderFrame(cvs, tNorm) {
    const ctx = cvs.getContext('2d');
    const img = ctx.createImageData(size, size);
    const d   = img.data;
    const tA  = tNorm * 2 * Math.PI;
    const tC  = Math.cos(tA) * cloudWarpRadius;
    const tS  = Math.sin(tA) * cloudWarpRadius;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = x / size, ny = y / size;
        const w1 = turbulence(nx + tC, ny + tS);
        const w2 = turbulence(nx + tS + 5.2, ny - tC + 1.3);
        const v  = turbulence(nx + w1 * cloudWarpStrength, ny + w2 * cloudWarpStrength);

        const i = (y * size + x) * 4;
        // Neutral grey: R=G=B so the cloud adds brightness texture without
        // baking in a hue. Fog color comes entirely from fogBaseColor/fogTintColor.
        const grey = (20 + 110 * v) | 0;
        d[i] = d[i + 1] = d[i + 2] = grey;
        d[i + 3] = (140 + 115 * v) | 0;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function newFrame(i) {
    const cvs = document.createElement('canvas');
    cvs.width = size; cvs.height = size;
    renderFrame(cvs, i / numFrames);
    return cvs;
  }

  // ⚠ NEVER GENERATE THE WHOLE SET SYNCHRONOUSLY. One frame costs tens of milliseconds, and the
  // Player window pays the set at startup - twice over in two-map mode, where both halves share
  // one thread. Either path builds its frames one per timeout.
  const genId = ++generateCloudFrames._genId;
  const genWarp = { strength: cloudWarpStrength, radius: cloudWarpRadius };
  const rest  = [];
  let idx = 0;
  function genNext() {
    if (genId !== generateCloudFrames._genId) return;   // superseded
    if (idx >= numFrames) {
      cloudFrames = rest;
      cloudSetWarp = genWarp;
      cloudCanvas = rest[0];
      cloudBlendCtx.drawImage(rest[0], 0, 0);
      cloudPattern = rest[0].getContext('2d').createPattern(cloudBlendCanvas, 'repeat');
      return;
    }
    rest.push(newFrame(idx++));
    setTimeout(genNext, 0);
  }

  // A regeneration keeps the live set on screen until the replacement is whole. A first pass has
  // nothing to keep, so frame 0 goes out alone; the morph skips a one-frame set and holds still.
  if (!generateCloudFrames._initialized) {
    generateCloudFrames._initialized = true;
    const first = newFrame(idx++);
    rest.push(first);
    cloudFrames = [first];
    cloudCanvas = first;
    cloudBlendCanvas = document.createElement('canvas');
    cloudBlendCanvas.width = size; cloudBlendCanvas.height = size;
    cloudBlendCtx = cloudBlendCanvas.getContext('2d');
    cloudBlendCtx.drawImage(first, 0, 0);
    cloudPattern = first.getContext('2d').createPattern(cloudBlendCanvas, 'repeat');
  }
  // ⚠ A HIDDEN WINDOW FINISHES THE SET NOW. Nobody is looking, and its timers run at about 1Hz,
  // so a pre-warmed Player would otherwise still be filling its set when the button is pressed.
  if (typeof document !== 'undefined' && document.hidden) {
    while (idx < numFrames) rest.push(newFrame(idx++));
    genNext();
    return;
  }
  setTimeout(genNext, 0);
}
generateCloudFrames._initialized = false;
generateCloudFrames._genId = 0;
