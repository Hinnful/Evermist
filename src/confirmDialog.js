'use strict';

// confirmDialog.js — the app's own yes/no. A native confirm() leaves the page's focus
// desynced from the field that had it, and nothing in the page can repair it, so it is
// banned outright. Full rule in CLAUDE.md ("Dialogs"), the bug in docs/DECISIONS.md.
// Shape is the app's floating-panel pattern; see overlays.css.

let _cdRoot = null, _cdOnConfirm = null, _cdOnCancel = null;

function _cdEl(id) { return document.getElementById(id); }

// ANSWERS ASYNCHRONOUSLY — the one thing callers must design around. This returns
// immediately; the answer arrives in onConfirm/onCancel. Code that used to write on
// `if (confirm(...))` has to split into "what happens regardless" and "what happens on
// yes". See applyModuleEntryToRoom.
//
// opts: { title, message, confirmLabel, cancelLabel, danger, onConfirm, onCancel }
function confirmDialog(opts) {
  const o = opts || {};
  _cdBuild();
  _cdEl('cd-title').textContent   = o.title   || 'Are you sure?';
  _cdEl('cd-msg').textContent     = o.message || '';
  _cdEl('cd-ok').textContent      = o.confirmLabel || 'OK';
  _cdEl('cd-cancel').textContent  = o.cancelLabel  || 'Cancel';
  // Danger is about the ACTION, not the dialog: a question is not destructive, the
  // button that answers it yes might be.
  _cdEl('cd-ok').className = 'cp-btn ' + (o.danger ? 'cp-btn-danger' : 'cp-btn-outline');
  _cdOnConfirm = typeof o.onConfirm === 'function' ? o.onConfirm : null;
  _cdOnCancel  = typeof o.onCancel  === 'function' ? o.onCancel  : null;

  _cdRoot.style.display = 'flex';
  // CANCEL takes focus, not confirm. Enter is the reflex key for dismissing things, so
  // the reflex answer must be the one that changes nothing.
  _cdEl('cd-cancel').focus();
}

function _cdClose(confirmed) {
  if (!_cdRoot) return;
  _cdRoot.style.display = 'none';
  const fn = confirmed ? _cdOnConfirm : _cdOnCancel;
  _cdOnConfirm = _cdOnCancel = null;
  // Focus is deliberately NOT restored: putting it back would reopen the module-text
  // dropdown on top of the answer the DM just gave.
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

  // The two guards every floating panel here carries: a click must not reach the canvas
  // handlers, a keystroke must not reach the global map shortcuts.
  const modal = _cdEl('cd-modal');
  modal.addEventListener('mousedown', e => e.stopPropagation());
  root.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); _cdClose(false); }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { confirmDialog };
}
