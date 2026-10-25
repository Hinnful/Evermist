'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/world/worldPartyPlan.js');
const N = require('../src/notes/notesPlan.js');

describe('wptClean', () => {
  it('keeps a spot and the map it rides on', () => {
    assert.deepEqual(P.wptClean({ x: 10.04, y: -5, scene: 'a1' }), { x: 10, y: -5, scene: 'a1' });
    assert.deepEqual(P.wptClean({ x: 1, y: 2 }), { x: 1, y: 2 });
  });
  it('drops anything that is not a finite spot', () => {
    for (const bad of [null, 7, 'x', [], {}, { x: 1 }, { x: '1', y: 2 }, { x: NaN, y: 0 }, { x: 1, y: Infinity }, { x: 1e9, y: 0 }]) assert.equal(P.wptClean(bad), null);
  });
  it('ignores a map that is not a plain string', () => {
    assert.deepEqual(P.wptClean({ x: 1, y: 2, scene: 5 }), { x: 1, y: 2 });
    assert.deepEqual(P.wptClean({ x: 1, y: 2, scene: '' }), { x: 1, y: 2 });
  });
  it('carries no other field', () => {
    assert.deepEqual(P.wptClean({ x: 1, y: 2, junk: true }), { x: 1, y: 2 });
  });
});

describe('wptAnchor', () => {
  it('sits centred on the top edge of the card', () => {
    assert.deepEqual(P.wptAnchor({ x: 300, y: 200 }, 77), { x: 300, y: 161.5 });
  });
});

describe('wptSceneAt', () => {
  const cards = [{ id: 'a', x: 0, y: 0, hw: 55, hh: 38 }, { id: 'b', x: 200, y: 0, hw: 55, hh: 38 }];
  it('lands inside a card', () => assert.equal(P.wptSceneAt({ x: 10, y: 10 }, cards, 6), 'a'));
  it('lands just outside a card, within the tolerance', () => {
    assert.equal(P.wptSceneAt({ x: 60, y: 0 }, cards, 6), 'a');
    assert.equal(P.wptSceneAt({ x: 62, y: 0 }, cards, 6), '');
  });
  it('lands on nothing over bare ground', () => assert.equal(P.wptSceneAt({ x: 100, y: 0 }, cards, 6), ''));
  it('takes the nearer of two cards', () => {
    const close = [{ id: 'a', x: 0, y: 0, hw: 10, hh: 10 }, { id: 'b', x: 24, y: 0, hw: 10, hh: 10 }];
    assert.equal(P.wptSceneAt({ x: 11, y: 0 }, close, 6), 'a');
    assert.equal(P.wptSceneAt({ x: 13, y: 0 }, close, 6), 'b');
  });
  it('answers nothing with no cards', () => assert.equal(P.wptSceneAt({ x: 0, y: 0 }, [], 6), ''));
});

describe('the marker in a backup', () => {
  it('rides in campaign.json and reads back', () => {
    const json = N.notesCampaignPayload('', null, null, null, null, { x: 5, y: 6, scene: 's1' });
    assert.deepEqual(P.wptParse(json), { x: 5, y: 6, scene: 's1' });
  });
  it('leaves the file out when there is nothing else to carry', () => {
    assert.equal(N.notesCampaignPayload('', null, null, null, null, null), null);
    assert.equal(N.notesCampaignPayload('', null, null, null, null, { x: 'no' }), null);
  });
  it('reads none from a file without it, or a broken one', () => {
    assert.equal(P.wptParse(null), null);
    assert.equal(P.wptParse('{nope'), null);
    assert.equal(P.wptParse(JSON.stringify({ notes: 'x' })), null);
    assert.equal(P.wptParse(JSON.stringify({ party: { x: 'a' } })), null);
  });
  it('still reads the notes of a file that carries a marker, as the previous release does', () => {
    const json = N.notesCampaignPayload('lore', null, null, null, null, { x: 1, y: 2 });
    assert.deepEqual(N.notesParseCampaign(json), { text: 'lore', broken: false });
  });
});
