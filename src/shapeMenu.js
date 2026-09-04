'use strict';
// The shape button and its flyout. Rectangle, Circle, Polygon and Cone stand behind ONE button on
// the bar: left click picks the shape showing, right click opens the family above it.
//
// ⚠ THE RIGHT CLICK MUST SUPPRESS ITS OWN CONTEXT MENU. Nothing upstream does: index.html's
// handler is inside `if (isPlayer)` and input.js's covers #canvas-container, a sibling of
// #tools-wrapper. Electron ships no default menu here, so a missing preventDefault looks
// harmless until one exists.

// The flyout is MODE_SHAPES (toolbar.js) filtered to the drawable shapes, so the list and the bar
// can never disagree about what a mode offers. Polygon leads; no room is ever cone-shaped.
const SHAPE_FAMILY = ['poly', 'rect', 'circle', 'cone'];
function shapeMenuItems() {
  return MODE_SHAPES[placeMode].filter(s => SHAPE_FAMILY.indexOf(s) >= 0);
}

// The button wears the glyph of the shape this mode last used, and leaves it alone when that
// shape is not in this mode's list, so it never goes blank.
function refreshShapeButton() {
  const btn  = document.getElementById('btn-shape');
  const menu = document.getElementById('shape-menu');
  if (!btn || !menu) return;
  const items = shapeMenuItems();
  const want  = items.indexOf(shape) >= 0
    ? shape
    : (placeMode === 'effects' ? effectsShape : roomsShape);
  const src = document.getElementById('btn-' + want);
  const box = btn.querySelector('.tb-shape-glyph');
  if (src && box && items.indexOf(want) >= 0) box.innerHTML = src.innerHTML;
  btn.classList.toggle('active', items.indexOf(shape) >= 0);
  menu.querySelectorAll('.mode-btn').forEach(b =>
    b.classList.toggle('active', b.id === 'btn-' + shape));
}

function openShapeMenu(on) {
  const menu = document.getElementById('shape-menu');
  if (menu) menu.classList.toggle('open', on);
}

function initShapeMenu() {
  const btn  = document.getElementById('btn-shape');
  const menu = document.getElementById('shape-menu');

  btn.onclick = () => {
    openShapeMenu(false);
    const items = shapeMenuItems();
    if (items.indexOf(shape) >= 0) return;   // already on the shape showing
    const want = placeMode === 'effects' ? effectsShape : roomsShape;
    setShape(items.indexOf(want) >= 0 ? want : 'poly');
  };
  btn.addEventListener('contextmenu', e => {
    e.preventDefault();
    openShapeMenu(!menu.classList.contains('open'));
  });

  SHAPE_FAMILY.forEach(s => {
    document.getElementById('btn-' + s).onclick = () => { setShape(s); openShapeMenu(false); };
  });

  // Closes on picking an item, on any click outside, and on Escape. NOT on mouse-out: the DM
  // aims across the gap between the flyout and the button it came from.
  document.addEventListener('mousedown', e => {
    if (!menu.classList.contains('open')) return;
    if (menu.contains(e.target) || btn.contains(e.target)) return;
    openShapeMenu(false);
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') openShapeMenu(false);
  });

  refreshShapeButton();
}
