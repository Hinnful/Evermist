// state.js — shared mutable state. Loaded before fog.js so these globals exist when
// fog functions reference them. Grow on-touch, one concern at a time. See CLAUDE.md.

// ─── Fog display constants ───────────────────────────────────────────────────
// Must be declared here: both fog.js and renderer.js read it at evaluation time.
let FOG_TINT_ALPHA = 0.18;

// Live fog colours, set by applyFogColor() in fog.js and synced to the Player.
// Not baked into fogDataCanvas/baseFogCanvas — those carry alpha only, and their
// #1a1a2e fills are an alpha-carrier convention rather than a display colour.
let fogPickedHex = '#3a3a8c';
let fogBaseColor = '#1a1a2e';   // solid fill on the Player's full display
let fogTintColor = '#7050e0';   // glow drawn source-atop on both views

// ─── Scene-fade timing ───────────────────────────────────────────────────────
// How long the fog sits fully closed before it starts clearing — the beat in the middle of a
// switch, and the floor that stops a fast cached load from blinking. Measured from the moment
// the cover lands, not from the start of the switch: the closing fog is its own beat and is
// timed by FOG_SCENE_COVER_MS. Close + this + FOG_SCENE_UNCOVER_MS is the whole switch.
const SCENE_FADE_MIN_MS = 1400;
let   _sceneFadeStart   = 0;

// ─── Display info ────────────────────────────────────────────────────────────
// Normalized { w, h, scaleFactor } for the Player's screen, pushed from main.js via
// display.js. null until the first push arrives.
let displayInfo = null;

// ─── Video frame-rate cap ────────────────────────────────────────────────────
// Live: video.js throttles its per-frame video loop on this. NOT a map redraw rate — neither
// view draws its map from that loop (the DM composites a DOM <video>, the Player's texture rides
// the PixiJS ticker). What it paces is doRender's syncVideoDomTransform on the DM, and the loop
// itself is the stall watchdog's liveness signal.
const VIDEO_FPS_DEFAULT       = 24;
const videoFrameIntervalMs    = 1000 / VIDEO_FPS_DEFAULT;

// ─── Animated-map import box ─────────────────────────────────────────────────
// An oversized animated map is re-encoded to fit this box at import (mapConvert.js). 3840×2160
// is 2× the club TV's 1080p and under the 4096 ceiling where hardware VP9/H.264 decode stops
// on integrated graphics — two decoders live at once (DM + Player), and they are the memory
// problem, not the CPU one.
// The bitrate is a one-line tunable — why 15 Mbps is in docs/DECISIONS.md.
const MAP_BOX_W = 3840;
const MAP_BOX_H = 2160;
const MAP_CONVERT_BITRATE = 15000000;

// ─── App frame-rate cap ──────────────────────────────────────────────────────
// ONE clock, not two: this caps the PixiJS ticker, and render.js's dirty-flag loop
// rides that same ticker. Capping both independently was measured and rejected (same
// interval, different phase, so the Canvas-2D layers led the map). Do not add a second
// throttle in render.js. Do not lower below 30: slow water and fire on video maps start
// to break up. Deliberately no UI control and not persisted.
const APP_MAX_FPS   = 30;
const APP_FRAME_MS  = 1000 / APP_MAX_FPS;

// ─── Render boost (DM viewport gestures) ─────────────────────────────────────
// A gesture lifts the cap for its duration, since 30fps reads as heavy mid-pan.
//
// EXPRESSED AS A DEADLINE, NOT AN ON/OFF PAIR — do not "simplify" it into
// boost-on-mousedown / restore-on-mouseup. A pair must catch every way a gesture can
// end, and one missed path leaves the renderer uncapped for the rest of the session
// with nothing looking wrong. A deadline re-caps itself.
const RENDER_BOOST_MS = 250;
let renderBoostUntil  = 0;   // performance.now() timestamp; 0 = not boosted

