// attackPills.js — the fight table's Attacks cell as pills: a glyph and a colour per damage type.
// Glyphs are Tabler Icons outline paths (MIT, © 2020-2024 Paweł Kuna, tabler.io/icons).

const CB_DAMAGE_LOOK = {
  slashing: ['#c3c7cc', '<path d="M20 4v5l-9 7l-4 4l-3 -3l4 -4l7 -9z"/><path d="M6.5 11.5l6 6"/>'],
  piercing: ['#c3c7cc', '<path d="M5 12l14 0"/><path d="M15 16l4 -4"/><path d="M15 8l4 4"/>'],
  bludgeoning: ['#c3c7cc', '<path d="M11.414 10l-7.383 7.418a2.091 2.091 0 0 0 0 2.967a2.11 2.11 0 0 0 2.976 0l7.407 -7.385"/><path d="M18.121 15.293l2.586 -2.586a1 1 0 0 0 0 -1.414l-7.586 -7.586a1 1 0 0 0 -1.414 0l-2.586 2.586a1 1 0 0 0 0 1.414l7.586 7.586a1 1 0 0 0 1.414 0z"/>'],
  acid: ['#c8d93a', '<path d="M7.502 19.423c2.602 2.105 6.395 2.105 8.996 0c2.602 -2.105 3.262 -5.708 1.566 -8.546l-4.89 -7.26c-.42 -.625 -1.287 -.803 -1.936 -.397a1.376 1.376 0 0 0 -.41 .397l-4.893 7.26c-1.695 2.838 -1.035 6.441 1.567 8.546z"/>'],
  cold: ['#7fd0f0', '<path d="M10 4l2 1l2 -1"/><path d="M12 2v6.5l3 1.72"/><path d="M17.928 6.268l.134 2.232l1.866 1.232"/><path d="M20.66 7l-5.629 3.25l.01 3.458"/><path d="M19.928 14.268l-1.866 1.232l-.134 2.232"/><path d="M20.66 17l-5.629 -3.25l-2.99 1.738"/><path d="M14 20l-2 -1l-2 1"/><path d="M12 22v-6.5l-3 -1.72"/><path d="M6.072 17.732l-.134 -2.232l-1.866 -1.232"/><path d="M3.34 17l5.629 -3.25l-.01 -3.458"/><path d="M4.072 9.732l1.866 -1.232l.134 -2.232"/><path d="M3.34 7l5.629 3.25l2.99 -1.738"/>'],
  fire: ['#ff8a4c', '<path d="M12 12c2 -2.96 0 -7 -1 -8c0 3.038 -1.773 4.741 -3 6c-1.226 1.26 -2 3.24 -2 5a6 6 0 1 0 12 0c0 -1.532 -1.056 -3.94 -2 -5c-1.786 3 -2.791 3 -4 2z"/>'],
  force: ['#e8595f', '<path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z"/>'],
  lightning: ['#5b9bff', '<path d="M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11"/>'],
  necrotic: ['#45c4b0', '<path d="M12 4c4.418 0 8 3.358 8 7.5c0 1.901 -.755 3.637 -2 4.96l0 2.54a1 1 0 0 1 -1 1h-10a1 1 0 0 1 -1 -1v-2.54c-1.245 -1.322 -2 -3.058 -2 -4.96c0 -4.142 3.582 -7.5 8 -7.5z"/><path d="M10 17v3"/><path d="M14 17v3"/><path d="M9 11m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M15 11m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/>'],
  poison: ['#62c462', '<path d="M9 3l6 0"/><path d="M10 9l4 0"/><path d="M10 3v6l-4 11a.7 .7 0 0 0 .5 1h11a.7 .7 0 0 0 .5 -1l-4 -11v-6"/>'],
  psychic: ['#f07ac8', '<path d="M15.5 13a3.5 3.5 0 0 0 -3.5 3.5v1a3.5 3.5 0 0 0 7 0v-1.8"/><path d="M8.5 13a3.5 3.5 0 0 1 3.5 3.5v1a3.5 3.5 0 0 1 -7 0v-1.8"/><path d="M17.5 16a3.5 3.5 0 0 0 0 -7h-.5"/><path d="M19 9.3v-2.8a3.5 3.5 0 0 0 -7 0"/><path d="M6.5 16a3.5 3.5 0 0 1 0 -7h.5"/><path d="M5 9.3v-2.8a3.5 3.5 0 0 1 7 0v10"/>'],
  radiant: ['#f2d46b', '<path d="M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7"/>'],
  thunder: ['#a77bf0', '<path d="M21 12h-2c-.894 0 -1.662 -.857 -1.761 -2c-.296 -3.45 -.749 -6 -2.749 -6s-2.5 3.582 -2.5 8s-.5 8 -2.5 8s-2.452 -2.547 -2.749 -6c-.1 -1.147 -.867 -2 -1.763 -2h-2"/>'],
};
const CB_GLYPH_INFO = '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"/><path d="M12 9h.01"/><path d="M11 12h1v4h1"/>';
const CB_WEAPON_TYPES = ['slashing', 'piercing', 'bludgeoning'];

const _cbGlyph = paths => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

function _cbDamageSeg(p) {
  const look = CB_DAMAGE_LOOK[p.type];
  if (!look) return `<span class="pd">${_cbEsc(p.dmg)}</span>`;
  return `<span class="pd${CB_WEAPON_TYPES.includes(p.type) ? ' w' : ''}" style="--c:${look[0]}">${_cbGlyph(look[1])}${_cbEsc(p.dmg)}</span>`;
}

function cbAttackPill(a) {
  if (a.fallback) return `<span class="cb-pill fb" title="${_cbEsc(a.t)}"><span class="pn">${_cbGlyph(CB_GLYPH_INFO)}${_cbEsc(a.n)}</span></span>`;
  return `<span class="cb-pill" title="${_cbEsc(`${a.n}. ${a.t}`)}"><span class="pn">${a.x ? `<span class="px">${a.x}×</span>` : ''}${_cbEsc(a.n)}</span>${
    a.rc ? `<span class="pr">${_cbEsc(a.rc)}</span>` : ''}<span class="ph">${_cbEsc(a.hit)}</span>${a.parts.map(_cbDamageSeg).join('')}${
    a.grab ? `<span class="pg">Grappled DC ${_cbEsc(a.grab)}</span>` : ''}</span>`;
}
