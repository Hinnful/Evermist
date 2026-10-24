'use strict';
// mcpGuideText.js — plain-language how-to text per topic. Data and one lookup, no DOM: Claude reads it
// through the guide tool (topic names keep older words: scenes are maps, places are groups, gallery is Pictures), and the in-app guides can read the same text later. Tested.

const MCP_GUIDE = {
  scenes: 'A map is an image or a video, with its own fog, grid, rooms and notes. The DM adds maps with the Map button on the Campaign, one file or several at once. The DM opens a map from the Campaign. Until the DM presses Show on TV, the map shows on the DM screen only. While the TV is on, an opened map goes to the TV at once with Updates on Auto, and waits for Send with Updates on Manual. Maps can sit in a group and can be renamed, moved and deleted. A map always needs an image or video file.',
  places: 'A group is a region on the Campaign, drawn as an outline, for example a town or a dungeon. It holds maps: a map belongs to the group whose outline holds its whole card. A group has its own notes. A group starts empty; maps arrive when the DM or Claude adds maps into it. Roads are lines between groups or maps. Deleting a group keeps its maps, which then belong to no group.',
  rooms: 'A room is a named area drawn on a map with the room tools. Each room has a name, notes and one fog state: hidden (the players see only fog), half (the players see the room under a shroud) or revealed. The DM draws rooms and reveals them during play. Rooms never show on the TV by themselves; only fog and revealed ground do.',
  fog: 'Fog covers the map on the TV. The DM reveals a room, or paints a reveal with the brush, and hides it again. Fog has a colour and a cloud look per map. Fog is the one thing that changes while the party plays, so Claude never changes fog on a map the TV is showing.',
  notes: 'Notes live at four levels: the campaign, a group, a map and a room. They are plain text for the DM only; the players never see them. In the dock, the Notes pane shows the level the DM has open.',
  fights: 'A fight is a named list of monsters for the Fights tab, each row with a side (enemy or ally). Fights are built from the bestiary and are separate from maps. The DM runs a fight at the table; Claude only prepares it.',
  bestiary: 'The bestiary is the DM\'s library of stat blocks. Monsters come from stat block text, a web page or a PDF the DM imports. A fight can only use monsters that are in the bestiary.',
  gallery: 'Pictures is a tab that holds handouts, portraits, maps of a room\'s furniture. The DM can show a picture on the TV during play. Claude can add, rename and delete pictures but never shows one.',
};

// The text for a topic, or the list of topics when the name is empty or unknown.
function mcpGuideText(topic) {
  const key = String(topic || '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(MCP_GUIDE, key)) return { topic: key, text: MCP_GUIDE[key] };
  return { topic: null, topics: Object.keys(MCP_GUIDE) };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { MCP_GUIDE, mcpGuideText };
