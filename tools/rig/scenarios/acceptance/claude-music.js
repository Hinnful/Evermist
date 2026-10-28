'use strict';

// claude-music.js — CLAUDE KEEPS THE MUSIC LIBRARY, AND NOTHING PLAYS.
//
// THE GOAL: Claude's music tools (src/mcp/mcpMusic.js and src/mcp/mcpMusicPlan.js: add_music, list_music, create_music_group, set_music_group,
// delete_music) add a track to the library, list it, group it and delete it the way the Music pane does, each call is
// one step undo_last_change takes back, a delete asks first and its undo brings the FILE back, and no track ever plays.
// Music is not a map, so the Player window has no part.
//
//   A. add_music copies an audio file into the library, and list_music lists it.
//   B. create_music_group and set_music_group put the track in a new group, and list_music shows the group.
//   C. delete_music without confirmed only says what would go; with confirmed the track leaves the library.
//   D. undo_last_change brings the deleted file back, in its group.
//   E. Undoing the rest takes the group and the added track away again, and nothing played at any point.
//
// ⚠ add_music_from_youtube IS NOT DRIVEN: it needs the network and a downloader. The tool is only reached by hand.
// ⚠ THE AUDIO FILE IS A TENTH OF A SECOND OF SILENCE, written as a WAV into the run's output folder, so nothing
// binary is committed and nothing can be heard.

const fs = require('fs');
const path = require('path');
const lib = require('../../lib');

function silentWav(file) {
  const rate = 8000, n = rate / 10, buf = Buffer.alloc(44 + n);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28);
  buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(n, 40);
  buf.fill(128, 44);
  fs.writeFileSync(file, buf);
}

module.exports = async function claudeMusic(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: 1200, h: 800 });
  const call = await lib.mcpClient(rig);
  rig.check(!!call, 'the app wrote no mcp.json with a port and a key into its profile');
  if (!call) return;
  const file = path.join(rig.outDir, 'rig-silence.wav');
  silentWav(file);

  const list = async () => {
    const r = await call('list_music', {});
    try { return JSON.parse(r.text); } catch { return { tracks: [], groups: [], error: r }; }
  };
  const mine = async () => (await list()).tracks.find(t => /rig-silence/i.test(t.name));

  // ── A ──
  // RED BY DESIGN: written against the feature, never re-proved
  const before = (await list()).tracks.length;
  const added = await call('add_music', { path: file });
  const track = await mine();
  rig.check(!added.isError && !!track && (await list()).tracks.length === before + 1,
            'A: add_music did not put the audio file in the library and list_music did not list it: ' + JSON.stringify({ added, track }));
  if (!track) return;

  // ── B ──
  // RED BY DESIGN: written against the feature, never re-proved
  const group = await call('create_music_group', { name: 'Rig Ambience' });
  const set = await call('set_music_group', { tracks: [track.name], group: 'Rig Ambience' });
  const grouped = await list();
  rig.check(!group.isError && !set.isError && grouped.groups.includes('Rig Ambience') && (await mine()).group === 'Rig Ambience',
            'B: the track did not land in the new group: ' + JSON.stringify({ group, set, groups: grouped.groups, track: await mine() }));

  // ── C ──
  // RED BY DESIGN: written against the feature, never re-proved
  const dry = await call('delete_music', { name: track.name });
  rig.check(!dry.isError && /Would delete the track/.test(dry.text) && !!(await mine()), 'C: delete_music without confirmed changed something or did not say what goes: ' + JSON.stringify(dry));
  const gone = await call('delete_music', { name: track.name, confirmed: true });
  rig.check(!gone.isError && !(await mine()), 'C: delete_music with confirmed left the track in the library: ' + JSON.stringify(gone));

  // ── D ──
  // RED BY DESIGN: written against the feature, never re-proved
  const undoneDelete = await call('undo_last_change');
  const back = await mine();
  rig.check(!undoneDelete.isError && !!back && back.group === 'Rig Ambience', 'D: undo_last_change did not bring the file back in its group: ' + JSON.stringify({ undoneDelete, back }));

  // ── E ──
  // RED BY DESIGN: written against the feature, never re-proved
  const undoneSet = await call('undo_last_change');
  const undoneGroup = await call('undo_last_change');
  const undoneAdd = await call('undo_last_change');
  const after = await list();
  rig.check(![undoneSet, undoneGroup, undoneAdd].some(r => r.isError) && after.tracks.length === before && !after.groups.includes('Rig Ambience'),
            'E: undoing the set, the group and the add did not leave the library as it was: ' + JSON.stringify({ undoneSet, undoneGroup, undoneAdd, after }));
  rig.check(await dm.evaluate('!_muPlaying'), 'E: a track was playing after Claude\'s music calls, and nothing of them plays');
};
