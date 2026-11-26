'use strict';
// mcpHistory.js — Claude's own undo. Every change it makes records how to put things back before it
// returns; undo_last_change reverts the newest step. In memory, the last 30 steps, gone on a restart.

const _mcpSteps = [];

// One step recorded, and the undo toast naming it. `undo` is async and puts back what the call changed; `undone`
// is what the undo's toast and reply add, as where a removed map went.
function mcpRecord(label, undo, undone) {
  mcpHistoryPush(_mcpSteps, { label, undo, undone });
  // ⚠ NOT OVER THE DM'S OWN MAP DELETE: its toast's Undo is the only way back for that map.
  // The toast's Undo has said why it failed; the rejection is for undo_last_change's reply.
  if (!smPending) showUndoToast('Claude: ' + label, () => mcpUndoLast().catch(() => {}));
}

// A change made: its step recorded, then the reply that says how to take it back.
function mcpDone(label, undo, text, undone) {
  mcpRecord(label, undo, undone);
  return _mcpOk(text + ' To take it back, call undo_last_change.');
}

async function mcpUndoLast() {
  // What the DM is still typing counts as a change since Claude's step.
  notesPanelFlush();
  const step = _mcpSteps.pop();
  if (!step) { noticeToast('Nothing from Claude to undo'); return null; }
  try { await step.undo(); } catch (err) {
    // A refusal that changed nothing (mcpMapEdit.js) leaves the step to try again.
    if (err && err.mcpKeep) _mcpSteps.push(step);
    noticeToast(err && err.mcpKeep ? err.message : 'Could not undo: ' + step.label);
    throw err;
  }
  if (!smPending) hideUndoToast();
  const said = step.label + (step.undone ? '. ' + step.undone : '');
  noticeToast('Undone: ' + said);
  return said;
}

// A call while an undo still runs is a retry of it, never the step before.
let _mcpUndoing = false;
async function _mcpUndoTool() {
  if (_mcpUndoing) return _mcpNo('Evermist is still undoing the last change. Wait for it, then read what changed before undoing again.');
  _mcpUndoing = true;
  try {
    const label = await mcpUndoLast();
    return label ? _mcpOk('Undone: ' + label + '.') : _mcpNo('Claude has made no change to undo.');
  } catch (err) { return _mcpNo('Evermist could not undo that: ' + ((err && err.message) || err)); }
  finally { _mcpUndoing = false; }
}
