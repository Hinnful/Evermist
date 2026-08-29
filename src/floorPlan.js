'use strict';

// floorPlan.js — turning a Dungeon Alchemist floor plan into this scene's rooms.
//
// The geometry is vttPlan.js, pure and tested. This file is the app side: finding the plan on
// disk, storing it on the scene, asking the DM once, and rewriting the polygon set. Rules live in
// the `floor-plan` skill.
//
// ELECTRON ONLY: finding the sibling file needs the preload bridge, so bare file:// finds no plan.
// It degrades to silence rather than an error.

// ─── Finding the plan ─────────────────────────────────────────────────────────

// The dropped map's own path, then its sibling. getPathForFile must be called in the
// preload — Electron 32 removed File.path, and the renderer cannot reach webUtils.
async function findPlanForFile(file) {
  try {
    const api = window.electronAPI;
    if (!api || !api.findFloorPlan || !api.getPathForFile) return null;
    const mapPath = api.getPathForFile(file);
    if (!mapPath) return null;
    const found = await api.findFloorPlan(mapPath);
    return found && found.text ? found.text : null;
  } catch (_) {
    return null;
  }
}

// Reads a plan's text and derives it. ⚠ A truncated or malformed file must behave EXACTLY like no
// plan at all, and above all throw nothing into the import path, where an unhandled rejection
// strands the map-progress overlay.
function describePlan(planText) {
  if (typeof planText !== 'string' || !planText.trim()) return null;
  let parsed;
  try { parsed = JSON.parse(planText); } catch (_) { return null; }
  try {
    const derived = vttDerivePlan(parsed);
    // Nothing to draw is not an offer. Callers must never ask about zero rooms.
    if (!derived || !derived.rooms.length) return null;
    return derived;
  } catch (err) {
    console.warn('[floorPlan] deriving rooms failed', err);
    return null;
  }
}

// Drives the Draw Rooms button's enabled state.
function hasFloorPlan() {
  return !!(currentScene && currentScene.floorPlan && describePlan(currentScene.floorPlan));
}

// ─── Drawing the rooms ────────────────────────────────────────────────────────

function applyPlanToScene(derived) {
  if (!derived || !derived.rooms.length) return;
  pushUndo();
  // Wipe-and-rebuild can delete the selected room, leaving selectedPolygonId on a dead id and the
  // card open on a ghost. Every wholesale polygon rewrite nulls both first.
  activePolygon = null;
  selectedPolygonId = null;

  // ⚠ THE KERNEL'S COORDINATES ARE IN THE EXPORT'S PIXEL SPACE, NOT THIS MAP'S. vttPlan.js has no
  // map-width term, so a map shrunk at import gets every room too large. Scaling here covers the
  // import path and the attach-a-plan-later path with one rule.
  const rooms = vttScaleRooms(derived.rooms, mapWidth, derived.srcW);

  // Numbered from 1 in the kernel's spatial order, so the names read down the map. Same shape the
  // drawing tools produce, or the card and the fog rebuild would not recognise them.
  polygons = rooms.map((verts, i) => ({
    id: i + 1,
    vertices: verts.map(v => ({ x: v.x, y: v.y })),
    // A freshly prepped map starts hidden. Rooms get revealed at the table, not now.
    mode: 'shroud',
    cornerRadius: 0,
    name: 'Room ' + (i + 1),
  }));
  nextPolygonId = polygons.length + 1;

  rebuildFogFromPolygons();
  rebuildFogEffect();
  fogDirty = true;
  if (typeof refreshRoomPanel === 'function') refreshRoomPanel();
  scheduleRender();
  scheduleAutoSync();
  doAutoSave();
}

// ─── Grid size from the plan ──────────────────────────────────────────────────

// The grid the control can actually hold: #grid-size is a 10–400 range, and a value outside it
// leaves the slider and the global disagreeing.
const FP_GRID_MIN = 10;
const FP_GRID_MAX = 400;

// The cell size this plan implies for the loaded map: PIXELS ACROSS DIVIDED BY SQUARES ACROSS,
// which self-corrects a resolution mismatch. ⚠ Reading pixels_per_grid straight off the file hands
// back the untouched export's number and puts the grid out of step. That field is only the
// fallback for a file omitting map_size; null where neither is usable.
function planGridSize(planText, mapW) {
  const derived = describePlan(planText);
  if (!derived) return null;
  const w = Number(mapW);
  const raw = (derived.squaresX > 0 && isFinite(w) && w > 0)
    ? w / derived.squaresX
    : derived.gridPx;
  if (!isFinite(raw) || raw <= 0) return null;
  return Math.max(FP_GRID_MIN, Math.min(FP_GRID_MAX, Math.round(raw)));
}

