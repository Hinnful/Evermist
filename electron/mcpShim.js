'use strict';
// mcpShim.js — the MCP server the Claude desktop app starts, over stdio. It holds the tool list and
// relays each call to the running Evermist (electron/mcpBridge.js), whose address it reads from the
// file EVERMIST_MCP names, starting the app unseen when it is closed.
//
// ⚠ IT SHIPS INSIDE THE CLAUDE EXTENSION and runs on Claude's own Node, with Node's built-ins only.
// Requiring anything else breaks it there and nowhere else.

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const CLOSED = 'Evermist is not open. Ask the DM to start Evermist on this computer, then try again.';

// MCP annotations: Claude's app asks the DM before a tool marked destructive.
const READ = { readOnlyHint: true };
const EDIT = { readOnlyHint: false, destructiveHint: false };

const DELETE = { readOnlyHint: false, destructiveHint: true };

const INSTRUCTIONS = [
  'Evermist is the DM\'s map and campaign app. Use these tools when the DM asks to prep "in Evermist". Call list_campaign first.',
  'How it fits together: the DM sees maps, groups and the Campaign in Evermist, and you use those words with them. The Campaign is the board that holds groups (regions that hold maps). A map is an image or a video, with its own fog, grid, rooms and notes. A room is a named area on a map with notes, and is hidden, half or revealed. A map needs an image or video file. When the DM asks for a map, make a map, never a group. Fights and the bestiary are separate from maps. Pictures (handouts, portraits) are a separate tab. Some tool, parameter and guide-topic names keep older words: place means a group, scene means a map, gallery means Pictures. Call guide to teach a new DM what any of these is.',
  'For a Dungeon Alchemist map, call load_floor_plan before drawing rooms yourself. Positions on a map are percent of the map, as view_scene and read_scene show them; rooms, effects and lights are numbered from 1 in read_scene. Place an effect only when the DM asks for one.',
  'Claude preps and never runs the game: nothing you do reaches the TV, and a change to the map the TV shows is refused. Every change is one step that undo_last_change takes back. Before you delete anything, tell the DM in chat what goes and get their yes.',
].join('\n\n');

const NAME = { type: 'string', description: 'The name as the DM sees it in Evermist.' };
const ROAD_FROM = { type: 'string', description: 'For a road: one end (a group or map), only when two roads share a name.' };
const ROAD_TO = { type: 'string', description: 'For a road: the other end, only when two roads share a name.' };
const PLACE_OF = { type: 'string', description: 'The map\'s group (its place), when two maps share a name.' };
const OUTLINE = { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'At least 3 points [x, y] in percent of the map, as view_scene\'s grid labels read.' };
const FX_SHAPE = { outline: OUTLINE,
  circle: { type: 'object', description: 'Centre x, y and radius, in percent of the map (radius in percent of its width).', properties: { x: { type: 'number' }, y: { type: 'number' }, radius: { type: 'number' } } },
  preset: { type: 'object', description: 'A size from the Effects row, measured on the map\'s grid: square, circle or ring centred on x, y; cone, line or wall starting at x, y and pointing along angle (degrees, 0 = right, 90 = down).',
    properties: { shape: { type: 'string', enum: ['square', 'circle', 'cone', 'line', 'wall', 'ring'] }, feet: { type: 'integer', description: 'In steps of 5: square 5-30, circle radius 5-60, cone 5-90, line 5-120, wall 5-60, ring 10-60 across.' }, x: { type: 'number' }, y: { type: 'number' }, angle: { type: 'number' } } } };
