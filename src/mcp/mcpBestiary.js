'use strict';
// mcpBestiary.js — Claude's bestiary tools: read a stat block, add a monster from pasted text, and import
// monsters from web pages or a PDF book. Text goes through the same parser and clean-read check an import
// uses, so a block that does not read cleanly is refused. An import never replaces an entry.

const MCP_MAX_LINKS = 10;
const _mcpMonsterSource = args => String(args.source || '').trim() || 'Claude';

// Takes entries back out of the bestiary: what undo_last_change does to an import.
function _mcpDropEntries(ids) {
  for (const id of ids) delete cbState.blocks[id];
  cbSave();
  bestiaryRender();
}

function _mcpReadStatBlock(args) {
  const q = String(args.name || '').trim().toLowerCase();
  const hits = Object.values(cbState.blocks).filter(b => String(b.name || '').toLowerCase() === q
    && (!args.source || String(b.source || '').toLowerCase() === String(args.source).toLowerCase()));
  if (!hits.length) return _mcpNo('No monster is called "' + (args.name || '') + '" in the bestiary. list_bestiary searches it.');
  if (hits.length > 1) return _mcpNo('More than one monster is called "' + args.name + '". Give its source: ' + hits.map(b => b.source || '(none)').join(', ') + '.');
  return _mcpOk(combatSnapshot(hits[0]));
}

function _mcpAddMonster(args) {
  const parsed = statBlockFromLines(String(args.text || '').split(/\r?\n/));
  if (!parsed) return _mcpNo('No stat block found in that text. Paste one monster\'s stat block, name first.');
  const unclean = statBlockUnclean(parsed);
  if (unclean) return _mcpNo('The stat block could not be read cleanly (' + unclean + '), so nothing was added. Check the text and send it again.');
  const source = _mcpMonsterSource(args);
  const res = cbAddBlocks([parsed], source);
  if (res.failed) return _mcpNo('Nothing was added: Evermist\'s storage is full.');
  if (!res.added.length) return _mcpNo('"' + parsed.name + '" is already in the bestiary under the source "' + source + '". Use another source to add it as a separate entry.');
  const ids = res.added.map(e => e.id);
  return mcpDone('added the monster "' + parsed.name + '" to the bestiary', async () => _mcpDropEntries(ids), 'Added "' + parsed.name + '" (CR ' + parsed.cr + ') to the bestiary, source "' + source + '".');
}

// Each link is a monster's own page, read by the same fetch and parser as the bestiary's link box.
async function _mcpImportLinks(urls) {
  const ids = [], failed = [];
  for (const url of urls.slice(0, MCP_MAX_LINKS)) {
    const r = await _cbReadLink(String(url));
    if (r.id) ids.push(r.id); else failed.push(url + ': ' + r.why);
  }
  if (ids.length) bestiaryMarkNew(ids);
  return { ids, said: ids.length + ' monster(s) from ' + urls.slice(0, MCP_MAX_LINKS).length + ' link(s).', failed };
}

async function _mcpImportBook(path) {
  const res = await window.electronAPI.extractPdfTextPath(path);
  if (!res.ok) return { ids: [], said: '', failed: ['The book could not be read: ' + res.error] };
  const name = path.split(/[\\/]/).pop();
  const done = cbImportBookText(res.blockText || res.text, name);
  if (done.failed) return { ids: [], said: '', failed: ['The ' + done.found + ' monsters found do not fit in Evermist\'s storage, so none were added.'] };
  const failed = [];
  if (!done.found) failed.push('No stat blocks in "' + name + '". A scanned book with no text cannot be read.');
  if (done.unread.length) failed.push('Left out, not read cleanly: ' + done.unread.join(', ') + '.');
  return { ids: done.added.map(e => e.id), said: done.added.length + ' new monster(s) from "' + name + '"' + (done.skipped ? ' (' + done.skipped + ' already there)' : '') + '.', failed };
}

async function _mcpImportMonsters(args) {
  const urls = [].concat(args.urls || []).filter(Boolean);
  if (!urls.length === !args.path) return _mcpNo('Give either urls (monster pages) or path (a PDF book), not both and not neither.');
  const r = args.path ? await _mcpImportBook(String(args.path)) : await _mcpImportLinks(urls);
  const notes = r.failed.length ? ' ' + r.failed.join(' ') : '';
  if (!r.ids.length) return _mcpNo('Nothing was added.' + notes);
  return mcpDone('imported ' + r.ids.length + ' monster(s) into the bestiary', async () => _mcpDropEntries(r.ids), 'Added ' + r.said + notes);
}

const MCP_BESTIARY_TOOLS = { read_stat_block: _mcpReadStatBlock, add_monster: _mcpAddMonster, import_monsters: _mcpImportMonsters };
