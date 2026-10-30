'use strict';
// notesEditor.js — the editor every note uses: a contenteditable="plaintext-only" element whose mentions are
// non-editable labels, the @ picker at the caret, and the hover preview. Its `value` reads and writes the stored form
// (mentionPlan.js), so every caller that read a textarea's value keeps working.
//
// ⚠ EVERY NAME REACHES THE DOM THROUGH textContent AND dataset: names arrive from imported files.
// ⚠ UNDO IS THE EDITOR'S OWN. A label put in by script is not in the browser's undo stack, so Ctrl+Z is handled here.

const NE_PICK_MAX = 8;
const NE_BURST_MS = 1000;
const NE_CREATE = [['faction', 'Faction'], ['lore', 'Lore'], ['monster', 'Monster or NPC']];

let _nePick = null;       // the open picker: { el, node, start, end, items, at, pop }
let _neTip = null;
let _neTipTimer = 0;

function _neZoom() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1.2; }

// ─── Stored form ↔ DOM ───────────────────────────────────────────────────────

function _neLabel(p) {
  const s = document.createElement('span');
  s.className = 'mn';
  s.contentEditable = 'false';
  s.dataset.noI18n = '';
  s.dataset.kind = p.kind;
  s.dataset.id = p.id;
  s.dataset.name = p.name;
  _neLabelPaint(s);
  return s;
}

// Blue while the entry exists, red when it does not; the words are its current name, or its stored ones once it is gone.
function _neLabelPaint(s) {
  const r = mxResolve(s.dataset.kind, s.dataset.id);
  s.textContent = r && r.name != null ? r.name : s.dataset.name;
  s.classList.toggle('miss', !r);
}

function _neRender(el, text) {
  el.textContent = '';
  for (const p of mpParse(text)) el.appendChild(p.text !== undefined ? document.createTextNode(p.text) : _neLabel(p));
}

function _neText(node) {
  let s = '';
  for (const n of node.childNodes) {
    if (n.nodeType === 3) s += n.nodeValue;
    else if (n.nodeName === 'BR') s += '\n';
    else if (n.classList && n.classList.contains('mn')) s += mpToken(n.dataset.name, n.dataset.kind, n.dataset.id);
    else {
      if ((n.nodeName === 'DIV' || n.nodeName === 'P') && s && !s.endsWith('\n')) s += '\n';
      s += _neText(n);
    }
  }
  return s;
}

function _neValue(el) {
  if (!el.textContent && !el.querySelector('.mn')) return '';
  return _neText(el);
}

// The stored text to commit: its shown names brought up to date. A refresh that would pass the cap is refused, says
// so, and leaves the words as typed.
function neStoredText(el) {
  const raw = el.value, r = mxRefreshText(raw);
  if (!r.refused) return r.text;
  noticeToast(t('A renamed entry no longer fits in this note. Shorten the note to show its new name.'));
  return raw;
}

// Labels repainted from what exists now: a rename shows at once, with no note rewritten. Only when something that
// holds a name may have changed.
function neRefreshLabels(el) {
  const sig = mxRev() + '|' + ntSig();
  if (el._neSig === sig) return;
  el._neSig = sig;
  for (const s of el.querySelectorAll('.mn')) _neLabelPaint(s);
}

// ─── Caret ───────────────────────────────────────────────────────────────────

function _neOffset(el) {
  const sel = getSelection();
  if (!sel.rangeCount || !el.contains(sel.anchorNode)) return null;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setEnd(sel.anchorNode, sel.anchorOffset);
  return _neText(r.cloneContents()).length;
}

