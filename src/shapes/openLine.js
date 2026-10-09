'use strict';
// openLine.js — what the room editor draws for a picked road: an open line has no fill and no closing wall,
// so its chrome is the line gone gold, and in edit mode its corners and the selected corner's curve
// handles. The handle markers are shared with drawPolyOutline (shapeSelect.js).

// An open line is drawn by the layer that owns it; this is the picked one's chrome: its line gone gold,
// and in edit mode its corners and the selected corner's curve handles.
function drawOpenLineChrome(poly, isSelected, selectedVertIdx) {
  if (!isSelected) return;
  // Open for editing it shows whole; picked only, it shows as far as the place it enters.
  const pts = (shapeEditMode ? wrSamples(poly) : worldRoadVisible(poly) || wrSamples(poly)).map(p => { const s = toScreen(p.x, p.y); return { x: s.sx, y: s.sy }; });
  cursorCtx.save();
  cursorCtx.beginPath();
  pts.forEach((p, i) => (i ? cursorCtx.lineTo(p.x, p.y) : cursorCtx.moveTo(p.x, p.y)));
  cursorCtx.strokeStyle = shapeEditMode ? `rgba(${EDIT_RGB},1)` : `rgba(${HELD_RGB},1)`;
  cursorCtx.lineWidth = HELD_LOOK.lineW;
  cursorCtx.stroke();
  if (shapeEditMode) {
    poly.vertices.forEach((v, i) => {
      const s = toScreen(v.x, v.y);
      drawCorner(s.sx, s.sy, true, i === selectedVertIdx, i === selectedVertIdx ? SHAPE_PART_SELECTED : '#ffffff');
    });
    drawHandleMarkers(poly);
  }
  cursorCtx.restore();
}

// Curve handles, for the SELECTED vertex alone. Drawn last so a handle sitting over a wall or a
// neighbouring corner stays grabbable.
function drawHandleMarkers(poly) {
  for (const h of selectedHandlePoints(poly)) drawHandleKnob(toScreen(h.anchor.x, h.anchor.y), toScreen(h.x, h.y));
}

// One control point: its stem from the anchor, and a rhombus, so a curve handle is never mistaken for a
// corner even at a glance. Both points are screen { sx, sy }.
function drawHandleKnob(a, c) {
  cursorCtx.strokeStyle = 'rgba(255,255,255,0.5)';
  cursorCtx.lineWidth = 1;
  cursorCtx.beginPath();
  cursorCtx.moveTo(a.sx, a.sy);
  cursorCtx.lineTo(c.sx, c.sy);
  cursorCtx.stroke();
  const r = 5.5;
  cursorCtx.beginPath();
  cursorCtx.moveTo(c.sx, c.sy - r);
  cursorCtx.lineTo(c.sx + r, c.sy);
  cursorCtx.lineTo(c.sx, c.sy + r);
  cursorCtx.lineTo(c.sx - r, c.sy);
  cursorCtx.closePath();
  cursorCtx.fillStyle = SHAPE_PART_SELECTED;
  cursorCtx.fill();
  cursorCtx.strokeStyle = '#ffffff';
  cursorCtx.lineWidth = 1.5;
  cursorCtx.stroke();
}
