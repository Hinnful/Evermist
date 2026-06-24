'use strict';

// ─── Tool state ───────────────────────────────────────────────────────────────
let tool  = 'reveal';
let shape = 'brush';
let brushSize = 40;
let isDrawing = false;
let pendingBrushOps = [];
let fogModifiedThisStroke = false;
let lastMapX, lastMapY;
let rectStartX, rectStartY;
let circleCenter = null;

// ─── Polygon tool state ───────────────────────────────────────────────────────
let activePolygon = null;   // polygon currently being drawn

// ─── Select tool state ────────────────────────────────────────────────────────
let selectedPolygonId = null;
let isDraggingPolygon = false;
let dragStartMapX = 0, dragStartMapY = 0;
let dragOrigVerts = null;   // snapshot of vertices at drag start
let snapToGrid = false;

// ─── Vertex / edge editing state ──────────────────────────────────────────────
let selectedVertexIndex = -1;   // -1 = no vertex selected
let polyCtxRadiusMode = 'all';  // 'all' | 'vertex'
let isDraggingVertex = false;
let vertexDragOrigVerts = null;
let isDraggingEdge = false;
let edgeDragIndex = -1;         // index of first vertex of dragged edge
let edgeDragOrigVerts = null;
let edgeDragStartMapX = 0, edgeDragStartMapY = 0;
let polygonActuallyMoved = false;

// ─── Polygon helpers ──────────────────────────────────────────────────────────

function snapVertex(mapX, mapY) {
  if (!snapToGrid || !gridEnabled) return { x: mapX, y: mapY };
  if (gridMode !== 'square') return { x: mapX, y: mapY };
  return {
    x: Math.round((mapX - gridOffsetX) / gridSize) * gridSize + gridOffsetX,
    y: Math.round((mapY - gridOffsetY) / gridSize) * gridSize + gridOffsetY,
  };
}

function getPolyBBox(verts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of verts) {
    if (v.x < minX) minX = v.x; if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x; if (v.y > maxY) maxY = v.y;
  }
  return { minX, minY, maxX, maxY };
}

function segmentsIntersect(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  if (t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999) {
    return { x: p1.x + t * d1x, y: p1.y + t * d1y };
  }
  return null;
}

function pointInPolygon(px, py, verts) {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i].x, yi = verts[i].y;
    const xj = verts[j].x, yj = verts[j].y;
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function findPolygonAt(mapX, mapY) {
  for (let i = polygons.length - 1; i >= 0; i--) {
    if (pointInPolygon(mapX, mapY, polygons[i].vertices)) return polygons[i];
  }
  return null;
}

function distPointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Only returns a polygon when clicking a vertex dot or edge — not the interior.
// This lets the DM start a new polygon inside an existing one without accidentally
// selecting the existing one.
function findPolygonHandleAt(mapX, mapY) {
  const hitRadius = Math.min(10 / zoom, 30); // clamp: ≤30 map-units so grab shrinks when very zoomed out
  for (let i = polygons.length - 1; i >= 0; i--) {
    const poly = polygons[i];
    const verts = poly.vertices;
    for (const v of verts) {
      if (Math.hypot(mapX - v.x, mapY - v.y) < hitRadius) return poly;
    }
    for (let j = 0; j < verts.length; j++) {
      const a = verts[j], b = verts[(j + 1) % verts.length];
      if (distPointToSegment(mapX, mapY, a.x, a.y, b.x, b.y) < hitRadius) return poly;
    }
  }
  return null;
}

function getCentroid(verts) {
  let sx = 0, sy = 0;
  for (const v of verts) { sx += v.x; sy += v.y; }
  return { x: sx / verts.length, y: sy / verts.length };
}

function findVertexAt(poly, mapX, mapY) {
  const hitR = Math.min(10 / zoom, 30); // clamp: matches findPolygonHandleAt
  for (let i = 0; i < poly.vertices.length; i++) {
    if (Math.hypot(mapX - poly.vertices[i].x, mapY - poly.vertices[i].y) < hitR) return i;
  }
  return -1;
}

