'use strict';
// combatSort.js — the fight table's Sort button, and the Init column title that does the same: the button is solid
// blue while the open fight's live rows are out of initiative order, grey once a sort would change nothing. Rows in the Defeated line keep their places and never count.
// cbRender and the initiative field ask it to look again.

function initCombatSort() {
  const b = document.createElement('button');
  b.className = 'sm-hbtn ic';
  b.id = 'cb-sort';
  b.innerHTML = uiIcon('sort');
  document.querySelector('#cb-fight .cb-head').insertBefore(b, document.getElementById('cb-close'));
  b.addEventListener('click', cbSortRows);
  // A press on the column's grab strip is a width drag, and the click that ends it is not a sort.
  const title = document.querySelector('#cb-fight .cb-initsort');
  let fromStrip = false;
  title.addEventListener('mousedown', e => { fromStrip = !!e.target.closest('.cb-colsize'); });
  title.addEventListener('click', e => { if (!fromStrip && !e.target.closest('.cb-colsize')) cbSortRows(); });
  cbSortRefresh();
}

// ⚠ aria-disabled, not disabled: a disabled button gets no hover, so its tooltip saying why never shows.
function cbSortRefresh() {
  const b = document.getElementById('cb-sort'), sorted = combatLiveSorted(cbState.rows);
  b.classList.toggle('primary', !sorted);
  b.setAttribute('aria-disabled', String(sorted));
  b.title = t(sorted ? 'The rows are already in initiative order' : 'Sort by initiative');
}

// The rows glide to their new places, so the DM sees what the sort did.
function cbSortRows() {
  if (combatLiveSorted(cbState.rows)) return;
  motionRows(document.getElementById('cb-list'), '.cb-row', el => el.dataset.id, () => {
    cbState.rows = combatSortLive(cbState.rows);
    cbSave();
    cbRender();
  });
}
