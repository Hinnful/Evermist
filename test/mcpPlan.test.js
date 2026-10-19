'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { combatBlankBlock } = require('../src/combat/combatPlan.js');
const { MCP_GAP, MCP_HISTORY_MAX, mcpRectArg, mcpCleanHex, mcpGridSize, mcpReplace, mcpHistoryPush, mcpOnTv, mcpAppend, mcpFreeRect, mcpMatchMonster, mcpSuggest, mcpFightRows, mcpEditRows, mcpFindScenes } = require('../src/mcp/mcpPlan.js');

const block = (id, name, extra) => Object.assign(combatBlankBlock(id, name), { ac: '15 (leather armor)' }, extra);
const blocks = { b1: block('b1', 'Goblin'), b2: block('b2', 'Goblin Boss'), b3: block('b3', 'Owlbear'), b4: block('b4', 'Wolf') };
const apart = (a, b) => a.x >= b.x + b.w + MCP_GAP || b.x >= a.x + a.w + MCP_GAP || a.y >= b.y + b.h + MCP_GAP || b.y >= a.y + a.h + MCP_GAP;

describe('mcpAppend', () => {
  it('puts the text below the DM\'s after a blank line', () => {
    assert.deepEqual(mcpAppend('Mine.', 'Claude\'s.', 100), { text: 'Mine.\n\nClaude\'s.' });
  });
  it('takes the text alone when there are no notes yet', () => {
    assert.deepEqual(mcpAppend('', '  New.  ', 100), { text: 'New.' });
    assert.deepEqual(mcpAppend(undefined, 'New.', 100), { text: 'New.' });
  });
  it('refuses the whole text past the cap and keeps the DM\'s', () => {
    assert.deepEqual(mcpAppend('12345', '67890', 8), { text: '12345', tooLong: true });
  });
  it('reports empty text and changes nothing', () => {
    assert.deepEqual(mcpAppend('Mine.', '   ', 100), { text: 'Mine.', empty: true });
  });
});

describe('mcpFreeRect', () => {
  it('centres on the origin of an empty map', () => {
    const r = mcpFreeRect([], 100, 50);
    assert.deepEqual(r, { x: -50, y: -25, w: 100, h: 50 });
  });
  it('lands clear of every place and card', () => {
    const taken = [{ x: 0, y: 0, w: 400, h: 300 }, { x: 500, y: 0, w: 110, h: 77 }, { x: 0, y: 400, w: 400, h: 300 }];
    const r = mcpFreeRect(taken, 360, 260);
    assert.equal(r.w, 360);
    for (const t of taken) assert.ok(apart(r, t), JSON.stringify({ r, t }));
  });
  it('stays near the middle of what is there', () => {
    const r = mcpFreeRect([{ x: 0, y: 0, w: 100, h: 100 }], 100, 100);
    assert.ok(Math.hypot(r.x, r.y) < 400, JSON.stringify(r));
  });
});

describe('mcpMatchMonster', () => {
  it('matches the exact name in any case before a longer one', () => {
    assert.equal(mcpMatchMonster(blocks, 'goblin').id, 'b1');
  });
  it('takes the one name that starts with the query', () => {
    assert.equal(mcpMatchMonster(blocks, 'owl').id, 'b3');
  });
  it('matches nothing when the start fits two names, or none', () => {
    assert.equal(mcpMatchMonster({ b1: block('b1', 'Goblin Boss'), b2: block('b2', 'Goblin Archer') }, 'Goblin'), null);
    assert.equal(mcpMatchMonster(blocks, 'Beholder'), null);
    assert.equal(mcpMatchMonster(blocks, ''), null);
  });
});

describe('mcpSuggest', () => {
  it('offers names sharing a word with the one that missed', () => {
    assert.deepEqual(mcpSuggest(blocks, 'Dire Wolf'), ['Wolf']);
    assert.deepEqual(mcpSuggest(blocks, 'Beholder'), []);
  });
});

