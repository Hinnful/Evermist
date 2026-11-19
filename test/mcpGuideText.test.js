'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { MCP_GUIDE, mcpGuideText } = require('../src/mcp/mcpGuideText.js');

describe('mcpGuideText', () => {
  it('covers every topic the guide tool names', () => {
    assert.deepEqual(Object.keys(MCP_GUIDE).sort(), ['bestiary', 'claude', 'fights', 'fog', 'gallery', 'music', 'notes', 'places', 'rooms', 'scenes', 'sounds']);
    for (const t of Object.keys(MCP_GUIDE)) assert.ok(MCP_GUIDE[t].length > 60);
  });
  it('teaches the notes model: mentions, first mention, no self-link, reuse, one session at a time', () => {
    for (const w of ['@\{Name\}', 'first mention', 'inside its own note', 'Reuse before create', 'kind monster', 'one session', 'appears_in', 'read_notes_order', 'set_notes_order']) assert.match(MCP_GUIDE.notes, new RegExp(w));
    assert.match(MCP_GUIDE.claude, /Notes window/);
  });
  it('teaches fight HP, copying and shrinking a map, rooms from a floor plan, and how notes are laid out', () => {
    assert.match(MCP_GUIDE.fights, /never put max HP into hp/);
    for (const w of ['copy_scene', 'never imports the source file', 'shrink_map', 'permanent']) assert.match(MCP_GUIDE.scenes, new RegExp(w));
    assert.match(MCP_GUIDE.rooms, /create_room at .* close/);
    for (const w of ['timeless', 'Bestiary entry', '"Сессии"', 'Never write episode numbers', 'read what is there', 'One fact lives in one place', 'prep is the source', 'tell the DM instead of overwriting']) assert.match(MCP_GUIDE.notes, new RegExp(w));
  });
  it('finds a topic in any case', () => {
    assert.equal(mcpGuideText(' Scenes ').topic, 'scenes');
  });
  it('lists the topics for a name it does not know', () => {
    assert.equal(mcpGuideText('dragons').topic, null);
    assert.equal(mcpGuideText('').topics.length, 11);
  });
});
