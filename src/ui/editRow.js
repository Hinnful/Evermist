'use strict';
// editRow.js — the edit row: what an open edit offers on the single map, in #context-row inside a blue
// frame. A well of Select, Pen and Bend; Split and the four booleans on the picked (greyed until a
// Shift+click picks one more); Snap and Straight walls (#fx-aids, shared with the other rows); Done.
// Several picked show it too, with no shape's edit open. Done, Enter and Esc close it and keep every pick;
// a press on empty map closes it keeping every pick, and the next press there deselects. A held Ctrl
// lights Bend while it is down. A two-map column and the Campaign keep editing as they always did.

const ER_TOOLS = [
  ['select', 'Select - drag a corner or a wall. Double-click a wall to add a corner'],
  ['pen', 'Pen - click the new corners, then click on a wall, the first point or double-click'],
  ['bend', 'Bend (hold Ctrl) - drag a wall into a curve. Click a curved wall to straighten it'],
];
// [op, the hidden button whose glyph it wears or the icon, tooltip]
const ER_OPS = [
  ['split', 'btn-cut', 'Split - draw a line across the picked'],
  ['union', 'btn-op-join', 'Merge (Alt+Shift+U) - the picked become one'],
  ['difference', 'btn-op-trim', 'Cut out (Alt+Shift+S) - the others are cut out of the first pick'],
  ['intersect', 'intersect', 'Intersect (Alt+Shift+I) - only the shared part stays'],
  ['xor', 'exclude', 'Exclude (Alt+Shift+E) - the shared part goes, the rest becomes one'],
];
const EDIT_ALT_SHIFT = { KeyU: 'union', KeyS: 'difference', KeyI: 'intersect', KeyE: 'xor' };

let editTool = 'select';     // the well's pick: 'select' | 'pen' | 'bend'
let editCtrlHeld = false;    // a held Ctrl lights Bend over the pick, and its release gives the pick back
let _erOpen = false, _erKey = '';
let _erPicks = false;        // the row is up for several picked; a press on empty map takes it down

function editRowOpen() {
  if (selectedPolygonId == null || shape !== 'select' || worldMapOpen || isPane || panesActive || gridCalArmed ||
      !findActiveShape()) return false;
  return shapeEditMode || (_erPicks && pickedExtras().length > 0);
}

// A Shift+click that picked one more (shapeSelect.js) brings the row up; any other change of the pick takes it down.
function editRowShowPicks() { _erPicks = true; }
function editRowForgetPicks() { _erPicks = false; }

function editRowPen() { return editRowOpen() && editToolNow() === 'pen'; }

// Pen and Bend act on the one open shape, so several picked put Select in hand.
function editToolNow() {
  if (pickedExtras().length) return 'select';
  return editCtrlHeld ? 'bend' : editTool;
}

function editRowBend() { return editRowOpen() && editToolNow() === 'bend'; }

function initEditRow() {
  const glyph = id => document.getElementById(id).querySelector('svg').outerHTML;
  document.querySelectorAll('#er-well .mode-btn').forEach(b => {
    const k = b.dataset.etool;
    b.innerHTML = k === 'select' ? glyph('btn-select') : uiIcon(k, 18, 1.5);
    b.title = t(ER_TOOLS.find(r => r[0] === k)[1]);
    b.onclick = () => { b.blur(); _erPickTool(k); };
  });
  document.querySelectorAll('#edit-row .er-op').forEach(b => {
    const row = ER_OPS.find(r => r[0] === b.dataset.op);
    b.innerHTML = document.getElementById(row[1]) ? glyph(row[1]) : uiIcon(row[1], 17, 1.5);
    b.title = t(row[2]);
    b.onclick = () => { b.blur(); if (row[0] === 'split') splitPickedArm(); else booleanOnPicked(row[0]); };
  });
  const done = document.getElementById('btn-edit-done');
  done.textContent = t('Done');
  done.title = t('Done (Enter or Esc)');
  done.onclick = () => { done.blur(); editRowClose(); };
  const ctrl = e => {
    if (!/^(Control|Meta)$/.test(e.key)) return;
    const held = e.type === 'keydown';
    if (held === editCtrlHeld) return;
    editCtrlHeld = held;
    if (editRowOpen()) refreshEditRow();
  };
  document.addEventListener('keydown', ctrl);
  document.addEventListener('keyup', ctrl);
  // A key released in another window never reaches this one.
  window.addEventListener('blur', () => { if (editCtrlHeld) { editCtrlHeld = false; refreshEditRow(); } });
}

