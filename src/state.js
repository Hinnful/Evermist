// state.js — shared mutable state, extracted lazily from the inline blob.
// Loaded BEFORE fog.js so these globals exist when fog functions reference them.
// Grow this file on-touch (one concern at a time) — never a big-bang move. See CLAUDE.md.

// ─── Fog display constants ────────────────────────────────────────────────────
// Purple-blue luminosity tint applied over fog on both render paths (Canvas 2D
// fog.js:recompositeCloudEffect and PixiJS renderer.js:purpleOverlay). Must stay
// in state.js so it's declared before both fog.js and renderer.js are evaluated.
let FOG_TINT_ALPHA = 0.18;

// Live fog color vars — changed by the DM color picker and synced to Player.
// fogPickedHex: the raw picked color from the #fog-color input. Stored here so
//   save/restore never has to read the DOM. Set by applyFogColor() in fog.js.
// fogBaseColor: the solid fill shown on the Player's full display (outside + fogged area).
// fogTintColor: the glow overlay drawn source-atop on both DM and Player fog.
// Neither value is baked into fogDataCanvas/baseFogCanvas pixel data — those canvases
// carry alpha only (#1a1a2e fills are alpha-carrier convention, not display color).
// Default picks are derived from a single hue (#3a3a8c) via deriveFogColors() so the
// two-color look matches today's navy base + purple tint as closely as one hue allows.
let fogPickedHex = '#3a3a8c';
let fogBaseColor = '#1a1a2e';
let fogTintColor = '#7050e0';

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

// ─── Migrated from inline blob — map/camera/scene/player-sync/dirty state ────
// These were top-level declarations in the inline <script>. Moved here so all
// shared mutable state lives in one place (CLAUDE.md: "Shared mutable state has
// one home: state.js"). Pure relocation — no renames, no changed initial values.

// ─── Config ───────────────────────────────────────────────────────────────────
const ZOOM_FACTOR       = 1.1;
const POLY_CLOSE_RADIUS = 12;  // screen-px hit area to close polygon on first vertex

// ─── State ────────────────────────────────────────────────────────────────────
let mapOffscreen = null;
let mapBitmap    = null;
let mapVideo     = null;   // <video> element for animated maps
let mapVideoBlob = null;   // original video file Blob for storage/sync
let mapVideoUrl  = null;   // blob URL backing mapVideo (revoke on cleanup)
let videoEnabled = false;  // true while video is actively playing as map source
let videoRAFId   = null;   // RAF id for video-driven map redraws (fallback)
let videoRVFCId  = null;   // requestVideoFrameCallback id (preferred)
let videoLastRenderTs = 0;

let mapWidth = 0, mapHeight = 0;
let zoom = 1, panX = 0, panY = 0;
let isPanning = false;
let panStartX, panStartY, panStartPanX, panStartPanY;
let playerWindow = null;
let playerMapSent = false;
let lastScreenX = null, lastScreenY = null;

// ─── Polygon state ────────────────────────────────────────────────────────────
let polygons = [];          // closed persistent polygons: {id, vertices:[{x,y}], mode}
let nextPolygonId = 1;

// ─── Auto-Sync ────────────────────────────────────────────────────────────────
let autoSync = false;
let autoSyncTimer = null;

// ─── Scene management ─────────────────────────────────────────────────────────
let currentScene    = null;   // full scene record in memory (includes mapBlob ref)
let allScenes       = [];     // lightweight list for the sidebar
let autoSaveTimer   = null;
let mapLoadMode     = 'auto'; // 'new' = create scene, 'replace' = replace map

// ─── Player Sync State ────────────────────────────────────────────────────────
let playerFollowMode = true;  // DM side: last known player mode
let playerFollowDM   = true;  // Player side: whether to mirror DM viewport
let lastDMView       = null;  // Player side: most recent view received from DM
let viewLerpActive   = false;
let viewLerpFrom     = null, viewLerpTo = null, viewLerpStart = 0;
const VIEW_LERP_MS   = 400;

// Dirty flags — the key to avoiding unnecessary work.
// viewportDirty: pan/zoom/resize/map-load changed → redraw ALL layers.
// fogDirty: brush/rect/reveal-all/shroud-all → redraw ONLY the fog layer.
// gridDirty: grid toggle/size change → redraw ONLY the grid layer.
let renderScheduled = false;
let viewportDirty   = false;
let mapDirty        = false;
let fogDirty        = false;
let gridDirty       = false;

// Player-only: the (possibly downscaled) canvas backing the PixiJS map texture for
// video maps. The Player has no DOM <video> compositing — the map is a masked PixiJS
// sprite — so each frame we draw the video into this canvas and re-upload the texture.
let playerMapTexCanvas = null;
let playerMapTexCtx    = null;
