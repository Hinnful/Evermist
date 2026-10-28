'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mcpFogRoomMode, mcpFogPresetKey, mcpFogApplyPreset, mcpFogFindRooms, mcpFogArea, mcpFogPixels, mcpFogRoomsOverriding, mcpFogBox } = require('../src/mcp/mcpFogPlan.js');

const sq = (x, y, w) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + w }, { x, y: y + w }];

describe('mcpFogRoomMode', () => {
  it('turns the DM\'s words into the stored modes', () => {
    assert.equal(mcpFogRoomMode('hidden'), 'shroud');
    assert.equal(mcpFogRoomMode(' Half '), 'half');
    assert.equal(mcpFogRoomMode('revealed'), 'reveal');
    assert.equal(mcpFogRoomMode('shroud'), null);
    assert.equal(mcpFogRoomMode(undefined), null);
  });
});

describe('mcpFogPresetKey', () => {
  it('finds a preset by the name the panel shows', () => {
    assert.equal(mcpFogPresetKey('slow'), 'calm');
    assert.equal(mcpFogPresetKey('Medium drift'), 'default');
    assert.equal(mcpFogPresetKey('FAST'), 'fast');
    assert.equal(mcpFogPresetKey('calm'), 'calm');
    assert.equal(mcpFogPresetKey('wild'), null);
  });
  it('applies a preset with its speed as a fraction and the movement on', () => {
    const out = mcpFogApplyPreset({ enabled: false, speed: 1, drift: 1, morph: 1, warpStr: 1, warpRad: 1, pulse: 1 },
      { speed: 40, drift: 0.3, morph: 0.12, warpStr: 0.08, warpRad: 0.05, pulse: 0.1 });
    assert.deepEqual(out, { enabled: true, speed: 0.4, drift: 0.3, morph: 0.12, warpStr: 0.08, warpRad: 0.05, pulse: 0.1 });
  });
});

describe('mcpFogFindRooms', () => {
  const polys = [{ name: 'Crypt' }, { name: 'Hall' }, { name: 'hall' }, {}];
  it('finds rooms by name, ignoring case and edge spaces, each once', () => {
    assert.deepEqual(mcpFogFindRooms(polys, [' crypt ', 'CRYPT']), { index: [0] });
  });
  it('refuses a missing name, a shared name and an empty list', () => {
    assert.match(mcpFogFindRooms(polys, ['Vault']).error, /No room is called "Vault"/);
    assert.match(mcpFogFindRooms(polys, ['Hall']).error, /More than one room/);
    assert.match(mcpFogFindRooms(polys, []).error, /names of the rooms/);
    assert.match(mcpFogFindRooms(polys, ['']).error, /No room/);
  });
});

describe('mcpFogArea', () => {
  it('reads a rectangle or a circle and refuses both, neither and bad numbers', () => {
    assert.deepEqual(mcpFogArea({ x: 1, y: 2, w: 3, h: 4 }).shape, { kind: 'rect', x: 1, y: 2, w: 3, h: 4 });
    assert.deepEqual(mcpFogArea(undefined, { x: 50, y: 50, r: 10 }).shape, { kind: 'circle', x: 50, y: 50, r: 10 });
    assert.ok(mcpFogArea({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, r: 1 }).error);
    assert.ok(mcpFogArea().error);
    assert.ok(mcpFogArea({ x: 0, y: 0, w: 0, h: 5 }).error);
    assert.ok(mcpFogArea({ x: 0, y: 0, w: '5', h: 5 }).error);
    assert.ok(mcpFogArea(undefined, { x: 5, y: 5, r: -1 }).error);
  });
});

describe('mcpFogPixels', () => {
  it('turns a rectangle in percent into fog pixels at 1/scale', () => {
    // A 4000 x 2000 map at scale 4 is a 1000 x 500 fog.
    assert.deepEqual(mcpFogPixels({ kind: 'rect', x: 10, y: 20, w: 50, h: 25 }, 4000, 2000, 4), { kind: 'rect', x: 100, y: 100, w: 500, h: 125 });
  });
  it('clips a rectangle at the map\'s edge', () => {
    assert.deepEqual(mcpFogPixels({ kind: 'rect', x: -10, y: 90, w: 30, h: 50 }, 4000, 2000, 4), { kind: 'rect', x: 0, y: 450, w: 200, h: 50 });
  });
  it('is null for a rectangle wholly off the map or touching only its edge', () => {
    assert.equal(mcpFogPixels({ kind: 'rect', x: 100, y: 0, w: 10, h: 10 }, 4000, 2000, 4), null);
    assert.equal(mcpFogPixels({ kind: 'rect', x: -20, y: 0, w: 20, h: 10 }, 4000, 2000, 4), null);
  });
  it('uses the fog canvas size, rounded up, for the far edge', () => {
    const px = mcpFogPixels({ kind: 'rect', x: 0, y: 0, w: 200, h: 200 }, 4001, 2001, 4);
    assert.deepEqual([px.w, px.h], [1001, 501]);
  });
  it('takes a circle\'s radius as percent of the map\'s width', () => {
    assert.deepEqual(mcpFogPixels({ kind: 'circle', x: 50, y: 50, r: 10 }, 4000, 2000, 4), { kind: 'circle', cx: 500, cy: 250, r: 100 });
  });
  it('keeps a circle that spills past the edge and drops one that does not reach the map', () => {
    assert.ok(mcpFogPixels({ kind: 'circle', x: 0, y: 0, r: 5 }, 4000, 2000, 4));
    assert.ok(mcpFogPixels({ kind: 'circle', x: -3, y: 50, r: 5 }, 4000, 2000, 4));
    assert.equal(mcpFogPixels({ kind: 'circle', x: -10, y: 50, r: 5 }, 4000, 2000, 4), null);
  });
});

describe('mcpFogRoomsOverriding', () => {
  const polys = [{ name: 'Crypt', mode: 'shroud', vertices: sq(0, 0, 100) }, { name: 'Hall', mode: 'reveal', vertices: sq(0, 0, 100) },
    { name: 'Far', mode: 'reveal', vertices: sq(900, 900, 50) }, { mode: 'half', vertices: sq(10, 10, 10) }];
  it('names the hidden rooms a reveal runs into', () => {
    assert.deepEqual(mcpFogRoomsOverriding(polys, { x0: 50, y0: 50, x1: 60, y1: 60 }, true), ['Crypt']);
  });
  it('names the revealed and half rooms a hide runs into, and skips rooms off the area', () => {
    assert.deepEqual(mcpFogRoomsOverriding(polys, { x0: 5, y0: 5, x1: 30, y1: 30 }, false), ['Hall', '(unnamed room)']);
  });
  it('turns a shape in percent into a box in map pixels', () => {
    assert.deepEqual(mcpFogBox({ kind: 'rect', x: 10, y: 10, w: 20, h: 40 }, 1000, 500), { x0: 100, y0: 50, x1: 300, y1: 250 });
    assert.deepEqual(mcpFogBox({ kind: 'circle', x: 50, y: 50, r: 10 }, 1000, 500), { x0: 400, y0: 150, x1: 600, y1: 350 });
  });
});
