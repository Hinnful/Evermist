'use strict';
// mcpPlan.js — pure rules behind what Claude writes through the MCP connection: a note appended, an
// empty spot for a new place, a fight built from the bestiary, Claude's history of changes and the guard
// that keeps it off the TV. No DOM. Tested.

const MP = (typeof module !== 'undefined' && module.exports) ? require('../combat/combatPlan.js')
  : { combatRowFromEntry, combatSearchBlocks, combatBaseName, combatDuplicateRow };

const MCP_PLACE_W = 360, MCP_PLACE_H = 260, MCP_GAP = 60;
const MCP_MAX_COUNT = 20;
const MCP_HISTORY_MAX = 30;
const MCP_PLACE_MIN_W = 150, MCP_PLACE_MIN_H = 110;

// Claude's text goes below the DM's, after a blank line, and never replaces it. Over `cap` it is refused whole.
function mcpAppend(existing, add, cap) {
  const cur = typeof existing === 'string' ? existing.trim() : '';
  const more = typeof add === 'string' ? add.trim() : '';
  if (!more) return { text: cur, empty: true };
  const text = cur ? cur + '\n\n' + more : more;
  return text.length > cap ? { text: cur, tooLong: true } : { text };
}

// A note replaced whole. Over `cap` it is refused; empty text clears the notes.
function mcpReplace(text, cap) {
  const next = typeof text === 'string' ? text.trim() : '';
  return next.length > cap ? { tooLong: true } : { text: next };
}

// Claude's history: a step is { label, undo }. The newest `max` stay, the oldest fall off.
function mcpHistoryPush(list, step, max) {
  list.push(step);
  while (list.length > (max || MCP_HISTORY_MAX)) list.shift();
  return list;
}

// Whether the TV shows a scene now: a Player window is open, nothing holds it clear, and the scene is the
// open one (one map) or in a column (two maps).
function mcpOnTv(s) {
  return !!(s.playerOpen && !s.held && (s.panes ? s.inColumn : s.isOpen));
}

// A colour as '#rrggbb' in lower case from '#abc', 'abc' or '#aabbcc', else null.
function mcpCleanHex(raw) {
  const s = String(raw || '').trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) return '#' + s.split('').map(c => c + c).join('');
  return /^[0-9a-f]{6}$/.test(s) ? '#' + s : null;
}

// A grid cell size in map pixels, rounded and held to the grid control's range (10 to 400), else null.
function mcpGridSize(raw) {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 10 && n <= 400 ? n : null;
}

// A place's rectangle from { x, y, w, h } in world-map units, rounded, or null when a number is missing or the
// rectangle is too small to hold a scene's card.
function mcpRectArg(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const r = { x: Math.round(Number(raw.x)), y: Math.round(Number(raw.y)), w: Math.round(Number(raw.w)), h: Math.round(Number(raw.h)) };
  if (!Object.values(r).every(Number.isFinite)) return null;
  return r.w >= MCP_PLACE_MIN_W && r.h >= MCP_PLACE_MIN_H ? r : null;
}

const _mpHit = (a, b) => a.x < b.x + b.w + MCP_GAP && b.x < a.x + a.w + MCP_GAP && a.y < b.y + b.h + MCP_GAP && b.y < a.y + a.h + MCP_GAP;

// The free rectangle nearest the middle of everything on the map, clear of every rect in `taken` by a gap.
function mcpFreeRect(taken, w, h) {
  const W = w || MCP_PLACE_W, H = h || MCP_PLACE_H;
  if (!taken.length) return { x: -W / 2, y: -H / 2, w: W, h: H };
  const x0 = Math.min(...taken.map(r => r.x)), x1 = Math.max(...taken.map(r => r.x + r.w));
  const y0 = Math.min(...taken.map(r => r.y)), y1 = Math.max(...taken.map(r => r.y + r.h));
  const cx = (x0 + x1) / 2 - W / 2, cy = (y0 + y1) / 2 - H / 2, sx = W / 2, sy = H / 2;
  let best = null;
  for (let row = -30; row <= 30; row++) {
    for (let col = -30; col <= 30; col++) {
      const r = { x: Math.round(cx + col * sx), y: Math.round(cy + row * sy), w: W, h: H };
      const cost = Math.hypot(col * sx, row * sy);
      if ((!best || cost < best.cost) && !taken.some(t => _mpHit(r, t))) best = { cost, r };
    }
  }
  return best ? best.r : { x: Math.round(x1 + MCP_GAP), y: Math.round(cy), w: W, h: H };
}

