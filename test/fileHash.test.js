'use strict';
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { hashFile } = require('../electron/fileHash.js');

describe('hashFile', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evm-hash-'));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  it('matches the hash of the whole buffer, across several stream chunks', async () => {
    const buf = crypto.randomBytes(300 * 1024);
    const f = path.join(dir, 'm.webm');
    fs.writeFileSync(f, buf);
    assert.equal(await hashFile(f), crypto.createHash('sha256').update(buf).digest('hex'));
  });
  it('rejects for a file that is not there', async () => {
    await assert.rejects(hashFile(path.join(dir, 'none.webm')));
  });
});
