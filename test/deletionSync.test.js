'use strict';
// A deletion travels in a backup and the later edit wins (backlog 269): monsters, fights, factions and lore,
// pictures and the campaign note, between two laptops that each keep the same campaign.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ES = require('../src/scenes/editStamps.js');
const { combatBlankBlock } = require('../src/combat/combatPlan.js');
const F = require('../src/combat/fightPlan.js');
const N = require('../src/notes/notesEntriesPlan.js');
const NP = require('../src/notes/notesPlan.js');
const G = require('../src/gallery/galleryPlan.js');

const plain = o => JSON.parse(JSON.stringify(o));
const ids = () => { let n = 0; return () => 'id' + (++n); };

describe('the deletion records', () => {
  it('reads only positive times under real keys, and nothing from a value that is not a map', () => {
    assert.deepEqual(plain(ES.esGoneClean({ a: 5, b: 0, c: 'x', d: -1, '': 3 })), { a: 5 });
    for (const bad of [null, undefined, 4, 'x', [1, 2]]) assert.deepEqual(plain(ES.esGoneClean(bad)), {});
  });
  it('notes what left a list at the save and drops what is back', () => {
    const g = ES.esGoneNote({ old: 3, back: 4 }, ['a', 'b', 'back'], ['a', 'back'], 9);
    assert.deepEqual(plain(g), { old: 3, b: 9 });
  });
  it('merges to the later time of each id', () => {
    assert.deepEqual(plain(ES.esGoneMerge({ a: 5, b: 9 }, { a: 7, c: 1 })), { a: 7, b: 9, c: 1 });
  });
  it('lets a deletion at or after the last edit win, a time past the moment counting as the moment', () => {
    assert.equal(ES.esGoneWins({ a: 50 }, 'a', 40, 100), true);
    assert.equal(ES.esGoneWins({ a: 50 }, 'a', 50, 100), true);
    assert.equal(ES.esGoneWins({ a: 50 }, 'a', 60, 100), false);
    assert.equal(ES.esGoneWins({ a: 50 }, 'a', 0, 100), true, 'a record with no time is the oldest');
    assert.equal(ES.esGoneWins({ a: 5000 }, 'a', 90, 100), true);
    assert.equal(ES.esGoneWins({}, 'a', 0, 100), false);
  });
  it('keeps the newest 300 of a kind, so the record does not grow without end', () => {
    const before = [], after = [];
    for (let i = 0; i < 400; i++) before.push('id' + i);
    const g = ES.esGoneNote({}, before, after, 1);
    assert.equal(Object.keys(g).length, ES.ES_GONE_MAX);
    const more = ES.esGoneNote(g, ['fresh'], [], 99);
    assert.equal(more.fresh, 99);
    assert.equal(Object.keys(more).length, ES.ES_GONE_MAX);
  });
  it('reads a poisoned key as an ordinary id', () => {
    const g = ES.esGoneClean(JSON.parse('{"__proto__": 5}'));
    assert.equal(Object.getPrototypeOf(g), null);
    assert.equal(ES.esGoneWins(g, '__proto__', 1, 10), true);
    assert.equal(ES.esGoneWins(g, 'toString', 1, 10), false);
  });
});

// ── Monsters and fights ──────────────────────────────────────────────────────