describe('mcpFightRows', () => {
  it('builds a row per creature, numbered, from the bestiary', () => {
    const r = mcpFightRows(blocks, [{ name: 'Goblin', count: 3 }, { name: 'Wolf', side: 'ally' }], 10);
    assert.deepEqual(r.rows.map(x => [x.id, x.name, x.side, x.ac]), [
      [10, 'Goblin', 'enemy', '15'], [11, 'Goblin 2', 'enemy', '15'], [12, 'Goblin 3', 'enemy', '15'], [13, 'Wolf', 'ally', '15'],
    ]);
    assert.equal(r.nextId, 14);
    assert.equal(r.rows[0].sb.name, 'Goblin');
    assert.deepEqual(r.missing, []);
  });
  it('leaves out a monster the bestiary lacks and names it', () => {
    const r = mcpFightRows(blocks, [{ name: 'Goblin' }, { name: 'Dire Wolf', count: 2 }], 1);
    assert.equal(r.rows.length, 1);
    assert.deepEqual(r.missing, [{ name: 'Dire Wolf', suggest: ['Wolf'] }]);
  });
  it('keeps a count between 1 and 20', () => {
    assert.equal(mcpFightRows(blocks, [{ name: 'Wolf', count: 99 }], 1).rows.length, 20);
    assert.equal(mcpFightRows(blocks, [{ name: 'Wolf', count: 0 }], 1).rows.length, 1);
  });
  it('takes no monsters at all as an empty fight', () => {
    assert.deepEqual(mcpFightRows(blocks, undefined, 5), { rows: [], missing: [], nextId: 5 });
  });
});

describe('mcpFindScenes', () => {
  const scenes = [{ id: 'a', name: 'Hall', group: 'Amber Temple' }, { id: 'b', name: 'Hall', group: 'Castle' }, { id: 'c', name: 'Crypt', group: '' }];
  it('finds by name in any case, narrowed by place', () => {
    assert.deepEqual(mcpFindScenes(scenes, 'hall').map(s => s.id), ['a', 'b']);
    assert.deepEqual(mcpFindScenes(scenes, 'Hall', 'castle').map(s => s.id), ['b']);
    assert.deepEqual(mcpFindScenes(scenes, 'Nowhere'), []);
  });
});

describe('mcpReplace', () => {
  it('replaces whole, trims, clears on empty and refuses over the cap', () => {
    assert.deepEqual(mcpReplace('  new  ', 10), { text: 'new' });
    assert.deepEqual(mcpReplace('', 10), { text: '' });
    assert.deepEqual(mcpReplace('x'.repeat(11), 10), { tooLong: true });
  });
});

describe('mcpHistoryPush', () => {
  it('keeps the newest steps and drops the oldest', () => {
    const list = [];
    for (let i = 0; i < 35; i++) mcpHistoryPush(list, { label: 'n' + i });
    assert.equal(list.length, MCP_HISTORY_MAX);
    assert.equal(list[0].label, 'n5');
    assert.equal(list[list.length - 1].label, 'n34');
  });
});

describe('mcpOnTv', () => {
  const base = { playerOpen: true, held: false, panes: false, isOpen: true, inColumn: false };
  it('is true for the open scene while a Player window shows it', () => {
    assert.equal(mcpOnTv(base), true);
  });
  it('is false with no Player window, or while the TV is held clear', () => {
    assert.equal(mcpOnTv({ ...base, playerOpen: false }), false);
    assert.equal(mcpOnTv({ ...base, held: true }), false);
  });
  it('is false for a scene the DM has not opened', () => {
    assert.equal(mcpOnTv({ ...base, isOpen: false }), false);
  });
  it('follows the columns in two-map mode', () => {
    assert.equal(mcpOnTv({ ...base, panes: true, isOpen: false, inColumn: true }), true);
    assert.equal(mcpOnTv({ ...base, panes: true, isOpen: true, inColumn: false }), false);
  });
});

