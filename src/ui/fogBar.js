'use strict';
// fogBar.js — the fog on the bar: Reveal all and Hide all as two bare eyes, the fog mode as three
// clouds that open the picked tool's row, and where that row sits. The clouds set what the Brush and the
// next shape do to the fog and nothing else: a click with Select in hand never changes the tool and
// never touches a room (a room's own clouds are roomSwitcher.js's). The old fog trio and its ids stay in
// the page as the back end.

// Struck-out cloud reveals, striped cloud is Half, solid cloud hides. Half is shapes only.
const FOG_CLOUDS = [
  ['reveal', 'cloudOff', 'Reveal - what you paint or draw is shown to the players'],
  ['half', 'cloudHalf', 'Half - explored, but the party is not there now'],
  ['shroud', 'cloudSolid', 'Hide - what you paint or draw is hidden from the players'],
];

// The well of three clouds, shared with the selected room's popup, which words the titles its own way.
function fogCloudsHtml(tips) {
  return '<span class="fx-track">' + FOG_CLOUDS.map(([d, ic, tip]) =>
    '<button type="button" class="mode-btn fx-dir" data-dir="' + d + '" title="' + t((tips && tips[d]) || tip) + '">' + uiIcon(ic, 18, 1.6) + '</button>').join('') + '</span>';
}

function initFogBar() {
  const mode = document.getElementById('wa-mode');
  mode.innerHTML = fogCloudsHtml();
  mode.firstChild.id = 'fx-switch';
  mode.querySelectorAll('.fx-dir').forEach(b => {
    b.onclick = () => { if (!b.disabled) setPaintDirection(b.dataset.dir); };
  });
  const reveal = document.getElementById('tb-reveal-all'), hide = document.getElementById('tb-hide-all');
  reveal.innerHTML = uiIcon('eyeOpen', 18, 1.6);
  hide.innerHTML = uiIcon('eyeShut', 18, 1.6);
  reveal.onclick = revealAllMap;
  hide.onclick = hideAllMap;
  window.addEventListener('resize', placeContextRow);
  refreshFogBar();
}

// Lit is the paint direction. Half is absent under the Brush, which paints into a cleared-or-opaque
// fog with no third value, and the clouds grey while a repair is lit (a held key, or one armed), which
// takes its fog from the rooms it hits.
function refreshFogBar() {
  const repair = !!repairShown();
  document.querySelectorAll('#fx-switch .fx-dir').forEach(b => {
    const d = b.dataset.dir;
    b.classList.toggle('active', d === tool);
    b.disabled = repair;
    if (d === 'half') b.style.display = shape === 'brush' ? 'none' : '';
  });
}

// The row hangs over the tool it belongs to, kept inside the window, with a pointer down to it:
// the Brush for brush size, Shape for everything a shape takes. The Door's fields have no tool under
// them and sit centred with no pointer. The pointer never sits under a divider, so a row with one
// near it slides sideways until the pointer is clear.
function placeContextRow() {
  const row = document.getElementById('context-row');
  if (!row) return;
  const anchor = shape === 'door' ? null : document.getElementById(shape === 'brush' ? 'btn-brush' : 'btn-shape');
  row.classList.toggle('no-caret', !anchor);
  row.style.left = '0px';
  row.style.setProperty('--fx-caret', '0px');
  if (!anchor) return;
  const r = row.getBoundingClientRect(), a = anchor.getBoundingClientRect();
  if (!r.width || !a.width) return;
  const z = r.width / row.offsetWidth || 1;   // measured, never a bare --ui-zoom
  const want = (a.left + a.width / 2) - (r.left + r.width / 2);
  // Inside the window, and never so far that the pointer leaves the row's own width.
  const reach = r.width / 2 - 16;
  const clamp = s => Math.max(12 - r.left, want - reach, Math.min(innerWidth - 12 - r.right, want + reach, s));
  let shift = clamp(want);
  const caretX = a.left + a.width / 2;   // the pointer points at the tool, wherever the row slides
  const clear = 14 * z;
  const divs = Array.from(row.querySelectorAll('.tb-mdiv')).filter(d => d.offsetParent)
    .map(d => { const b = d.getBoundingClientRect(); return b.left + b.width / 2 - r.left; });
  for (let pass = 0; pass < 3; pass++) {
    const hit = divs.map(x => x + shift - (caretX - r.left)).find(dx => Math.abs(dx) < clear);
    if (hit === undefined) break;
    shift = clamp(shift + (hit >= 0 ? clear - hit : -(clear + hit)));
  }
  row.style.left = shift / z + 'px';
  row.style.setProperty('--fx-caret', (want - shift) / z + 'px');
}
