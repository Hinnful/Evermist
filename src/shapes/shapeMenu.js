'use strict';
// shapeMenu.js — the bar's chevron lists. One list component serves them all: the shapes (this file),
// the repairs (repairBar.js) and an effect's sizes (effectsRow.js) each hand it rows and what a pick
// does. A chevron beside a button opens its list, and so does a right-click on the Shape button
// (dm-ui skill).
//
// ⚠ THE RIGHT CLICK MUST SUPPRESS ITS OWN CONTEXT MENU. Nothing upstream does: index.html's
// handler is inside `if (isPlayer)` and input.js's covers #canvas-container, a sibling of
// #tools-wrapper.

// The shapes are MODE_SHAPES (toolbar.js) filtered to the drawable ones, so the list and the bar
// can never disagree about what a mode offers. The Room list is always the rooms': a shape only Effects
// has is greyed, not dropped, except on the world map, which has no Effects, so there it is absent.
// The Effects switch has no list: its shapes are a well in the options row (effectsRow.js).
const SHAPE_FAMILY = ['poly', 'rect', 'circle', 'cone', 'line', 'wall', 'ring'];
const SHAPE_ROWS = { poly: ['Polygon', 'P'], rect: ['Rectangle', 'R'], circle: ['Circle', 'O'],
                     cone: ['Cone', 'C'], line: ['Line', ''], wall: ['Wall', ''], ring: ['Ring', ''] };
// The Campaign's Group list holds the three group shapes, then Road. Places take no repairs.
const WORLD_SHAPES = ['rect', 'circle', 'poly'];

let _roadWorn = false;          // the world map's Place button wears Road, the last pick, over the last shape
let _worn = 'btn-rect';         // the row the Shape button wears, and the list checks
let _tbOpen = null;             // the kind of the list that is open, or null
let _tbPickFn = null;           // what a pick in the open list does

function shapeMenuItems() {
  return MODE_SHAPES[placeMode].filter(s => SHAPE_FAMILY.indexOf(s) >= 0);
}

function _shapeName(s) { return SHAPE_ROWS[s][0]; }

// A repair needs something to act on: a room, an effect, or on the world map a place.
function repairsAvailable() { return activeShapeList().length > 0; }

// The scene bar's button wears the shape drawn with, always. The world map's wears Road when that was the
// last pick, and a shape the mode lacks is never worn, so the button never goes blank.
function refreshShapeButton() {
  const btn = document.getElementById('btn-shape');
  if (!btn) return;
  const items = shapeMenuItems();
  if (worldMapOpen) {
    if (_wmTool === 'road') _roadWorn = true;
    else if (items.indexOf(shape) >= 0) _roadWorn = false;
  }
  const road = worldMapOpen && _roadWorn;
  // The Room button stays Room in Effects mode: it wears the room shape, never the effect shape in hand.
  const inRooms = placeMode === 'rooms';
  const worn = inRooms && items.indexOf(shape) >= 0 ? shape : modeShape('rooms');
  const want = road ? 'wm-road' : 'btn-' + worn;
  _worn = want;
  const src = document.getElementById(want);
  const box = btn.querySelector('.tb-shape-glyph');
  if (src && box) box.innerHTML = src.querySelector('svg').outerHTML;
  // The scene bar's button is the Room tool and the Campaign's is the Group tool, and each says so; Road keeps its own
  // icon and tip.
  const label = road ? '' : worldMapOpen ? 'Group' : 'Room';
  btn.classList.toggle('tb-labeled', !!label);
  const text = btn.querySelector('.tb-shape-label');
  if (text) text.textContent = label === 'Group' ? t('Group') : label === 'Room' ? t('Room') : '';
  btn.title = road ? t('Road - click points along the way, double-click to finish')
    : label === 'Group' ? t('Group - gathers maps together: a kingdom, a village or one tavern. The arrow picks the shape')
    : placeMode === 'effects' ? t('Room - leave Effects to draw a room')
    : t('Room - hides part of the map from the players until you reveal it. The arrow picks the shape');
  btn.classList.toggle('active', worldMapOpen ? (_wmTool === 'road' || items.indexOf(shape) >= 0) : (inRooms && (items.indexOf(shape) >= 0 || shape === 'cut')));
}

function _tbCloseList() {
  const dd = document.getElementById('tb-dd');
  if (dd) dd.remove();
  document.querySelectorAll('.tb-chev.open, .op-chev.open').forEach(c => c.classList.remove('open'));
  _tbOpen = null;
  _tbPickFn = null;
}

// Rows are [id, name, key, off, iconSvg] or a string for a heading, or null for a divider.
function _tbRows() {
  const svgOf = id => { const src = document.getElementById(id); return src ? src.querySelector('svg').outerHTML : ''; };
  const order = worldMapOpen ? WORLD_SHAPES : SHAPE_FAMILY;
  const shapes = order.map(s => ['btn-' + s, _shapeName(s), !shapeInMode(s, 'rooms') ? t('Effects') : SHAPE_ROWS[s][1], !shapeInMode(s, 'rooms'), svgOf('btn-' + s)]);
  if (!worldMapOpen) return shapes;
  return shapes.concat([null, ['wm-road', 'Road', 'L', false, svgOf('wm-road')]]);
}

