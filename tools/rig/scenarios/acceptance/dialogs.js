'use strict';

// dialogs.js — THE APP'S ONLY QUESTION AND ITS ONLY STATEMENT.
//
// THE GOAL OF THIS FEATURE: every question the app asks and every error it reports arrives in one
// in-page dialog. A native confirm() or alert() is a separate OS window, and closing one leaves
// the page's focus desynced beyond any in-page repair, so neither ever ships. Every check below
// serves that sentence.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks directly beneath it, in order.
//
//   A. A question puts up two buttons and answers exactly once — on the button that was pressed
//      and never on the other.
//   B. A question focuses Cancel, so a reflex Enter changes nothing. A statement focuses its one
//      button, where there is nothing to decline.
//   C. A statement has one button, and EVERY way out runs onClose: the button, Escape, and a
//      click beside it. An error the DM dismisses by habit must not leave its caller waiting.
//   D. Two dialogs asked for at once do not overwrite one another. The second waits its turn and
//      both callers get their answer.
//   E. A dangerous action colours the button that does it; a plain question does not.
//
// ⚠ THESE ARE DRIVEN THROUGH confirmDialog AND messageDialog THEMSELVES, not through a caller
// that happens to raise one. Nineteen call sites across nine modules hand this their errors, and
// what is tested here is the one thing all nineteen depend on.
//
// ⚠ THE ANSWER IS ASYNCHRONOUS. Both functions return at once and the answer lands in onConfirm,
// onCancel or onClose, so every check reads a record the callback wrote — never the return value,
// which is always undefined and would make every check pass.
//
// ⚠ ESCAPE IS DISPATCHED AT THE DIALOG'S OWN ROOT, not at the document. Its handler stops the
// event so a keystroke cannot reach the map shortcuts underneath, which means a keydown fired at
// the document never reaches it and the check would read the dialog as ignoring Escape.

const HELPERS = `
globalThis.__rigAnswers = [];
globalThis.__rigDlg = () => {
  const root = document.getElementById('cd-anchor');
  const ok = document.getElementById('cd-ok'), cancel = document.getElementById('cd-cancel');
  const up = !!(root && root.style.display === 'flex');
  return {
    up: up,
    solo: !!(root && root.classList.contains('cd-solo')),
    title: (document.getElementById('cd-title') || {}).textContent || '',
    msg: (document.getElementById('cd-msg') || {}).textContent || '',
    okText: ok ? ok.textContent : null,
    okClass: ok ? ok.className : null,
    cancelShown: !!cancel && cancel.getClientRects().length > 0,
    focused: document.activeElement ? document.activeElement.id : null,
  };
};
// ⚠ THE RECORDERS GO ON LAST. Spread the caller's options over them and an o carrying its own
// onConfirm would silently replace the recording, leaving __rigAnswers empty — and the check
// would then report a dialog that never answered, which is not what happened.
globalThis.__rigAsk = (o) => {
  confirmDialog(Object.assign({}, o, {
    onConfirm: () => __rigAnswers.push((o.tag || 'q') + ':yes'),
    onCancel:  () => __rigAnswers.push((o.tag || 'q') + ':no'),
  }));
  return 0;
};
globalThis.__rigTell = (o) => {
  messageDialog(Object.assign({}, o, {
    onClose: () => __rigAnswers.push((o.tag || 'm') + ':closed'),
  }));
  return 0;
};
globalThis.__rigPress = (id) => { document.getElementById(id).click(); return 0; };
// ⚠ At the dialog's own root. Its keydown handler calls stopPropagation, so nothing fired at the
// document ever arrives here.
globalThis.__rigEsc = () => {
  document.getElementById('cd-anchor').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  return 0;
};
0`;

