'use strict';
// syncMusic.js — the music folder through sync: the tick's music part, which sync.js runs after every map, record and
// note; this computer's `music` record; its rows in Recently deleted, and the tracks it moves into and out of this
// computer's own (sceneTrash.js); and the hash a track gets as it lands. The DM's own sounds sync the same way as a
// second folder, `syncSounds`, with no groups. The rules are syncMusicPlan.js; files move in the main process
// (syncRemote.js, musicHashes.js). Volume stays per computer.

const SY_LOOSE_GRACE_MS = 15000;

// The other computers' records of this folder, each read again only when its hash moved. `cache`: machine -> { hash, rec }.
async function _syFolderRemotes(drive, key, cache, snap, machine) {
  const out = [];
  for (const r of snap.records) {
    if (r.key !== key || r.machine === machine || !(r.format <= SY_FORMAT)) continue;
    let c = cache.get(r.machine);
    if (!c || !r.hash || c.hash !== r.hash) {
      let text;
      try { text = await drive('getRecord', { fileId: r.fileId }); } catch (err) { if (err.code === 'notFound') continue; throw err; }
      const rec = syMuRecordParse(text, key);
      if (!rec) continue;
      c = { hash: r.hash, rec };
      cache.set(r.machine, c);
    }
    out.push({ machine: r.machine, rec: c.rec });
  }
  return out;
}

// The later groups edit, here or on another computer, becomes what the Music pane shows.
function _syMusicGroups(st, local, list, rems, machine) {
  const ls = musicGroupsSynced();
  if (!st.groups || ls.at > st.groups.at) st.groups = syMuGroupsFromLocal(ls, local, st.groups);
  st.groups = syMuGroupsPick([{ machine, groups: st.groups }].concat(rems.map(r => ({ machine: r.machine, groups: r.rec.groups }))));
  const want = syMuGroupsToLocal(st.groups, local, ls, list);
  if (esCanon(want.of) !== esCanon(ls.of) || esCanon(want.order) !== esCanon(ls.order) || want.at !== ls.at) musicGroupsAdopt(want);
}

// The Drive's files of this folder no computer lists, removed once unreferenced for the grace. `unrefSince`: file -> when
// first seen so.
async function _syFolderTidy(drive, files, unrefSince, rems, st, machine) {
  const loose = syMuLoose(files, rems.concat([{ machine, rec: { tracks: st.tracks } }]), st.gone);
  const seen = new Set(loose), now = Date.now();
  for (const n of Array.from(unrefSince.keys())) if (!seen.has(n)) unrefSince.delete(n);
  for (const n of loose) {
    if (!unrefSince.has(n)) { unrefSince.set(n, now); continue; }
    if (now - unrefSince.get(n) < SY_LOOSE_GRACE_MS) continue;
    await drive('remove', { fileId: files.find(f => f.name === n).id });
    unrefSince.delete(n);
  }
}

