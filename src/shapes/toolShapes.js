'use strict';
// toolShapes.js — the tools drawn by dragging one shape: rectangle, circle and cone. Each one
// starts on the press, follows the pointer, and commits what it has on release.

function toolRectStart(pos) {
  rectStartX = pos.x; rectStartY = pos.y;
}

function toolRectFinish(pos) {
  const rw = Math.abs(pos.x - rectStartX), rh = Math.abs(pos.y - rectStartY);
  if (rw > 2 && rh > 2) {
    const x1 = Math.min(rectStartX, pos.x), y1 = Math.min(rectStartY, pos.y);
    const x2 = Math.max(rectStartX, pos.x), y2 = Math.max(rectStartY, pos.y);
    commitClosedShape([{x:x1,y:y1},{x:x2,y:y1},{x:x2,y:y2},{x:x1,y:y2}]);
  }
  drawCursor(null, null);
}

// The APEX is what snaps to the grid — it is the spell's point of origin, and the far end is
// wherever the length lands. Snapping both would fight the fixed spread.
function toolConeStart(pos) {
  coneApex = { x: pos.x, y: pos.y };
}

function toolConeFinish(pos) {
  if (!coneApex) return;
  const verts = coneVertices(coneApex, pos, axisLock ? CONE_SNAP_DEG : 0);
  // The same 2px floor the other shapes use, so a click that was meant as a deselect does
  // not leave a sliver of a cone behind.
  if (verts && Math.hypot(pos.x - coneApex.x, pos.y - coneApex.y) > 2) commitClosedShape(verts);
  coneApex = null;
  drawCursor(null, null);
}

function toolCircleStart(pos) {
  circleCenter = { x: pos.x, y: pos.y };
}

function toolCircleFinish(pos) {
  if (!circleCenter) return;
  const radius = Math.hypot(pos.x - circleCenter.x, pos.y - circleCenter.y);
  if (radius > 2) commitClosedShape(circleVertices(circleCenter, pos));
  circleCenter = null;
  drawCursor(null, null);
}
