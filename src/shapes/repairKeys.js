'use strict';
// repairKeys.js — what a drawn shape does to the rooms it touches. Bare, it draws one. Held while it
// is drawn, Shift merges it into every room it touches, Alt cuts it out of them and Ctrl splits them;
// the bar's repair icon arms the same three with no key held. The press or release event is what
// commit reads (repairNow(e)); the listeners below only feed the outline, the pointer tag and the
// icon, which light while a key is down.
//
// ⚠ A SHAPE FROM A SIZE (presetArmed) TAKES NO KEY. Shift there snaps its angle (toolPreset.js), and
// the repair keys act on shapes drawn by hand; an armed repair still applies to it.

const REPAIR_NAMES = { join: 'Merge', trim: 'Cut out', split: 'Split' };
const REPAIR_KEYS  = { join: 'Shift', trim: 'Alt', split: 'Ctrl' };
const REPAIR_RGB   = { join: '95,227,154', trim: '255,123,123', split: '255,208,96' };
const HAND_SHAPES  = ['poly', 'rect', 'circle', 'cone'];

let heldRepair = null;         // the key down in this window: 'join' | 'trim' | 'split' | null
let heldRepairRemote = null;   // the key down in a column, reported up (reportPaneRepairKey)

function repairFromKeys(e) {
  return e.ctrlKey || e.metaKey ? 'split' : e.altKey ? 'trim' : e.shiftKey ? 'join' : null;
}

// A key makes a repair only while a shape is being drawn by hand.
function repairKeysLive() {
  return !isPlayer && !worldMapOpen && !gridCalArmed && !presetArmed && HAND_SHAPES.indexOf(shape) >= 0;
}

// The repair a shape finished now runs in: the key on the event, else the one armed. 'new' draws a room.
function repairNow(e) {
  const key = e ? repairFromKeys(e) : heldRepair;
  if (key && repairKeysLive()) return key;
  return shapeOp;
}

// What the bar's icon and the outline show: a key down here or in a column, else the armed repair.
function repairShown() {
  if (shape === 'cut' && !worldMapOpen) return 'split';
  const key = heldRepair || heldRepairRemote;
  if (key && (repairKeysLive() || heldRepairRemote)) return key;
  return shapeOp !== 'new' ? shapeOp : null;
}

function _repairSetHeld(key) {
  if (key === heldRepair) return;
  heldRepair = key;
  reportPaneRepairKey();
  if (typeof refreshRepairIcon === 'function') refreshRepairIcon();
  drawCursor(lastScreenX, lastScreenY);
}

// A column has no bar; it tells the window that has one which key is down.
function reportPaneRepairKey() {
  if (typeof isPane === 'undefined' || !isPane || parent === window) return;
  parent.postMessage({ type: 'pane-repair-key', pane: paneId, repair: heldRepair }, '*');
}

function setRemoteRepairKey(key) {
  heldRepairRemote = key || null;
  if (typeof refreshRepairIcon === 'function') refreshRepairIcon();
}

function initRepairKeys() {
  const feed = e => { if (/^(Shift|Alt|Control|Meta)$/.test(e.key)) _repairSetHeld(repairFromKeys(e)); };
  document.addEventListener('keydown', feed);
  document.addEventListener('keyup', feed);
  // A key released in another window never reaches this one.
  window.addEventListener('blur', () => _repairSetHeld(null));
}

// The tag by the pointer: the repair in force, in its colour, so a held key is never a surprise.
function drawRepairTag(screenX, screenY) {
  if (screenX == null || isPlayer || worldMapOpen || gridCalArmed) return;
  if (HAND_SHAPES.indexOf(shape) < 0 && !presetArmed && shape !== 'cut') return;
  const op = activePolygon && activePolygon.cut ? 'split' : repairShown();
  if (!op) return;
  const key = heldRepair || (activePolygon && activePolygon.cut) ? '' : '  ·  ' + t(REPAIR_KEYS[op]);
  const c = cursorCtx;
  c.save();
  c.font = '600 12px system-ui, -apple-system, sans-serif';
  const txt = t(REPAIR_NAMES[op]) + key, w = c.measureText(txt).width + 16;
  const x = screenX + 16, y = screenY + 14;
  c.fillStyle = 'rgba(30,30,34,0.95)';
  c.strokeStyle = `rgb(${REPAIR_RGB[op]})`;
  c.lineWidth = 1;
  c.beginPath(); c.roundRect(x, y, w, 22, 5); c.fill(); c.stroke();
  c.fillStyle = `rgb(${REPAIR_RGB[op]})`;
  c.textBaseline = 'middle';
  c.fillText(txt, x + 8, y + 11.5);
  c.restore();
}