// ─── Grid config ─────────────────────────────────────────────────────────────
// The default cell size is also what Reset lands on and what a fresh import starts at
// (grid.js freshGridConfig), so it is one constant rather than three copies of 70.
const GRID_DEFAULT_SIZE = 70;
let gridEnabled   = false;
let gridSize      = GRID_DEFAULT_SIZE;
let gridOffsetX   = 0;
let gridOffsetY   = 0;
let gridColor     = '#ffffff';
let gridOpacity   = 0.25;
let gridMode      = 'square'; // 'square' | 'hex-flat' | 'hex-pointy'
let gridLineWidth = 1;

// ─── Fog RAF lifecycle handles ───────────────────────────────────────────────
// Held here rather than in fog.js so teardown is explicit lifecycle state.
let fogAnimRafId  = null; // drifting cloud animation loop (fogAnimTick)
let fogTransRafId = null; // reveal/shroud crossfade loop (fogTransTick)
// Player scene-switch cover. 0 = the scene's own fog, 1 = the whole surface fogged; the value
// between is the fog closing or clearing. renderFog lifts the reveal mask's alpha by this, and
// short-circuits to "punch no holes at all" at 1 — which is what makes a FULL cover immune to
// the map changing size underneath it mid-switch.
let fogCoverT     = 0;
let fogCoverRafId = null;
let fogCoverFrom  = 0, fogCoverTo = 0, fogCoverStart = 0, fogCoverDur = 0;
let fogCoverDone  = null;   // one-shot callback fired when an animation lands
// Cloud-texture transform across a scene swap. The texture is anchored to the MAP, so the
// instant mapWidth/zoom/pan change together it jumps to a new scale and origin. fogCloudLast
// banks the drawn transform every frame; fogCloudHold pins it there for the length of the
// switch; fogCloudAdj then re-anchors the incoming scene ONTO that held transform, so the
// texture never has a scale or origin change to travel across. hw/hh null = use the scene's own.
let fogCloudLast = null;
let fogCloudHold = null;
let fogCloudAdj  = { k: 1, dx: 0, dy: 0, hw: null, hh: null };
// DM side: when the Player was told to start closing, so the scene payload can be held back
// until that close has finished. 0 = no Player, send immediately.
let _sceneOutPostedAt = 0;

// ─── Config ──────────────────────────────────────────────────────────────────
const ZOOM_FACTOR       = 1.1;
const POLY_CLOSE_RADIUS = 12;  // screen-px hit area to close polygon on first vertex

// Room outline colours, one per fog state. ONE table, because the room being drawn and the
// room once it is saved must be the same colour — two lists drifted apart and a polygon
// changed hue the instant it closed. Half is a cool teal that sits BETWEEN reveal-green and
// shroud-purple on the hue wheel, so it reads as "part way" rather than a fourth unrelated
// state; keep that relationship if these are ever retuned.
// Read by drawPolyOutline + drawActivePolyPreview (tools.js) and drawCursor (render.js).
const POLY_EDGE_COLORS = {
  reveal: 'rgba(50, 220, 110, 0.8)',
  half:   'rgba(70, 190, 210, 0.8)',
  shroud: 'rgba(150, 80, 255, 0.8)',
};
const POLY_EDGE_SELECTED = '#ffd060';

// ─── Map / camera ────────────────────────────────────────────────────────────
let mapOffscreen = null;
let mapBitmap    = null;
let mapVideo     = null;   // <video> element for animated maps
let mapVideoBlob = null;   // original video file Blob for storage/sync
let mapVideoUrl  = null;   // blob URL backing mapVideo (revoke on cleanup)
let videoEnabled = false;  // true while video is actively playing as map source
let videoRVFCId  = null;   // requestVideoFrameCallback id; the only frame-loop handle
let videoLastRenderTs = 0;

let mapWidth = 0, mapHeight = 0;
let zoom = 1, panX = 0, panY = 0;
let isPanning = false;
let panStartX, panStartY, panStartPanX, panStartPanY;
let playerWindow = null;
let playerMapSent = false;
let lastScreenX = null, lastScreenY = null;

// ─── Rooms (called polygons in code) ─────────────────────────────────────────
// {id, vertices:[{x,y}], mode, name, desc, cornerRadius, cornerRadii, doors}.
// doors is [{edge, t, w, d}] — a rectangle drawn on the outline that carves a notch out through
// the wall, so a revealed room shows where its exits are. Stored on the room, so it appears
// only when the room does; a free-standing marker would map every exit before the party.
// NEVER reorder this array — rebuildFogFromPolygons() walks it in reverse, so its order
// IS fog compositing precedence.
let polygons = [];
let nextPolygonId = 1;
let showRoomLabels = true;   // roomPanel.js drawRoomLabels, toggled with L

