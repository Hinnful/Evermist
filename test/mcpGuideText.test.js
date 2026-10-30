'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { MCP_GUIDE, mcpGuideText } = require('../src/mcp/mcpGuideText.js');

describe('mcpGuideText', () => {
  it('covers every topic the guide tool names', () => {
    assert.deepEqual(Object.keys(MCP_GUIDE).sort(), ['bestiary', 'claude', 'fights', 'fog', 'gallery', 'notes', 'places', 'rooms', 'scenes']);
    for (const t of Object.keys(MCP_GUIDE)) assert.ok(MCP_GUIDE[t].length > 60);
  });
  it('teaches the notes model: mentions, first mention, no self-link, reuse, one session at a time', () => {
    for (const w of ['@\{Name\}', 'first mention', 'inside its own note', 'Reuse before create', 'kind monster', 'one session', 'appears_in']) assert.match(MCP_GUIDE.notes, new RegExp(w));
    assert.match(MCP_GUIDE.claude, /Notes window/);
  });
  it('finds a topic in any case', () => {
    assert.equal(mcpGuideText(' Scenes ').topic, 'scenes');
  });
  it('lists the topics for a name it does not know', () => {
    assert.equal(mcpGuideText('dragons').topic, null);
    assert.equal(mcpGuideText('').topics.length, 9);
  });
});