function findEdgeAt(poly, mapX, mapY) {
  const hitR = 10 / zoom;
  const verts = poly.vertices;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    if (distPointToSegment(mapX, mapY, a.x, a.y, b.x, b.y) < hitR) return i;
  }
  return -1;
}

function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: ax, y: ay };
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return { x: ax + t * dx, y: ay + t * dy };
}

// ─── Brush flush ──────────────────────────────────────────────────────────────

function flushBrushOps() {
  if (!pendingBrushOps.length || !fogDataCtx) return;
  const ops = pendingBrushOps;
  pendingBrushOps = [];

  const mapRadius = (brushSize / 2) / zoom;
  const r         = mapRadius / FOG_SCALE;
  const mode      = ops[0].mode;

  const applyBrushToCtx = (ctx) => {
    ctx.save();
    ctx.beginPath();
    let minFX = Infinity, minFY = Infinity, maxFX = -Infinity, maxFY = -Infinity;
    for (const op of ops) {
      const dist  = Math.hypot(op.x2 - op.x1, op.y2 - op.y1);
      const steps = Math.max(1, Math.floor(dist / (mapRadius / 4)));
      for (let i = 0; i <= steps; i++) {
        const t  = i / steps;
        const fx = (op.x1 + (op.x2 - op.x1) * t) / FOG_SCALE;
        const fy = (op.y1 + (op.y2 - op.y1) * t) / FOG_SCALE;
        ctx.moveTo(fx + r, fy);
        ctx.arc(fx, fy, r, 0, Math.PI * 2);
        if (mode === 'reveal') {
          if (fx - r < minFX) minFX = fx - r;
          if (fy - r < minFY) minFY = fy - r;
          if (fx + r > maxFX) maxFX = fx + r;
          if (fy + r > maxFY) maxFY = fy + r;
        }
      }
    }
    if (mode === 'reveal') {
      ctx.clip();
      ctx.clearRect(minFX, minFY, maxFX - minFX, maxFY - minFY);
    } else {
      ctx.fillStyle = '#1a1a2e';
      ctx.fill();
    }
    ctx.restore();
  };

  applyBrushToCtx(fogDataCtx);
  if (baseFogCtx) applyBrushToCtx(baseFogCtx);
  fogDirty = true;
}

// ─── Cursor / outline drawing ─────────────────────────────────────────────────

function drawPolyOutline(poly, isSelected, selectedVertIdx) {
  const verts = poly.vertices;
  if (verts.length < 2) return;
  cursorCtx.save();

  const edgeColor = isSelected
    ? '#ffd060'
    : poly.mode === 'reveal'
      ? 'rgba(50, 220, 110, 0.8)'
      : 'rgba(150, 80, 255, 0.8)';

  // Build screen-space vertex array
  const sv = verts.map(v => { const s = toScreen(v.x, v.y); return { x: s.sx, y: s.sy }; });

  // Outline (rounded when cornerRadius > 0)
  cursorCtx.strokeStyle = edgeColor;
  cursorCtx.lineWidth   = isSelected ? 2.5 : 1.5;
  cursorCtx.setLineDash(isSelected ? [] : [7, 4]);
  cursorCtx.shadowColor = edgeColor;
  cursorCtx.shadowBlur  = isSelected ? 10 : 6;
  cursorCtx.beginPath();
  const cr = (poly.cornerRadius || 0) * zoom;
  const pvR = poly.cornerRadii ? poly.cornerRadii.map(rv => (rv != null ? rv : (poly.cornerRadius || 0)) * zoom) : null;
  buildRoundedPolyPath(cursorCtx, sv, cr, pvR);
  cursorCtx.stroke();

  // Vertex dots — always at actual vertex positions regardless of corner rounding
  cursorCtx.setLineDash([]);
  for (let i = 0; i < sv.length; i++) {
    const { x, y } = sv[i];
    const isSelVert = isSelected && i === selectedVertIdx;
    const r = isSelVert ? 7 : (isSelected ? 5 : 4);
    cursorCtx.shadowColor = isSelVert ? '#60a0ff' : edgeColor;
    cursorCtx.shadowBlur  = isSelVert ? 14 : 6;
    cursorCtx.beginPath();
    cursorCtx.arc(x, y, r, 0, Math.PI * 2);
    cursorCtx.fillStyle = isSelVert ? '#ffffff' : (isSelected ? '#ffd060' : 'rgba(255,255,255,0.9)');
    cursorCtx.fill();
    cursorCtx.shadowBlur  = 0;
    cursorCtx.strokeStyle = isSelVert ? '#4080ff' : (isSelected ? 'rgba(255,255,255,0.5)' : edgeColor);
    cursorCtx.lineWidth   = isSelVert ? 2 : 1.5;
    cursorCtx.stroke();
  }

  cursorCtx.restore();
}

