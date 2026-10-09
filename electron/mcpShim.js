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

const NAME = { type: 'string', description: 'The name as the DM sees it in Evermist.' };
const TOOLS = [
  { name: 'list_campaign', description: 'List what the DM\'s Evermist campaign holds: places on the world map with their scenes, scenes in no place, fights, and how many bestiary monsters there are. Call this first.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'read_notes', description: 'Read notes from Evermist: the campaign\'s, a place\'s, or a scene\'s (with each room\'s notes).',
    inputSchema: { type: 'object', required: ['level'], properties: {
      level: { type: 'string', enum: ['campaign', 'place', 'scene'] }, name: NAME,
      place: { type: 'string', description: 'For a scene: its place, when two scenes share a name.' } } } },
  { name: 'add_notes', description: 'Add text to the notes of the campaign, a place, or an existing scene. The text goes below what is there; nothing is replaced. Claude cannot create scenes.',
    inputSchema: { type: 'object', required: ['level', 'text'], properties: {
      level: { type: 'string', enum: ['campaign', 'place', 'scene'] }, name: NAME,
      place: { type: 'string', description: 'For a scene: its place, when two scenes share a name.' },
      text: { type: 'string', description: 'Plain text to add.' } } } },
  { name: 'create_place', description: 'Create a new place on the world map, in an empty spot, with optional notes. The DM drags it into position later.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, notes: { type: 'string' } } } },
  { name: 'create_fight', description: 'Create a new fight in the fight table from monsters already in the bestiary. A monster the bestiary lacks is left out and named in the reply. The DM\'s open fight is not changed.',
    inputSchema: { type: 'object', required: ['name', 'monsters'], properties: {
      name: { type: 'string' },
      monsters: { type: 'array', items: { type: 'object', required: ['name'], properties: {
        name: { type: 'string', description: 'The bestiary name.' }, count: { type: 'integer', minimum: 1, maximum: 20 },
        side: { type: 'string', enum: ['enemy', 'ally'] } } } } } } },
  { name: 'list_bestiary', description: 'Search the DM\'s bestiary by name. An empty query lists the first 60 monsters.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
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
    const req = http.request({ host: '127.0.0.1', port: at.port, path: '/call', method: 'POST', timeout: 30000,
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
        instructions: 'Evermist is the DM\'s map and campaign app. Use these tools when the DM asks to write prep "into Evermist". Read list_campaign first.' };
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
