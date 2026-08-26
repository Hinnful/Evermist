'use strict';
// DM mouse/wheel event handlers, keyboard shortcuts, shape-tool helpers,
// and the shortcut-legend toggle. Top-level helpers (setShape, updateContextPanels,
// toggleLegend) stay global so toolbar.js and other modules can call them.
// initInput() is called once from index.html after initToolbar/initPlayer.

// ─── Shape tool helpers ───────────────────────────────────────────────────────

let legendVisible = false;

// The context row above the toolbar. ONE function owns every visibility decision in it, and it
// is called from both setShape and setPlaceMode — the row answers to the tool AND the placement
// mode, and more than one group can be up at once (fog trio plus brush size).
// Fog state is a ROOM's property, so the trio has nothing to say in Effects mode; the material
// picker takes its place there.
function updateContextPanels() {
  const show = (id, on) => {
    const el = document.getElementById(id);
    if (el) el.style.display = on ? 'flex' : 'none';
  };
  show('ctx-rooms',   placeMode !== 'effects');
  show('ctx-effects', placeMode === 'effects');
  show('panel-brush-bottom', shape === 'brush');
}

function setShape(s) {
  if (isPlayer) return;
  shape = s;
  ['brush', 'rect', 'poly', 'circle', 'cone', 'select'].forEach(sh => {
    const el = document.getElementById('btn-' + sh);
    if (el) el.classList.toggle('active', sh === s);
  });
  if (s !== 'poly') activePolygon = null;
  if (s !== 'select') selectedVertexIndex = -1;
  refreshHalfAvailability(); // half is shape-tools only; the brush can't paint it

  circleCenter = null;
  coneApex = null;
  container.style.cursor = s === 'select' ? 'default' : 'crosshair';
  drawCursor(lastScreenX, lastScreenY);
  updateContextPanels();
}

function toggleLegend() {
  legendVisible = !legendVisible;
  document.getElementById('shortcut-legend').style.display = legendVisible ? '' : 'none';
  document.getElementById('legend-backdrop').style.display = legendVisible ? '' : 'none';
}

// ─── Input registration ───────────────────────────────────────────────────────