function drawActivePolyPreview(screenX, screenY) {
  const verts = activePolygon.vertices;
  if (verts.length === 0) return;
  const mode = activePolygon.mode || tool;
  const edgeColor = mode === 'reveal' ? 'rgba(50,220,110,0.9)' : 'rgba(160,90,255,0.9)';
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
    cursorCtx.strokeStyle = 'rgba(255,255,255,0.55)';
    cursorCtx.lineWidth   = 1.5;
    cursorCtx.setLineDash([6, 5]);
    cursorCtx.shadowBlur  = 0;
    cursorCtx.beginPath();
    cursorCtx.moveTo(last.sx, last.sy);
    cursorCtx.lineTo(screenX, screenY);
    cursorCtx.stroke();
  }

  // Close-target halo (first vertex, gold glow when >=3 verts)
  if (verts.length >= 3) {
    const { sx, sy } = toScreen(verts[0].x, verts[0].y);
    cursorCtx.setLineDash([4, 3]);
    cursorCtx.strokeStyle = 'rgba(255,210,40,0.85)';
    cursorCtx.lineWidth   = 2;
    cursorCtx.shadowColor = '#ffd028';
    cursorCtx.shadowBlur  = 14;
    cursorCtx.beginPath();
    cursorCtx.arc(sx, sy, POLY_CLOSE_RADIUS, 0, Math.PI * 2);
    cursorCtx.stroke();
  }

  // Vertex dots
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

function updatePolyContextPanel() {
  const panel = document.getElementById('panel-poly-ctx');
  if (!panel) return;
  const poly = polygons.find(p => p.id === selectedPolygonId);
  if (!poly || shape !== 'select') { panel.style.display = 'none'; return; }
  panel.style.display = 'block';

  // Position above the polygon centroid (flip below if too close to top)
  const c = getCentroid(poly.vertices);
  const { sx, sy } = toScreen(c.x, c.y);
  const uiZoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1.2;
  const PW = 152 * uiZoom, PH = 72 * uiZoom;
  const left = Math.max(4, Math.min(window.innerWidth - PW - 4, sx - PW / 2));
  const aboveY = sy - PH - 24;
  const top    = aboveY < 8 ? sy + 20 : aboveY;
  panel.style.left = left + 'px';
  panel.style.top  = top  + 'px';

  // Mode radio buttons — highlight the current mode
  const revBtn = document.getElementById('poly-ctx-reveal');
  const shrBtn = document.getElementById('poly-ctx-shroud');
  if (revBtn) revBtn.classList.toggle('pctx-active', poly.mode === 'reveal');
  if (shrBtn) shrBtn.classList.toggle('pctx-active', poly.mode === 'shroud');

  // Radius slider — shows per-vertex value in vertex mode, else global
  const radiusInput = document.getElementById('poly-ctx-radius');
  const radiusVal   = document.getElementById('poly-ctx-radius-val');
  const rmodeBtn    = document.getElementById('poly-ctx-rmode');
  let currentR;
  if (polyCtxRadiusMode === 'vertex' && selectedVertexIndex >= 0 && poly.cornerRadii) {
    currentR = poly.cornerRadii[selectedVertexIndex] != null ? poly.cornerRadii[selectedVertexIndex] : (poly.cornerRadius || 0);
  } else {
    currentR = poly.cornerRadius || 0;
  }
  if (radiusInput && radiusInput !== document.activeElement) radiusInput.value = currentR;
  if (radiusVal) radiusVal.textContent = currentR;
  if (rmodeBtn) rmodeBtn.classList.toggle('pctx-vtx', polyCtxRadiusMode === 'vertex');

  // Vertex row — show when a vertex is selected
  const vrow = document.getElementById('pctx-vrow');
  const info = document.getElementById('poly-ctx-info');
  const delVBtn = document.getElementById('poly-ctx-del-vertex');
  if (selectedVertexIndex >= 0) {
    if (vrow) vrow.style.display = 'flex';
    if (info) info.textContent = 'v' + (selectedVertexIndex + 1) + ' / ' + poly.vertices.length;
    if (delVBtn) delVBtn.style.display = poly.vertices.length > 3 ? '' : 'none';
  } else {
    if (vrow) vrow.style.display = 'none';
  }
}

