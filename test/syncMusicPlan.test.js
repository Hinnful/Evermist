'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/scenes/syncMusicPlan.js');
const { SY_TRASH_MS } = require('../src/scenes/syncPlan.js');

const H = c => c.repeat(64);
const DAY = 24 * 3600 * 1000;
const NOW = 100 * DAY;
const file = (owner, h, id) => ({ name: owner + '.' + h, id: id || 'id-' + owner + h.slice(0, 1) });

describe('the music folder against the last tick', () => {
  it('counts every track as old on the first look, so a deletion made elsewhere still reaches it', () => {
    const st = M.syMuObserve(M.syMuEmpty(), [{ name: 'A.mp3', hash: H('a'), size: 5 }], [], NOW);
    assert.equal(st.init, true);
    assert.deepEqual(st.tracks[H('a')], { name: 'A.mp3', size: 5, at: 0 });
  });
  it('notes a track added later at its time, and records one gone from the folder as deleted now', () => {
    let st = M.syMuObserve(M.syMuEmpty(), [{ name: 'A.mp3', hash: H('a') }], [], NOW);
    st = M.syMuObserve(st, [{ name: 'B.mp3', hash: H('b') }], [], NOW + 5);
    assert.equal(st.tracks[H('b')].at, NOW + 5);
    assert.equal(st.tracks[H('a')], undefined);
    assert.deepEqual(st.gone[H('a')], { at: NOW + 5, name: 'A.mp3' });
  });
  it('leaves a track in Claude\'s undo window, and one still in the folder unhashed, as neither gone nor new', () => {
    let st = M.syMuObserve(M.syMuEmpty(), [{ name: 'A.mp3', hash: H('a') }, { name: 'B.mp3', hash: H('b') }], [], NOW);
    st = M.syMuObserve(st, [{ name: 'B.mp3', hash: null }], [H('a')], NOW + 5);
    assert.deepEqual(Object.keys(st.gone), []);
    assert.ok(st.tracks[H('a')] && st.tracks[H('b')]);
  });
  it('undoes a deletion when the same track is added again by hand', () => {
    let st = M.syMuObserve(M.syMuEmpty(), [], [], NOW);
    st = { ...st, gone: { [H('a')]: { at: NOW - 10, name: 'A.mp3' } } };
    st = M.syMuObserve(st, [{ name: 'A again.mp3', hash: H('a') }], [], NOW);
    assert.equal(st.gone[H('a')].restoredAt, NOW);
    assert.deepEqual(M.syMuTrash(st.gone, {}), []);
  });
  it('keeps one name for two files of one content, and leaves out a name that is not a track', () => {
    const l = M.syMuLocal([{ name: 'b.mp3', hash: H('a') }, { name: 'a.mp3', hash: H('a') }, { name: '../x.mp3', hash: H('c') }, { name: 'n.txt', hash: H('d') }]);
    assert.deepEqual(Object.keys(l), [H('a')]);
    assert.equal(l[H('a')].name, 'a.mp3');
  });
});

