'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { judge } = require('../tools/check-release.js');

const base = { changed: [], packageChanged: false, bump: false, version: '3.11.0', subject: '' };
const run = (o) => judge(Object.assign({}, base, o));

describe('the release branch rules', () => {

  it('lands a docs or tooling change on change/** with no bump', () => {
    assert.deepEqual(run({ branch: 'change/docs', changed: ['docs/DECISIONS.md', 'tools/rig/run.js'] }), []);
  });

  it('refuses a change/** branch that touches the shipped app', () => {
    const out = run({ branch: 'change/fix', changed: ['src/fog/fog.js'] });
    assert.equal(out.length, 1);
    assert.match(out[0], /src\/fog\/fog\.js/);
  });

  it('refuses a runtime package.json change without a bump', () => {
    assert.equal(run({ branch: 'change/deps', changed: ['package.json'], packageChanged: true }).length, 1);
  });

  it('lets a devDependency edit through without a bump', () => {
    assert.deepEqual(run({ branch: 'change/deps', changed: ['package.json', 'package-lock.json'] }), []);
  });

  it('releases a bump on release/** that touches shipped code under a matching title', () => {
    assert.deepEqual(run({
      branch: 'release/3.11.0', bump: true, subject: '3.11.0 - Rooms fade in',
      changed: ['package.json', 'src/ui/changelogData.js', 'src/rooms/roomCard.js'],
    }), []);
  });

  it('lets a bump already on main republish with a fix that ships nothing', () => {
    assert.deepEqual(run({ branch: 'release/3.11.0', bump: true, landed: true, subject: '3.11.0 - Rooms fade in',
      changed: ['.github/workflows/release.yml'] }), []);
  });

  it('refuses a bump that touches only its own files', () => {
    const out = run({ branch: 'release/3.11.0', bump: true, subject: '3.11.0 - Nothing',
      changed: ['package.json', 'package-lock.json', 'src/ui/changelogData.js', 'docs/PRODUCT.md'] });
    assert.equal(out.length, 1);
    assert.match(out[0], /touches no shipped file/);
  });

  it('refuses a bump pushed to change/**', () => {
    const out = run({ branch: 'change/x', bump: true, subject: '3.11.0 - X', changed: ['main.js'] });
    assert.equal(out.length, 1);
    assert.match(out[0], /change\/\*\* branch/);
  });

  it('refuses a version commit whose title does not start with the version', () => {
    for (const subject of ['Rooms fade in', '3.11.0 Rooms fade in', '3.1.0 - Rooms fade in']) {
      const out = run({ branch: 'release/3.11.0', bump: true, subject, changed: ['main.js'] });
      assert.equal(out.length, 1, subject);
      assert.match(out[0], /must start "3\.11\.0 - "/);
    }
  });

  it('refuses a commit with a second author', () => {
    const out = run({ branch: 'change/docs', changed: ['docs/PROCESS.md'], strangers: ['50eec30'] });
    assert.equal(out.length, 1);
    assert.match(out[0], /50eec30/);
  });
});
