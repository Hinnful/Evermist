'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mcpManifest } = require('../electron/mcpConfig.js');
// The shim serves stdio wherever it is loaded, so its tool list is not required here.
const TOOLS = [{ name: 'list_campaign', description: 'List.', inputSchema: {} }, { name: 'add_notes', description: 'Add.', inputSchema: {} }];

const manifest = mcpManifest({ version: '4.1.0', tools: TOOLS, addressFile: 'C:/U/Evermist/mcp.json', launch: ['C:/E/Evermist.exe'] });

describe('mcpManifest', () => {
  it('runs the bundled shim on Claude\'s own Node', () => {
    assert.equal(manifest.server.type, 'node');
    assert.equal(manifest.server.entry_point, 'server/index.js');
    assert.deepEqual(manifest.server.mcp_config.args, ['${__dirname}/server/index.js']);
  });
  it('tells the shim where the app writes its address and how to start it', () => {
    assert.deepEqual(manifest.server.mcp_config.env,
      { EVERMIST_MCP: 'C:/U/Evermist/mcp.json', EVERMIST_LAUNCH: JSON.stringify(['C:/E/Evermist.exe']) });
  });
  it('carries the app\'s version and every tool the shim serves', () => {
    assert.equal(manifest.version, '4.1.0');
    assert.deepEqual(manifest.tools.map(t => t.name), TOOLS.map(t => t.name));
    assert.ok(manifest.tools.every(t => t.description));
  });
});
