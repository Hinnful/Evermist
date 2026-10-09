'use strict';
// worldMapColumns.js — the world map while two maps are on: a Left and a Right chip at the top, the active
// one blue, each naming the scene its column holds. A double-click on a scene fills the active column and the map
// closes on the columns. A scene a column holds wears an L or R on its print (worldMap.js).

let _wmCols = null;              // the chips' bar, on the layer

function worldMapColumnsInit() {
  _wmCols = document.createElement('div');
  _wmCols.id = 'wm-cols';
  _wmCols.hidden = true;
  for (const id of PANE_IDS) {
    const b = document.createElement('button');
    b.dataset.pane = id;
    b.innerHTML = '<span class="wm-col-side"></span><span class="wm-col-nm"></span>';
    b.addEventListener('mousedown', e => e.stopPropagation());
    b.addEventListener('click', () => { selectPane(id); worldMapColumnsSync(); });
    _wmCols.appendChild(b);
  }
  _wm.appendChild(_wmCols);
}

const _wmColSide = id => t(id === 'A' ? 'Left' : 'Right');

// The letter a scene's column wears, or '' for a scene no column holds.
function worldMapColumnMark(sceneId) {
  const id = panesActive ? paneColumnOf(sceneId) : null;
  return id ? t(id === 'A' ? 'L' : 'R') : '';
}

function worldMapColumnsSync() {
  if (!_wmCols) return;
  _wmCols.hidden = !panesActive;
  if (!panesActive) return;
  for (const b of _wmCols.children) {
    const id = b.dataset.pane, s = allScenes.find(x => x.id === panes[id].sceneId);
    b.classList.toggle('active', id === panesSelected);
    b.firstChild.textContent = _wmColSide(id);
    b.lastChild.textContent = s ? s.name : t('Empty');
    b.classList.toggle('none', !s);
  }
}

// A double-click on a scene with two maps on: it fills the active column, and the map closes on the columns.
function worldMapColumnFill(sceneId) {
  if (!loadSceneIntoSelectedPane(sceneId)) return;
  worldMapHide();
}