// `o`: key ('music' or 'sounds': the record, the Drive folder, the snapshot's list), groups (music only), busy(name),
// refresh() after the folder changed, and trash, this kind's calls into sceneTrash.js.
function _syncFolder(o) {
  const KEY = '$' + o.key;           // this computer's state of the folder, in `evermist-sync`'s `synced` store
  const remotes = new Map();         // machine -> { hash, rec }, the last record read
  const unrefSince = new Map();      // a Drive track file -> when it was first seen unreferenced
  let lock = Promise.resolve();
  let hashed = false;                // the start's hashing of the folder has finished

  async function _drive(op, arg) {
    const r = await window.electronAPI.syncDrive(op, { ...arg, kind: o.key });
    if (!r.ok) { const e = new Error(r.message); e.code = r.code; throw e; }
    return r.v;
  }
  const _fatal = err => err.code === 'offline' || err.code === 'quota' || err.code === 'auth';

  // One reader-writer of the state at a time: the tick's bookkeeping, a landed track, Restore and Empty now.
  function _locked(fn) {
    const run = lock.then(fn);
    lock = run.catch(() => {});
    return run;
  }
  const _load = async () => { const x = await syncIndex.raw.get('synced', KEY); return x && x.st ? x.st : syMuEmpty(); };
  const _save = st => syncIndex.raw.put('synced', { key: KEY, hash: '', st });

  // A computer with no music, no deletions and no groups sends nothing until it has some.
  async function _send(st, now) {
    const text = syMuRecordText(st, o.key), hash = await syncIndex.sha(text);
    const sent = (await syncIndex.raw.get('synced', o.key) || {}).hash;
    if (sent === hash) return;
    const g = st.groups || { of: {}, order: [], at: 0 };
    if (!sent && !Object.keys(st.tracks).length && !Object.keys(st.gone).length && !Object.keys(g.of).length && !g.order.length && !g.at) return;
    await _drive('putRecord', { key: o.key, text, props: { hash, format: SY_FORMAT, at: now, edited: now } });
    await syncIndex.raw.put('synced', { key: o.key, hash });
  }

  // The music part of one tick. `ctx`: machine, first, now, changes() (a count that moves when the library changes;
  // once it moves, the files left wait for the next tick, so a map edit waits behind one track at most). Answers how
  // many wait for the player.
  async function tick(snap, ctx) {
    if (!hashed) return { held: 0 };
    const now = ctx.now;
    const b = await _locked(async () => {
      const folder = await _drive('musicTracks', { hash: false });
      const st = syMuObserve(await _load(), folder.tracks, folder.stashed, now);
      const rems = await _syFolderRemotes(_drive, o.key, remotes, snap, ctx.machine);
      for (const r of rems) st.gone = syMuGoneMerge(st.gone, r.rec.gone);
      st.gone = syMuPurge(st.gone, syMuTrashDue(st.gone, now));
      const local = syMuLocal(folder.tracks);
      if (o.groups) o.groups(st, local, folder.tracks, rems, ctx.machine);
      const byHash = {};
      for (const h of Object.keys(local)) byHash[h] = local[h].name;
      o.layout(byHash);
      const busy = Object.keys(local).filter(h => o.busy(local[h].name));
      const plan = syMuPlan({ st, list: folder.tracks, remotes: rems, files: snap[o.key], first: ctx.first, busy, stashed: folder.stashed });
      // This computer's Recently deleted: a purge from any computer empties it, and a track it holds comes back from it
      // rather than the Drive.
      const held = await o.trash.held();
      const purged = new Set(syPurgedHeld(st.gone, held.map(x => x.hash)));
      for (const x of held) if (purged.has(x.hash)) await o.trash.purge(x.id);
      const back = syMuFromTrash(st.gone, local, held.filter(x => !purged.has(x.hash)).map(x => x.hash), plan.download.map(d => d.hash));
      for (const h of back) {
        const name = await o.trash.restore(held.find(x => x.hash === h).id);
        if (name) st.tracks[h] = { name, size: 0, at: now };
      }
      plan.download = plan.download.filter(d => !back.includes(d.hash));
      let removed = false;
      for (const r of plan.remove) {
        // A track picked while this tick ran waits too.
        if (o.busy(r.name)) { plan.held++; continue; }
        // Into this computer's Recently deleted, its time the deletion record's so both computers count the same days.
        const id = await o.trash.put(r.name, st.gone[r.hash].at, r.hash,
          token => _drive('removeMusic', { name: r.name, hash: r.hash, token }).then(ok => ok && r.hash));
        if (id) { delete st.tracks[r.hash]; removed = true; }
      }
      if (removed) o.refresh();
      for (const fileId of plan.purge) await _drive('remove', { fileId });
      await _save(st);
      syncNoteLocal(o.layoutKey);
      await _send(st, now);
      return { plan, rems, st };
    });
    const seen = ctx.changes();
    for (const u of b.plan.upload) {
      if (ctx.changes() !== seen) break;
      await syncMerge.idle();
      try { await _drive('putMusic', u); } catch (err) { if (_fatal(err)) throw err; console.error('[sync] a track was not sent', err); }
    }
    let landed = false;
    for (const d of b.plan.download) {
      if (ctx.changes() !== seen) break;
      await syncMerge.idle();
      let name;
      try { name = await _drive('getMusic', d); } catch (err) { if (_fatal(err)) throw err; console.error('[sync] a track was not fetched', err); continue; }
      await _locked(async () => { const st = await _load(); st.tracks[d.hash] = { name, size: 0, at: Date.now() }; await _save(st); });
      landed = true;
    }
    if (landed) o.refresh();
    if (!ctx.first) await _syFolderTidy(_drive, snap[o.key], unrefSince, b.rems, b.st, ctx.machine);
    return { held: b.plan.held };
  }

  // "Recently deleted" rows for tracks: { id: 'music:<hash>' (or 'sounds:<hash>'), name, at }.
  async function trash() {
    const st = await _load();
    return syMuTrash(st.gone, st.tracks).map(x => ({ id: o.key + ':' + x.hash, name: displayName(x.name), at: x.at }));
  }

  // A track restored from this computer's Recently deleted. ⚠ ITS DELETION IS MARKED RESTORED BEFORE THE FILE
  // RETURNS, under the lock, so no tick reads it as deleted again or as a new track. Works offline.
  const restoreHere = (hash, fn) => _locked(async () => {
    if (hash) { const st = await _load(); st.gone = syMuRestore(st.gone, hash, Date.now()); await _save(st); }
    return fn();
  });

  // Restore and Empty now change only the state here; the next tick carries them to every computer.
  const restore = hash => _locked(async () => { const st = await _load(); st.gone = syMuRestore(st.gone, hash, Date.now()); await _save(st); });
  const has = async hash => !!(await _load()).tracks[hash];
  const emptyNow = () => _locked(async () => {
    const st = await _load(), hashes = syMuTrash(st.gone, st.tracks).map(x => x.hash);
    st.gone = syMuPurge(st.gone, hashes);
    await _save(st);
    return hashes.length;
  });

  // At start the folder is hashed once; a track that lands later is hashed as it lands.
  async function reconcile() {
    try { await _drive('musicTracks', { hash: true }); } catch (err) { console.error('[sync] the music folder was not read', err); }
    hashed = true;
  }
  function landed() {
    _drive('musicTracks', { hash: true }).catch(() => {}).then(() => syncEngine.soon());
  }

  return { tick, trash, restore, restoreHere, has, emptyNow, reconcile, landed };
}

