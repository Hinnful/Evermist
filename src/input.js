'use strict';
// DM mouse and wheel handlers, keyboard shortcuts, shape-tool helpers, and the legend toggle.
// The top-level helpers stay global so toolbar.js can call them. initInput() runs once from
// index.html, after initToolbar and initPlayer.

// ─── Shape tool helpers ───────────────────────────────────────────────────────

let legendVisible = false;

// The context row above the toolbar. ONE function owns every visibility decision, called from both
// setShape and setPlaceMode, because the row answers to the tool AND the mode, and more than one
// group can be up at once.
// Fog state is a ROOM's property, so the trio has nothing to say in Effects mode.
function updateContextPanels() {
  const show = (id, on) => {
    const el = document.getElementById(id);
    if (el) el.style.display = on ? 'flex' : 'none';
  };
  show('ctx-rooms',   placeMode !== 'effects' && shape !== 'door');
  show('ctx-effects', placeMode === 'effects');
  show('panel-brush-bottom', shape === 'brush');
  show('ctx-door', shape === 'door');
  const cellLabel = document.getElementById('door-cell-label');
  if (cellLabel) cellLabel.textContent = Math.round(gridSize);
}

function setShape(s) {
  if (isPlayer) return;
  shape = s;
  ['brush', 'rect', 'poly', 'circle', 'cone', 'select', 'door'].forEach(sh => {
    const el = document.getElementById('btn-' + sh);
    if (el) el.classList.toggle('active', sh === s);
  });
  if (s !== 'poly') activePolygon = null;
  if (s !== 'select') selectedVertexIndex = -1;
  refreshHalfAvailability(); // half is shape-tools only; the brush can't paint it

  circleCenter = null;
  coneApex = null;
  container.style.cursor = s === 'select' ? 'default' : (s === 'door' ? 'pointer' : 'crosshair');
  // The Door tool shows the grid on its own (renderGrid), so picking or dropping it has to
  // repaint that layer. The cursor canvas below is a different one and would not carry it.
  gridDirty = true;
  scheduleRender();
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
      // Hand focus back to the map. The canvas is not focusable, so a click does not blur
      // anything: a room-card field otherwise keeps focus and every later Ctrl+Z goes to its text
      // history instead of the fog.
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
      // ⚠ Panning is checked BEFORE the hover repaint, and hands the overlay to the render clock
      // rather than painting here. Otherwise the hover paint fires on every pan event with stale
      // pan values, and the pan branch repaints a second time — two off-clock overlay repaints per
      // mouse event, which is what slides the room outlines against the map. Hover keeps its
      // inline paint so the brush ring tracks the pointer at full rate.
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
      // The brush ring goes: the cursor is no longer over the map.
      drawCursor(null, null);
      // ⚠ NEITHER A STROKE NOR A PAN ENDS HERE, and lastMapX/lastMapY are kept so a drag that
      // leaves the map and comes back is one continuous stroke. A drag follows the mouse BUTTON,
      // and the bottom toolbar floats over the map, so every stroke along the lower edge crosses it.
      //
      // Clearing isDrawing here also skips the ENTIRE release path, since toolWindowMouseUp() is
      // gated on that flag: the fog stays in brushing mode and the reveal never reaches the Player.
      //
      // The window mouseup owns every release — a stroke, a shape and a pan alike.
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
    // TEXTAREA as well as INPUT: the description field is a textarea, and a bare 'r' or Delete
    // reaching the map shortcuts while the DM types would switch tool or delete the room.
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
            if (poly.doors) poly.doors = remapDoorsForVertexChange(poly.doors, selectedVertexIndex, -1);
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
      // Space is the live Send at the table, so it must mean one thing wherever focus sits. A
      // toolbar button keeps focus after a click and Space would press it again, so hand focus back
      // to the map first.
      case ' ':
        e.preventDefault();
        if (document.activeElement && document.activeElement.tagName === 'BUTTON') {
          document.activeElement.blur();
        }
        sendToPlayer();
        break;
      case '?': if (!isPlayer) toggleLegend(); break;
    }
  });
}
