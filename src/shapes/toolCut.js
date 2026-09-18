'use strict';
// toolCut.js — the Cut tool: the free path drawn across a shape, and what it leaves behind.

// Held in activePolygon so Escape, the tool switch and the preview all work on it unchanged.
function cutMouseDown(mapX, mapY) {
  const pos = snapVertex(mapX, mapY);
  if (!activePolygon || !activePolygon.cut) activePolygon = { vertices: [pos], mode: tool, cut: true };
  else activePolygon.vertices.push(pos);
}

// ⚠ EVERY SHAPE THE PATH TOUCHES IS IN OR THE WHOLE CUT IS REFUSED. One crossed four times has
// no two-piece answer, and cutting its neighbours while skipping it is a silent refusal.
function commitCutPath() {
  const path = activePolygon && activePolygon.cut ? activePolygon.vertices : null;
  activePolygon = null;
  drawCursor(lastScreenX, lastScreenY);
  if (!path || path.length < 2) return;
  const minArea = roomOpMinArea(gridSize);
  const plan = [];
  for (const poly of activeShapeList()) {
    if (!poly.vertices || poly.vertices.length < 3) continue;
    if (!ringPathCrossings(poly.vertices, path).length) continue;
    const out = cutRing(poly, path, minArea);
    if (out.reason) { refuseShapeOp(out.reason); return; }
    plan.push({ shapes: [poly], pieces: out.pieces });
  }
  if (!plan.length) { refuseShapeOp(REASON_CUT); return; }
  pushUndo();
  applyShapePlan(plan, null);
  commitShapeOpFog(null);
  drawCursor(lastScreenX, lastScreenY);
}
