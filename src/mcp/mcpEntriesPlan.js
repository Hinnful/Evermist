'use strict';
// mcpEntriesPlan.js — pure rules for Claude's faction and lore tools and for mentions in the notes it writes: an
// entry found by name or nesting path, the refusal to make a second one, the delete question, and the "@{Name}"
// form Claude writes and reads, resolved to the stored mention form (src/notes/mentionPlan.js). No DOM. Tested.

const _mpeDeps = (typeof module !== 'undefined' && module.exports)
  ? { ...require('../notes/notesEntriesPlan.js'), ...require('../notes/mentionPlan.js') }
  : { neChildren, mpToken, mpParse };

const MPE_SEP = ' › ';
const MPE_WORDS = ['faction', 'lore', 'monster', 'group', 'map', 'room', 'road', 'campaign'];
const MPE_NAME_MAX = 200;

const _mpeNorm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();

// "Parent › Child" for an entry, from the section down.
function mpePath(entries, e) {
  const names = [e.name];
  for (let p = entries.find(x => x.id === e.parent), hops = 0; p && hops++ < entries.length; p = entries.find(x => x.id === p.parent)) names.unshift(p.name);
  return names.join(MPE_SEP);
}

// The entries of a kind as a nested list, in tree order.
function mpeTree(entries, kind) {
  const walk = parent => _mpeDeps.neChildren(entries, parent).map(e => ({ name: e.name, hasNote: !!String(e.note || '').trim(), children: walk(e.id) }));
  return walk(kind);
}

// One entry of `kind` by name or by "Parent › Child" path (the path's end is enough), or the reason there is not one.
function mpeFind(entries, kind, ref) {
  const parts = String(ref == null ? '' : ref).split(/\s*›\s*|\s+>\s+/).map(_mpeNorm).filter(Boolean);
  if (!parts.length) return { error: 'Name the ' + kind + ' entry.' };
  const hits = entries.filter(e => {
    if (e.kind !== kind || _mpeNorm(e.name) !== parts[parts.length - 1]) return false;
    let p = entries.find(x => x.id === e.parent);
    for (let i = parts.length - 2; i >= 0; i--, p = p && entries.find(x => x.id === p.parent)) if (!p || _mpeNorm(p.name) !== parts[i]) return false;
    return true;
  });
  if (hits.length === 1) return { entry: hits[0] };
  if (!hits.length) return { error: 'No ' + kind + ' entry is called "' + ref + '". list_entries shows them.' };
  return { error: 'More than one ' + kind + ' entry is called "' + ref + '". Give its path: ' + hits.map(e => '"' + mpePath(entries, e) + '"').join(', ') + '.' };
}

// A refusal when the kind already holds that name, so Claude links to it instead of making a second one; else null.
function mpeCreateRefusal(entries, kind, name) {
  const q = _mpeNorm(name);
  const hit = entries.find(e => e.kind === kind && _mpeNorm(e.name) === q);
  if (!hit) return null;
  return 'Not created: ' + (kind === 'faction' ? 'a faction' : 'a lore entry') + ' called "' + hit.name + '" already exists' + (hit.parent !== kind ? ' (at "' + mpePath(entries, hit) + '")' : '')
    + '. Link to it with @{' + hit.name + '} instead of making a second one.';
}

function mpeMonsterRefusal(blocks, name) {
  const q = _mpeNorm(name);
  const hit = Object.values(blocks || {}).find(b => _mpeNorm(b.name) === q);
  if (!hit) return null;
  return 'Not created: the Bestiary already holds a monster called "' + hit.name + '"' + (hit.source ? ' (source "' + hit.source + '")' : '')
    + '. Link to it with @{' + hit.name + '} instead of making a second one.';
}

// What deleting an entry would take: it, everything under it (`below` are paths), and the notes that mention it
// (`mentions` are { name, word }).
function mpeWouldDelete(word, path, below, mentions) {
  const lines = ['Would delete the ' + word + ' entry "' + path + '" with its note.'];
  if (below.length) lines.push(below.length + ' ' + (below.length === 1 ? 'entry' : 'entries') + ' inside it would go too: ' + below.map(p => '"' + p + '"').join(', ') + '.');
  lines.push(mentions.length ? 'These notes mention it, and the mentions would turn red but keep their words: ' + mentions.map(m => m.word + ' "' + m.name + '"').join(', ') + '.' : 'No note mentions it.');
  return lines.join(' ') + ' Nothing was deleted. Tell the DM what goes and, on their yes, call again with confirmed: true.';
}

// ─── @{Name} ─────────────────────────────────────────────────────────────────