// A bestiary entry by name: the exact name in any case, else the one name that starts with it. Null otherwise.
function mcpMatchMonster(blocks, name) {
  const q = String(name || '').trim().toLowerCase();
  if (!q) return null;
  const all = Object.values(blocks || {});
  const exact = all.filter(b => String(b.name || '').toLowerCase() === q);
  if (exact.length) return exact[0];
  const starts = all.filter(b => String(b.name || '').toLowerCase().startsWith(q));
  return new Set(starts.map(b => b.name)).size === 1 ? starts[0] : null;
}

// Up to three bestiary names close to one that matched nothing, so Claude can ask again.
function mcpSuggest(blocks, name) {
  const words = String(name || '').trim().toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const hits = new Set();
  for (const w of words) for (const b of MP.combatSearchBlocks(blocks || {}, w)) {
    if (String(b.name).toLowerCase().includes(w)) hits.add(b.name);
  }
  return [...hits].slice(0, 3);
}

// A fight's rows from [{ name, count, side }], each row as the fight table builds one from a pick. Ids start at `nextId`.
function mcpFightRows(blocks, monsters, nextId, existing) {
  const rows = [], missing = [], have = existing || [];
  let id = nextId;
  for (const m of Array.isArray(monsters) ? monsters : []) {
    const entry = mcpMatchMonster(blocks, m && m.name);
    if (!entry) { missing.push({ name: String((m && m.name) || ''), suggest: mcpSuggest(blocks, m && m.name) }); continue; }
    const n = Math.max(1, Math.min(MCP_MAX_COUNT, Math.floor(Number(m.count) || 1)));
    const side = m.side === 'ally' ? 'ally' : 'enemy';
    for (let i = 0; i < n; i++) rows.push(Object.assign({ id: id++, init: '', side }, MP.combatRowFromEntry(entry, have.concat(rows))));
  }
  return { rows, missing, nextId: id };
}

// A fight's rows after the edits in `ops`, in this order: remove [{ name, count }] (the last copies; all when no
// count), counts [{ name, count }] (a monster's copies made to that many), sides [{ name, side }], then add
// [{ name, count, side }] from the bestiary. A monster is named without its number: "Goblin" for "Goblin 2".
// Returns { rows, nextId, changed, missing, notes }; `rows` passed in are not touched.
function mcpEditRows(blocks, rows, ops, nextId) {
  let list = (rows || []).map(r => Object.assign({}, r));
  const out = { missing: [], notes: [], changed: false };
  let id = nextId;
  const key = s => String(s || '').trim().toLowerCase();
  const copies = name => list.filter(r => key(MP.combatBaseName(r.name)) === key(name));
  const drop = (name, n) => {
    const gone = new Set(copies(name).slice(-n));
    list = list.filter(r => !gone.has(r));
    return gone.size;
  };
  const o = ops || {};
  for (const x of Array.isArray(o.remove) ? o.remove : []) {
    const have = copies(x && x.name).length;
    if (!have) { out.notes.push('"' + ((x && x.name) || '') + '" is not in the fight.'); continue; }
    out.changed = drop(x.name, x.count ? Math.max(1, Math.floor(Number(x.count)) || 1) : have) > 0 || out.changed;
  }
  for (const x of Array.isArray(o.counts) ? o.counts : []) {
    const have = copies(x && x.name);
    const want = Math.max(0, Math.min(MCP_MAX_COUNT, Math.floor(Number(x && x.count))));
    if (!have.length || !Number.isFinite(want)) { out.notes.push('"' + ((x && x.name) || '') + '" is not in the fight, so its count was not set. Use add.'); continue; }
    if (want < have.length) { drop(x.name, have.length - want); out.changed = true; continue; }
    for (let i = have.length; i < want; i++) {
      const last = copies(x.name).pop();
      list.splice(list.indexOf(last) + 1, 0, MP.combatDuplicateRow(last, list, id++));
      out.changed = true;
    }
  }
  for (const x of Array.isArray(o.sides) ? o.sides : []) {
    const side = x && x.side === 'ally' ? 'ally' : 'enemy';
    const hit = copies(x && x.name).filter(r => (r.side || 'enemy') !== side);
    hit.forEach(r => { r.side = side; });
    if (!copies(x && x.name).length) out.notes.push('"' + ((x && x.name) || '') + '" is not in the fight.');
    out.changed = hit.length > 0 || out.changed;
  }
  const built = mcpFightRows(blocks, o.add, id, list);
  list.push(...built.rows);
  id = built.nextId;
  out.missing = built.missing;
  out.changed = out.changed || built.rows.length > 0;
  return Object.assign(out, { rows: list, nextId: id });
}

