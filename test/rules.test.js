'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { analyze, findPersonRefs, classifyLines } = require('../.claude/hooks/guard-lib.js');

// CLAUDE.md rules that prose alone carried. Each failure names the rule and the fix.

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));
const HTML = ['index.html', 'splash.html', 'stage.html'];

function walk(rel, ext, out = []) {
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const f = rel + '/' + e.name;
    if (e.isDirectory()) { if (e.name !== 'lib') walk(f, ext, out); }
    else if (e.name.endsWith(ext)) out.push(f);
  }
  return out;
}
const APP_JS = [...walk('src', '.js'), ...walk('electron', '.js'), 'main.js', 'preload.js'];

// Code lines with their numbers; a whole-line comment is dropped, a trailing one cut.
function codeLines(rel) {
  const text = read(rel), kinds = classifyLines(text);
  return text.split(/\r?\n/).map((t, i) => ({ t: t.replace(/\s\/\/\s.*$/, ''), n: i + 1 }))
    .filter((_, i) => kinds[i] === 'code');
}
function hits(files, re) {
  const out = [];
  for (const f of files) for (const l of codeLines(f)) if (re.test(l.t)) out.push(f + ':' + l.n + '  ' + l.t.trim());
  return out;
}
const lineHits = (rel, re, text = read(rel)) => text.split(/\r?\n/)
  .map((t, i) => re.test(t) ? rel + ':' + (i + 1) + '  ' + t.trim() : null).filter(Boolean);

