'use strict';

// bestiaryPlan.js — pure kernel for the bestiary: what a monster is filed under, which ones a
// search and the filters let through, their order, and the file an export writes. No DOM.
// Unit-tested; see test/bestiaryPlan.test.js.

// English and Russian name the same size, type and alignment, so one filter holds both.
const BS_SIZES = [['Tiny', /^(tiny|крошечн)/i], ['Small', /^(small|маленьк)/i], ['Medium', /^(medium|средн)/i],
  ['Large', /^(large|больш)/i], ['Huge', /^(huge|огромн)/i], ['Gargantuan', /^(gargantuan|громадн|исполинск)/i]];
const BS_TYPES = [['Aberration', /^(aberration|аберрац)/i], ['Beast', /^(beast|звер)/i], ['Celestial', /^(celestial|небожит)/i],
  ['Construct', /^(construct|конструкт)/i], ['Dragon', /^(dragon|дракон)/i], ['Elemental', /^(elemental|элементал)/i],
  ['Fey', /^(fey|фе[яи])/i], ['Fiend', /^(fiend|исчади)/i], ['Giant', /^(giant|великан)/i], ['Humanoid', /^(humanoid|гуманоид)/i],
  ['Monstrosity', /^(monstrosity|монстр|чудовищ)/i], ['Ooze', /^(ooze|слиз)/i], ['Plant', /^(plant|растени)/i], ['Undead', /^(undead|нежит)/i]];
// Plain Neutral comes last: "нейтрально-злой" would match it first.
const BS_ALIGN = [['Lawful good', /(lawful good|законопослушн\S* добр)/i], ['Neutral good', /(neutral good|нейтральн\S* добр)/i],
  ['Chaotic good', /(chaotic good|хаотичн\S* добр)/i], ['Lawful neutral', /(lawful neutral|законопослушн\S* нейтральн)/i],
  ['Chaotic neutral', /(chaotic neutral|хаотичн\S* нейтральн)/i], ['Lawful evil', /(lawful evil|законопослушн\S* зл)/i],
  ['Neutral evil', /(neutral evil|нейтрально-зл|нейтральн\S* зл)/i], ['Chaotic evil', /(chaotic evil|хаотично-зл|хаотичн\S* зл)/i],
  ['Any evil', /(any evil|любое злое)/i], ['Unaligned', /(unaligned|без мировоззрения)/i], ['Neutral', /^(neutral|нейтральн\S*)$/i]];
const BS_MOVES = [['Fly', /fly|лета/i], ['Swim', /swim|плава/i], ['Climb', /climb|лаза/i], ['Burrow', /burrow|копа/i]];
const BS_CRS = ['0', '1/8', '1/4', '1/2'].concat(Array.from({ length: 30 }, (_, i) => String(i + 1)));

