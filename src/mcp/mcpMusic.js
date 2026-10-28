'use strict';
// mcpMusic.js — Claude's music library tools: list, add, download and delete tracks, and keep groups.
// ⚠ NOTHING HERE PLAYS, PAUSES OR CHANGES THE VOLUME. Playing is play, and a track playing now is never deleted.

let _mcpMusicJob = null;   // the download Claude started: { entries, ids, done, pct, current, cancelled }
let _mcpMusicListening = false;

// The library as the app lists it, read fresh off the folder.
async function _mcpMusicTracks() {
  await _muRefreshTracks();
  return _muTracks.map(t => ({ name: t.name, display: displayName(t.name), group: musicGroupOf(t.name), secs: _muDurations[t.name] || 0 }));
}

function _mcpMusicGroups() {
  return [...new Set([...musicGroupNames(), ..._muTracks.map(t => musicGroupOf(t.name)).filter(Boolean)])];
}

// Tracks taken out of the folder for good, minus the one playing now. Used by undo of an add.
async function _mcpMusicDrop(names) {
  for (const name of names) {
    if (name === _muPlaying) continue;
    try { await window.electronAPI.deleteMusicFile(name); } catch (_) { continue; }
    delete _muDurations[name];
    forgetMusicTrack(name);
  }
  await _muRefreshTracks();
}

async function _mcpListMusic(args) {
  const all = await _mcpMusicTracks();
  const rows = filterTracks(all, args.query);
  return _mcpOk({ total: rows.length, groups: _mcpMusicGroups(), tracks: rows.slice(0, 200).map(t => ({ name: t.display, group: t.group || null, length: t.secs ? formatDuration(t.secs) : null })) });
}

async function _mcpAddMusic(args) {
  const before = new Set(_muTracks.map(t => t.name));
  const res = await window.electronAPI.copyMusicFiles([String(args.path || '')]);
  await _muRefreshTracks();
  const added = ((res && res.added) || []).filter(n => !before.has(n));
  const left = ((res && res.failed) || []).map(f => '"' + f.name + '" ' + f.message);
  if (!added.length) return _mcpNo('No track was added.' + (left.length ? ' ' + left.join(' ') : ' Give the path of an audio file or a folder of them.'));
  const shown = added.map(n => '"' + displayName(n) + '"');
  return mcpDone('added ' + shown.join(', ') + ' to the music library', () => _mcpMusicDrop(added),
    'Added ' + shown.join(', ') + ' to the music library. Nothing was played.' + (left.length ? ' Not added: ' + left.join(' ') : ''));
}

function _mcpMusicProgress() {
  const job = _mcpMusicJob;
  if (job) setMusicDownloadProgress((job.done + job.pct / 100) / job.entries.length);
}

// The tracks that came from these video ids, by the id each file name carries.
function _mcpMusicDropIds(ids) {
  return _mcpMusicDrop(_muTracks.filter(t => ids.has(videoIdFromFileName(t.name))).map(t => t.name));
}

async function _mcpMusicRun(job) {
  for (const e of job.entries) {
    if (job.cancelled) break;
    job.current = e.id;
    job.pct = 0;
    _mcpMusicProgress();
    try { await window.electronAPI.musicDownload(e.id, e.url); } catch (_) {}
    job.done++;
    job.pct = 0;
    _muRefreshTracks();
  }
  _mcpMusicJob = null;
  setMusicDownloadProgress(null);
  await _muRefreshTracks();
  if (job.cancelled) await _mcpMusicDropIds(job.ids);
}

async function _mcpAddFromYoutube(args) {
  if (_mcpMusicJob || _muBusy) return _mcpNo('A download is already running. list_music shows the tracks as they arrive; try again when it is done.');
  const parsed = parseMusicUrl(args.url);
  if (!parsed.mode) return _mcpNo('That is not a link this can read. Give a YouTube video or playlist address.');
  let found;
  try { found = await window.electronAPI.musicLookup(parsed.mode, parsed.mode === 'playlist' ? parsed.playlistId : parsed.videoId, parsed.url); } catch (err) { return _mcpNo('Evermist could not read that link: ' + ((err && err.message) || err)); }
  await _muRefreshTracks();
  const have = _muHaveIds();
  const fresh = (found.entries || []).filter(e => !have[e.id]);
  if (!fresh.length) return _mcpNo('Every track at that link is already in the music library.');
  const pick = mcpMusicPick(fresh, args.pick);
  if (pick.error) return _mcpNo(pick.error);
  const job = { entries: pick.entries, ids: new Set(pick.entries.map(e => e.id)), done: 0, pct: 0, current: null, cancelled: false };
  // Registered after the Music pane's own listener, so this bar is the last write on every tick.
  if (!_mcpMusicListening && window.electronAPI.onMusicProgress) {
    _mcpMusicListening = true;
    window.electronAPI.onMusicProgress(d => {
      if (!_mcpMusicJob || !d || d.id !== _mcpMusicJob.current) return;
      _mcpMusicJob.pct = d.percent;
      _mcpMusicProgress();
    });
  }
  _mcpMusicJob = job;
  _mcpMusicRun(job);
  const n = job.entries.length;
  return mcpDone('started downloading ' + n + ' track' + (n === 1 ? '' : 's') + ' to the music library',
    async () => { job.cancelled = true; if (!_mcpMusicJob) await _mcpMusicDropIds(job.ids); },
    n + ' track' + (n === 1 ? ' is' : 's are') + ' on the way, one after another. The Music pane shows the progress; list_music shows each track as it arrives. Nothing is played.');
}