const FX_PICK = { type: ['integer', 'string'], description: 'The effect\'s index from read_scene, or its material when the map has only one effect of it.' };
const ROOM = { type: 'string', description: 'The room\'s name as read_scene lists it.' };
const ROOM_INDEX = { type: 'integer', minimum: 1, description: 'The room\'s place in read_scene\'s rooms list, from 1: only when two rooms share a name, or for a room with none.' };
const PCT_POINT = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[x, y] in percent of the map (0 to 100), as read_scene gives them.' };
const PCT_SHAPE = { type: 'array', items: PCT_POINT, minItems: 3, description: 'Corners in order around the shape, each [x, y] in percent of the map (0 to 100), as read_scene gives them.' };
const TOOLS = [
  { name: 'list_campaign', annotations: READ, description: 'List what the DM\'s Evermist campaign holds: groups on the Campaign with their maps, maps in no group, fights, and how many bestiary monsters there are. Call this first.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'read_notes', annotations: READ, description: 'Read notes from Evermist: the campaign\'s, a group\'s, or a map\'s (with each room\'s notes).',
    inputSchema: { type: 'object', required: ['level'], properties: {
      level: { type: 'string', enum: ['campaign', 'place', 'road', 'scene', 'faction', 'lore', 'monster'], description: 'campaign, place (a group), road, scene (a map), faction, lore (name it by its path, Parent › Child, when two share a name) or monster (a Bestiary note).' }, name: NAME, source: { type: 'string', description: 'For a monster: its source, when two share a name.' },
      from: ROAD_FROM, to: ROAD_TO,
      place: { type: 'string', description: 'For a map: its group (the place), when two maps share a name.' } } } },
  { name: 'add_notes', annotations: EDIT, description: 'Add text to the notes of the campaign, a group, or a map. The text goes below what is there.',
    inputSchema: { type: 'object', required: ['level', 'text'], properties: {
      level: { type: 'string', enum: ['campaign', 'place', 'road', 'scene', 'faction', 'lore', 'monster'], description: 'campaign, place (a group), road, scene (a map), faction, lore (name it by its path, Parent › Child, when two share a name) or monster (a Bestiary note).' }, name: NAME, source: { type: 'string', description: 'For a monster: its source, when two share a name.' },
      from: ROAD_FROM, to: ROAD_TO,
      place: { type: 'string', description: 'For a map: its group (the place), when two maps share a name.' },
      text: { type: 'string', description: 'Text to add. Write @{Name} to link another entry, @{Map › Room} for a room, or @{faction: Name} to pick a kind; a name that matches none or two stays plain and is reported.' } } } },
  { name: 'set_notes', annotations: EDIT, description: 'Replace the notes of the campaign, a group, or a map with new text. The old text is kept in Claude\'s history, so undo_last_change brings it back. Use add_notes to add without replacing.',
    inputSchema: { type: 'object', required: ['level', 'text'], properties: {
      level: { type: 'string', enum: ['campaign', 'place', 'road', 'scene', 'faction', 'lore', 'monster'], description: 'campaign, place (a group), road, scene (a map), faction, lore (name it by its path, Parent › Child, when two share a name) or monster (a Bestiary note).' }, name: NAME, source: { type: 'string', description: 'For a monster: its source, when two share a name.' },
      from: ROAD_FROM, to: ROAD_TO,
      place: { type: 'string', description: 'For a map: its group (the place), when two maps share a name.' },
      text: { type: 'string', description: 'The full new notes. Empty text clears them.' } } } },
  { name: 'list_entries', annotations: READ, description: 'List the factions and lore with their nesting, and the Bestiary monsters and NPCs that have a note. Call it before create_entry: link to what exists instead of making a second one.',
    inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['faction', 'lore', 'monster'] } } } },
  { name: 'create_entry', annotations: EDIT, description: 'Make a faction or lore entry in the Notes window, at the end of the section or inside another entry, with an optional note. kind monster makes a blank Bestiary entry for a monster or NPC with a note (for one with no stat block). A name that already exists in that kind is refused and the reply names it.',
    inputSchema: { type: 'object', required: ['kind', 'name'], properties: { kind: { type: 'string', enum: ['faction', 'lore', 'monster'] }, name: { type: 'string' },
      parent: { type: 'string', description: 'The entry it goes inside (its name, or Parent › Child). Leave out for the top of the section. Not for a monster.' },
      notes: { type: 'string', description: 'Its note. @{Name} links another entry.' } } } },
  { name: 'edit_entry', annotations: EDIT, description: 'Rename a faction or lore entry, move it (inside another entry, to the section with parent set to empty text, or before a sibling), or replace or add to its note.',
    inputSchema: { type: 'object', required: ['kind', 'name'], properties: { kind: { type: 'string', enum: ['faction', 'lore'] }, name: { type: 'string', description: 'The name, or Parent › Child when two share a name.' },
      newName: { type: 'string' }, parent: { type: 'string', description: 'The entry to move it inside; empty text moves it to the section.' },
      before: { type: 'string', description: 'A sibling (in the new place) it should sit before.' },
      notes: { type: 'string', description: 'Replaces the note. @{Name} links another entry.' }, addNotes: { type: 'string', description: 'Added below the note.' } } } },
  { name: 'delete_entry', annotations: DELETE, description: 'Delete a faction or lore entry with the entries inside it. Tell the DM what goes, get their yes, then call again with confirmed: true. Without confirmed nothing is deleted and the reply lists what would go and which notes mention it. undo_last_change brings it back.',
    inputSchema: { type: 'object', required: ['kind', 'name'], properties: { kind: { type: 'string', enum: ['faction', 'lore'] }, name: { type: 'string' }, confirmed: { type: 'boolean', description: 'true only after the DM said yes.' } } } },
  { name: 'appears_in', annotations: READ, description: 'List the notes that mention a map, room, group, road, faction, lore entry, monster or the Campaign.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string', description: 'Its name; Map › Room for a room.' }, kind: { type: 'string', enum: ['faction', 'lore', 'monster', 'group', 'map', 'room', 'road', 'campaign'] } } } },
  { name: 'create_place', annotations: EDIT, description: 'Create a new group (the tool name still says place) on the Campaign, in an empty spot, with optional notes. A group starts with no maps; it gets them when maps are added into it. The DM drags it into position later.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, notes: { type: 'string' } } } },
  { name: 'create_fight', annotations: EDIT, description: 'Create a new fight in the Fights tab from monsters already in the bestiary. A monster the bestiary lacks is left out and named in the reply. The DM\'s open fight is not changed.',
    inputSchema: { type: 'object', required: ['name', 'monsters'], properties: {
      name: { type: 'string' },
      monsters: { type: 'array', items: { type: 'object', required: ['name'], properties: {
        name: { type: 'string', description: 'The bestiary name.' }, count: { type: 'integer', minimum: 1, maximum: 20 },
        side: { type: 'string', enum: ['enemy', 'ally'] } } } } } } },
  { name: 'list_bestiary', annotations: READ, description: 'Search the DM\'s bestiary by name. An empty query lists the first 60 monsters.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
  { name: 'find_map_files', annotations: READ, description: 'Search the DM\'s Downloads, Desktop, Documents and Pictures (two folders deep) for images, videos and zips, newest first, at most 50. Use it to find a map file for create_scene (which makes a map).',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Part of the file name.' } } } },
  { name: 'create_scene', annotations: EDIT, description: 'Make a new map from a map file, or one map per map file in a folder. The map starts fully fogged with no rooms. It is never opened and never sent to the TV. Without a group it lands in no group; with one it lands inside that group\'s outline.',
    inputSchema: { type: 'object', required: ['path'], properties: {
      path: { type: 'string', description: 'The full path of an image or video file, or of a folder of them.' },
      name: { type: 'string', description: 'The map\'s name, for a single file. Default: the file name.' },
      place: { type: 'string', description: 'An existing group (place) to put the map in.' } } } },
  { name: 'rename_scene', annotations: EDIT, description: 'Rename a map.',
    inputSchema: { type: 'object', required: ['name', 'newName'], properties: { name: NAME, place: PLACE_OF, newName: { type: 'string' } } } },
  { name: 'move_scene', annotations: EDIT, description: 'Move a map into a group, onto a free spot inside its outline, or out of every group when toPlace is empty. Or give x and y (Campaign units, the card\'s centre) to put it exactly there; its group then follows from where it lands.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: NAME, place: PLACE_OF, toPlace: { type: 'string', description: 'The group (place) to move into. Empty: no group.' },
      x: { type: 'number', description: 'Exact spot, with y.' }, y: { type: 'number' } } } },
  { name: 'set_scene', annotations: EDIT, description: 'Change a map\'s fog colour or its grid cell size. A map the DM has open changes on their screen at once. Refused for the map the TV shows and for one open in two maps.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: NAME, place: PLACE_OF,
      fogColor: { type: 'string', description: 'A hex colour such as #8899aa.' },
      gridCellSize: { type: 'integer', minimum: 10, maximum: 400, description: 'The size of one grid square in map pixels.' } } } },
  { name: 'set_room_fog', annotations: EDIT, description: 'Set the fog of rooms on a map to hidden, half or revealed, by room name (read_scene lists them). The map the DM has open changes at once; the TV\'s map and a map open in two maps are refused.',
    inputSchema: { type: 'object', required: ['name', 'rooms', 'fog'], properties: { name: NAME, place: PLACE_OF,
      rooms: { type: 'array', items: { type: 'string' }, description: 'Room names.' }, fog: { type: 'string', enum: ['hidden', 'half', 'revealed'] } } } },
  { name: 'set_fog_area', annotations: EDIT, description: 'Reveal or hide a rectangle or a circle of a map\'s fog, the way the fog brush does, in percent of the map as view_scene shows it. A room set to hidden or revealed keeps its own fog over its ground.',
    inputSchema: { type: 'object', required: ['name', 'action'], properties: { name: NAME, place: PLACE_OF, action: { type: 'string', enum: ['reveal', 'hide'] },
      rect: { type: 'object', description: 'A rectangle: x, y (top left), w, h, in percent of the map.', properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }, required: ['x', 'y', 'w', 'h'] },
      circle: { type: 'object', description: 'A circle: centre x, y and radius r, in percent of the map (r a share of its width). Give rect or circle.', properties: { x: { type: 'number' }, y: { type: 'number' }, r: { type: 'number' } }, required: ['x', 'y', 'r'] } } } },
  { name: 'set_fog_all', annotations: EDIT, description: 'Reveal or hide the whole map, every room included, as Reveal all and Hide all do.',
    inputSchema: { type: 'object', required: ['name', 'action'], properties: { name: NAME, place: PLACE_OF, action: { type: 'string', enum: ['reveal', 'hide'] } } } },
  { name: 'set_fog_look', annotations: EDIT, description: 'Set how a map\'s fog looks: its drift (slow, medium or fast, as in Scene control) and/or its tint colour.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: NAME, place: PLACE_OF, preset: { type: 'string', enum: ['slow', 'medium', 'fast'] },
      tint: { type: 'string', description: 'A hex colour such as #8899aa.' } } } },
  { name: 'delete_scene', annotations: DELETE, description: 'Delete a map with its image, fog and rooms. List what goes, get the DM\'s yes, then call again with confirmed: true. Without confirmed nothing is deleted and the call only answers with what would go. undo_last_change brings it back. Animated maps cannot be deleted by Claude.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: NAME, place: PLACE_OF, confirmed: { type: 'boolean', description: 'true only after the DM said yes to the list of what goes.' } } } },
  { name: 'rename_place', annotations: EDIT, description: 'Rename a group. Its notes, maps and roads come with it.',
    inputSchema: { type: 'object', required: ['name', 'newName'], properties: { name: NAME, newName: { type: 'string' } } } },
  { name: 'reshape_place', annotations: EDIT, description: 'Reshape a group: a rectangle (x, y, w, h) or any shape (outline, at least 3 points) in Campaign units; list_campaign shows each group\'s bounds. At least 150 wide and 110 high. A rectangle pulls its maps inside; an outline does not: maps no longer wholly inside leave the group and the reply names them.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: NAME,
      outline: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] }, description: 'Instead of x, y, w, h: the corners in order, at least 3 { x, y }.' },
      x: { type: 'number', description: 'Left edge.' }, y: { type: 'number', description: 'Top edge.' },
      w: { type: 'number', description: 'Width.' }, h: { type: 'number', description: 'Height.' } } } },
  { name: 'delete_place', annotations: DELETE, description: 'Delete a group and its notes. Its maps stay, as maps in no group. List what goes, get the DM\'s yes, then call again with confirmed: true. Without confirmed nothing is deleted and the call only answers with what would go. undo_last_change brings it back.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: NAME, confirmed: { type: 'boolean', description: 'true only after the DM said yes to the list of what goes.' } } } },
  { name: 'create_road', annotations: EDIT, description: 'Draw a road between two groups on the Campaign.',
    inputSchema: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string', description: 'A group name.' }, to: { type: 'string', description: 'A group name.' }, name: { type: 'string' } } } },
  { name: 'edit_road', annotations: EDIT, description: 'Change a road on the Campaign: rename it, give it a new route (points) or round its corners. Find the road by name; give from and to if two share a name.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: NAME, from: ROAD_FROM, to: ROAD_TO, newName: { type: 'string' },
      points: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] }, description: 'The route, at least 2 { x, y } in Campaign units.' },
      cornerRadius: { type: 'number', description: 'Corner rounding in Campaign units. 0: sharp.' } } } },
  { name: 'set_road_maps', annotations: EDIT, description: 'Put maps on a road or take them off. A map on a road leaves its group.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: NAME, from: ROAD_FROM, to: ROAD_TO,
      add: { type: 'array', items: { type: 'string' }, description: 'Names of maps to put on the road.' }, remove: { type: 'array', items: { type: 'string' }, description: 'Names of maps to take off.' } } } },
  { name: 'delete_road', annotations: DELETE, description: 'Delete a road and its notes. Its maps stay where they are. List what goes, get the DM\'s yes, then call again with confirmed: true. Without confirmed nothing is deleted. undo_last_change brings it back.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: NAME, from: ROAD_FROM, to: ROAD_TO, confirmed: { type: 'boolean', description: 'true only after the DM said yes.' } } } },
  { name: 'set_backdrop', annotations: EDIT, description: 'Set the picture behind the Campaign from an image file (up to 30 MB). It replaces the current backdrop; undo_last_change brings that back. Without a path, change the current backdrop: scale (percent, 5 to 400), opacity (0.05 to 1), and x, y (Campaign units, the picture\'s centre).',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'The full path of an image file. Optional when only the numbers change.' },
      scale: { type: 'number', description: 'Size in percent, 5 to 400.' }, opacity: { type: 'number', description: '0.05 to 1.' }, x: { type: 'number' }, y: { type: 'number' } } } },
  { name: 'read_fight', annotations: READ, description: 'Read a fight: its monsters with side, AC and HP.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string', description: 'The fight\'s name.' } } } },
  { name: 'edit_fight', annotations: EDIT, description: 'Change a fight: rename it, remove monsters, set a monster\'s count, change a side, or add monsters from the bestiary. On the fight open at the table only adding monsters and raising a count are allowed; the rest is refused. Monsters are named without their number ("Goblin", not "Goblin 2").',
    inputSchema: { type: 'object', required: ['name'], properties: {
      name: { type: 'string', description: 'The fight\'s name.' }, newName: { type: 'string' },
      add: { type: 'array', items: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, count: { type: 'integer', minimum: 1, maximum: 20 }, side: { type: 'string', enum: ['enemy', 'ally'] } } } },
      remove: { type: 'array', items: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, count: { type: 'integer', minimum: 1, description: 'How many, from the last. Default: all.' } } } },
      counts: { type: 'array', items: { type: 'object', required: ['name', 'count'], properties: { name: { type: 'string' }, count: { type: 'integer', minimum: 0, maximum: 20, description: 'The number of that monster the fight should hold.' } } } },
      sides: { type: 'array', items: { type: 'object', required: ['name', 'side'], properties: { name: { type: 'string' }, side: { type: 'string', enum: ['enemy', 'ally'] } } } },
      rows: { type: 'array', description: 'Details of single rows, picked by the name shown in the fight ("Goblin 2"). Refused on the fight open at the table.', items: { type: 'object', required: ['row'], properties: { row: { type: 'string', description: 'The row\'s shown name.' }, name: { type: 'string' }, hp: { type: 'string' }, ac: { type: 'string', description: 'A whole number.' }, init: { type: 'string', description: 'A whole number.' } } } } } } },
  { name: 'duplicate_fight', annotations: EDIT, description: 'Copy a fight with all its rows, the way Duplicate in the fight list does. The copy is not opened.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string', description: 'The fight to copy.' }, newName: { type: 'string', description: 'Default: the app\'s own copy name.' } } } },
  { name: 'delete_fight', annotations: DELETE, description: 'Delete a fight with its rows. List what goes, get the DM\'s yes, then call again with confirmed: true. Without confirmed nothing is deleted and the call only answers with what would go. undo_last_change brings it back. Refused for the fight open at the table.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string', description: 'The fight\'s name.' }, confirmed: { type: 'boolean', description: 'true only after the DM said yes to the list of what goes.' } } } },
  { name: 'read_stat_block', annotations: READ, description: 'Read one bestiary monster\'s full stat block.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, source: { type: 'string', description: 'When two monsters share a name.' } } } },
  { name: 'add_monster', annotations: EDIT, description: 'Add one monster to the bestiary from pasted stat block text (name first). The text goes through the same reader an import uses; a block that does not read cleanly is refused.',
    inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string', description: 'One monster\'s stat block.' }, source: { type: 'string', description: 'Where it is from. Default: Claude.' } } } },
  { name: 'edit_monster', annotations: EDIT, description: 'Replace one bestiary monster\'s stat block with new text, read the way add_monster reads it. A block that does not read cleanly is refused and the old one stays. Fights already built keep their own copies.',
    inputSchema: { type: 'object', required: ['name', 'text'], properties: { name: { type: 'string' }, source: { type: 'string', description: 'When two monsters share a name.' }, text: { type: 'string', description: 'The new stat block, name first.' } } } },
  { name: 'duplicate_monster', annotations: EDIT, description: 'Copy a bestiary monster under a new name.',
    inputSchema: { type: 'object', required: ['name', 'newName'], properties: { name: { type: 'string' }, source: { type: 'string', description: 'When two monsters share a name.' }, newName: { type: 'string' } } } },
  { name: 'delete_monster', annotations: DELETE, description: 'Delete a monster from the bestiary. Tell the DM what goes, get their yes, then call again with confirmed: true. Without confirmed nothing is deleted. undo_last_change brings it back. Fights already built keep their copies.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, source: { type: 'string', description: 'When two monsters share a name.' }, confirmed: { type: 'boolean', description: 'true only after the DM said yes.' } } } },
  { name: 'import_monsters', annotations: EDIT, description: 'Import monsters into the bestiary from up to 10 web pages (one monster each) or from a PDF book or an Evermist bestiary export (.json) on disk. Never replaces an entry. A block that does not read cleanly is left out and named.',
    inputSchema: { type: 'object', properties: { urls: { type: 'array', items: { type: 'string' } }, path: { type: 'string', description: 'The full path of a PDF book or a bestiary .json export.' } } } },
  { name: 'list_gallery', annotations: READ, description: 'List the DM\'s Pictures (handouts, portraits), optionally by name.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
  { name: 'add_picture', annotations: EDIT, description: 'Add an image file, or every image in a folder, to Pictures. It is never shown on the TV.',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string', description: 'The full path of an image file or a folder.' }, name: { type: 'string', description: 'The picture\'s name, for a single file. Default: the file name.' } } } },
  { name: 'rename_picture', annotations: EDIT, description: 'Rename a picture in Pictures.',
    inputSchema: { type: 'object', required: ['name', 'newName'], properties: { name: { type: 'string' }, newName: { type: 'string' } } } },
  { name: 'delete_picture', annotations: DELETE, description: 'Delete a picture from Pictures. List what goes, get the DM\'s yes, then call again with confirmed: true. Without confirmed nothing is deleted and the call only answers with what would go. undo_last_change brings it back. Refused for the picture the TV shows.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, confirmed: { type: 'boolean', description: 'true only after the DM said yes to the list of what goes.' } } } },
  { name: 'view_scene', annotations: READ, description: 'Look at a map as a picture: the map with no fog, a percent grid over it (each line labelled with its map percent, x along the top and y down the left) and the existing rooms drawn as thin outlines with their names. Give area to zoom into part of the map; the grid gets finer. Read positions off the grid labels. Outlines traced from a picture alone are a first draft: they miss closets, halls and walls that are hard to see from above. Works for any map, open or not, and never changes what the DM or the TV sees.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: NAME, place: PLACE_OF,
      area: { type: 'object', required: ['x', 'y', 'w', 'h'], description: 'The part to look at, in percent of the map (0 to 100): left x, top y, width w, height h. Default: the whole map.',
        properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } } } } } },
  { name: 'read_scene', annotations: READ, description: 'Read everything a map holds, in percent of the map: its size and type, whether the TV shows it, the grid, every room (index, name, notes, fog hidden, half or revealed, outline, doors), the effects and lights (each with the index the effect and light tools take), whether the lights are on, and whether a floor plan is loaded with its wall, door and light counts.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: NAME, place: PLACE_OF } } },
  { name: 'create_room', annotations: EDIT, description: 'Draw a room on a map from its corners, in percent of the map, with a name, notes and fog (hidden unless you say). A map the DM has open changes on their screen at once. Refused for the map the TV shows and for one open in two maps.',
    inputSchema: { type: 'object', required: ['name', 'outline'], properties: { name: NAME, place: PLACE_OF, room: { type: 'string', description: 'The new room\'s name.' }, outline: PCT_SHAPE,
      notes: { type: 'string' }, fog: { type: 'string', enum: ['hidden', 'half', 'revealed'] } } } },
  { name: 'edit_room', annotations: EDIT, description: 'Change a room: rename it, replace its notes, or replace its outline. Doors stay on the walls that are kept; the reply counts any that went with their wall.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: NAME, place: PLACE_OF, room: ROOM, index: ROOM_INDEX, newName: { type: 'string' }, notes: { type: 'string' }, outline: PCT_SHAPE } } },
  { name: 'delete_room', annotations: DELETE, description: 'Delete a room with its notes and doors. List what goes, get the DM\'s yes, then call again with confirmed: true. Without confirmed nothing is deleted. undo_last_change brings it back.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: NAME, place: PLACE_OF, room: ROOM, index: ROOM_INDEX, confirmed: { type: 'boolean', description: 'true only after the DM said yes to the list of what goes.' } } } },
  { name: 'merge_rooms', annotations: EDIT, description: 'Merge two or more rooms that touch or overlap into one, as the DM\'s Merge does. The first room on the map keeps its name and notes; the merged room takes the most hidden fog.',
    inputSchema: { type: 'object', required: ['name', 'rooms'], properties: { name: NAME, place: PLACE_OF, rooms: { type: 'array', minItems: 2, description: 'Room names, or { room, index } for one of two that share a name.',
      items: { anyOf: [{ type: 'string' }, { type: 'object', properties: { room: ROOM, index: ROOM_INDEX } }] } } } } },
  { name: 'cut_room', annotations: EDIT, description: 'Cut a shape out of a room, as the DM\'s Cut out does. A room cut in two becomes two rooms.',
    inputSchema: { type: 'object', required: ['name', 'outline'], properties: { name: NAME, place: PLACE_OF, room: ROOM, index: ROOM_INDEX, outline: PCT_SHAPE } } },
  { name: 'split_room', annotations: EDIT, description: 'Split a room in two along a line, as the DM\'s Cut tool does. The line enters and leaves the room once each; the new part gets a plain name and the same fog.',
    inputSchema: { type: 'object', required: ['name', 'line'], properties: { name: NAME, place: PLACE_OF, room: ROOM, index: ROOM_INDEX,
      line: { type: 'array', items: PCT_POINT, minItems: 2, description: 'Two or more points, each [x, y] in percent of the map.' } } } },
  { name: 'add_door', annotations: EDIT, description: 'Put a door on a room\'s wall at a point. It snaps to the grid and is one grid square wide, as the DM\'s Door tool places it. A point not on a wall is refused with how far the nearest wall is.',
    inputSchema: { type: 'object', required: ['name', 'at'], properties: { name: NAME, place: PLACE_OF, at: PCT_POINT } } },
  { name: 'remove_door', annotations: EDIT, description: 'Take away the door at a point on a room\'s wall (read_scene lists each room\'s doors).',
    inputSchema: { type: 'object', required: ['name', 'at'], properties: { name: NAME, place: PLACE_OF, at: PCT_POINT } } },
  { name: 'set_grid', annotations: EDIT, description: 'Change a map\'s grid as the DM can: on or off, square or hex, colour, opacity, line width, cell size. To fit it, look with view_scene and give cell plus one crossing of grid lines on the map art (for hex, a cell\'s top corner). A map the DM has open changes on their screen at once. Refused for the map the TV shows.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: NAME, place: PLACE_OF, on: { type: 'boolean' }, type: { type: 'string', enum: ['square', 'hex'] },
      color: { type: 'string', description: 'A hex colour such as #ffffff.' }, opacity: { type: 'number', description: 'Percent, 0 to 100.' }, lineWidth: { type: 'integer', minimum: 1, maximum: 10 },
      cell: { type: 'number', description: 'Percent of the map\'s width: a square\'s side, or a hex cell\'s side.' }, crossing: { type: 'object', description: 'Where grid lines cross, x and y in percent of the map.', properties: { x: { type: 'number' }, y: { type: 'number' } } } } } },
  { name: 'create_effect', annotations: EDIT, description: 'Place an effect (Fire, Acid, Area or Difficult terrain) on a map. Only when the DM asks for a specific effect ("put a fire on the bridge"); never add one on your own. Give one shape: outline, circle or preset. Refused for the map the TV shows.',
    inputSchema: { type: 'object', required: ['name', 'material'], properties: { name: NAME, place: PLACE_OF, material: { type: 'string', enum: ['Fire', 'Acid', 'Area', 'Difficult terrain'] }, ...FX_SHAPE } } },
  { name: 'edit_effect', annotations: EDIT, description: 'Change an effect on a map: its material, or its shape (one of outline, circle or preset replaces it).',
    inputSchema: { type: 'object', required: ['name', 'effect'], properties: { name: NAME, place: PLACE_OF, effect: FX_PICK, material: { type: 'string', enum: ['Fire', 'Acid', 'Area', 'Difficult terrain'] }, ...FX_SHAPE } } },
  { name: 'delete_effect', annotations: DELETE, description: 'Delete an effect from a map. Tell the DM what goes, get their yes, then call again with confirmed: true. Without confirmed nothing is deleted and the call only answers with what would go. undo_last_change brings it back.',
    inputSchema: { type: 'object', required: ['name', 'effect'], properties: { name: NAME, place: PLACE_OF, effect: FX_PICK, confirmed: { type: 'boolean', description: 'true only after the DM said yes.' } } } },
  { name: 'create_light', annotations: EDIT, description: 'Draw a light on a map: a lit area the fog shows softly. It turns the map\'s lights on. Refused for the map the TV shows.',
    inputSchema: { type: 'object', required: ['name', 'outline'], properties: { name: NAME, place: PLACE_OF, outline: OUTLINE } } },
  { name: 'set_lights', annotations: EDIT, description: 'Turn all of a map\'s lights on or off, as the eye on Lights in Scene control does. A single light cannot be turned off; delete_light removes one.',
    inputSchema: { type: 'object', required: ['name', 'on'], properties: { name: NAME, place: PLACE_OF, on: { type: 'boolean' } } } },
  { name: 'lights_from_floor_plan', annotations: EDIT, description: 'Draw a map\'s lights from its floor plan (.dd2vtt), as the Lights row does. If the map has lights already they are replaced: the call first answers with how many would go; on the DM\'s yes call again with confirmed: true.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: NAME, place: PLACE_OF, confirmed: { type: 'boolean', description: 'true only after the DM said yes to replacing the lights.' } } } },
  { name: 'delete_light', annotations: DELETE, description: 'Delete a light from a map. Tell the DM what goes, get their yes, then call again with confirmed: true. Without confirmed nothing is deleted and the call only answers with what would go. undo_last_change brings it back.',
    inputSchema: { type: 'object', required: ['name', 'light'], properties: { name: NAME, place: PLACE_OF, light: { type: 'integer', description: 'The light\'s index from read_scene.' }, confirmed: { type: 'boolean', description: 'true only after the DM said yes.' } } } },
  { name: 'guide', annotations: READ, description: 'Plain-language how-to text for a topic, to teach a new DM what it is. Topics: scenes (maps), places (groups), rooms, fog, notes, fights, bestiary, gallery (Pictures), claude (what Claude may change and delete). An unknown topic lists them.',
    inputSchema: { type: 'object', properties: { topic: { type: 'string' } } } },
  { name: 'undo_last_change', annotations: EDIT, description: 'Undo the newest change Claude made in Evermist (the last 30 are kept, until Evermist closes). Call it again for the one before.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'list_music', annotations: READ, description: 'List the DM\'s music library: every track with its group and length, and the group names. Optional query by name.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Part of the track name.' } } } },
  { name: 'add_music', annotations: EDIT, description: 'Add an audio file, or every audio file in a folder, to the music library. Nothing is played.',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string', description: 'Full path of an audio file or a folder.' } } } },
  { name: 'add_music_from_youtube', annotations: EDIT, description: 'Download tracks from a YouTube video or playlist link into the music library, at most 20 per call (pick fewer from a long playlist). It starts the download and returns at once; list_music shows tracks as they arrive. Nothing is played.',
    inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string' }, pick: { type: 'array', items: { type: 'string' }, description: 'Playlist entries to take, by title.' } } } },
  { name: 'delete_music', annotations: DELETE, description: 'Delete a track from the music library. List what goes, get the DM\'s yes, then call again with confirmed: true. Without confirmed nothing is deleted. undo_last_change brings it back until Evermist closes. A track playing now is refused.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string', description: 'The track name as list_music shows it.' }, confirmed: { type: 'boolean', description: 'true only after the DM said yes.' } } } },
  { name: 'create_music_group', annotations: EDIT, description: 'Create an empty group in the music library.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } },
  { name: 'rename_music_group', annotations: EDIT, description: 'Rename a music group. Its tracks come with it.',
    inputSchema: { type: 'object', required: ['name', 'newName'], properties: { name: { type: 'string' }, newName: { type: 'string' } } } },
  { name: 'delete_music_group', annotations: DELETE, description: 'Delete a music group. Its tracks stay in the library, in no group.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } },
  { name: 'set_music_group', annotations: EDIT, description: 'Put tracks into a music group, or take them out of their group when group is empty.',
    inputSchema: { type: 'object', required: ['tracks'], properties: { tracks: { type: 'array', items: { type: 'string' }, description: 'Track names as list_music shows them.' }, group: { type: 'string', description: 'An existing music group; empty takes the tracks out.' } } } },
  { name: 'load_floor_plan', annotations: EDIT, description: 'Draw a map\'s rooms, doors, lights and grid size from a Dungeon Alchemist floor plan (.dd2vtt), as Draw Rooms does, and store the plan with the map. Without path, the plan stored with the map. Do this before drawing any outline of your own. A map with rooms (or lights) answers what would be replaced and changes nothing until confirmed: true.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: NAME, place: PLACE_OF, path: { type: 'string', description: 'The full path of the .dd2vtt file.' },
      confirmed: { type: 'boolean', description: 'true only after the DM said yes to replacing the rooms.' } } } },
  { name: 'load_module_text', annotations: EDIT, description: 'Load an adventure module\'s text (.txt, .md or a PDF) as the DM\'s module import does: its numbered locations become entries for link_room, its stat blocks join the bestiary. It replaces the module text loaded now.',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string', description: 'The full path of the module file.' } } } },
  { name: 'list_module_entries', annotations: READ, description: 'List the loaded module text\'s entries (heading and a short excerpt), optionally searched by name or key.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
  { name: 'link_room', annotations: EDIT, description: 'Link rooms on a map to module entries by heading: the room takes the entry\'s heading as its name and its text as notes, as the DM\'s pick in the room name list does. Notes the room already has stay unless replaceNotes is true. You pick each link; nothing is matched for you.',
    inputSchema: { type: 'object', required: ['name', 'links'], properties: { name: NAME, place: PLACE_OF,
      links: { type: 'array', items: { type: 'object', required: ['heading'], properties: { room: { type: 'string', description: 'The room\'s name, as read_scene lists it.' },
        index: { type: 'integer', minimum: 1, description: 'The room\'s place in read_scene\'s rooms list, from 1, for a room with no name or a shared one.' }, heading: { type: 'string', description: 'The entry\'s heading, or its key such as K12.' } } } },
      replaceNotes: { type: 'boolean', description: 'true replaces notes the room already has.' } } } },
  { name: 'import_maps_zip', annotations: EDIT, description: 'Merge an Evermist export .zip into the library, as the DM\'s Import does: new maps are added, maps both hold take the file\'s newer parts. Without confirmed: true it only answers what would be added and updated. Refused when it would update the map the TV shows, or with two maps open.',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string', description: 'The full path of the .zip.' },
      confirmed: { type: 'boolean', description: 'true only after the DM said yes to the list of what changes.' } } } },
];