describe('a monster or fight deleted on one laptop', () => {
  const wolf = ac => Object.assign(combatBlankBlock('b1', 'Wolf'), { uid: 'uw', ac });
  // One laptop: the wolf and a fight both laptops share, each stamped at the times given.
  const lap = (wolfAt, fightAt, rows) => {
    const st = { rows: rows || [], blocks: { b1: wolf('13') }, nextId: 5, openId: 'fS', fights: [{ id: 'fS', name: 'Siege' }, { id: 'fT', name: 'Tomb', rows: [] }] };
    F.combatStampEdits(st, 1);
    if (wolfAt) st.edits.blocks.uw.t = wolfAt;
    if (fightAt) { st.edits.fights.fS.t = fightAt; st.edits.fights.fT.t = fightAt; }
    return st;
  };
  const ship = st => JSON.parse(JSON.stringify(F.combatBackupData(st)));

  it('is noted by the save that finds it missing, and a monster back is an edit at that moment', () => {
    const a = lap(100, 100);
    delete a.blocks.b1;
    a.fights = a.fights.filter(f => f.id !== 'fT');
    F.combatStampEdits(a, 500);
    assert.deepEqual(plain(a.edits.goneBlocks), { uw: 500 });
    assert.deepEqual(plain(a.edits.goneFights), { fT: 500 });
    a.blocks.b1 = wolf('13');
    F.combatStampEdits(a, 800);
    assert.equal(a.edits.goneBlocks, undefined);
    assert.equal(a.edits.blocks.uw.t, 800);
  });
  it('removes the monster and the fight on Import when deleted after the other laptop last edited them', () => {
    const a = lap(100, 100);
    delete a.blocks.b1;
    a.fights = a.fights.filter(f => f.id !== 'fT');
    F.combatStampEdits(a, 500);
    const b = lap(300, 300);
    const m = F.combatMerge(b, ship(a), ids(), 1000);
    assert.deepEqual(Object.keys(m.blocks), []);
    assert.deepEqual(m.fights.map(f => f.id), ['fS']);
    assert.deepEqual(plain(m.edits.goneBlocks), { uw: 500 });
    assert.equal(m.edits.blocks.uw, undefined);
  });
  it('does not bring them back on Import into the laptop that deleted them', () => {
    const a = lap(100, 100);
    delete a.blocks.b1;
    a.fights = a.fights.filter(f => f.id !== 'fT');
    F.combatStampEdits(a, 500);
    const m = F.combatMerge(a, ship(lap(300, 300)), ids(), 1000);
    assert.deepEqual(Object.keys(m.blocks), []);
    assert.deepEqual(m.fights.map(f => f.id), ['fS']);
  });
  it('brings them back, or keeps them, when the other laptop edited after the deletion', () => {
    const a = lap(100, 100);
    delete a.blocks.b1;
    a.fights = a.fights.filter(f => f.id !== 'fT');
    F.combatStampEdits(a, 500);
    const b = lap(700, 700);
    const intoA = F.combatMerge(a, ship(b), ids(), 1000);
    assert.deepEqual(Object.values(intoA.blocks).map(x => x.uid), ['uw']);
    assert.deepEqual(intoA.fights.map(f => f.id).sort(), ['fS', 'fT']);
    assert.equal(intoA.edits.goneBlocks, undefined, 'a record that is back is not deleted');
    assert.equal(intoA.edits.goneFights, undefined);
    const intoB = F.combatMerge(b, ship(a), ids(), 1000);
    assert.deepEqual(Object.values(intoB.blocks).map(x => x.uid), ['uw']);
    assert.deepEqual(intoB.fights.map(f => f.id).sort(), ['fS', 'fT']);
    assert.equal(intoB.edits.goneBlocks, undefined);
  });
  it('lets a deletion beat a copy with no edit time, in both directions', () => {
    const a = lap(100, 100);
    delete a.blocks.b1;
    a.fights = a.fights.filter(f => f.id !== 'fT');
    F.combatStampEdits(a, 500);
    const old = lap(0, 0);
    const intoOld = F.combatMerge(old, ship(a), ids(), 1000);
    assert.deepEqual(Object.keys(intoOld.blocks), []);
    assert.deepEqual(intoOld.fights.map(f => f.id), ['fS']);
    const intoA = F.combatMerge(a, ship(old), ids(), 1000);
    assert.deepEqual(Object.keys(intoA.blocks), []);
    assert.deepEqual(intoA.fights.map(f => f.id), ['fS']);
  });
  it('is carried on to a third laptop through the one that imported it', () => {
    const a = lap(100, 100);
    delete a.blocks.b1;
    F.combatStampEdits(a, 500);
    const b = F.combatMerge(lap(300, 300), ship(a), ids(), 1000);
    F.combatStampEdits(b, 1100);
    const c = F.combatMerge(lap(200, 200), ship(b), ids(), 2000);
    assert.deepEqual(Object.keys(c.blocks), []);
  });
  it('opens the next fight when the open one is deleted by an import', () => {
    const a = lap(100, 100);
    a.fights = a.fights.filter(f => f.id !== 'fS');
    a.openId = 'fT';
    F.combatStampEdits(a, 500);
    const m = F.combatMerge(lap(100, 100), ship(a), ids(), 1000);
    assert.deepEqual(m.fights.map(f => f.id), ['fT']);
    assert.equal(m.openId, 'fT');
  });
  it('keeps a backup with no deletion records importing as before', () => {
    const b = lap(300, 300);
    const file = ship(lap(100, 100));
    assert.equal(file.edits.goneBlocks, undefined);
    const m = F.combatMerge(b, file, ids(), 1000);
    assert.deepEqual(Object.values(m.blocks).map(x => x.uid), ['uw']);
    assert.deepEqual(m.fights.map(f => f.id).sort(), ['fS', 'fT']);
  });
  it('keeps what a later release wrote into the edits', () => {
    const a = lap(100, 100);
    a.edits.future = { x: 1 };
    assert.deepEqual(plain(F.combatStampEdits(a, 200).edits.future), { x: 1 });
  });
});

