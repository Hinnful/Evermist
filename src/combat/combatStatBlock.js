// combatStatBlock.js — typing into a stat block. bestiaryPage.js draws the page with each value typeable, on an entry
// and on a fight row's copy, which reaches the bestiary only through Save to Bestiary. combatTracker.js owns saving.

const CB_SECTIONS = ['Traits', 'Actions', 'Bonus actions', 'Reactions', 'Legendary actions', 'Mythic actions', 'Lair actions'];
const CB_ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

function cbNewBlock(name) {
  const id = combatNextBlockId(cbState.blocks);
  cbState.blocks[id] = Object.assign(combatBlankBlock(id, name), { uid: combatMintUid() });
  return cbState.blocks[id];
}

// A row typed by hand gets an empty copy of its own, for this fight only.
function cbRowBlock(row) {
  if (!row.sb) row.sb = combatSnapshot(combatBlankBlock('', combatBaseName(row.name)));
  return row.sb;
}

function _cbEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// plaintext-only keeps a paste from a website from bringing its markup in with it.
function _cbEd(path, val, ph, cls, tag) {
  const tg = tag || 'span';
  return `<${tg} class="${cls || ''}" contenteditable="plaintext-only" spellcheck="false" data-p="${path}" data-ph="${_cbEsc(ph ? t(ph) : '')}">${_cbEsc(val)}</${tg}>`;
}

// The page's typing and its add and remove buttons, wherever it sits. `ed.block()` is what it edits,
// `ed.edited(field)` hears every change, and `ed.redraw()` draws the page again after one.
function cbWireEditor(el, ed) {
  el.addEventListener('input', e => {
    const p = e.target.dataset.p, b = ed.block();
    if (!p || !b) return;
    const parts = p.split('.');
    // Emptied, the browser leaves a <br> behind, and the dim placeholder shows only on a value with nothing in it.
    if (!e.target.textContent && e.target.firstChild) e.target.replaceChildren();
    // AC and HP are a number and a note on the page and one line in the record.
    if (parts[0] === 'ac' || parts[0] === 'hp') {
      const v = s => { const f = el.querySelector(`[data-p="${parts[0]}.${s}"]`); return f ? f.textContent : ''; };
      b[parts[0]] = combatJoinBig(v('n'), v('note'));
    } else {
      let o = b;
      for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
      // ⚠ Enter at the end of a pre-wrap value makes Chromium add one more newline to hold the new line open.
      o[parts[parts.length - 1]] = e.target.textContent.replace(/\n$/, '');
    }
    // An emptied Table line is no line of the DM's own, so the pills come back.
    if (p === 'quick' && !b.quick.trim()) delete b.quick;
    if (parts[0] === 'abil') bpAbilSync(el, b, parts[1]);
    ed.edited(parts[0]);
    cbSaveSoon();
  });
  el.addEventListener('keydown', e => {
    // Enter ends a one-line value; an entry's text and the lore keep their line breaks.
    const p = e.target.dataset && e.target.dataset.p;
    if (e.key === 'Enter' && p && !/\.t$/.test(p) && p !== 'lore') { e.preventDefault(); e.target.blur(); }
  });
  // A line emptied and left goes, once the focus has landed wherever it was going.
  el.addEventListener('focusout', e => {
    const line = e.target.closest && e.target.closest('[data-line]'), b = ed.block();
    if (!line || !b || e.target.textContent.trim()) return;
    bpAddedLines.delete(line.dataset.line);
    setTimeout(() => { if (ed.block() === b) bpLinesRedraw(el, b); });
  });
  el.addEventListener('click', e => {
    const tg = e.target, b = ed.block();
    if (!b) return;
    const secEl = tg.closest('[data-sec]'), sec = secEl && secEl.dataset.sec;
    const changed = () => { ed.edited('secs'); cbSave(); ed.redraw(); };
    if (tg.closest('[data-delsec]')) { delete b.secs[sec]; return changed(); }
    const del = tg.closest('[data-delentry]');
    if (del) { b.secs[sec].splice(+del.dataset.delentry, 1); return changed(); }
    if (tg.closest('[data-addentry]')) {
      b.secs[sec].push({ n: '', t: '' });
      changed();
      const names = el.querySelectorAll(`[data-sec="${sec}"] [data-p$=".n"]`);
      names[names.length - 1].focus();
      return;
    }
    const addsec = tg.closest('[data-addsec]');
    if (addsec) {
      const open = CB_SECTIONS.filter(s => !b.secs[s]);
      if (!open.length) return;
      cbMenu(open.map(s => ({ label: t(s), pick: () => {
        b.secs[s] = [{ n: '', t: '' }];
        changed();
        const f = el.querySelector(`[data-p="secs.${s}.0.n"]`);
        if (f) f.focus();
      } })), addsec.getBoundingClientRect(), addsec);
      return;
    }
    const addline = tg.closest('[data-addline]');
    if (addline) {
      cbMenu(BP_EDIT_LINES.filter(([k]) => !el.querySelector(`[data-line="${k}"]`)).map(([k, label]) => ({ label: t(label), pick: () => {
        bpAddedLines.add(k);
        bpLinesRedraw(el, b, k);
      } })), addline.getBoundingClientRect(), addline);
    }
  });
}
