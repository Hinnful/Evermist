'use strict';
// toolCut.js — the Cut tool: the free path drawn across a shape, and what it leaves behind.

// Split on the picked (splitPickedArm): the ids a Split line may cut while the same shapes are still picked. It holds
// through a line that missed or was refused, and goes with a Split done, Esc, the tool put down or another pick.
let cutOnlyIds = null;

function splitPickedDisarm() { cutOnlyIds = null; }

// The Split line limited to the picked shapes; its pieces end picked and edit closes. Step 3's button calls it.
function splitPickedArm() {
  const ids = pickedIds();
  if (!ids.length || worldMapOpen || isPane) return false;
  cutOnlyIds = ids;
  setShape('cut');
  return true;
}

// Held in activePolygon so Escape, the tool switch and the preview all work on it unchanged.
function cutMouseDown(mapX, mapY) {
  const pos = snapVertex(mapX, mapY);
  if (!activePolygon || !activePolygon.cut) {
    if (cutOnlyIds && cutOnlyIds.join() !== pickedIds().join()) cutOnlyIds = null;
    const only = cutOnlyIds;
    activePolygon = { vertices: [pos], mode: tool, cut: true, only };
  } else activePolygon.vertices.push(pos);
}

// ⚠ EVERY SHAPE THE PATH TOUCHES IS IN OR THE WHOLE CUT IS REFUSED. One crossed four times has
// no two-piece answer, and cutting its neighbours while skipping it is a silent refusal.
function commitCutPath() {
  const path = activePolygon && activePolygon.cut ? activePolygon.vertices : null;
  const only = path && activePolygon.only;
  activePolygon = null;
  drawCursor(lastScreenX, lastScreenY);
  if (!path || path.length < 2) return;
  const minArea = roomOpMinArea(gridSize);
  const plan = [];
  for (const poly of activeShapeList()) {
    if (!poly.vertices || poly.vertices.length < 3 || !(only ? only.indexOf(poly.id) >= 0 : isDrawnKind(poly))) continue;
    if (!ringPathCrossings(cutRings(poly)[0], path).length) continue;
    const out = cutRing(poly, path, minArea);
    if (out.reason) { refuseShapeOp(out.reason); return; }
    plan.push({ shapes: [poly], pieces: out.pieces });
  }
  if (!plan.length) { refuseShapeOp(REASON_CUT); return; }
  pushUndo();
  const before = new Set(activeShapeList().map(s => s.id));
  applyShapePlan(plan, null);
  commitShapeOpFog(null);
  if (only) {
    const pieces = plan.map(g => g.shapes[0].id).concat(activeShapeList().filter(s => !before.has(s.id)).map(s => s.id));
    selectedPolygonId = pieces[0];
    extraPickedIds = pieces.slice(1);
    pickSetReset();
    setShape('select');   // puts the Split limit down with the tool
  }
  drawCursor(lastScreenX, lastScreenY);
}