// ⚠ IMPORT PATH ONLY. Draw Rooms runs applyPlanToScene on the same plan later, and a hand-tuned
// grid must survive that — so this is called from the import and never from applyPlanToScene.
//
// SIZE ONLY, NOT OFFSET: a correctly-sized grid can still land out of phase on a plan with a
// non-zero origin, and offset stays a manual nudge.
function applyPlanGridSize() {
  if (!currentScene) return null;
  const size = planGridSize(currentScene.floorPlan, mapWidth);
  if (size == null || size === gridSize) return null;
  // Through applyGridConfig so the slider, the number chip and the control panel's own fill all
  // move with the global; writing gridSize alone leaves the UI reading the old number.
  applyGridConfig({ ...captureGridConfig(), cellSize: size });
  commitGridChange();
  // Committed now rather than left on the 5s debounce: this is the one grid change the DM did
  // not make, and losing it to a close-during-import would look like the feature never ran.
  doAutoSave();
  return size;
}

// ─── The offer ────────────────────────────────────────────────────────────────

function _fpRoomWord(n) { return n === 1 ? '1 room' : n + ' rooms'; }

// Draws, asking first ONLY where rooms already exist, because that is a delete the DM did not come
// here for. A confirmation for what was explicitly asked is noise.
function applyPlanWithGuard(derived) {
  if (!derived || !derived.rooms.length) return;
  const existing = Array.isArray(polygons) ? polygons.length : 0;
  if (!existing) { applyPlanToScene(derived); return; }
  confirmDialog({
    title: 'Replace existing rooms?',
    message: 'This scene has ' + _fpRoomWord(existing) + ' drawn. Importing the floor plan ' +
      'removes them and draws ' + derived.rooms.length +
      (derived.rooms.length === 1 ? ' new one.' : ' new ones.'),
    confirmLabel: 'Replace them',
    cancelLabel: 'Keep them',
    danger: true,
    onConfirm: () => applyPlanToScene(derived),
  });
}

// ⚠ NOT A DIALOG. An import is good news, not a question, and a modal here blocks panning the map
// it is talking about. One CTA, one close, no backdrop.
//
// It does NOT report open walls: the kernel finds them and `openWalls` carries the coordinates, but
// a gap is an edge case and costs more attention here than it earns.
let _fpNoticeRoot = null;

function _fpBuildNotice() {
  if (_fpNoticeRoot) return;
  const root = document.createElement('div');
  root.id = 'fp-notice';
  root.style.display = 'none';
  root.innerHTML =
    '<div class="fp-ico">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 3.6l8 5.8-3.05 9.4H7.05L4 9.4z"/></svg>' +
    '</div>' +
    '<div class="fp-msg" id="fp-notice-msg"></div>' +
    '<button type="button" class="fp-cta" id="fp-notice-cta">Draw the rooms</button>' +
    '<button type="button" class="fp-x" id="fp-notice-x" title="Dismiss" aria-label="Dismiss">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg>' +
    '</button>';
  document.body.appendChild(root);
  _fpNoticeRoot = root;
  document.getElementById('fp-notice-x').addEventListener('click', hideFloorPlanNotice);
  // The two guards every floating panel here carries: a click must not reach the canvas
  // handlers, a keystroke must not reach the global map shortcuts.
  root.addEventListener('mousedown', e => e.stopPropagation());
  root.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); hideFloorPlanNotice(); }
  });
}

function hideFloorPlanNotice() {
  if (_fpNoticeRoot) _fpNoticeRoot.style.display = 'none';
}

function showFloorPlanNotice(sceneName, derived) {
  if (!derived || !derived.rooms.length) return;
  _fpBuildNotice();
  document.getElementById('fp-notice-msg').textContent =
    'Evermist found ' + _fpRoomWord(derived.rooms.length) +
    (sceneName ? ' in ' + sceneName : '');
  document.getElementById('fp-notice-cta').onclick = () => {
    hideFloorPlanNotice();
    applyPlanWithGuard(derived);
  };
  _fpNoticeRoot.style.display = 'flex';
}

// The stored plan for the current scene, offered rather than drawn. Used by the post-import
// path and by a lone .dd2vtt drop; the Fog tab button draws instead of offering.
function offerStoredFloorPlan() {
  if (!currentScene) return;
  const derived = describePlan(currentScene.floorPlan);
  if (!derived) return;
  showFloorPlanNotice(currentScene.name, derived);
}

// What the Fog tab button does: draw, with the replacement guard if rooms are there.
function drawStoredFloorPlan() {
  if (!currentScene) return;
  const derived = describePlan(currentScene.floorPlan);
  if (!derived) return;
  hideFloorPlanNotice();
  applyPlanWithGuard(derived);
}

// Stores a plan dropped on its own against the open scene, for the case where the two
// files got separated. Returns true if it was kept.
async function attachPlanText(planText) {
  if (!currentScene) return false;
  if (!describePlan(planText)) return false;
  currentScene.floorPlan = planText;
  doAutoSave();
  refreshFloorPlanUI();
  return true;
}

// ─── The Fog tab button ───────────────────────────────────────────────────────

// Called on every scene switch. Static label, enabled only where this scene has a plan, like every
// other .cp-btn. It also clears the notice, because an offer about the previous scene must not
// outlive it.
function refreshFloorPlanUI() {
  hideFloorPlanNotice();
  const btn = document.getElementById('btn-floorplan');
  if (!btn) return;
  btn.disabled = !hasFloorPlan();
}