describe('app code rules', () => {
  it('calls no native confirm() or alert()', () => {
    const re = /(?<![\w$.]|function\s)(?:confirm|alert)\s*\(|\bwindow\.(?:confirm|alert)\s*\(/;
    const found = [...hits(APP_JS.filter(f => f !== 'src/ui/changelogData.js'), re),
      ...HTML.flatMap(f => lineHits(f, re))];
    assert.deepEqual(found, [], 'A native confirm()/alert() opens an OS window that desyncs page focus. ' +
      'Use confirmDialog or messageDialog (src/ui/confirmDialog.js) at the lines named.');
  });

  it('loads no <script type="module"> from a root HTML file', () => {
    const found = HTML.flatMap(f => lineHits(f, /<script\b[^>]*\btype\s*=\s*["']?module/i));
    assert.deepEqual(found, [], 'ES modules break on file://. Load it as a plain <script src="..."> at the lines named.');
  });

  it('keeps only state.js and undo.js at the src/ root', () => {
    const extra = fs.readdirSync(path.join(root, 'src'), { withFileTypes: true })
      .filter(e => !e.isDirectory() && !['state.js', 'undo.js'].includes(e.name)).map(e => 'src/' + e.name);
    assert.deepEqual(extra, [], 'src/ root holds only what every subsystem reads. ' +
      'Move each file named into the subsystem folder that owns it.');
  });

  it('never sets userData from the main process', () => {
    const found = hits(['main.js', 'preload.js', ...walk('electron', '.js')], /setPath\s*\(\s*['"`]userData/);
    assert.deepEqual(found, [], 'Redirecting userData orphaned a library on upgrade. ' +
      'Remove the setPath(\'userData\') call at the lines named.');
  });

  it('never sorts or reverses a polygons array in place', () => {
    const found = hits(walk('src', '.js'), /\bpolygons\s*\.\s*(?:sort|reverse)\s*\(/);
    assert.deepEqual(found, [], 'The polygons array order IS fog precedence. ' +
      'Sort a copy ([...polygons].sort) or carry a separate field at the lines named.');
  });
});

describe('tests', () => {
  const tests = fs.readdirSync(path.join(__dirname)).filter(f => f.endsWith('.test.js'));
  const required = new Map();
  for (const f of tests) {
    read('test/' + f).split(/\r?\n/).forEach((t, i) => {
      for (const m of t.matchAll(/require\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) {
        if (!m[1].startsWith('.')) continue;
        const base = path.basename(m[1]).replace(/(?<!\.js)$/, '.js');
        if (!required.has(base)) required.set(base, []);
        required.get(base).push('test/' + f + ':' + (i + 1));
      }
    });
  }

  it('requires nothing on the deliberately-untested list', () => {
    const UNTESTED = ['render.js', 'scenes.js', 'state.js', 'renderer.js', 'toolbar.js', 'player.js',
      'mapLoader.js', 'input.js', 'sceneStore.js', 'stress.js'];
    const found = UNTESTED.flatMap(b => (required.get(b) || []).map(at => at + '  ' + b));
    assert.deepEqual(found, [], 'CLAUDE.md lists these modules as deliberately untested because they are DOM-coupled. ' +
      'Drop the require at the lines named; test a pure kernel instead.');
  });

  it('requires every module .claude/rules/modules.md marks Tested', () => {
    const rows = read('.claude/rules/modules.md').split(/\r?\n/)
      .map((t, i) => ({ m: /^\|\s*`([^`]+\.js)`\s*\|(.*)\|\s*$/.exec(t), n: i + 1 }))
      .filter(r => r.m && /\btested\b/i.test(r.m[2]));
    assert.ok(rows.length > 0, 'no Tested rows found in .claude/rules/modules.md');
    const missing = rows.filter(r => !required.has(path.basename(r.m[1])))
      .map(r => '.claude/rules/modules.md:' + r.n + '  ' + r.m[1]);
    assert.deepEqual(missing, [], 'A module the map calls Tested has no test requiring it. ' +
      'Add a test/<name>.test.js that requires it, or drop "Tested" from its row.');
  });
});

describe('packaging', () => {
  it('builds Windows as an NSIS installer', () => {
    const t = pkg.build && pkg.build.win && pkg.build.win.target;
    const targets = [].concat(t || []).map(x => typeof x === 'string' ? x : x.target);
    assert.deepEqual(targets, ['nsis'], 'package.json build.win.target must be "nsis": ' +
      'a portable build cannot replace itself, which kills auto-update.');
  });

  const CSC = /CSC_IDENTITY_AUTO_DISCOVERY\s*[:=]\s*['"]?false\b/;

  it('sets CSC_IDENTITY_AUTO_DISCOVERY=false on every package.json script that runs electron-builder', () => {
    const bad = Object.entries(pkg.scripts || {})
      .filter(([, s]) => /\belectron-builder\b/.test(s) && !CSC.test(s.split(/\belectron-builder\b/)[0]))
      .map(([k]) => 'package.json scripts.' + k);
    assert.deepEqual(bad, [], 'The unsigned build needs CSC_IDENTITY_AUTO_DISCOVERY=false or the mac build fails. ' +
      'Prefix the scripts named with cross-env CSC_IDENTITY_AUTO_DISCOVERY=false.');
  });

  // No YAML parser in the repo, so scope by indentation: the step, then each enclosing mapping's env.
  it('sets CSC_IDENTITY_AUTO_DISCOVERY=false on every workflow step that runs electron-builder', () => {
    const bad = [];
    const indent = l => l.match(/^ */)[0].length;
    for (const wf of fs.readdirSync(path.join(root, '.github/workflows')).filter(f => /\.ya?ml$/.test(f))) {
      const rel = '.github/workflows/' + wf;
      const lines = read(rel).split(/\r?\n/);
      const live = i => lines[i].trim() && !lines[i].trim().startsWith('#');
      const hasEnv = (from, depth) => {
        for (let i = from + 1; i < lines.length; i++) {
          if (!live(i)) continue;
          const d = indent(lines[i]);
          if (d < depth) return false;
          if (d !== depth || !/^\s*(?:-\s+)?env:\s*$/.test(lines[i])) continue;
          for (let j = i + 1; j < lines.length && (!live(j) || indent(lines[j]) > d); j++) if (CSC.test(lines[j])) return true;
        }
        return false;
      };
      lines.forEach((l, i) => {
        if (!live(i) || !/\belectron-builder\b/.test(l) || /^\s*(?:-\s+)?name:/.test(l)) return;
        let s = i;
        while (s > 0 && !(/^\s*-\s/.test(lines[s]) && indent(lines[s]) < indent(l)) && !/^\s*-\s+run:/.test(lines[s])) s--;
        let d = indent(lines[s]);
        let ok = hasEnv(s, d + 2) || CSC.test(l.split(/\belectron-builder\b/)[0]) || hasEnv(-1, 0);
        for (let a = s - 1; !ok && a >= 0; a--) {
          if (!live(a) || indent(lines[a]) >= d) continue;
          d = indent(lines[a]);
          ok = hasEnv(a, d + 2);
        }
        if (!ok) bad.push(rel + ':' + (i + 1) + '  ' + l.trim());
      });
    }
    assert.deepEqual(bad, [], 'The unsigned build needs CSC_IDENTITY_AUTO_DISCOVERY=false or the mac build fails. ' +
      'Add it to the env of the steps named, or of their job.');
  });

  it('carries the package.json version as the newest changelog entry', () => {
    const list = vm.runInNewContext(read('src/ui/changelogData.js') + '\nCHANGELOG');
    assert.equal(list[0] && list[0].version, pkg.version, 'src/ui/changelogData.js:1 does not open with the version ' +
      'package.json holds. Run node tools/build-changelog.js after the bump commit and amend it; never edit it by hand.');
  });
});

describe('stylesheets', () => {
  const css = walk('src/css', '.css');
  const cssHits = re => css.flatMap(f => lineHits(f, re, read(f).replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, ''))));

  it('uses no @import and no @layer', () => {
    const found = cssHits(/@(?:import|layer)\b/);
    assert.deepEqual(found, [], 'src/css is one global cascade set by the <link> order in index.html. ' +
      'Drop the @import/@layer at the lines named and link the file from index.html.');
  });

  it('defines @keyframes cpAdvIn exactly once', () => {
    const found = cssHits(/@keyframes\s+cpAdvIn\b/);
    assert.equal(found.length, 1, '@keyframes cpAdvIn must live once, in controlPanel.css; found: ' +
      (found.join(', ') || 'none') + '. Keep one definition.');
  });

  it('puts no <style> block in index.html', () => {
    assert.deepEqual(lineHits('index.html', /<style\b/i), [], 'index.html has no <style> block. ' +
      'Move the rules at the lines named into the src/css file for that screen region.');
  });

  it('links base.css first, overlays.css last, and controlPanel.css before roomCard.css', () => {
    const links = [...read('index.html').matchAll(/<link\b[^>]*\bhref=["']([^"']+\.css)["']/g)].map(m => path.basename(m[1]));
    const at = n => links.indexOf(n);
    assert.equal(links[0], 'base.css', 'index.html must link base.css first: it defines --ui-zoom. See src/css/CLAUDE.md.');
    assert.equal(links[links.length - 1], 'overlays.css', 'index.html must link overlays.css last. See src/css/CLAUDE.md.');
    assert.ok(at('controlPanel.css') >= 0 && at('controlPanel.css') < at('roomCard.css'),
      'index.html must link controlPanel.css before roomCard.css: it defines @keyframes cpAdvIn. See src/css/CLAUDE.md.');
  });
});

describe('ledgers', () => {
  it('name no person', () => {
    const files = ['docs/DECISIONS.md', 'docs/PRODUCT.md',
      ...fs.readdirSync(path.join(root, 'docs/decisions')).filter(f => f.endsWith('.md')).map(f => 'docs/decisions/' + f)];
    const found = files.flatMap(f => findPersonRefs(analyze(read(f)).entries).map(h => f + ':' + h.line + '  ' + h.text));
    assert.deepEqual(found, [], 'A ledger entry records a decision, not who made it. ' +
      'Rewrite the lines named without he/she/his/her or "I/we decided".');
  });
});
