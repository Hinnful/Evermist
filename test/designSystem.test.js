'use strict';

// The design system, checked against every stylesheet. The lists (radii, heights, type sizes, the atom
// registry, what stays outside, the contrast pairs) are the tables in
// .claude/rules/design-system.md. What today's CSS breaks sits in designSystem.allow.json, counted per file;
// a count may only shrink, and must be lowered as it does.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ALLOW = require('./designSystem.allow.json');

const ROOT = path.join(__dirname, '..');
const CSS_DIR = path.join(ROOT, 'src/css');
const RULES = fs.readFileSync(path.join(ROOT, '.claude/rules/design-system.md'), 'utf8').replace(/\r\n/g, '\n');

// Each table row as its cells, for the table whose header's first cell is `first`.
function table(md, first) {
  const lines = md.split('\n');
  const at = lines.findIndex((l) => l.startsWith('| ' + first + ' |'));
  assert.ok(at >= 0, '.claude/rules/design-system.md has no table headed "' + first + '"');
  const rows = [];
  for (let i = at + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()));
  }
  return rows;
}
const ticks = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

function readLists(md) {
  const num = (v) => (v.endsWith('%') || v.endsWith('px') && v !== '0px' ? v : String(parseFloat(v)));
  const sizes = table(md, 'Style').flatMap((r) => ticks(r[1]));
  return {
    radii: new Set(table(md, 'Radius').map((r) => num(ticks(r[0])[0]))),
    heights: table(md, 'Height').map((r) => parseFloat(ticks(r[0])[0])),
    fontSizes: sizes.filter((s) => !s.includes('-')).map(parseFloat),
    fontRanges: sizes.filter((s) => s.includes('-')).map((s) => s.split('-').map(parseFloat)),
    gaps: table(md, 'Gap').map((r) => parseFloat(ticks(r[0])[0])),
    atoms: table(md, 'Atom').flatMap((r) => ticks(r[1]).map((sel) => ({
      sel, heights: ticks(r[2] || '').map(parseFloat), type: ticks(r[3] || '').map(parseFloat)[0],
    }))),
    outside: table(md, 'Outside').flatMap((r) => ticks(r[1])),
    pairs: table(md, 'Text').map((r) => ({ text: ticks(r[0])[0], on: ticks(r[1])[0], min: parseFloat(r[2]) })),
    motion: table(md, 'Motion').map((r) => ({ kind: ticks(r[0])[0], in: ticks(r[1])[0], out: ticks(r[2])[0] })),
    curves: table(md, 'Curve').map((r) => ({ name: ticks(r[0])[0], value: ticks(r[1])[0] })),
    loops: table(md, 'Loop').flatMap((r) => ticks(r[1])),
    exempt: table(md, 'Exempt').flatMap((r) => ticks(r[1])),
  };
}
const LISTS = readLists(RULES);

// Split on commas outside parentheses, so :is(a, b) stays whole.
function splitTop(s) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out.map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// Every rule as { file, sels, decls }, @media and @supports opened, @keyframes kept as one rule.
function parseCss(css, file, out = []) {
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const prelude = css.slice(i, open).trim();
    let depth = 1, j = open + 1;
    for (; j < css.length && depth; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
    }
    const body = css.slice(open + 1, j - 1);
    if (/^@(media|supports)/.test(prelude)) parseCss(body, file, out);
    else {
      const decls = [];
      for (const d of body.replace(/[{}]/g, ';').split(';')) {
        const c = d.indexOf(':');
        if (c > 0) decls.push({ prop: d.slice(0, c).trim().toLowerCase(), value: d.slice(c + 1).trim() });
      }
      out.push({ file, sels: prelude.startsWith('@') ? [prelude] : splitTop(prelude), decls, body });
    }
    i = j;
  }
  return out;
}

const NAMED = 'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood ' +
  'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen ' +
  'darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray ' +
  'darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia ' +
  'gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender ' +
  'lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink ' +
  'lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta ' +
  'maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise ' +
  'mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
  'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red ' +
  'rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow ' +
  'springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen';
