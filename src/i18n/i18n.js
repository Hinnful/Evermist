'use strict';

// i18n.js — the interface language: t(), and the pass that swaps on-screen English for Russian.
// The language is fixed for the life of the window, so text only ever goes one way. In English
// nothing here runs at all.

const I18N_KEY = 'evermist-lang';

function _i18nStored() {
  try { const s = localStorage.getItem(I18N_KEY); return s === 'en' || s === 'ru' ? s : null; }
  catch (_) { return null; }
}

// ⚠ No stored choice means follow the computer, existing installs included.
const I18N_LANG = _i18nStored() || (/^ru\b/i.test(navigator.language || '') ? 'ru' : 'en');

function t(src, vars) {
  return i18nFill(I18N_LANG === 'ru' ? i18nLookup(RU, src) : src, vars);
}
t.plural = function (n, one, other, vars) { return i18nPlural(I18N_LANG, RU_PLURAL, n, one, other, vars); };

const I18N_ATTRS = ['title', 'placeholder', 'aria-label'];

// ⚠ A selector, never isContentEditable: that reads computed style, and every text write in the
// pass would force a style recalc before the next check. The DM's own text is marked
// data-no-i18n; an editable cell writes its textContent back to saved data.
const I18N_SKIP = 'script,style,[data-no-i18n],[contenteditable]:not([contenteditable="false"])';

// A textarea's text is its value; only its placeholder is ours.
function _i18nText(node) {
  if (node.parentNode && node.parentNode.nodeName === 'TEXTAREA') return;
  const v = node.nodeValue;
  const k = i18nKey(v);
  if (!k || !Object.prototype.hasOwnProperty.call(RU, k)) return;
  const lead = v.match(/^\s*/)[0], trail = v.match(/\s*$/)[0];
  node.nodeValue = lead + RU[k] + trail;
}

function _i18nAttr(el, a) {
  const v = el.getAttribute(a);
  if (v === null) return;
  const k = i18nKey(v);
  if (Object.prototype.hasOwnProperty.call(RU, k)) el.setAttribute(a, RU[k]);
}

function _i18nWalk(root) {
  if (root.nodeType === 3) { _i18nText(root); return; }
  if (root.nodeType !== 1 || root.matches(I18N_SKIP)) return;
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: n => n.nodeType === 1 && n.matches(I18N_SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = tw.currentNode; n; n = tw.nextNode()) {
    if (n.nodeType === 3) _i18nText(n);
    else for (const a of I18N_ATTRS) _i18nAttr(n, a);
  }
}

function _i18nBlocked(el) { return !el || !!el.closest(I18N_SKIP); }

function _i18nObserve(muts) {
  for (const m of muts) {
    if (m.type === 'attributes') { if (!_i18nBlocked(m.target)) _i18nAttr(m.target, m.attributeName); continue; }
    for (const n of m.addedNodes) if (n.isConnected && !_i18nBlocked(n.parentElement)) _i18nWalk(n);
  }
}

// The About block's English / Русский pick. It writes the choice for the next start; the note
// under it shows only while the choice differs from the running language.
function buildLanguageSwitch() {
  const box = document.createElement('div');
  box.className = 'about-lang';
  box.innerHTML =
    '<div class="cp-tabs" data-no-i18n>' +
      '<button type="button" class="cp-segtab" data-lang="en">English</button>' +
      '<button type="button" class="cp-segtab" data-lang="ru">Русский</button>' +
    '</div>' +
    '<div class="about-lang-note" style="display:none">' + t('Applies after restart') + '</div>';
  const note = box.querySelector('.about-lang-note');
  const show = pick => {
    box.querySelectorAll('.cp-segtab').forEach(b => b.classList.toggle('active', b.dataset.lang === pick));
    note.style.display = pick === I18N_LANG ? 'none' : '';
  };
  box.querySelectorAll('.cp-segtab').forEach(b => b.addEventListener('click', () => {
    try { localStorage.setItem(I18N_KEY, b.dataset.lang); } catch (_) {}
    show(b.dataset.lang);
  }));
  show(_i18nStored() || I18N_LANG);
  return box;
}

(function () {
  if (I18N_LANG !== 'ru' || new URLSearchParams(location.search).get('mode') === 'player') return;
  document.documentElement.lang = 'ru';
  _i18nWalk(document.body);
  new MutationObserver(_i18nObserve).observe(document.body,
    { childList: true, subtree: true, attributes: true, attributeFilter: I18N_ATTRS });
})();
