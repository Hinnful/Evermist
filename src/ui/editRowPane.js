'use strict';
// editRowPane.js — the edit row in two-map mode. A column decides whether its row is open and reports the
// row's state up; the DM window draws #edit-row from the selected column's last report and sends each row
// click back to that column alone, which runs it with editRow.js's own code.

// ─── Column side ──────────────────────────────────────────────────────────────

let _erpSent = null;

// From the column's refreshEditRow on every repaint; a report goes up only when it changed.
function paneReportEditRow(open) {
  if (!isPane || parent === window) return;
  const row = open ? { open: true, tool: editToolNow(), many: pickedExtras().length > 0 } : { open: false };
  const key = JSON.stringify(row);
  if (key === _erpSent) return;
  _erpSent = key;
  parent.postMessage({ type: 'pane-edit-row', pane: paneId, row }, '*');
}

// A row click from the DM window. 'close' is the row going down from outside: a switch of column.
function paneApplyEditRow(m) {
  if (m.action === 'close') { if (editRowOpen()) editRowClose(); return; }
  if (!editRowOpen()) return;
  if (m.action === 'key') {
    document.dispatchEvent(new KeyboardEvent('keydown', { code: m.code, key: /Enter$/.test(m.code) ? 'Enter' : m.code,
      shiftKey: !!m.shift, bubbles: true, cancelable: true }));
  } else if (m.action === 'tool') _erPickTool(m.tool);
  else if (m.action === 'done') editRowClose();
  else if (m.action === 'op' && m.op === 'split') { if (splitPickedArm()) reportPaneTool(); }
  else if (m.action === 'op') booleanOnPicked(m.op);
}

// ─── DM window side ──────────────────────────────────────────────────────────

const _erpRows = { A: null, B: null };

function paneEditRowReported(id, row) {
  _erpRows[id] = row && row.open ? row : null;
  if (id === panesSelected) refreshEditRow();
}

// The selected column's row, as it last reported it. Null in single-map mode or with its row down.
function paneEditRow() {
  return panesActive && !isPane ? _erpRows[panesSelected] : null;
}

// Two maps left, or a column given another map: its row goes until it reports again.
function paneEditRowForget(id) {
  if (id) _erpRows[id] = null; else _erpRows.A = _erpRows.B = null;
  refreshEditRow();
}

// The selected column changed: the one it left closes its row, so an unselected column never holds one.
function paneEditRowLeave(id) {
  _erpRows[id] = null;
  sendToPane({ type: 'pane-edit-row', action: 'close' }, id);
  refreshEditRow();
}

// A row click or key in the DM window goes to the selected column, and the keys go back there with it.
// True when it went, so the caller skips its own.
function paneEditRowSend(action, payload) {
  if (!panesActive || isPane) return false;
  paneForward('edit-row', { ...(payload || {}), action });
  const f = panes[panesSelected].frame;
  if (f && f.contentWindow) f.contentWindow.focus();
  return true;
}

// Esc, Enter, Delete and Backspace pressed in the DM window while the selected column's edit is open: the column
// would have taken them had it held the focus. A focused button keeps its Enter.
function paneEditRowKey(e) {
  if (!paneEditRow() || !/^(Escape|Enter|NumpadEnter|Delete|Backspace)$/.test(e.code) || e.altKey || e.ctrlKey || e.metaKey) return false;
  const tg = e.target;
  if (/Enter$/.test(e.code) && tg && tg.matches && tg.matches('button, select, a[href], [role="button"]')) return false;
  return paneEditRowSend('key', { code: e.code, shift: e.shiftKey });
}