async function _mcpDeleteMusic(args) {
  const found = mcpMusicOne(await _mcpMusicTracks(), args.name);
  if (found.error) return _mcpNo(found.error);
  const { name, display, group } = found.track;
  if (name === _muPlaying) return _mcpNo('Not deleted: "' + display + '" is playing now. Ask the DM to play another track first.');
  if (args.confirmed !== true) return _mcpOk(mcpMusicWouldDelete(display));
  const token = await window.electronAPI.stashMusicFile(name);
  forgetMusicTrack(name);
  await _muRefreshTracks();
  return mcpDone('deleted the track "' + display + '"', async () => {
    const back = await window.electronAPI.unstashMusicFile(token, name);
    await _muRefreshTracks();
    if (group) setMusicGroup([back], group);
  }, 'Deleted the track "' + display + '". The file is kept until Evermist closes, so undo_last_change brings it back.');
}

async function _mcpCreateMusicGroup(args) {
  const name = sanitizeGroupName(args.name);
  if (!name) return _mcpNo('A group needs a name.');
  await _mcpMusicTracks();
  if (mcpMusicGroupName(_mcpMusicGroups(), name)) return _mcpNo('There is already a music group called "' + name + '".');
  putMusicGroup(name, Infinity, []);
  return mcpDone('created the music group "' + name + '"', async () => {
    if (!_muTracks.some(t => musicGroupOf(t.name) === name)) deleteMusicGroup(name);
  }, 'Created the music group "' + name + '". It is empty; set_music_group puts tracks in it.');
}

async function _mcpRenameMusicGroup(args) {
  await _mcpMusicTracks();
  const from = mcpMusicGroupName(_mcpMusicGroups(), args.name);
  if (!from) return _mcpNo('No music group is called "' + (args.name || '') + '". list_music shows the groups.');
  const to = sanitizeGroupName(args.newName);
  if (!to) return _mcpNo('A group needs a name.');
  if (to !== from && mcpMusicGroupName(_mcpMusicGroups(), to)) return _mcpNo('There is already a music group called "' + to + '". Pick another name.');
  renameMusicGroup(from, to);
  return mcpDone('renamed the music group "' + from + '" to "' + to + '"', async () => {
    if (!mcpMusicGroupName(_mcpMusicGroups(), from)) renameMusicGroup(to, from);
  }, 'Renamed the music group "' + from + '" to "' + to + '".');
}

async function _mcpDeleteMusicGroup(args) {
  const tracks = await _mcpMusicTracks();
  const name = mcpMusicGroupName(_mcpMusicGroups(), args.name);
  if (!name) return _mcpNo('No music group is called "' + (args.name || '') + '". list_music shows the groups.');
  const members = tracks.filter(t => t.group === name).map(t => t.name);
  const index = musicGroupNames().indexOf(name);
  deleteMusicGroup(name);
  return mcpDone('deleted the music group "' + name + '"', async () => {
    await _muRefreshTracks();
    putMusicGroup(name, index < 0 ? Infinity : index, members.filter(n => _muTracks.some(t => t.name === n)));
  }, 'Deleted the music group "' + name + '". Its ' + members.length + ' track' + (members.length === 1 ? '' : 's') + ' are in no group now; none was deleted.');
}

async function _mcpSetMusicGroup(args) {
  const tracks = await _mcpMusicTracks();
  const asked = Array.isArray(args.tracks) ? args.tracks : [];
  if (!asked.length) return _mcpNo('Name at least one track in tracks.');
  const group = args.group ? mcpMusicGroupName(_mcpMusicGroups(), args.group) : '';
  if (args.group && !group) return _mcpNo('No music group is called "' + args.group + '". Use create_music_group to make one.');
  const hits = asked.map(n => mcpMusicOne(tracks, n));
  const bad = hits.filter(h => h.error).map(h => h.error);
  if (bad.length) return _mcpNo('Nothing was changed. ' + bad.join(' '));
  const picked = [...new Map(hits.map(h => [h.track.name, h.track])).values()];
  setMusicGroup(picked.map(t => t.name), group);
  const was = picked.map(t => [t.name, t.group]);
  const shown = picked.map(t => '"' + t.display + '"').join(', ');
  return mcpDone('moved ' + shown + (group ? ' into the music group "' + group + '"' : ' out of their music group'), async () => {
    const here = was.filter(([n]) => _muTracks.some(t => t.name === n));
    for (const g of new Set(here.map(([, p]) => p))) setMusicGroup(here.filter(([, p]) => p === g).map(([n]) => n), g);
  }, 'Moved ' + shown + (group ? ' into the music group "' + group + '".' : ' out of their group.'));
}

const MCP_MUSIC_TOOLS = { list_music: _mcpListMusic, add_music: _mcpAddMusic, add_music_from_youtube: _mcpAddFromYoutube, delete_music: _mcpDeleteMusic,
  create_music_group: _mcpCreateMusicGroup, rename_music_group: _mcpRenameMusicGroup, delete_music_group: _mcpDeleteMusicGroup, set_music_group: _mcpSetMusicGroup };
