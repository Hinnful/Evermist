'use strict';
// toolPreview.js — what a tool draws while it is still being used: the rubber-band outline of the
// shape under the pointer, before anything is committed.

function drawActivePolyPreview(screenX, screenY) {
  const verts = activePolygon.vertices;
  if (verts.length === 0) return;
  const mode = activePolygon.mode || tool;
  // A cut path is gold, the colour of a selected room, because it edits rooms already there
  // rather than making one in a fog state.
  const cut = !!activePolygon.cut;
  // Same table drawPolyOutline reads, so closing the polygon changes only the line's WEIGHT,
  // never its colour.
  const baseRgb = cut ? HELD_RGB
    : (placeMode === 'effects' ? EFFECT_RGB : (POLY_STATE_RGB[mode] || POLY_STATE_RGB.shroud));
  cursorCtx.save();

  // The wash fills as corners land, same alpha the drawing-in-progress ladder settles on.
  if (verts.length >= 3) {
    cursorCtx.beginPath();
    for (let i = 0; i < verts.length; i++) {
      const { sx, sy } = toScreen(verts[i].x, verts[i].y);
      if (i === 0) cursorCtx.moveTo(sx, sy); else cursorCtx.lineTo(sx, sy);
    }
    cursorCtx.closePath();
    cursorCtx.fillStyle = `rgba(${baseRgb},0.09)`;
    cursorCtx.fill();
  }

  // Placed walls
  if (verts.length >= 2) {
    cursorCtx.strokeStyle = `rgba(${baseRgb},0.9)`;
    cursorCtx.lineWidth   = 1.5;
    cursorCtx.setLineDash([]);
    cursorCtx.beginPath();
    for (let i = 0; i < verts.length; i++) {
      const { sx, sy } = toScreen(verts[i].x, verts[i].y);
      if (i === 0) cursorCtx.moveTo(sx, sy); else cursorCtx.lineTo(sx, sy);
    }
    cursorCtx.stroke();
  }

  // The next wall, not committed yet, is the one dash on the map.
  if (screenX != null) {
    const last = toScreen(verts[verts.length - 1].x, verts[verts.length - 1].y);
    let tipX = screenX, tipY = screenY;
    // With axis-lock on, preview where the click will land so the wall does not jump on release.
    // Gated on axisLock, so grid-snap-only drawing keeps its free-cursor preview.
    if (axisLock) {
      const m = axisLockDraw(snapVertex((screenX - panX) / zoom, (screenY - panY) / zoom));
      const s = toScreen(m.x, m.y);
      tipX = s.sx; tipY = s.sy;
    }
    cursorCtx.strokeStyle = `rgba(${baseRgb},0.6)`;
    cursorCtx.lineWidth   = 1.5;
    cursorCtx.setLineDash([4, 4]);
    cursorCtx.beginPath();
    cursorCtx.moveTo(last.sx, last.sy);
    cursorCtx.lineTo(tipX, tipY);
    cursorCtx.stroke();
    cursorCtx.setLineDash([]);
  }

  // Close target: a gold ring around the first corner's own gold puck. A cut path never closes.
  if (!cut && verts.length >= 3) {
    const { sx, sy } = toScreen(verts[0].x, verts[0].y);
    cursorCtx.strokeStyle = POLY_EDGE_SELECTED;
    cursorCtx.lineWidth   = 1.5;
    cursorCtx.beginPath();
    cursorCtx.arc(sx, sy, POLY_CLOSE_RADIUS, 0, Math.PI * 2);
    cursorCtx.stroke();
  }

  for (let i = 0; i < verts.length; i++) {
    const { sx, sy } = toScreen(verts[i].x, verts[i].y);
    const isFirst = i === 0;
    drawCorner(sx, sy, isFirst, isFirst, isFirst ? '#ffd060' : '#ffffff');
  }

  cursorCtx.restore();
}

// The selected room's card — markup, wiring, positioning and the map labels — lives in
// roomPanel.js (refreshRoomPanel), called from drawCursor().
