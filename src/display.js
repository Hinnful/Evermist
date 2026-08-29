'use strict';

// display.js — display detection, normalization, and IPC wiring.
// Loaded after state.js. Pure helpers at the top; DOM/IPC wiring at the bottom.

// ─── Pure helper ─────────────────────────────────────────────────────────────
// Three fields out of an Electron screen.Display. workAreaSize is preferred, since it excludes the
// OS taskbar, and size is the fallback where it is absent.
function normalizeDisplayRecord(raw) {
  const src = (raw && raw.workAreaSize) ? raw.workAreaSize
            : (raw && raw.size)         ? raw.size
            : {};
  return {
    w:           src.width  || 0,
    h:           src.height || 0,
    // isFinite, not typeof: NaN and Infinity are both numbers, and either one reaches the
    // readout and the re-texture comparison as a value nothing can recover from.
    scaleFactor: (raw && Number.isFinite(raw.scaleFactor)) ? raw.scaleFactor : 1,
  };
}

// ─── Renderer-side wiring ─────────────────────────────────────────────────────
// Called once at init. Listens for display-info pushes from main.js and writes normalised records
// to state.js.
function initDisplayDetection() {
  if (!window.electronAPI || !window.electronAPI.onDisplayInfo) return;
  window.electronAPI.onDisplayInfo((raw) => {
    const prev = displayInfo;
    displayInfo = normalizeDisplayRecord(raw);
    updateDisplayReadout();
    // Only re-texture when the dimensions genuinely changed, which skips the spurious pushes a
    // window minimize produces.
    const changed = !prev
      || prev.w !== displayInfo.w
      || prev.h !== displayInfo.h
      || prev.scaleFactor !== displayInfo.scaleFactor;
    if (changed && typeof onDisplayInfoUpdated === 'function') onDisplayInfoUpdated();
  });
}

// Updates the DM-only readout element. No-ops in Player mode.
function updateDisplayReadout() {
  if (typeof isPlayer !== 'undefined' && isPlayer) return;
  const el = document.getElementById('display-info-readout');
  if (!el || !displayInfo) return;
  el.textContent = `${displayInfo.w} × ${displayInfo.h}  @${displayInfo.scaleFactor}x`;
}

// ─── Export guard (Node require for tests; no-op on file://) ────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizeDisplayRecord };
}