const COLOUR = new RegExp('#[0-9a-f]{3,8}\\b|\\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\\([^)]*\\)|(?<![\\w-])(?:' +
  NAMED.split(' ').join('|') + ')(?![\\w-])', 'gi');
// url() holds SVG markup whose fills are not the interface's colours.
const colourLiterals = (value) => value.replace(/url\((?:"[^"]*"|'[^']*'|[^)]*)\)/g, '').match(COLOUR) || [];

function rgbOf(lit) {
  let m = /^#([0-9a-f]{3,8})$/i.exec(lit);
  if (m) {
    const h = m[1].length <= 4 ? m[1].replace(/./g, '$&$&') : m[1];
    return [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16)).concat(h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1);
  }
  m = /^rgba?\(([^)]*)\)$/i.exec(lit);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  if (/^white$/i.test(lit)) return [255, 255, 255, 1];
  if (/^black$/i.test(lit)) return [0, 0, 0, 1];
  return null;
}

// Near-black is a shadow, a veil or the dark behind a picture, never an interface colour; white is text on a
// solid fill only where the same rule lays that fill.
const NEAR_BLACK = 26;
const SOLID_FILL = /(?:^|;)\s*background(?:-color)?\s*:\s*var\(\s*--(?:b|r)-solid/;
function exempt(prop, lit, body) {
  const c = rgbOf(lit);
  if (!c) return false;
  if (prop !== 'color') return Math.max(c[0], c[1], c[2]) <= NEAR_BLACK;
  return c[0] === 255 && c[1] === 255 && c[2] === 255 && c[3] === 1 && SOLID_FILL.test(body);
}

const RADIUS_PROPS = /^border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius$/;
const COLOURED_VAR = /var\(\s*--(?:b|r|y)-/;
const touches = (sel, frags) => frags.some((f) => sel.includes(f));

// The simple parts of a compound: tags, classes, ids, attributes.
const parts = (compound) => compound.match(/\.[\w-]+|#[\w-]+|\[[^\]]+\]|^[a-z][\w-]*/gi) || [];
// The atoms whose selector names this one's subject; a pseudo-element is another box and names none.
function atomsOf(sel) {
  const bare = sel.replace(/::?[\w-]+(\([^)]*\))?/g, (p) => (p.startsWith('::') ? p : ''));
  const chain = bare.split(/\s*[\s>+~]\s*/).filter(Boolean);
  const subject = chain[chain.length - 1] || '';
  if (subject.includes('::')) return [];
  const have = new Set(parts(subject));
  return LISTS.atoms.filter((a) => {
    const ac = a.sel.split(/\s*[\s>]\s*/);
    const want = parts(ac[ac.length - 1]);
    if (!want.every((p) => have.has(p))) return false;
    return ac.slice(0, -1).every((anc) => bare.slice(0, bare.length - subject.length).includes(anc));
  });
}
const pxOf = (value) => (/var\(|calc\(/.test(value) ? null : (/^(-?\d*\.?\d+)px$/.exec(value) || [])[1]);
const fontPx = (prop, value) => {
  if (/var\(|calc\(/.test(value)) return null;
  if (prop === 'font-size') return pxOf(value);
  const m = /(\d*\.?\d+)px\s*(?:\/|\s)/.exec(value + ' ');
  return m ? m[1] : null;
};
const fontOnScale = (n) => LISTS.fontSizes.includes(n) || LISTS.fontRanges.some(([lo, hi]) => n >= lo && n <= hi);

// A transition or animation rides the motion tokens, is the hover colour at 120ms, or plays a registered Loop.
const MOTION_PROPS = /^(?:transition|transition-duration|transition-timing-function|animation|animation-name)$/;
const HOVER_PROPS = new Set(['color', 'background', 'background-color', 'border-color', 'fill']);
const TOKEN_TIME = /^var\(\s*--m-[\w-]+\s*\)$/;
const TOKEN_CURVE = /^(?:var\(\s*--m-[\w-]+\s*\)|linear)$/;
function motionOk(prop, value) {
  const v = value.replace(/\s*!important$/, '').trim();
  if (v === 'none') return true;
  if (prop === 'transition-duration') return splitTop(v).every((d) => TOKEN_TIME.test(d));
  if (prop === 'transition-timing-function') return splitTop(v).every((d) => TOKEN_CURVE.test(d));
  if (prop.startsWith('animation')) {
    return splitTop(v).every((part) => part.split(/\s+/).some((w) => LISTS.loops.includes(w)));
  }
  return splitTop(v).every((part) => {
    const words = part.match(/var\([^)]*\)|cubic-bezier\([^)]*\)|\S+/g) || [];
    const [what, time, curve, ...rest] = words;
    if (what === 'none') return true;
    if (TOKEN_TIME.test(time || '') && (curve === undefined || TOKEN_CURVE.test(curve)) && rest.length === 0) return true;
    return HOVER_PROPS.has(what) && /^(?:0?\.12s|120ms)$/.test(time || '') && curve === undefined;
  });
}

// Script code moves only through motion.js; the Player's scene cover and the undo timer bar keep their own.
const MOTION_JS_OWNERS = new Set(['ui/motion.js', 'player/playerMap.js', 'scenes/sceneDelete.js']);
function motionInScripts(dir) {
  const faults = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.name.endsWith('.js') && !MOTION_JS_OWNERS.has(r)) {
        fs.readFileSync(path.join(dir, r), 'utf8').split('\n').forEach((line, i) => {
          if (/\.animate\(|\.style\.(?:transition|animation)\b/.test(line)) faults.push(r + ':' + (i + 1) + ' ' + line.trim());
        });
      }
    }
  };
  walk('');
  return faults;
}

// Every rule's breaks, by rule name and file.
function scan(dir) {
  const found = { colours: {}, radii: {}, heights: {}, fontSizes: {}, roles: {}, gaps: {}, uppercase: {}, borderLeft: {}, motion: {} };
  const where = {};
  const hit = (rule, file, what) => {
    found[rule][file] = (found[rule][file] || 0) + 1;
    (where[rule + ' ' + file] = where[rule + ' ' + file] || []).push(what);
  };
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.css')).sort()) {
    const css = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const rule of parseCss(css, file)) {
      const label = rule.sels.join(', ');
      if (rule.sels[0].startsWith('@font-face')) continue;
      const tokenHome = file === 'base.css' && rule.sels.length === 1 && rule.sels[0] === ':root';
      const outside = rule.sels.every((s) => touches(s, LISTS.outside));
      const atoms = rule.sels.flatMap(atomsOf);
      for (const { prop, value } of rule.decls) {
        if (!tokenHome && !outside) {
          for (const lit of colourLiterals(value)) if (!exempt(prop, lit, rule.body)) hit('colours', file, label + ' ' + lit);
        }
        if (RADIUS_PROPS.test(prop) && !outside && !/var\(|calc\(/.test(value)) {
          for (const v of value.split(/[\s/]+/).filter(Boolean)) {
            const n = /^0(px)?$/.test(v) ? '0' : /^\d*\.?\d+px$/.test(v) ? (v === '999px' ? v : String(parseFloat(v))) : v;
            if (!LISTS.radii.has(n)) hit('radii', file, label + ' ' + v);
          }
        }
        if (atoms.length && (prop === 'height' || prop === 'min-height')) {
          const n = pxOf(value);
          const ok = LISTS.heights.concat(...atoms.map((a) => a.heights));
          if (n !== null && n !== undefined && !ok.includes(parseFloat(n))) hit('heights', file, label + ' ' + value);
        }
        if (prop === 'font-size' || prop === 'font') {
          const n = fontPx(prop, value);
          if (n !== null && n !== undefined && !fontOnScale(parseFloat(n))) hit('fontSizes', file, label + ' ' + value);
          const want = atoms.map((a) => a.type).filter((t) => t !== undefined);
          if (n !== null && n !== undefined && want.length && !want.includes(parseFloat(n))) hit('roles', file, label + ' ' + value);
        }
        if (/^(?:row-|column-)?gap$/.test(prop) && !/var\(|calc\(/.test(value)) {
          for (const v of value.split(/\s+/).filter(Boolean)) {
            const n = /^0(px)?$/.test(v) ? 0 : /^\d*\.?\d+px$/.test(v) ? parseFloat(v) : null;
            if (n === null || !LISTS.gaps.includes(n)) hit('gaps', file, label + ' ' + v);
          }
        }
        if (prop === 'text-transform' && /uppercase/i.test(value)) hit('uppercase', file, label);
        if (MOTION_PROPS.test(prop) && !rule.sels.every((sel) => touches(sel, LISTS.exempt)) && !motionOk(prop, value)) {
          hit('motion', file, label + ' ' + prop + ': ' + value);
        }
        if (/^border-(?:left|inline-start)(?:-color)?$/.test(prop)) {
          const lits = colourLiterals(value).map(rgbOf);
          const chromatic = lits.some((c) => !c || c[0] !== c[1] || c[1] !== c[2]);
          if (chromatic || COLOURED_VAR.test(value)) hit('borderLeft', file, label + ' ' + value);
        }
      }
    }
  }
  return { found, where };
}

const WHY = {
  colours: 'a colour comes from a token on :root in base.css; only near-black shadows and veils and white on a solid fill stay literal',
  radii: 'a radius comes from the Radius table',
  heights: 'a control\'s height comes from the Height table or its atom\'s own heights',
  fontSizes: 'every type size comes from the Style table',
  gaps: 'every gap comes from the Gap table',
  roles: 'an atom with a Type cell takes that size: window titles 16, section titles 14, sub-headers 11',
  uppercase: 'headings are sentence case; no text-transform: uppercase',
  borderLeft: 'no coloured stripe on a block\'s left edge; a divider is a grey line',
  motion: 'a transition or animation rides the --m-* tokens, is the hover colour at 120ms, plays a Loop keyframe or sits on an Exempt selector (design-system.md, "Motion")',
};

// Counts held against the frozen allowance: no growth, no slack, no stale entry.
function ratchet(rule, found, where) {
  const allowed = ALLOW[rule] || {};
  const faults = [];
  for (const [file, n] of Object.entries(found)) {
    const cap = allowed[file] || 0;
    if (n > cap) faults.push(file + ': ' + n + ' (allowed ' + cap + '): ' + where[rule + ' ' + file].slice(0, 6).join(' | '));
    else if (n < cap) faults.push(file + ': down to ' + n + ' - lower its ' + rule + ' entry in test/designSystem.allow.json');
  }
  for (const file of Object.keys(allowed)) {
    if (!found[file]) faults.push(file + ': clean - delete its ' + rule + ' entry in test/designSystem.allow.json');
  }
  return faults;
}

// WCAG 2 relative luminance, as .claude/private/prototypes/design-system/contrast.py.
function tokens(baseCss) {
  const css = baseCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const root = parseCss(css, 'base.css').filter((r) => r.sels.length === 1 && r.sels[0] === ':root');
  const map = {};
  for (const r of root) for (const d of r.decls) if (d.prop.startsWith('--')) map[d.prop] = d.value;
  return map;
}
function resolve(map, name) {
  if (name === 'white') return [255, 255, 255, 1];
  let v = map[name];
  for (let k = 0; v && k < 8; k++) {
    const m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(v);
    if (!m) break;
    v = map[m[1]];
  }
  return v === undefined ? undefined : rgbOf(v);
}
const over = (c, ground) => [0, 1, 2].map((k) => Math.round(c[3] * c[k] + (1 - c[3]) * ground[k]));
function luminance(rgb) {
  const ch = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(rgb[0]) + 0.7152 * ch(rgb[1]) + 0.0722 * ch(rgb[2]);
}
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function contrastFaults(map, pairs, allowed) {
  const ground = resolve(map, '--g-bg');
  const faults = [];
  const failing = new Set();
  for (const p of pairs) {
    const key = p.text + ' on ' + p.on;
    const t = resolve(map, p.text), s = resolve(map, p.on);
    if (!t || !s) { faults.push(key + ': base.css has no such token; list a pair only once its tokens exist'); continue; }
    const bg = over(s, ground);
    const r = ratio(over(t, bg), bg);
    if (r < p.min) {
      failing.add(key);
      if (!allowed.includes(key)) faults.push(key + ' is ' + r.toFixed(2) + ':1, under ' + p.min);
    }
  }
  for (const key of allowed) {
    if (!failing.has(key)) faults.push(key + ' passes or is no longer listed - delete it from contrast in test/designSystem.allow.json');
  }
  return faults;
}

describe('design system: stylesheets', () => {
  const { found, where } = scan(CSS_DIR);
  for (const rule of Object.keys(WHY)) {
    it('holds the ' + rule + ' rule, frozen exceptions aside', () => {
      assert.deepEqual(ratchet(rule, found[rule], where), [], WHY[rule]);
    });
  }

  it('names in the atom registry only selectors a stylesheet still has', () => {
    const css = fs.readdirSync(CSS_DIR).filter((f) => f.endsWith('.css'))
      .map((f) => fs.readFileSync(path.join(CSS_DIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');
    const has = (p) => !/^[.#]/.test(p) || new RegExp(p.replace(/[.#-]/g, '\\$&') + '(?![\\w-])').test(css);
    const gone = LISTS.atoms.filter((a) => !parts(a.sel.split(/\s*[\s>]\s*/).pop()).every(has)).map((a) => a.sel);
    assert.deepEqual(gone, [], 'a registry row names a class no stylesheet has, so its checks pass on nothing - fix the row');
  });

  it('reads the Motion, Curve, Loop and Exempt tables, and base.css holds their values', () => {
    const map = tokens(fs.readFileSync(path.join(CSS_DIR, 'base.css'), 'utf8'));
    const faults = [];
    assert.ok(LISTS.motion.length >= 9 && LISTS.curves.length >= 3 && LISTS.loops.length && LISTS.exempt.length, 'a motion table is empty');
    for (const m of LISTS.motion) {
      const want = m.out ? [['--m-' + m.kind + '-in', m.in], ['--m-' + m.kind + '-out', m.out]] : m.in ? [['--m-' + m.kind, m.in]] : [];
      for (const [tok, val] of want) if (map[tok] !== val) faults.push(tok + ' is ' + map[tok] + ', the Motion table says ' + val);
    }
    for (const c of LISTS.curves) {
      if (!c.name.startsWith('--')) continue;
      if ((map[c.name] || '').replace(/\s+/g, '') !== c.value.replace(/\s+/g, '')) faults.push(c.name + ' is ' + map[c.name] + ', the Curve table says ' + c.value);
    }
    const css = fs.readdirSync(CSS_DIR).filter((f) => f.endsWith('.css')).map((f) => fs.readFileSync(path.join(CSS_DIR, f), 'utf8')).join('\n');
    for (const k of LISTS.loops) if (!new RegExp('@keyframes\\s+' + k + '\\b').test(css)) faults.push('Loop names ' + k + ', which no stylesheet defines');
    assert.deepEqual(faults, []);
  });

  it('moves script code only through motion.js', () => {
    assert.deepEqual(motionInScripts(path.join(ROOT, 'src')), [],
      'open or close a surface with motionShow / motionHide (motion.js), never .animate() or style.transition / style.animation');
  });

  it('meets each contrast pair in .claude/rules/design-system.md', () => {
    const map = tokens(fs.readFileSync(path.join(CSS_DIR, 'base.css'), 'utf8'));
    assert.deepEqual(contrastFaults(map, LISTS.pairs, ALLOW.contrast || []), [],
      'lift the text token or move it to a surface it can be read on');
  });
});

describe('design system: the scan bites', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-'));
  fs.writeFileSync(path.join(dir, 'base.css'), ':root { --g-bg: #1e1e21; --x: #123456; }\n.a { color: #abcdef; }');
  fs.writeFileSync(path.join(dir, 'x.css'), [
    '.sm-hbtn { border-radius: 5px; height: 26px; font-size: 11.5px; }',
    '.sm-hbtn .label { height: 26px; }',
    '.box2 { border-radius: 7px; text-transform: uppercase; border-left: 3px solid var(--b-solid); }',
    '.sep { border-left: 1px solid rgba(255, 255, 255, 0.08); color: white; }',
    '.cp-slider-knob { border-radius: 3px; background: #fff; }',
    '.side-enemy input { color: #f0937f; border-radius: calc(5px * 2); }',
    '.pop { box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45); background: #0b0b0d; border-color: #2a2b2f; }',
    '.go { background: var(--b-solid); color: #fff; } .x:hover { color: #fff; }',
    '.sm-whead { height: 48px; } .rail-ind { height: 30px; } .sm-hbtn { height: 30px; }',
    '.row { gap: 5px 8px; font: 500 12.5px/1 sans-serif; } .col { row-gap: 16px; column-gap: var(--x); }',
    '.sm-wtitle { font: 600 14px/1 sans-serif; } .dk-sub { font-size: 11px; }',
    '.fade { transition: opacity .3s; } .ok { transition: opacity var(--m-menu-in) linear, transform var(--m-menu-in) var(--m-enter); }',
    '.hov { transition: background .12s, color .12s; } .spin { animation: bsSpin .8s linear infinite; } .pop { animation: smPopIn .16s ease; }',
    '.car { transition: transform .12s; } .slow { transition: background .3s; }',
  ].join('\n'));
  const { found } = scan(dir);

  it('sees literals outside :root, passing near-black shadows and white on a solid fill', () => {
    assert.deepEqual(found.colours, { 'base.css': 1, 'x.css': 5 });
  });
  it('sees an off-list radius, skipping what stays outside and calc()', () => {
    assert.deepEqual(found.radii, { 'x.css': 2 });
  });
  it('sees an off-scale height on a named atom only, with its own heights allowed', () => {
    assert.deepEqual(found.heights, { 'x.css': 2 });
  });
  it('sees an off-scale type size or gap on any rule, skipping var()', () => {
    assert.deepEqual(found.fontSizes, { 'x.css': 2 });
    assert.deepEqual(found.gaps, { 'x.css': 1 });
  });
  it('sees an atom off the size its Type cell names', () => {
    assert.deepEqual(found.roles, { 'x.css': 1 });
  });
  it('sees uppercase and a coloured left border, not a grey divider', () => {
    assert.deepEqual(found.uppercase, { 'x.css': 1 });
    assert.deepEqual(found.borderLeft, { 'x.css': 1 });
  });
  it('sees a transition or animation off the motion system, passing tokens, the hover colour, a Loop and an Exempt selector', () => {
    assert.deepEqual(found.motion, { 'x.css': 3 });
  });
  it('sees an .animate() or a style.transition outside motion.js', () => {
    const js = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-js-'));
    fs.mkdirSync(path.join(js, 'ui'));
    fs.writeFileSync(path.join(js, 'ui', 'motion.js'), 'el.animate([], 1);');
    fs.writeFileSync(path.join(js, 'ui', 'x.js'), 'el.animate([], 1);\nel.style.transition = "none";\nel.style.opacity = 1;');
    assert.equal(motionInScripts(js).length, 2);
  });
  it('fails a pair under its threshold and an allowance that now passes', () => {
    const map = { '--g-bg': '#1e1e21', '--g-dim': '#8b9099', '--g-text': '#e4e6ea' };
    assert.equal(contrastFaults(map, [{ text: '--g-dim', on: '--g-bg', min: 7 }], []).length, 1);
    assert.equal(contrastFaults(map, [{ text: '--g-text', on: '--g-bg', min: 7 }], ['--g-text on --g-bg']).length, 1);
    assert.equal(contrastFaults(map, [{ text: '--g-none', on: '--g-bg', min: 3 }], []).length, 1);
  });
});
