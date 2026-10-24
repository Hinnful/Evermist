'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/ui/hintsPlan.js');

describe('open-map: the Campaign holds a map and none has opened this run', () => {
  it('is due only then', () => {
    assert.equal(P.hintOpenMapDue({ campaignUp: true, maps: 1, opened: false }), true);
    assert.equal(P.hintOpenMapDue({ campaignUp: false, maps: 1, opened: false }), false);
    assert.equal(P.hintOpenMapDue({ campaignUp: true, maps: 0, opened: false }), false);
    assert.equal(P.hintOpenMapDue({ campaignUp: true, maps: 4, opened: true }), false);
  });
});

describe('show-on-tv: a first stroke ended', () => {
  it('is due while the TV is not live', () => {
    assert.equal(P.hintShowOnTvDue({ tvLive: false }), true);
    assert.equal(P.hintShowOnTvDue({ tvLive: true }), false);
  });
});

describe('music: the pane is open and the library is empty', () => {
  it('is due only then', () => {
    assert.equal(P.hintMusicDue({ paneOpen: true, tracks: 0 }), true);
    assert.equal(P.hintMusicDue({ paneOpen: true, tracks: 1 }), false);
    assert.equal(P.hintMusicDue({ paneOpen: false, tracks: 0 }), false);
  });
});

describe('fight: the table opened on a fight with no creatures', () => {
  it('is due only then', () => {
    assert.equal(P.hintFightDue({ open: true, creatures: 0 }), true);
    assert.equal(P.hintFightDue({ open: true, creatures: 2 }), false);
    assert.equal(P.hintFightDue({ open: false, creatures: 0 }), false);
  });
});

describe('stat-block: the first creature is added', () => {
  it('is due on the step from none to some, and no other', () => {
    assert.equal(P.hintStatBlockDue({ before: 0, after: 1 }), true);
    assert.equal(P.hintStatBlockDue({ before: 1, after: 2 }), false);
    assert.equal(P.hintStatBlockDue({ before: 0, after: 0 }), false);
  });
});

describe('groups: three maps and no group on the Campaign', () => {
  it('is due only then', () => {
    assert.equal(P.hintGroupsDue({ campaignUp: true, maps: 3, groups: 0 }), true);
    assert.equal(P.hintGroupsDue({ campaignUp: true, maps: 2, groups: 0 }), false);
    assert.equal(P.hintGroupsDue({ campaignUp: true, maps: 5, groups: 1 }), false);
    assert.equal(P.hintGroupsDue({ campaignUp: false, maps: 5, groups: 0 }), false);
  });
});

describe('effects: the second map opened, on a map in Fog mode', () => {
  it('is due from the second open', () => {
    assert.equal(P.hintEffectsDue({ opens: 1, fogMode: true, sceneOpen: true }), false);
    assert.equal(P.hintEffectsDue({ opens: 2, fogMode: true, sceneOpen: true }), true);
    assert.equal(P.hintEffectsDue({ opens: 9, fogMode: true, sceneOpen: true }), true);
    assert.equal(P.hintEffectsDue({ opens: 2, fogMode: false, sceneOpen: true }), false);
    assert.equal(P.hintEffectsDue({ opens: 2, fogMode: true, sceneOpen: false }), false);
  });
});

describe('effects: a map holding an effect gets no hint', () => {
  it('is not due once an effect exists', () => {
    assert.equal(P.hintEffectsDue({ opens: 2, fogMode: true, sceneOpen: true, hasEffect: true }), false);
    assert.equal(P.hintEffectsDue({ opens: 2, fogMode: true, sceneOpen: true, hasEffect: false }), true);
  });
});

describe('reveal: a map already showing something', () => {
  it('is due only while nothing is revealed', () => {
    assert.equal(P.hintRevealDue({ revealed: false }), true);
    assert.equal(P.hintRevealDue({ revealed: true }), false);
  });
});

describe('show-on-tv on a map open: something revealed, TV not live', () => {
  it('is due only then', () => {
    assert.equal(P.hintShowOnTvOpenDue({ revealed: true, tvLive: false }), true);
    assert.equal(P.hintShowOnTvOpenDue({ revealed: true, tvLive: true }), false);
    assert.equal(P.hintShowOnTvOpenDue({ revealed: false, tvLive: false }), false);
  });
});

describe('room-reveal: rooms exist and all are in shroud', () => {
  it('is due only then', () => {
    assert.equal(P.hintRoomRevealDue({ rooms: 3, shroudRooms: 3 }), true);
    assert.equal(P.hintRoomRevealDue({ rooms: 3, shroudRooms: 2 }), false);
    assert.equal(P.hintRoomRevealDue({ rooms: 0, shroudRooms: 0 }), false);
  });
});

describe('the quiet gap after a hint closes', () => {
  it('holds a screen-read hint for the whole gap', () => {
    const s = { lastClosedAt: 1000, gapMs: 60000 };
    assert.equal(P.hintQuietOver({ ...s, now: 60999 }), false);
    assert.equal(P.hintQuietOver({ ...s, now: 61000 }), true);
    assert.equal(P.hintQuietOver({ ...s, now: 500000 }), true);
  });
});

describe('the count of maps opened', () => {
  it('adds one, and starts again from anything that is not a count', () => {
    assert.equal(P.hintOpensNext('1'), 2);
    assert.equal(P.hintOpensNext('0'), 1);
    assert.equal(P.hintOpensNext(null), 1);
    assert.equal(P.hintOpensNext('abc'), 1);
    assert.equal(P.hintOpensNext('-4'), 1);
  });
});
