'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/mcp/mcpRoomsPlan.js');

const W = 2000, H = 1000;
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

describe('mcpRoomPoint', () => {
  it('turns percent of the map into map pixels, either point form', () => {
    assert.deepEqual(P.mcpRoomPoint([50, 25], W, H), { x: 1000, y: 250 });
    assert.deepEqual(P.mcpRoomPoint({ x: 12.5, y: 100 }, W, H), { x: 250, y: 1000 });
    assert.deepEqual(P.mcpRoomPoint([0.05, 0], W, H), { x: 1, y: 0 });
  });

  it('refuses a point off the map or not a number', () => {
    for (const bad of [[101, 5], [-1, 5], [5], ['a', 5], null, 'x', { x: 5 }]) assert.equal(P.mcpRoomPoint(bad, W, H), null);
  });
});

describe('mcpRoomOutline', () => {
  it('gives the corners in map pixels', () => {
    assert.deepEqual(P.mcpRoomOutline([[10, 10], [20, 10], [20, 30], [10, 30]], W, H).verts, rect(200, 100, 400, 300));
  });

  it('drops a repeated point and a closing point equal to the first', () => {
    const out = P.mcpRoomOutline([[10, 10], [10, 10], [20, 10], [20, 30], [10, 30], [10, 10]], W, H);
    assert.equal(out.verts.length, 4);
  });

  it('refuses fewer than three points, a line, a crossing and a bad point', () => {
    assert.match(P.mcpRoomOutline([[10, 10], [20, 10]], W, H).error, /at least 3/);
    assert.match(P.mcpRoomOutline([[10, 10], [20, 10], [30, 10]], W, H).error, /one line/);
    assert.match(P.mcpRoomOutline([[10, 10], [20, 30], [20, 10], [10, 30]], W, H).error, /crosses itself/);
    assert.match(P.mcpRoomOutline([[10, 10], [20, 10], [20, 130]], W, H).error, /Point 3/);
    assert.match(P.mcpRoomOutline('square', W, H).error, /list of points/);
  });
});

describe('mcpRoomLine', () => {
  it('takes two points or more', () => {
    assert.deepEqual(P.mcpRoomLine([[0, 50], [100, 50]], W, H).path, [{ x: 0, y: 500 }, { x: 2000, y: 500 }]);
    assert.match(P.mcpRoomLine([[0, 50]], W, H).error, /at least 2/);
  });
});

describe('mcpRoomFog', () => {
  it('starts hidden, as a drawn room does, and reads the three words', () => {
    assert.equal(P.mcpRoomFog(undefined), 'shroud');
    assert.equal(P.mcpRoomFog('Revealed'), 'reveal');
    assert.equal(P.mcpRoomFog('half'), 'half');
    assert.equal(P.mcpRoomFog('open'), null);
  });
});

describe('mcpRoomFind', () => {
  const polys = [{ name: 'Hall' }, { name: 'Crypt' }, { name: 'crypt ' }, { name: null }];

  it('finds a room by name, case and edge spaces ignored', () => {
    assert.deepEqual(P.mcpRoomFind(polys, ' HALL', undefined, 'Keep'), { index: 0, room: polys[0] });
  });

  it('lists the indexes when two rooms share a name, and an index picks one', () => {
    assert.match(P.mcpRoomFind(polys, 'Crypt', undefined, 'Keep').error, /index 2, 3/);
    assert.equal(P.mcpRoomFind(polys, 'Crypt', 3, 'Keep').index, 2);
  });

  it('reaches a room with no name by index alone', () => {
    assert.equal(P.mcpRoomFind(polys, undefined, 4, 'Keep').index, 3);
  });

  it('counts rooms from 1: index 0 is out of range', () => {
    assert.match(P.mcpRoomFind(polys, undefined, 0, 'Keep').error, /No room has index 0/);
    assert.equal(P.mcpRoomFind(polys, 'Hall', 1, 'Keep').index, 0);
  });

  it('refuses a name no room has, an index out of range, and an index naming another room', () => {
    assert.match(P.mcpRoomFind(polys, 'Vault', undefined, 'Keep').error, /No room is called "Vault" on the map "Keep"/);
    assert.match(P.mcpRoomFind(polys, 'Hall', 9, 'Keep').error, /index 1 to 4/);
    assert.match(P.mcpRoomFind(polys, 'Hall', 2, 'Keep').error, /called "Crypt", not "Hall"/);
    assert.match(P.mcpRoomFind(polys, '', undefined, 'Keep').error, /Name the room/);
  });
});

describe('mcpRoomNew', () => {
  it('builds a drawn room\'s fields, with notes only when there are some', () => {
    const r = P.mcpRoomNew(7, rect(0, 0, 10, 10), '  ', 'Dusty.', 'half', 'Room 7');
    assert.deepEqual(r, { id: 7, vertices: rect(0, 0, 10, 10), mode: 'half', cornerRadius: 0, name: 'Room 7', desc: 'Dusty.' });
    assert.equal('desc' in P.mcpRoomNew(8, rect(0, 0, 10, 10), 'Hall', '', 'shroud', 'Room 8'), false);
  });
});

describe('mcpRoomReshape', () => {
  const room = { id: 1, vertices: rect(0, 0, 400, 200), doors: [{ edge: 0, t: 0.5 }, { edge: 2, t: 0.5 }], cornerRadii: [5, null, null, null], name: 'Hall' };

  it('keeps every door and corner when the outline keeps its corner count, as a drag does', () => {
    const out = P.mcpRoomReshape(room, rect(0, 0, 600, 200), W, H);
    assert.deepEqual(out.piece.doors, room.doors);
    assert.deepEqual(out.piece.cornerRadii, room.cornerRadii);
    assert.equal(out.lost, 0);
  });

  it('keeps a door on a wall that stayed and counts one whose wall went', () => {
    const l = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 100 }, { x: 100, y: 200 }, { x: 0, y: 200 }];
    const cut = P.mcpRoomReshape(room, l, W, H);
    assert.equal(cut.piece.doors.length, 1);
    assert.equal(cut.piece.doors[0].edge, 0);
    assert.equal(cut.lost, 1);
  });
});

describe('mcpRoomWouldDelete and mcpRoomDoorMiss', () => {
  it('says what a delete takes and that nothing went', () => {
    const text = P.mcpRoomWouldDelete({ name: 'Hall', desc: 'abc', doors: [{}, {}] });
    assert.match(text, /"Hall" with its notes \(3 characters\) and its 2 doors\. Nothing was deleted/);
  });

  it('gives the distance to the nearest wall in percent and grid squares', () => {
    assert.match(P.mcpRoomDoorMiss(100, 2000, 50), /5% of the map's width away \(2 grid squares\)/);
    assert.match(P.mcpRoomDoorMiss(Infinity, 2000, 50), /no room/);
  });
});