function _bsWords(b) { return String(b.meta || '').replace(/[(),]/g, ' ').split(/\s+/).filter(Boolean); }
function bsSize(b) { return (BS_SIZES.find(([, r]) => r.test(_bsWords(b)[0] || '')) || ['—'])[0]; }
function bsType(b) { return (BS_TYPES.find(([, r]) => r.test(_bsWords(b)[1] || '')) || ['Other'])[0]; }
function bsAlign(b) {
  const a = String(b.meta || '').split(',').slice(1).join(',').trim();
  return (BS_ALIGN.find(([, r]) => r.test(a)) || ['—'])[0];
}
function bsMoves(b) {
  const m = BS_MOVES.filter(([, r]) => r.test(String(b.speed || ''))).map(([n]) => n);
  return m.length ? m : ['Walk only'];
}
function bsCr(b) { return String(b.cr || '').trim().split(/[\s(]/)[0] || '—'; }
function bsCrValue(cr) {
  const c = String(cr);
  if (c.includes('/')) { const [a, d] = c.split('/'); return a / d; }
  const n = parseFloat(c);
  return Number.isNaN(n) ? -1 : n;
}

// What each filter reads off a monster. A monster can move several ways, so every value is a list.
const BS_FILTERS = [
  { k: 'size', label: 'Size', of: b => [bsSize(b)], order: BS_SIZES.map(s => s[0]).concat('—') },
  { k: 'type', label: 'Type', of: b => [bsType(b)] },
  { k: 'cr', label: 'Challenge', range: true },
  { k: 'source', label: 'Source', of: b => [b.source || 'No source'] },
  { k: 'align', label: 'Alignment', of: b => [bsAlign(b)], more: true, order: BS_ALIGN.map(a => a[0]).concat('—') },
  { k: 'move', label: 'Movement', of: b => bsMoves(b), more: true },
];

function bsNoFilter() { return { q: '', cr: [null, null], size: [], type: [], source: [], align: [], move: [] }; }
function bsFiltered(f) { return !!(f.q.trim() || f.cr[0] !== null || f.cr[1] !== null || BS_FILTERS.some(F => !F.range && f[F.k].length)); }

// `skip` leaves one filter out, so its own list can count what picking each option would show.
function bsMatches(b, f, skip) {
  const q = f.q.trim().toLowerCase();
  if (q && !String(b.name).toLowerCase().includes(q)) return false;
  for (const F of BS_FILTERS) {
    if (F.k === skip) continue;
    if (F.range) {
      const c = bsCrValue(bsCr(b));
      if (f.cr[0] !== null && c < bsCrValue(f.cr[0])) return false;
      if (f.cr[1] !== null && c > bsCrValue(f.cr[1])) return false;
    } else if (f[F.k].length && !F.of(b).some(v => f[F.k].includes(v))) return false;
  }
  return true;
}

// The options a filter offers, each with how many monsters it would show, in the filter's order.
function bsOptions(blocks, f, k) {
  const F = BS_FILTERS.find(x => x.k === k), counts = new Map();
  for (const b of blocks) if (bsMatches(b, f, k)) for (const v of F.of(b)) counts.set(v, (counts.get(v) || 0) + 1);
  for (const v of f[k]) if (!counts.has(v)) counts.set(v, 0);
  const rank = v => (F.order ? F.order.indexOf(v) : -1);
  return [...counts.entries()].sort((a, b) => (F.order ? rank(a[0]) - rank(b[0]) : a[0].localeCompare(b[0])))
    .map(([value, count]) => ({ value, count }));
}

const _bsNum = s => parseInt((String(s || '').match(/\d+/) || ['0'])[0], 10);
const BS_SORT = {
  name: b => String(b.name).toLowerCase(), cr: b => bsCrValue(bsCr(b)), size: b => BS_SIZES.findIndex(s => s[0] === bsSize(b)),
  type: bsType, ac: b => _bsNum(b.ac), hp: b => _bsNum(b.hp), source: b => b.source || '',
};
// Ties fall back to the name, so an equal CR still reads alphabetically.
function bsSorted(blocks, key, dir) {
  const val = BS_SORT[key] || BS_SORT.name;
  return blocks.slice().sort((a, b) => {
    const x = val(a), y = val(b);
    return ((x > y) - (x < y)) * dir || String(a.name).localeCompare(String(b.name));
  });
}

// A save the block lists wins; an ability it does not list saves at its modifier.
const BS_SAVE_ABBR = [/^(str|сил)/i, /^(dex|лов)/i, /^(con|тел)/i, /^(int|инт)/i, /^(wis|мдр)/i, /^(cha|хар)/i];
function bsSave(b, i) {
  const hit = String(b.saves || '').split(/[,;]/).map(s => s.trim()).find(s => BS_SAVE_ABBR[i].test(s));
  if (hit) return { value: ((hit.match(/[+\-−]\s*\d+/) || [''])[0]).replace(/\s/g, '').replace('−', '-'), listed: true };
  const n = parseInt((b.abil || [])[i], 10);
  const m = Math.floor((n - 10) / 2);
  return { value: Number.isNaN(m) ? '' : (m >= 0 ? '+' : '') + m, listed: false };
}

// An export is a file of copies; importing one adds them, never replaces.
function bsExportFile(blocks) {
  return JSON.stringify({ evermist: 'bestiary', version: 1, monsters: blocks.map(b => { const c = Object.assign({}, b); delete c.id; return c; }) }, null, 1);
}
function bsReadFile(text) {
  let d;
  try { d = JSON.parse(text); } catch (_) { return null; }
  if (!d || d.evermist !== 'bestiary' || !Array.isArray(d.monsters)) return null;
  return d.monsters.filter(m => m && typeof m.name === 'string');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BS_FILTERS, BS_CRS, bsSize, bsType, bsAlign, bsMoves, bsCr, bsCrValue, bsNoFilter, bsFiltered, bsMatches,
    bsOptions, bsSorted, bsSave, bsExportFile, bsReadFile };
}
