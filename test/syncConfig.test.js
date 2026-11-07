'use strict';
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseSyncConfig, builtInClient, readSyncConfig } = require('../electron/syncConfig.js');

describe('the sync config file', () => {
  it('reads a client id and secret and nothing else it does not know', () => {
    assert.deepEqual(parseSyncConfig('{"clientId":" a ","clientSecret":"b","extra":1}'), { clientId: 'a', clientSecret: 'b' });
  });
  it('keeps a fake Drive address as given and refuses one that is not http(s)', () => {
    assert.equal(parseSyncConfig('{"clientId":"a","clientSecret":"b","apiBase":"http://127.0.0.1:5"}').apiBase, 'http://127.0.0.1:5');
    assert.equal(parseSyncConfig('{"clientId":"a","clientSecret":"b","apiBase":"file:///x"}'), null);
  });
  it('is null for missing fields, empty ones, a bad file and a non-object', () => {
    for (const t of ['{}', '{"clientId":"a"}', '{"clientId":"","clientSecret":"b"}', 'nope', '[]', 'null', '"x"']) assert.equal(parseSyncConfig(t), null, t);
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evm-cfg-'));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const none = { builtIn: path.join(dir, 'absent.json'), env: {} };
  it('is null with no file and the config with one', () => {
    assert.equal(readSyncConfig(dir, none), null);
    fs.mkdirSync(path.join(dir, 'sync'));
    fs.writeFileSync(path.join(dir, 'sync', 'config.json'), '{"clientId":"a","clientSecret":"b"}');
    assert.equal(readSyncConfig(dir, none).clientId, 'a');
  });
});

describe('the Google client sync signs in with', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evm-client-'));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const builtIn = path.join(dir, 'googleClient.json');
  const env = { GOOGLE_CLIENT_ID: ' env-id ', GOOGLE_CLIENT_SECRET: 'env-secret' };
  const override = text => { fs.mkdirSync(path.join(dir, 'sync'), { recursive: true }); fs.writeFileSync(path.join(dir, 'sync', 'config.json'), text); };

  it('is the built-in file\'s, trimmed, before the environment\'s', () => {
    assert.deepEqual(builtInClient('{"clientId":" file-id ","clientSecret":"file-secret"}', env), { clientId: 'file-id', clientSecret: 'file-secret' });
  });
  it('is the environment\'s when the built-in file is absent, broken or half empty', () => {
    for (const t of [null, 'nope', '{"clientId":"a"}', '{"clientId":"a","clientSecret":"  "}']) assert.deepEqual(builtInClient(t, env), { clientId: 'env-id', clientSecret: 'env-secret' }, String(t));
  });
  it('never takes a fake Drive address from the built-in file', () => {
    assert.deepEqual(builtInClient('{"clientId":"a","clientSecret":"b","apiBase":"http://127.0.0.1:5"}', {}), { clientId: 'a', clientSecret: 'b' });
  });
  it('is null with no file and one or both variables empty or unset: sync is hidden', () => {
    for (const e of [{}, { GOOGLE_CLIENT_ID: 'a' }, { GOOGLE_CLIENT_SECRET: 'b' }, { GOOGLE_CLIENT_ID: ' ', GOOGLE_CLIENT_SECRET: 'b' }]) assert.equal(builtInClient(null, e), null, JSON.stringify(e));
    assert.equal(readSyncConfig(dir, { builtIn, env: {} }), null);
  });
  it('reads the built-in file from disk, and the environment without it', () => {
    assert.equal(readSyncConfig(dir, { builtIn, env }).clientId, 'env-id');
    fs.writeFileSync(builtIn, '{"clientId":"file-id","clientSecret":"file-secret"}');
    assert.equal(readSyncConfig(dir, { builtIn, env }).clientId, 'file-id');
  });
  it('lets a usable config.json override both, fake Drive and all, and ignores a broken one', () => {
    override('{"clientId":"rig-client","clientSecret":"rig-secret","apiBase":"http://127.0.0.1:9"}');
    assert.deepEqual(readSyncConfig(dir, { builtIn, env }), { clientId: 'rig-client', clientSecret: 'rig-secret', apiBase: 'http://127.0.0.1:9' });
    override('{"clientId":"rig-client"}');
    assert.equal(readSyncConfig(dir, { builtIn, env }).clientId, 'file-id');
  });
  it('reads the real built-in path and process.env by default', () => {
    const real = readSyncConfig(dir + '-absent');
    const shipped = fs.existsSync(path.join(__dirname, '..', 'electron', 'googleClient.json'));
    if (!shipped) assert.deepEqual(real, builtInClient(null, process.env));
    else assert.ok(real && real.clientId);
  });
});
