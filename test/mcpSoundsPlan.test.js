'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/mcp/mcpSoundsPlan.js');

const items = [
  { key: 'builtin:dragon-roar.mp3', label: 'Рёв дракона', group: 'Монстры', builtin: true },
  { key: 'Рёв.wav', label: 'Рёв дракона', group: null, file: 'Рёв.wav' },
  { key: 'builtin:bell.mp3', label: 'Bell', group: 'Magic', builtin: true },
  { key: 'Bells of Doom.wav', label: 'Bells of Doom', group: null, file: 'Bells of Doom.wav' },
];

describe('mcpLibOne', () => {
  it('finds the exact shown name first, case ignored, then a part of it', () => {
    assert.equal(P.mcpLibOne(items, 'bell', 'sound', 'list_sounds').item.key, 'builtin:bell.mp3');
    assert.equal(P.mcpLibOne(items, 'doom', 'sound', 'list_sounds').item.key, 'Bells of Doom.wav');
    assert.equal(P.mcpLibOne(items, 'builtin:bell.mp3', 'sound', 'list_sounds').item.label, 'Bell');
  });
  it('refuses two items of one name, naming both by where they sit', () => {
    const e = P.mcpLibOne(items, 'рёв дракона', 'sound', 'list_sounds').error;
    assert.match(e, /Two or more sounds are called "Рёв дракона"/);
    assert.match(e, /in "Монстры", built in/);
    assert.match(e, /in no group, file Рёв\.wav/);
    assert.match(P.mcpLibMany(items, ['Рёв дракона'], 'sound', 'list_sounds').error, /^Nothing was changed\. Two or more sounds/);
  });
  it('says what lists them when nothing matches, and asks for more when a part matches several', () => {
    assert.match(P.mcpLibOne(items, 'harp', 'picture', 'list_gallery').error, /No picture is called "harp"\. list_gallery/);
    assert.match(P.mcpLibOne(items, 'bel', 'sound', 'list_sounds').error, /More than one sound matches "bel".*Use more of the name/);
  });
});

describe('mcpLibMany', () => {
  it('resolves every name or nothing, each item once', () => {
    assert.deepEqual(P.mcpLibMany(items, ['Bell', 'bell', 'doom'], 'sound', 'list_sounds').items.map(x => x.key), ['builtin:bell.mp3', 'Bells of Doom.wav']);
    assert.match(P.mcpLibMany(items, ['Bell', 'harp'], 'sound', 'list_sounds').error, /^Nothing was changed\. No sound is called "harp"/);
    assert.match(P.mcpLibMany(items, [], 'sound', 'list_sounds').error, /at least one sound/);
  });
});

describe('mcpLibGroup and mcpLibIndex', () => {
  it('finds a group by its shown name and turns a position into an index', () => {
    assert.deepEqual(P.mcpLibGroup([{ key: 'g1', name: 'Сессия 4' }], '  сессия   4 '), { key: 'g1', name: 'Сессия 4' });
    assert.equal(P.mcpLibGroup([{ key: 'g1', name: 'A' }], 'B'), null);
    assert.deepEqual([1, 3.7, 0, -2, 'x', undefined].map(P.mcpLibIndex), [0, 2, null, null, null, null]);
  });
  it('asks before a delete and says where it would go', () => {
    assert.match(P.mcpSoundsWouldDelete('Колокол', true), /Would delete the sound "Колокол" \(one of the built-in sounds\)\. Nothing was deleted\..*Trash.*confirmed: true/);
  });
});
