'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/notes/mentionPlan.js');
const { notesSanitize } = require('../src/notes/notesPlan.js');
const { neSetNote } = require('../src/notes/notesEntriesPlan.js');
const { sanitizeRoomDesc } = require('../src/rooms/roomPanel.js');

const LADY = '@[Lady Wachter](monster:m3kq9z1a)';

describe('mentionPlan: the stored form', () => {
  it('parses a token and the words around it', () => {
    const p = M.mpParse('Ask ' + LADY + ' about the key.');
    assert.equal(p.length, 3);
    assert.deepEqual([p[1].name, p[1].kind, p[1].id], ['Lady Wachter', 'monster', 'm3kq9z1a']);
    assert.equal(p.map(x => (x.text !== undefined ? x.text : x.raw)).join(''), 'Ask ' + LADY + ' about the key.');
  });

  it('writes and reads back a name with a bracket, a backslash and a newline', () => {
    const tok = M.mpToken('A] b\\c\nd', 'entry', 'e1');
    assert.equal(tok, '@[A\\] b\\\\c d](entry:e1)');
    assert.equal(M.mpParse(tok)[0].name, 'A] b\\c d');
  });

  it('reads a room by its scene and uid, and refuses one with a wrong shape', () => {
    assert.equal(M.mpParse('@[N4](room:s-1:legacy-5)')[0].kind, 'room');
    assert.equal(M.mpParse('@[N4](room:only)')[0].kind, undefined);
    assert.equal(M.mpParse('@[N4](room:a:b:c)')[0].kind, undefined);
  });

  it('keeps a malformed or cut token as plain words and never swallows what follows', () => {
    const bad = ['@[x](monster:', '@[x](monster:a b)', '@[x](bogus:a)', '@[x](monster:a', '@[](monster:a)', '@[x]monster:a', '@[x\ny](monster:a)', '@[x](monster:' + 'a'.repeat(81) + ')'];
    for (const b of bad) {
      const text = b + ' and ' + LADY;
      const p = M.mpParse(text);
      assert.equal(p.filter(x => x.kind).length, 1, b);
      assert.equal(p.filter(x => x.kind)[0].name, 'Lady Wachter');
      assert.equal(M.mpPlain(text), b + ' and Lady Wachter');
    }
  });

  it('a token cut in the middle by an older save is plain words', () => {
    assert.equal(M.mpPlain('see @[Lady Wach').length, 'see @[Lady Wach'.length);
    assert.equal(M.mpMentions('see @[Lady Wachter](monster:m3').length, 0);
  });

  it('plain words are the shown names, which is what search reads', () => {
    assert.equal(M.mpPlain('A letter from ' + LADY + '.'), 'A letter from Lady Wachter.');
    assert.equal(M.mpPlain(null), '');
  });

  it('finds the mentions of one id', () => {
    const t = 'x ' + LADY + ' y @[N4](room:s1:u1)';
    assert.ok(M.mpFindRef(t, M.mpRef('monster', 'm3kq9z1a')));
    assert.ok(M.mpFindRef(t, M.mpRef('room', 's1:u1')));
    assert.ok(!M.mpFindRef(t, M.mpRef('monster', 'other')));
  });
});

describe('mentionPlan: rename, cap, remap', () => {
  const cap = 20000;
  it('a rename shows in the note at its next refresh and nothing else changes', () => {
    const r = M.mpRefresh('Ask ' + LADY + '.', (k, id) => (id === 'm3kq9z1a' ? 'Lady W' : null), cap);
    assert.equal(r.text, 'Ask @[Lady W](monster:m3kq9z1a).');
    assert.ok(r.changed);
    assert.equal(M.mpRefresh('Ask ' + LADY, () => null, cap).changed, false);
  });

  it('a refresh that would pass the cap is refused and cuts nothing', () => {
    const text = LADY + 'x'.repeat(cap - LADY.length);
    const r = M.mpRefresh(text, () => 'A much longer name than before', cap);
    assert.equal(r.refused, true);
    assert.equal(r.text, text);
  });

  it('a note at the cap refuses a mention that would pass it', () => {
    const text = 'x'.repeat(cap - 5);
    assert.equal(M.mpFits(text, M.mpToken('Lady', 'monster', 'm1'), cap), false);
    assert.equal(M.mpFits('short', M.mpToken('Lady', 'monster', 'm1'), cap), true);
  });

  it('remaps a renumbered map, its rooms and a group, leaving the rest', () => {
    const text = '@[M](map:old1) @[R](room:old1:u9) @[R2](room:keep:u9) @[G](group:g1) ' + LADY;
    const r = M.mpRemap(text, { old1: 'new1' }, { g1: 'g2' }, cap);
    assert.equal(r.text, '@[M](map:new1) @[R](room:new1:u9) @[R2](room:keep:u9) @[G](group:g2) ' + LADY);
    assert.equal(r.skipped, 0);
  });

  it('a remap that would pass the cap leaves that mention unchanged and counts it', () => {
    const tok = '@[M](map:a)';
    const text = tok + 'x'.repeat(cap - tok.length);
    const r = M.mpRemap(text, { a: 'abcdef' }, {}, cap);
    assert.equal(r.text, text);
    assert.equal(r.skipped, 1);
  });

  it('ranks names that start with the query first', () => {
    const list = [{ name: 'The Wachter house' }, { name: 'Wachter' }, { name: 'Other' }];
    assert.deepEqual(M.mpRank(list, 'wach', 5).map(x => x.name), ['Wachter', 'The Wachter house']);
  });
});