describe('one tick\'s moves', () => {
  const base = (over) => ({ st: { init: true, tracks: {}, gone: {} }, list: [], remotes: [], files: [], first: false, busy: [], stashed: [], ...over });

  it('fetches a track another computer lists, under that computer\'s name, once its file is on the Drive', () => {
    const remotes = [{ machine: 'mB', rec: { tracks: { [H('a')]: { name: 'Theme.mp3', at: 5 } } } }];
    assert.deepEqual(M.syMuPlan(base({ remotes })).download, []);
    const p = M.syMuPlan(base({ remotes, files: [file('mB', H('a'), 'f1')] }));
    assert.deepEqual(p.download, [{ hash: H('a'), name: 'Theme.mp3', fileId: 'f1', fileName: 'mB.' + H('a') }]);
  });
  it('sends a track whose file no computer has sent, and not one already on the Drive under any owner', () => {
    const list = [{ name: 'A.mp3', hash: H('a') }, { name: 'B.mp3', hash: H('b') }];
    const p = M.syMuPlan(base({ list, files: [file('mB', H('b'))] }));
    assert.deepEqual(p.upload, [{ hash: H('a'), name: 'A.mp3' }]);
  });
  it('removes a track deleted elsewhere after it landed here, and waits while it plays', () => {
    const list = [{ name: 'A.mp3', hash: H('a') }];
    const st = { init: true, tracks: { [H('a')]: { name: 'A.mp3', at: 10 } }, gone: { [H('a')]: { at: 20, name: 'A.mp3' } } };
    assert.deepEqual(M.syMuPlan(base({ list, st })).remove, [{ hash: H('a'), name: 'A.mp3' }]);
    const held = M.syMuPlan(base({ list, st, busy: [H('a')] }));
    assert.deepEqual([held.remove.length, held.held, held.upload.length], [0, 1, 0]);
    assert.deepEqual(M.syMuPlan(base({ list, st, first: true })).remove, [], 'the first sync removes nothing');
  });
  it('keeps a track that landed here after the deletion', () => {
    const list = [{ name: 'A.mp3', hash: H('a') }];
    const st = { init: true, tracks: { [H('a')]: { name: 'A.mp3', at: 30 } }, gone: { [H('a')]: { at: 20, name: 'A.mp3' } } };
    assert.deepEqual(M.syMuPlan(base({ list, st })).remove, []);
  });
  it('does not fetch a deleted track another computer still lists, nor one in Claude\'s undo window', () => {
    const remotes = [{ machine: 'mB', rec: { tracks: { [H('a')]: { name: 'A.mp3', at: 5 }, [H('b')]: { name: 'B.mp3', at: 5 } } } }];
    const st = { init: true, tracks: {}, gone: { [H('a')]: { at: 20, name: 'A.mp3' } } };
    const p = M.syMuPlan(base({ st, remotes, stashed: [H('b')], files: [file('mB', H('a')), file('mB', H('b'))] }));
    assert.deepEqual(p.download, []);
  });
  it('fetches a restored track back from the Drive under its old name', () => {
    const st = { init: true, tracks: {}, gone: { [H('a')]: { at: 20, name: 'A.mp3', restoredAt: 30 } } };
    const p = M.syMuPlan(base({ st, files: [file('mA', H('a'), 'f9')] }));
    assert.deepEqual(p.download.map(d => [d.name, d.fileId]), [['A.mp3', 'f9']]);
  });
  it('deletes a purged track\'s files from the Drive, except on the first sync', () => {
    const st = { init: true, tracks: {}, gone: { [H('a')]: { at: 20, name: 'A.mp3', purged: true } } };
    assert.deepEqual(M.syMuPlan(base({ st, files: [file('mA', H('a'), 'f1'), file('mB', H('a'), 'f2')] })).purge, ['f1', 'f2']);
    assert.deepEqual(M.syMuPlan(base({ st, first: true, files: [file('mA', H('a'), 'f1')] })).purge, []);
  });
  it('calls a file loose only when no record lists it, no deletion keeps it and its owner has a record', () => {
    const records = [{ machine: 'mA', rec: { tracks: { [H('a')]: { name: 'A.mp3' } } } }];
    const gone = { [H('c')]: { at: 5 }, [H('d')]: { at: 5, purged: true } };
    const files = [file('mA', H('a')), file('mA', H('b')), file('mA', H('c')), file('mA', H('d')), file('mZ', H('e'))];
    assert.deepEqual(M.syMuLoose(files, records, gone), ['mA.' + H('b'), 'mA.' + H('d')]);
  });
});

describe('deletions and the 30-day trash', () => {
  it('merges two computers\' deletions: later times, a purge once either has it, the later name', () => {
    const g = M.syMuGoneMerge({ [H('a')]: { at: 5, name: 'old.mp3' } }, { [H('a')]: { at: 9, name: 'new.mp3', purged: true }, [H('b')]: { at: 1, name: 'b.mp3' } });
    assert.deepEqual(g[H('a')], { at: 9, name: 'new.mp3', purged: true });
    assert.ok(g[H('b')]);
  });
  it('lists the trash, restores from it, purges past 30 days, and cannot restore a purged track', () => {
    let g = { [H('a')]: { at: NOW - 31 * DAY, name: 'A.mp3' }, [H('b')]: { at: NOW - DAY, name: 'B.mp3' } };
    assert.deepEqual(M.syMuTrash(g, {}).map(x => x.name).sort(), ['A.mp3', 'B.mp3']);
    assert.deepEqual(M.syMuTrash(g, { [H('b')]: {} }).map(x => x.name), ['A.mp3']);
    assert.deepEqual(M.syMuTrashDue(g, NOW), [H('a')]);
    g = M.syMuPurge(g, M.syMuTrashDue(g, NOW));
    assert.equal(M.syMuRestore(g, H('a'), NOW), g);
    g = M.syMuRestore(g, H('b'), NOW);
    assert.deepEqual(M.syMuTrash(g, {}), []);
    assert.ok(SY_TRASH_MS === 30 * DAY);
  });
  it('lets a deletion stand only against a copy that landed before it', () => {
    assert.equal(M.syMuGoneWins({ at: 20 }, 10), true);
    assert.equal(M.syMuGoneWins({ at: 20 }, 30), false);
    assert.equal(M.syMuGoneWins({ at: 20, restoredAt: 25 }, 10), false);
    assert.equal(M.syMuGoneWins(undefined, 0), false);
  });
});