function _erPickTool(k) {
  if (editToolNow() === 'select' && pickedExtras().length && k !== 'select') return;
  editTool = k;
  if (activePolygon && activePolygon.pen) activePolygon = null;
  refreshEditRow();
  drawCursor(lastScreenX, lastScreenY);
}

// V with an edit open puts the well's Select in hand and keeps the edit. True when it acted.
function editRowSelectKey() {
  if (!editRowOpen()) return false;
  _erPickTool('select');
  return true;
}

// Called on every cursor paint and render: opening or closing an edit rebuilds the row, a change of
// pick or of the picked count relights it.
function refreshEditRow() {
  const open = editRowOpen();
  if (open !== _erOpen) {
    _erOpen = open;
    _erKey = '';
    if (!open) {
      editTool = 'select';
      if (activePolygon && activePolygon.pen) activePolygon = null;
    }
    updateContextPanels();
  }
  if (!open) return;
  const many = pickedExtras().length > 0;
  if (many && editTool !== 'select') { editTool = 'select'; if (activePolygon && activePolygon.pen) activePolygon = null; }
  const lit = editToolNow(), key = lit + '|' + many;
  if (key === _erKey) return;
  _erKey = key;
  document.querySelectorAll('#er-well .mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.etool === lit);
    b.disabled = many && b.dataset.etool !== 'select';
  });
  document.querySelectorAll('#edit-row .er-op').forEach(b => {
    if (b.dataset.op === 'split') return;
    const tip = t(ER_OPS.find(r => r[0] === b.dataset.op)[2]);
    b.disabled = !many;
    b.title = many ? tip : tip + ' - ' + t('pick one more: Shift+click');
  });
}

function editRowClose() {
  if (activePolygon && activePolygon.pen) activePolygon = null;
  leaveShapeEditMode();
  pickSetReset();
  drawCursor(lastScreenX, lastScreenY);
  scheduleRender();
}

// Enter: closes an open edit, or opens the picked shape's. True when it acted.
function editRowEnter() {
  if (editRowOpen()) { editRowClose(); return true; }
  if (selectedPolygonId == null || shape !== 'select' || worldMapOpen || isPane || panesActive || gridCalArmed) return false;
  if (!findActiveShape()) return false;
  if (pickedExtras().length) _erPicks = true;
  else enterShapeEditMode(selectedPolygonId);
  drawCursor(lastScreenX, lastScreenY);
  scheduleRender();
  return true;
}

// A piece being drawn into the open edit, the Pen's or the Polygon tool's: Delete and Enter are its own.
function _erPieceDrawing() {
  if (!activePolygon || activePolygon.cut) return false;
  return activePolygon.pen ? editRowOpen() : shape === 'poly' && !!editedRoom();
}

// Delete or Backspace takes the piece's last point, and the piece with its first; never the room. True when it acted.
function editPieceBackspace() {
  if (!_erPieceDrawing()) return false;
  activePolygon.vertices.pop();
  if (!activePolygon.vertices.length) activePolygon = null;
  drawCursor(lastScreenX, lastScreenY);
  return true;
}

// Enter joins a piece of three points or more as its closing click would; a shorter one waits. True when it acted.
function editPieceEnter() {
  if (!_erPieceDrawing()) return false;
  if (activePolygon.vertices.length < 3) return true;
  if (activePolygon.pen) _erPenFinish(null);
  else closeActivePolygon(null);
  return true;
}

// Something of the open shape's, or a shape, under the press. Anything else is empty map.
function _erHitsShape(raw) {
  const boxed = boxedShape();
  return !!findPolygonAt(raw.x, raw.y) || selectHandleHit(raw) || !!(boxed && findBoxHandleAt(boxed, raw.x, raw.y));
}

