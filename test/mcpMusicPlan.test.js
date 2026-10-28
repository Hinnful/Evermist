'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { MCP_MUSIC_MAX, mcpMusicFind, mcpMusicOne, mcpMusicGroupName, mcpMusicPick, mcpMusicWouldDelete } = require('../src/mcp/mcpMusicPlan.js');

const tracks = [
  { name: 'Tavern Song [abcdefghijk].m4a', display: 'Tavern Song' },
  { name: 'Tavern Brawl.mp3', display: 'Tavern Brawl' },
  { name: 'Дракон.mp3', display: 'Дракон' },
];
const entries = n => Array.from({ length: n }, (_, i) => ({ id: 'id' + i, title: 'Song ' + i }));

describe('mcpMusicFind', () => {
  it('prefers the exact shown name over a part of one', () => {
    assert.deepEqual(mcpMusicFind(tracks, 'tavern song').map(t => t.display), ['Tavern Song']);
  });
  it('finds by the file name and ignores case in Cyrillic', () => {
    assert.equal(mcpMusicFind(tracks, 'Tavern Brawl.MP3').length, 1);
    assert.equal(mcpMusicFind(tracks, 'ДРАКОН').length, 1);
  });
  it('falls back to a part of the name and finds nothing for empty text', () => {
    assert.equal(mcpMusicFind(tracks, 'tavern').length, 2);
    assert.deepEqual(mcpMusicFind(tracks, '  '), []);
  });
});

describe('mcpMusicOne', () => {
  it('answers one track, none or an ambiguity with the names', () => {
    assert.equal(mcpMusicOne(tracks, 'drak').error.startsWith('No track'), true);
    assert.equal(mcpMusicOne(tracks, 'Дракон').track.name, 'Дракон.mp3');
    assert.match(mcpMusicOne(tracks, 'tavern').error, /More than one.*Tavern Song.*Tavern Brawl/);
  });
});

describe('mcpMusicGroupName', () => {
  it('matches a group ignoring case and spacing', () => {
    assert.equal(mcpMusicGroupName(['Combat', 'Inn'], '  combat '), 'Combat');
    assert.equal(mcpMusicGroupName(['Combat'], 'Travel'), null);
  });
});

describe('mcpMusicPick', () => {
  it('takes exactly 20 and refuses 21 with a reply that says to pick fewer', () => {
    assert.equal(MCP_MUSIC_MAX, 20);
    assert.equal(mcpMusicPick(entries(20)).entries.length, 20);
    assert.match(mcpMusicPick(entries(21)).error, /at most 20.*Pick fewer/);
  });
  it('narrows by title, then applies the limit to what was picked', () => {
    assert.deepEqual(mcpMusicPick(entries(30), ['song 3', 'Song 12']).entries.map(e => e.id), ['id3', 'id12']);
    assert.equal(mcpMusicPick(entries(30), Array.from({ length: 21 }, (_, i) => 'Song ' + i)).error.includes('at most 20'), true);
  });
  it('refuses a title the playlist lacks and an empty list', () => {
    assert.match(mcpMusicPick(entries(3), ['Nope']).error, /"Nope"/);
    assert.ok(mcpMusicPick([]).error);
  });
});

describe('mcpMusicWouldDelete', () => {
  it('says nothing was deleted and how to confirm', () => {
    assert.match(mcpMusicWouldDelete('Song'), /Nothing was deleted.*confirmed: true/);
  });
});
