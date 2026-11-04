const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { vttDerivePlan, vttSignedArea } = require('../src/rooms/vttPlan.js');
const { vttRoomHoles } = require('../src/rooms/vttHoles.js');

const P = (x, y) => ({ x, y });
const area = ring => Math.abs(vttSignedArea(ring));

// A hall 0..20 with a doorway in its top wall, and a vault 8..12 inside it with its own doorway.
const nested = () => ({
  resolution: { pixels_per_grid: 100, map_origin: P(0, 0), map_size: P(20, 20) },
  line_of_sight: [
    [P(0, 0), P(8, 0)], [P(10, 0), P(20, 0), P(20, 20), P(0, 20), P(0, 0)],
    [P(8, 8), P(9.5, 8)], [P(10.5, 8), P(12, 8), P(12, 12), P(8, 12), P(8, 8)],
  ],
  portals: [{ bounds: [P(8, 0), P(10, 0)] }, { bounds: [P(9.5, 8), P(10.5, 8)] }],
});

describe('vttRoomHoles', () => {
  it('cuts a building standing inside a room out of that room', () => {
    const d = vttDerivePlan(nested());
    const holes = vttRoomHoles(d.rooms, d.boundaries);
    assert.equal(holes.length, 2);
    const hall = d.rooms.findIndex(r => area(r) > 300 * 10000);
    const vault = 1 - hall;
    assert.equal(holes[hall].length, 1, 'the hall holds the vault as a hole');
    assert.equal(holes[vault].length, 0, 'the vault holds nothing');
    assert.equal(Math.round(area(holes[hall][0])), Math.round(area(d.rooms[vault])));
  });

  it('gives the hole to the smallest room that holds it', () => {
    const sq = (a, b) => [P(a, a), P(b, a), P(b, b), P(a, b)];
    const holes = vttRoomHoles([sq(0, 100), sq(10, 90)], [sq(40, 60)]);
    assert.deepEqual(holes.map(h => h.length), [0, 1]);
  });

  it('skips an outline that sits in no room, and one bigger than the room around it', () => {
    const sq = (a, b) => [P(a, a), P(b, a), P(b, b), P(a, b)];
    assert.deepEqual(vttRoomHoles([sq(10, 20)], [sq(0, 100), sq(30, 40)]), [[]]);
  });
});
