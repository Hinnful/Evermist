'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const N = require('../src/notes/notesPlan.js');
const { ROOM_DESC_MAX } = require('../src/rooms/roomPanel.js');

describe('notesCrumbs', () => {
  it('lists campaign and scene, and adds the room only while one is selected', () => {
    const base = { campaign: 'Campaign', scene: 'Crypt' };
    assert.deepEqual(N.notesCrumbs(base).map(c => c.level), ['campaign', 'scene']);
    const withRoom = N.notesCrumbs({ ...base, room: 'Hall' });
    assert.deepEqual(withRoom.map(c => c.level), ['campaign', 'scene', 'room']);
    assert.equal(withRoom[2].label, 'Hall');
  });
  it('shows a room with an empty name', () => {
    assert.equal(N.notesCrumbs({ campaign: 'C', scene: 'S', room: '' }).length, 3);
  });
});

describe('notesSanitize', () => {
  it('treats a missing note as empty and not dropped', () => {
    assert.deepEqual(N.notesSanitize(undefined), { text: '', dropped: false });
    assert.deepEqual(N.notesSanitize(null), { text: '', dropped: false });
  });
  it('drops a non-string and reports it', () => {
    for (const bad of [5, {}, ['a'], true]) assert.deepEqual(N.notesSanitize(bad), { text: '', dropped: true });
  });
  it('caps a string at the room limit', () => {
    assert.equal(N.notesSanitize('a'.repeat(ROOM_DESC_MAX + 50)).text.length, ROOM_DESC_MAX);
  });
});

describe('notesMergeCampaign', () => {
  it('keeps the existing note when the restored one is empty', () => {
    assert.equal(N.notesMergeCampaign('mine', '').text, 'mine');
    assert.equal(N.notesMergeCampaign('mine', undefined).text, 'mine');
  });
  it('takes the restored note when there is none', () => {
    assert.equal(N.notesMergeCampaign('', 'theirs').text, 'theirs');
    assert.equal(N.notesMergeCampaign('  \n', 'theirs').text, 'theirs');
  });
  it('appends below a separator when both exist', () => {
    assert.equal(N.notesMergeCampaign('mine', 'theirs').text, 'mine' + N.NOTES_SEPARATOR + 'theirs');
  });
  it('adds nothing the second time the same backup is restored', () => {
    const once = N.notesMergeCampaign('mine', 'theirs').text;
    assert.equal(N.notesMergeCampaign(once, 'theirs').text, once);
  });
  it('keeps the existing text and reports it when the join would pass the cap', () => {
    const cur = 'a'.repeat(ROOM_DESC_MAX - 5);
    const r = N.notesMergeCampaign(cur, 'bbbbbbbbbb');
    assert.equal(r.text, cur);
    assert.equal(r.tooLong, true);
  });
});

describe('campaign.json', () => {
  it('carries nothing when the notes are empty', () => {
    assert.equal(N.notesCampaignPayload(''), null);
    assert.equal(N.notesCampaignPayload('  \n'), null);
  });
  it('round-trips the notes', () => {
    assert.deepEqual(N.notesParseCampaign(N.notesCampaignPayload('lore')), { text: 'lore', broken: false });
  });
  it('treats a missing file as normal and a damaged one as broken', () => {
    assert.deepEqual(N.notesParseCampaign(null), { text: '', broken: false });
    for (const bad of ['{nope', 'null', '7', '{"notes": 5}']) assert.equal(N.notesParseCampaign(bad).broken, true, bad);
    assert.deepEqual(N.notesParseCampaign('{}'), { text: '', broken: false });
  });
});

describe('the Place crumb', () => {
  it('sits between the campaign and the scene, and only with a place', () => {
    const lv = names => N.notesCrumbs(names).map(c => c.level);
    assert.deepEqual(lv({ campaign: 'C', place: 'Vallaki', scene: 'Inn' }), ['campaign', 'place', 'scene']);
    assert.deepEqual(lv({ campaign: 'C', place: 'Vallaki', scene: 'Inn', room: 'Bar' }), ['campaign', 'place', 'scene', 'room']);
  });
  it('shows a place with no scene open', () => {
    assert.deepEqual(N.notesCrumbs({ campaign: 'C', place: 'Vallaki' }).map(c => c.level), ['campaign', 'place']);
  });
});

