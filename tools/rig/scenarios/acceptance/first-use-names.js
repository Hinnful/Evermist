'use strict';

// first-use-names.js — ONE NAME PER CONCEPT: the strings that changed so the same thing is called the same on every screen.
// Covers src/player/tvControl.js, src/ui/toolbar.js (revealAllMap), hints.js, index.html (the Help sheet and Settings)
// and src/world/worldBackup.js. Item 7 of the first-use-cues spec. Strings only: no control moved.
//
//   A. The minimap's push button reads "Match the TV to my view", never "Push this view to the Player".
//   B. The Help sheet reads "Brush, in Fog" and "Send, in Manual", never "Brush, in Rooms" or "Send, with Sync off".
//   C. Reveal all in Auto asks "Updates are Auto, so the players see every room at once.", and the Rooms hint that follows
//      says "Draw a room with the Room button, then use its clouds to reveal just that room."
//   D. Settings reads "Fog in a half room", "Back up everything" and "Import a backup", never "Half shroud" or "Export everything".
//   E. No visible text or tooltip in the DM window still says "Sync" for Auto and Manual.
//   (The "Merge, cut out or split rooms" hint title is checked in hints-first-use.js.)
//
// ⚠ BY EYE: that the Bestiary's own Import and Export keep their words.

const lib = require('../../lib');

module.exports = async function firstUseNames(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: 1600, h: 1000 });
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');
  await dm.evaluate('localStorage.setItem("evermist.hintsSeen", \'["reveal","show-on-tv"]\'); hintClose(); 0');
  await rig.player();
  await lib.settle(dm, '_tvLive()', 15000);

  // A. RED BY DESIGN: written against the fix, never re-proved
  // The minimap redraws on its one-second tick, so the live buttons are waited for, not the first tools.
  await lib.settle(dm, '[...document.querySelectorAll("#tv-ui button")].some(b => b.title === "Match the TV to my view")', 8000);
  const tips = await dm.evaluate('[...document.querySelectorAll("#tv-ui button")].map(b => b.title)');
  rig.check(tips.includes('Match the TV to my view') && !tips.some(t => /Push this view/.test(t)),
            'the minimap\'s push button does not read "Match the TV to my view": ' + JSON.stringify(tips));

  // B. RED BY DESIGN: written against the fix, never re-proved
  const rows = await dm.evaluate('[...document.querySelectorAll("#shortcut-legend .lg-row")].map(r => r.firstChild.textContent.trim())');
  rig.check(rows.includes('Brush, in Fog') && rows.includes('Send, in Manual') && !rows.includes('Brush, in Rooms') && !rows.includes('Send, with Sync off'),
            'the Help sheet does not read "Brush, in Fog" and "Send, in Manual": ' + JSON.stringify(rows));

  // C. RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('autoSync = true; setPlaceMode("rooms"); setShape("select"); document.getElementById("tb-reveal-all").click(); 0');
  await lib.settle(dm, 'document.getElementById("cd-msg") && document.getElementById("cd-msg").textContent.length > 0', 8000);
  const ask = await dm.evaluate('document.getElementById("cd-msg").textContent');
  rig.check(ask === 'Updates are Auto, so the players see every room at once.', 'Reveal all in Auto asks the wrong thing: ' + ask);
  await dm.evaluate('document.getElementById("cd-cancel").click(); 0');
  await lib.settle(dm, '!!document.querySelector(".hintcall-rooms")', 8000);
  const rooms = await dm.evaluate('(() => { const h = document.querySelector(".hintcall-rooms"); return h ? h.textContent : null; })()');
  rig.check(rooms && /Draw a room with the Room button, then use its clouds to reveal just that room\./.test(rooms), 'the Rooms hint does not say the Room button: ' + rooms);

  // D. RED BY DESIGN: written against the fix, never re-proved
  const settings = await dm.evaluate('document.getElementById("dock-pane-settings").textContent.replace(/\\s+/g, " ")');
  rig.check(/Fog in a half room/.test(settings) && /Back up everything/.test(settings) && /Import a backup/.test(settings) &&
            !/Half shroud/.test(settings) && !/Export everything/.test(settings),
            'Settings does not read "Fog in a half room", "Back up everything" and "Import a backup": ' + settings.slice(0, 400));

  // E. RED BY DESIGN: written against the fix, never re-proved
  const synced = await dm.evaluate(`(() => [...document.querySelectorAll('*')].filter(e => e.getClientRects().length &&
    ((e.children.length === 0 && /\\bsync\\b/i.test(e.textContent || '')) || /\\bsync\\b/i.test(e.getAttribute('title') || '')))
    .map(e => (e.getAttribute('title') || e.textContent).trim()))()`);
  rig.check(synced.length === 0, 'visible text or a tooltip still says Sync: ' + JSON.stringify(synced));
  rig.byEye('the Bestiary\'s own Import and Export keep their words, and the renamed strings read well in Russian');
};
