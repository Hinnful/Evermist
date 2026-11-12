'use strict';
// mcpSounds.js — Claude's sound tools: list the Sounds pane (built-in and the DM's own), add files, rename, move, group
// and delete. ⚠ NOTHING HERE PLAYS OR STOPS A SOUND. A rename changes the name shown, never the file; a delete goes to
// the Trash, and undo_last_change brings it back.

const _mcpSoundNoun = ['sound', 'list_sounds'];

async function _mcpSoundItems() {
  await soundboardRefreshOwn();
  return soundsList().map(x => ({ ...x, file: x.builtin ? null : x.key }));
}

function _mcpSoundGroup(name) {
  return mcpLibGroup(soundsGroups(), name);
}

// The layout put back as it was before a step, keeping whatever came or went meanwhile.
function _mcpSoundsBack(before) {
  return async () => { await soundboardRefreshOwn(); soundsCommit(libNormalize(before, soundsPresent())); };
}

async function _mcpListSounds(args) {
  const q = String(args.query || '').trim().toLocaleLowerCase();
  const all = await _mcpSoundItems();
  const rows = all.filter(x => !q || x.label.toLocaleLowerCase().includes(q));
  return _mcpOk({ total: rows.length, groups: soundsGroups().map(g => g.name),
    sounds: rows.slice(0, 300).map(x => ({ name: x.label, group: x.group, builtIn: x.builtin, file: x.file || undefined })) });
}

async function _mcpAddSounds(args) {
  const before = new Set(soundsPresent());
  let res;
  try { res = await window.electronAPI.copyOwnSounds([String(args.path || '')]); } catch (err) { return _mcpNo('No sound was added: ' + ((err && err.message) || err)); }
  await soundboardRefreshOwn();
  const added = ((res && res.added) || []).filter(n => !before.has(n));
  const left = ((res && res.failed) || []).map(f => '"' + f.name + '" ' + (f.tooBig ? 'is over 10 MB; long tracks belong in the music library.' : f.message));
  if (!added.length) return _mcpNo('No sound was added.' + (left.length ? ' ' + left.join(' ') : ' Give the full path of an audio file.'));
  const shown = added.map(n => '"' + soundLabel(n) + '"').join(', ');
  return mcpDone('added ' + shown + ' to Sounds', async () => {
    for (const n of added) {
      const id = await sceneTrash.trashSound(n).catch(() => null);
      if (id) await sceneTrash.purgeTrack(id);
    }
    await soundboardRefreshOwn();
  }, 'Added ' + shown + ' to Sounds, at the top. Nothing was played.' + (left.length ? ' Not added: ' + left.join(' ') : ''));
}

async function _mcpRenameSound(args) {
  const found = mcpLibOne(await _mcpSoundItems(), args.name, ..._mcpSoundNoun);
  if (found.error) return _mcpNo(found.error);
  const to = libLabelClean(args.newName);
  if (!to) return _mcpNo('A sound needs a name.');
  const { key, label } = found.item, was = soundsOwnLabel(key);
  soundsRename(key, to);
  return mcpDone('renamed the sound "' + label + '" to "' + to + '"', async () => soundsRename(key, was),
    'Renamed the sound "' + label + '" to "' + to + '". Its file keeps its name.');
}

async function _mcpSetSoundGroup(args) {
  const many = mcpLibMany(await _mcpSoundItems(), args.sounds, ..._mcpSoundNoun);
  if (many.error) return _mcpNo(many.error);
  const group = args.group ? _mcpSoundGroup(args.group) : null;
  if (args.group && !group) return _mcpNo('No sound group is called "' + args.group + '". create_sound_group makes one.');
  const before = soundsLayoutNow(), keys = many.items.map(x => x.key);
  soundsCommit(libMoveTo(before, keys, group ? group.key : null, mcpLibIndex(args.position), soundsPresent()));
  const shown = many.items.map(x => '"' + x.label + '"').join(', ');
  const where = group ? 'into the sound group "' + group.name + '"' : 'into no group';
  return mcpDone('moved ' + shown + ' ' + where, _mcpSoundsBack(before), 'Moved ' + shown + ' ' + where + (args.position ? ' at position ' + args.position : '') + '.');
}