// The press with Select in hand, ahead of the selection's own. True when the edit took it: every Pen click,
// and a press on empty map, which closes the edit and keeps every pick, so the next press there deselects.
function editRowMouseDown(raw, e) {
  if (!editRowOpen()) return false;
  if (editToolNow() === 'pen') { _erPenClick(raw, e); return true; }
  if (_erHitsShape(raw)) return false;
  leaveShapeEditMode();
  pickSetReset();
  drawCursor(lastScreenX, lastScreenY);
  scheduleRender();
  return true;
}

// A double-click: the Pen's finishes its piece; anywhere else it is the selection's.
function editRowDblClick(e) {
  if (!editRowPen()) return false;
  if (activePolygon && activePolygon.pen) _erPenFinish(e);
  return true;
}

function editRowHoverCursor() {
  return editRowPen() ? 'crosshair' : null;
}

// The Pen's first and last click reach a wall from twice the selection's 10px, and a corner from 12px.
const PEN_WALL_PX = 20, PEN_CORNER_PX = 12;

// The point on the open shape's wall the Pen would take at `raw`, or null: a corner nearby, else the nearest wall.
function _erWallPoint(poly, raw) {
  const rings = polyRings(poly);
  let best = null, bestD = PEN_CORNER_PX / zoom, flat = 0;
  rings.forEach((ring, r) => ring.forEach(v => {
    const d = ringIsLive(r) ? Math.hypot(raw.x - v.x, raw.y - v.y) : Infinity;
    if (d < bestD) { bestD = d; best = { x: v.x, y: v.y }; }
  }));
  if (best) return best;
  let edge = null;
  bestD = PEN_WALL_PX / zoom;
  rings.forEach((ring, r) => ring.forEach((v, i) => {
    const d = ringIsLive(r) ? distToEdge(poly, ring, i, flat, raw.x, raw.y) : Infinity;
    if (d < bestD) { bestD = d; edge = { ring, i, flat }; }
    flat++;
  }));
  if (!edge) return null;
  const near = closestOnEdge(poly, edge.ring, edge.i, edge.flat, raw.x, raw.y);
  return { x: near.pt.x, y: near.pt.y };
}

// The wall point the Pen's next click would take, marked while the Pen is in hand and that click may land on a
// wall: the first, or the last once two points exist. Painted by drawCursor; null when nothing qualifies.
let editPenHover = null;
function drawEditPenMarker(screenX, screenY) {
  editPenHover = null;
  if (screenX == null || !editRowOpen() || editToolNow() !== 'pen') return;
  const pen = activePolygon && activePolygon.pen ? activePolygon : null;
  if (pen && pen.vertices.length < 2) return;
  const pt = _erWallPoint(findActiveShape(), { x: (screenX - panX) / zoom, y: (screenY - panY) / zoom });
  if (!pt) return;
  editPenHover = pt;
  const { sx, sy } = toScreen(pt.x, pt.y);
  drawCorner(sx, sy, true, true, '#ffd060');
}

// The Pen, on the Polygon tool's clicks: it starts anywhere (a wall's point when the click lands on one), adds a
// corner per click (grid snap, then Straight walls), and closes on a wall once two points exist, on its own first
// point, or on a double-click. The piece joins the shape; Alt on the closing click cuts it out instead.
function _erPenClick(raw, e) {
  const poly = findActiveShape();
  const wall = _erWallPoint(poly, raw);
  const pen = activePolygon && activePolygon.pen ? activePolygon : null;
  if (!pen) {
    activePolygon = { vertices: [wall || snapVertex(raw.x, raw.y)], mode: poly.mode || tool, pen: true };
    return;
  }
  const n = pen.vertices.length, first = pen.vertices[0], last = pen.vertices[n - 1];
  if (n >= 3 && Math.hypot(raw.x - first.x, raw.y - first.y) < PEN_CORNER_PX / zoom) { _erPenFinish(e); return; }
  const pos = wall && n >= 2 ? wall : axisLockDraw(snapVertex(raw.x, raw.y));
  if (Math.hypot(pos.x - last.x, pos.y - last.y) * zoom < 2) return;
  pen.vertices.push(pos);
  if (pos === wall) _erPenFinish(e);
}

function _erPenFinish(e) {
  const verts = activePolygon.vertices;
  activePolygon = null;
  if (verts.length >= 3) joinPieceToPicked(verts, e && e.altKey ? 'trim' : 'join');
  drawCursor(lastScreenX, lastScreenY);
}