describe('place notes in campaign.json', () => {
  const places = o => Object.assign(N.notesPlacesNew(), o);

  it('carries the place notes beside the campaign note, and nothing when both are empty', () => {
    assert.equal(N.notesCampaignPayload('', places({})), null);
    assert.equal(N.notesCampaignPayload('', places({ Vallaki: '  ' })), null);
    assert.equal(N.notesCampaignPayload('lore'), JSON.stringify({ notes: 'lore' }));
    const both = JSON.parse(N.notesCampaignPayload('lore', places({ Vallaki: 'feast' })));
    assert.deepEqual(both, { notes: 'lore', places: { Vallaki: 'feast' } });
  });

  it('round-trips notes under a name that is also an Object property', () => {
    const src = places({ constructor: 'a', __proto__: 'b', toString: 'c', Plain: 'd' });
    src.__proto__ = 'b';
    const back = N.notesParsePlaces(N.notesCampaignPayload('', src));
    assert.equal(back.broken, false);
    assert.deepEqual(Object.keys(back.places).sort(), ['Plain', '__proto__', 'constructor', 'toString']);
    assert.equal(back.places.constructor, 'a');
    assert.equal(back.places.__proto__, 'b');
    assert.equal(Object.getPrototypeOf(back.places), null);
  });

  it('treats a missing places key and a missing file as normal', () => {
    assert.equal(N.notesParsePlaces(null).broken, false);
    assert.equal(N.notesParsePlaces('{"notes":"x"}').broken, false);
    assert.equal(Object.keys(N.notesParsePlaces('{}').places).length, 0);
  });

  it('drops a places that is an array, null or anything else, and says so', () => {
    for (const bad of ['[]', '["a"]', 'null', '7', '"s"', 'true']) {
      const r = N.notesParsePlaces('{"places":' + bad + '}');
      assert.equal(r.broken, true, bad);
      assert.equal(Object.keys(r.places).length, 0, bad);
    }
  });

  it('keeps the strings of a mixed places and reports the rest', () => {
    const r = N.notesParsePlaces('{"places":{"A":"keep","B":5,"C":{"x":1},"D":null,"E":["a"]}}');
    assert.equal(r.broken, true);
    assert.deepEqual(Object.keys(r.places), ['A']);
  });

  it('cleans each restored note through the same cap and trim', () => {
    const r = N.notesParsePlaces(JSON.stringify({ places: { A: '  hi  ', B: 'x'.repeat(ROOM_DESC_MAX + 9), C: '   ' } }));
    assert.equal(r.places.A, 'hi');
    assert.equal(r.places.B.length, ROOM_DESC_MAX);
    assert.equal(Object.keys(r.places).includes('C'), false);
  });

  it('leaves a file that does not parse to the campaign note to report', () => {
    assert.deepEqual([N.notesParsePlaces('{nope').broken, Object.keys(N.notesParsePlaces('{nope').places).length], [false, 0]);
  });
});

describe('notesMergePlaces', () => {
  const places = o => Object.assign(N.notesPlacesNew(), o);

  it('joins a restored note below the DM\'s own, and adds a new place whole', () => {
    const r = N.notesMergePlaces(places({ A: 'mine' }), places({ A: 'theirs', B: 'new' }));
    assert.equal(r.map.A, 'mine' + N.NOTES_SEPARATOR + 'theirs');
    assert.equal(r.map.B, 'new');
    assert.deepEqual(r.tooLong, []);
  });

  it('adds nothing on a second restore of the same backup', () => {
    const once = N.notesMergePlaces(places({ A: 'mine' }), places({ A: 'theirs' })).map;
    assert.equal(N.notesMergePlaces(once, places({ A: 'theirs' })).map.A, once.A);
  });

  it('keeps the DM\'s text and names the place when the join passes the cap', () => {
    const cur = 'a'.repeat(ROOM_DESC_MAX - 3);
    const r = N.notesMergePlaces(places({ A: cur }), places({ A: 'bbbbbbbb' }));
    assert.equal(r.map.A, cur);
    assert.deepEqual(r.tooLong, ['A']);
  });

  it('merges under a name that is also an Object property', () => {
    const r = N.notesMergePlaces(places({}), places({ constructor: 'x' }));
    assert.equal(r.map.constructor, 'x');
  });
});

