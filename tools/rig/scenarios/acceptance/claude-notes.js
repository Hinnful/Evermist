'use strict';

// claude-notes.js — CLAUDE FILLS THE NOTES WINDOW'S MODEL.
//
// THE GOAL: the AI assistant makes and shapes factions and lore, makes a blank Bestiary entry for an NPC, and writes
// mentions between notes, through the same stores the Notes window uses (src/mcp/mcpEntries.js, mcpNotes.js,
// mcpEntriesPlan.js). Each call is one undo step, a delete asks first, and nothing reaches the TV.
//
//   A. create_entry makes a faction, and one inside it with a note whose @{Name} became a stored mention.
//   B. create_entry refuses a name the kind already holds and names the existing entry; undo takes an entry away.
//   C. create_entry kind monster makes a blank listed Bestiary entry with a note, and refuses a name already there.
//   D. A @{Map › Room} mention resolves to the room's uid form; a name matching two things stays plain and is listed.
//   E. edit_entry renames, moves into another entry and to the section, and replaces or adds to the note; undo
//      takes each back.
//   F. read_notes reads mentions back as @{Name}, at the faction, monster and campaign levels.
//   G. appears_in lists the notes that mention an entry.
//   H. delete_entry without confirmed deletes nothing and says what goes and which notes mention it; with confirmed
//      it deletes the entry and its children; undo brings them back.
//   I. With the TV on, none of this changes what the Player holds.

const lib = require('../../lib');

