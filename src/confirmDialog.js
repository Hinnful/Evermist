'use strict';

// ─── confirmDialog.js — the app's own yes/no, because the native one breaks the page ─────────
//
// WHY THIS EXISTS, and why `confirm()` must not come back.
//
// A native confirm() is a separate OS window. Raising one leaves the page in a broken input
// state that survives the dialog: the text field that was focused stays the document's
// activeElement, but the frame's own focus is desynced from it, so clicking that field places
// no caret and fires no `focus` event — which also means the module-text dropdown never
// reopens. The field looks dead while still being focused, so Ctrl+A and a drag-select still
// work on it and the description beside it goes the same way. Reported from the real app:
// pick a module entry, pick a different one, answer the "replace description?" question, and
// the room card's two fields are unusable until something else takes focus.
//
// Moving the call off `mousedown` and onto `click` was tried first and is NOT enough — it
// fixes the lost-mouseup half of the problem and leaves this half untouched. Nothing inside
// the page can repair the state either. So the dialog has to stop being native.
//
// Everything here is ordinary DOM inside the same document, so focus behaves the way it does
// anywhere else in the app.
//
// The shape is the app's floating-panel pattern (flat #1a1a1c, hairline border, cp-adv-head +
// cp-adv-body, stock .cp-btn), the same one the module-text import panel uses — see
// overlays.css. Built here rather than in index.html because a dialog with no fixed content
// is this module's UI, not part of the page.

let _cdRoot = null, _cdOnConfirm = null, _cdOnCancel = null;

function _cdEl(id) { return document.getElementById(id); }

// ANSWERING IS ASYNCHRONOUS, which is the one thing a caller has to design around: this
// returns immediately and the answer arrives in onConfirm/onCancel. A caller that used to
// write on `if (confirm(...))` has to split into "what happens regardless" and "what happens
// on yes" — see applyModuleEntryToRoom, which writes the name up front and defers only the
// description.
//
// opts: { title, message, confirmLabel, cancelLabel, danger, onConfirm, onCancel }
function confirmDialog(opts) {
  const o = opts || {};
  _cdBuild();
  _cdEl('cd-title').textContent   = o.title   || 'Are you sure?';
  _cdEl('cd-msg').textContent     = o.message || '';
  _cdEl('cd-ok').textContent      = o.confirmLabel || 'OK';
  _cdEl('cd-cancel').textContent  = o.cancelLabel  || 'Cancel';
  // Danger colouring is the caller's call, and it is about the ACTION, not about the dialog:
  // a question is not destructive, the button that answers it yes might be.
  _cdEl('cd-ok').className = 'cp-btn ' + (o.danger ? 'cp-btn-danger' : 'cp-btn-outline');
  _cdOnConfirm = typeof o.onConfirm === 'function' ? o.onConfirm : null;
  _cdOnCancel  = typeof o.onCancel  === 'function' ? o.onCancel  : null;

  _cdRoot.style.display = 'flex';
  // CANCEL takes focus, not the confirm button. Enter is the key a DM leans on to dismiss
  // things, so whichever button holds focus is the one a reflex answers with — and the reflex
  // answer must be the one that changes nothing.
  _cdEl('cd-cancel').focus();
}

function _cdClose(confirmed) {
  if (!_cdRoot) return;
  _cdRoot.style.display = 'none';
  const fn = confirmed ? _cdOnConfirm : _cdOnCancel;
  _cdOnConfirm = _cdOnCancel = null;
  // Focus is deliberately NOT restored to whatever had it before. The field that raised this
  // was blurred on the way in, and putting focus back would reopen the module-text dropdown on
  // top of the answer the DM just gave.
  if (fn) fn();
}

function _cdBuild() {
  if (_cdRoot) return;
  const root = document.createElement('div');
  root.id = 'cd-anchor';
  root.style.display = 'none';
  root.innerHTML =
    '<div id="cd-backdrop"></div>' +
    '<div id="cd-modal" tabindex="-1" role="alertdialog" aria-modal="true">' +
      '<div class="cp-adv-head"><span class="cp-adv-title" id="cd-title"></span></div>' +
      '<div class="cp-adv-body"><div class="cd-msg" id="cd-msg"></div></div>' +
      '<div class="cd-foot">' +
        '<button type="button" class="cp-btn cp-btn-outline" id="cd-cancel"></button>' +
        '<button type="button" class="cp-btn cp-btn-outline" id="cd-ok"></button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(root);
  _cdRoot = root;

  _cdEl('cd-backdrop').addEventListener('click', () => _cdClose(false));
  _cdEl('cd-cancel').addEventListener('click', () => _cdClose(false));
  _cdEl('cd-ok').addEventListener('click', () => _cdClose(true));

  // The same two guards every floating panel in the app carries: a click inside must not reach
  // the canvas handlers, and a keystroke must not reach the global map shortcuts.
  const modal = _cdEl('cd-modal');
  modal.addEventListener('mousedown', e => e.stopPropagation());
  root.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); _cdClose(false); }
  });
}

// ─── Node.js export guard (unit tests only) ──────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { confirmDialog };
}
