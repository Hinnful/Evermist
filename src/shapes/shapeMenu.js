'use strict';
// shapeMenu.js — the bar's two lists: the shape button's and the operations button's. A chevron
// beside each button opens its list, and so does a right-click on the button (dm-ui skill).
//
// ⚠ THE RIGHT CLICK MUST SUPPRESS ITS OWN CONTEXT MENU. Nothing upstream does: index.html's
// handler is inside `if (isPlayer)` and input.js's covers #canvas-container, a sibling of
// #tools-wrapper.

// The shapes are MODE_SHAPES (toolbar.js) filtered to the drawable ones, so the list and the bar
// can never disagree about what a mode offers. A shape the mode lacks is greyed, not dropped, except
// on the world map, which has no Effects to switch to, so there it is absent.
const SHAPE_FAMILY = ['poly', 'rect', 'circle', 'cone', 'line', 'ring'];
const SHAPE_ROWS = { poly: ['Polygon', 'P'], rect: ['Rectangle', 'R'], circle: ['Circle', 'O'],
                     cone: ['Cone', 'C'], line: ['Line', ''], ring: ['Ring', ''] };
const OPS_ROWS = { 'btn-op-join': 'Merge', 'btn-op-trim': 'Cut out', 'btn-cut': 'Split' };

let _opsPick = 'btn-op-join';   // the repair the operations button wears
let _tbOpen = null;             // 'shape' | 'ops' | null

function shapeMenuItems() {
  return MODE_SHAPES[placeMode].filter(s => SHAPE_FAMILY.indexOf(s) >= 0);
}

// The button wears the glyph of the shape this mode last used, and leaves it alone when that
// shape is not in this mode's list, so it never goes blank.
function refreshShapeButton() {
  const btn = document.getElementById('btn-shape');
  if (!btn) return;
  const items = shapeMenuItems();
  const want  = items.indexOf(shape) >= 0
    ? shape
    : modeShape(placeMode);
  const src = document.getElementById('btn-' + want);
  const box = btn.querySelector('.tb-shape-glyph');
  if (src && box && items.indexOf(want) >= 0) box.innerHTML = src.innerHTML;
  btn.classList.toggle('active', items.indexOf(shape) >= 0);
  refreshOpsButton();
}

// One of the three repairs is on the bar at a time: the last one armed or picked. Split is a
// tool in hand; Merge and Cut out are switches that stay armed.
function refreshOpsButton() {
  if (shape === 'cut') _opsPick = 'btn-cut';
  else if (shapeOp !== 'new') _opsPick = 'btn-op-' + shapeOp;
  for (const id in OPS_ROWS) {
    const el = document.getElementById(id);
    if (el) el.style.display = id === _opsPick ? '' : 'none';
  }
}

function _tbPickedRow(kind) {
  if (kind === 'ops') return _opsPick;
  const items = shapeMenuItems();
  return 'btn-' + (items.indexOf(shape) >= 0 ? shape : modeShape(placeMode));
}

function _tbCloseList() {
  const dd = document.getElementById('tb-dd');
  if (dd) dd.remove();
  document.querySelectorAll('.tb-chev.open').forEach(c => c.classList.remove('open'));
  _tbOpen = null;
}

function _tbOpenList(kind) {
  _tbCloseList();
  _tbOpen = kind;
  const group = document.getElementById('tb-grp-' + kind);
  group.querySelector('.tb-chev').classList.add('open');
  const dd = document.createElement('div');
  dd.id = 'tb-dd';
  const picked = _tbPickedRow(kind);
  const rows = kind === 'shape'
    ? SHAPE_FAMILY.filter(s => !worldMapOpen || shapeInMode(s, placeMode))
        .map(s => ['btn-' + s, SHAPE_ROWS[s][0], SHAPE_ROWS[s][1], !shapeInMode(s, placeMode)])
    : Object.keys(OPS_ROWS).map(id => [id, OPS_ROWS[id], '', false]);
  for (const [id, name, key, off] of rows) {
    const row = document.createElement('button');
    row.className = 'dd-it' + (off ? ' off' : '');
    row.dataset.dd = id;
    row.disabled = off;
    if (off) row.title = t('Effects only');
    const src = document.getElementById(id);
    row.innerHTML = '<span class="ck"></span><span class="ic"></span><span class="nm"></span><span class="ky"></span>';
    row.querySelector('.ck').textContent = id === picked ? '✓' : '';
    row.querySelector('.ic').innerHTML = src ? src.querySelector('svg').outerHTML : '';
    row.querySelector('.nm').textContent = t(name);
    row.querySelector('.ky').textContent = off ? t('Effects') : key;
    dd.appendChild(row);
  }
  document.body.appendChild(dd);
  const r = group.getBoundingClientRect(), box = dd.getBoundingClientRect();
  const st = _rpScreenToStyle(dd, r.left - 6, r.top - 10 - box.height);
  dd.style.left = st.left + 'px';
  dd.style.top = st.top + 'px';
}

// A pick goes through the button's own handler, so each repair keeps exactly the arming it had.
// ⚠ Picking Split disarms Merge and Cut out, whose button then leaves the bar (dm-ui skill).
function _tbPick(id) {
  if (_tbOpen === 'shape') { setShape(id.slice(4)); return; }
  if (id === 'btn-cut') { setShapeOp('new'); if (shape !== 'cut') setShape('cut'); return; }
  if (shape === 'cut') setShape('select');
  const op = id === 'btn-op-join' ? 'join' : 'trim';
  if (shapeOp !== op) setShapeOp(op);
}

function initShapeMenu() {
  const btn = document.getElementById('btn-shape');

  btn.onclick = () => {
    const items = shapeMenuItems();
    if (items.indexOf(shape) >= 0) return;   // already on the shape showing
    const want = modeShape(placeMode);
    setShape(items.indexOf(want) >= 0 ? want : 'poly');
  };
  SHAPE_FAMILY.forEach(s => {
    document.getElementById('btn-' + s).onclick = () => setShape(s);
  });

  document.querySelectorAll('.tb-chev').forEach(c => c.addEventListener('click', e => {
    e.stopPropagation();
    if (_tbOpen === c.dataset.chev) _tbCloseList(); else _tbOpenList(c.dataset.chev);
  }));
  ['btn-shape', ...Object.keys(OPS_ROWS)].forEach(id => {
    document.getElementById(id).addEventListener('contextmenu', e => {
      e.preventDefault();
      _tbOpenList(id === 'btn-shape' ? 'shape' : 'ops');
    });
  });

  // Picks on click; mousedown only keeps the list from closing under the pointer.
  document.addEventListener('mousedown', e => {
    if (!_tbOpen || e.target.closest('#tb-dd, .tb-chev')) return;
    _tbCloseList();
  }, true);
  document.addEventListener('click', e => {
    const row = e.target.closest('#tb-dd [data-dd]');
    if (!row || row.disabled) return;
    _tbPick(row.dataset.dd);
    _tbCloseList();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _tbOpen) { _tbCloseList(); e.stopImmediatePropagation(); }
  }, true);

  refreshShapeButton();
}