// ── Factions and lore ────────────────────────────────────────────────────────

describe('a faction or lore entry deleted on one laptop', () => {
  const E = (id, edited, extra) => ({ id, kind: 'faction', name: id, note: '', parent: 'faction', order: 0, ...(edited ? { edited } : {}), ...extra });

  it('is noted with its descendants, and an entry put back leaves the record', () => {
    const before = [E('a', 1), E('b', 1, { parent: 'a' }), E('c', 1)];
    const after = N.neDelete(before, 'a').entries;
    const g = N.neGone({}, before, after, 500);
    assert.deepEqual(plain(g), { a: 500, b: 500 });
    assert.deepEqual(plain(N.neGone(g, after, before, 600)), {});
  });
  it('is removed on Import when deleted after the other laptop last edited it, and not brought back by it', () => {
    const file = [E('a', 100), E('c', 100)];
    const goneA = { a: 500 };
    const into = N.neMerge([E('a', 300), E('c', 300)], [E('c', 300)], 1000, { here: {}, file: goneA });
    assert.deepEqual(into.entries.map(e => e.id), ['c']);
    assert.equal(into.removed, 1);
    assert.deepEqual(plain(into.gone), { a: 500 });
    const back = N.neMerge([E('c', 300)], file, 1000, { here: goneA, file: {} });
    assert.deepEqual(back.entries.map(e => e.id), ['c']);
    assert.equal(back.added, 0);
  });
  it('comes back when edited after the deletion, either way', () => {
    const intoA = N.neMerge([E('c', 300)], [E('a', 700), E('c', 300)], 1000, { here: { a: 500 }, file: {} });
    assert.deepEqual(intoA.entries.map(e => e.id).sort(), ['a', 'c']);
    assert.deepEqual(plain(intoA.gone), {});
    const intoB = N.neMerge([E('a', 700)], [], 1000, { here: {}, file: { a: 500 } });
    assert.deepEqual(intoB.entries.map(e => e.id), ['a']);
    assert.deepEqual(plain(intoB.gone), {});
  });
  it('lets a deletion beat an entry with no edit time, in both directions', () => {
    const into = N.neMerge([E('a')], [], 1000, { here: {}, file: { a: 500 } });
    assert.deepEqual(into.entries, []);
    const out = N.neMerge([], [E('a')], 1000, { here: { a: 500 }, file: {} });
    assert.deepEqual(out.entries, []);
  });
  it('keeps a child edited after its parent was deleted, under its section', () => {
    const into = N.neMerge([E('a', 100), E('b', 800, { parent: 'a' })], [], 1000, { here: {}, file: { a: 500, b: 500 } });
    assert.deepEqual(into.entries.map(e => [e.id, e.parent]), [['b', 'faction']]);
  });
  it('removes nothing, and revives a deleted entry as an edit now, when an undo puts one back', () => {
    const r = N.neMerge([], [E('a', 100)], 1000);
    assert.deepEqual(r.entries.map(e => [e.id, e.edited]), [['a', 100]]);
    const own = N.neMerge([], [E('a', 100)], 1000, undefined);
    assert.equal(own.added, 1);
    const gone = { a: 500 };
    const undo = N.neMerge([], [E('a', 100)], 1000, undefined);
    assert.equal(undo.entries.length, 1);
    assert.deepEqual(plain(undo.gone), {});
    void gone;
  });
  it('keeps an entry put back by an undo out of an older deletion on the next Import', () => {
    // The laptop deleted `a` at 500 and undid it: the record is dropped and the entry carries a new edit time.
    const here = { a: 500 };
    const r = N.neMerge([], [E('a', 100)], 1000, { here: {}, file: {} });
    assert.equal(r.added, 1);
    assert.deepEqual(plain(N.neMerge(r.entries, [], 1000, { here: here, file: {} }).entries.map(e => e.id)), ['a']);
  });
});

