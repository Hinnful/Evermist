'use strict';
// The window icons. index.html writes the same markup out by hand for its static windows.

const UI_ICON_PATHS = {
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  export: '<path d="M12 15V4M7 9l5-5 5 5M5 20h14"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>',
  link: '<path d="M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
  plan: '<path d="M12 3l8.5 6.2-3.2 10.3H6.7L3.5 9.2z"/>',
  collapse: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16M8 10l2 2-2 2"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  // ↺, before the word on every Reset.
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 3.5v4h4"/>',
  dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
  brush: '<path d="M20.5 3.5c-2 .4-6.6 4.6-8.7 7.4l2.3 2.3c2.8-2.1 7-6.7 6.4-9.7z"/><path d="M10.9 12.4c-1.9-.3-3.6 1-3.9 3-.2 1.6-1 2.6-3.5 3.1 3.6 1.9 8.3.6 9.2-2.6.3-1.3-.2-2.6-1.8-3.5z"/>',
  cloud: '<path d="M7 18h10.5a4 4 0 0 0 .4-7.98A6 6 0 0 0 6.3 9.6 4.2 4.2 0 0 0 7 18z"/>',
  door: '<path d="M6.5 20V10.5a5.5 5.5 0 0 1 11 0V20"/><path d="M3.5 20h17"/><circle cx="14.6" cy="14" r="1.05" fill="currentColor" stroke="none"/>',
  // The fog's three states as one cloud: struck out (Reveal), striped (Half), solid (Hide). The stripes
  // are clipped to the cloud, and @ID@ gives every copy of the icon a clip of its own.
  cloudOff: '<path d="M7 18h10.5a4 4 0 0 0 .4-7.98A6 6 0 0 0 6.3 9.6 4.2 4.2 0 0 0 7 18z"/><path d="M3.5 3.5l17 17"/>',
  cloudHalf: '<defs><clipPath id="@ID@"><path d="M7 18h10.5a4 4 0 0 0 .4-7.98A6 6 0 0 0 6.3 9.6 4.2 4.2 0 0 0 7 18z"/></clipPath></defs><g clip-path="url(#@ID@)" stroke-width="1.3"><path d="M4 16l8-8M7.5 19l10-10M12 20l8-8M2 12l6-6"/></g><path d="M7 18h10.5a4 4 0 0 0 .4-7.98A6 6 0 0 0 6.3 9.6 4.2 4.2 0 0 0 7 18z"/>',
  cloudSolid: '<path d="M7 18h10.5a4 4 0 0 0 .4-7.98A6 6 0 0 0 6.3 9.6 4.2 4.2 0 0 0 7 18z" fill="currentColor" fill-opacity=".65"/>',
  // The edit row's own: Pen and Bend in its well, Intersect and Exclude beside Merge and Cut out.
  pen: '<path d="M12 3.2l5.4 8.4-3.2 5.6H9.8l-3.2-5.6z"/><circle cx="12" cy="11.4" r="1.3" fill="currentColor" stroke="none"/><path d="M12 3.2v6.6M9.6 20.6h4.8"/>',
  bend: '<path d="M4 18.5c2-8.5 14-8.5 16 0"/><circle cx="12" cy="12.1" r="1.5" fill="currentColor" stroke="none"/><path d="M6 8h12" opacity=".45"/>',
  intersect: '<rect x="4" y="4" width="11" height="11" rx="1.5" stroke-dasharray="2.5 2.5"/><rect x="9" y="9" width="11" height="11" rx="1.5" stroke-dasharray="2.5 2.5"/><rect x="9" y="9" width="6" height="6" fill="currentColor" stroke="none"/>',
  exclude: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h8A1.5 1.5 0 0 1 15 5.5V9H9v6H5.5A1.5 1.5 0 0 1 4 13.5zM20 18.5a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 9 18.5V15h6V9h3.5A1.5 1.5 0 0 1 20 10.5z" fill="currentColor" fill-opacity=".55"/><rect x="9" y="9" width="6" height="6" stroke-dasharray="2 2"/>',
  chev: '<path d="M7 10l5 5 5-5"/>',
  scrub: '<path d="M7 8l-4 4 4 4M17 8l4 4-4 4M3 12h18"/>',
  line: '<path d="M5 12h16"/><circle cx="3.6" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  wall: '<rect x="3" y="8" width="18" height="8" rx="1" fill="currentColor" fill-opacity=".3"/><path d="M3 12h18M9 8v4M15 8v4M6 12v4M12 12v4M18 12v4"/>',
  // An arrow: Open, on the world map's bar over a picked scene (a box around it read as a download). More is three dots.
  open: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  more: '<circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  // Optically centred: the triangle's centroid, not its box, sits on the centre, so the box is W/6 right of it.
  play: '<path d="M8.9 6.75L18.1 12 8.9 17.25z" fill="currentColor" stroke-width="2.5"/>',
  stop: '<rect x="6.2" y="6.2" width="11.6" height="11.6" rx="1.6" fill="currentColor"/>',
  sort: '<path d="M8 19V5M4.5 8.5L8 5l3.5 3.5M16 5v14M12.5 15.5L16 19l3.5-3.5"/>',
  broom: '<path d="M19 3l-7 7"/><path d="M8.5 9.5l6 6"/><path d="M8.5 9.5c-2 1-4.5 1.5-6 1.5 1 4.5 4 8 8.5 10 .5-2 1-4.5 3.5-5.5"/><path d="M6 14l2 2"/>',
  book: '<path d="M3 5.5h6A3 3 0 0 1 12 8.5v11a2 2 0 0 0-2-2H3z"/><path d="M21 5.5h-6a3 3 0 0 0-3 3v11a2 2 0 0 1 2-2h7z"/>',
  // The fight row's side switch: a solid head with the face cut out through a mask, so it reads on any background.
  devil: '<defs><mask id="@ID@"><rect width="24" height="24" fill="#fff" stroke="none"/><g fill="none" stroke="#000" stroke-width="1.7"><path d="M7.6 11.2l3 1.3"/><path d="M16.4 11.2l-3 1.3"/><path d="M7.9 16.4c2.2 2.9 6 2.9 8.2 0"/></g></mask></defs><g fill="currentColor" stroke="none" mask="url(#@ID@)"><circle cx="12" cy="14" r="8"/><path d="M5.6 9.4C3.9 7.9 3.3 5.4 3.8 2.9c1.2 1.9 2.9 3.1 5 3.6z"/><path d="M18.4 9.4c1.7-1.5 2.3-4 1.8-6.5-1.2 1.9-2.9 3.1-5 3.6z"/></g>',
  angel: '<defs><mask id="@ID@"><rect width="24" height="24" fill="#fff" stroke="none"/><g fill="none" stroke="#000" stroke-width="1.7"><path d="M7.9 13.6c.9-1.3 2.4-1.3 3.3 0"/><path d="M12.8 13.6c.9-1.3 2.4-1.3 3.3 0"/><path d="M8.7 17c1.9 2.2 4.7 2.2 6.6 0"/></g></mask></defs><g fill="currentColor" stroke="none" mask="url(#@ID@)"><circle cx="12" cy="14.6" r="7.6"/></g><ellipse cx="12" cy="3.7" rx="6.6" ry="1.9" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  tv: '<rect x="2.8" y="5.2" width="18.4" height="12.6" rx="2"/><path d="M12 17.8v3M8 20.8h8"/>',
};

let _iconSeq = 0;

function uiIcon(k, size, stroke) {
  const s = size || 14;
  const id = 'uiic' + (++_iconSeq);
  return `<svg class="i-${k}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke || 1.8}" stroke-linecap="round" stroke-linejoin="round">${UI_ICON_PATHS[k].replace(/@ID@/g, id)}</svg>`;
}