// ─── Tool mouse handlers ──────────────────────────────────────────────────────
// Called from index.html event listeners with pre-converted map coordinates.
// Panning and coordinate conversion are handled in index.html; these functions
// receive map-space coordinates and dispatch to the active tool's logic.

function toolMouseDown(raw, e) {
  if (shape === 'poly') {
    const pos = snapVertex(raw.x, raw.y);
    if (!activePolygon) {
      // Only select/drag when clicking a vertex dot or edge — not the interior.
      const hit = findPolygonHandleAt(raw.x, raw.y);
      if (hit) {
        pushUndo();
        selectedPolygonId = hit.id;
        isDraggingPolygon = true;
        polygonActuallyMoved = false;
        dragStartMapX = raw.x;
        dragStartMapY = raw.y;
        dragOrigVerts = hit.vertices.map(v => ({ x: v.x, y: v.y }));
        drawCursor(e.clientX - container.getBoundingClientRect().left,
                   e.clientY - container.getBoundingClientRect().top);
        return;
      }
      // Start new polygon
      activePolygon = { vertices: [pos], mode: tool };
      selectedPolygonId = null;
    } else {
      // Close by first-vertex proximity (12 screen px hit area)
      if (activePolygon.vertices.length >= 3) {
        const first = activePolygon.vertices[0];
        if (Math.hypot(raw.x - first.x, raw.y - first.y) < POLY_CLOSE_RADIUS / zoom) {
          closeActivePolygon(); return;
        }
        // Close by self-intersection — keep only the loop, drop the tail
        const verts = activePolygon.vertices;
        const newSeg = [verts[verts.length - 1], pos];
        for (let i = 0; i < verts.length - 2; i++) {
          const pt = segmentsIntersect(newSeg[0], newSeg[1], verts[i], verts[i + 1]);
          if (pt) {
            activePolygon.vertices = verts.slice(i + 1);
            activePolygon.vertices.push(pt);
            closeActivePolygon(); return;
          }
        }
      }
      activePolygon.vertices.push(pos);
    }
    drawCursor(e.clientX - container.getBoundingClientRect().left,
               e.clientY - container.getBoundingClientRect().top);
    return;
  }

  if (shape === 'select') {
    // Priority: vertex on selected poly → edge on selected poly → any poly interior → deselect
    const r = container.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;

    if (selectedPolygonId != null) {
      const selPoly = polygons.find(p => p.id === selectedPolygonId);
      if (selPoly) {
        // 1. Vertex hit
        const vi = findVertexAt(selPoly, raw.x, raw.y);
        if (vi >= 0) {
          pushUndo();
          selectedVertexIndex = vi;
          isDraggingVertex = true;
          vertexDragOrigVerts = selPoly.vertices.map(v => ({ x: v.x, y: v.y }));
          drawCursor(sx, sy);
          return;
        }
        // 2. Edge hit
        const ei = findEdgeAt(selPoly, raw.x, raw.y);
        if (ei >= 0) {
          pushUndo();
          isDraggingEdge = true;
          edgeDragIndex = ei;
          edgeDragStartMapX = raw.x;
          edgeDragStartMapY = raw.y;
          edgeDragOrigVerts = selPoly.vertices.map(v => ({ x: v.x, y: v.y }));
          drawCursor(sx, sy);
          return;
        }
      }
    }

    // 3. Interior hit — select polygon and start whole-poly drag
    const hit = findPolygonAt(raw.x, raw.y);
    if (hit) {
      if (hit.id !== selectedPolygonId) selectedVertexIndex = -1;
      pushUndo();
      selectedPolygonId = hit.id;
      isDraggingPolygon = true;
      polygonActuallyMoved = false;
      dragStartMapX = raw.x;
      dragStartMapY = raw.y;
      dragOrigVerts = hit.vertices.map(v => ({ x: v.x, y: v.y }));
    } else {
      selectedPolygonId = null;
      selectedVertexIndex = -1;
    }
    drawCursor(sx, sy);
    return;
  }

  const pos = raw;
  isDrawing = true;
  if (usePixi && !isPlayer) pixiSetFogBrushing(true);

  if (shape === 'brush') {
    pushUndo();
    fogModifiedThisStroke = true;
    const mapRadius = (brushSize / 2) / zoom;
    if (tool === 'reveal') revealCircle(pos.x, pos.y, mapRadius);
    else                   shroudCircle(pos.x, pos.y, mapRadius);
    lastMapX = pos.x; lastMapY = pos.y;
    fogDirty = true;
    scheduleRender();
  } else if (shape === 'circle') {
    fogModifiedThisStroke = false;
    circleCenter = { x: pos.x, y: pos.y };
  } else {
    fogModifiedThisStroke = false;
    rectStartX = pos.x; rectStartY = pos.y;
  }
}