describe('mcpCleanHex', () => {
  it('reads three and six digit colours with or without the hash', () => {
    assert.equal(mcpCleanHex('#ABC'), '#aabbcc');
    assert.equal(mcpCleanHex('336699'), '#336699');
  });
  it('refuses anything else', () => {
    for (const bad of ['', 'blue', '#12', '#12345g', null]) assert.equal(mcpCleanHex(bad), null);
  });
});

describe('mcpGridSize', () => {
  it('rounds and keeps the control\'s range', () => {
    assert.equal(mcpGridSize('70.4'), 70);
    assert.equal(mcpGridSize(10), 10);
    assert.equal(mcpGridSize(400), 400);
  });
  it('refuses a size outside it or not a number', () => {
    for (const bad of [9, 401, 'big', undefined, NaN]) assert.equal(mcpGridSize(bad), null);
  });
});

describe('mcpRectArg', () => {
  it('rounds a rectangle that can hold a card', () => {
    assert.deepEqual(mcpRectArg({ x: '10.4', y: -20, w: 300.6, h: 200 }), { x: 10, y: -20, w: 301, h: 200 });
  });
  it('refuses a missing number or a rectangle too small for a card', () => {
    assert.equal(mcpRectArg({ x: 0, y: 0, w: 300 }), null);
    assert.equal(mcpRectArg({ x: 0, y: 0, w: 100, h: 200 }), null);
    assert.equal(mcpRectArg({ x: 0, y: 0, w: 300, h: 50 }), null);
    assert.equal(mcpRectArg(null), null);
  });
});

describe('mcpEditRows', () => {
  const start = mcpFightRows(blocks, [{ name: 'Goblin', count: 3 }, { name: 'Wolf' }], 1);
  const names = rows => rows.map(r => r.name).join();

  it('removes the last copies, or all when no count is given', () => {
    assert.equal(names(mcpEditRows(blocks, start.rows, { remove: [{ name: 'goblin', count: 1 }] }, start.nextId).rows), 'Goblin,Goblin 2,Wolf');
    assert.equal(names(mcpEditRows(blocks, start.rows, { remove: [{ name: 'Goblin' }] }, start.nextId).rows), 'Wolf');
  });
  it('sets a count, adding copies of the same creature or dropping the last ones', () => {
    const more = mcpEditRows(blocks, start.rows, { counts: [{ name: 'Wolf', count: 2 }] }, start.nextId);
    assert.equal(names(more.rows), 'Goblin,Goblin 2,Goblin 3,Wolf,Wolf 2');
    assert.equal(more.nextId, start.nextId + 1);
    assert.equal(new Set(more.rows.map(r => r.id)).size, more.rows.length);
    assert.equal(names(mcpEditRows(blocks, start.rows, { counts: [{ name: 'Goblin', count: 1 }] }, start.nextId).rows), 'Goblin,Wolf');
  });
  it('changes a side and adds monsters from the bestiary, naming one it lacks', () => {
    const r = mcpEditRows(blocks, start.rows, { sides: [{ name: 'Wolf', side: 'ally' }], add: [{ name: 'Owlbear' }, { name: 'Beholder' }] }, start.nextId);
    assert.equal(r.rows.find(x => x.name === 'Wolf').side, 'ally');
    assert.equal(r.rows[r.rows.length - 1].name, 'Owlbear');
    assert.deepEqual(r.missing.map(m => m.name), ['Beholder']);
  });
  it('reports nothing changed, and a monster that is not in the fight', () => {
    const r = mcpEditRows(blocks, start.rows, { remove: [{ name: 'Dragon' }] }, start.nextId);
    assert.equal(r.changed, false);
    assert.match(r.notes[0], /Dragon/);
  });
  it('leaves the rows it was given untouched', () => {
    const before = JSON.stringify(start.rows);
    mcpEditRows(blocks, start.rows, { remove: [{ name: 'Goblin' }], sides: [{ name: 'Wolf', side: 'ally' }] }, start.nextId);
    assert.equal(JSON.stringify(start.rows), before);
  });
});
