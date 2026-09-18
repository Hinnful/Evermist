'use strict';
// DM mouse and wheel handlers, keyboard shortcuts, shape-tool helpers, and the legend toggle.
// The top-level helpers stay global so toolbar.js can call them. initInput() runs once from
// index.html, after initToolbar and initPlayer.

// ─── Shape tool helpers ───────────────────────────────────────────────────────

let legendVisible = false;

// The strip above the toolbar, which carries ONLY what the picked tool uses. ONE function owns
// every visibility decision, called from setShape and setPlaceMode. Fog state is a ROOM's
// property; Select and Split take no options at all. The trio and the brush size never split up.
function updateContextPanels() {
  const show = (id, on) => {
    const el = document.getElementById(id);
    if (el) el.style.display = on ? 'flex' : 'none';
  };
  // Calibration owns the map's mouse, so the picked tool's options are replaced rather than shown
  // beside it - a strip offering brush size while a drag sets the grid describes nothing. Its own
  // count rides the map in #gridcal-hud, not this row.
  const cal    = gridCalArmed;
  const closed = shape === 'poly' || shape === 'rect' || shape === 'circle' || shape === 'cone';
  const rooms  = !cal && placeMode !== 'effects' && (closed || shape === 'brush');
  const fx     = !cal && placeMode === 'effects' && closed;
  const door   = !cal && shape === 'door';
  show('ctx-rooms', rooms);
  show('panel-brush-bottom', rooms);
  show('ctx-effects', fx);
  show('ctx-door', door);
  // ⚠ visibility, NEVER display. A hidden box keeps its place, so the bar below does not jump up
  // by this strip's height every time the DM picks Select and drop back on the next shape.
  const row = document.getElementById('context-row');
  if (row) row.style.visibility = (rooms || fx || door) ? '' : 'hidden';
  const cellLabel = document.getElementById('door-cell-label');
  if (cellLabel) cellLabel.textContent = Math.round(gridSize);
}

