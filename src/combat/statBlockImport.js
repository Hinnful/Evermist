// statBlockImport.js — pasted monster links into new bestiary entries, read one at a time from a
// queue the bestiary shows. statBlockParse.js does the reading; this file downloads and files.
// An import never replaces an entry.

// { id, url, host, state: 'waiting' | 'reading' | 'failed', why }. A link leaves it once it is an entry.
const cbImportQueue = [];
let _cbImportNext = 1, _cbImportBusy = false;

async function _cbReadLink(link) {
  let url = null;
  try { url = new URL(link); } catch (_) {}
  if (!url || !/^https?:$/.test(url.protocol)) return { why: 'That is not a web link.' };
  const res = await window.electronAPI.fetchStatPage(url.href);
  if (!res.ok) return { why: res.error };
  let parsed = null;
  try { parsed = statBlockFromPage(res.text); } catch (err) { console.error('Reading the stat block failed:', err); }
  if (!parsed) return { why: 'No stat block on that page, so nothing was added.' };
  const id = combatAddEntry(cbState.blocks, Object.assign(parsed, { source: url.hostname.replace(/^www\./, '') })).id;
  cbSave();
  return { id };
}

// `onChange(id)` hears every step; `id` is set when a link has just become an entry.
async function _cbImportPump(onChange) {
  if (_cbImportBusy) return;
  _cbImportBusy = true;
  let item;
  while ((item = cbImportQueue.find(q => q.state === 'waiting'))) {
    item.state = 'reading';
    onChange(null);
    const res = await _cbReadLink(item.url);
    // A link removed while it was being read is not wanted any more, even if it worked.
    if (!cbImportQueue.includes(item)) { if (res.id) { delete cbState.blocks[res.id]; cbSave(); } continue; }
    if (res.id) { cbImportQueue.splice(cbImportQueue.indexOf(item), 1); onChange(res.id); }
    else { item.state = 'failed'; item.why = res.why; onChange(null); }
  }
  _cbImportBusy = false;
}

function cbImportLinks(links, onChange) {
  for (const url of links) {
    let host = url;
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (_) {}
    cbImportQueue.push({ id: _cbImportNext++, url, host, state: 'waiting', why: '' });
  }
  onChange(null);
  _cbImportPump(onChange);
}

function cbImportRetry(id, onChange) {
  const item = cbImportQueue.find(q => q.id === id);
  if (item) item.state = 'waiting';
  _cbImportPump(onChange);
}

function cbImportDrop(id) {
  const at = cbImportQueue.findIndex(q => q.id === id);
  if (at >= 0) cbImportQueue.splice(at, 1);
}