function toolMouseMove(pos, e, screenX, screenY) {
  if (shape === 'select' && !isDraggingPolygon && !isDraggingVertex && !isDraggingEdge) {
    const selPoly = selectedPolygonId != null ? polygons.find(p => p.id === selectedPolygonId) : null;
    if (selPoly) {
      if (findVertexAt(selPoly, pos.x, pos.y) >= 0) container.style.cursor = 'pointer';
      else if (findEdgeAt(selPoly, pos.x, pos.y) >= 0) container.style.cursor = 'grab';
      else container.style.cursor = findPolygonAt(pos.x, pos.y) ? 'move' : 'default';
    } else {
      container.style.cursor = findPolygonAt(pos.x, pos.y) ? 'move' : 'default';
    }
  }

  if (isDraggingVertex && selectedPolygonId != null) {
    const poly = polygons.find(p => p.id === selectedPolygonId);
    if (poly && selectedVertexIndex >= 0 && selectedVertexIndex < poly.vertices.length) {
      const n    = poly.vertices.length;
      const prev = poly.vertices[(selectedVertexIndex - 1 + n) % n];
      const next = poly.vertices[(selectedVertexIndex + 1) % n];
      const VERT_EPSILON = 0.5; // map units — prevents coincident/zero-length edges
      if (Math.hypot(pos.x - prev.x, pos.y - prev.y) >= VERT_EPSILON &&
          Math.hypot(pos.x - next.x, pos.y - next.y) >= VERT_EPSILON) {
        poly.vertices[selectedVertexIndex] = { x: pos.x, y: pos.y };
        rebuildFogFromPolygons();
        fogDirty = true;
        scheduleRender();
      }
      drawCursor(screenX, screenY);
    }
    return;
  }

  if (isDraggingEdge && selectedPolygonId != null) {
    const poly = polygons.find(p => p.id === selectedPolygonId);
    if (poly && edgeDragOrigVerts) {
      const n = poly.vertices.length;
      const a = edgeDragOrigVerts[edgeDragIndex];
      const b = edgeDragOrigVerts[(edgeDragIndex + 1) % n];
      const edx = b.x - a.x, edy = b.y - a.y;
      const len = Math.hypot(edx, edy);
      if (len > 0) {
        const nx = -edy / len, ny = edx / len;
        const proj = (pos.x - edgeDragStartMapX) * nx + (pos.y - edgeDragStartMapY) * ny;
        poly.vertices[edgeDragIndex]           = { x: a.x + nx * proj, y: a.y + ny * proj };
        poly.vertices[(edgeDragIndex + 1) % n] = { x: b.x + nx * proj, y: b.y + ny * proj };
      }
      rebuildFogFromPolygons();
      drawCursor(screenX, screenY);
      fogDirty = true;
      scheduleRender();
    }
    return;
  }

  if (isDraggingPolygon && selectedPolygonId != null) {
    const dx = pos.x - dragStartMapX;
    const dy = pos.y - dragStartMapY;
    const poly = polygons.find(p => p.id === selectedPolygonId);
    if (poly) {
      poly.vertices = dragOrigVerts.map(v => ({ x: v.x + dx, y: v.y + dy }));
      polygonActuallyMoved = true;
      rebuildFogFromPolygons();
      fogDirty = true;
      scheduleRender();
    }
    return;
  }

  if (!isDrawing) return;

  if (shape === 'brush') {
    pendingBrushOps.push({ x1: lastMapX, y1: lastMapY, x2: pos.x, y2: pos.y, mode: tool });
    lastMapX = pos.x; lastMapY = pos.y;
    scheduleRender();
  } else {
    scheduleRender();
  }
}

