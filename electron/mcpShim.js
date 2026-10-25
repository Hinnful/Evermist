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
  'Claude preps and never runs the game: nothing you do reaches the TV, and a change to the map the TV shows is refused. Every change is one step that undo_last_change takes back. Before you delete anything, tell the DM in chat what goes and get their yes.',
].join('\n\n');

const NAME = { type: 'string', description: 'The name as the DM sees it in Evermist.' };
const PLACE_OF = { type: 'string', description: 'The map\'s group (its place), when two maps share a name.' };
const TOOLS = [
  { name: 'list_campaign', annotations: READ, description: 'List what the DM\'s Evermist campaign holds: groups on the Campaign with their maps, maps in no group, fights, and how many bestiary monsters there are. Call this first.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'read_notes', annotations: READ, description: 'Read notes from Evermist: the campaign\'s, a group\'s, or a map\'s (with each room\'s notes).',
    inputSchema: { type: 'object', required: ['level'], properties: {
      level: { type: 'string', enum: ['campaign', 'place', 'scene'], description: 'campaign, place (a group) or scene (a map).' }, name: NAME,
      place: { type: 'string', description: 'For a map: its group (the place), when two maps share a name.' } } } },
  { name: 'add_notes', annotations: EDIT, description: 'Add text to the notes of the campaign, a group, or a map. The text goes below what is there.',
    inputSchema: { type: 'object', required: ['level', 'text'], properties: {
      level: { type: 'string', enum: ['campaign', 'place', 'scene'], description: 'campaign, place (a group) or scene (a map).' }, name: NAME,
      place: { type: 'string', description: 'For a map: its group (the place), when two maps share a name.' },
      text: { type: 'string', description: 'Plain text to add.' } } } },
  { name: 'set_notes', annotations: EDIT, description: 'Replace the notes of the campaign, a group, or a map with new text. The old text is kept in Claude\'s history, so undo_last_change brings it back. Use add_notes to add without replacing.',
    inputSchema: { type: 'object', required: ['level', 'text'], properties: {
      level: { type: 'string', enum: ['campaign', 'place', 'scene'], description: 'campaign, place (a group) or scene (a map).' }, name: NAME,
      place: { type: 'string', description: 'For a map: its group (the place), when two maps share a name.' },
      text: { type: 'string', description: 'The full new notes. Empty text clears them.' } } } },
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
  { name: 'move_scene', annotations: EDIT, description: 'Move a map into a group, onto a free spot inside its outline, or out of every group when toPlace is empty.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: NAME, place: PLACE_OF, toPlace: { type: 'string', description: 'The group (place) to move into. Empty: no group.' } } } },
  { name: 'set_scene', annotations: EDIT, description: 'Change a map\'s fog colour or its grid cell size. Refused for the map the TV shows and for the one the DM has open.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: NAME, place: PLACE_OF,
      fogColor: { type: 'string', description: 'A hex colour such as #8899aa.' },
      gridCellSize: { type: 'integer', minimum: 10, maximum: 400, description: 'The size of one grid square in map pixels.' } } } },
  { name: 'delete_scene', annotations: DELETE, description: 'Delete a map with its image, fog and rooms. List what goes, get the DM\'s yes, then call again with confirmed: true. Without confirmed nothing is deleted and the call only answers with what would go. undo_last_change brings it back. Animated maps cannot be deleted by Claude.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: NAME, place: PLACE_OF, confirmed: { type: 'boolean', description: 'true only after the DM said yes to the list of what goes.' } } } },
  { name: 'rename_place', annotations: EDIT, description: 'Rename a group. Its notes, maps and roads come with it.',
    inputSchema: { type: 'object', required: ['name', 'newName'], properties: { name: NAME, newName: { type: 'string' } } } },
  { name: 'reshape_place', annotations: EDIT, description: 'Make a group a rectangle in Campaign units (list_campaign shows each group\'s bounds). At least 150 wide and 110 high. Maps in the group stay in it.',
    inputSchema: { type: 'object', required: ['name', 'x', 'y', 'w', 'h'], properties: { name: NAME,
      x: { type: 'number', description: 'Left edge.' }, y: { type: 'number', description: 'Top edge.' },
      w: { type: 'number', description: 'Width.' }, h: { type: 'number', description: 'Height.' } } } },
  { name: 'delete_place', annotations: DELETE, description: 'Delete a group and its notes. Its maps stay, as maps in no group. List what goes, get the DM\'s yes, then call again with confirmed: true. Without confirmed nothing is deleted and the call only answers with what would go. undo_last_change brings it back.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: NAME, confirmed: { type: 'boolean', description: 'true only after the DM said yes to the list of what goes.' } } } },
  { name: 'create_road', annotations: EDIT, description: 'Draw a road between two groups on the Campaign.',
    inputSchema: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string', description: 'A group name.' }, to: { type: 'string', description: 'A group name.' }, name: { type: 'string' } } } },
  { name: 'set_backdrop', annotations: EDIT, description: 'Set the picture behind the Campaign from an image file (up to 30 MB). It replaces the current backdrop; undo_last_change brings that back.',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string', description: 'The full path of an image file.' } } } },
  { name: 'read_fight', annotations: READ, description: 'Read a fight: its monsters with side, AC and HP.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string', description: 'The fight\'s name.' } } } },
  { name: 'edit_fight', annotations: EDIT, description: 'Change a fight: rename it, remove monsters, set a monster\'s count, change a side, or add monsters from the bestiary. On the fight open at the table only adding monsters and raising a count are allowed; the rest is refused. Monsters are named without their number ("Goblin", not "Goblin 2").',
    inputSchema: { type: 'object', required: ['name'], properties: {
      name: { type: 'string', description: 'The fight\'s name.' }, newName: { type: 'string' },
      add: { type: 'array', items: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, count: { type: 'integer', minimum: 1, maximum: 20 }, side: { type: 'string', enum: ['enemy', 'ally'] } } } },
      remove: { type: 'array', items: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, count: { type: 'integer', minimum: 1, description: 'How many, from the last. Default: all.' } } } },
      counts: { type: 'array', items: { type: 'object', required: ['name', 'count'], properties: { name: { type: 'string' }, count: { type: 'integer', minimum: 0, maximum: 20, description: 'The number of that monster the fight should hold.' } } } },
      sides: { type: 'array', items: { type: 'object', required: ['name', 'side'], properties: { name: { type: 'string' }, side: { type: 'string', enum: ['enemy', 'ally'] } } } } } } },
  { name: 'delete_fight', annotations: DELETE, description: 'Delete a fight with its rows. List what goes, get the DM\'s yes, then call again with confirmed: true. Without confirmed nothing is deleted and the call only answers with what would go. undo_last_change brings it back. Refused for the fight open at the table.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string', description: 'The fight\'s name.' }, confirmed: { type: 'boolean', description: 'true only after the DM said yes to the list of what goes.' } } } },
  { name: 'read_stat_block', annotations: READ, description: 'Read one bestiary monster\'s full stat block.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, source: { type: 'string', description: 'When two monsters share a name.' } } } },
  { name: 'add_monster', annotations: EDIT, description: 'Add one monster to the bestiary from pasted stat block text (name first). The text goes through the same reader an import uses; a block that does not read cleanly is refused.',
    inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string', description: 'One monster\'s stat block.' }, source: { type: 'string', description: 'Where it is from. Default: Claude.' } } } },
  { name: 'import_monsters', annotations: EDIT, description: 'Import monsters into the bestiary from up to 10 web pages (one monster each) or from a PDF book on disk. Never replaces an entry. A block that does not read cleanly is left out and named.',
    inputSchema: { type: 'object', properties: { urls: { type: 'array', items: { type: 'string' } }, path: { type: 'string', description: 'The full path of a PDF book.' } } } },
  { name: 'list_gallery', annotations: READ, description: 'List the DM\'s Pictures (handouts, portraits), optionally by name.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
  { name: 'add_picture', annotations: EDIT, description: 'Add an image file, or every image in a folder, to Pictures. It is never shown on the TV.',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string', description: 'The full path of an image file or a folder.' }, name: { type: 'string', description: 'The picture\'s name, for a single file. Default: the file name.' } } } },
  { name: 'rename_picture', annotations: EDIT, description: 'Rename a picture in Pictures.',
    inputSchema: { type: 'object', required: ['name', 'newName'], properties: { name: { type: 'string' }, newName: { type: 'string' } } } },
  { name: 'delete_picture', annotations: DELETE, description: 'Delete a picture from Pictures. List what goes, get the DM\'s yes, then call again with confirmed: true. Without confirmed nothing is deleted and the call only answers with what would go. undo_last_change brings it back. Refused for the picture the TV shows.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, confirmed: { type: 'boolean', description: 'true only after the DM said yes to the list of what goes.' } } } },
  { name: 'guide', annotations: READ, description: 'Plain-language how-to text for a topic, to teach a new DM what it is. Topics: scenes (maps), places (groups), rooms, fog, notes, fights, bestiary, gallery (Pictures), claude (what Claude may change and delete). An unknown topic lists them.',
    inputSchema: { type: 'object', properties: { topic: { type: 'string' } } } },
  { name: 'undo_last_change', annotations: EDIT, description: 'Undo the newest change Claude made in Evermist (the last 30 are kept, until Evermist closes). Call it again for the one before.',
    inputSchema: { type: 'object', properties: {} } },
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
      return { content: [{ type: 'text', text: String(r.text) }], isError: !!r.isError };
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
