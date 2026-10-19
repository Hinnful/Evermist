'use strict';
// mcpGuideText.js — plain-language how-to text per topic. Data and one lookup, no DOM: Claude reads it
// through the guide tool, and the in-app guides can read the same text later. Tested.

const MCP_GUIDE = {
  scenes: 'A scene is one map: an image or a video, with its own fog, grid, rooms and notes. The DM adds a scene by dropping a map file on Evermist or pressing Add. Open a scene from the scene list or the world map, and Evermist shows it on the DM screen only. The TV shows it after the DM presses Show on TV. Scenes can sit in a place and can be renamed, moved and deleted. A scene always needs a map file.',
  places: 'A place is a region on the world map, drawn as an outline, for example a town or a dungeon. It holds scenes: a scene belongs to the place whose outline holds its whole card. A place has its own notes. A place starts empty; scenes arrive when the DM or Claude adds maps into it. Roads are lines between places or scenes. Deleting a place keeps its scenes, which then belong to no place.',
  rooms: 'A room is a named area drawn on a scene with the room tools. Each room has a name, notes and one fog state: hidden (the players see only fog), half (the players see the room under a shroud) or revealed. The DM draws rooms and reveals them during play. Rooms never show on the TV by themselves; only fog and revealed ground do.',
  fog: 'Fog covers the map on the TV. The DM reveals a room, or paints a reveal with the brush, and hides it again. Fog has a colour and a cloud look per scene. Fog is the one thing that changes while the party plays, so Claude never changes fog on a scene the TV is showing.',
  notes: 'Notes live at four levels: the campaign, a place, a scene and a room. They are plain text for the DM only; the players never see them. In the dock, the Notes pane shows the level the DM has open.',
  fights: 'A fight is a named list of monsters for the fight table, each row with a side (enemy or ally). Fights are built from the bestiary and are separate from scenes. The DM runs a fight at the table; Claude only prepares it.',
  bestiary: 'The bestiary is the DM\'s library of stat blocks. Monsters come from stat block text, a web page or a PDF the DM imports. A fight can only use monsters that are in the bestiary.',
  gallery: 'The gallery holds pictures: handouts, portraits, maps of a room\'s furniture. The DM can show a picture on the TV during play. Claude can add, rename and delete pictures but never shows one.',
};

// The text for a topic, or the list of topics when the name is empty or unknown.
function mcpGuideText(topic) {
  const key = String(topic || '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(MCP_GUIDE, key)) return { topic: key, text: MCP_GUIDE[key] };
  return { topic: null, topics: Object.keys(MCP_GUIDE) };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { MCP_GUIDE, mcpGuideText };
