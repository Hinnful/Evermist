'use strict';
// mcpTools.js — the dispatcher for what Claude may do through the MCP connection, answered in the DM window.
// Main relays each call (electron/mcpBridge.js), the tool list Claude sees lives in electron/mcpShim.js and
// each group of tools in its own file (mcpMeta, mcpScenes, mcpNotes, mcpWorld, mcpWorldMap, mcpFights, mcpBestiary, mcpGallery, mcpSee, mcpRooms, mcpGrid, mcpImport).

const MCP_TOOLS = Object.assign({}, MCP_META_TOOLS, MCP_SCENES_TOOLS, MCP_WORLD_TOOLS, MCP_WORLDMAP_TOOLS, MCP_NOTES_TOOLS, MCP_FIGHTS_TOOLS, MCP_BESTIARY_TOOLS, MCP_GALLERY_TOOLS, MCP_SEE_TOOLS, MCP_MUSIC_TOOLS, MCP_FOG_TOOLS, MCP_ROOMS_TOOLS, MCP_GRID_TOOLS, MCP_IMPORT_TOOLS);

async function _mcpAnswer(req) {
  const run = MCP_TOOLS[req.tool];
  if (!run) return _mcpNo('Evermist has no tool called "' + req.tool + '".');
  // Whatever the DM is typing lands first, and the field refills with Claude's text after.
  notesPanelSettle();
  try { return await run(req.args || {}); } catch (err) {
    console.error('A Claude request failed:', err);
    return _mcpNo('Evermist could not do that: ' + ((err && err.message) || err));
  } finally { refreshRoomPanel(); }
}

function initMcp() {
  window.electronAPI.onMcpRequest(async req => window.electronAPI.mcpReply(req.id, await _mcpAnswer(req)));
  window.electronAPI.mcpReady();
  initMcpConnect();
}
