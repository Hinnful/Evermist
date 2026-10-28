'use strict';
// mcpFights.js — Claude's fight tools: create, read, edit and delete a fight. The fight the DM has open is the
// one at the table, so it is never edited or deleted from here. Each change records how to put it back.

function _mcpFightsShown() { cbSave(); cbRender(); cbFightsTitle(); }

// One fight by name, or the reason there is not exactly one.
function _mcpFight(name) {
  const q = String(name || '').trim().toLowerCase();
  const hits = cbState.fights.filter(f => String(f.name || '').trim().toLowerCase() === q);
  if (hits.length === 1) return { fight: hits[0] };
  if (!hits.length) return { error: 'No fight is called "' + (name || '') + '". list_campaign shows the fights.' };
  return { error: 'More than one fight is called "' + name + '". Rename one in Evermist first.' };
}

const _mcpMissing = missing => missing.map(x => x.name + (x.suggest && x.suggest.length ? ' (the bestiary has: ' + x.suggest.join(', ') + ')' : ''));

function _mcpOpenRefuse(fight, what) {
  return fight.id === cbState.openId ? _mcpNo('Not done: "' + fight.name + '" is the fight open at the table, and ' + what + ' would change it under the DM. Ask the DM to open another fight first.') : null;
}

function _mcpCreateFight(args) {
  const name = String(args.name || '').trim() || 'New fight';
  const built = mcpFightRows(cbState.blocks, args.monsters, cbState.nextId);
  const left = built.missing.length ? ' Left out, not in the bestiary: ' + _mcpMissing(built.missing).join('; ') + '.' : '';
  if (!built.rows.length) return _mcpNo('No fight was created: none of the monsters is in the bestiary.' + left);
  const was = cbState.nextId, id = combatFightId();
  cbState.nextId = built.nextId;
  cbState.fights.push({ id, name, rows: built.rows });
  _mcpFightsShown();
  return mcpDone('created the fight "' + name + '"', async () => {
    cbState.fights = cbState.fights.filter(f => f.id !== id);
    cbState.nextId = was;
    _mcpFightsShown();
  }, 'Created the fight "' + name + '" with ' + built.rows.length + ' rows.' + left);
}

function _mcpReadFight(args) {
  const found = _mcpFight(args.name);
  if (found.error) return _mcpNo(found.error);
  const f = found.fight;
  return _mcpOk({ name: f.name, openAtTheTable: f.id === cbState.openId,
    monsters: combatFightRows(cbState, f).map(r => ({ name: r.name, side: r.side || 'enemy', ac: r.ac || null, hp: r.hp || null })) });
}

function _mcpEditFight(args) {
  const found = _mcpFight(args.name);
  if (found.error) return _mcpNo(found.error);
  const f = found.fight;
  const open = f.id === cbState.openId;
  if (open) {
    const why = mcpOpenFightRefusal(args, cbState.rows) || mcpRowsRefusal(args);
    if (why) return _mcpNo('Not done: "' + f.name + '" is the fight open at the table, and ' + why + ' would change it under the DM. Only adding monsters and raising a count are allowed there. Ask the DM to open another fight first.');
  }
  const newName = args.newName === undefined ? null : String(args.newName).trim();
  if (newName === '') return _mcpNo('A fight needs a name.');
  const edit = mcpEditRows(cbState.blocks, open ? cbState.rows : (f.rows || []), args, cbState.nextId);
  if (open) return _mcpEditOpen(f, edit, newName);
  const details = mcpRowEdits(edit.rows, args.rows);
  edit.rows = details.rows;
  edit.notes.push(...details.errors);
  const changed = edit.changed || details.changed || (newName && newName !== f.name);
  if (!changed) return _mcpNo('Nothing changed.' + (edit.notes.length ? ' ' + edit.notes.join(' ') : ''));
  const was = { name: f.name, rows: f.rows || [], nextId: cbState.nextId };
  if (newName) f.name = newName;
  f.rows = edit.rows;
  cbState.nextId = edit.nextId;
  _mcpFightsShown();
  const notes = [...edit.notes, ...(edit.missing.length ? ['Left out, not in the bestiary: ' + _mcpMissing(edit.missing).join('; ') + '.'] : [])];
  return mcpDone('edited the fight "' + was.name + '"', async () => {
    Object.assign(f, { name: was.name, rows: was.rows });
    cbState.nextId = Math.max(cbState.nextId, was.nextId);
    _mcpFightsShown();
  }, 'Edited the fight "' + (newName || was.name) + '": now ' + edit.rows.length + ' rows.' + (notes.length ? ' ' + notes.join(' ') : ''));
}

