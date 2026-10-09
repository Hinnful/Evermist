'use strict';
// mcpPlan.js — pure rules behind what Claude writes through the MCP connection: a note appended, an
// empty spot for a new place, and a fight built from the bestiary. No DOM. Tested.

const MP = (typeof module !== 'undefined' && module.exports) ? require('../combat/combatPlan.js')
  : { combatRowFromEntry, combatSearchBlocks };

const MCP_PLACE_W = 360, MCP_PLACE_H = 260, MCP_GAP = 60;
const MCP_MAX_COUNT = 20;

// Claude's text goes below the DM's, after a blank line, and never replaces it. Over `cap` it is refused whole.
function mcpAppend(existing, add, cap) {
  const cur = typeof existing === 'string' ? existing.trim() : '';
  const more = typeof add === 'string' ? add.trim() : '';
  if (!more) return { text: cur, empty: true };
  const text = cur ? cur + '\n\n' + more : more;
  return text.length > cap ? { text: cur, tooLong: true } : { text };
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
function mcpFightRows(blocks, monsters, nextId) {
  const rows = [], missing = [];
  let id = nextId;
  for (const m of Array.isArray(monsters) ? monsters : []) {
    const entry = mcpMatchMonster(blocks, m && m.name);
    if (!entry) { missing.push({ name: String((m && m.name) || ''), suggest: mcpSuggest(blocks, m && m.name) }); continue; }
    const n = Math.max(1, Math.min(MCP_MAX_COUNT, Math.floor(Number(m.count) || 1)));
    const side = m.side === 'ally' ? 'ally' : 'enemy';
    for (let i = 0; i < n; i++) rows.push(Object.assign({ id: id++, init: '', side }, MP.combatRowFromEntry(entry, rows)));
  }
  return { rows, missing, nextId: id };
}

// The scenes a name points at, narrowed by place when one is given. Case is ignored.
function mcpFindScenes(scenes, name, place) {
  const q = String(name || '').trim().toLowerCase(), p = String(place || '').trim().toLowerCase();
  return (scenes || []).filter(s => String(s.name || '').trim().toLowerCase() === q
    && (!p || String(s.group || '').trim().toLowerCase() === p));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MCP_PLACE_W, MCP_PLACE_H, MCP_GAP, mcpAppend, mcpFreeRect, mcpMatchMonster, mcpSuggest,
    mcpFightRows, mcpFindScenes };
}