function initInput() {
  if (!isPlayer) {
    container.addEventListener('mousedown', (e) => {
      // Hand focus back to the map. The canvas is not focusable, so a click on it does not
      // blur anything by itself: after typing in the room card that field keeps focus for
      // the rest of the session, and every later Ctrl+Z goes to its text history instead of
      // the fog. The field's own blur commit is what we want here anyway.
      const focused = document.activeElement;
      if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA')) {
        focused.blur();
      }
      if (!mapOffscreen) return;
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        isPanning = true;
        panStartX = e.clientX; panStartY = e.clientY;
        panStartPanX = panX;   panStartPanY = panY;
        boostRender(); // so the first frame of the drag is already at full rate
        e.preventDefault(); return;
      }
      if (e.button !== 0) return;
      const raw = screenToMap(e.clientX, e.clientY);
      toolMouseDown(raw, e);
    });

    container.addEventListener('mousemove', (e) => {
      if (!mapOffscreen) return;
      const rect = container.getBoundingClientRect();
      lastScreenX = e.clientX - rect.left;
      lastScreenY = e.clientY - rect.top;
      // Panning is checked BEFORE the hover repaint, and hands the overlay to the
      // render clock rather than painting it here. Both matter: the hover paint used
      // to run first and so fired on every pan event too, with the pre-move pan values
      // baked in, and the pan branch then repainted the whole overlay a second time.
      // Two full overlay repaints per mouse event, off-clock, is what made the room
      // outlines slide against the map they sit on. Hover keeps its inline paint so the
      // brush ring still tracks the pointer at full rate.
      if (isPanning) {
        panX = panStartPanX + (e.clientX - panStartX);
        panY = panStartPanY + (e.clientY - panStartY);
        pixiSetViewport(zoom, panX, panY);
        viewportDirty = true;
        boostRender();                            // re-arms the deadline each event
        scheduleCursor(lastScreenX, lastScreenY); // schedules the render too
        return;
      }
      drawCursor(lastScreenX, lastScreenY);
      const pos = screenToMap(e.clientX, e.clientY);
      toolMouseMove(pos, e, lastScreenX, lastScreenY);
    });

    container.addEventListener('mouseup', (e) => {
      if (isPanning) { isPanning = false; return; }
      const pos = screenToMap(e.clientX, e.clientY);
      toolMouseUp(pos, e);
    });

    container.addEventListener('mouseleave', () => {
      drawCursor(null, null);
      if (isPanning) isPanning = false;
      if (isDrawing) { isDrawing = false; lastMapX = lastMapY = null; }
    });

    window.addEventListener('mouseup', () => {
      toolWindowMouseUp();
      if (isPanning) { isPanning = false; }
    });

    container.addEventListener('wheel', (e) => {
      if (!mapOffscreen) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      const newZoom = Math.max(0.02, Math.min(20, zoom * factor));
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      panX = mx - (mx - panX) * (newZoom / zoom);
      panY = my - (my - panY) * (newZoom / zoom);
      zoom = newZoom;
      pixiSetViewport(zoom, panX, panY);
      viewportDirty = true;
      boostRender();                            // a wheel zoom has no end event —
      scheduleCursor(lastScreenX, lastScreenY); // the deadline is what ends it
    }, { passive: false });

    container.addEventListener('contextmenu', e => e.preventDefault());

    container.addEventListener('dblclick', (e) => {
      if (!mapOffscreen || shape !== 'select' || selectedPolygonId == null) return;
      const raw = screenToMap(e.clientX, e.clientY);
      toolDblClick(raw, e);
    });

    document.getElementById('legend-backdrop').addEventListener('click', () => {
      if (legendVisible) toggleLegend();
    });
  }

  document.addEventListener('keydown', e => {
    // TEXTAREA as well as INPUT: the room card's description field is a textarea, and a
    // bare 'r'/'s'/Delete reaching the map shortcuts while the DM types would switch the
    // paint tool or delete the room. (The card also stops propagation at source.)
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (isPlayer) {
      if (e.key === 'f') {
        if (window.electronAPI) window.electronAPI.toggleFullscreen();
        else document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      }
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; }
    }
    switch (e.key) {
      case 'r': document.getElementById('btn-reveal').click(); break;
      case 's': document.getElementById('btn-shroud').click(); break;
      case 'b': setShape('brush');  break;
      case 'e': setShape('rect');   break;
      case 'p': setShape('poly');   break;
      case 'c': setShape('circle'); break;
      // O for cOne — C belongs to Circle, and no better letter is free.
      case 'o': setShape('cone');   break;
      case 'v': setShape('select'); break;
      case 'n': document.getElementById('btn-snap').click();   break;
      case 'g': document.getElementById('btn-grid').click();   break;
      case 'a': document.getElementById('btn-anim').click(); break;
      // Both cases: this switch reads e.key, which is case-sensitive (see 'S' below), so a
      // bare 'l' branch alone would make Shift+L look dead.
      case 'l':
      case 'L': if (typeof toggleRoomLabels === 'function') toggleRoomLabels(); break;
      case 'f': if (mapOffscreen) { fitToScreen(); viewportDirty = true; scheduleRender(); } break;
      case 'Delete':
        if (shape === 'select' && selectedPolygonId != null && selectedVertexIndex >= 0) {
          const poly = findActiveShape();
          if (poly && poly.vertices.length > 3) {
            pushUndo();
            poly.vertices.splice(selectedVertexIndex, 1);
            if (poly.cornerRadii) poly.cornerRadii.splice(selectedVertexIndex, 1);
            selectedVertexIndex = -1;
            shapeGeometryChanged();
            persistShapeEdit();
            fogDirty = true;
            scheduleRender();
            drawCursor(lastScreenX, lastScreenY);
          }
        } else if (selectedPolygonId != null) {
          deleteSelectedPolygon();
        }
        break;
      case 'Escape':
        if (legendVisible) { toggleLegend(); break; }
        if (activePolygon) {
          activePolygon = null;
          drawCursor(null, null);
        } else if (selectedVertexIndex >= 0) {
          selectedVertexIndex = -1;
          drawCursor(lastScreenX, lastScreenY);
        } else if (selectedPolygonId != null) {
          selectedPolygonId = null;
          drawCursor(null, null);
        }
        break;
      case 't':
        if (selectedPolygonId != null) toggleSelectedPolygon();
        break;
      case '[': brushSize = Math.max(5, brushSize - 10);
                document.getElementById('brush-size').value = brushSize;
                document.getElementById('brush-size-label').textContent = brushSize; break;
      case ']': brushSize = Math.min(300, brushSize + 10);
                document.getElementById('brush-size').value = brushSize;
                document.getElementById('brush-size-label').textContent = brushSize; break;
      case 'S': if (!autoSync) { e.preventDefault(); sendToPlayer(); } break;
      case ' ': e.preventDefault(); sendToPlayer(); break;
      case '?': if (!isPlayer) toggleLegend(); break;
    }
  });
}