// ── The campaign note ────────────────────────────────────────────────────────

describe('the campaign note cleared on one laptop', () => {
  it('clears the note on Import when it was cleared after the note here last changed', () => {
    const r = NP.notesPickCampaign('The lich waits', 100, '', 500, 1000);
    assert.deepEqual([r.text, r.at, r.replaced], ['', 500, true]);
  });
  it('keeps the note here when it changed after the clear', () => {
    const r = NP.notesPickCampaign('The lich waits', 700, '', 500, 1000);
    assert.equal(r.text, 'The lich waits');
  });
  it('lets a clear beat a note with no time, but nothing clears from a file with no time', () => {
    assert.equal(NP.notesPickCampaign('Old note', 0, '', 500, 1000).text, '');
    assert.equal(NP.notesPickCampaign('Old note', 0, '', 0, 1000).text, 'Old note');
    assert.equal(NP.notesPickCampaign('Old note', 0, '', undefined, 1000).text, 'Old note');
  });
  it('writes the clear into the file by its time, and reads it back', () => {
    const json = NP.notesCampaignPayload('', {}, {}, {}, {}, undefined, undefined, undefined, 500);
    assert.notEqual(json, null);
    assert.equal(JSON.parse(json).notesAt, 500);
    const p = NP.notesParseCampaign(json);
    assert.deepEqual([p.text, p.at, p.broken], ['', 500, false]);
  });
  it('writes nothing for a note never edited, and a partial export carries no clear', () => {
    assert.equal(NP.notesCampaignPayload('', {}, {}, {}, {}, undefined, undefined, undefined, 0), null);
    assert.equal(NP.notesCampaignPayload('', {}, {}, {}, {}), null);
  });
  it('does not read a note it could not read as a cleared one', () => {
    const p = NP.notesParseCampaign(JSON.stringify({ notes: 42, notesAt: 500 }));
    assert.equal(p.broken, true);
    assert.equal(p.at, undefined);
  });
  it('still adds a later note and keeps the old join when neither side has a time', () => {
    assert.equal(NP.notesPickCampaign('here', 100, 'file', 500, 1000).text, 'file');
    assert.ok(NP.notesPickCampaign('here', 0, 'file', 0, 1000).text.includes('here'));
  });
});

