'use strict';
// mcpMusicPlan.js — pure rules behind Claude's music tools: which tracks and groups a name points at, how many
// tracks one YouTube call may bring, and the words a delete asks with. No DOM. Tested.

const MCP_MUSIC_MAX = 20;

// What the DM sees of a track: its file name without the extension and the video id.
const _mmShown = (t) => String(t.display || t.name || '').trim().toLocaleLowerCase();

// Tracks by name: the exact shown name or file name first, else every track whose name holds the text.
function mcpMusicFind(tracks, name) {
  const q = String(name || '').trim().toLocaleLowerCase();
  if (!q) return [];
  const exact = (tracks || []).filter(t => _mmShown(t) === q || String(t.name).toLocaleLowerCase() === q);
  return exact.length ? exact : (tracks || []).filter(t => _mmShown(t).includes(q));
}

// One track, or why not: { track } | { error }.
function mcpMusicOne(tracks, name) {
  const hits = mcpMusicFind(tracks, name);
  if (hits.length === 1) return { track: hits[0] };
  if (!hits.length) return { error: 'No track is called "' + (name || '') + '". list_music shows the library.' };
  return { error: 'More than one track matches "' + name + '": ' + hits.slice(0, 8).map(t => '"' + t.display + '"').join(', ') + '. Use more of the name.' };
}

// The group a name points at, ignoring case, or null.
function mcpMusicGroupName(groups, name) {
  const q = String(name || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  return (groups || []).find(g => g.toLocaleLowerCase() === q) || null;
}

// The playlist entries to download: `pick` narrows them by title (case ignored; the exact title, else a part of it),
// then more than MCP_MUSIC_MAX is refused. { entries } | { error }.
function mcpMusicPick(entries, pick) {
  let list = entries || [];
  if (Array.isArray(pick) && pick.length) {
    const out = [], missing = [];
    for (const p of pick) {
      const q = String(p || '').trim().toLocaleLowerCase();
      const hit = list.find(e => String(e.title).toLocaleLowerCase() === q) || list.find(e => q && String(e.title).toLocaleLowerCase().includes(q));
      if (!hit) missing.push('"' + p + '"'); else if (!out.includes(hit)) out.push(hit);
    }
    if (missing.length) return { error: 'No entry of the playlist is titled ' + missing.join(', ') + '. Nothing was downloaded.' };
    list = out;
  }
  if (list.length > MCP_MUSIC_MAX) return { error: 'That is ' + list.length + ' tracks and one call brings at most ' + MCP_MUSIC_MAX + '. Pick fewer: pass pick with the titles you want, or ask the DM which ones.' };
  if (!list.length) return { error: 'Nothing to download at that link.' };
  return { entries: list };
}

function mcpMusicWouldDelete(name) {
  return 'Would delete the track "' + name + '" from the music library. Nothing was deleted. Tell the DM what goes and, on their yes, call again with confirmed: true.';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MCP_MUSIC_MAX, mcpMusicFind, mcpMusicOne, mcpMusicGroupName, mcpMusicPick, mcpMusicWouldDelete };
}
