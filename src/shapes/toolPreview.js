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
  // Same colours drawPolyOutline reads, so closing the polygon changes only the line's WEIGHT
  // (2px solid in progress → 1.5px dashed once saved), never its colour.
  const edgeColor = cut ? POLY_EDGE_SELECTED
    : (placeMode === 'effects'
        ? EFFECT_EDGE_COLOR
        : (POLY_EDGE_COLORS[mode] || POLY_EDGE_COLORS.shroud));
  cursorCtx.save();

  // Placed edges (solid, glowing)
  if (verts.length >= 2) {
    cursorCtx.strokeStyle = edgeColor;
    cursorCtx.lineWidth   = 2;
    cursorCtx.setLineDash([]);
    cursorCtx.shadowColor = edgeColor;
    cursorCtx.shadowBlur  = 8;
    cursorCtx.beginPath();
    for (let i = 0; i < verts.length; i++) {
      const { sx, sy } = toScreen(verts[i].x, verts[i].y);
      if (i === 0) cursorCtx.moveTo(sx, sy); else cursorCtx.lineTo(sx, sy);
    }
    cursorCtx.stroke();
  }

  // Dashed preview edge to cursor
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
    // Mode colour, faded, so an un-placed segment reads as provisional. globalAlpha rather than a
    // second colour string, so it cannot drift from the table.
    cursorCtx.strokeStyle = edgeColor;
    cursorCtx.globalAlpha = 0.6;
    cursorCtx.lineWidth   = 1.5;
    cursorCtx.setLineDash([6, 5]);
    cursorCtx.shadowBlur  = 0;
    cursorCtx.beginPath();
    cursorCtx.moveTo(last.sx, last.sy);
    cursorCtx.lineTo(tipX, tipY);
    cursorCtx.stroke();
    cursorCtx.globalAlpha = 1;
  }

  // Close-target halo (first vertex, gold glow when >=3 verts). A cut path never closes.
  if (!cut && verts.length >= 3) {
    const { sx, sy } = toScreen(verts[0].x, verts[0].y);
    cursorCtx.setLineDash([4, 3]);
    cursorCtx.strokeStyle = POLY_EDGE_SELECTED;
    cursorCtx.lineWidth   = 2;
    cursorCtx.shadowColor = POLY_EDGE_SELECTED;
    cursorCtx.shadowBlur  = 14;
    cursorCtx.beginPath();
    cursorCtx.arc(sx, sy, POLY_CLOSE_RADIUS, 0, Math.PI * 2);
    cursorCtx.stroke();
  }

  cursorCtx.setLineDash([]);
  for (let i = 0; i < verts.length; i++) {
    const { sx, sy } = toScreen(verts[i].x, verts[i].y);
    const isFirst = i === 0;
    const r = isFirst ? 6 : 4;
    cursorCtx.shadowColor = isFirst ? '#ffd028' : edgeColor;
    cursorCtx.shadowBlur  = isFirst ? 12 : 6;
    cursorCtx.beginPath();
    cursorCtx.arc(sx, sy, r, 0, Math.PI * 2);
    cursorCtx.fillStyle = isFirst ? '#ffd060' : 'rgba(255,255,255,0.92)';
    cursorCtx.fill();
    cursorCtx.shadowBlur  = 0;
    cursorCtx.strokeStyle = isFirst ? 'rgba(255,255,255,0.6)' : edgeColor;
    cursorCtx.lineWidth   = 1.5;
    cursorCtx.stroke();
  }

  cursorCtx.restore();
}

// The selected room's card — markup, wiring, positioning and the map labels — lives in
// roomPanel.js (refreshRoomPanel), called from drawCursor().
