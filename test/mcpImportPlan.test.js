'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/mcp/mcpImportPlan.js');

const entries = [
  { num: '1', name: 'Gate', title: '1. Gate', body: 'A rusted gate.' },
  { num: 'K12', name: 'Chapel', title: 'K12. Chapel', body: 'Pews and dust.' },
  { num: 'K13', name: 'Главный холл', title: 'K13. Главный холл', body: 'Высокий потолок.' },
  { num: 'K14', name: 'Chapel Crypt', title: 'K14. Chapel Crypt', body: 'Bones.' },
];

describe('mcpEntryFind', () => {
  it('finds an entry by its whole heading, its key or its name, in any case', () => {
    assert.equal(P.mcpEntryFind(entries, 'k12. chapel').entry.num, 'K12');
    assert.equal(P.mcpEntryFind(entries, 'K12').entry.num, 'K12');
    assert.equal(P.mcpEntryFind(entries, 'chapel').entry.num, 'K12');
    assert.equal(P.mcpEntryFind(entries, '  Главный   холл ').entry.num, 'K13');
  });

  it('takes the search\'s one hit for part of a heading', () => {
    assert.equal(P.mcpEntryFind(entries, 'crypt').entry.num, 'K14');
  });

  it('says which entries a heading could mean, or that none matches', () => {
    assert.match(P.mcpEntryFind(entries, 'chap').error, /More than one entry matches .*K12\. Chapel.*K14\. Chapel Crypt/);
    assert.match(P.mcpEntryFind(entries, 'Dragon lair').error, /No module entry is headed "Dragon lair"/);
    assert.match(P.mcpEntryFind(entries, '').error, /Give the heading/);
  });

  it('refuses a heading two entries share exactly', () => {
    const twice = entries.concat([{ num: '2', name: 'Gate', title: '2. Gate', body: '' }]);
    assert.match(P.mcpEntryFind(twice, 'gate').error, /More than one entry is headed "gate": "1\. Gate", "2\. Gate"/);
  });
});

describe('mcpEntryList', () => {
  it('lists every entry with its heading and excerpt, and filters as the name list does', () => {
    assert.deepEqual(P.mcpEntryList(entries, '').entries[1], { heading: 'K12. Chapel', excerpt: 'Pews and dust.' });
    assert.deepEqual(P.mcpEntryList(entries, 'chapel').entries.map(e => e.heading), ['K12. Chapel', 'K14. Chapel Crypt']);
  });

  it('caps the list and counts what matched', () => {
    const r = P.mcpEntryList(entries, '', 2);
    assert.equal(r.entries.length, 2);
    assert.equal(r.total, 4);
  });

  it('cuts an excerpt at a word, on one line', () => {
    const ex = P.mcpEntryExcerpt('one two\nthree four five', 12);
    assert.equal(ex, 'one two…');
    assert.equal(P.mcpEntryExcerpt('short'), 'short');
  });
});

describe('mcpLinkFill', () => {
  it('fills the name and the notes of a room with none', () => {
    assert.deepEqual(P.mcpLinkFill({ name: 'Room 1' }, entries[1], 'Room 1', false), { name: 'K12. Chapel', desc: 'Pews and dust.', kept: false });
  });

  it('keeps the DM\'s own notes unless told to replace them', () => {
    const room = { name: 'Room 1', desc: 'My notes.' };
    assert.deepEqual(P.mcpLinkFill(room, entries[1], 'Room 1', false), { name: 'K12. Chapel', desc: 'My notes.', kept: true });
    assert.equal(P.mcpLinkFill(room, entries[1], 'Room 1', true).desc, 'Pews and dust.');
  });
});

describe('the confirm replies', () => {
  it('counts what a floor plan would replace and draw', () => {
    const text = P.mcpPlanWould({ name: 'Crypt', roomsNow: 3, lightsNow: 2, rooms: 5, doors: 4, lights: 1 });
    assert.match(text, /^Nothing changed yet\. "Crypt" has 3 rooms and 2 lights drawn\. Loading the floor plan removes them and draws 5 rooms, 4 doors and 1 light from the plan\./);
    assert.match(text, /confirmed: true/);
  });

  it('leaves out lights the plan does not replace and parts at zero', () => {
    const text = P.mcpPlanWould({ name: 'Crypt', roomsNow: 1, lightsNow: 2, rooms: 2, doors: 0, lights: 0 });
    assert.match(text, /"Crypt" has 1 room drawn\. Loading the floor plan removes it and draws 2 rooms from the plan\./);
  });

  it('counts what a zip would add and update', () => {
    const text = P.mcpZipWould({ added: ['Keep', 'Cave'], updated: ['Town'], places: { added: 1, updated: 1 }, roads: { added: 0, updated: 1 } });
    assert.match(text, /would add 2 maps \("Keep", "Cave"\), update 1 map already here \("Town"\), add or change 2 groups, add or change 1 road\./);
    assert.match(text, /confirmed: true/);
  });

  it('refuses a zip that would replace an animation, naming the maps', () => {
    const text = P.mcpZipWould({ added: ['Keep'], updated: ['Fire'], replacesVideo: ['Fire', 'Rain'], places: { added: 0, updated: 0 }, roads: { added: 0, updated: 0 } });
    assert.equal(text, 'Not imported: the file would replace the animation of "Fire", "Rain", and Claude cannot bring an animation back. Ask the DM to import it in Evermist.');
  });

  it('says a zip with nothing new changes nothing', () => {
    assert.match(P.mcpZipWould({ added: [], updated: [], places: { added: 0, updated: 0 }, roads: { added: 0, updated: 0 } }), /already here/);
  });
});

describe('mcpPlanOpenWalls', () => {
  it('reports each open wall in percent of the map and grid squares', () => {
    assert.deepEqual(P.mcpPlanOpenWalls({ srcW: 1000, srcH: 500, gridPx: 100, openWalls: [{ x: 250, y: 100, gapPx: 150 }] }),
      [{ x: 25, y: 20, gapSquares: 1.5 }]);
    assert.deepEqual(P.mcpPlanOpenWalls({ srcW: 0, srcH: 0, gridPx: 0, openWalls: [{ x: 1, y: 1, gapPx: 1 }] }), []);
  });
});

describe('the floor plan as a part of a map', () => {
  const M = require('../src/mcp/mcpMapPlan.js');
  it('reads, writes and takes away a stored plan', () => {
    const keys = M.mcpMapKeys(['plan']);
    assert.deepEqual(keys, ['floorPlan']);
    assert.deepEqual(M.mcpMapRecordRead({ floorPlan: '{"a":1}' }, keys, {}), { floorPlan: '{"a":1}' });
    const rec = { floorPlan: 'old' };
    assert.equal(M.mcpMapRecordWrite(rec, { floorPlan: 'new' }, keys).floorPlan, 'new');
    assert.ok(!('floorPlan' in M.mcpMapRecordWrite(rec, { floorPlan: undefined }, keys)));
  });
});
