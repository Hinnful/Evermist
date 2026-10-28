'use strict';
// mcpHistory.js — Claude's own undo. Every change it makes records how to put things back before it
// returns; undo_last_change reverts the newest step. In memory, the last 30 steps, gone on a restart.

const _mcpSteps = [];

// One step recorded, and the undo toast naming it. `undo` is async and puts back what the call changed.
function mcpRecord(label, undo) {
  mcpHistoryPush(_mcpSteps, { label, undo });
  showUndoToast('Claude: ' + label, mcpUndoLast);
}

// A change made: its step recorded, then the reply that says how to take it back.
function mcpDone(label, undo, text) {
  mcpRecord(label, undo);
  return _mcpOk(text + ' To take it back, call undo_last_change.');
}

async function mcpUndoLast() {
  const step = _mcpSteps.pop();
  if (!step) { noticeToast('Nothing from Claude to undo'); return null; }
  try { await step.undo(); } catch (err) {
    // A refusal that changed nothing (mcpMapEdit.js) leaves the step to try again.
    if (err && err.mcpKeep) _mcpSteps.push(step);
    noticeToast('Could not undo: ' + step.label);
    throw err;
  }
  hideUndoToast();
  noticeToast('Undone: ' + step.label);
  return step.label;
}

async function _mcpUndoTool() {
  try {
    const label = await mcpUndoLast();
    return label ? _mcpOk('Undone: ' + label + '.') : _mcpNo('Claude has made no change to undo.');
  } catch (err) { return _mcpNo('Evermist could not undo that: ' + ((err && err.message) || err)); }
}