const syncMusic = _syncFolder({
  key: 'music', groups: _syMusicGroups, layoutKey: 'evermist.musicOrder', layout: byHash => musicOrderResolve(byHash), busy: name => musicTrackBusy(name), refresh: () => _muRefreshTracks(),
  trash: { held: () => sceneTrash.trackHashes(), put: sceneTrash.putTrack, restore: sceneTrash.restoreTrack, purge: sceneTrash.purgeTrack },
});
const syncSounds = _syncFolder({
  key: 'sounds', groups: null, busy: () => false, layoutKey: 'evermist.soundsLayout', layout: byHash => soundsLayoutResolve(byHash), refresh: () => soundboardRefreshOwn(),
  trash: {
    held: () => sceneTrash.trackHashes('sounds'),
    put: (name, at, hash, move) => sceneTrash.putTrack(name, at, hash, move, 'sounds'),
    restore: sceneTrash.restoreTrack, purge: sceneTrash.purgeTrack,
  },
});

// The music pane calls this after the folder or the groups changed; it does nothing unless sync is on here.
function syncNoteMusic() { if (syncIndex.isOn()) syncMusic.landed(); }
function syncNoteSounds() { if (syncIndex.isOn()) syncSounds.landed(); }

// ─── The panes' order, names and groups ──────────────────────────────────────
// Each is its own `local:` record. Music and the DM's own sounds key by file name here and by hash on the Drive
// (syncMusicPlan.js); Pictures key by id and travel as stored.

const SY_LAYOUT_KEYS = ['evermist.musicOrder', 'evermist.soundsLayout', 'evermist.picturesLayout'];
const _SY_LAYOUT_FOLDER = { 'evermist.musicOrder': '$music', 'evermist.soundsLayout': '$sounds' };

async function _syLayoutNames(lsKey) {
  const x = await syncIndex.raw.get('synced', _SY_LAYOUT_FOLDER[lsKey]);
  return syLayoutNames(x && x.st && x.st.tracks);
}

// A stored record's text as it goes up. Every other key goes as it is stored.
async function syncLayoutText(lsKey) {
  const text = localStorage.getItem(lsKey);
  if (text === null || !_SY_LAYOUT_FOLDER[lsKey]) return text;
  let layout;
  try { layout = JSON.parse(text); } catch (_) { return null; }
  return esCanon(syLayoutOut(layout, (await _syLayoutNames(lsKey)).byName));
}

// Another computer's record: the whole of it when its edit came later. Answers as syncMerge.apply does.
async function syncLayoutAdopt(r, ctx) {
  const lsKey = r.key.slice(6);
  const clean = { 'evermist.musicOrder': cleanMusicOrder, 'evermist.soundsLayout': cleanSoundsLayout, 'evermist.picturesLayout': cleanPicturesLayout }[lsKey];
  let theirs;
  try { theirs = JSON.parse(r.text); } catch (_) { return { skipped: 'bad' }; }
  if (_SY_LAYOUT_FOLDER[lsKey] && theirs && typeof theirs === 'object') theirs = syLayoutIn(theirs, (await _syLayoutNames(lsKey)).byHash);
  theirs = clean(theirs);
  if (!theirs) return { skipped: 'bad' };
  const mine = libParse(localStorage.getItem(lsKey), clean);
  if (!syLayoutTakes(mine, theirs)) return { applied: false };
  if (ctx.keep) await ctx.keep(r.key, localStorage.getItem(lsKey));
  if (lsKey === 'evermist.musicOrder') musicOrderAdopt(theirs);
  else if (lsKey === 'evermist.soundsLayout') await soundsLayoutAdopt(theirs, mine);
  else picturesLayoutAdopt(theirs);
  return { applied: true };
}