// Door size, as a percent of one grid cell. Global, never per door: a doorway is one square almost
// everywhere, and the few that differ are worth a second click rather than a second control.
let doorWidthPct = 100;
let doorDepthPct = 10;
const DOOR_SIZE_KEY = 'evermist.doorSize';

// ─── Map effects ─────────────────────────────────────────────────────────────
// {id, vertices, material, cornerRadius, cornerRadii, name} — the SAME record a room has, with a
// `material` where a room carries a fog `mode`. There is no `kind` field: which tool drew it
// survives only as the vertex count. A SEPARATE array from polygons, never
// merged into it: polygons order IS fog compositing precedence (rebuildFogFromPolygons walks
// it in reverse), so an effect sitting in that list would silently change how fog resolves for
// the rooms around it with nothing on screen to explain it.
//
// Persisted alongside rooms: an autosave snapshot, a scene field and a backup entry each carry
// the array, and it rides the undo history too. Cleared by switchScene, so a fire never follows
// the DM onto the next map.
let effects = [];
let nextEffectId = 1;

// Which array a newly drawn rectangle or circle lands in: 'rooms' | 'effects'. A room and an
// effect are the same gesture with a different payload, so the shape tools are shared and only
// the destination switches. Runtime-only, like snapToGrid.
let placeMode = 'rooms';

// What a newly drawn effect is made of, and what the material picker in the context row has lit.
// A key into EFFECT_MATERIALS (effects.js). Runtime-only, like placeMode.
let currentMaterial = 'fire';

// ─── Auto-Sync ───────────────────────────────────────────────────────────────
let autoSync = false;
let autoSyncTimer = null;

// ─── Scene management ────────────────────────────────────────────────────────
let currentScene    = null;   // full scene record in memory (includes mapBlob ref)
let allScenes       = [];     // lightweight list for the sidebar
let autoSaveTimer   = null;

// ─── Player sync state ───────────────────────────────────────────────────────
let playerFollowMode   = true;  // DM side: last known player mode
let playerFollowDM     = true;  // Player side: whether to mirror DM viewport
let playerInputLocked  = false; // Player side: lock flag pushed from DM minimap Lock
let lastDMView       = null;    // Player side: most recent view received from DM
let viewLerpActive   = false;
let viewLerpFrom     = null, viewLerpTo = null, viewLerpStart = 0;
const VIEW_LERP_MS   = 400;

// ─── Dirty flags ─────────────────────────────────────────────────────────────
// viewportDirty redraws all layers; fogDirty/gridDirty redraw only their own.
// cursorDirty is the 2D overlay (room outlines, labels, cursor shape) — only the
// viewport gestures set it, see scheduleCursor() in render.js for why they must not call
// drawCursor() straight from the event handler.
let renderScheduled = false;
let viewportDirty   = false;
let fogDirty        = false;
let gridDirty       = false;
let cursorDirty     = false;

// Player-only canvas backing the PixiJS map texture for video maps. The Player has no DOM
// <video> compositing, so each frame draws the video here and re-uploads the texture.
let playerMapTexCanvas = null;
let playerMapTexCtx    = null;

// ─── Player screen dimensions (DM-side cache) ────────────────────────────────
// Reported on PLAYER_READY and every resize; the minimap sizes itself from these.
// 16:9 fallback until the first report arrives.
let playerScreenW = 1920;
let playerScreenH = 1080;

// Whether the Player window is natively fullscreen. Reported by the Player, which gets it
// from main.js — native fullscreen fires no DOM event, so nothing else can tell.
let playerIsFullscreen = false;

// ─── Minimap state ───────────────────────────────────────────────────────────
// minimapView IS the intended Player camera: seeded on map load, updated by drag on the
// minimap, by Sync View, and by Player freelook reports.
let minimapView   = { mapCX: 0, mapCY: 0, zoom: 1 };
let minimapLocked = false;
let minimapDirty  = false;
