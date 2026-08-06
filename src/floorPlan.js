'use strict';

// floorPlan.js — turning a Dungeon Alchemist floor plan into this scene's rooms.
//
// The geometry is vttPlan.js, which is pure and tested. This file is the app side: finding
// the plan on disk, storing it on the scene, asking the DM once, and rewriting the polygon
// set. Rules live in the `floor-plan` skill.
//
// ELECTRON ONLY, on purpose. Finding the sibling file needs the preload bridge, so under
// `npx serve .` or bare file:// no plan is ever found. It degrades to silence rather than
// to an error: the app is run as the packaged .exe.

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

// Reads a plan's text and derives it. A truncated or malformed file must behave EXACTLY
// like no plan at all — no dialog, no button, and above all nothing thrown into the import
// path, where an unhandled rejection strands the map-progress overlay forever.
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
  // Wipe-and-rebuild can delete the room the DM currently has selected, which would leave
  // selectedPolygonId pointing at a dead id and the room card open on a ghost. Every other
  // wholesale polygon rewrite in the app nulls both first.
  activePolygon = null;
  selectedPolygonId = null;

  // Numbered from 1 in the kernel's spatial order, so the names read down the map. Same
  // shape the drawing tools produce, or the room card and the fog rebuild would not
  // recognise them.
  polygons = derived.rooms.map((verts, i) => ({
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

// ─── The offer ────────────────────────────────────────────────────────────────

function _fpRoomWord(n) { return n === 1 ? '1 room' : n + ' rooms'; }

// Draws, asking first ONLY where rooms already exist, because that is a delete the DM did
// not come here for. Pressing Draw Rooms is not: a confirmation for something explicitly
// asked for is noise.
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

// ⚠ NOT A DIALOG. An import is good news, not a question that has to be answered before the
// map can be touched: a modal here blocks panning and zooming the map it is talking about.
// One CTA, one close, no backdrop.
//
// It deliberately does NOT report open walls. The kernel still finds every one of them and
// `openWalls` carries the coordinates, but a gap is an edge case and putting it in the first
// thing the DM sees costs more attention than it earns.
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

// Called on every scene switch. Static label, enabled only where this scene has a plan —
// the label never carries state, which no other .cp-btn in the app does either. It also
// clears the notice, because an offer about the previous scene must not outlive it.
function refreshFloorPlanUI() {
  hideFloorPlanNotice();
  const btn = document.getElementById('btn-floorplan');
  if (!btn) return;
  btn.disabled = !hasFloorPlan();
}
