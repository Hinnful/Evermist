'use strict';

const fs = require('fs');
const path = require('path');
const globals = require('globals');
const espree = require('espree');

// The browser scripts share one global scope through plain <script> tags, so a name declared at
// the top of any of them is a global for all the others. Collected here rather than listed by
// hand, so `no-undef` still catches a misspelt or deleted name.
const ROOT = __dirname;
const HTML = ['index.html', 'stage.html', 'splash.html'];
const WINDOW = /\bwindow\.([A-Za-z_$][\w$]*)\s*=[^=]/g;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.js') ? [p] : [];
  });
}

function bind(pattern, out) {
  if (!pattern) return;
  if (pattern.type === 'Identifier') out[pattern.name] = 'writable';
  else if (pattern.type === 'ObjectPattern') pattern.properties.forEach((p) => bind(p.value || p.argument, out));
  else if (pattern.type === 'ArrayPattern') pattern.elements.forEach((e) => bind(e, out));
  else if (pattern.type === 'RestElement') bind(pattern.argument, out);
  else if (pattern.type === 'AssignmentPattern') bind(pattern.left, out);
}

function namesIn(text, out) {
  let ast;
  try {
    ast = espree.parse(text, { ecmaVersion: 2022, sourceType: 'script' });
  } catch {
    return;
  }
  for (const node of ast.body) {
    if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) out[node.id.name] = 'writable';
    if (node.type === 'VariableDeclaration') node.declarations.forEach((d) => bind(d.id, out));
  }
  for (const w of text.matchAll(WINDOW)) out[w[1]] = 'writable';
}

function shared() {
  const out = {};
  for (const file of walk(path.join(ROOT, 'src'))) namesIn(fs.readFileSync(file, 'utf8'), out);
  for (const page of HTML) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) namesIn(m[1], out);
  }
  return out;
}

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { vars: 'local', args: 'none', caughtErrors: 'none' }],
  'no-redeclare': 'off',
  'no-empty': 'off',
  'no-useless-escape': 'off',
  'no-control-regex': 'off',
  'no-cond-assign': ['error', 'except-parens'],
};

const shippedRules = { ...rules, 'max-lines-per-function': ['error', { max: 120, skipBlankLines: true, skipComments: true }] };

module.exports = [
  { ignores: ['lib/**', 'node_modules/**', 'dist/**', 'src/ui/changelogData.js'] },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...shared(), PIXI: 'readonly', polygonClipping: 'readonly', module: 'readonly', require: 'readonly' },
    },
    rules: shippedRules,
  },
  // Runs as an Electron utility process as well as in the page.
  { files: ['src/content/pdfExtract.js'], languageOptions: { globals: { process: 'readonly' } } },
  {
    files: ['main.js', 'preload.js', 'electron/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: shippedRules,
  },
  {
    files: ['tools/**/*.js', 'test/**/*.js', '.claude/**/*.js', 'eslint.config.js', 'stryker.conf.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } },
    rules,
  },
];