const START_MS = 60000;

function readAddress() {
  try { return JSON.parse(fs.readFileSync(process.env.EVERMIST_MCP || '', 'utf8')); } catch { return null; }
}

function postOnce(tool, args) {
  const at = readAddress();
  if (!at || !at.port || !at.token) return Promise.resolve({ closed: true, text: CLOSED, isError: true });
  const body = JSON.stringify({ tool, args });
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port: at.port, path: '/call', method: 'POST', timeout: 330000,
      headers: { 'content-type': 'application/json', 'x-evermist-token': at.token, 'content-length': Buffer.byteLength(body) } }, res => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', c => { out += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(out)); } catch { resolve({ text: 'Evermist answered with something unreadable.', isError: true }); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ closed: true, text: CLOSED, isError: true }));
    req.end(body);
  });
}

// Evermist with no window, from the command EVERMIST_LAUNCH names. A second start is harmless: the app
// keeps one copy per library and the extra one quits.
function startApp() {
  let cmd;
  try { cmd = JSON.parse(process.env.EVERMIST_LAUNCH || 'null'); } catch { cmd = null; }
  if (!Array.isArray(cmd) || !cmd.length) return false;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // What the app prints while it starts, beside its address file, so a start that fails says why.
  let out = 'ignore';
  try { out = fs.openSync(path.join(path.dirname(process.env.EVERMIST_MCP || ''), 'mcp-start.log'), 'w'); } catch { /* no log */ }
  try {
    const child = spawn(cmd[0], [...cmd.slice(1), '--background'], { detached: true, stdio: ['ignore', out, out], windowsHide: true, env });
    child.on('error', err => { try { fs.writeSync(out, 'start failed: ' + err.message + '\n'); } catch { /* no log */ } });
    child.unref();
    return true;
  } catch { return false; }
}

