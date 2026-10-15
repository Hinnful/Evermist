'use strict';
// roomSwitcher.js — the selected room's own controls, on the map just above it: its fog as the same
// three clouds the tool row holds, in a well, a divider, and the door as a bare button. A click on a
// cloud sets THIS room's fog at once (T still cycles it); the door button arms the Door tool, which then
// works on any room's wall, as the tool always did. The row's clouds (fogBar.js) set what is drawn next
// and touch no room. drawCursor calls refreshRoomSwitcher.

const RF_TIPS = {
  reveal: 'Revealed - the players see this room (T cycles)',
  half: 'Half - explored, but the party is not there now (T cycles)',
  shroud: 'Hidden - the players do not see this room (T cycles)',
};

function initRoomSwitcher() {
  const el = document.getElementById('room-fog');
  if (!el) return;
  el.innerHTML = fogCloudsHtml(RF_TIPS) +
    '<i class="tb-mdiv"></i>' +
    '<button type="button" class="tool-btn rf-door">' + uiIcon('door', 18, 1.5) + '</button>';
  el.addEventListener('mousedown', e => e.stopPropagation());
  el.querySelectorAll('.fx-dir').forEach(b => b.onclick = () => _rfSetMode(b.dataset.dir));
  el.querySelector('.rf-door').onclick = () => setShape(shape === 'door' ? 'select' : 'door');
}

// The room the switcher is for: the selected room, while Select or Door is in hand. In two-map mode
// the map and its rooms are the columns', so the DM window has none to show.
function _rfRoom() {
  if (isPlayer || worldMapOpen || gridCalArmed || placeMode !== 'rooms') return null;
  if (panesActive && !isPane) return null;
  if (shape !== 'select' && shape !== 'door') return null;
  if (selectedPolygonId == null) return null;
  return polygons.find(p => p.id === selectedPolygonId) || null;
}

function _rfSetMode(mode) {
  const room = _rfRoom();
  if (!room) return;
  if (paneRoomEdit('mode', { mode })) return;
  setPolygonMode(room.id, mode);
  refreshRoomSwitcher();
}

// Placed over the room's top edge, centred on it and kept in the window; under the room when there
// is no space above. A drag of the room, or of one of its corners, puts it away until the drop.
let _rfKey = '';   // what the switcher was last laid out for; drawCursor runs on every mouse move
function refreshRoomSwitcher() {
  const el = document.getElementById('room-fog');
  if (!el) return;
  const room = _rfRoom();
  if (!room || selectDragging()) { el.style.display = 'none'; _rfKey = ''; return; }
  let l = Infinity, r = -Infinity, top = Infinity, bottom = -Infinity;
  for (const v of room.vertices) {
    const s = toScreen(v.x, v.y), c = viewToClient(s.sx, s.sy);
    l = Math.min(l, c.x); r = Math.max(r, c.x); top = Math.min(top, c.y); bottom = Math.max(bottom, c.y);
  }
  const key = [room.id, room.mode, shape, l, r, top, bottom, innerWidth, innerHeight].join('|');
  if (key === _rfKey && el.style.display === 'flex') return;
  _rfKey = key;
  el.querySelectorAll('.fx-dir').forEach(b => b.classList.toggle('active', b.dataset.dir === room.mode));
  const door = el.querySelector('.rf-door');
  door.classList.toggle('active', shape === 'door');
  door.title = shape === 'door' ? t('Click the wall where the door goes. Click a door to remove it. Esc when done.')
                                : t('Add a door - then click a wall');
  el.style.display = 'flex';
  const box = el.getBoundingClientRect(), m = 8;
  const left = Math.max(m, Math.min(innerWidth - box.width - m, (l + r) / 2 - box.width / 2));
  let y = top - box.height - m;
  if (y < m) y = bottom + m;
  y = Math.max(m, Math.min(innerHeight - box.height - m, y));
  const st = _rpScreenToStyle(el, left, y);
  el.style.left = st.left + 'px';
  el.style.top = st.top + 'px';
}
