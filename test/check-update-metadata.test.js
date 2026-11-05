'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { metadataProblems } = require('../tools/check-update-metadata.js');

let dir;
const put = (name, text = 'x') => fs.writeFileSync(path.join(dir, name), text);
const pointer = (name, files) => {
  put(name, 'version: 9.9.9\nfiles:\n' + files.map(f => '  - url: ' + f + '\n    sha512: abc\n').join('') +
    'path: ' + files[0] + '\nsha512: abc\n');
  return path.join(dir, name);
};

describe('the update pointer check', () => {
  before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evermist-meta-')); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('passes a Windows pointer whose installer has its blockmap', () => {
    put('Evermist-Setup-9.9.9.exe');
    put('Evermist-Setup-9.9.9.exe.blockmap');
    assert.deepEqual(metadataProblems(pointer('latest.yml', ['Evermist-Setup-9.9.9.exe']), '9.9.9'), []);
  });

  it('refuses an installer with no blockmap beside it', () => {
    put('Evermist.zip');
    put('Evermist.dmg');
    put('Evermist.dmg.blockmap');
    const out = metadataProblems(pointer('latest-mac.yml', ['Evermist.zip', 'Evermist.dmg']), '9.9.9');
    assert.equal(out.length, 1);
    assert.match(out[0], /Evermist\.zip\.blockmap/);
  });

  it('asks no blockmap of an AppImage, which carries its own', () => {
    put('Evermist.AppImage');
    assert.deepEqual(metadataProblems(pointer('latest-linux.yml', ['Evermist.AppImage']), '9.9.9'), []);
  });

  it('refuses a missing installer and a wrong version', () => {
    const out = metadataProblems(pointer('latest.yml', ['Evermist-Setup-1.0.0.exe']), '9.9.8');
    assert.equal(out.length, 2);
  });
});
