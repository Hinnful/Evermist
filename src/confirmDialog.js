'use strict';

// confirmDialog.js — the app's own yes/no. A native confirm() leaves the page's focus
// desynced from the field that had it, and nothing in the page can repair it, so it is
// banned outright. Full rule in CLAUDE.md ("Dialogs"), the bug in docs/DECISIONS.md.
// Shape is the app's floating-panel pattern; see overlays.css.

let _cdRoot = null, _cdOnConfirm = null, _cdOnCancel = null;

// ONE DIALOG AT A TIME, AND NONE IS DROPPED. Both entry points below used to write straight
// over _cdOnConfirm/_cdOnCancel, so a second dialog raised while one was up left the first
// caller waiting for an answer that could never arrive — a restore asking whether to adopt
// the backup's module text simply never heard back. The extra one now waits its turn.
let _cdOpen = false;
const _cdQueue = [];

// Show now, or line up behind whatever is on screen.
function _cdRequest(kind, o) {
  if (_cdOpen) { _cdQueue.push({ kind: kind, o: o }); return; }
  _cdShow(kind, o);
}

function _cdDrain() {
  const next = _cdQueue.shift();
  if (next) _cdShow(next.kind, next.o);
}

function _cdShow(kind, o) {
  _cdOpen = true;
  if (kind === 'message') _cdShowMessage(o); else _cdShowConfirm(o);
}

function _cdEl(id) { return document.getElementById(id); }

// ANSWERS ASYNCHRONOUSLY — the one thing callers must design around. This returns
// immediately; the answer arrives in onConfirm/onCancel. Code that used to write on
// `if (confirm(...))` has to split into "what happens regardless" and "what happens on
// yes". See applyModuleEntryToRoom.
//
// opts: { title, message, confirmLabel, cancelLabel, danger, onConfirm, onCancel }
function confirmDialog(opts) { _cdRequest('confirm', opts || {}); }

function _cdShowConfirm(o) {
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

  _cdRoot.classList.remove('cd-solo');
  _cdRoot.style.display = 'flex';
  // CANCEL takes focus, not confirm. Enter is the reflex key for dismissing things, so
  // the reflex answer must be the one that changes nothing.
  _cdEl('cd-cancel').focus();
}

// A statement, not a question: one button, no danger colouring. Errors come through here,
// because a native alert() breaks focus exactly the way a native confirm() does. Escape and
// the backdrop dismiss it too, so every exit runs onClose.
//
// opts: { title, message, buttonLabel, onClose }
function messageDialog(opts) { _cdRequest('message', opts || {}); }

function _cdShowMessage(o) {
  _cdBuild();
  _cdEl('cd-title').textContent = o.title   || 'Something went wrong';
  _cdEl('cd-msg').textContent   = o.message || '';
  _cdEl('cd-ok').textContent    = o.buttonLabel || 'OK';
  _cdEl('cd-ok').className      = 'cp-btn cp-btn-outline';
  // Both slots hold the same handler: with nothing to decline, every way out is the same way out.
  const fn = typeof o.onClose === 'function' ? o.onClose : null;
  _cdOnConfirm = _cdOnCancel = fn;

  _cdRoot.classList.add('cd-solo');
  _cdRoot.style.display = 'flex';
  // The only button takes focus. Cancel's reasoning — reflex Enter must change nothing —
  // has nothing to guard against here.
  _cdEl('cd-ok').focus();
}

function _cdClose(confirmed) {
  if (!_cdRoot) return;
  _cdRoot.style.display = 'none';
  _cdOpen = false;
  const fn = confirmed ? _cdOnConfirm : _cdOnCancel;
  _cdOnConfirm = _cdOnCancel = null;
  // Focus is deliberately NOT restored: putting it back would reopen the module-text
  // dropdown on top of the answer the DM just gave.
  if (fn) fn();
  // The answer runs FIRST, and it may raise its own dialog — an adopt that fails reports
  // it. That one is already on screen by now, so only hand over to the queue when nothing
  // took the slot; its own close drains the rest.
  if (!_cdOpen) _cdDrain();
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
  module.exports = { confirmDialog, messageDialog };
}
