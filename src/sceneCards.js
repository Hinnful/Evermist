'use strict';
// sceneCards.js — the scene library list: a card per scene, a section per group, the fields that
// size themselves, and the drag that reorders them. sceneManager.js owns the popup around it.

let smDragId = null;             // id of the card being dragged
let smDragEl = null;             // its DOM node (moved directly so the drag survives)

// ⚠ AN INPUT DOES NOT SHRINK TO ITS TEXT: it defaults to about twenty characters whatever it
// holds, so the text is measured and the width written back, while typing too.
// ⚠ THE MEASURING CONTEXT IS LAZY. This file is require()d by its own unit test, where there is
// no document, so a canvas at module scope breaks the test run.
let _smTextMeasure = null;
const SM_GROUP_FONT = '600 13px system-ui, -apple-system, sans-serif';
function smFitGroupName(el) {
  if (!_smTextMeasure) _smTextMeasure = document.createElement('canvas').getContext('2d');
  _smTextMeasure.font = SM_GROUP_FONT;
  const w = _smTextMeasure.measureText(el.value || '').width;
  el.style.width = Math.min(300, Math.max(48, Math.ceil(w) + 16)) + 'px';
}

// A textarea has no intrinsic height. ⚠ Measured after insertion: scrollHeight is 0 before.
function smSizeName(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function smSizeNameFields(root) {
  for (const el of root.querySelectorAll('.sm-name')) smSizeName(el);
  for (const el of root.querySelectorAll('input.sm-group-name')) smFitGroupName(el);
}

function buildGroupSection(sec) {
  const wrap = document.createElement('div');
  wrap.className = 'sm-group' + (isGroupShut(sec.name) ? ' shut' : '');
  wrap.dataset.group = sec.name;

  const head = document.createElement('div');
  head.className = 'sm-group-head';
  head.innerHTML =
    '<svg class="sm-group-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>' +
    (sec.ungrouped
      ? '<span class="sm-group-name">Ungrouped</span>'
      : '<input class="sm-group-name" spellcheck="false" title="Click to rename this group">') +
    '<span class="sm-group-n">' + sec.scenes.length + '</span>' +
    '<span class="sm-group-sp"></span>' +
    // The pencil is the affordance for the rename; it only puts the caret in that field.
    (sec.ungrouped ? '' :
      '<button class="sm-bare sm-group-ren" title="Rename this group">' + SM_PEN + '</button>' +
      '<button class="sm-bare danger sm-group-del" title="Delete this group">' + SM_TRASH + '</button>');

  // The chevron, count and empty space collapse. ⚠ The NAME does not — it is the rename field.
  head.onclick = e => {
    if (e.target.closest('.sm-group-name') || e.target.closest('.sm-bare')) return;
    // Ungrouped collapses too: it is a heading over a pile of cards like any other.
    toggleGroupShut(sec.name);
    renderSceneManager();
  };

  if (!sec.ungrouped) {
    const nameEl = head.querySelector('input.sm-group-name');
    nameEl.value = sec.name;
    let orig = sec.name;
    smFitGroupName(nameEl);
    nameEl.oninput = () => smFitGroupName(nameEl);
    nameEl.onfocus = () => { orig = sec.name; nameEl.select(); };
    nameEl.onkeydown = e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); nameEl.value = orig; nameEl.blur(); }
    };
    nameEl.onblur = () => {
      const next = sanitizeGroupName(nameEl.value);
      if (!next || next === sec.name) { nameEl.value = sec.name; return; }
      const apply = () => {
        const final = renameGroupInOrder(sec.name, next);
        smAssignGroup(sec.scenes.map(s => s.id), final);
      };
      // Typing a name another group wears MERGES the two, which cannot be undone. So it asks.
      if (!knownGroupNames().some(n => n !== sec.name && n === next)) { apply(); return; }
      confirmDialog({
        title: 'Merge these groups?',
        message: '“' + next + '” already exists. Both groups end up under that one heading, ' +
                 'and “' + sec.name + '” goes away. No map is deleted, and the merge has no undo.',
        confirmLabel: 'Merge',
        onConfirm: apply,
        onCancel: () => { nameEl.value = sec.name; },
      });
    };

    head.querySelector('.sm-group-ren').onclick = e => {
      e.stopPropagation();
      nameEl.focus(); nameEl.select();
    };
    head.querySelector('.sm-group-del').onclick = e => {
      e.stopPropagation();
      deleteGroup(sec);
    };
  }

  wrap.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'sm-grid';
  if (sec.scenes.length) {
    for (const s of sec.scenes) grid.appendChild(buildSceneCard(s));
  } else {
    const hole = document.createElement('div');
    hole.className = 'sm-group-empty';
    hole.textContent = 'Drag scenes here';
    grid.appendChild(hole);
  }
  wrap.appendChild(grid);

  // Dropping anywhere in the section files the dragged scene under this heading.
  wrap.addEventListener('dragover', e => {
    if (!smDragEl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    wrap.classList.add('drop');
    // An empty section holds no card to insert against, so the grid itself takes the node.
    if (!grid.contains(smDragEl) && !grid.querySelector('.sm-card')) grid.appendChild(smDragEl);
  });
  wrap.addEventListener('dragleave', e => {
    if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('drop');
  });
  wrap.addEventListener('drop', e => {
    e.preventDefault();
    wrap.classList.remove('drop');
    if (smDragEl && !grid.contains(smDragEl)) grid.appendChild(smDragEl);
  });

  return wrap;
}

