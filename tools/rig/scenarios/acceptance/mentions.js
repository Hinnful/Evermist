'use strict';

// mentions.js — MENTIONS BETWEEN NOTES: A NOTE LINKS TO ANY OTHER ENTRY, AND EACH NOTE LISTS WHERE IT APPEARS.
//
// THE GOAL OF THIS FEATURE: any note names any room, map, group, road, monster, faction or lore with an @, the name
// shows as a label that opens its entry, a hover shows its note in place, and each note ends with the notes that
// mention it. Nothing reaches the TV.
//
// Drives src/notes/notesEditor.js, notesAppears.js, mentionIndex.js and mentionPlan.js. Keys are real CDP key
// events. Pure rules (parse, escape, caps, remap, uids) are test/mentionPlan.test.js.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its letter.
//
//   A. Typing @ in a note opens a picker at the caret; arrows, Enter and a click pick; Esc closes it and leaves
//      the typed text and the window.
//   B. A name that matches nothing offers to create a faction, a lore entry or a monster, and leaves the mention.
//   C. A mention is a blue label; one whose entry does not exist is red, and clicking it offers the same three kinds.
//   D. Clicking a blue label opens its entry; hovering shows its kind and the first lines of its note.
//   E. Each note ends with "Appears in": a count and the notes that mention it; folded state is remembered.
//   F. Renaming an entry changes every label that shows it, with no note rewritten at the moment of the rename.
//   G. Deleting an entry turns its labels red and keeps their words.
//   H. A note is always editable, and Ctrl+Z inside it undoes its own typing.
//   I. The Bestiary page's notes field takes labels and @ like the window and is the same field; a book monster
//      picked by @ joins the tree's Monsters and NPCs.
//   J. Deleting a monster and making a new one leaves the old monster's labels red.
//   K. Esc in a note with no picker closes nothing typed.
//   L. A note at the cap refuses a mention that would pass it, and says so.
//   M. Clicking the map after typing in a note saves the note.
//   N. A group mentioned before it has an outline keeps its blue label after a restart.
//   O. Nothing reaches the TV.

const lib = require('../../lib');

const MAP_W = 2400, MAP_H = 1500;
const VK = { Enter: 13, Escape: 27, ArrowUp: 38, ArrowDown: 40 };