function toolMouseUp(pos, e) {
  if (isDraggingVertex) {
    isDraggingVertex = false;
    vertexDragOrigVerts = null;
    stopFogTransition();
    startFogTransition(polygons.find(p => p.id === selectedPolygonId)?.mode === 'shroud');
    rebuildFogEffect();
    fogDirty = true;
    scheduleRender();
    scheduleAutoSync();
    return;
  }

  if (isDraggingEdge) {
    isDraggingEdge = false;
    edgeDragOrigVerts = null;
    stopFogTransition();
    startFogTransition(polygons.find(p => p.id === selectedPolygonId)?.mode === 'shroud');
    rebuildFogEffect();
    fogDirty = true;
    scheduleRender();
    scheduleAutoSync();
    return;
  }

  if (isDraggingPolygon) {
    isDraggingPolygon = false;
    dragOrigVerts = null;
    if (polygonActuallyMoved) {
      stopFogTransition();
      startFogTransition(polygons.find(p => p.id === selectedPolygonId)?.mode === 'shroud');
      rebuildFogEffect();
      fogDirty = true;
      scheduleRender();
      scheduleAutoSync();
    }
    return;
  }

  if (shape === 'poly' || shape === 'select') return;

  if (!isDrawing) return;
  isDrawing = false;
  if (usePixi && !isPlayer) pixiSetFogBrushing(false);
  lastMapX = lastMapY = null;
  if (shape === 'rect') {
    const rw = Math.abs(pos.x - rectStartX), rh = Math.abs(pos.y - rectStartY);
    if (rw > 2 && rh > 2) {
      pushUndo();
      fogModifiedThisStroke = true;
      const x1 = Math.min(rectStartX, pos.x), y1 = Math.min(rectStartY, pos.y);
      const x2 = Math.max(rectStartX, pos.x), y2 = Math.max(rectStartY, pos.y);
      const poly = {
        id: nextPolygonId++,
        vertices: [{x:x1,y:y1},{x:x2,y:y1},{x:x2,y:y2},{x:x1,y:y2}],
        mode: tool,
        cornerRadius: 0,
      };
      polygons.push(poly);
      selectedPolygonId = poly.id;
    }
    drawCursor(null, null);
  }
  if (shape === 'circle' && circleCenter) {
    const radius = Math.hypot(pos.x - circleCenter.x, pos.y - circleCenter.y);
    if (radius > 2) {
      pushUndo();
      fogModifiedThisStroke = true;
      const SEGS = 32;
      const verts = [];
      for (let i = 0; i < SEGS; i++) {
        const angle = (i / SEGS) * Math.PI * 2;
        verts.push({
          x: circleCenter.x + Math.cos(angle) * radius,
          y: circleCenter.y + Math.sin(angle) * radius,
        });
      }
      const poly = { id: nextPolygonId++, vertices: verts, mode: tool, cornerRadius: 0 };
      polygons.push(poly);
      selectedPolygonId = poly.id;
    }
    circleCenter = null;
    drawCursor(null, null);
  }
  if (polygons.length > 0) {
    rebuildFogFromPolygons();
  }
  if (fogModifiedThisStroke) {
    startFogTransition(tool === 'shroud');
    rebuildFogEffect();
    scheduleAutoSync();
  }
  fogModifiedThisStroke = false;
  fogDirty = true;
  scheduleRender();
}

