'use strict';
// toolPoly.js — the Polygon tool: a vertex per click, the two ways it closes, and what the
// closed shape does to the fog.

// ⚠ NEVER SELECTS OR DRAGS AN EXISTING SHAPE. A click while this tool is in hand is always a
// vertex, which is what lets a room be drawn over one that is already there.
// Ctrl on the first click, or an armed Split, makes the path an open line that splits every room it
// crosses (toolCut.js); once started it is that line's, whatever the keys do after.
function toolPolyDown(raw, e) {
  if (activePolygon && activePolygon.cut || !activePolygon && repairNow(e) === 'split') { cutMouseDown(raw.x, raw.y); return; }
  let pos = snapVertex(raw.x, raw.y);
  if (!activePolygon) {
    activePolygon = { vertices: [pos], mode: tool };
    clearShapeSelection();
  } else {
    // Grid snap first, then straighten — if the grid already landed the point on an
    // aligned coordinate, the axis snap is a no-op.
    pos = axisLockDraw(pos);
    // Close by first-vertex proximity (12 screen px hit area)
    if (activePolygon.vertices.length >= 3) {
      const first = activePolygon.vertices[0];
      if (Math.hypot(raw.x - first.x, raw.y - first.y) < POLY_CLOSE_RADIUS / zoom) {
        closeActivePolygon(e); return;
      }
      // Close by self-intersection — keep only the loop, drop the tail
      const verts = activePolygon.vertices;
      const newSeg = [verts[verts.length - 1], pos];
      for (let i = 0; i < verts.length - 2; i++) {
        const pt = segmentsIntersect(newSeg[0], newSeg[1], verts[i], verts[i + 1]);
        if (pt) {
          activePolygon.vertices = verts.slice(i + 1);
          activePolygon.vertices.push(pt);
          closeActivePolygon(e); return;
        }
      }
    }
    activePolygon.vertices.push(pos);
  }
}

// ─── Polygon lifecycle ────────────────────────────────────────────────────────

function closeActivePolygon(e) {
  if (!activePolygon || activePolygon.vertices.length < 3) { activePolygon = null; drawCursor(null, null); return; }
  const verts = activePolygon.vertices;
  const mode  = activePolygon.mode;
  activePolygon = null;
  const shape = commitClosedShape(verts, repairNow(e));
  drawCursor(null, null);
  // The polygon tool paints its own fog below rather than going through toolMouseUp's block,
  // so the flag that block reads must not be left set for the next release to act on.
  fogModifiedThisStroke = false;
  // ⚠ NOTHING BELOW RUNS FOR JOIN, TRIM OR A REFUSAL. applyPolygonToFog paints the drawn shape
  // rather than rebuilding the stencil, and a refusal leaves no shape to dereference at all.
  // Each of those settled its own fog inside commitShapeOp.
  if (!shape) return;
  if (placeMode !== 'rooms') { fogDirty = true; scheduleRender(); return; }
  // applyPolygonToFog paints just this room rather than rebuilding the whole stencil, which is
  // why the polygon tool does not share the rectangle path's rebuild.
  applyPolygonToFog(shape);
  startFogTransition(mode === 'shroud');
  rebuildFogEffect();
  fogDirty = true;
  scheduleRender();
  scheduleAutoSync();
}
