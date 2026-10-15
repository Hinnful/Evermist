'use strict';
// repairBar.js — the repair icon, last in the options row of every shape. At rest it is two overlapping
// squares; it turns into the glyph and colour of the repair a held key (repairKeys.js) or an armed
// repair puts in force. Its list, "Change the rooms it touches", arms Merge, Cut out or Split for whoever
// does not know the keys, and an armed repair stays armed until its lit icon is clicked. The hidden
// Merge, Cut out and Split buttons stay in the page as the back end.

const REPAIR_ROWS = [['join', 'btn-op-join'], ['trim', 'btn-op-trim'], ['split', 'btn-cut']];

function initRepairBar() {
  refreshRepairIcon();
}

// What is lit: a key down here or in a column, an armed repair, or the open-line Split tool.
function _repairLit() { return repairShown(); }

function refreshRepairIcon() {
  const box = document.getElementById('op-sw');
  if (!box) return;
  const op = _repairLit();
  const held = !!(heldRepair || heldRepairRemote);
  const glyph = op ? document.getElementById(REPAIR_ROWS.find(r => r[0] === op)[1]).querySelector('svg').outerHTML : uiIcon('repair', 17, 1.5);
  const tip = !op ? t('Merge, Cut out, Split - or hold Shift, Alt or Ctrl while you draw')
    : held ? t(REPAIR_NAMES[op]) + ' (' + t(REPAIR_KEYS[op]) + ')'
    : t(REPAIR_NAMES[op]) + ' (' + t(REPAIR_KEYS[op]) + ') - ' + t('click to stop');
  if (box.dataset.state !== (op || '') + (held ? '+' : '')) {
    box.dataset.state = (op || '') + (held ? '+' : '');
    box.innerHTML = '<span class="op-wrap' + (op ? ' op-' + op : '') + '">' +
      '<button type="button" class="op-ic" title="' + tip + '">' + glyph + '</button>' +
      '<button type="button" class="op-chev" title="' + t('Merge, Cut out or Split') + '">' + uiIcon('chev', 8, 2.2) + '</button></span>';
    box.querySelector('.op-ic').onclick = _repairIconClick;
    box.querySelector('.op-chev').onclick = _repairChevClick;
  }
  refreshFogBar();   // the clouds grey while a repair is lit
}

// The icon is the repair: lit, it puts the repair down; at rest it opens the list. The chevron always
// opens the list, so choosing another repair never cancels the one in force.
function _repairIconClick(e) {
  e.stopPropagation();
  if (_tbOpen === 'repair') { _tbCloseList(); return; }
  if (!(heldRepair || heldRepairRemote) && (shapeOp !== 'new' || shape === 'cut')) {
    if (shape === 'cut') setShape(modeShape(placeMode));
    if (shapeOp !== 'new') setShapeOp('new');
    return;
  }
  _repairOpenList(document.querySelector('#op-sw .op-chev'));
}

function _repairChevClick(e) {
  e.stopPropagation();
  if (_tbOpen === 'repair') { _tbCloseList(); return; }
  _repairOpenList(e.currentTarget);
}

function _repairOpenList(btn) {
  const none = !repairsAvailable();
  const rows = ['Change the rooms it touches'].concat(REPAIR_ROWS.map(([op, id]) =>
    [op, t(REPAIR_NAMES[op]), none ? t('Needs a room') : t(REPAIR_KEYS[op]), none, document.getElementById(id).querySelector('svg').outerHTML]));
  openBarList('repair', document.querySelector('#op-sw .op-wrap'), btn, rows, _repairLit(), _repairArm);
}

// Armed from the list, a repair draws with the shape in hand; Split with the Polygon is the open line.
function _repairArm(op) {
  if (shape === 'cut') setShape('poly');
  setShapeOp(op);
}
