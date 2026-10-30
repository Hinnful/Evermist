'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/search/searchPlan.js');

describe('wfRank', () => {
  it('ranks the whole name, its start, a word start and a middle in that order', () => {
    assert.equal(F.wfRank('Inn', 'inn'), 0);
    assert.equal(F.wfRank('Inner Keep', 'inn'), 1);
    assert.equal(F.wfRank('The Inn', 'inn'), 2);
    assert.equal(F.wfRank('Skinner', 'inn'), 3);
    assert.equal(F.wfRank('Market', 'inn'), -1);
  });
  it('never matches an empty query or name', () => {
    assert.equal(F.wfRank('Inn', ''), -1);
    assert.equal(F.wfRank('', 'a'), -1);
  });
});

describe('wfHit', () => {
  it('says where the query sits, ignoring case', () => {
    assert.deepEqual(F.wfHit('The Inn', 'inn'), { at: 4, len: 3 });
    assert.equal(F.wfHit('Market', 'inn'), null);
  });
});

const e = (kind, name, text, id) => ({ key: kind + ':' + (id || name), kind, name, text: text || '' });

describe('spSearch', () => {
  const list = [
    e('map', 'The Inn'), e('map', 'Inn'), e('room', 'Inn Cellar', 'barrels'), e('road', 'Inn road'),
    e('place', 'Inner Marsh'), e('monster', 'Innkeeper'), e('music', 'Tavern', 'an inn song'),
  ];
  it('orders rows in a group by rank, equal ranks in the order given', () => {
    const f = F.spSearch(' INN ', list);
    assert.deepEqual(f.groups.find(g => g.id === 'map').rows.map(r => r.entry.name), ['Inn', 'The Inn']);
    const eq = F.spSearch('a', [e('map', 'Alpha'), e('map', 'Atlas')]);
    assert.deepEqual(eq.groups[0].rows.map(r => r.entry.name), ['Alpha', 'Atlas']);
  });
  it('orders groups by their own strongest result', () => {
    const f = F.spSearch('inn', list);
    assert.deepEqual(f.groups.map(g => g.id), ['map', 'room', 'place', 'monster', 'music']);
    const g = F.spSearch('cellar', [e('room', 'Cellar'), e('map', 'Wine cellar')]);
    assert.deepEqual(g.groups.map(x => x.id), ['room', 'map']);
  });
  it('puts maps first on a tie, then rooms, groups and roads, monsters, fights, music, pictures', () => {
    const all = ['picture', 'music', 'fight', 'monster', 'road', 'room', 'map'].map(k => e(k, 'Cellar'));
    assert.deepEqual(F.spSearch('cellar', all).groups.map(x => x.id), ['map', 'room', 'place', 'monster', 'fight', 'music', 'picture']);
  });
  it('ranks a hit in a note below any name hit', () => {
    const f = F.spSearch('inn', list);
    assert.equal(f.groups.find(x => x.id === 'music').rows[0].rank, F.SP_NOTE);
    assert.equal(F.spRank(e('map', 'Cellar', 'a dark inn'), 'inn'), F.SP_NOTE);
    assert.equal(F.spRank(e('map', 'Cellar', 'dark'), 'inn'), -1);
  });
  it('puts a road and the campaign notes with the groups', () => {
    const f = F.spSearch('inn', [e('road', 'Inn road'), e('campaign', 'Campaign notes', 'the inn')]);
    assert.deepEqual(f.groups.map(g => g.id), ['place']);
    assert.equal(f.groups[0].total, 2);
  });
  it('shows five a group, counts the rest, and opens a group whole', () => {
    const many = Array.from({ length: 8 }, (_, i) => e('map', 'Room ' + i));
    const f = F.spSearch('room', many);
    assert.equal(f.groups[0].rows.length, 5);
    assert.equal(f.groups[0].more, 3);
    const all = F.spSearch('room', many, new Set(['map']));
    assert.equal(all.groups[0].rows.length, 8);
    assert.equal(all.groups[0].more, 0);
    assert.equal(all.total, 8);
  });
  it('shows a result once however often it is listed', () => {
    const f = F.spSearch('inn', [e('map', 'Inn', '', 'a'), e('map', 'Inn', '', 'a')]);
    assert.equal(F.spFlat(f).length, 1);
  });
  it('answers nothing for an empty query', () => {
    assert.deepEqual(F.spSearch('  ', list), { groups: [], total: 0 });
  });
  it('walks the groups in order, so the first row is the best match', () => {
    assert.equal(F.spFlat(F.spSearch('inn', list))[0].entry.name, 'Inn');
  });
});