// Deletes the heading, never the maps: everything under it falls back to Ungrouped.
function deleteGroup(sec) {
  const finish = () => {
    forgetGroup(sec.name);
    smAssignGroup(sec.scenes.map(s => s.id), '');
    renderSceneManager();
  };
  if (!sec.scenes.length) { finish(); return; }
  confirmDialog({
    title: 'Delete this group?',
    message: '“' + sec.name + '” holds ' + sec.scenes.length + ' scene' +
             (sec.scenes.length === 1 ? '' : 's') +
             '. The group goes away and they move to Ungrouped. No map is deleted.',
    confirmLabel: 'Delete group',
    danger: true,
    onConfirm: finish,
  });
}

function buildSceneCard(s) {
  const column     = panesActive ? paneColumnOf(s.id) : null;
  const isActive   = panesActive ? !!column : !!(currentScene && currentScene.id === s.id);
  const isSelected = smSelectedIds.has(s.id);
  // The badge says WHERE, because in two-map mode two cards wear it at once.
  const badge      = column ? (column === 'A' ? 'Left' : 'Right') : 'Live';

  const card = document.createElement('div');
  card.className = 'sm-card' + (isActive ? ' active' : '') + (isSelected ? ' selected' : '');
  card.dataset.id = s.id;
  // ⚠ NOT DRAGGABLE UNDER A SEARCH: an order read off a filtered list renumbers hidden scenes.
  card.draggable = !smSearch.trim();

  card.innerHTML =
    '<div class="sm-frame"><div class="sm-thumb">' +
      '<div class="sm-scrim"></div>' +
      (isActive ? '<span class="sm-badge"><i></i>' + badge + '</span>' : '') +
      '<div class="sm-cb' + (isSelected ? ' checked' : '') + '">' + (isSelected ? SM_CHECK : '') + '</div>' +
      '<div class="sm-botrow">' +
        '<textarea class="sm-name" rows="1" spellcheck="false"></textarea>' +
        '<button class="sm-trash" title="Delete scene">' + SM_TRASH + '</button>' +
      '</div>' +
    '</div></div>';

  const thumbURL = thumbURLs.get(s.id);
  if (thumbURL) card.querySelector('.sm-thumb').style.backgroundImage = 'url("' + thumbURL + '")';

  const nameEl = card.querySelector('.sm-name');
  nameEl.value = s.name;

  // checkbox → toggle selection
  card.querySelector('.sm-cb').onclick = e => { e.stopPropagation(); toggleSelect(s.id); };

  // trash → delete with undo
  const trash = card.querySelector('.sm-trash');
  trash.onmousedown = e => e.stopPropagation();
  trash.onclick = e => { e.stopPropagation(); deleteScenesWithUndo([s.id]); };

  // inline rename — clicking the name edits it (no rename button)
  let orig = s.name;
  nameEl.onmousedown = e => e.stopPropagation();
  nameEl.onclick     = e => e.stopPropagation();
  nameEl.onfocus     = () => { orig = s.name; nameEl.select(); };
  nameEl.oninput     = () => { s.name = nameEl.value; smSizeName(nameEl); };
  nameEl.onkeydown   = e => {
    e.stopPropagation();
    // Enter commits rather than inserting the newline a textarea would otherwise take.
    if (e.key === 'Enter')  { e.preventDefault(); nameEl.blur(); }
    else if (e.key === 'Escape') { s.name = orig; nameEl.value = orig; nameEl.blur(); }
  };
  // ⚠ RESIZE THE FIELD HERE, AND NEVER RE-RENDER THE LIST ON A BLUR. The blur comes from the
  // mousedown of the click that follows, so rebuilding #sm-list detaches the node it landed on
  // and no click event ever fires.
  nameEl.onblur = () => { commitSceneName(s, nameEl); smSizeName(nameEl); };

  // card click → select (in selection mode) or switch scene
  card.onclick = e => {
    if (e.target.closest('.sm-name') || e.target.closest('.sm-trash') || e.target.closest('.sm-cb')) return;
    if (smSelectedIds.size > 0) { toggleSelect(s.id); return; }
    if (panesActive) { loadSceneIntoSelectedPane(s.id); return; }
    if (!isActive) switchScene(s.id).catch(err => console.error('switchScene failed:', err));
  };

  // drag to reorder, and to refile (never starts from the name field)
  card.ondragstart = e => {
    if (e.target && e.target.tagName === 'TEXTAREA') { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'move';
    smDragId = s.id; smDragEl = card;
    card.classList.add('dragging');
  };
  card.ondragover = e => {
    e.preventDefault();
    if (!smDragEl || smDragId === s.id) return;
    // A grid, so the insert side is HORIZONTAL: a vertical test belongs to a single column.
    const r = card.getBoundingClientRect();
    const before = (e.clientX - r.left) < r.width / 2;
    card.parentNode.insertBefore(smDragEl, before ? card : card.nextSibling);
  };
  card.ondragend = () => {
    if (smDragEl) smDragEl.classList.remove('dragging');
    document.querySelectorAll('.sm-group.drop').forEach(g => g.classList.remove('drop'));
    commitDragOrder();
    smDragId = null; smDragEl = null;
  };

  return card;
}

function toggleSelect(id) {
  if (smSelectedIds.has(id)) smSelectedIds.delete(id);
  else smSelectedIds.add(id);
  renderSceneManager();
}

function commitSceneName(s, input) {
  const v = (input.value || '').replace(/\s+/g, ' ').trim() || 'Untitled';
  s.name = v; input.value = v;
  if (currentScene && currentScene.id === s.id) currentScene.name = v;
  // ⚠ updateScene, never load-then-save: doAutoSave() fits between the two transactions.
  sceneStore.updateScene(s.id, sc => { sc.name = v; }).catch(console.error);
  updateTriggerName();
}

// Reads BOTH facts back out of the DOM at once: a card's section is its group, and the order
// across sections is the sort order. Splitting them needs a drop target the browser withholds.
function commitDragOrder() {
  const list = document.getElementById('sm-list');
  if (!list) return;
  const order = [];
  const groupOf = {};
  for (const sec of list.querySelectorAll('.sm-group')) {
    const g = sanitizeGroupName(sec.dataset.group);
    for (const el of sec.querySelectorAll('.sm-card')) { order.push(el.dataset.id); groupOf[el.dataset.id] = g; }
  }
  // ⚠ REFUSE A PARTIAL VIEW, NEVER RENUMBER FROM ONE. order.indexOf answers -1 for a scene the
  // DOM does not hold, which sorts every hidden scene to the FRONT and writes that to the store.
  // A search is exactly that case; cards are undraggable while one is active, and this backs it up.
  if (order.length !== allScenes.length) return;

  allScenes.sort((a, b) => order.indexOf(String(a.id)) - order.indexOf(String(b.id)));
  allScenes.forEach((s, i) => {
    s.sortOrder = i;
    if (Object.prototype.hasOwnProperty.call(groupOf, s.id)) s.group = groupOf[s.id];
  });
  persistSceneOrder();
  renderSceneManager();
}

function persistSceneOrder() {
  for (const s of allScenes) {
    const g = sanitizeGroupName(s.group);
    // The IN-MEMORY record moves too, or the next wholesale autosave reverts the sortOrder.
    if (currentScene && currentScene.id === s.id) { currentScene.sortOrder = s.sortOrder; currentScene.group = g; }
    // One transaction per scene, and no write at all where the record is already right.
    sceneStore.updateScene(s.id, sc => {
      if (sc.sortOrder === s.sortOrder && sanitizeGroupName(sc.group) === g) return false;
      sc.sortOrder = s.sortOrder;
      sc.group = g;
    }).catch(console.error);
  }
}