describe('groups', () => {
  const local = { [H('a')]: { name: 'A.mp3' }, [H('b')]: { name: 'B.mp3' } };
  it('reads this computer\'s groups by hash and keeps a group for a track still on its way', () => {
    const g = M.syMuGroupsFromLocal({ of: { 'A.mp3': 'Battle' }, order: ['Battle', 'Calm'], at: 7 }, local, { of: { [H('c')]: 'Calm' } });
    assert.deepEqual(g, { of: { [H('a')]: 'Battle', [H('c')]: 'Calm' }, order: ['Battle', 'Calm'], at: 7 });
  });
  it('keeps the later edit, and with none since the update combines everyone\'s', () => {
    const a = { machine: 'mA', groups: { of: { [H('a')]: 'X' }, order: ['X'], at: 5 } };
    const b = { machine: 'mB', groups: { of: { [H('a')]: 'Y' }, order: ['Y'], at: 9 } };
    assert.deepEqual(M.syMuGroupsPick([a, b]).order, ['Y']);
    assert.deepEqual(M.syMuGroupsPick([b, a]).order, ['Y']);
    const a0 = { machine: 'mA', groups: { of: { [H('a')]: 'X' }, order: ['X'], at: 0 } };
    const b0 = { machine: 'mB', groups: { of: { [H('a')]: 'Y', [H('b')]: 'Y' }, order: ['Y'], at: 0 } };
    assert.deepEqual(M.syMuGroupsPick([b0, a0]), { of: { [H('a')]: 'X', [H('b')]: 'Y' }, order: ['X', 'Y'], at: 0 });
  });
  it('writes the picked groups back by file name, and keeps what this computer said of an unhashed file', () => {
    const groups = { of: { [H('a')]: 'Battle' }, order: ['Battle'], at: 9 };
    const list = [{ name: 'A.mp3', hash: H('a') }, { name: 'B.mp3', hash: H('b') }, { name: 'C.mp3', hash: null }];
    const out = M.syMuGroupsToLocal(groups, local, { of: { 'B.mp3': 'Old', 'C.mp3': 'Calm', 'Gone.mp3': 'Z' } }, list);
    assert.deepEqual(out, { of: { 'A.mp3': 'Battle', 'C.mp3': 'Calm' }, order: ['Battle'], at: 9 });
  });
});

describe('the record', () => {
  it('reads back what it wrote, and refuses a newer format, a bad hash and a bad name', () => {
    const st = { tracks: { [H('a')]: { name: 'A.mp3', at: 3, size: 9 } }, gone: { [H('b')]: { at: 4, name: 'B.mp3' } }, groups: { of: { [H('a')]: 'G' }, order: ['G'], at: 2 } };
    const r = M.syMuRecordParse(M.syMuRecordText(st));
    assert.deepEqual(r.tracks, st.tracks);
    assert.deepEqual(r.gone, st.gone);
    assert.deepEqual(r.groups, st.groups);
    assert.equal(M.syMuRecordParse(JSON.stringify({ key: 'music', format: 99 })), null);
    assert.equal(M.syMuRecordParse('nope'), null);
    const bad = M.syMuRecordParse(JSON.stringify({ key: 'music', format: 1, tracks: { xyz: { name: 'a.mp3' }, [H('c')]: { name: '../a.mp3' } } }));
    assert.deepEqual(bad.tracks, {});
  });
  it('writes the same text for the same state whatever the key order', () => {
    const a = { tracks: { [H('a')]: { name: 'A.mp3', at: 1, size: 1 }, [H('b')]: { name: 'B.mp3', at: 1, size: 1 } }, gone: {}, groups: null };
    const b = { tracks: { [H('b')]: { size: 1, at: 1, name: 'B.mp3' }, [H('a')]: { name: 'A.mp3', size: 1, at: 1 } }, gone: {}, groups: null };
    assert.equal(M.syMuRecordText(a), M.syMuRecordText(b));
  });
});
