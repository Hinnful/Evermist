// statBlockImport.js — read stat blocks into new bestiary entries: pasted links through a queue, and
// every block in a book or module at once. An import never replaces an entry.

// A book or module's blocks, under the file's name. One that does not read clean is left out, and
// kept on the result for an Import anyway; a save that does not fit takes back all of it.
function cbImportBookText(text, fileName) {
  const found = statBlocksInText(text);
  const source = combatSourceName(fileName);
  const clean = found.filter(b => !statBlockUnclean(b));
  const leftOut = found.filter(b => statBlockUnclean(b) && b.name);
  const res = Object.assign(cbAddBlocks(clean, source), { found: found.length, leftOut, unread: leftOut.map(b => b.name) });
  res.skipped = clean.length - res.added.length;
  return res;
}

function cbAddBlocks(blocks, source) {
  const fresh = combatNewBlocks(blocks, cbState.blocks, source);
  const added = fresh.map(b => combatAddEntry(cbState.blocks, Object.assign(b, { source })));
  if (added.length && !cbSave(true)) {
    added.forEach(e => delete cbState.blocks[e.id]);
    return { added: [], failed: true, source };
  }
  if (added.length) bestiaryMarkNew(added.map(e => e.id));
  return { added, failed: false, source };
}

let cbBookReading = null;

// The book's path goes to the extraction process, so 300MB never crosses into this window.
async function cbImportBook(file, onChange) {
  const api = window.electronAPI || {};
  const path = api.getPathForFile && api.getPathForFile(file);
  if (!path || !api.extractPdfTextPath) {
    messageDialog({ title: 'That book could not be read', message: 'Evermist reads PDF books only in the desktop app. Nothing was added.' });
    return;
  }
  cbBookReading = file.name;
  onChange();
  let res;
  try { res = await api.extractPdfTextPath(path); } catch (err) { res = { ok: false, error: String((err && err.message) || err) }; }
  cbBookReading = null;
  const done = res.ok ? cbImportBookText(res.blockText || res.text, file.name) : null;
  onChange();
  if (!res.ok) messageDialog({ title: 'That book could not be read', message: `${res.error} Nothing was added.` });
  else if (!done.found) messageDialog({ title: 'No stat blocks in that book', message: `Evermist found no stat blocks in ${file.name}, so nothing was added. A scanned book with no text in it cannot be read.` });
  else cbReportImport(done);
}

function cbImportProblems(res) {
  if (res.failed) return `The ${res.found} monsters found do not fit in Evermist's storage, so none were added. Delete monsters you no longer need, then import again.`;
  if (!res.unread.length) return '';
  return `These monsters could not be read cleanly, so they were left out. Import them anyway to fix them by hand, or add them later from a link:\n\n${res.unread.join(', ')}`;
}

// The one message after a book or module import; silent when everything went in.
function cbReportImport(res) {
  const problems = cbImportProblems(res);
  if (!problems) return;
  if (res.failed) { messageDialog({ title: 'The monsters did not fit', message: problems }); return; }
  confirmDialog({
    title: 'Some monsters were left out', message: problems,
    confirmLabel: 'Import anyway', cancelLabel: 'Leave out',
    onConfirm: () => {
      const more = cbAddBlocks(res.leftOut, res.source);
      if (more.failed) messageDialog({ title: 'The monsters did not fit', message: 'Evermist\'s storage is full, so they were not added. Delete monsters you no longer need, then import again.' });
    },
  });
}

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