// Additions to the open fight go into the table's own rows in place; undo takes those rows out again.
function _mcpEditOpen(f, edit, newName) {
  if (!edit.changed && !newName) return _mcpNo('Nothing changed.' + (edit.notes.length ? ' ' + edit.notes.join(' ') : ''));
  const have = new Map(cbState.rows.map(r => [r.id, r]));
  const added = edit.rows.filter(r => !have.has(r.id)).map(r => r.id);
  cbState.rows.splice(0, cbState.rows.length, ...edit.rows.map(r => have.get(r.id) || r));
  cbState.nextId = edit.nextId;
  _mcpFightsShown();
  const notes = [...edit.notes, ...(edit.missing.length ? ['Left out, not in the bestiary: ' + _mcpMissing(edit.missing).join('; ') + '.'] : [])];
  return mcpDone('added ' + added.length + ' row(s) to the open fight "' + f.name + '"', async () => {
    const gone = new Set(added), rows = combatFightRows(cbState, f);
    for (let i = rows.length - 1; i >= 0; i--) if (gone.has(rows[i].id)) rows.splice(i, 1);
    _mcpFightsShown();
  }, 'Added ' + added.length + ' row(s) to "' + f.name + '", the fight open at the table: now ' + edit.rows.length + ' rows.' + (notes.length ? ' ' + notes.join(' ') : ''));
}

function _mcpDuplicateFight(args) {
  const found = _mcpFight(args.name);
  if (found.error) return _mcpNo(found.error);
  const newName = args.newName === undefined ? null : String(args.newName).trim();
  if (newName === '') return _mcpNo('A fight needs a name.');
  const was = cbState.nextId, before = new Set(cbState.fights.map(f => f.id));
  combatDuplicateFight(cbState, found.fight.id, combatFightId);
  const copy = cbState.fights.find(f => !before.has(f.id));
  if (newName) copy.name = newName;
  _mcpFightsShown();
  return mcpDone('duplicated the fight "' + found.fight.name + '"', async () => {
    cbState.fights = cbState.fights.filter(f => f.id !== copy.id);
    cbState.nextId = Math.max(was, cbState.nextId - copy.rows.length);
    _mcpFightsShown();
  }, 'Duplicated the fight "' + found.fight.name + '" as "' + copy.name + '" with ' + copy.rows.length + ' rows.');
}

function _mcpDeleteFight(args) {
  const found = _mcpFight(args.name);
  if (found.error) return _mcpNo(found.error);
  const f = found.fight;
  const refuse = _mcpOpenRefuse(f, 'deleting it');
  if (refuse) return refuse;
  if (args.confirmed !== true) return _mcpOk(mcpWouldDelete('fight', { name: f.name, rows: (f.rows || []).length }));
  const index = cbState.fights.indexOf(f), kept = { ...f, rows: f.rows || [] };
  combatDeleteFight(cbState, f.id, combatFightId);
  _mcpFightsShown();
  return mcpDone('deleted the fight "' + f.name + '"', async () => {
    cbState.fights.splice(Math.min(index, cbState.fights.length), 0, kept);
    _mcpFightsShown();
  }, 'Deleted the fight "' + f.name + '" with its ' + kept.rows.length + ' rows.');
}

function _mcpBestiary(args) {
  const hits = combatSearchBlocks(cbState.blocks, args.query || '');
  return _mcpOk({ total: hits.length, monsters: hits.slice(0, 60).map(b => ({ name: b.name, cr: b.cr || null, source: b.source || null })) });
}

const MCP_FIGHTS_TOOLS = { create_fight: _mcpCreateFight, read_fight: _mcpReadFight, edit_fight: _mcpEditFight,
  duplicate_fight: _mcpDuplicateFight, delete_fight: _mcpDeleteFight, list_bestiary: _mcpBestiary };
