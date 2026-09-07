'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Structural checks, not a module's behaviour. The one that earns its place is packaging:
// a file the HTML loads but `build.files` never ships runs fine under `npm start` and
// fails silently in the packaged app, where a missing stylesheet just renders unstyled.
// See CLAUDE.md, "What ships in the build".

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const patterns = (pkg.build && pkg.build.files) || [];

const HTML_ENTRIES = ['index.html', 'splash.html'];

const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

// electron-builder glob semantics, narrowed to what build.files actually uses.
// `**` crosses directories, `*` does not, and a leading `!` excludes.
function toRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { out += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + out + '$');
}

// ⚠ LAST MATCH WINS, so a `!` pattern followed by a narrower include still ships the
// named file - which is exactly how pdfjs-dist is carved down to three paths.
function isPackaged(rel) {
  let shipped = false;
  for (const p of patterns) {
    const negated = p.startsWith('!');
    if (toRegExp(negated ? p.slice(1) : p).test(rel)) shipped = !negated;
  }
  return shipped;
}

// Local assets only. A CDN URL is not ours to package, and the app has none today.
function assetsOf(html, attr, tag) {
  const re = new RegExp('<' + tag + '[^>]*\\b' + attr + '=["\']([^"\']+)["\']', 'g');
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const src = m[1];
    if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:')) continue;
    out.push(src.replace(/^\.\//, ''));
  }
  return out;
}

describe('what ships in the build', () => {

  it('packages every script the HTML entry points load', () => {
    const missing = [];
    for (const entry of HTML_ENTRIES) {
      for (const src of assetsOf(read(entry), 'src', 'script')) {
        if (!isPackaged(src)) missing.push(entry + ' → ' + src);
      }
    }
    assert.deepEqual(missing, [], 'scripts loaded but absent from build.files');
  });

  it('packages every stylesheet the HTML entry points load', () => {
    const missing = [];
    for (const entry of HTML_ENTRIES) {
      for (const href of assetsOf(read(entry), 'href', 'link')) {
        if (!/\.css($|\?)/i.test(href)) continue;
        if (!isPackaged(href)) missing.push(entry + ' → ' + href);
      }
    }
    assert.deepEqual(missing, [], 'stylesheets loaded but absent from build.files');
  });

  it('names no build.files path that is missing from disk', () => {
    const missing = patterns.filter(p =>
      !p.startsWith('!') && !/[*?]/.test(p) && !fs.existsSync(path.join(root, p)));
    assert.deepEqual(missing, [], 'build.files entries with nothing behind them');
  });
});

describe('the code parses', () => {

  it('parses both inline scripts in index.html', () => {
    const blocks = read('index.html').match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || [];
    assert.ok(blocks.length > 0, 'expected at least one inline script');
    blocks.forEach((block, i) => {
      const body = block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
      assert.doesNotThrow(() => new vm.Script(body), 'inline script #' + (i + 1));
    });
  });

  // Parse only - nothing runs, so browser globals never resolve and cost nothing.
  it('parses every module under src/', () => {
    const failed = [];
    for (const f of fs.readdirSync(path.join(root, 'src'))) {
      if (!f.endsWith('.js')) continue;
      try { new vm.Script(read('src/' + f)); }
      catch (e) { failed.push(f + ': ' + e.message); }
    }
    assert.deepEqual(failed, [], 'modules that failed to parse');
  });
});
