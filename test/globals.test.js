'use strict';

// The browser scripts share one global scope, and eslint's no-redeclare is off so they can, which
// leaves two rules unchecked by lint: a name declared twice silently takes the later copy, and
// mutable state written by more than one subsystem lives in src/state.js (CLAUDE.md).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const espree = require('espree');
// eslint's own scope analyser, installed with eslint.
const eslintScope = require('eslint-scope');

const ROOT = path.join(__dirname, '..');
const PAGES = ['index.html', 'stage.html', 'splash.html'];
const STATE = 'src/state.js';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const parse = (text) => espree.parse(text, { ecmaVersion: 'latest', sourceType: 'script', range: true });

function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = dir + '/' + e.name;
    return e.isDirectory() ? walk(rel) : e.name.endsWith('.js') ? [rel] : [];
  });
}

function pageScripts(page) {
  return [...read(page).matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1])
    .filter((s) => s.startsWith('src/') && s.endsWith('.js'));
}

function bound(pattern, out) {
  if (!pattern) return out;
  if (pattern.type === 'Identifier') out.push(pattern.name);
  else if (pattern.type === 'ObjectPattern') pattern.properties.forEach((p) => bound(p.value || p.argument, out));
  else if (pattern.type === 'ArrayPattern') pattern.elements.forEach((e) => bound(e, out));
  else if (pattern.type === 'RestElement') bound(pattern.argument, out);
  else if (pattern.type === 'AssignmentPattern') bound(pattern.left, out);
  return out;
}

// Every top-level declaration as { name, kind }. `var { a } = typeof module !== 'undefined' ?
// require(...) : window` redeclares a global on purpose so the file also loads in Node; it is skipped.
function topLevel(text, ast) {
  const out = [];
  for (const n of ast.body) {
    if (n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') {
      out.push({ name: n.id.name, kind: n.type === 'FunctionDeclaration' ? 'function' : 'class' });
    } else if (n.type === 'VariableDeclaration') {
      for (const d of n.declarations) {
        const init = d.init ? text.slice(d.init.range[0], d.init.range[1]) : '';
        if (/typeof module\b/.test(init) && /\brequire\(/.test(init)) continue;
        for (const name of bound(d.id, [])) out.push({ name, kind: n.kind });
      }
    }
  }
  return out;
}

const parsed = new Map();
function load(rel) {
  if (!parsed.has(rel)) {
    const text = read(rel);
    parsed.set(rel, { text, ast: parse(text) });
  }
  return parsed.get(rel);
}

// The names declared twice in one file.
function duplicatesIn(rel) {
  const { text, ast } = load(rel);
  const seen = new Map();
  for (const { name } of topLevel(text, ast)) seen.set(name, (seen.get(name) || 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([name, n]) => rel + ' declares ' + name + ' ' + n + ' times');
}

// The function names declared in two scripts one page loads.
function crossFileFunctions(page) {
  const owners = new Map();
  for (const rel of pageScripts(page)) {
    const { text, ast } = load(rel);
    for (const { name, kind } of topLevel(text, ast)) {
      if (kind !== 'function') continue;
      if (!owners.has(name)) owners.set(name, new Set());
      owners.get(name).add(rel);
    }
  }
  return [...owners].filter(([, s]) => s.size > 1)
    .map(([name, s]) => page + ' loads ' + name + ' from ' + [...s].join(' and '));
}

// Every write that crosses folders: a module-level `let` or `var` declared in a page-loaded script
// other than src/state.js, written from a page-loaded script in another folder, by name or through
// `window.NAME =` / `globalThis.NAME =`. A Map of "file" -> Map of name -> Set of writing files.
function eachNode(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach((c) => eachNode(c, visit));
    else if (v && typeof v.type === 'string') eachNode(v, visit);
  }
}

function globalPropertyWrites(ast) {
  const out = [];
  eachNode(ast, (n) => {
    const target = n.type === 'AssignmentExpression' ? n.left : n.type === 'UpdateExpression' ? n.argument : null;
    if (!target || target.type !== 'MemberExpression' || target.object.type !== 'Identifier') return;
    if (target.object.name !== 'window' && target.object.name !== 'globalThis') return;
    if (!target.computed && target.property.type === 'Identifier') out.push(target.property.name);
    else if (target.computed && target.property.type === 'Literal') out.push(String(target.property.value));
  });
  return out;
}

function crossFolderWrites() {
  const found = new Map();
  const note = (home, name, rel) => {
    if (!found.has(home)) found.set(home, new Map());
    if (!found.get(home).has(name)) found.get(home).set(name, new Set());
    found.get(home).get(name).add(rel);
  };
  for (const page of PAGES) {
    const scripts = pageScripts(page);
    const owner = new Map();
    for (const rel of scripts) {
      if (rel === STATE) continue;
      const { text, ast } = load(rel);
      for (const { name, kind } of topLevel(text, ast)) if (kind === 'let' || kind === 'var') owner.set(name, rel);
    }
    const foreign = (name, rel) => {
      const home = owner.get(name);
      return home && path.posix.dirname(home) !== path.posix.dirname(rel) ? home : null;
    };
    for (const rel of scripts) {
      const { ast } = load(rel);
      const scope = eslintScope.analyze(ast, { ecmaVersion: 2022, sourceType: 'script' });
      for (const ref of scope.globalScope.through) {
        const home = ref.isWrite() && foreign(ref.identifier.name, rel);
        if (home) note(home, ref.identifier.name, rel);
      }
      for (const name of globalPropertyWrites(ast)) {
        const home = foreign(name, rel);
        if (home) note(home, name, rel);
      }
    }
  }
  return found;
}

describe('house rules: global declarations', () => {
  it('declares no top-level name twice in one file', () => {
    const faults = [...walk('src'), ...walk('electron')].flatMap(duplicatesIn);
    assert.deepEqual(faults, [],
      'the later declaration silently wins and the earlier one is dead code. Keep the copy that runs ' +
      '(the last one) and delete the other:\n' + faults.join('\n'));
  });

  for (const page of PAGES) {
    it('declares no function twice across the scripts ' + page + ' loads', () => {
      const faults = crossFileFunctions(page);
      assert.deepEqual(faults, [],
        'the script loaded later silently replaces the other. Rename one, or keep one copy in the ' +
        'module that owns it:\n' + faults.join('\n'));
    });
  }
});

describe('house rules: shared state lives in src/state.js', () => {
  it('writes no module-level let or var from another folder', () => {
    const faults = [];
    for (const [home, names] of crossFolderWrites()) {
      for (const [name, writers] of names) faults.push(home + ': ' + name + ' is written from ' + [...writers].join(', '));
    }
    assert.deepEqual(faults, [],
      'state written by more than one subsystem has one home. Move the binding into src/state.js:\n' +
      faults.join('\n'));
  });
});
