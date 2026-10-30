'use strict';

// storage-full.js — A FULL BROWSER STORE IS SAID OUT LOUD, AND NOTHING THE DM TYPED IS LOST.
//
// THE GOAL OF THIS FEATURE: when saving campaign data fails, the DM is told what was not saved,
// once; the text stays in the field and in memory, and the next save writes it.
//
// THE CRITERIA ARE THIS HEADER. Each check sits under its letter.
//
//   A. A failed save of the campaign notes puts up one dialog naming what was not saved.
//   B. The typed text is still in the field and still read back after the dialog.
//   C. A second failed save of the same kind in the same launch shows no second dialog.
//   D. Once the store takes writes again, the next save lands the text.
//   E. A failed save of the places does the same, as a kind of its own.
//
// ⚠ THE FAILURE IS A STUB ON Storage.prototype.setItem FOR ONE KEY, the one thing in the page that
// can make a write throw; the real quota is about 50M characters and not worth filling.

const lib = require('../../lib');

const NOTES_KEY = 'evermist.campaignNotes';
const PLACES_KEY = 'evermist.placeShapes';

module.exports = async function storageFull(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: 2400, h: 1500 });

  await dm.evaluate('document.getElementById("dock-tab-notes").click(); 0');
  await lib.settle(dm, 'nwIsOpen()', 6000);
  await dm.evaluate('document.querySelector("#nw-tl .nw-row[data-key=campaign]").click(); 0');

  // ⚠ The commit is on the field's own blur listener, and el.blur() does not reliably fire one in an
  // unfocused window, so the events go at the listeners directly.
  const typeInto = value => dm.evaluate(`(() => {
    const el = document.getElementById('np-field');
    el.dispatchEvent(new FocusEvent('focus'));
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur'));
    return 0;
  })()`);
  const stub = key => dm.evaluate(`(() => {
    globalThis.__rigRealSet = globalThis.__rigRealSet || Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === ${JSON.stringify(key)}) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return globalThis.__rigRealSet.call(this, k, v);
    };
    return 0;
  })()`);
  const unstub = () => dm.evaluate('Storage.prototype.setItem = globalThis.__rigRealSet; 0');
  const dialog = () => dm.evaluate(`(() => {
    const root = document.getElementById('cd-anchor');
    return { up: !!root && root.style.display === 'flex',
      title: (document.getElementById('cd-title') || {}).textContent || '',
      msg: (document.getElementById('cd-msg') || {}).textContent || '' };
  })()`);
  const dismiss = async () => {
    await dm.evaluate('document.getElementById("cd-ok").click(); 0');
    await lib.settle(dm, 'document.getElementById("cd-anchor").style.display !== "flex"', 4000);
  };
  const field = () => dm.evaluate('document.getElementById("np-field").value');
  const stored = key => dm.evaluate(`localStorage.getItem(${JSON.stringify(key)})`);

  // ── A. One dialog naming what was not saved ───────────────────────────────
  // RED ON: messageDialog() removed from notesSaveFailed (notesPanel.js) — 2026-10-30
  await stub(NOTES_KEY);
  await typeInto('The crypt is below the vestry.');
  const first = await dialog();
  rig.check(first.up, 'a failed save of the campaign notes put up no dialog');
  rig.check(/campaign notes/i.test(first.title), 'the dialog does not name the campaign notes: ' + JSON.stringify(first));
  rig.check(/quota/i.test(first.msg), 'the dialog does not carry the browser\'s reason: ' + JSON.stringify(first));
  await dismiss();

  // ── B. The text survives ──────────────────────────────────────────────────
  // RED ON: _npPending.campaign = text removed from notesCampaignSet (notesPanel.js) — 2026-10-30
  rig.check(await field() === 'The crypt is below the vestry.', 'the typed text left the field after the failed save');
  await dm.evaluate('refreshRoomPanel(); 0');
  rig.check(await field() === 'The crypt is below the vestry.', 'a repaint replaced the unsaved text with the stored one');
  rig.check(await dm.evaluate('notesCampaignGet()') === 'The crypt is below the vestry.', 'the unsaved text is not held in memory');
  rig.check(await stored(NOTES_KEY) === null, 'the stub did not stop the write, so this check proves nothing');

  // ── C. Not twice ──────────────────────────────────────────────────────────
  // RED ON: notesSaveReportDue() always answering true (notesPlan.js) — 2026-10-30
  await typeInto('The crypt is below the vestry. It floods.');
  rig.check(!(await dialog()).up, 'a second failed save of the same kind put up a second dialog');

  // ── D. The next save lands ────────────────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  await unstub();
  await typeInto('The crypt is below the vestry. It floods at night.');
  rig.check(await stored(NOTES_KEY) === 'The crypt is below the vestry. It floods at night.',
            'the next save did not write the text: ' + await stored(NOTES_KEY));
  rig.check(!(await dialog()).up, 'a save that worked put up a dialog');

  // ── E. Places are a kind of their own ─────────────────────────────────────
  // RED ON: messageDialog() removed from notesSaveFailed (notesPanel.js) — 2026-10-30
  await stub(PLACES_KEY);
  await dm.evaluate('worldPlacesSave(); 0');
  const places = await dialog();
  rig.check(places.up && /places/i.test(places.title), 'a failed save of the places did not say so: ' + JSON.stringify(places));
  await dismiss();
  await unstub();
};

