'use strict';
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeGoogleClient } = require('../tools/write-google-client.js');

const SCRIPT = path.join(__dirname, '..', 'tools', 'write-google-client.js');
const ID = 'unit-id-7f3a.apps.googleusercontent.com', SECRET = 'GOCSPX-unit-secret-91c2';

describe('tools/write-google-client.js', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evm-writer-'));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = (env, out) => {
    const clean = Object.assign({}, process.env);
    delete clean.GOOGLE_CLIENT_ID;
    delete clean.GOOGLE_CLIENT_SECRET;
    return spawnSync(process.execPath, [SCRIPT, out], { env: Object.assign(clean, env), encoding: 'utf8' });
  };

  it('writes the id and secret, trimmed, as the file syncConfig.js reads', () => {
    const out = path.join(dir, 'a.json');
    const r = run({ GOOGLE_CLIENT_ID: ' ' + ID + '\n', GOOGLE_CLIENT_SECRET: SECRET }, out);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), { clientId: ID, clientSecret: SECRET });
    const { builtInClient } = require('../electron/syncConfig.js');
    assert.deepEqual(builtInClient(fs.readFileSync(out, 'utf8'), {}), { clientId: ID, clientSecret: SECRET });
  });

  it('never prints either value', () => {
    const r = run({ GOOGLE_CLIENT_ID: ID, GOOGLE_CLIENT_SECRET: SECRET }, path.join(dir, 'b.json'));
    for (const v of [ID, SECRET, 'unit-id-7f3a', 'unit-secret-91c2']) {
      assert.ok(!r.stdout.includes(v) && !r.stderr.includes(v), 'printed ' + v);
    }
    const bad = run({ GOOGLE_CLIENT_ID: ID }, path.join(dir, 'c.json'));
    assert.ok(!bad.stdout.includes(ID) && !bad.stderr.includes(ID), 'printed the id on a refusal');
  });

  it('refuses an empty or unset value, writes nothing and exits non-zero', () => {
    const cases = [{}, { GOOGLE_CLIENT_ID: ID }, { GOOGLE_CLIENT_SECRET: SECRET }, { GOOGLE_CLIENT_ID: '  ', GOOGLE_CLIENT_SECRET: SECRET }, { GOOGLE_CLIENT_ID: ID, GOOGLE_CLIENT_SECRET: '' }];
    cases.forEach((env, i) => {
      const out = path.join(dir, 'refused-' + i + '.json');
      const r = run(env, out);
      assert.notEqual(r.status, 0, JSON.stringify(Object.keys(env)));
      assert.ok(!fs.existsSync(out), 'wrote a file for ' + JSON.stringify(Object.keys(env)));
      assert.match(r.stderr, /GOOGLE_CLIENT_(ID|SECRET)/);
    });
    assert.equal(writeGoogleClient({}, path.join(dir, 'x.json')).ok, false);
  });
});
