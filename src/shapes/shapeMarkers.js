'use strict';

// shapeMarkers.js — the corner and hole-hatch markers a shape's chrome draws, wherever it is
// picked from. shapeSelect.js, shapeBox.js and toolPreview.js all read this file, so it is none
// of theirs alone: split out rather than owned by whichever one happened to write it first.

// A corner marker. `round` tells object-level (a rounded square) from edit mode (a circle) -
// the shape itself is what state a corner is in. `ring` adds the white outline that marks the
// one vertex actually picked inside edit mode. `strokeColor` overrides that outline's colour,
// for a box handle that needs to say "this resizes the room" vs "this resizes the hole" without
// wearing edit mode's white ring.
function drawCorner(x, y, round, ring, fillColor, strokeColor) {
  cursorCtx.save();
  cursorCtx.beginPath();
  if (round) cursorCtx.arc(x, y, ring ? 7 : 5, 0, Math.PI * 2);
  else cursorCtx.roundRect(x - 5, y - 5, 10, 10, 4);
  cursorCtx.fillStyle = fillColor;
  cursorCtx.fill();
  if (ring || strokeColor) {
    cursorCtx.strokeStyle = strokeColor || '#ffffff';
    cursorCtx.lineWidth = 1.5;
    cursorCtx.stroke();
  }
  cursorCtx.restore();
}

// A picked hole's gap gets a hatch rather than a fill, so it never reads as a second room.
function drawHoleHatch(ring) {
  if (ring.length < 3) return;
  cursorCtx.save();
  cursorCtx.beginPath();
  cursorCtx.moveTo(ring[0].x, ring[0].y);
  for (let i = 1; i < ring.length; i++) cursorCtx.lineTo(ring[i].x, ring[i].y);
  cursorCtx.closePath();
  cursorCtx.clip();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const half = Math.hypot(maxX - minX, maxY - minY) / 2 + HOLE_HATCH_PITCH;
  const d = Math.SQRT1_2;
  cursorCtx.strokeStyle = `rgba(${SHAPE_PART_SELECTED_RGB},0.5)`;
  cursorCtx.lineWidth = 1;
  cursorCtx.beginPath();
  for (let off = -half * 2; off < half * 2; off += HOLE_HATCH_PITCH) {
    const ox = cx + d * off, oy = cy - d * off;
    cursorCtx.moveTo(ox - d * half, oy - d * half);
    cursorCtx.lineTo(ox + d * half, oy + d * half);
  }
  cursorCtx.stroke();
  cursorCtx.restore();
}
