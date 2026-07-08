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

function pushUndo() {
  if (!baseFogCanvas) return;
  undoStack.push({
    baseFog: cloneCanvas(baseFogCanvas),
    polygons: polygons.map(p => ({ ...p, vertices: p.vertices.map(v => ({ ...v })) })),
    nextPolygonId,
  });
  redoStack = [];
  while (undoStack.length > 1 &&
         undoStack.reduce((s, e) => s + e.baseFog.width * e.baseFog.height * 4, 0) > UNDO_MAX_BYTES) {
    undoStack.shift();
  }
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
