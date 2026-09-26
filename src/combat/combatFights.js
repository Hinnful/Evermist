// combatFights.js — the fight picker on the fight table's title: the list of fights, and new,
// rename, duplicate, delete and switch. The list itself is plain data in fightPlan.js.

let _cfMenu = null;

function _cfOpen() { return cbState.fights.find(f => f.id === cbState.openId); }

function _cfCount(f) {
  const rows = combatFightRows(cbState, f), en = rows.filter(r => r.side === 'enemy').length, al = rows.length - en;
  if (!rows.length) return 'empty';
  return [en ? en + (en === 1 ? ' enemy' : ' enemies') : '', al ? al + (al === 1 ? ' ally' : ' allies') : ''].filter(Boolean).join(' · ');
}

function cbFightsTitle() {
  const t = document.querySelector('#cb-fightpick .nm');
  if (t) t.textContent = _cfOpen().name;
  if (_cfMenu) _cfDraw();
}

function _cfSwitch(id) {
  if (cbStatRowId()) cbCloseStat();
  cbCloseMenu();
  combatOpenFight(cbState, id);
  cbSave();
  cbRender();
  cbFightsTitle();
}

function _cfDraw() {
  _cfMenu.innerHTML = `<div class="cf-list">${cbState.fights.map(f => `
    <div class="cf-item${f.id === cbState.openId ? ' on' : ''}" data-id="${_cbEsc(f.id)}">
      <span class="nm">${_cbEsc(f.name)}</span><span class="meta">${_cfCount(f)}</span>
    </div>`).join('')}</div>
    <button class="cf-new" data-new>+ New fight</button>`;
}

function cbCloseFights() {
  if (_cfMenu) _cfMenu.remove();
  _cfMenu = null;
  const b = document.getElementById('cb-fightpick');
  if (b) b.classList.remove('open');
  document.removeEventListener('mousedown', _cfOutside, true);
  document.removeEventListener('keydown', _cfKey, true);
}
function _cfOutside(e) {
  if (!e.target.closest('#cf-menu, #cb-fightpick, #cb-menu')) cbCloseFights();
}
function _cfKey(e) {
  if (e.key !== 'Escape' || (_cfMenu && _cfMenu.querySelector('.editing')) || document.getElementById('cb-menu')) return;
  e.stopPropagation();
  cbCloseFights();
}

// Double-click renames, the way Figma renames a layer: Enter keeps it, Escape drops it.
function _cfRename(el, f) {
  el.contentEditable = 'plaintext-only';
  el.classList.add('editing');
  el.focus();
  getSelection().selectAllChildren(el);
  const done = keep => {
    el.removeEventListener('keydown', key);
    el.removeEventListener('blur', blur);
    el.contentEditable = 'false';
    el.classList.remove('editing');
    if (keep) { combatRenameFight(cbState, f.id, el.textContent); cbSave(); }
    el.textContent = f.name;
    cbFightsTitle();
  };
  const key = e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); done(true); }
    if (e.key === 'Escape') { e.preventDefault(); done(false); }
  };
  const blur = () => done(true);
  el.addEventListener('keydown', key);
  el.addEventListener('blur', blur);
}

function _cfDelete(f) {
  cbCloseFights();
  const n = combatFightRows(cbState, f).length;
  confirmDialog({
    title: `Delete “${f.name}”?`,
    message: n === 1 ? 'Its one creature goes with it, with its HP and conditions.'
      : n ? `Its ${n} creatures go with it, with their HP and conditions.` : 'It is empty.',
    confirmLabel: 'Delete', danger: true,
    onConfirm: () => {
      if (f.id === cbState.openId && cbStatRowId()) cbCloseStat();
      combatDeleteFight(cbState, f.id, combatFightId);
      cbSave();
      cbRender();
      cbFightsTitle();
    },
  });
}

function _cfToggle() {
  if (_cfMenu) { cbCloseFights(); return; }
  const head = document.querySelector('#cb-fight .cb-head'), z = cbZoom(), r = head.getBoundingClientRect();
  _cfMenu = document.createElement('div');
  _cfMenu.id = 'cf-menu';
  document.body.appendChild(_cfMenu);
  _cfDraw();
  _cfMenu.style.left = (r.left / z + 6) + 'px';
  _cfMenu.style.top = (r.bottom / z + 2) + 'px';
  document.getElementById('cb-fightpick').classList.add('open');
  _cfMenu.addEventListener('mousedown', e => e.stopPropagation());
  _cfMenu.addEventListener('keydown', e => e.stopPropagation());
  _cfMenu.addEventListener('click', e => {
    if (e.target.closest('[data-new]')) {
      combatAddFight(cbState, combatFightId);
      cbSave();
      cbRender();
      cbFightsTitle();
      _cfRename(_cfMenu.querySelector(`[data-id="${cbState.openId}"] .nm`), _cfOpen());
      return;
    }
    const item = e.target.closest('.cf-item');
    if (!item || e.target.closest('.editing')) return;
    if (item.dataset.id !== cbState.openId) _cfSwitch(item.dataset.id);
    cbCloseFights();
  });
  _cfMenu.addEventListener('dblclick', e => {
    const item = e.target.closest('.cf-item');
    if (item) _cfRename(item.querySelector('.nm'), cbState.fights.find(f => f.id === item.dataset.id));
  });
  _cfMenu.addEventListener('contextmenu', e => {
    e.preventDefault();
    const item = e.target.closest('.cf-item'), f = item && cbState.fights.find(x => x.id === item.dataset.id);
    if (!f) return;
    cbMenu([
      { label: 'Rename', pick: () => _cfRename(item.querySelector('.nm'), f) },
      { label: 'Duplicate', pick: () => { combatDuplicateFight(cbState, f.id, combatFightId); cbSave(); _cfDraw(); } },
      { sep: true },
      { label: 'Delete', danger: true, pick: () => _cfDelete(f) },
    ], { left: e.clientX, top: e.clientY, bottom: e.clientY });
  });
  const menu = _cfMenu;
  setTimeout(() => {
    if (!menu.isConnected) return;
    document.addEventListener('mousedown', _cfOutside, true);
    document.addEventListener('keydown', _cfKey, true);
  });
}

function initCombatFights() {
  const b = document.createElement('button');
  b.id = 'cb-fightpick';
  b.title = 'Your fights';
  b.innerHTML = '<span class="nm"></span><span class="car">▾</span>';
  document.getElementById('cb-fightslot').replaceWith(b);
  b.addEventListener('click', _cfToggle);
  b.addEventListener('dblclick', e => { e.preventDefault(); cbCloseFights(); _cfRename(b.querySelector('.nm'), _cfOpen()); });
  cbFightsTitle();
}
