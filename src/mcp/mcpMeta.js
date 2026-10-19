'use strict';
// mcpMeta.js — the two tools about the session itself: the guide, and Claude's own undo.

function _mcpGuide(args) {
  const g = mcpGuideText(args.topic);
  return _mcpOk(g.topic ? g.text : 'Topics: ' + g.topics.join(', ') + '.');
}

const MCP_META_TOOLS = { guide: _mcpGuide, undo_last_change: _mcpUndoTool };