describe('mentionPlan: group uids', () => {
  it('survive a save and reload as JSON', () => {
    const m = M.mpGroupUidsNew();
    m['constructor'] = 'g12';
    const back = M.mpGroupUidsClean(JSON.parse(JSON.stringify(m)));
    assert.equal(back['constructor'], 'g12');
  });

  it('a rename moves the uid, and a name that is not a valid id is dropped', () => {
    const m = M.mpGroupUidsClean({ Old: 'g1', Bad: 'has space' });
    assert.equal(M.mpGroupNameOf(m, 'g1'), 'Old');
    assert.equal(M.mpGroupUidsRename(m, 'Old', 'New')['New'], 'g1');
    assert.equal(Object.keys(m).length, 1);
  });

  it('a transfer maps the file uid onto the local one and adopts a name with none', () => {
    const r = M.mpGroupUidsMerge({ Town: 'gl' }, { Town: 'gf', Keep: 'gk' }, []);
    assert.equal(r.remap.gf, 'gl');
    assert.equal(r.keep.Keep, 'gk');
    const renamed = M.mpGroupUidsMerge({ Old: 'gl' }, { New: 'gf' }, [{ from: 'Old', to: 'New' }]);
    assert.equal(renamed.remap.gf, 'gl');
  });
});

describe('mentionPlan: the load and save path keeps the stored form', () => {
  it('notesSanitize, sanitizeRoomDesc and an entry note keep a note with mentions byte for byte', () => {
    const note = 'Ask ' + LADY + ' about @[N4](room:s1:u1) and\n@[Back \\] slash](entry:e1).';
    assert.equal(notesSanitize(note).text, note);
    assert.equal(sanitizeRoomDesc(note), note);
    assert.equal(neSetNote([{ id: 'e', note: '' }], 'e', note)[0].note, note);
  });
});

describe('a transfer import that renumbers a map', () => {
  const { tpSceneIds } = require('../src/scenes/transferPlan.js');
  it('keeps the mentions of that map and its rooms blue', () => {
    const manifest = [{ id: 'has space' }, { id: 'taken' }, { id: 'fine' }];
    let n = 0;
    const items = tpSceneIds(manifest, new Set(['x']), id => /^[0-9a-zA-Z_-]+$/.test(id), () => 'fresh' + ++n);
    const maps = {};
    for (const x of items) if (x.entry.id !== x.id) maps[x.entry.id] = x.id;
    assert.deepEqual(maps, { 'has space': 'fresh1' });
    const note = '@[M](map:has space) is not a token, but @[R](room:taken:u1) and @[M2](map:fine) are.';
    const r = M.mpRemap(note, { taken: 'fresh9' }, {}, 20000);
    assert.ok(r.text.includes('@[R](room:fresh9:u1)') && r.text.includes('@[M2](map:fine)'));
  });
});

describe('the campaign.json writer carries the group uids', () => {
  const { notesCampaignPayload } = require('../src/notes/notesPlan.js');
  it('writes them, and a file with only them is still a file', () => {
    const json = notesCampaignPayload('', {}, {}, {}, {}, null, [], { Town: 'g1' });
    assert.deepEqual(M.mpParseGroupUids(json), Object.assign(M.mpGroupUidsNew(), { Town: 'g1' }));
    assert.equal(notesCampaignPayload('', {}, {}, {}, {}, null, [], {}), null);
  });
});