const wait = ms => new Promise(r => setTimeout(r, ms));

// A closed app is started once, and a starting one is waited for, up to START_MS.
async function callApp(tool, args) {
  let r = await postOnce(tool, args);
  if (!r.closed && !r.starting) return r;
  if (r.closed && !startApp()) return r;
  const until = Date.now() + START_MS;
  while (Date.now() < until) {
    await wait(500);
    r = await postOnce(tool, args);
    if (!r.closed && !r.starting) return r;
  }
  return { text: 'Evermist did not start in time. Ask the DM to open it, then try again.', isError: true };
}

async function handle(msg) {
  const p = msg.params || {};
  switch (msg.method) {
    case 'initialize':
      return { protocolVersion: PROTOCOLS.includes(p.protocolVersion) ? p.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: {} }, serverInfo: { name: 'evermist', version: '1' },
        instructions: INSTRUCTIONS };
    case 'ping': return {};
    case 'tools/list': return { tools: TOOLS };
    case 'tools/call': {
      if (!TOOLS.some(t => t.name === p.name)) throw Object.assign(new Error('Unknown tool ' + p.name), { code: -32602 });
      const r = await callApp(p.name, p.arguments || {});
      const content = [{ type: 'text', text: String(r.text) }];
      if (r.image && r.image.data) content.push({ type: 'image', data: r.image.data, mimeType: r.image.mimeType || 'image/jpeg' });
      return { content, isError: !!r.isError };
    }
    default: throw Object.assign(new Error('Method not found'), { code: -32601 });
  }
}

const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

async function onLine(line) {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
  if (msg.id === undefined) return;   // a notification: nothing to answer
  try { send({ jsonrpc: '2.0', id: msg.id, result: await handle(msg) }); } catch (err) {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: err.code || -32603, message: err.message } });
  }
}

function serveStdio() {
  let buf = '';
  const inFlight = new Set();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const p = onLine(buf.slice(0, i));
      buf = buf.slice(i + 1);
      inFlight.add(p);
      p.finally(() => inFlight.delete(p));
    }
  });
  // Input closing is the client leaving, but an answer already on its way still goes out.
  process.stdin.on('end', () => Promise.allSettled([...inFlight]).then(() => process.exit(0)));
}

// ⚠ NEVER GATE THIS ON require.main. Claude's built-in Node loads the file from its own launcher, so it
// is not the main module there, and a server that waits for that never answers. Only Evermist's main
// process requires it for the tool list.
if (process.type !== 'browser') serveStdio();
module.exports = { TOOLS };