async function _mcpCreateSoundGroup(args) {
  const name = sanitizeGroupName(args.name);
  if (!name) return _mcpNo('A group needs a name.');
  if (_mcpSoundGroup(name)) return _mcpNo('There is already a sound group called "' + name + '".');
  const many = mcpLibMany(await _mcpSoundItems(), args.sounds, ..._mcpSoundNoun);
  if (many.error) return _mcpNo(many.error + ' A group is made with at least one sound in it.');
  const before = soundsLayoutNow(), gk = soundsNewGroupKey();
  const L = libClone(before);
  L.groups[gk] = { name, members: [] };
  L.groupOrder.unshift(gk);
  soundsCommit(libMove(L, many.items.map(x => x.key), gk, null));
  return mcpDone('made the sound group "' + name + '"', _mcpSoundsBack(before), 'Made the sound group "' + name + '" with ' + many.items.length + ' sound' + (many.items.length === 1 ? '' : 's') + ', first after the ungrouped sounds.');
}

async function _mcpRenameSoundGroup(args) {
  await soundboardRefreshOwn();
  const g = _mcpSoundGroup(args.name);
  if (!g) return _mcpNo('No sound group is called "' + (args.name || '') + '". list_sounds shows the groups.');
  const to = sanitizeGroupName(args.newName);
  if (!to) return _mcpNo('A group needs a name.');
  const other = _mcpSoundGroup(to);
  if (other && other.key !== g.key) return _mcpNo('There is already a sound group called "' + to + '". Pick another name.');
  const before = soundsLayoutNow();
  soundsCommit(libRenameGroup(before, g.key, to));
  return mcpDone('renamed the sound group "' + g.name + '" to "' + to + '"', _mcpSoundsBack(before), 'Renamed the sound group "' + g.name + '" to "' + to + '".');
}

async function _mcpDeleteSoundGroup(args) {
  await soundboardRefreshOwn();
  const g = _mcpSoundGroup(args.name);
  if (!g) return _mcpNo('No sound group is called "' + (args.name || '') + '". list_sounds shows the groups.');
  const before = soundsLayoutNow();
  soundsCommit(libUngroup(before, g.key));
  return mcpDone('ungrouped the sound group "' + g.name + '"', _mcpSoundsBack(before), 'The sound group "' + g.name + '" is gone; its sounds are in no group now. No sound was deleted.');
}

async function _mcpDeleteSound(args) {
  const found = mcpLibOne(await _mcpSoundItems(), args.name, ..._mcpSoundNoun);
  if (found.error) return _mcpNo(found.error);
  const { key, label, builtin } = found.item;
  if (args.confirmed !== true) return _mcpOk(mcpSoundsWouldDelete(label, builtin));
  const id = await soundsDelete(key);
  if (!id) return _mcpNo('Not deleted: "' + label + '" could not be moved to the Trash.');
  const { hash } = builtin ? {} : (await sceneTrash.trackHashes('sounds')).find(x => x.id === id) || {};
  return mcpDone('deleted the sound "' + label + '"', async () => {
    if (builtin) { if (!await sceneTrash.restoreBuiltin(id)) throw new Error('"' + label + '" is no longer in the Trash.'); return; }
    const back = syncIndex.isOn() ? await syncSounds.restoreHere(hash, () => sceneTrash.restoreTrack(id)) : await sceneTrash.restoreTrack(id);
    if (!back) throw new Error('"' + label + '" is no longer in the Trash.');
  }, 'Moved the sound "' + label + '" to the Trash in Settings, where the DM can restore it for 30 days.');
}

const MCP_SOUNDS_TOOLS = { list_sounds: _mcpListSounds, add_sounds: _mcpAddSounds, rename_sound: _mcpRenameSound, set_sound_group: _mcpSetSoundGroup,
  create_sound_group: _mcpCreateSoundGroup, rename_sound_group: _mcpRenameSoundGroup, delete_sound_group: _mcpDeleteSoundGroup, delete_sound: _mcpDeleteSound };