describe('spSnippet', () => {
  it('starts on a whole word and marks where the note goes on', () => {
    const s = F.spSnippet('Two goblins watch the trail from behind a thicket. DC 10 Stealth to sneak past the wolves.', 'stealth');
    assert.equal(s.hit, 'Stealth');
    assert.equal(s.pre, '…a thicket. DC 10 ');
    assert.equal(s.post, ' to sneak past the wolves.');
  });
  it('shows a note start whole, and folds newlines to a space', () => {
    assert.deepEqual(F.spSnippet('Klarg\nholds the loot', 'klarg'), { pre: '', hit: 'Klarg', post: ' holds the loot' });
  });
  it('cuts the end with an ellipsis', () => {
    const s = F.spSnippet('needle ' + 'word '.repeat(30), 'needle');
    assert.ok(s.post.endsWith('…'));
  });
  it('is null when the note does not hold it', () => {
    assert.equal(F.spSnippet('nothing here', 'klarg'), null);
  });
  it('never starts inside a word, even a very long one', () => {
    const s = F.spSnippet('a'.repeat(60) + ' needle b', 'needle');
    assert.equal(s.pre, '…');
  });
});

describe('the recent list', () => {
  it('puts the newest first, once, and keeps six', () => {
    let l = [];
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) l = F.spRecentAdd(l, k);
    assert.deepEqual(l, ['g', 'f', 'e', 'd', 'c', 'b']);
    assert.deepEqual(F.spRecentAdd(l, 'd'), ['d', 'g', 'f', 'e', 'c', 'b']);
  });
  it('reads a list that is not one as empty', () => {
    assert.deepEqual(F.spRecentAdd(null, 'a'), ['a']);
  });
  it('lists only what still exists, in order', () => {
    const rows = F.spRecentRows(['map:1', 'map:gone', 'room:2'], [e('room', 'R', '', '2'), e('map', 'M', '', '1')]);
    assert.deepEqual(rows.map(r => r.key), ['map:1', 'room:2']);
  });
});

describe("factions, lore and a monster's DM note", () => {
  const entries = [
    { id: "f1", kind: "faction", name: "Vistani", note: "Travelling folk", parent: "faction", order: 0 },
    { id: "l1", kind: "lore", name: "Artifacts", note: "", parent: "lore", order: 0 },
    { id: "l2", kind: "lore", name: "Sunsword", note: "A blade of sunlight", parent: "l1", order: 0 },
  ];
  const rows = F.spNoteRows(entries, k => (k === "faction" ? "Factions" : "Lore"));
  it("makes one row per entry, under its parent or its section", () => {
    assert.deepEqual(rows.map(r => [r.key, r.kind, r.where]), [["entry:f1", "faction", "Factions"], ["entry:l1", "lore", "Lore"], ["entry:l2", "lore", "Artifacts"]]);
  });
  it("finds an entry by name and by its note, and a monster by its DM note", () => {
    const all = rows.concat([{ key: "monster:b1", kind: "monster", id: "b1", name: "Lady Wachter", text: "Plots against the Baron" }]);
    assert.deepEqual(F.spSearch("sunsword", all).groups.map(g => g.id), ["lore"]);
    assert.equal(F.spSearch("travelling", all).groups[0].rows[0].rank, F.SP_NOTE);
    const m = F.spSearch("baron", all).groups[0];
    assert.equal(m.id, "monster");
    assert.equal(m.rows[0].rank, F.SP_NOTE);
  });
  it("lists their groups after monsters and before fights", () => {
    const ids = F.SP_GROUPS.map(g => g.id);
    assert.deepEqual(ids.slice(ids.indexOf("monster"), ids.indexOf("monster") + 4), ["monster", "faction", "lore", "fight"]);
  });
});
