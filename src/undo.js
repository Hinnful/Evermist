'use strict';

// ─── Undo/Redo state ─────────────────────────────────────────────────────────
let undoStack = [];
let redoStack = [];
const UNDO_MAX_BYTES = 120 * 1024 * 1024; // ~8 entries on a 10k×6k map

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

function pushUndo() {
  if (!baseFogCanvas) return;
  undoStack.push({
    baseFog: cloneCanvas(baseFogCanvas),
    polygons: polygons.map(p => ({ ...p, vertices: p.vertices.map(v => ({ ...v })) })),
    nextPolygonId,
  });
  redoStack = [];
  evictUndoStack(undoStack, UNDO_MAX_BYTES);
}

function restoreState(snapshot) {
  baseFogCanvas = cloneCanvas(snapshot.baseFog);
  baseFogCtx = baseFogCanvas.getContext('2d');
  polygons = snapshot.polygons.map(p => ({ ...p, vertices: p.vertices.map(v => ({ ...v })) }));
  nextPolygonId = snapshot.nextPolygonId;
  selectedPolygonId = null;
  selectedVertexIndex = -1;
  activePolygon = null;
  rebuildFogFromPolygons();
  rebuildFogEffect();
  fogDirty = true;
  scheduleRender();
  scheduleAutoSync();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push({
    baseFog: cloneCanvas(baseFogCanvas),
    polygons: polygons.map(p => ({ ...p, vertices: p.vertices.map(v => ({ ...v })) })),
    nextPolygonId,
  });
  restoreState(undoStack.pop());
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push({
    baseFog: cloneCanvas(baseFogCanvas),
    polygons: polygons.map(p => ({ ...p, vertices: p.vertices.map(v => ({ ...v })) })),
    nextPolygonId,
  });
  restoreState(redoStack.pop());
}

// ─── Node.js export guard (unit tests only) ──────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { evictUndoStack };
}
