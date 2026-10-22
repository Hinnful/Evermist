'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { screenBody, screenLogger, tvLabel } = require('../electron/screenLog.js');

const d = (id, internal, x) => ({ id, internal, bounds: { x, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 }, scaleFactor: 1.25, label: '' });
const laptop = d(1, true, 0), tv = d(2, false, 1920), tv2 = d(3, false, 3840);

describe('screen log lines', () => {
  it('names the count, each screen and the TV', () => {
    const body = screenBody([laptop, tv], 1);
    assert.match(body, /^screens=2 \| dm=1 \| tv=2 \| id=1 bounds=0,0,1920x1080 scale=1.25 internal=true \| id=2 bounds=1920,0,1920x1080 scale=1.25 internal=false$/);
  });

  it('says none for one screen and ask for two candidates', () => {
    assert.equal(tvLabel([laptop], 1), 'none');
    assert.equal(tvLabel([laptop, tv, tv2], 1), 'ask(2,3)');
  });

  it('writes the first read, then only a change', () => {
    const take = screenLogger();
    const first = take([laptop], 1, 0);
    assert.ok(first.startsWith('1970-01-01T00:00:00.000Z screens=1'));
    assert.equal(take([laptop], 1, 1000), null);
    const second = take([laptop, tv], 1, 2000);
    assert.ok(second.includes('screens=2') && second.includes('tv=2'));
    assert.equal(take([laptop, tv], 1, 3000), null);
  });

  it('counts a move to another screen as a change', () => {
    const take = screenLogger();
    take([laptop, tv], 1, 0);
    assert.notEqual(take([laptop, tv], 2, 1), null);
  });
});
