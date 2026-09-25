// moduleTextPanel.js — the module text a DM can see and touch. The parsing, the storage and the
// backup bridge are moduleText.js.

// Which controls it may hold, and what makes importing on choose safe: the module-text skill.
//
// No drag-and-drop: the drop handler belongs to map loading, and a second meaning for the same
// gesture would make dropping a file ambiguous.

function _mtEl(id) { return document.getElementById(id); }

// `status` overrides the "what is loaded" line, so an error shows without hiding the module.
function _mtRenderModal(status, isError) {
  const n = mtEntries.length;

  const st = _mtEl('mt-status');
  if (st) {
    st.textContent = status != null ? status : (n
      ? n + ' location' + (n === 1 ? '' : 's') + (mtSourceName ? ' from ' + mtSourceName : '')
      : 'No module text loaded.');
    st.classList.toggle('mt-err', !!isError);
  }

  const list = _mtEl('mt-list');
  if (list) {
    list.innerHTML = '';
    list.style.display = n ? '' : 'none';
    mtEntries.forEach(e => {
      const row = document.createElement('div');
      row.className = 'mt-row';
      const num = document.createElement('span');
      num.className = 'mt-num';
      num.textContent = e.num + '.';
      const nm = document.createElement('span');
      nm.className = 'mt-name';
      nm.textContent = e.name;
      const ch = document.createElement('span');
      ch.className = 'mt-chars' + (e.body ? '' : ' mt-empty');
      ch.textContent = e.body ? e.body.length + ' chars' : 'empty';
      row.appendChild(num); row.appendChild(nm); row.appendChild(ch);
      list.appendChild(row);
    });
  }

  const lbl = _mtEl('mt-file-label');
  if (lbl) lbl.textContent = n ? 'Choose another file…' : 'Choose file…';
  const foot = _mtEl('mt-foot');
  if (foot) foot.style.display = n ? '' : 'none';
}

function openModuleTextModal() {
  _mtRenderModal();
  _mtEl('mt-backdrop').style.display = '';
  const modal = _mtEl('mt-modal');
  modal.style.display = '';
  // Focus the panel itself (tabindex="-1") so Escape has somewhere to land.
  modal.focus();
}

function closeModuleTextModal() {
  _mtEl('mt-backdrop').style.display = 'none';
  _mtEl('mt-modal').style.display = 'none';
}

// Bytes → text, UTF-8 first and Windows-1251 second. `fatal: true` turns silent mojibake into a
// signal, and UTF-8 goes first because UTF-8 bytes are also valid-looking CP1251 — the ORDER is
// the safeguard.
const MT_ENCODINGS = ['utf-8', 'windows-1251'];

function _mtDecode(buf) {
  if (!buf) return null;
  for (const enc of MT_ENCODINGS) {
    try { return new TextDecoder(enc, { fatal: true }).decode(buf); } catch (_) {}
  }
  // Last resort: a handful of bad bytes should not block an otherwise readable book.
  try { return new TextDecoder('utf-8').decode(buf); } catch (_) { return null; }
}

// Is this a PDF? RAW BYTES, before any decode, scanned in the first kilobyte for a preamble.
function _mtIsPdf(buf) {
  if (!buf || !buf.byteLength) return false;
  const head = new Uint8Array(buf, 0, Math.min(1024, buf.byteLength));
  for (let i = 0; i + 3 < head.length; i++) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46) return true;
  }
  return false;
}

