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

// ⚠ EVERY PAGE THE APP LOADS, not just the one the DM opens. stage.html is the two-map shell and
// it pulls its own stylesheets; a page left out of this list is a page whose assets nothing
// checks, and a missing stylesheet renders unstyled in the .exe rather than erroring.
const HTML_ENTRIES = ['index.html', 'splash.html', 'stage.html'];

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

  // The vendored copy is what the app actually runs; the devDependency only records which
  // version it came from. Nothing tied the two together, so an npm bump could leave the app on
  // one PixiJS and the repo claiming another. polygon-clipping is pinned the same way.
  it('ships a vendored PixiJS matching the version package.json names', () => {
    assert.equal(pkg.devDependencies['pixi.js'], '7.4.3', 'pin pixi.js exactly, not with a caret');
    assert.ok(patterns.indexOf('lib/pixi.min.js') >= 0, 'lib/pixi.min.js is not in build.files');
    const banner = read('lib/pixi.min.js').slice(0, 400);
    const m = /pixi\.js\s*-\s*v([\d.]+)/.exec(banner);
    assert.ok(m, 'lib/pixi.min.js carries no version banner to check');
    assert.equal(m[1], pkg.devDependencies['pixi.js'],
                 'the vendored PixiJS is not the version package.json names');
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
  // ⚠ WALKS THE SUBSYSTEM FOLDERS. A read one level deep stops covering every module the moment
  // one moves into a folder, and reports success while parsing almost nothing.
  it('parses every module under src/', () => {
    const failed = [];
    const walk = (rel) => {
      for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
        if (e.isDirectory()) { if (e.name !== 'css') walk(rel + '/' + e.name); continue; }
        if (!e.name.endsWith('.js')) continue;
        const f = rel + '/' + e.name;
        try { new vm.Script(read(f)); }
        catch (err) { failed.push(f + ': ' + err.message); }
      }
    };
    walk('src');
    walk('electron');
    assert.ok(failed.length === 0, 'modules that failed to parse: ' + failed.join(', '));
  });

  // ⚠ THE MODULES SHARE ONE SCRIPT SCOPE, so a top-level `let` declared in two of them is a
  // SyntaxError that blanks the app on boot. Parsing them one at a time above cannot see it, and
  // neither can any other test - every module that would collide is DOM-coupled. Compiling them
  // in the page's own order reproduces the scope and surfaces the browser's own error.
  it('loads every script into one shared scope without a name collision', () => {
    const html = read('index.html');
    const parts = [];
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(html))) {
      const src = /\bsrc=["']([^"']+)["']/.exec(m[1]);
      if (src && src[1].startsWith('lib/')) continue;   // vendored bundles are not ours to police
      parts.push({ file: src ? src[1] : '<inline>', code: src ? read(src[1]) : m[2] });
    }
    // One file at a time onto what already compiled: V8 gives a duplicate declaration no usable
    // line, so the first prefix that throws names the file the collision arrived with.
    let ok = '';
    for (const p of parts) {
      const next = ok + '\n' + p.code;
      assert.doesNotThrow(() => new vm.Script(next), 'collision introduced by ' + p.file);
      ok = next;
    }
  });
});