describe('notesRenamePlace', () => {
  const places = o => Object.assign(N.notesPlacesNew(), o);

  it('moves the notes to the new name', () => {
    const r = N.notesRenamePlace(places({ Old: 'text' }), 'Old', 'New');
    assert.deepEqual(Object.keys(r.map), ['New']);
    assert.equal(r.map.New, 'text');
  });

  it('joins onto the notes of a place it merges with', () => {
    const r = N.notesRenamePlace(places({ Old: 'a', New: 'b' }), 'Old', 'New');
    assert.equal(r.map.New, 'b' + N.NOTES_SEPARATOR + 'a');
    assert.equal(Object.keys(r.map).length, 1);
  });

  it('does nothing for a place with no notes, or for the same name', () => {
    assert.deepEqual(Object.keys(N.notesRenamePlace(places({ X: 'a' }), 'Old', 'New').map), ['X']);
    assert.deepEqual(Object.keys(N.notesRenamePlace(places({ X: 'a' }), 'X', 'X').map), ['X']);
  });

  it('leaves the notes under the old name when the join would pass the cap', () => {
    const big = 'a'.repeat(ROOM_DESC_MAX - 2);
    const r = N.notesRenamePlace(places({ Old: 'bbbbbb', New: big }), 'Old', 'New');
    assert.equal(r.kept, true);
    assert.equal(r.map.Old, 'bbbbbb');
    assert.equal(r.map.New, big);
  });

  it('renames a place called "constructor"', () => {
    const r = N.notesRenamePlace(places({ constructor: 'x' }), 'constructor', 'Ctor');
    assert.equal(r.map.Ctor, 'x');
    assert.equal(Object.keys(r.map).includes('constructor'), false);
  });

  it('does not touch the map it was handed', () => {
    const src = places({ Old: 'a' });
    N.notesRenamePlace(src, 'Old', 'New');
    assert.deepEqual(Object.keys(src), ['Old']);
  });
});

describe('road notes', () => {
  const places = o => Object.assign(N.notesPlacesNew(), o);
  const road = { name: 'Old Road', vertices: [{ x: 0, y: 0 }, { x: 5, y: 5 }], ends: [{ kind: null }, { kind: null }], scenes: [] };

  it('adds a road crumb after the place and before the scene', () => {
    const c = N.notesCrumbs({ campaign: 'Campaign', road: 'Old Road' });
    assert.deepEqual(c.map(x => x.level), ['campaign', 'road']);
    assert.equal(c[1].label, 'Old Road');
  });

  it('carries roads and their notes, and a note for a road that is gone stays behind', () => {
    const out = JSON.parse(N.notesCampaignPayload('', null, null, { r1: road }, places({ r1: 'ambush here', r2: 'old note' })));
    assert.deepEqual(Object.keys(out.roads), ['r1']);
    assert.deepEqual(out.roadNotes, { r1: 'ambush here' });
  });

  it('writes nothing for a campaign with no roads', () => {
    assert.equal(N.notesCampaignPayload('', null, null, {}, places({ r1: 'x' })), null);
  });

  it('reads road notes back, and calls a bad one broken', () => {
    const raw = N.notesCampaignPayload('', null, null, { r1: road }, places({ r1: 'ambush here' }));
    assert.deepEqual({ ...N.notesParseRoadNotes(raw).notes }, { r1: 'ambush here' });
    assert.equal(N.notesParseRoadNotes('{"roadNotes":{"r1":5}}').broken, true);
    assert.equal(N.notesParseRoadNotes('{"notes":"x"}').broken, false);
    assert.equal(N.notesParseRoadNotes('nope').broken, false);
  });

  it('moves notes to new keys and drops the ones with no key', () => {
    const out = N.notesRekey(places({ a: 'one', b: 'two' }), { a: 'a2' });
    assert.deepEqual({ ...out }, { a2: 'one' });
  });

  it('rekeys a road called __proto__ without touching the prototype', () => {
    const keys = Object.create(null);
    keys.__proto__ = 'safe';
    const src = Object.create(null);
    src.__proto__ = 'note';
    const out = N.notesRekey(src, keys);
    assert.equal(out.safe, 'note');
    assert.equal(Object.getPrototypeOf(out), null);
  });
});