// Opens a list over `anchor`, above it and kept inside the window. `kind` names it so a second click on
// the same chevron closes it; `onPick(id)` is what a row does.
function openBarList(kind, anchor, chevEl, rows, picked, onPick, shapeRows) {
  _tbCloseList();
  _tbOpen = kind;
  _tbPickFn = onPick;
  if (chevEl) chevEl.classList.add('open');
  const dd = document.createElement('div');
  dd.id = 'tb-dd';
  // No tick column when nothing in the list is picked, or the rows start with empty space.
  dd.classList.toggle('nock', !rows.some(r => Array.isArray(r) && r[0] === picked));
  for (const r of rows) {
    if (r === null) { const sep = document.createElement('div'); sep.className = 'dd-sep'; dd.appendChild(sep); continue; }
    if (typeof r === 'string') { const h = document.createElement('div'); h.className = 'dd-lbl'; h.textContent = t(r); dd.appendChild(h); continue; }
    const [id, name, key, off, icon] = r;
    const row = document.createElement('button');
    row.className = 'dd-it' + (off ? ' off' : '');
    row.dataset.dd = id;
    row.disabled = off;
    if (off && shapeRows && SHAPE_FAMILY.indexOf(id.slice(4)) >= 0) row.title = t('Effects only');
    row.innerHTML = '<span class="ck"></span><span class="ic"></span><span class="nm"></span><span class="ky"></span>';
    row.querySelector('.ck').textContent = id === picked ? '✓' : '';
    row.querySelector('.ic').innerHTML = icon || '';
    row.querySelector('.nm').textContent = name;
    row.querySelector('.ky').textContent = key;
    dd.appendChild(row);
  }
  document.body.appendChild(dd);
  const r = anchor.getBoundingClientRect(), box = dd.getBoundingClientRect();
  const left = Math.max(8, Math.min(innerWidth - 8 - box.width, r.left - 6));
  const st = _rpScreenToStyle(dd, left, r.top - 10 - box.height);
  dd.style.left = st.left + 'px';
  dd.style.top = st.top + 'px';
}

function _tbOpenShapeList() {
  const group = document.getElementById('tb-grp-shape');
  const rows = _tbRows().map(r => (r && typeof r !== 'string') ? [r[0], t(r[1]), r[2], r[3], r[4]] : r);
  openBarList('shape', group, group.querySelector('.tb-chev'), rows, _worn, _tbPick, true);
}

// A plain shape is a new room, so it drops an armed Merge or Cut out. On the world map the Road row takes the
// road tool, and every other row puts it down (setShape does).
function _tbPick(id) {
  if (id === 'wm-road') { if (_wmTool !== 'road') worldMapRoadToolToggle(); return; }
  if (shapeOp !== 'new') setShapeOp('new');
  setShape(id.slice(4));
}

function initShapeMenu() {
  const btn = document.getElementById('btn-shape');

  btn.onclick = () => {
    if (placeMode === 'effects') return;   // greyed: Room does nothing while Effects is the mode
    if (btn.classList.contains('active') && shape !== 'cut') return;   // already the tool in hand
    if (worldMapOpen && _roadWorn) { if (_wmTool !== 'road') worldMapRoadToolToggle(); return; }
    const items = shapeMenuItems();
    const want = modeShape(placeMode);
    if (shapeOp !== 'new') setShapeOp('new');
    setShape(items.indexOf(want) >= 0 ? want : 'poly');
  };
  SHAPE_FAMILY.forEach(s => {
    document.getElementById('btn-' + s).onclick = () => setShape(s);
  });

  document.querySelector('#tb-grp-shape .tb-chev').addEventListener('click', e => {
    e.stopPropagation();
    if (placeMode === 'effects') return;
    if (_tbOpen === 'shape') _tbCloseList(); else _tbOpenShapeList();
  });
  btn.addEventListener('contextmenu', e => { e.preventDefault(); if (placeMode !== 'effects') _tbOpenShapeList(); });

  // Picks on click; mousedown only keeps the list from closing under the pointer.
  document.addEventListener('mousedown', e => {
    if (!_tbOpen || e.target.closest('#tb-dd, .tb-chev, .op-ic, .op-chev')) return;
    _tbCloseList();
  }, true);
  document.addEventListener('click', e => {
    const row = e.target.closest('#tb-dd [data-dd]');
    if (!row || row.disabled) return;
    const pick = _tbPickFn;
    _tbCloseList();
    if (pick) pick(row.dataset.dd);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _tbOpen) { _tbCloseList(); e.stopImmediatePropagation(); }
  }, true);

  refreshShapeButton();
}
