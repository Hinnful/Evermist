'use strict';
// fogBar.js — the fog on the bar: Reveal all and Hide all as two bare eyes, the fog mode as three
// clouds that open the picked tool's row. Every row sits centred over the bar (#tools-wrapper) and
// points at no tool. The clouds set what the Brush and the next shape do to the fog and nothing else:
// a click with Select in hand never changes the tool and never touches a room (a room's own clouds
// are roomSwitcher.js's). The old fog trio and its ids stay in the page as the back end.

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
  reveal.innerHTML = uiIcon('cloudOff', 18, 1.6);
  hide.innerHTML = uiIcon('cloudSolid', 18, 1.6);
  fogPreviewInit(reveal, hide);
  reveal.onclick = revealAllMap;
  hide.onclick = hideAllMap;
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
