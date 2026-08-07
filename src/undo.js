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

// Pure eviction: trims oldest entries until total byte footprint is within maxBytes,
// but always keeps at least one entry (length > 1 floor).
// Entries must have shape { baseFog: { width, height } }.
function evictUndoStack(stack, maxBytes) {
  while (stack.length > 1 &&
         stack.reduce((s, e) => s + e.baseFog.width * e.baseFog.height * 4, 0) > maxBytes) {
    stack.shift();
  }
  return stack;
}

// UNDO_MAX_BYTES is the budget for BOTH stacks together, not for each. Redo is trimmed
// first: it is only ever non-empty after an undo, so losing a redo step costs less than
// losing undo depth, and during ordinary drawing it is empty and undo keeps the whole
// budget. Capping the two independently would let the pair reach twice the budget.
function evictUndoPair(undo, redo, maxBytes) {
  const bytes = s => s.reduce((t, e) => t + e.baseFog.width * e.baseFog.height * 4, 0);
  // length > 1, the same floor evictUndoStack keeps: redo() checks the length, then pushes
  // and evicts before popping, so a stack this can empty would pop undefined.
  while (redo.length > 1 && bytes(undo) + bytes(redo) > maxBytes) redo.shift();
  evictUndoStack(undo, maxBytes - bytes(redo));
  return { undo, redo };
}

function pushUndo() {
  if (!baseFogCanvas) return;
  undoStack.push({
    baseFog: cloneCanvas(baseFogCanvas),
    polygons: polygons.map(p => ({ ...p, vertices: p.vertices.map(v => ({ ...v })) })),
    nextPolygonId,
  });
  redoStack = [];
  evictUndoPair(undoStack, redoStack, UNDO_MAX_BYTES);
}

function restoreState(snapshot) {
  baseFogCanvas = cloneCanvas(snapshot.baseFog);
  baseFogCtx = baseFogCanvas.getContext('2d');
  polygons = snapshot.polygons.map(p => ({ ...p, vertices: p.vertices.map(v => ({ ...v })) }));
  nextPolygonId = snapshot.nextPolygonId;
  // Keep the selection when the room survived the undo — nulling it unconditionally slammed
  // the room card shut on every Ctrl+Z, mid-read. Only a room that no longer exists in the
  // restored set (undoing its creation) clears it.
  if (selectedPolygonId == null || !polygons.some(p => p.id === selectedPolygonId)) {
    selectedPolygonId = null;
  }
  selectedVertexIndex = -1;   // vertex counts can differ across the snapshot
  activePolygon = null;
  rebuildFogFromPolygons();
  rebuildFogEffect();
  fogDirty = true;
  scheduleRender();
  scheduleAutoSync();
  if (typeof refreshRoomPanel === 'function') refreshRoomPanel();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push({
    baseFog: cloneCanvas(baseFogCanvas),
    polygons: polygons.map(p => ({ ...p, vertices: p.vertices.map(v => ({ ...v })) })),
    nextPolygonId,
  });
  evictUndoPair(undoStack, redoStack, UNDO_MAX_BYTES);
  restoreState(undoStack.pop());
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push({
    baseFog: cloneCanvas(baseFogCanvas),
    polygons: polygons.map(p => ({ ...p, vertices: p.vertices.map(v => ({ ...v })) })),
    nextPolygonId,
  });
  evictUndoPair(undoStack, redoStack, UNDO_MAX_BYTES);
  restoreState(redoStack.pop());
}

// ─── Node.js export guard (unit tests only) ──────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { evictUndoStack, evictUndoPair };
}