function toolWindowMouseUp() {
  if (isDraggingVertex) {
    isDraggingVertex = false;
    vertexDragOrigVerts = null;
    stopFogTransition();
    startFogTransition(polygons.find(p => p.id === selectedPolygonId)?.mode === 'shroud');
    rebuildFogEffect();
    fogDirty = true;
    scheduleRender();
    scheduleAutoSync();
  }
  if (isDraggingEdge) {
    isDraggingEdge = false;
    edgeDragOrigVerts = null;
    stopFogTransition();
    startFogTransition(polygons.find(p => p.id === selectedPolygonId)?.mode === 'shroud');
    rebuildFogEffect();
    fogDirty = true;
    scheduleRender();
    scheduleAutoSync();
  }
  if (isDraggingPolygon) {
    isDraggingPolygon = false;
    dragOrigVerts = null;
    if (polygonActuallyMoved) {
      stopFogTransition();
      startFogTransition(polygons.find(p => p.id === selectedPolygonId)?.mode === 'shroud');
      rebuildFogEffect();
      fogDirty = true;
      scheduleRender();
      scheduleAutoSync();
    }
  }
  if (isDrawing) {
    isDrawing = false; lastMapX = lastMapY = null;
    if (usePixi && !isPlayer) pixiSetFogBrushing(false);
    circleCenter = null;
    if (polygons.length > 0) { rebuildFogFromPolygons(); }
    if (fogModifiedThisStroke) {
      startFogTransition(tool === 'shroud');
      rebuildFogEffect();
      scheduleAutoSync();
    }
    fogModifiedThisStroke = false;
    fogDirty = true;
    scheduleRender();
  }
}

function toolDblClick(raw, e) {
  const poly = polygons.find(p => p.id === selectedPolygonId);
  if (!poly) return;
  if (findVertexAt(poly, raw.x, raw.y) >= 0) return; // don't insert on existing vertex
  const ei = findEdgeAt(poly, raw.x, raw.y);
  if (ei < 0) return;
  pushUndo();
  const a = poly.vertices[ei], b = poly.vertices[(ei + 1) % poly.vertices.length];
  const pt = closestPointOnSegment(raw.x, raw.y, a.x, a.y, b.x, b.y);
  poly.vertices.splice(ei + 1, 0, pt);
  if (poly.cornerRadii) poly.cornerRadii.splice(ei + 1, 0, null);
  selectedVertexIndex = ei + 1;
  rebuildFogFromPolygons();
  rebuildFogEffect();
  fogDirty = true;
  scheduleRender();
  drawCursor(lastScreenX, lastScreenY);
}
