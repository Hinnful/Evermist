'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createFakeDrive, FOLDER } = require('../tools/rig/fakeDrive.js');

// The rig's stand-in for Drive has to behave like Drive, or every sync scenario proves nothing.
describe('the rig fake Drive', () => {
  const drive = createFakeDrive();
  let auth;
  before(async () => {
    await drive.start();
    const t = await (await fetch(drive.url + '/token', { method: 'POST', body: 'grant_type=refresh_token' })).json();
    auth = { Authorization: 'Bearer ' + t.access_token };
  });
  after(() => drive.stop());

  const start = async (name, total) => {
    const r = await fetch(drive.url + '/upload/drive/v3/files?uploadType=resumable', { method: 'POST',
      headers: Object.assign({ 'X-Upload-Content-Length': String(total) }, auth),
      body: JSON.stringify({ name, parents: ['appDataFolder'] }) });
    return r;
  };
  const list = async (q, extra) => (await fetch(drive.url + '/drive/v3/files?q=' + encodeURIComponent(q || '') + (extra || ''), { headers: auth })).json();

  test('a file exists only once its upload finishes, and a cut upload resumes', async () => {
    const body = Buffer.alloc(1000, 7);
    const loc = (await start('big.bin', 1000)).headers.get('location');
    // Cut after 400 bytes with a raw request, as a closed lid would.
    await new Promise(resolve => {
      const u = new URL(loc);
      drive.cutNext = { bytes: 400 };
      const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'PUT', headers: Object.assign({ 'Content-Range': 'bytes 0-999/1000' }, auth) });
      req.on('error', resolve); req.on('close', resolve);
      req.write(body); req.end();
    });
    assert.equal((await list("name = 'big.bin'")).files.length, 0, 'half an upload is not a file');
    const ask = await fetch(loc, { method: 'PUT', headers: { 'Content-Range': 'bytes */1000' } });
    assert.equal(ask.status, 308);
    assert.equal(ask.headers.get('range'), 'bytes=0-399');
    const done = await fetch(loc, { method: 'PUT', headers: { 'Content-Range': 'bytes 400-999/1000' }, body: body.subarray(400) });
    assert.equal(done.status, 200);
    const got = (await list("name = 'big.bin'")).files;
    assert.equal(got.length, 1);
    assert.equal(drive.read(got[0].id).length, 1000);
  });

  test('a full Drive refuses with the quota reason', async () => {
    drive.quotaFull = true;
    const r = await start('x', 1);
    drive.quotaFull = false;
    assert.equal(r.status, 403);
    assert.equal((await r.json()).error.errors[0].reason, 'storageQuotaExceeded');
  });

  test('an expired token is a 401 that only the refresh endpoint clears', async () => {
    drive.expireToken();
    assert.equal((await fetch(drive.url + '/drive/v3/about', { headers: auth })).status, 401);
    const t = await (await fetch(drive.url + '/token', { method: 'POST', body: 'grant_type=refresh_token' })).json();
    auth = { Authorization: 'Bearer ' + t.access_token };
    assert.equal((await fetch(drive.url + '/drive/v3/about', { headers: auth })).status, 200);
  });

  test('a listing comes in pages', async () => {
    for (const n of ['p1', 'p2', 'p3']) drive.put({ name: n, parents: ['pg'] }, Buffer.from(n));
    drive.pageSize = 2;
    const seen = [];
    let token = '';
    do {
      const page = await list("'pg' in parents", token ? '&pageToken=' + token : '');
      seen.push(...page.files.map(f => f.name));
      token = page.nextPageToken;
    } while (token);
    drive.pageSize = 0;
    assert.deepEqual(seen, ['p1', 'p2', 'p3']);
  });

  test('down refuses connections and up returns on the same address', async () => {
    const url = drive.url;
    await drive.down();
    await assert.rejects(fetch(url + '/drive/v3/about', { headers: auth }));
    await drive.up();
    assert.equal(drive.url, url);
    assert.equal((await fetch(url + '/drive/v3/about', { headers: auth })).status, 200);
  });

  test('a folder is made by metadata', async () => {
    const f = await (await fetch(drive.url + '/drive/v3/files', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'm', mimeType: FOLDER }) })).json();
    assert.equal(f.mimeType, FOLDER);
  });
});
