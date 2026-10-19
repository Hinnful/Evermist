'use strict';
// mcpConfig.js — the manifest of the Claude desktop extension Settings' Connect to Claude builds. Pure,
// no Electron. Tested.

// `launch` is the command that starts this app unseen when Claude calls with it closed; `addressFile` is
// where the running app writes its port and key.
function mcpManifest({ version, tools, addressFile, launch }) {
  return {
    manifest_version: '0.2',
    name: 'evermist',
    display_name: 'Evermist',
    version,
    description: 'Prepare your sessions in Evermist: scenes, places, notes, fights and the bestiary.',
    long_description: 'Lets Claude do your session prep in Evermist: notes, places and scenes, fights and the bestiary. Claude never touches what the TV shows, never runs the game, and asks you before it deletes anything. Every change it makes can be undone. Evermist starts in the background when it is closed.',
    author: { name: 'Evermist' },
    server: {
      type: 'node',
      entry_point: 'server/index.js',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/server/index.js'],
        env: { EVERMIST_MCP: addressFile, EVERMIST_LAUNCH: JSON.stringify(launch) },
      },
    },
    tools: tools.map(t => ({ name: t.name, description: t.description })),
    compatibility: { platforms: ['win32', 'darwin', 'linux'] },
  };
}

module.exports = { mcpManifest };
