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
    description: 'Write session prep into Evermist: places, notes and fights.',
    long_description: 'Lets Claude read the campaign in Evermist and add to it: notes for the campaign, a place or a scene, new places on the world map, and fights built from the bestiary. It only ever adds. Evermist starts in the background when it is closed.',
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