describe('the deletion records in a campaign.json', () => {
  const gone = { entries: { a: 5 }, pictures: { p1: 7 } };
  it('travel in the file and read back', () => {
    const json = NP.notesCampaignPayload('', {}, {}, {}, {}, undefined, undefined, undefined, 0, gone);
    const back = NP.notesParseGone(json);
    assert.deepEqual([plain(back.entries), plain(back.pictures)], [{ a: 5 }, { p1: 7 }]);
  });
  it('are left out of a file that has none, and read as none from any file that is not theirs', () => {
    assert.equal(NP.notesCampaignPayload('', {}, {}, {}, {}, undefined, undefined, undefined, 0, { entries: {}, pictures: {} }), null);
    for (const raw of [null, 'nope', '{}', '{"gone":3}', '{"gone":{"entries":[1]}}']) {
      const g = NP.notesParseGone(raw);
      assert.deepEqual([Object.keys(g.entries).length, Object.keys(g.pictures).length], [0, 0]);
    }
  });
  it('are ignored by what the previous release reads of the file', () => {
    const json = NP.notesCampaignPayload('The note', {}, {}, {}, {}, undefined, [E1()], undefined, 9, gone);
    assert.equal(NP.notesParseCampaign(json).text, 'The note');
    assert.equal(NP.notesParseEntries(json).entries.length, 1);
    assert.equal(NP.notesParseEntries(json).broken, false);
  });
  function E1() { return { id: 'x', kind: 'lore', name: 'x', note: '', parent: 'lore', order: 0 }; }
});

// ── Pictures ─────────────────────────────────────────────────────────────────

describe('a picture deleted on one laptop', () => {
  const P = (id, added, named) => ({ id, added, named });
  it('is removed on Import when deleted after the other laptop last edited it', () => {
    const r = G.galleryGoneApply([P('a', 100), P('b', 100)], [], {}, { a: 500 }, 1000);
    assert.deepEqual(r.remove, ['a']);
    assert.deepEqual(plain(r.gone), { a: 500 });
  });
  it('is not brought back by the other laptop copy, unless that was edited after (a rename counts)', () => {
    const old = G.galleryGoneApply([], [P('a', 100)], { a: 500 }, {}, 1000);
    assert.deepEqual(old.skip, ['a']);
    const renamed = G.galleryGoneApply([], [P('a', 100, 700)], { a: 500 }, {}, 1000);
    assert.deepEqual(renamed.skip, []);
    assert.deepEqual(plain(renamed.gone), {});
  });
  it('stays when edited here after the deletion', () => {
    const r = G.galleryGoneApply([P('a', 100, 800)], [], {}, { a: 500 }, 1000);
    assert.deepEqual(r.remove, []);
    assert.deepEqual(plain(r.gone), {});
  });
  it('lets a deletion beat a picture with no time, in both directions', () => {
    assert.deepEqual(G.galleryGoneApply([P('a', 0)], [], {}, { a: 500 }, 1000).remove, ['a']);
    assert.deepEqual(G.galleryGoneApply([], [P('a', 0)], { a: 500 }, {}, 1000).skip, ['a']);
  });
  it('removes a picture the file deletes even when the file carries no gallery', () => {
    assert.deepEqual(G.galleryGoneApply([P('a', 100)], [], {}, { a: 500 }, 1000).remove, ['a']);
  });
  it('changes nothing for a file with no deletion records', () => {
    const r = G.galleryGoneApply([P('a', 100)], [P('b', 0)], {}, {}, 1000);
    assert.deepEqual([r.remove, r.skip], [[], []]);
  });
});

// ── A field a later release added to a map ───────────────────────────────────

describe('a map field this release does not know, through Import', () => {
  const TP = require('../src/scenes/transferPlan.js');
  it('is carried over from the file, and the fields it knows or stores itself are not', () => {
    const x = TP.tpExtraFields({ id: 's', name: 'Cave', polygons: [], edits: {}, mapBlob: 'x', thumbnail: 'y', future: { a: 1 }, other: 2 });
    assert.deepEqual(plain(x), { future: { a: 1 }, other: 2 });
  });
  it('is a copy of nothing for an entry that is not an object', () => {
    assert.deepEqual(TP.tpExtraFields(null), {});
  });
});

