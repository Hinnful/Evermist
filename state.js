// state.js — shared mutable state, extracted lazily from the inline blob.
// Loaded BEFORE fog.js so these globals exist when fog functions reference them.
// Grow this file on-touch (one concern at a time) — never a big-bang move. See CLAUDE.md.

// ─── Fog display constants ────────────────────────────────────────────────────
// Purple-blue luminosity tint applied over fog on both render paths (Canvas 2D
// fog.js:recompositeCloudEffect and PixiJS renderer.js:purpleOverlay). Must stay
// in state.js so it's declared before both fog.js and renderer.js are evaluated.
const FOG_TINT_ALPHA = 0.18;

// ─── Scene-fade timing ────────────────────────────────────────────────────────
// Player-side: minimum time the #scene-fade black must stay visible so even fast
// cached loads feel deliberate rather than a blink.
const SCENE_FADE_MIN_MS = 1500;
let   _sceneFadeStart   = 0; // Date.now() snapshot when .dark was last applied

// ─── Display info ────────────────────────────────────────────────────────────
// Normalized { w, h, scaleFactor } for the screen the Player window is on.
// Written by display.js initDisplayDetection() via the IPC push from main.js.
// null until the first push arrives (typically within ms of window creation).
let displayInfo = null;

// ─── Video frame-rate cap ────────────────────────────────────────────────────
// Named default so reverting is one-line. Live value is mutated by the FPS dial.
const VIDEO_FPS_DEFAULT       = 24;
let   videoFrameIntervalMs    = 1000 / VIDEO_FPS_DEFAULT;

// ─── Grid config ────────────────────────────────────────────────────────────
// All eight are `let` — they are reassigned by UI handlers, applyGridConfig,
// and the postMessage sync block at runtime.
let gridEnabled   = false;
let gridSize      = 70;
let gridOffsetX   = 0;
let gridOffsetY   = 0;
let gridColor     = '#ffffff';
let gridOpacity   = 0.25;
let gridMode      = 'square'; // 'square' | 'hex-flat' | 'hex-pointy'
let gridLineWidth = 1;

// ─── Fog RAF lifecycle handles ──────────────────────────────────────────────────
// requestAnimationFrame ids for the two independent fog loops. Held here (not in
// fog.js) so teardown — stopFogAnim / stopFogTransition — can be reasoned about as
// explicit lifecycle state. null = loop not running.
let fogAnimRafId  = null; // drifting cloud animation loop (fogAnimTick)
let fogTransRafId = null; // reveal/shroud crossfade loop (fogTransTick)
