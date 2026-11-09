'use strict';
// syncMusic.js — the music folder through sync: the tick's music part, which sync.js runs after every map, record and
// note; this computer's `music` record; its rows in Recently deleted, and the tracks it moves into and out of this
// computer's own (sceneTrash.js); and the hash a track gets as it lands. The rules are syncMusicPlan.js; files move in
// the main process (syncRemote.js, musicHashes.js). Volume stays per computer.

const syncMusic = (() => {
  const KEY = '$music';             // this computer's music state, in `evermist-sync`'s `synced` store
  const LOOSE_GRACE_MS = 15000;
  const remotes = new Map();         // machine -> { hash, rec }, the last record read
  const unrefSince = new Map();      // a Drive track file -> when it was first seen unreferenced
  let lock = Promise.resolve();
  let hashed = false;                // the start's hashing of the folder has finished

  async function _drive(op, arg) {
    const r = await window.electronAPI.syncDrive(op, arg);
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

  async function _remotes(snap, machine) {
    const out = [];
    for (const r of snap.records) {
      if (r.key !== 'music' || r.machine === machine || !(r.format <= SY_FORMAT)) continue;
      let c = remotes.get(r.machine);
      if (!c || !r.hash || c.hash !== r.hash) {
        let text;
        try { text = await _drive('getRecord', { fileId: r.fileId }); } catch (err) { if (err.code === 'notFound') continue; throw err; }
        const rec = syMuRecordParse(text);
        if (!rec) continue;
        c = { hash: r.hash, rec };
        remotes.set(r.machine, c);
      }
      out.push({ machine: r.machine, rec: c.rec });
    }
    return out;
  }

  // A computer with no music, no deletions and no groups sends nothing until it has some.
  async function _send(st, now) {
    const text = syMuRecordText(st), hash = await syncIndex.sha(text);
    const sent = (await syncIndex.raw.get('synced', 'music') || {}).hash;
    if (sent === hash) return;
    const g = st.groups || { of: {}, order: [], at: 0 };
    if (!sent && !Object.keys(st.tracks).length && !Object.keys(st.gone).length && !Object.keys(g.of).length && !g.order.length && !g.at) return;
    await _drive('putRecord', { key: 'music', text, props: { hash, format: SY_FORMAT, at: now, edited: now } });
    await syncIndex.raw.put('synced', { key: 'music', hash });
  }

  // The later groups edit, here or on another computer, becomes what the Music pane shows.
  function _groups(st, local, list, rems, machine) {
    const ls = musicGroupsSynced();
    if (!st.groups || ls.at > st.groups.at) st.groups = syMuGroupsFromLocal(ls, local, st.groups);
    st.groups = syMuGroupsPick([{ machine, groups: st.groups }].concat(rems.map(r => ({ machine: r.machine, groups: r.rec.groups }))));
    const want = syMuGroupsToLocal(st.groups, local, ls, list);
    if (esCanon(want.of) !== esCanon(ls.of) || esCanon(want.order) !== esCanon(ls.order) || want.at !== ls.at) musicGroupsAdopt(want);
  }

  async function _tidy(snap, rems, st, machine) {
    const loose = syMuLoose(snap.music, rems.concat([{ machine, rec: { tracks: st.tracks } }]), st.gone);
    const seen = new Set(loose), now = Date.now();
    for (const n of Array.from(unrefSince.keys())) if (!seen.has(n)) unrefSince.delete(n);
    for (const n of loose) {
      if (!unrefSince.has(n)) { unrefSince.set(n, now); continue; }
      if (now - unrefSince.get(n) < LOOSE_GRACE_MS) continue;
      await _drive('remove', { fileId: snap.music.find(f => f.name === n).id });
      unrefSince.delete(n);
    }
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
      const rems = await _remotes(snap, ctx.machine);
      for (const r of rems) st.gone = syMuGoneMerge(st.gone, r.rec.gone);
      st.gone = syMuPurge(st.gone, syMuTrashDue(st.gone, now));
      const local = syMuLocal(folder.tracks);
      _groups(st, local, folder.tracks, rems, ctx.machine);
      const busy = Object.keys(local).filter(h => musicTrackBusy(local[h].name));
      const plan = syMuPlan({ st, list: folder.tracks, remotes: rems, files: snap.music, first: ctx.first, busy, stashed: folder.stashed });
      // This computer's Recently deleted: a purge from any computer empties it, and a track it holds comes back from it
      // rather than the Drive.
      const held = await sceneTrash.trackHashes();
      const purged = new Set(syPurgedHeld(st.gone, held.map(x => x.hash)));
      for (const x of held) if (purged.has(x.hash)) await sceneTrash.purgeTrack(x.id);
      const back = syMuFromTrash(st.gone, local, held.filter(x => !purged.has(x.hash)).map(x => x.hash), plan.download.map(d => d.hash));
      for (const h of back) {
        const name = await sceneTrash.restoreTrack(held.find(x => x.hash === h).id);
        if (name) st.tracks[h] = { name, size: 0, at: now };
      }
      plan.download = plan.download.filter(d => !back.includes(d.hash));
      let removed = false;
      for (const r of plan.remove) {
        // A track picked while this tick ran waits too.
        if (musicTrackBusy(r.name)) { plan.held++; continue; }
        // Into this computer's Recently deleted, its time the deletion record's so both computers count the same days.
        const id = await sceneTrash.putTrack(r.name, st.gone[r.hash].at, r.hash,
          token => _drive('removeMusic', { name: r.name, hash: r.hash, token }).then(ok => ok && r.hash));
        if (id) { delete st.tracks[r.hash]; removed = true; }
      }
      if (removed) _muRefreshTracks();
      for (const fileId of plan.purge) await _drive('remove', { fileId });
      await _save(st);
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
    if (landed) _muRefreshTracks();
    if (!ctx.first) await _tidy(snap, b.rems, b.st, ctx.machine);
    return { held: b.plan.held };
  }

  // "Recently deleted" rows for tracks: { id: 'music:<hash>', name, at }.
  async function trash() {
    const st = await _load();
    return syMuTrash(st.gone, st.tracks).map(x => ({ id: 'music:' + x.hash, name: displayName(x.name), at: x.at }));
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
})();

// The music pane calls this after the folder or the groups changed; it does nothing unless sync is on here.
function syncNoteMusic() { if (syncIndex.isOn()) syncMusic.landed(); }
