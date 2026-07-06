'use strict';

// display.js — display detection, normalization, and IPC wiring.
// Loaded after state.js. Pure helpers at the top; DOM/IPC wiring at the bottom.

// ─── Pure helper ─────────────────────────────────────────────────────────────
// Takes an Electron screen.Display object (or a mock for tests) and extracts the
// three fields we care about. workAreaSize is preferred (excludes OS taskbar);
// falls back to size when workAreaSize is absent (headless / mock objects).
function normalizeDisplayRecord(raw) {
  const src = (raw && raw.workAreaSize) ? raw.workAreaSize
            : (raw && raw.size)         ? raw.size
            : {};
  return {
    w:           src.width  || 0,
    h:           src.height || 0,
    scaleFactor: (raw && typeof raw.scaleFactor === 'number') ? raw.scaleFactor : 1,
  };
}

// ─── Renderer-side wiring ─────────────────────────────────────────────────────
// Called once at init (after state.js + electronAPI are both available). Listens
// for display-info pushes from main.js and writes normalized records to state.js.
function initDisplayDetection() {
  if (!window.electronAPI || !window.electronAPI.onDisplayInfo) return;
  window.electronAPI.onDisplayInfo((raw) => {
    const prev = displayInfo;
    displayInfo = normalizeDisplayRecord(raw);
    updateDisplayReadout();
    // Only re-texture when the display dimensions genuinely changed — skips
    // spurious pushes from window minimize (off-screen bounds) and any event
    // that fires without a real resolution change.
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
