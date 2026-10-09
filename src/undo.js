'use strict';

// ─── Undo/Redo state ─────────────────────────────────────────────────────────
let undoStack = [];
let redoStack = [];
const UNDO_MAX_BYTES = 120 * 1024 * 1024; // ~8 entries on a 10k×6k map, undo+redo together

// ─── Undo/Redo ────────────────────────────────────────────────────────────────

function cloneCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

function _undoBytes(e) { return e.baseFog ? e.baseFog.width * e.baseFog.height * 4 : 0; }

// Pure eviction: trims oldest entries until the footprint is within maxBytes, always keeping one.
function evictUndoStack(stack, maxBytes) {
  while (stack.length > 1 &&
         stack.reduce((s, e) => s + _undoBytes(e), 0) > maxBytes) {
    stack.shift();
  }
  return stack;
}

// ⚠ UNDO_MAX_BYTES is the budget for BOTH stacks together. Redo is trimmed first, since it is only
// non-empty after an undo. Capping the two independently lets the pair reach twice the budget.
function evictUndoPair(undo, redo, maxBytes) {
  const bytes = s => s.reduce((t, e) => t + _undoBytes(e), 0);
  // length > 1, the same floor evictUndoStack keeps: redo() checks the length, then pushes
  // and evicts before popping, so a stack this can empty would pop undefined.
  while (redo.length > 1 && bytes(undo) + bytes(redo) > maxBytes) redo.shift();
  evictUndoStack(undo, maxBytes - bytes(redo));
  return { undo, redo };
}

function _undoSnapshot() {
  return {
    baseFog: cloneCanvas(baseFogCanvas),
    polygons: polygons.map(copyShapeRings),
    nextPolygonId,
    // Effects ride the same history, so one Ctrl+Z means the same thing in either mode.
    // ⚠ copyShapeRings copies every ring: an aliased hole is edited out from under this entry.
    effects: effects.map(copyShapeRings),
    nextEffectId,
    lights: lightsSceneFields(),
  };
}

function pushUndo() {
  if (worldMapOpen) { worldUndoPush(); return; }
  if (!baseFogCanvas) return;
  undoStack.push(_undoSnapshot());
  redoStack = [];
  evictUndoPair(undoStack, redoStack, UNDO_MAX_BYTES);
}

// ─── Grid and fog colour ──────────────────────────────────────────────────────
// They ride the same history as light entries. The first change after a pause pushes the
// settings as they stood before it, and the rest of that drag or scrub joins the same step.
const UNDO_SETTINGS_GAP_MS = 800;
let _undoSettings = null, _undoSettingsAt = 0, _undoApplying = false;

function _undoCaptureSettings() {
  return { grid: captureGridConfig(), fogHex: fogPickedHex, fogTint: FOG_TINT_ALPHA };
}

function clearUndo() {
  undoStack = []; redoStack = [];
  _undoSettings = _undoCaptureSettings();
  _undoSettingsAt = 0;
}

function noteSettingsChange() {
  if (_undoApplying || isPlayer) return;
  const now = Date.now();
  if (_undoSettings && now - _undoSettingsAt > UNDO_SETTINGS_GAP_MS) {
    undoStack.push({ settings: _undoSettings });
    redoStack = [];
    evictUndoPair(undoStack, redoStack, UNDO_MAX_BYTES);
  }
  _undoSettingsAt = now;
  _undoSettings = _undoCaptureSettings();
}

function _undoApplySettings(s) {
  _undoApplying = true;
  try {
    applyGridConfig(s.grid);
    commitGridChange();
    // Through the fields' own handlers, so the Player and the dock hear it the usual way.
    const fire = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
    fire('fog-color', s.fogHex);
    fire('fog-tint-alpha-num', Math.round(s.fogTint * 100));
    if (typeof refreshGridControlUI === 'function') refreshGridControlUI();
  } finally { _undoApplying = false; }
  _undoSettings = s;
  _undoSettingsAt = 0;
}

function restoreState(snapshot) {
  if (snapshot.settings) { _undoApplySettings(snapshot.settings); return; }
  baseFogCanvas = cloneCanvas(snapshot.baseFog);
  baseFogCtx = baseFogCanvas.getContext('2d');
  polygons = snapshot.polygons.map(copyShapeRings);
  nextPolygonId = snapshot.nextPolygonId;
  // Snapshots taken before effects existed carry neither field, so an undo across that point
  // must leave the live ones alone rather than emptying them.
  if (snapshot.effects) {
    setEffects(snapshot.effects);
    nextEffectId = snapshot.nextEffectId || nextEffectId;
  }
  // Snapshots from before lights carry none, so an undo across that point leaves them alone.
  if (snapshot.lights) restoreLights(snapshot.lights);
  // Keep the selection when the shape survived the undo, or the room card slams shut on every
  // Ctrl+Z. Only a shape missing from the restored set clears it, checked against the list the
  // placement mode names.
  if (selectedPolygonId == null || !activeShapeList().some(s => s.id === selectedPolygonId)) {
    selectedPolygonId = null;
  }
  // ⚠ EDIT MODE SURVIVES, only the indices go - ring counts differ across a snapshot, but dropping
  // the level too costs a double-click back on every Ctrl+Z mid-reshape.
  selectedVertexIndex = -1;
  selectedHoleIndex = -1;
  // ⚠ WITH THE HOLE INDEX, or the level below outlives the hole it named and hides the corners
  // of every ring that is left.
  holeEditMode = false;
  if (selectedPolygonId == null) leaveShapeEditMode();
  activePolygon = null;
  rebuildFogFromPolygons();
  rebuildFogEffect();
  fogDirty = true;
  scheduleRender();
  scheduleAutoSync();   // carries fog and effects together, on the Auto/Manual gate
  if (typeof refreshRoomPanel === 'function') refreshRoomPanel();
}

// A dead key and a broken key look identical, and both stacks empty legitimately - a scene
// switch clears them, eviction caps them - so say so rather than nothing.
let _undoHintTimer = null;
function undoHint(msg) {
  const el = document.getElementById('key-hint');
  if (!el) return;
  el.querySelector('.m').textContent = t(msg);
  el.classList.add('on');
  showToast(el);
  clearTimeout(_undoHintTimer);
  _undoHintTimer = setTimeout(() => el.classList.remove('on'), 1400);
}

// The opposite stack takes the present in the same kind as the entry being left, and the hint
// says the step happened: a note or a grid colour can change with nothing on screen showing it.
function _undoStep(from, to, done) {
  const entry = from.pop();
  to.push(entry.settings ? { settings: _undoCaptureSettings() } : _undoSnapshot());
  evictUndoPair(undoStack, redoStack, UNDO_MAX_BYTES);
  restoreState(entry);
  undoHint(done);
}

function undo() {
  if (!undoStack.length) { undoHint('Nothing to undo'); return; }
  _undoStep(undoStack, redoStack, 'Undone');
}

function redo() {
  if (!redoStack.length) { undoHint('Nothing to redo'); return; }
  _undoStep(redoStack, undoStack, 'Redone');
}

// ─── Node.js export guard (unit tests only) ──────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { evictUndoStack, evictUndoPair };
}