// Why the fight open at the table refuses an edit, or null when it only adds: monsters from the bestiary and
// a higher count. Rename, remove, a lower count and a side change alter what the DM is running.
function mcpOpenFightRefusal(args, rows) {
  const a = args || {};
  const list = arr => (Array.isArray(arr) ? arr : []);
  if (a.newName !== undefined) return 'renaming it';
  if (list(a.remove).length) return 'removing monsters';
  if (list(a.sides).length) return 'changing a side';
  const key = s => String(s || '').trim().toLowerCase();
  for (const x of list(a.counts)) {
    const have = (rows || []).filter(r => key(MP.combatBaseName(r.name)) === key(x && x.name)).length;
    if (Math.floor(Number(x && x.count)) < have) return 'lowering a count';
  }
  return null;
}

// What a delete would take, in the DM's words. `d` carries { name, rooms, notes, maps, rows } for the kind.
function mcpWouldDelete(kind, d) {
  const q = '"' + d.name + '"', n = (c, w) => c + ' ' + w + (c === 1 ? '' : 's');
  const what = kind === 'scene' ? 'Would delete the map ' + q + ' with its image, fog and ' + n(d.rooms || 0, 'room') + '.'
    : kind === 'place' ? 'Would delete the group ' + q + (d.notes ? ' and its notes (' + n(d.notes, 'character') + ')' : ' (it has no notes)') + '. ' + (d.maps ? n(d.maps, 'map') + ' in it would stay, in no group.' : 'It holds no maps.')
    : kind === 'fight' ? 'Would delete the fight ' + q + ' with its ' + n(d.rows || 0, 'row') + '.'
    : 'Would delete the picture ' + q + '.';
  return what + ' Nothing was deleted. Tell the DM what goes and, on their yes, call again with confirmed: true.';
}

// The scenes a name points at, narrowed by place when one is given. Case is ignored.
function mcpFindScenes(scenes, name, place) {
  const q = String(name || '').trim().toLowerCase(), p = String(place || '').trim().toLowerCase();
  return (scenes || []).filter(s => String(s.name || '').trim().toLowerCase() === q
    && (!p || String(s.group || '').trim().toLowerCase() === p));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MCP_PLACE_W, MCP_PLACE_H, MCP_GAP, MCP_HISTORY_MAX, MCP_PLACE_MIN_W, MCP_PLACE_MIN_H, mcpRectArg, mcpCleanHex, mcpGridSize, mcpAppend, mcpReplace, mcpHistoryPush, mcpOnTv, mcpFreeRect, mcpMatchMonster, mcpSuggest,
    mcpFightRows, mcpEditRows, mcpFindScenes, mcpOpenFightRefusal, mcpWouldDelete };
}