module.exports = async function dialogsFeature(rig) {
  const dm = rig.dm;
  await dm.evaluate(HELPERS);

  const state = () => dm.evaluate('__rigDlg()');
  const answers = () => dm.evaluate('__rigAnswers.slice()');
  const clear = () => dm.evaluate('__rigAnswers = []; 0');

  // ── A. A question answers once, on the button that was pressed ────────────
  await dm.evaluate('__rigAsk({ tag: "a", title: "Delete it?", message: "This cannot be undone." })');
  const asked = await state();
  rig.check(asked.up, 'confirmDialog did not put anything on screen');
  rig.check(asked.cancelShown,
            'the question came up without a Cancel button, so it cannot be answered no');
  rig.check(asked.title === 'Delete it?' && asked.msg === 'This cannot be undone.',
            'the question is not showing the words it was given: ' + JSON.stringify(asked));

  await dm.evaluate('__rigPress("cd-cancel")');
  rig.check(JSON.stringify(await answers()) === JSON.stringify(['a:no']),
            'Cancel did not answer the question exactly once with no: ' +
            JSON.stringify(await answers()));
  rig.check(!(await state()).up, 'the question stayed on screen after it was answered');

  await clear();
  await dm.evaluate('__rigAsk({ tag: "b", title: "Go on?" })');
  await dm.evaluate('__rigPress("cd-ok")');
  rig.check(JSON.stringify(await answers()) === JSON.stringify(['b:yes']),
            'OK did not answer the question exactly once with yes: ' + JSON.stringify(await answers()));

  // ── B. Which button holds focus ───────────────────────────────────────────
  await clear();
  await dm.evaluate('__rigAsk({ tag: "c", title: "Sure?" })');
  rig.check((await state()).focused === 'cd-cancel',
            'the question does not focus Cancel, so a reflex Enter answers yes to something ' +
            'destructive: focus is on ' + (await state()).focused);
  await dm.evaluate('__rigPress("cd-cancel")');

  await clear();
  await dm.evaluate('__rigTell({ tag: "d", title: "Could not read that file" })');
  rig.check((await state()).focused === 'cd-ok',
            'the statement does not focus its only button: focus is on ' + (await state()).focused);

  // ── C. One button, and every way out runs onClose ─────────────────────────
  const told = await state();
  rig.check(told.solo,
            'the statement is wearing the question\'s two-button layout: ' + JSON.stringify(told));
  rig.check(!told.cancelShown,
            'the statement is showing a Cancel button, which offers a choice it does not have');

  await dm.evaluate('__rigPress("cd-ok")');
  rig.check(JSON.stringify(await answers()) === JSON.stringify(['d:closed']),
            'the statement\'s button did not run onClose: ' + JSON.stringify(await answers()));

  await clear();
  await dm.evaluate('__rigTell({ tag: "e", title: "Something else" })');
  await dm.evaluate('__rigEsc()');
  rig.check(!(await state()).up, 'Escape did not dismiss the statement');
  rig.check(JSON.stringify(await answers()) === JSON.stringify(['e:closed']),
            'Escape dismissed the statement without running onClose, so its caller waits for an ' +
            'answer that can never arrive: ' + JSON.stringify(await answers()));

  await clear();
  await dm.evaluate('__rigTell({ tag: "f", title: "And another" })');
  await dm.evaluate('__rigPress("cd-backdrop")');
  rig.check(!(await state()).up, 'a click beside the statement did not dismiss it');
  rig.check(JSON.stringify(await answers()) === JSON.stringify(['f:closed']),
            'a click beside the statement dismissed it without running onClose: ' +
            JSON.stringify(await answers()));

  // ── D. Two at once, and neither is dropped ────────────────────────────────
  await clear();
  await dm.evaluate('__rigAsk({ tag: "first", title: "First question" });' +
                    ' __rigAsk({ tag: "second", title: "Second question" }); 0');
  const firstUp = await state();
  rig.check(firstUp.up && firstUp.title === 'First question',
            'the second question painted over the first: ' + JSON.stringify(firstUp));

  await dm.evaluate('__rigPress("cd-ok")');
  const secondUp = await state();
  rig.check(secondUp.up && secondUp.title === 'Second question',
            'the second question never came up after the first was answered, so its caller is ' +
            'left waiting forever: ' + JSON.stringify(secondUp));
  await dm.evaluate('__rigPress("cd-cancel")');
  rig.check(JSON.stringify(await answers()) === JSON.stringify(['first:yes', 'second:no']),
            'two questions asked at once did not both get their own answer: ' +
            JSON.stringify(await answers()));
  rig.check(!(await state()).up, 'the queue left a dialog on screen with nothing behind it');

  // ── E. The dangerous button is coloured, the plain one is not ─────────────
  await clear();
  await dm.evaluate('__rigAsk({ tag: "g", title: "Delete the scene?", danger: true })');
  const danger = await state();
  await dm.evaluate('__rigPress("cd-cancel")');
  await dm.evaluate('__rigAsk({ tag: "h", title: "Import it?" })');
  const plain = await state();
  await dm.evaluate('__rigPress("cd-cancel")');
  rig.note('confirm button classes — danger "' + danger.okClass + '", plain "' + plain.okClass + '"');
  rig.check(/cp-btn-danger/.test(danger.okClass || ''),
            'a destructive answer is not coloured as one, so the DM presses it the same way they ' +
            'press every other OK: ' + danger.okClass);
  rig.check(!/cp-btn-danger/.test(plain.okClass || ''),
            'an ordinary question colours its OK as destructive, which makes the colour mean ' +
            'nothing where it matters: ' + plain.okClass);
};