// ── Groups and roads on the Campaign map ─────────────────────────────────────

describe('a group or road deleted on one laptop', () => {
  const TP = require('../src/scenes/transferPlan.js');
  const sq = [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }];
  const pl = (name, uid, at) => ({ name, rec: { uid, vertices: sq, ...(at ? { edits: { shape: at, notes: at } } : {}) }, note: '' });
  const rd = (uid, at) => ({ rec: { name: 'Road', vertices: sq, ends: [], scenes: [], ...(at ? { edits: { shape: at, text: at } } : {}) }, note: '' });

  it('removes the group on Import when deleted after the other laptop last edited it, and not before', () => {
    const r = TP.tpMergePlaces([pl('Hills', 'u1', 300), pl('Fen', 'u2', 300)], [pl('Fen', 'u2', 300)], 1000, { here: {}, file: { u1: 500 } });
    assert.deepEqual(r.remove, ['Hills']);
    assert.deepEqual(plain(r.gone), { u1: 500 });
    const later = TP.tpMergePlaces([pl('Hills', 'u1', 700)], [], 1000, { here: {}, file: { u1: 500 } });
    assert.deepEqual(later.remove, []);
    assert.deepEqual(plain(later.gone), {});
  });
  it('does not add the group back from the laptop that has an older copy, but does for a later edit', () => {
    const old = TP.tpMergePlaces([], [pl('Hills', 'u1', 300)], 1000, { here: { u1: 500 }, file: {} });
    assert.deepEqual([old.add.length, plain(old.gone)], [0, { u1: 500 }]);
    const fresh = TP.tpMergePlaces([], [pl('Hills', 'u1', 800)], 1000, { here: { u1: 500 }, file: {} });
    assert.equal(fresh.add.length, 1);
    assert.deepEqual(plain(fresh.gone), {});
  });
  it('lets a deletion beat a group or road with no edit time, and changes nothing without records', () => {
    assert.deepEqual(TP.tpMergePlaces([pl('Hills', 'u1')], [], 1000, { here: {}, file: { u1: 5 } }).remove, ['Hills']);
    assert.equal(TP.tpMergePlaces([], [pl('Hills', 'u1')], 1000, { here: { u1: 5 }, file: {} }).add.length, 0);
    const none = TP.tpMergePlaces([pl('Hills', 'u1')], [pl('Hills', 'u1')], 1000);
    assert.deepEqual([none.remove, none.add.length], [[], 0]);
  });
  it('removes a road the same way, and keeps it out of the laptop that deleted it', () => {
    const a = TP.tpMergeRoads({ r1: rd('r1', 300), r2: rd('r2', 300) }, { r2: rd('r2', 300) }, 1000, { here: {}, file: { r1: 500 } });
    assert.deepEqual(a.remove, ['r1']);
    const b = TP.tpMergeRoads({}, { r1: rd('r1', 300) }, 1000, { here: { r1: 500 }, file: {} });
    assert.equal(b.add.length, 0);
    const c = TP.tpMergeRoads({}, { r1: rd('r1', 700) }, 1000, { here: { r1: 500 }, file: {} });
    assert.equal(c.add.length, 1);
    assert.deepEqual(plain(c.gone), {});
    assert.deepEqual(TP.tpMergeRoads({ r1: rd('r1') }, {}, 1000, { here: {}, file: { r1: 5 } }).remove, ['r1']);
  });
  it('travels in the file as `gone.places` and `gone.roads`', () => {
    const json = NP.notesCampaignPayload('', {}, {}, {}, {}, undefined, undefined, undefined, 0, { places: { u1: 5 }, roads: { r1: 6 } });
    const g = NP.notesParseGone(json);
    assert.deepEqual([plain(g.places), plain(g.roads)], [{ u1: 5 }, { r1: 6 }]);
  });
});
