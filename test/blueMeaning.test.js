'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Solid blue means "press this"; the blue tint means "picked". A fill of solid blue anywhere else
// reads as a pick, so every selector that may wear it is named here.
const ALLOWED = [
  /^\.sm-hbtn\.primary(:hover)?$/,           // each window's main button
  /^\.tv-go$/,                               // Show on TV
  /^\.tv-grp \.lv\.sw:hover$/,               // the TV pill's Stop, a press target
  /^#wm-bar \.wm-bar-open(:hover)?$/,        // the world map's Open
  /^\.sm-track i$/,                          // progress fill
  /^#pv-frame span$/,                        // the Player-view label
  /^\.wm-card\[data-col\]:not\(\[data-col=""\]\)::after$/, // the world map's L/R number badge
  /^\.wm-lm\[data-col\]:not\(\[data-col=""\]\)::after$/,
  /^\.cb-colsize:hover$/,                    // a resize line, not a fill
];

const SOLID = /background(?:-color)?\s*:[^;}]*(var\(\s*--b-solid|#0c8ce9|#2a9cf0|rgb\(\s*12\s*,\s*140\s*,\s*233\s*\))/i;

function offenders(dir) {
  const bad = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.css'))) {
    const css = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
      if (!SOLID.test(m[2])) continue;
      for (const sel of m[1].split(',').map((s) => s.replace(/\s+/g, ' ').trim())) {
        if (!ALLOWED.some((a) => a.test(sel))) bad.push(`${file}: ${sel}`);
      }
    }
  }
  return bad;
}

test('solid blue fills only the things to press', () => {
  assert.deepStrictEqual(offenders(path.join(__dirname, '..', 'src', 'css')), []);
});

test('the scan sees a solid fill on a pick', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'blue-'));
  fs.writeFileSync(path.join(dir, 'x.css'), '.tool-btn.active { background: var(--b-solid); }\n.sm-hbtn.primary { background: var(--b-solid); }');
  assert.deepStrictEqual(offenders(dir), ['x.css: .tool-btn.active']);
});