// Name the container format if this is obviously not prose, else null — so the panel says "that's
// a .docx" rather than previewing compressed streams. PDFs are converted upstream; the branch
// stays as a backstop.
function _mtBinaryKind(text) {
  const head = String(text || '').slice(0, 8);
  if (head.startsWith('%PDF')) return 'a PDF';
  if (head.startsWith('PK') && head.charCodeAt(2) === 3) return 'a .docx or .zip';
  if (head.startsWith('{\\rtf')) return 'an RTF file';
  if (head.charCodeAt(0) === 0xD0 && head.charCodeAt(1) === 0xCF) return 'an old .doc file';
  // Catch-all: C0 control characters other than tab/newline/return, which prose never contains.
  // ⚠ Written as escapes — the literal characters make this file register as binary to grep.
  const sample = String(text || '').slice(0, 4000);
  if (!sample) return null;
  const CTRL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g');
  const ctrl = (sample.match(CTRL) || []).length;
  return ctrl / sample.length > 0.02 ? 'a binary file' : null;
}

// Parse and STORE in one step. ⚠ An empty parse writes nothing: that loss is unrecoverable.
// The module's stat blocks go to the bestiary too; `blockText` is a PDF's copy laid out for them.
function _mtImport(text, sourceName, blockText) {
  const res = parseModuleText(text);
  const n = res.entries.length;
  const mon = cbImportBookText(blockText || text, sourceName || 'Module text');
  const monLine = mon.added.length ? ` ${mon.added.length} monster${mon.added.length === 1 ? '' : 's'} added to the bestiary.` : '';
  cbReportImport(mon);
  if (!n) {
    if (monLine) { _mtRenderModal('No numbered locations in that file.' + monLine); return; }
    _mtRenderModal('No numbered locations in that file. Evermist splits the text at headings ' +
                   'like “K12. Chapel”, so try one chapter at a time.', true);
    return;
  }
  const st = mtStore(res.entries, sourceName || 'Module text');
  if (!st.ok) { _mtRenderModal(st.error, true); return; }
  _mtRenderModal(monLine ? `${n} location${n === 1 ? '' : 's'} from ${mtSourceName}.${monLine}` : null);
}

function _mtInitModal() {
  const backdrop = _mtEl('mt-backdrop');
  if (!backdrop) return;   // markup absent (player mode strips nothing, but be safe)

  backdrop.addEventListener('click', closeModuleTextModal);
  _mtEl('btn-mt-close').addEventListener('click', closeModuleTextModal);

  // Floats over the map: a click or keystroke inside must never reach the canvas handlers.
  const modal = _mtEl('mt-modal');
  modal.addEventListener('mousedown', e => e.stopPropagation());
  modal.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') closeModuleTextModal();
  });

  // ⚠ Clear the input BEFORE opening the dialog, every time. A file input fires no `change` when
  // the same file is picked again, so without this the second pick is silently dead.
  _mtEl('btn-mt-file').addEventListener('click', () => {
    const input = _mtEl('mt-file-input');
    input.value = '';
    input.click();
  });

  // ⚠ Its own <input type=file>, never #file-input, which is a silent way to feed it a .webm.
  _mtEl('mt-file-input').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = async () => {
      const buf = rd.result;

      // A PDF is CONVERTED, not refused. Main-process work, so Electron-only like backup.
      if (_mtIsPdf(buf)) {
        if (!window.electronAPI || !window.electronAPI.extractPdfText) {
          _mtRenderModal('Reading a PDF needs the desktop app. Save the text as .txt and load that.', true);
          return;
        }
        _mtRenderModal('Reading the PDF…');
        let res = null;
        try { res = await window.electronAPI.extractPdfText(buf); }
        catch (err) { res = { ok: false, error: String((err && err.message) || err) }; }
        if (!res || !res.ok) {
          _mtRenderModal('Could not read that PDF' + (res && res.error ? ': ' + res.error : '.'), true);
          return;
        }
        _mtImport(res.text, f.name, res.blockText);
        return;
      }

      const text = _mtDecode(buf);
      if (text == null) { _mtRenderModal('Could not read that file as text.', true); return; }
      // Anything else that isn't prose gets NAMED, or a .docx lists as binary garbage.
      const kind = _mtBinaryKind(text);
      if (kind) {
        _mtRenderModal('That looks like ' + kind + ', not plain text. Save it as .txt first, ' +
                       'then load that.', true);
        return;
      }
      _mtImport(text, f.name);
    };
    rd.onerror = () => _mtRenderModal('Could not read that file.', true);
    // ArrayBuffer, not readAsText: the encoding has to be decided by looking at the bytes.
    rd.readAsArrayBuffer(f);
  });

  // Removing does NOT close the panel: the empty state is the confirmation that it worked.
  _mtEl('btn-mt-remove').addEventListener('click', () => {
    confirmDialog({
      title: 'Remove module text?',
      message: 'The locations Evermist parsed are discarded. Room names and descriptions ' +
               'already written to the map stay as they are.',
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      danger: true,
      onConfirm: () => {
        mtClearStored();
        _mtEl('mt-file-input').value = '';
        _mtRenderModal();
      },
    });
  });
}