module.exports = async function claudeNotes(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: 1200, h: 800 });
  const call = await lib.mcpClient(rig);
  rig.check(!!call, 'the app wrote no mcp.json with a port and a key into its profile');
  if (!call) return;
  const ev = expr => dm.evaluate(expr);
  const entry = name => ev('(() => { const e = notesEntriesAll().find(x => x.name === ' + JSON.stringify(name) + '); return e ? Object.assign({}, e, { parentName: (notesEntriesAll().find(x => x.id === e.parent) || {}).name || null }) : null; })()');
  const monster = name => ev('(() => { const b = Object.values(cbState.blocks).find(x => x.name === ' + JSON.stringify(name) + '); return b ? { notes: b.notes || "", listed: !!b.listed, uid: b.uid || null } : null; })()');
  const hasToken = (text, kind, name) => new RegExp('@\\[' + name + '\\]\\(' + kind + ':[A-Za-z0-9_:-]+\\)').test(text || '');

  const scene = await ev('currentScene.name');
  const room = await call('create_room', { name: scene, room: 'Wine Cellar', outline: [[10, 10], [40, 10], [40, 40], [10, 40]], notes: 'Barrels.' });
  rig.check(!room.isError, 'the room the tests link to was not drawn: ' + JSON.stringify(room));

  // ── A ──
  // RED BY DESIGN: written against the feature, never re-proved
  const a1 = await call('create_entry', { kind: 'faction', name: 'Zhentarim', notes: 'A black network.' });
  const a2 = await call('create_entry', { kind: 'faction', name: 'Black Hand', parent: 'Zhentarim', notes: 'Serves @{Zhentarim}.' });
  const hand = await entry('Black Hand'), zhent = await entry('Zhentarim');
  rig.check(!a1.isError && !a2.isError && !!hand && !!zhent && hand.parentName === 'Zhentarim' && zhent.parent === 'faction',
            'A: create_entry did not make a faction and one inside it: ' + JSON.stringify({ a1, a2, hand }));
  rig.check(!!hand && hasToken(hand.note, 'entry', 'Zhentarim') && hand.note.includes(zhent.id),
            'A: the @{Zhentarim} in the note did not become a stored mention of that entry: ' + JSON.stringify(hand));

  // ── B ──
  // RED BY DESIGN: written against the feature, never re-proved
  const dupe = await call('create_entry', { kind: 'faction', name: 'zhentarim' });
  rig.check(dupe.isError && /already exists/.test(dupe.text) && /Zhentarim/.test(dupe.text) && (await ev('notesEntriesAll().filter(e => e.kind === "faction").length')) === 2,
            'B: create_entry did not refuse a second faction of the same name: ' + JSON.stringify(dupe));
  const made = await call('create_entry', { kind: 'lore', name: 'The Fall' });
  const undoMade = await call('undo_last_change');
  rig.check(!made.isError && !undoMade.isError && !(await entry('The Fall')), 'B: undo_last_change did not take the new lore entry away: ' + JSON.stringify({ made, undoMade }));

  // ── C ──
  // RED BY DESIGN: written against the feature, never re-proved
  const m1 = await call('create_entry', { kind: 'monster', name: 'Lady Vex', notes: 'Leads the @{Zhentarim}. Waits in @{' + scene + ' › Wine Cellar}.' });
  const vex = await monster('Lady Vex');
  rig.check(!m1.isError && !!vex && vex.listed && hasToken(vex.notes, 'entry', 'Zhentarim'), 'C: create_entry kind monster did not make a listed Bestiary entry with its note: ' + JSON.stringify({ m1, vex }));
  const m2 = await call('create_entry', { kind: 'monster', name: 'lady vex' });
  rig.check(m2.isError && /Lady Vex/.test(m2.text) && (await ev('Object.values(cbState.blocks).filter(b => /lady vex/i.test(b.name)).length')) === 1,
            'C: create_entry did not refuse a monster the Bestiary already holds: ' + JSON.stringify(m2));

  // ── D ──
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(!!vex && hasToken(vex.notes, 'room', 'Wine Cellar') && /room:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+\)/.test(vex.notes),
            'D: @{Map › Room} did not become a room mention carrying the map id and the room uid: ' + JSON.stringify(vex));
  await call('create_entry', { kind: 'lore', name: 'Zhentarim' });
  const amb = await call('add_notes', { level: 'campaign', text: 'The @{Zhentarim} again.' });
  const campaign = await ev('notesCampaignGet()');
  rig.check(!amb.isError && /plain words/.test(amb.text) && /more than one match/.test(amb.text) && campaign.includes('The Zhentarim again.') && !campaign.includes('@['),
            'D: a name matching a faction and a lore entry was linked or not reported: ' + JSON.stringify({ amb, campaign }));
  await call('undo_last_change');
  const picked = await call('add_notes', { level: 'campaign', text: 'The @{faction: Zhentarim} again.' });
  rig.check(!picked.isError && hasToken(await ev('notesCampaignGet()'), 'entry', 'Zhentarim'), 'D: @{faction: Zhentarim} did not pick the faction: ' + JSON.stringify(picked));
  const fix = await call('undo_last_change');
  rig.check(!fix.isError && !(await ev('notesCampaignGet()')).includes('@['), 'D: undo_last_change did not take the campaign note back: ' + JSON.stringify(fix));
  await call('undo_last_change');   // the lore entry made for the ambiguity

  // ── E ──
  // RED BY DESIGN: written against the feature, never re-proved
  const e1 = await call('edit_entry', { kind: 'faction', name: 'Black Hand', newName: 'Red Hand' });
  rig.check(!e1.isError && !!(await entry('Red Hand')) && !(await entry('Black Hand')), 'E: edit_entry did not rename the entry: ' + JSON.stringify(e1));
  const e2 = await call('edit_entry', { kind: 'faction', name: 'Red Hand', parent: '' });
  rig.check(!e2.isError && (await entry('Red Hand')).parent === 'faction', 'E: edit_entry did not move the entry to the section: ' + JSON.stringify(e2));
  const e3 = await call('edit_entry', { kind: 'faction', name: 'Red Hand', parent: 'Zhentarim' });
  rig.check(!e3.isError && (await entry('Red Hand')).parentName === 'Zhentarim', 'E: edit_entry did not move the entry inside another: ' + JSON.stringify(e3));
  const e4 = await call('edit_entry', { kind: 'faction', name: 'Red Hand', addNotes: 'Also sells to @{Lady Vex}.' });
  const noted = await entry('Red Hand');
  rig.check(!e4.isError && /Serves/.test(noted.note) && hasToken(noted.note, 'monster', 'Lady Vex'), 'E: edit_entry did not add to the note and link the monster: ' + JSON.stringify({ e4, noted }));
  const e5 = await call('edit_entry', { kind: 'faction', name: 'Red Hand', notes: 'Fresh.' });
  rig.check(!e5.isError && (await entry('Red Hand')).note === 'Fresh.', 'E: edit_entry did not replace the note: ' + JSON.stringify(e5));
  for (let i = 0; i < 5; i++) await call('undo_last_change');
  const back = await entry('Black Hand');
  rig.check(!!back && back.parentName === 'Zhentarim' && /Serves/.test(back.note) && !(await entry('Red Hand')), 'E: five undos did not put the entry back as it was made: ' + JSON.stringify(back));

  // ── F ──
  // RED BY DESIGN: written against the feature, never re-proved
  const readF = await call('read_notes', { level: 'faction', name: 'Black Hand' });
  rig.check(!readF.isError && readF.text.includes('Serves @{Zhentarim}.') && !readF.text.includes('@['), 'F: read_notes of a faction did not read the mention as @{Zhentarim}: ' + JSON.stringify(readF));
  const readM = await call('read_notes', { level: 'monster', name: 'Lady Vex' });
  rig.check(!readM.isError && readM.text.includes('@{Zhentarim}') && readM.text.includes('@{' + scene + ' › Wine Cellar}'), 'F: read_notes of a monster did not read both mentions back: ' + JSON.stringify(readM));

  // ── G ──
  // RED BY DESIGN: written against the feature, never re-proved
  const appears = await call('appears_in', { name: 'Zhentarim', kind: 'faction' });
  rig.check(!appears.isError && /Black Hand/.test(appears.text) && /Lady Vex/.test(appears.text), 'G: appears_in did not list the faction note and the monster note that mention Zhentarim: ' + JSON.stringify(appears));

  // ── H ──
  // RED BY DESIGN: written against the feature, never re-proved
  const dry = await call('delete_entry', { kind: 'faction', name: 'Zhentarim' });
  rig.check(!dry.isError && /Would delete/.test(dry.text) && /Black Hand/.test(dry.text) && /Lady Vex/.test(dry.text) && !!(await entry('Zhentarim')) && !!(await entry('Black Hand')),
            'H: delete_entry without confirmed deleted something or did not list the children and the notes that mention it: ' + JSON.stringify(dry));
  const gone = await call('delete_entry', { kind: 'faction', name: 'Zhentarim', confirmed: true });
  rig.check(!gone.isError && !(await entry('Zhentarim')) && !(await entry('Black Hand')), 'H: delete_entry with confirmed left the entry or its child: ' + JSON.stringify(gone));
  const undone = await call('undo_last_change');
  const again = await entry('Black Hand');
  rig.check(!undone.isError && !!(await entry('Zhentarim')) && !!again && again.parentName === 'Zhentarim', 'H: undo_last_change did not bring the entry and its child back: ' + JSON.stringify(undone));

  // ── I ──
  // RED BY DESIGN: written against the feature, never re-proved
  const player = await rig.player();
  await lib.settle(player, '!viewportDirty', 15000);
  const before = await player.evaluate('document.documentElement.innerText + "|" + JSON.stringify(Object.keys(window).length)');
  const tv = await call('create_entry', { kind: 'lore', name: 'Hidden Vault', notes: 'DM only: @{Zhentarim}.' });
  await lib.hold(1500, 'a message to the Player would land within this wait');
  const after = await player.evaluate('document.documentElement.innerText + "|" + JSON.stringify(Object.keys(window).length)');
  rig.check(!tv.isError && before === after && !after.includes('Hidden Vault') && !after.includes('Zhentarim'),
            'I: a notes change reached the Player: ' + JSON.stringify({ tv, before, after }));
};