function setShape(s) {
  if (isPlayer) return;
  paneBroadcast('shape', { shape: s });
  // Picking a tool is the DM asking for the map back, and it is the way out of calibration that
  // needs no button.
  if (gridCalArmed) armGridCalibration(false);
  shape = s;
  // ⚠ ONLY A SHAPE IS RECORDED. The shape button reads this to decide both the glyph it wears
  // and what a left click picks, so recording Brush, Door or Split makes those two disagree.
  if (SHAPE_FAMILY.indexOf(s) >= 0) {
    if (placeMode === 'effects') effectsShape = s; else roomsShape = s;
  }
  ['brush', 'rect', 'poly', 'circle', 'cone', 'select', 'door', 'cut'].forEach(sh => {
    const el = document.getElementById('btn-' + sh);
    if (el) el.classList.toggle('active', sh === s);
  });
  refreshShapeButton();   // the one shape button wears whichever of the four is picked
  // ⚠ The Polygon tool and Cut both click their shape out through activePolygon, and a leftover
  // cut path closes as a room on the next Polygon click, so only its owner keeps it.
  if (s !== (activePolygon && activePolygon.cut ? 'cut' : 'poly')) activePolygon = null;
  if (s !== 'select') leaveShapeEditMode();
  refreshPaintAvailability(); // half is shape-tools only; the brush can't paint it

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

function pickShapeByKey(s) {
  if (shapeInMode(s, placeMode)) setShape(s);
}

function toggleLegend() {
  legendVisible = !legendVisible;
  document.getElementById('shortcut-legend').style.display = legendVisible ? '' : 'none';
  document.getElementById('legend-backdrop').style.display = legendVisible ? '' : 'none';
}

// ─── Input registration ───────────────────────────────────────────────────────

function initInput() {
  if (!isPlayer) {
    // ⚠ WHOLE DOCUMENT, CAPTURE PHASE. A focused field swallows every map shortcut below, so a
    // click anywhere outside it hands focus back, not just one on the map. Capture because the
    // fields stop this bubbling, and it puts their commit ahead of the clicked control.
    document.addEventListener('mousedown', (e) => {
      const focused = document.activeElement;
      if (!focused || (focused.tagName !== 'INPUT' && focused.tagName !== 'TEXTAREA')) return;
      if (focused === e.target) return;
      focused.blur();
    }, true);

    container.addEventListener('mousedown', (e) => {
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
      if (gridCalArmed) { gridCalMouseDown(raw); return; }
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
      if (gridCalArmed) { gridCalMouseMove(pos); return; }
      toolMouseMove(pos, e, lastScreenX, lastScreenY);
    });

    container.addEventListener('mouseup', (e) => {
      if (isPanning) { isPanning = false; return; }
      // Calibration releases on the WINDOW handler below, so a square dragged off the map's edge
      // still commits. Answering here too would commit it twice.
      if (gridCalArmed) return;
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
      if (gridCalArmed) { gridCalMouseUp(); if (isPanning) isPanning = false; return; }
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
      if (!mapOffscreen) return;
      // A cut path has no closing vertex to click, so the double-click IS its finish. The two
      // mousedowns underneath it have already placed the last point.
      if (shape === 'cut') { commitCutPath(); return; }
      if (shape !== 'select') return;
      selectDblClick(screenToMap(e.clientX, e.clientY));
    });

    document.getElementById('legend-backdrop').addEventListener('click', () => {
      if (legendVisible) toggleLegend();
    });
  }

  // ⚠ e.code, THE PHYSICAL KEY - never e.key, which is the character a layout produced.
  document.addEventListener('keydown', e => {
    // A FOCUSED FIELD OWNS ITS OWN UNDO, so it takes every key including the modifiers.
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (isPlayer) {
      if (e.code === 'KeyF') {
        if (window.electronAPI) window.electronAPI.toggleFullscreen();
        else document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      }
      return;
    }
    // Ahead of the shape shortcuts: while calibration holds the map, Escape means leave it.
    if (gridCalArmed && e.code === 'Escape') { e.preventDefault(); armGridCalibration(false); return; }
    // ⚠ RETURNS WHATEVER THE KEY WAS, or Ctrl+C picks the Cone and Ctrl+R the Rectangle.
    if (e.ctrlKey || e.metaKey) {
      if (e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) { e.preventDefault(); redo(); }
      // Figma's three, on the shapes → shapeClipboard.js. A focused field returned above, so
      // Ctrl+C still copies text out of the name and description.
      else if (e.code === 'KeyC') { e.preventDefault(); copySelectedShape(); }
      else if (e.code === 'KeyV') { e.preventDefault(); pasteShapeAtCursor(); }
      else if (e.code === 'KeyD') { e.preventDefault(); duplicateSelectedShape(); }
      return;
    }
    switch (e.code) {
      // ⚠ A KEY FOR A SHAPE THIS MODE DOES NOT OFFER DOES NOTHING - no switch, no fallback, no
      // message, because the bar carries no button for it either. Reveal and Shroud have no key
      // at all: a bare letter means a tool.
      case 'KeyV': setShape('select'); break;
      case 'KeyR': pickShapeByKey('rect');   break;
      case 'KeyO': pickShapeByKey('circle'); break;
      case 'KeyP': pickShapeByKey('poly');   break;
      case 'KeyC': pickShapeByKey('cone');   break;
      case 'KeyB': pickShapeByKey('brush');  break;
      case 'KeyN': document.getElementById('btn-snap').click(); break;
      case 'KeyG': document.getElementById('btn-grid').click(); break;
      case 'KeyA': document.getElementById('btn-anim').click(); break;
      case 'KeyL': if (typeof toggleRoomLabels === 'function') toggleRoomLabels(); break;
      case 'KeyF': if (mapOffscreen) { fitToScreen(); viewportDirty = true; scheduleRender(); } break;
      case 'Delete':
        deleteSelectedPart();
        break;
      // One press drops one thing, most local first, then puts the bar back to rest - an armed
      // Merge, Trim or Cut has no other way out from the keyboard.
      case 'Escape':
        if (legendVisible) { toggleLegend(); break; }
        if (activePolygon) {
          activePolygon = null;
          drawCursor(null, null);
        } else if (escapeShapeSelection()) {
          // one level per press, handled in shapeSelect.js
        } else {
          if (shapeOp !== 'new') setShapeOp('new');
          if (shape !== 'select') setShape('select');
        }
        break;
      case 'KeyT':
        if (selectedPolygonId != null) toggleSelectedPolygon();
        break;
      case 'BracketLeft':  brushSize = Math.max(5, brushSize - 10);
                document.getElementById('brush-size').value = brushSize;
                document.getElementById('brush-size-label').textContent = brushSize; break;
      case 'BracketRight': brushSize = Math.min(300, brushSize + 10);
                document.getElementById('brush-size').value = brushSize;
                document.getElementById('brush-size-label').textContent = brushSize; break;
      case 'KeyS': if (e.shiftKey && !autoSync) { e.preventDefault(); sendToPlayer(); } break;
      // Space is the live Send at the table, so it must mean one thing wherever focus sits. A
      // toolbar button keeps focus after a click and Space would press it again, so hand focus back
      // to the map first.
      case 'Space':
        e.preventDefault();
        if (document.activeElement && document.activeElement.tagName === 'BUTTON') {
          document.activeElement.blur();
        }
        sendToPlayer();
        break;
      case 'Slash': if (e.shiftKey) toggleLegend(); break;
    }
  });
}