// ─── The name field as a combobox ─────────────────────────────────────────────
// #rp-name keeps working EXACTLY as before when nothing matches or nothing is loaded. The list is
// additive: it opens on focus, filters as the DM types, and picking fills name and description.
//
// ⚠ It lives INSIDE the card (absolutely positioned in .rp-ident), never floating over the page, so
// #panel-room's `zoom: var(--ui-zoom)` applies and it cannot be orphaned when the card moves.
//
// The FOOTER ROW is the only entry point to the import panel.

let _mtDD = null;        // the dropdown element, built once
let _mtNameEl = null;
let _mtOpen = false;
let _mtShown = [];       // entries currently listed, in displayed order
let _mtActive = -1;      // keyboard-highlighted row

function _mtBuildDropdown(identEl) {
  const dd = document.createElement('div');
  dd.className = 'rp-mt-dd';
  dd.id = 'rp-mt-dd';
  dd.style.display = 'none';
  dd.innerHTML =
    '<div class="rp-mt-head" id="rp-mt-head"></div>' +
    '<div class="rp-mt-list" id="rp-mt-list"></div>' +
    '<div class="rp-mt-foot"><button type="button" id="rp-mt-load"></button></div>';
  identEl.appendChild(dd);

  // ⚠ TWO listeners, and the split matters. mousedown only PREVENTS THE DEFAULT, or the pointer
  // going down in the list blurs the name field and closes the list out from under itself.
  //
  // The act waits for CLICK, one event later, which keeps a dialog out of the middle of a mouse
  // gesture: a dialog opened from mousedown blocks before the matching mouseup is delivered.
  dd.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
  dd.addEventListener('click', e => {
    e.stopPropagation();
    const load = e.target.closest('#rp-mt-load');
    if (load) { mtCloseDropdown(); openModuleTextModal(); return; }
    const row = e.target.closest('.rp-mt-opt');
    if (!row) return;
    _mtPick(parseInt(row.dataset.idx, 10));
  });

  return dd;
}

function _mtPick(i) {
  const entry = _mtShown[i];
  if (!entry) return;
  // The write is roomPanel's: it owns the room's fields, the undo entry and the autosave.
  if (typeof applyModuleEntryToRoom === 'function') applyModuleEntryToRoom(entry);
  mtCloseDropdown();
  if (_mtNameEl) _mtNameEl.blur();
}

