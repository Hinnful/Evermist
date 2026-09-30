'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// The rig launches with --offscreen so a run never lands on the DM's screen. offscreen.ps1 would
// move a window that forgot the flag a moment later, which hides the miss, so this reads the source.
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function optionBlocks(src, opener) {
  const out = [];
  let i = src.indexOf(opener);
  while (i !== -1) {
    let depth = 0, j = src.indexOf('{', i);
    const start = j;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) break;
    }
    out.push(src.slice(start, j + 1));
    i = src.indexOf(opener, j);
  }
  return out;
}

describe('every window the app opens under the rig', () => {

  it('opens at the off-screen position', () => {
    const blocks = optionBlocks(main, 'new BrowserWindow(').concat(optionBlocks(main, 'overrideBrowserWindowOptions:'));
    assert.ok(blocks.length >= 3, 'expected the splash, DM and Player window options');
    blocks.forEach((b, n) => assert.match(b, /\.\.\.OFFSCREEN_AT/, 'window options #' + (n + 1) + ' lack ...OFFSCREEN_AT'));
  });

  it('shows a window without taking focus', () => {
    assert.doesNotMatch(main.replace(/const reveal = .*\n/, ''), /\b\w+\.show\(\)/,
      'a window shown with show() takes focus under the rig; use reveal()');
  });
});