const _mpeEscape = s => String(s).replace(/\\/g, '\\\\').replace(/}/g, '\\}');

// Segments in order: { text } and { name, raw } for each "@{...}". "\}" and "\\" stand for "}" and "\" inside it.
function mpeParse(text) {
  const s = String(text == null ? '' : text), out = [];
  let from = 0, i = s.indexOf('@{');
  while (i >= 0) {
    let name = '', j = i + 2, ok = false;
    for (; j < s.length && j - i <= MPE_NAME_MAX; j++) {
      const c = s[j];
      if (c === '\n' || c === '\r') break;
      if (c === '\\' && (s[j + 1] === '\\' || s[j + 1] === '}')) { name += s[j + 1]; j++; continue; }
      if (c === '}') { ok = true; break; }
      name += c;
    }
    if (ok && name.trim()) {
      if (i > from) out.push({ text: s.slice(from, i) });
      out.push({ name: name.trim(), raw: s.slice(i, j + 1) });
      from = j + 1;
      i = s.indexOf('@{', from);
    } else i = s.indexOf('@{', i + 2);
  }
  if (from < s.length) out.push({ text: s.slice(from) });
  return out;
}

// The words a call may put before a name to pick a kind: "faction: Name". Else the whole text is the name.
function _mpeSplit(name) {
  const m = /^(faction|lore|monster|group|map|room|road|campaign)\s*:\s*(\S.*)$/i.exec(name);
  return m ? { word: m[1].toLowerCase(), name: m[2].trim() } : { word: null, name };
}

// The entries a name points at: `word` (or a "kind:" prefix in the name) narrows to one kind, and a room also answers
// to "Map › Room".
function mpeMatch(cands, raw, word) {
  const sp = _mpeSplit(raw), w = word || sp.word, q = _mpeNorm(sp.name);
  return { name: sp.name, hits: cands.filter(c => (!w || c.word === w) && (_mpeNorm(c.name) === q || (c.where && _mpeNorm(c.where + MPE_SEP + c.name) === q))) };
}

// Claude's text with every "@{Name}" turned into the stored mention. `cands` are { kind, word, name, where } of every
// entry a note can mention; `mint(c)` answers the id the stored form carries (null when none can be made yet).
// A name that matches none or more than one stays plain words, and is listed with the reason.
function mpeResolve(text, cands, mint) {
  const unresolved = [];
  let linked = 0;
  const out = mpeParse(text).map(p => {
    if (p.text !== undefined) return p.text;
    const { name, hits } = mpeMatch(cands, p.name);
    if (hits.length !== 1) {
      unresolved.push(hits.length ? { name, why: 'ambiguous', options: hits.map(c => c.word + ' "' + c.name + '"' + (c.where ? ' in "' + c.where + '"' : '')) } : { name, why: 'unknown' });
      return name;
    }
    const id = mint(hits[0]);
    if (!id) { unresolved.push({ name, why: 'unavailable' }); return name; }
    linked++;
    return _mpeDeps.mpToken(hits[0].name, hits[0].kind, id);
  }).join('');
  return { text: out, linked, unresolved };
}

// The sentence that tells Claude which names stayed plain, and how to fix each; '' when none.
function mpeUnresolvedSay(list) {
  if (!list.length) return '';
  const why = u => u.why === 'ambiguous' ? 'more than one match: ' + u.options.join(', ') + '; write @{faction: Name}, @{Map › Room} or similar to pick one'
    : u.why === 'unavailable' ? 'its map is open in a column, so close the column and try again' : 'nothing has that name';
  return ' Left as plain words, not linked: ' + list.map(u => '"' + u.name + '" (' + why(u) + ')').join('; ') + '.';
}

// A note's stored text as Claude reads it: each mention as "@{Name}". `describe(kind, id)` answers the name to show
// ("Map › Room" for a room) or null when the entry is gone. A gone entry's mention reads as its stored form, which a
// write passes through untouched, so a read-then-set keeps the DM's red label.
function mpeReadBack(text, describe) {
  if (typeof text !== 'string' || text.indexOf('@[') < 0) return typeof text === 'string' ? text : '';
  return _mpeDeps.mpParse(text).map(p => {
    if (p.text !== undefined) return p.text;
    const d = describe(p.kind, p.id);
    return d == null ? p.raw : '@{' + _mpeEscape(d) + '}';
  }).join('');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MPE_SEP, MPE_WORDS, mpePath, mpeTree, mpeFind, mpeCreateRefusal, mpeMonsterRefusal, mpeWouldDelete, mpeParse, mpeMatch, mpeResolve, mpeUnresolvedSay, mpeReadBack };
}
