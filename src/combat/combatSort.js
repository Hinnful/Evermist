'use strict';
// combatSort.js — the fight table's Sort button: lit while the open fight's rows are out of initiative order, greyed
// once a sort would change nothing. cbRender and the initiative field ask it to look again.

function initCombatSort() {
  const b = document.createElement('button');
  b.className = 'sm-hbtn';
  b.id = 'cb-sort';
  b.innerHTML = uiIcon('sort') + '<span>Sort</span>';
  document.querySelector('#cb-fight .cb-head').insertBefore(b, document.getElementById('cb-add'));
  b.addEventListener('click', _cbSort);
  cbSortRefresh();
}

// ⚠ aria-disabled, not disabled: a disabled button gets no hover, so its tooltip saying why never shows.
function cbSortRefresh() {
  const b = document.getElementById('cb-sort'), sorted = combatIsSortedByInit(cbState.rows);
  b.classList.toggle('lit', !sorted);
  b.setAttribute('aria-disabled', String(sorted));
  b.title = t(sorted ? 'The rows are already in initiative order' : 'Sort by initiative');
}

// The rows that moved flash once, so the DM sees what the sort did.
function _cbSort() {
  if (combatIsSortedByInit(cbState.rows)) return;
  const before = cbState.rows.slice();
  cbState.rows = combatSortByInit(cbState.rows);
  cbSave();
  cbRender();
  cbState.rows.forEach((r, i) => {
    if (before[i] !== r) document.querySelector(`#cb-list .cb-row[data-id="${r.id}"]`).classList.add('moved');
  });
}