function _neSetCaret(el, off) {
  const r = document.createRange();
  let left = off;
  for (const n of el.childNodes) {
    if (left === null) break;
    const len = _neText({ childNodes: [n] }).length;
    if (n.nodeType === 3 && left <= len) { r.setStart(n, left); r.collapse(true); left = -1; break; }
    left -= len;
    if (left < 0) { r.setStartAfter(n); r.collapse(true); left = -1; break; }
  }
  if (left !== -1) { r.selectNodeContents(el); r.collapse(false); }
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

// ─── Undo ────────────────────────────────────────────────────────────────────

function _neHist(el) { return el._ne || (el._ne = { h: [{ v: _neValue(el), c: null }], i: 0, t: 0, burst: false }); }

function _neSnap(el, force) {
  const s = _neHist(el), v = _neValue(el);
  if (v === s.h[s.i].v) return;
  const now = Date.now(), entry = { v, c: _neOffset(el) };
  s.h.length = s.i + 1;
  if (!force && s.burst && s.i > 0 && now - s.t < NE_BURST_MS) s.h[s.i] = entry; else { s.h.push(entry); s.i++; }
  s.t = now;
  s.burst = !force;
}

function _neStep(el, d) {
  const s = _neHist(el), j = s.i + d;
  if (j < 0 || j >= s.h.length) return;
  s.i = j;
  s.burst = false;
  _neRender(el, s.h[j].v);
  _neSetCaret(el, s.h[j].c);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// ─── The @ picker ────────────────────────────────────────────────────────────

function nePickerOpen() { return !!_nePick; }

function _neClosePicker() {
  if (_nePick) { _nePick.pop.remove(); _nePick = null; }
}

// The "@words" before the caret, in the text node it sits in; null when there is none.
function _neAtQuery(el) {
  const sel = getSelection();
  if (!sel.rangeCount || !sel.isCollapsed || sel.anchorNode.nodeType !== 3 || !el.contains(sel.anchorNode)) return null;
  const node = sel.anchorNode, upto = node.nodeValue.slice(0, sel.anchorOffset);
  const m = upto.match(/(^|\s)@([^@\n[]{0,30})$/);
  return m ? { node, start: upto.length - m[2].length - 1, end: upto.length, q: m[2] } : null;
}

function _nePopRow(text, small, i) {
  const d = document.createElement('div');
  d.dataset.i = i;
  d.append(text);
  if (small) { const s = document.createElement('small'); s.textContent = small; d.append(s); }
  return d;
}

function _nePickerUpdate(el) {
  const at = _neAtQuery(el);
  if (!at) { _neClosePicker(); return; }
  const all = mxCandidates(el.dataset.neKey || '');
  const hits = mpRank(all, at.q, NE_PICK_MAX);
  const named = at.q.trim() && !all.some(c => c.name.toLowerCase() === at.q.trim().toLowerCase());
  const items = hits.map(c => ({ label: c.name, small: t(c.word) + (c.where ? ' · ' + c.where : ''), run: () => _neInsertMention(el, at, c.name, c.kind, c.id()) }));
  const pop = _nePick ? _nePick.pop : document.createElement('div');
  pop.className = 'ne-pop';
  pop.dataset.noI18n = '';
  pop.textContent = '';
  items.forEach((it, i) => pop.append(_nePopRow(it.label, it.small, i)));
  if (named) {
    const h = document.createElement('div');
    h.className = 'hd';
    h.textContent = t('Create “{name}” in', { name: at.q.trim() });
    pop.append(h);
    for (const [kind, word] of NE_CREATE) {
      const row = { label: t(word), small: '', run: () => { const m = _neCreate(kind, at.q.trim()); if (m) _neInsertMention(el, at, m.name, m.kind, m.id); } };
      pop.append(_nePopRow(row.label, '', items.length));
      items.push(row);
    }
  }
  if (!items.length) { const h = document.createElement('div'); h.className = 'hd'; h.textContent = t('Keep typing a name'); pop.append(h); }
  _nePick = { el, ...at, items, at: 0, pop };
  if (!pop.isConnected) {
    document.body.appendChild(pop);
    pop.dataset.keepsFocus = '';
    pop.addEventListener('mousedown', e => {
      e.preventDefault();
      const row = e.target.closest('[data-i]');
      if (row && _nePick) _nePick.items[+row.dataset.i].run();
    });
  }
  _nePickPaint();
  const r = document.createRange();
  r.setStart(at.node, at.end);
  r.collapse(true);
  const box = r.getClientRects()[0] || el.getBoundingClientRect(), z = _neZoom();
  pop.style.left = Math.max(4, Math.min(box.left, innerWidth - 240)) / z + 'px';
  pop.style.top = (box.bottom + 4) / z + 'px';
}

function _nePickPaint() {
  if (!_nePick) return;
  for (const d of _nePick.pop.querySelectorAll('[data-i]')) d.classList.toggle('on', +d.dataset.i === _nePick.at);
}

// A new entry from a name typed after "@". Answers the mention to put in, or null.
function _neCreate(kind, name) {
  let made = null;
  if (kind === 'monster') {
    const b = cbNewBlock(combatUniqueName(cbState.blocks, name, ''));
    b.listed = true;
    cbSave();
    made = { name: b.name, kind: 'monster', id: mxMonsterUid(b) };
    if (typeof bsIsOpen === 'function' && bsIsOpen()) bestiaryRender();
  } else {
    const e = notesEntryAdd(kind, name, kind);
    made = { name: e.name, kind: 'entry', id: e.id };
  }
  mxBump();
  return made;
}

// Replaces the "@words" with a label, unless the note would pass its cap.
function _neInsertMention(el, at, name, kind, id, replacing) {
  if (!id) { _neClosePicker(); return; }
  const token = mpToken(name, kind, id), gone = replacing ? mpToken(replacing.dataset.name, replacing.dataset.kind, replacing.dataset.id) : at.node.nodeValue.slice(at.start, at.end);
  if (!mpFits(_neValue(el).slice(0, _neValue(el).length - gone.length), token, notesCap())) {
    _neClosePicker();
    noticeToast(t('This note is full, so the link was not added.'));
    return;
  }
  const label = _neLabel({ name, kind, id });
  const sp = document.createTextNode(' ');
  if (replacing) replacing.replaceWith(label);
  else {
    const r = document.createRange();
    r.setStart(at.node, at.start);
    r.setEnd(at.node, at.end);
    r.deleteContents();
    r.insertNode(sp);
    r.insertNode(label);
    const c = document.createRange();
    c.setStartAfter(sp);
    c.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(c);
  }
  _neClosePicker();
  _neSnap(el, true);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  // A menu row took the focus before it ran, so the commit that hangs off the blur is sent again.
  if (document.activeElement !== el) el.dispatchEvent(new FocusEvent('blur'));
}

// ─── Opening, the red label's menu, the hover preview ────────────────────────

function neOpenMention(kind, id) {
  const r = mxResolve(kind, id);
  if (!r || !r.target || !r.key) return;
  if (typeof bsIsOpen === 'function' && bsIsOpen()) bestiarySetOpen(false);
  nwShow();
  if (!ntGoKey(r.key)) notesShow(r.target);
}

function _neMissMenu(el, label) {
  const name = label.dataset.name, rect = label.getBoundingClientRect();
  const rows = [{ label: t('Create “{name}” in', { name }), raw: true, off: true, run: () => {} }].concat(NE_CREATE.map(([kind, word]) => ({
    label: word,
    run: () => { const m = _neCreate(kind, name); if (m) _neInsertMention(el, null, m.name, m.kind, m.id, label); },
  })));
  ntMenuAt(rect, rows);
  if (_ntMenu) _ntMenu.dataset.keepsFocus = '';
}

function _neHideTip() {
  clearTimeout(_neTipTimer);
  if (_neTip) _neTip.style.display = 'none';
}

function _neShowTip(label) {
  const r = mxResolve(label.dataset.kind, label.dataset.id);
  if (!_neTip) {
    _neTip = document.createElement('div');
    _neTip.className = 'ne-tip';
    _neTip.dataset.noI18n = '';
    document.body.appendChild(_neTip);
  }
  _neTip.textContent = '';
  const head = document.createElement('div'), b = document.createElement('b'), kind = document.createElement('span'), p = document.createElement('p');
  b.textContent = r && r.name != null ? r.name : label.dataset.name;
  kind.className = 'ne-kind';
  kind.textContent = r ? t(r.word) : t('Not found');
  p.textContent = r ? (mpPlain(r.note).trim().split('\n').slice(0, 4).join('\n').slice(0, 200) || t('No note yet.')) : t('Nothing by this name exists any more.');
  head.append(b, ' ', kind);
  _neTip.append(head, p);
  const box = label.getBoundingClientRect(), z = _neZoom();
  _neTip.style.display = 'block';
  _neTip.style.left = Math.max(4, Math.min(box.left, innerWidth - 260)) / z + 'px';
  _neTip.style.top = (box.bottom + 6) / z + 'px';
}

// ─── Wiring ──────────────────────────────────────────────────────────────────

function _neKey(el, e) {
  if (e.ctrlKey || e.metaKey) {
    if (e.code === 'KeyZ') { e.preventDefault(); _neStep(el, e.shiftKey ? 1 : -1); return; }
    if (e.code === 'KeyY') { e.preventDefault(); _neStep(el, 1); return; }
  }
  if (!_nePick || _nePick.el !== el) return;
  const p = _nePick, n = p.items.length;
  if (e.key === 'Escape') _neClosePicker();
  else if (e.key === 'ArrowDown' && n) { p.at = (p.at + 1) % n; _nePickPaint(); }
  else if (e.key === 'ArrowUp' && n) { p.at = (p.at + n - 1) % n; _nePickPaint(); }
  else if ((e.key === 'Enter' || e.key === 'Tab') && n) p.items[p.at].run();
  else return;
  e.preventDefault();
  e.stopImmediatePropagation();
}

function _neCopy(el, e, cut) {
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed || !el.contains(sel.anchorNode)) return;
  e.clipboardData.setData('text/plain', _neText(sel.getRangeAt(0).cloneContents()));
  e.preventDefault();
  if (cut) document.execCommand('delete');
}

function _nePaste(el, e) {
  e.preventDefault();
  const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
  if (!text) return;
  document.execCommand('insertText', false, text);
  if (text.includes('@[')) {
    const off = _neOffset(el);
    _neRender(el, _neValue(el));
    _neSetCaret(el, off);
    _neSnap(el, true);
  }
}

// Makes `el` a notes editor. `value`, `disabled` and `placeholder` behave as a textarea's.
function neInit(el) {
  if (el._neReady) return el;
  el._neReady = true;
  el.setAttribute('contenteditable', 'plaintext-only');
  el.spellcheck = false;
  el.classList.add('ne');
  Object.defineProperty(el, 'value', {
    get() { return _neValue(el); },
    set(v) { _neClosePickerOf(el); el._ne = null; _neRender(el, String(v == null ? '' : v)); },
  });
  Object.defineProperty(el, 'disabled', {
    get() { return el.getAttribute('contenteditable') === 'false'; },
    set(v) { el.setAttribute('contenteditable', v ? 'false' : 'plaintext-only'); },
  });
  Object.defineProperty(el, 'placeholder', {
    get() { return el.getAttribute('placeholder') || ''; },
    set(v) { el.setAttribute('placeholder', v); },
  });
  el.addEventListener('keydown', e => _neKey(el, e));
  el.addEventListener('beforeinput', e => {
    if (e.inputType === 'historyUndo') { e.preventDefault(); _neStep(el, -1); return; }
    if (e.inputType === 'historyRedo') { e.preventDefault(); _neStep(el, 1); return; }
    if (!/^insert/.test(e.inputType)) return;
    const add = e.data != null ? e.data : /Paragraph|LineBreak/.test(e.inputType) ? '\n' : '';
    if (!mpFits(_neValue(el), add, notesCap())) { e.preventDefault(); noticeToast(t('This note is full. Shorten it to add more.')); }
  });
  el.addEventListener('input', () => {
    if (!el.textContent && !el.querySelector('.mn') && el.firstChild) el.textContent = '';
    _neSnap(el, false);
    _nePickerUpdate(el);
  });
  el.addEventListener('blur', () => { _neClosePickerOf(el); _neHideTip(); });
  el.addEventListener('copy', e => _neCopy(el, e, false));
  el.addEventListener('cut', e => _neCopy(el, e, true));
  el.addEventListener('paste', e => _nePaste(el, e));
  el.addEventListener('mousedown', e => { if (e.target.closest('.mn')) e.preventDefault(); });
  el.addEventListener('click', e => {
    const label = e.target.closest('.mn');
    if (!label) return;
    _neHideTip();
    if (label.classList.contains('miss')) _neMissMenu(el, label);
    else neOpenMention(label.dataset.kind, label.dataset.id);
  });
  el.addEventListener('mouseover', e => {
    const label = e.target.closest('.mn');
    if (!label || label.contains(e.relatedTarget)) return;
    clearTimeout(_neTipTimer);
    _neTipTimer = setTimeout(() => _neShowTip(label), 250);
  });
  el.addEventListener('mouseout', e => {
    const label = e.target.closest('.mn');
    if (label && !label.contains(e.relatedTarget)) _neHideTip();
  });
  return el;
}

function _neClosePickerOf(el) { if (_nePick && _nePick.el === el) _neClosePicker(); }
