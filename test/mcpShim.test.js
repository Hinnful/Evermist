'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SHIM = path.join(__dirname, '..', 'electron', 'mcpShim.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evermist-mcp-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

// The shim as Claude runs it: one JSON-RPC message per line in, one answer per line out.
function talk(addressFile, messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SHIM], { env: { ...process.env, EVERMIST_MCP: addressFile } });
    const want = messages.filter(m => m.id !== undefined).length;
    const got = [];
    let buf = '';
    child.stdout.on('data', c => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { got.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
      if (got.length === want) { child.stdin.end(); resolve(got); }
    });
    child.on('error', reject);
    for (const m of messages) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  });
}

const call = (id, name, args) => ({ id, method: 'tools/call', params: { name, arguments: args || {} } });

describe('mcpShim', () => {
  it('answers the handshake and lists the tools with Evermist closed', async () => {
    const [init, list] = await talk(path.join(dir, 'none.json'), [
      { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
      { method: 'notifications/initialized' },
      { id: 2, method: 'tools/list' },
    ]);
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.deepEqual(init.result.capabilities, { tools: {} });
    assert.deepEqual(list.result.tools.map(t => t.name).sort(),
      ['add_notes', 'create_fight', 'create_place', 'list_bestiary', 'list_campaign', 'read_notes']);
  });

  it('says Evermist must be open when it is not', async () => {
    const [r] = await talk(path.join(dir, 'none.json'), [call(1, 'list_campaign')]);
    assert.equal(r.result.isError, true);
    assert.match(r.result.content[0].text, /not open/);
  });

  it('relays a call with the key and hands back the app\'s answer', async () => {
    let seen = null;
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        seen = { key: req.headers['x-evermist-token'], origin: req.headers.origin, body: JSON.parse(body) };
        res.end(JSON.stringify({ text: 'Added.' }));
      });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(file, JSON.stringify({ port: server.address().port, token: 'k1' }));
    const [r] = await talk(file, [call(7, 'add_notes', { level: 'campaign', text: 'Hi' })]);
    server.close();
    assert.equal(r.id, 7);
    assert.deepEqual(r.result, { content: [{ type: 'text', text: 'Added.' }], isError: false });
    assert.deepEqual(seen, { key: 'k1', origin: undefined, body: { tool: 'add_notes', args: { level: 'campaign', text: 'Hi' } } });
  });

  it('still answers a call when its input closes before the app replies', async () => {
    const server = http.createServer((req, res) => { req.resume(); req.on('end', () => setTimeout(() => res.end(JSON.stringify({ text: 'Late.' })), 200)); });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const file = path.join(dir, 'late.json');
    fs.writeFileSync(file, JSON.stringify({ port: server.address().port, token: 'k' }));
    const child = spawn(process.execPath, [SHIM], { env: { ...process.env, EVERMIST_MCP: file } });
    let out = '';
    child.stdout.on('data', c => { out += c; });
    child.stdin.end(JSON.stringify({ jsonrpc: '2.0', ...call(1, 'list_campaign') }) + '\n');
    await new Promise(r => child.on('exit', r));
    server.close();
    assert.match(out, /Late\./);
  });

  it('starts the app when it is closed, then relays the call once it is up', async () => {
    const file = path.join(dir, 'started.json');
    // The "app": a script that opens a bridge and writes the address file, as mcpBridge.js does.
    const fake = path.join(dir, 'fake-app.js');
    fs.writeFileSync(fake, `
      const http = require('http'), fs = require('fs');
      if (!process.argv.includes('--background')) process.exit(1);
      const s = http.createServer((q, r) => { q.resume(); q.on('end', () => { r.end(JSON.stringify({ text: 'Up.' })); s.close(); }); });
      s.listen(0, '127.0.0.1', () => fs.writeFileSync(${JSON.stringify(file)}, JSON.stringify({ port: s.address().port, token: 'k' })));
      setTimeout(() => process.exit(0), 10000);`);
    const child = spawn(process.execPath, [SHIM], { env: { ...process.env, EVERMIST_MCP: file, EVERMIST_LAUNCH: JSON.stringify([process.execPath, fake]) } });
    let out = '';
    child.stdout.on('data', c => { out += c; });
    child.stdin.end(JSON.stringify({ jsonrpc: '2.0', ...call(1, 'list_campaign') }) + '\n');
    await new Promise(r => child.on('exit', r));
    assert.match(out, /Up\./);
  });

  it('waits while the app says it is still starting', async () => {
    let n = 0;
    const server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => res.end(JSON.stringify(++n < 3 ? { starting: true, text: 'Starting.', isError: true } : { text: 'Ready.' })));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const file = path.join(dir, 'starting.json');
    fs.writeFileSync(file, JSON.stringify({ port: server.address().port, token: 'k' }));
    const [r] = await talk(file, [call(1, 'list_campaign')]);
    server.close();
    assert.equal(r.result.content[0].text, 'Ready.');
  });

  it('refuses a tool it does not have and a method it does not know', async () => {
    const [a, b] = await talk(path.join(dir, 'none.json'), [call(1, 'delete_everything'), { id: 2, method: 'nope' }]);
    assert.equal(a.error.code, -32602);
    assert.equal(b.error.code, -32601);
  });
});

describe('mcpShim under a launcher', () => {
  it('answers when another script loads it, as Claude\'s built-in Node does', async () => {
    const launcher = path.join(dir, 'launcher.js');
    fs.writeFileSync(launcher, 'require(' + JSON.stringify(SHIM) + ');');
    const child = spawn(process.execPath, [launcher], { env: { ...process.env, EVERMIST_MCP: path.join(dir, 'none.json') } });
    let out = '';
    child.stdout.on('data', c => { out += c; });
    child.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n');
    await new Promise(r => child.on('exit', r));
    assert.match(out, /"protocolVersion":"2025-06-18"/);
  });
});