function _mtRender() {
  if (!_mtDD) return;
  const q = _mtNameEl ? _mtNameEl.value : '';
  const names = mtCurrentRoomNames();
  const prog = mtProgress(mtEntries, names);
  const placed = mtPlacedTitles(mtEntries, names);

  const head = _mtEl('rp-mt-head');
  head.textContent = mtEntries.length
    ? prog.placed + ' of ' + prog.total + ' placed'
    : 'No module text loaded';

  // Filter on the typed text ONLY once it differs from the field's own, or one row shows.
  const poly = (typeof polygons !== 'undefined' && typeof selectedPolygonId !== 'undefined')
    ? polygons.find(p => p.id === selectedPolygonId) : null;
  const isExisting = poly && q === (poly.name != null ? poly.name : '');
  _mtShown = mtFilterEntries(mtEntries, isExisting ? '' : q);

  const list = _mtEl('rp-mt-list');
  list.innerHTML = '';
  _mtShown.forEach((e, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rp-mt-opt' + (i === _mtActive ? ' active' : '') +
                  (placed.has(e.title) ? ' placed' : '');
    b.dataset.idx = String(i);
    const num = document.createElement('span');
    num.className = 'rp-mt-num';
    num.textContent = e.num + '.';
    const nm = document.createElement('span');
    nm.className = 'rp-mt-name';
    nm.textContent = e.name;
    b.appendChild(num); b.appendChild(nm);
    // Marked but still selectable — one heading can legitimately serve several polygons.
    if (placed.has(e.title)) {
      const dot = document.createElement('span');
      dot.className = 'rp-mt-dot';
      dot.title = 'Already on this map';
      b.appendChild(dot);
    }
    list.appendChild(b);
  });

  if (mtEntries.length && !_mtShown.length) {
    const none = document.createElement('div');
    none.className = 'rp-mt-none';
    none.textContent = 'No match. Press Enter to keep what you typed';
    list.appendChild(none);
  }

  _mtEl('rp-mt-load').textContent = mtEntries.length
    ? 'Replace module text…' : 'Load module text…';
}

// Opening an already-open list RE-RENDERS, or the count and placed dots go stale.
function mtOpenDropdown() {
  if (!_mtDD) return;
  if (!_mtOpen) {
    _mtOpen = true;
    _mtActive = -1;
    _mtDD.style.display = 'block';
  }
  _mtRender();
}

function mtCloseDropdown() {
  if (!_mtDD || !_mtOpen) return;
  _mtOpen = false;
  _mtActive = -1;
  _mtDD.style.display = 'none';
}

function _mtScrollActiveIntoView() {
  const row = _mtEl('rp-mt-list') && _mtEl('rp-mt-list').children[_mtActive];
  if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
}

// True when the key was consumed. Escape closes the LIST first, reverting only on a second press.
function mtNameKeyDown(e) {
  if (!_mtDD) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!_mtOpen) mtOpenDropdown();
    if (!_mtShown.length) return true;
    e.preventDefault();
    const n = _mtShown.length;
    const d = e.key === 'ArrowDown' ? 1 : -1;
    // Nothing highlighted yet: Down enters at the top, Up at the bottom. After that it wraps.
    _mtActive = _mtActive < 0 ? (d > 0 ? 0 : n - 1) : (_mtActive + d + n) % n;
    _mtRender();
    _mtScrollActiveIntoView();
    return true;
  }
  if (e.key === 'Enter' && _mtOpen && _mtActive >= 0 && _mtActive < _mtShown.length) {
    e.preventDefault();
    _mtPick(_mtActive);
    return true;
  }
  if (e.key === 'Escape' && _mtOpen) {
    e.preventDefault();
    mtCloseDropdown();
    return true;
  }
  return false;
}

// Called once from initRoomPanel(). DM-only: that init returns early in player mode.
function initModuleText(nameEl) {
  mtLoadStored();
  _mtInitModal();

  _mtNameEl = nameEl;
  if (!_mtNameEl) return;
  const ident = _mtNameEl.parentElement;
  if (!ident) return;
  _mtDD = _mtBuildDropdown(ident);

  _mtNameEl.addEventListener('focus', mtOpenDropdown);
  _mtNameEl.addEventListener('input', () => {
    if (!_mtOpen) mtOpenDropdown();
    _mtActive = -1;
    _mtRender();
  });
  // The field's blur commits; the frame of delay lets a mousedown on a row land first.
  _mtNameEl.addEventListener('blur', () => setTimeout(mtCloseDropdown, 0));
}