module.exports = async function mentionsFeature(rig) {
  let dm = rig.dm;
  const ev = (expr, ms) => dm.evaluate(expr, ms);
  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await lib.settle(dm, 'fogCoverT === 0', 30000);
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen', 45000, 'the Player to receive the map');
  await player.evaluate('globalThis.__mnMsgs = []; window.addEventListener("message", e => __mnMsgs.push(e.data && e.data.type)); 0');
  const tvDom = () => player.evaluate('document.body.querySelectorAll("*").length + "|" + document.body.textContent');
  const tvBefore = await tvDom();

  // Real key events, one character at a time, at whatever holds focus.
  const typeText = async text => {
    for (const ch of text) {
      await dm.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch });
      await dm.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    }
  };
  const press = async (key, mods) => {
    const code = key.length === 1 ? 'Key' + key.toUpperCase() : key;
    const vk = VK[key] || key.toUpperCase().charCodeAt(0);
    await dm.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers: mods || 0, text: key === 'Enter' ? '\r' : undefined });
    await dm.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers: mods || 0 });
  };
  const val = () => ev('document.getElementById("np-field").value');
  const focusEnd = () => ev('(() => { const f = document.getElementById("np-field"); f.focus(); const s = getSelection(); s.selectAllChildren(f); s.collapseToEnd(); return 0; })()');
  const pop = () => ev('(() => { const p = document.querySelector(".ne-pop"); return p ? { rows: [...p.querySelectorAll("[data-i]")].map(r => r.firstChild.textContent), on: (p.querySelector(".on") || {}).dataset ? p.querySelector(".on").dataset.i : null } : null; })()');
  const pickRow = async text => {
    const r = await ev('(() => { const rows = [...document.querySelectorAll(".ne-pop [data-i]")]; const r = rows.find(d => d.firstChild.textContent === ' + JSON.stringify(text) + '); if (!r) return "none among " + JSON.stringify(rows.map(d => d.textContent)); r.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); return "ok"; })()');
    if (r !== 'ok') rig.note('picker row ' + text + ': ' + r);
  };
  const labels = () => ev('[...document.querySelectorAll("#np-field .mn")].map(l => ({ text: l.textContent, kind: l.dataset.kind, miss: l.classList.contains("miss") }))');
  const setNote = text => ev('(() => { const f = document.getElementById("np-field"); f.dispatchEvent(new FocusEvent("focus")); f.value = ' + JSON.stringify(text) + '; f.dispatchEvent(new Event("input", { bubbles: true })); f.dispatchEvent(new FocusEvent("blur")); return 0; })()');
  const openCampaign = async () => {
    if (!(await ev('nwIsOpen()'))) await ev('document.getElementById("dock-tab-notes").click(); 0');
    await lib.settle(dm, 'nwIsOpen()', 6000);
    await ev('ntGoKey("campaign"); 0');
    await lib.settle(dm, 'document.getElementById("nw-kind").textContent === "Campaign"', 6000);
  };

  // The entries the mentions point at.
  await ev('(() => { notesEntryAdd("faction", "Vistani", "faction"); const b = cbNewBlock("Lady Wachter"); b.listed = true; b.notes = "Plots against the Baron.\\nOwes Izek a favour."; cbNewBlock("Goblin"); cbSave(); 0; })()');
  const vistaniId = await ev('notesEntriesAll().find(e => e.name === "Vistani").id');
  await ev('notesEntrySetNote(' + JSON.stringify(vistaniId) + ', "A wandering people.\\nThey read the cards."); 0');
  await openCampaign();

  // ── A. The picker ─────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await focusEnd();
  await typeText('Meet @Vis');
  await lib.settle(dm, 'document.querySelector(".ne-pop")', 4000);
  const p1 = await pop();
  rig.check(p1 && p1.rows[0] === 'Vistani', 'typing @Vis did not open a picker listing Vistani first: ' + JSON.stringify(p1));
  await press('Enter');
  await lib.settle(dm, 'document.querySelectorAll("#np-field .mn").length === 1', 4000);
  rig.check(await val() === 'Meet @[Vistani](entry:' + vistaniId + ') ' && !(await ev('!!document.querySelector(".ne-pop")')),
            'Enter in the picker did not put the mention in and close it: ' + JSON.stringify(await val()));
  await typeText('and @Lad');
  await lib.settle(dm, 'document.querySelector(".ne-pop")', 4000);
  await pickRow('Lady Wachter');
  await lib.settle(dm, 'document.querySelectorAll("#np-field .mn").length === 2', 4000);
  rig.check((await val()).includes('@[Lady Wachter](monster:'), 'a click on a picker row did not put the mention in: ' + await val());
  await typeText('@');
  await lib.settle(dm, 'document.querySelector(".ne-pop")', 4000);
  const before = await pop();
  await press('ArrowDown');
  const after = await pop();
  rig.check(before.on === '0' && after.on === '1', 'the arrow keys did not move the picker\'s pick: ' + JSON.stringify([before, after]));
  await press('ArrowUp');
  await press('Escape');
  await lib.settle(dm, '!document.querySelector(".ne-pop")', 4000);
  rig.check(await ev('nwIsOpen()') && (await val()).endsWith('@') && !(await ev('!!document.querySelector(".ne-pop")')), 'Esc with the picker open did not close only the picker and leave the typed @: ' + JSON.stringify(await val()));

  // ── B. A name that matches nothing ────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  for (const [name, row] of [['Zork', 'Faction'], ['Tomes', 'Lore'], ['Bogeyman', 'Monster or NPC']]) {
    await typeText(name);
    await lib.settle(dm, 'document.querySelector(".ne-pop .hd")', 4000);
    await pickRow(row);
    await lib.settle(dm, 'document.querySelector(".ne-pop") === null', 4000);
    await typeText(' @');
  }
  const made = await ev('({ faction: notesEntriesAll().some(e => e.kind === "faction" && e.name === "Zork"), lore: notesEntriesAll().some(e => e.kind === "lore" && e.name === "Tomes"), monster: Object.values(cbState.blocks).some(b => b.name === "Bogeyman" && b.listed) })');
  rig.check(made.faction && made.lore && made.monster, 'the picker did not create a faction, a lore entry and a monster from a name: ' + JSON.stringify(made));
  const labelsB = await labels();
  rig.check(labelsB.length === 5 && labelsB.every(l => !l.miss), 'the created entries are not blue labels in the note: ' + JSON.stringify(labelsB));
  await press('Escape');

  // ── C. Blue and red labels ────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await setNote('See @[Gone thing](entry:zz9) and @[Vistani](entry:' + vistaniId + ').');
  const lc = await labels();
  rig.check(lc.length === 2 && lc[0].miss && !lc[1].miss, 'a missing entry is not red, or an existing one is not blue: ' + JSON.stringify(lc));
  await ev('document.querySelector("#np-field .mn.miss").click(); 0');
  await lib.settle(dm, 'document.querySelector(".nw-menu")', 4000);
  const menu = await ev('[...document.querySelectorAll(".nw-menu .sm-mi")].map(b => b.textContent)');
  rig.check(menu.length === 4 && menu.slice(1).join() === 'Faction,Lore,Monster or NPC', 'a red label\'s menu does not offer Faction, Lore and Monster or NPC: ' + JSON.stringify(menu));
  await ev('[...document.querySelectorAll(".nw-menu .sm-mi")].find(b => b.textContent === "Lore").click(); 0');
  await lib.settle(dm, 'notesEntriesAll().some(e => e.kind === "lore" && e.name === "Gone thing")', 4000);
  await lib.settle(dm, 'document.querySelectorAll("#np-field .mn.miss").length === 0', 4000);
  rig.check(await ev('document.querySelectorAll("#np-field .mn.miss").length') === 0 && (await val()).includes('@[Gone thing](entry:') && !(await val()).includes('entry:zz9'),
            'creating from a red label did not make the entry and turn the label blue: ' + await val());

  // ── D. Click and hover ────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await setNote('Ask @[Vistani](entry:' + vistaniId + ') about the cards.');
  await ev('(() => { const l = document.querySelector("#np-field .mn"); l.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body })); return 0; })()');
  await lib.settle(dm, 'document.querySelector(".ne-tip") && document.querySelector(".ne-tip").style.display === "block"', 4000);
  const tip = await ev('document.querySelector(".ne-tip").textContent');
  rig.check(tip.includes('Vistani') && tip.includes('Faction') && tip.includes('A wandering people.') && tip.includes('They read the cards.'),
            'hovering a label did not show its kind and the first lines of its note: ' + JSON.stringify(tip));
  await ev('document.querySelector("#np-field .mn").click(); 0');
  await lib.settle(dm, 'document.getElementById("nw-kind").textContent === "Faction"', 6000);
  rig.check(await ev('document.getElementById("nw-title").value') === 'Vistani', 'clicking a blue label did not open its entry in the window');

  // ── E. Appears in ─────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await lib.settle(dm, 'document.querySelector("#nw-appears .ap")', 6000);
  const ap = await ev('({ n: document.querySelector("#nw-appears .aph .n").textContent, rows: [...document.querySelectorAll("#nw-appears .ap")].map(r => r.firstChild.textContent) })');
  rig.check(ap.n === '1' && ap.rows.join() === 'Campaign', 'Appears in did not count and list the campaign note that mentions Vistani: ' + JSON.stringify(ap));
  await ev('document.querySelector("#nw-appears .aph").click(); 0');
  await lib.settle(dm, '!document.querySelector("#nw-appears .ap")', 4000);
  rig.check(await ev('JSON.parse(localStorage.getItem("evermist.notesWin")).appearsShut') === true, 'the folded state of Appears in was not remembered');
  await ev('document.querySelector("#nw-appears .aph").click(); 0');
  await lib.settle(dm, 'document.querySelector("#nw-appears .ap")', 4000);
  await ev('document.querySelector("#nw-appears .ap").click(); 0');
  await lib.settle(dm, 'document.getElementById("nw-kind").textContent === "Campaign"', 6000);

  // ── F. A rename shows at once, and rewrites nothing ───────────────────────
  // RED ON: the label repaint skipped in neRefreshLabels (notesEditor.js) — 2026-10-30
  await ev('notesEntryRename(' + JSON.stringify(vistaniId) + ', "Vistani Clan"); _ntSig = ""; mxBump(); refreshRoomPanel(); 0');
  await lib.settle(dm, 'document.querySelector("#np-field .mn") && document.querySelector("#np-field .mn").textContent === "Vistani Clan"', 6000);
  rig.check((await labels())[0].text === 'Vistani Clan', 'a renamed entry did not change the label that shows it');
  rig.check(await ev('notesCampaignGet()') === 'Ask @[Vistani](entry:' + vistaniId + ') about the cards.', 'a rename rewrote a note at the moment of the rename: ' + await ev('notesCampaignGet()'));
  await ev('(() => { const f = document.getElementById("np-field"); f.dispatchEvent(new FocusEvent("blur")); return 0; })()');
  rig.check((await ev('notesCampaignGet()')).includes('@[Vistani Clan](entry:' + vistaniId + ')'), 'the shown name was not refreshed when the note was next saved');

  // ── G. Deleting turns labels red and keeps the words ──────────────────────
  // RED ON: the label repaint skipped in neRefreshLabels (notesEditor.js) — 2026-10-30
  await ev('notesEntryDelete(' + JSON.stringify(vistaniId) + '); mxBump(); _ntSig = ""; refreshRoomPanel(); 0');
  await lib.settle(dm, 'document.querySelector("#np-field .mn.miss")', 6000);
  const lg = (await labels())[0];
  rig.check(lg.miss && lg.text === 'Vistani Clan', 'deleting an entry did not turn its label red with its words kept: ' + JSON.stringify(lg));

  // ── H. Always editable, and its own undo ──────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await setNote('Start.');
  rig.check(await ev('document.getElementById("np-field").getAttribute("contenteditable")') === 'plaintext-only', 'a note needs an edit mode: its field is not always editable');
  await focusEnd();
  await typeText(' more words');
  await press('z', 2);
  await lib.settle(dm, 'document.getElementById("np-field").value === "Start."', 4000);
  rig.check(await val() === 'Start.', 'Ctrl+Z inside a note did not undo its own typing: ' + JSON.stringify(await val()));

  // ── I. The Bestiary page's field is the same ──────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const goblinId = await ev('Object.values(cbState.blocks).find(b => b.name === "Goblin").id');
  const wachterId = await ev('Object.values(cbState.blocks).find(b => b.name === "Lady Wachter").id');
  await ev('bestiarySetOpen(true); _bsShow(' + JSON.stringify(wachterId) + '); 0');
  await lib.settle(dm, 'document.querySelector("#bs-page [data-notes]") && document.querySelector("#bs-page [data-notes]").isContentEditable', 6000);
  const bsNotes = await ev('document.querySelector("#bs-page [data-notes]").value');
  rig.check(bsNotes.startsWith('Plots against the Baron.'), 'the Bestiary page\'s notes field does not show the monster\'s note: ' + JSON.stringify(bsNotes));
  await ev('(() => { const f = document.querySelector("#bs-page [data-notes]"); f.focus(); const s = getSelection(); s.selectAllChildren(f); s.collapseToEnd(); return 0; })()');
  await typeText(' Hates @Gob');
  await lib.settle(dm, 'document.querySelector(".ne-pop")', 4000);
  await press('Enter');
  await lib.settle(dm, 'cbState.blocks[' + JSON.stringify(wachterId) + '].notes.includes("@[Goblin](monster:")', 4000);
  rig.check(await ev('document.querySelectorAll("#bs-page [data-notes] .mn").length') === 1, 'the Bestiary page\'s field did not take an @ and show a label');
  await ev('bestiarySetOpen(false); 0');
  await openCampaign();
  await ev('ntGoKey("monster:" + ' + JSON.stringify(wachterId) + '); 0');
  await lib.settle(dm, 'document.getElementById("nw-kind").textContent === "Monster or NPC" && document.querySelectorAll("#np-field .mn").length === 1', 6000);
  rig.check((await val()).includes('@[Goblin](monster:'), 'an edit on the Bestiary page did not show in the window\'s field');
  rig.check(await ev('!!document.querySelector("#nw-tl .nw-row[data-key=\\"monster:" + ' + JSON.stringify(goblinId) + ' + "\\"]")'),
            'a book monster picked by @ did not join the tree\'s Monsters and NPCs');

  // ── J. A new monster is not the old one ───────────────────────────────────
  // RED ON: the label repaint skipped in neRefreshLabels (notesEditor.js) — 2026-10-30
  await openCampaign();
  const goblinUid = await ev('cbState.blocks[' + JSON.stringify(goblinId) + '].uid');
  await setNote('A @[Goblin](monster:' + goblinUid + ') lurks.');
  rig.check((await labels())[0].miss === false, 'a mention of a monster that exists is not blue');
  await ev('delete cbState.blocks[' + JSON.stringify(goblinId) + ']; cbNewBlock("Goblin"); cbSave(); _ntSig = ""; mxBump(); refreshRoomPanel(); 0');
  await lib.settle(dm, 'document.querySelector("#np-field .mn.miss")', 6000);
  rig.check((await labels())[0].miss === true, 'a new monster with the old one\'s name took over its mentions: ' + JSON.stringify(await labels()));

  // ── K. Esc in a note with no picker ───────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await setNote('Keep this.');
  await focusEnd();
  await press('Escape');
  rig.check(await ev('nwIsOpen()') && await val() === 'Keep this.', 'Esc in a note with no picker closed the window or lost what was typed: ' + JSON.stringify(await val()));

  // ── L. The cap ────────────────────────────────────────────────────────────
  // RED ON: the mpFits check in _neInsertMention removed (notesEditor.js) — 2026-10-30
  const full = 'x'.repeat(19994);
  await setNote(full);
  await focusEnd();
  await typeText(' @Lad');
  await lib.settle(dm, 'document.querySelector(".ne-pop")', 4000);
  await pickRow('Lady Wachter');
  await lib.settle(dm, '!document.querySelector(".ne-pop")', 4000);
  rig.check((await val()).length <= 20000 && await ev('document.querySelectorAll("#np-field .mn").length') === 0,
            'a note at the cap took a mention that passed it: ' + (await val()).length);
  rig.check(await ev('(document.getElementById("notice-toast") || {}).textContent || ""') !== '', 'a refused mention did not say so');
  await setNote('');

  // ── M. Clicking the map saves the note ────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await focusEnd();
  await typeText('Typed then mapclick');
  await ev('__rigClick(1800, 1100); 0');
  await lib.settle(dm, 'notesCampaignGet() === "Typed then mapclick"', 6000);
  rig.check(await ev('notesCampaignGet()') === 'Typed then mapclick' && !(await ev('document.activeElement.isContentEditable')),
            'clicking the map after typing did not save the note and hand focus back: ' + await ev('notesCampaignGet()'));

  // ── O. The TV ─────────────────────────────────────────────────────────────
  await lib.hold(1200, 'long enough for a note to have pushed something to the TV, then prove it did not');
  const msgs = (await player.evaluate('__mnMsgs')).filter(m => ['fog-update', 'tv-picture', 'scene-transition', 'view-snap', 'fog-color'].includes(m));
  rig.check(msgs.length === 0 && await tvDom() === tvBefore, 'a mention, a picker or a hover changed what the TV shows: ' + JSON.stringify(msgs));

  // ── N. A group before it has an outline, across a restart ─────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await ev('addGroup("Vallaki"); sceneListChanged(); 0');
  await setNote('');
  await focusEnd();
  await typeText('Go to @Vall');
  await lib.settle(dm, 'document.querySelector(".ne-pop")', 4000);
  await pickRow('Vallaki');
  await lib.settle(dm, 'document.querySelectorAll("#np-field .mn").length === 1', 4000);
  rig.check((await labels())[0].kind === 'group' && !(await labels())[0].miss, 'a group with no outline could not be mentioned as a blue label');
  await ev('(() => { const f = document.getElementById("np-field"); f.dispatchEvent(new FocusEvent("blur")); return 0; })()');
  await ev('doAutoSave()', 60000);
  dm = await rig.restart();
  await lib.installHelpers(dm);
  await lib.settle(dm, 'typeof nwToggle === "function" && currentScene && fogCoverT === 0', 90000);
  await dm.evaluate('document.getElementById("dock-tab-notes").click(); 0');
  await lib.settle(dm, 'nwIsOpen() && document.getElementById("nw-kind").textContent === "Campaign"', 8000);
  const back = await dm.evaluate('[...document.querySelectorAll("#np-field .mn")].map(l => ({ text: l.textContent, miss: l.classList.contains("miss") }))');
  rig.check(back.length === 1 && back[0].text === 'Vallaki' && !back[0].miss, 'after a restart a group mentioned before it had an outline is no longer a blue label: ' + JSON.stringify(back));

  rig.byEye('the labels, picker, hover preview and Appears in against .claude/private/design/item-195/notes-v2.html');
};
