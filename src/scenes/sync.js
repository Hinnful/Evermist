'use strict';
// sync.js — the outbox and inbox on the page: records and map files go up, other computers' changes come down through
// syncMerge.js, and nothing runs without a Google client. A tick runs a few seconds after a change, every 30 s, at
// start and when the network returns, and reads only `evermist-sync` until a record has to move. The
// first sync merges two filled libraries: no deletes, no map file replaced, a copy of each record it changes kept 30 days.
// A copy is kept too for the first hour of another computer's records arriving: on the computer that synced first, that
// is when the two libraries meet, and the other's first sync may take that long to send them all.
// A deleted map's record and files stay on the Drive as its "Recently deleted" entry for 30 days, then are purged; its
// deletion record is kept for good, so an old copy on a computer long offline cannot bring it back.

const syncEngine = (() => {
  const TICK_AFTER_CHANGE_MS = 4000;
  const TICK_EVERY_MS = 30000;
  // A map file is removed only after it has gone unreferenced this long: the computer that sent it may be between
  // its file and its record.
  const BLOB_GRACE_MS = 15000;
  const FIRST_KEY = '$first';
  // Set while the first-sync question is open. An app closed on it answered Cancel.
  const ASK_KEY = '$ask';
  const MET = '$met:';
  const MEETING_MS = 3600000;

  const status = { state: 'off', last: 0, progress: null, held: 0, message: '' };
  let machine = '';
  let timer = 0;
  let chain = Promise.resolve();
  let queued = null;
  let started = false;
  let asking = false;
  let changes = 0;                // moves with every change to the library, so the music part can step aside
  const pending = new Map();      // machine/key -> a pulled record waiting for the map or table on screen
  const unrefSince = new Map();   // a Drive file name -> when it was first seen unreferenced

  async function _drive(op, arg) {
    const r = await window.electronAPI.syncDrive(op, arg);
    if (!r.ok) { const e = new Error(r.message); e.code = r.code; throw e; }
    return r.v;
  }

  function _set(state, extra) {
    Object.assign(status, { state, progress: null, message: '' }, extra || {});
  }

  const _map = list => { const m = {}; for (const x of list) m[x.key] = x; return m; };
  const _blobOwner = name => name.slice(0, name.lastIndexOf('.'));

  // ─── What goes up ───────────────────────────────────────────────────────────

  const _b64 = async blob => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };

  // Every file the library's records reference, from the index alone: { owner, hash, kind, id }.
  function _wanted(entries) {
    const out = [];
    for (const e of entries) {
      if (e.key.startsWith('scene:')) {
        const id = e.key.slice(6);
        if (e.parts && e.parts.map && e.parts.map.hash) out.push({ owner: id, hash: e.parts.map.hash, kind: 'map', id });
        if (e.parts && e.parts.fog && e.parts.fog.hash) out.push({ owner: 'f_' + id, hash: e.parts.fog.hash, kind: 'fog', id });
      } else if (e.key.startsWith('pic:') && e.blobHash) out.push({ owner: e.key.slice(4), hash: e.blobHash, kind: 'pic', id: e.key.slice(4) });
      else if (e.key === 'backdrop' && e.blobHash) out.push({ owner: 'backdrop', hash: e.blobHash, kind: 'backdrop' });
    }
    return out;
  }

  async function _putBlob(w) {
    const name = syBlobName(w.owner, w.hash);
    if (w.kind === 'pic') {
      const p = (await galleryStore.all()).find(x => x.id === w.id);
      if (!p || !p.blob) return;
      return _drive('putBlob', { name, data: await p.blob.arrayBuffer() });
    }
    if (w.kind === 'backdrop') {
      const bg = await worldBackgroundTake();
      return bg ? _drive('putBlob', { name, data: await bg.blob.arrayBuffer() }) : undefined;
    }
    const rec = await sceneStore.loadScene(w.id);
    if (!rec) return;
    if (w.kind === 'fog') return rec.baseFogBlob ? _drive('putBlob', { name, data: await rec.baseFogBlob.arrayBuffer() }) : undefined;
    if (rec.mapType === 'video') return _drive('putVideo', { name, sceneId: w.id });
    if (rec.mapBlob) return _drive('putBlob', { name, data: await rec.mapBlob.arrayBuffer() });
  }

  // A record as it goes up, or null when what the index knows no longer matches what is stored (it changed meanwhile;
  // the next tick sends it).
  async function _pack(e) {
    const now = Date.now();
    if (e.key.startsWith('scene:')) {
      const rec = await sceneStore.loadScene(e.key.slice(6));
      if (!rec || esCanon(rec.edits || {}) !== e.edits) return null;
      const body = {};
      for (const k of Object.keys(rec)) if (!SY_SCENE_BLOBS.includes(k)) body[k] = rec[k];
      const thumb = rec.thumbnail ? await _b64(rec.thumbnail) : null;
      const map = e.parts.map.hash ? { name: syBlobName(rec.id, e.parts.map.hash), mime: rec.mapBlob && rec.mapBlob.type } : null;
      const fog = e.parts.fog.hash ? { name: syBlobName('f_' + rec.id, e.parts.fog.hash) } : null;
      const text = syncMerge.slice('pack', () => JSON.stringify({ format: SY_FORMAT, key: e.key, rec: body, thumb, blobs: { map, fog } }));
      return { text, props: { hash: e.hash, format: SY_FORMAT, at: now, edited: sySceneEditedAt(rec, now), b1: map ? map.name : '', b2: fog ? fog.name : '' } };
    }
    if (e.key.startsWith('pic:')) {
      const p = (await galleryStore.all()).find(x => x.id === e.key.slice(4));
      if (!p || !p.blob || !e.blobHash) return null;
      const blob = { name: syBlobName(p.id, e.blobHash) };
      const text = JSON.stringify({ format: SY_FORMAT, key: e.key, pic: { id: p.id, name: p.name, added: p.added, named: p.named || false, type: p.blob.type }, blob });
      return { text, props: { hash: e.hash, format: SY_FORMAT, at: now, edited: galleryTime(p, now), b1: blob.name } };
    }
    if (e.key === 'backdrop') {
      const bg = await worldBackgroundTake();
      if (!bg || !e.blobHash) return null;
      const blob = { name: syBlobName('backdrop', e.blobHash), type: bg.blob.type || '' };
      const text = JSON.stringify({ format: SY_FORMAT, key: e.key, meta: JSON.stringify(bg.meta), blob });
      return { text, props: { hash: e.hash, format: SY_FORMAT, at: now, edited: bg.meta.at || 0, b1: blob.name } };
    }
    if (e.key === 'campaign') {
      const text = syncCampaignText();
      if (text === null) return { none: true };
      if (await syncIndex.sha(text) !== e.hash) return null;
      return { text: JSON.stringify({ format: SY_FORMAT, key: e.key, text }), props: { hash: e.hash, format: SY_FORMAT, at: e.at || now, edited: e.at || 0 } };
    }
    const lsKey = e.key.slice(6);
    let text = await syncLayoutText(lsKey);
    if (lsKey === 'evermist.combat' || lsKey === 'evermist.combatFights') text = cbBackupPayload();
    if (text === null) return { none: true };
    const at = lsKey === 'evermist.campaignNotes' ? notesCampaignAt() : e.at;
    return { text: JSON.stringify({ format: SY_FORMAT, key: e.key, text, at }), props: { hash: e.hash, format: SY_FORMAT, at: e.at || now, edited: e.at || 0 } };
  }

  // ─── What comes down ────────────────────────────────────────────────────────

  async function _keep(key, copy) {
    const at = Date.now();
    let rec = copy;
    if (copy && typeof copy === 'object' && key.startsWith('scene:')) { rec = { ...copy }; delete rec.mapBlob; delete rec.pictureBlobs; }
    try { await syncIndex.raw.put('copies', { key: at + ':' + key, of: key, at, copy: rec }); } catch (err) { console.error('[sync] a copy was not kept', err); }
  }

  async function _purgeCopies(now) {
    for (const c of await syncIndex.raw.all('copies')) if (now - c.at > SY_TRASH_MS) await syncIndex.raw.del('copies', c.key);
  }

  async function _applyItem(item, snap, first, keep) {
    const blobId = name => { const b = snap.blobs.find(x => x.name === name); if (!b) { const e = new Error('a file the record names is not on the Drive yet'); e.code = 'missingBlob'; throw e; } return b.id; };
    const io = {
      blob: async (name, mime) => new Blob([await _drive('getBlob', { fileId: blobId(name), name })], { type: mime }),
      video: async (name, id) => _drive('getVideo', { fileId: blobId(name), name, sceneId: id }),
      place: (id, ext) => _drive('placeVideo', { sceneId: id, ext }),
      dropPart: id => _drive('dropVideoPart', { sceneId: id }),
      keepMap: async (id, blob) => _drive('keepMap', { sceneId: id, data: await blob.arrayBuffer(), mime: blob.type }),
    };
    let r;
    try { r = JSON.parse(await _drive('getRecord', { fileId: item.fileId })); } catch (err) {
      if (err.code === 'notFound') return 'gone';
      if (err instanceof SyntaxError) return 'bad';
      throw err;
    }
    if (!r || r.key !== item.key) return 'bad';
    if (!(r.format <= SY_FORMAT)) { status.message = 'update'; return 'tooNew'; }
    const mine = await syncIndex.raw.get('index', item.key);
    const sceneIds = snap.records.filter(x => x.key.startsWith('scene:')).map(x => x.key.slice(6)).filter(id => TI_SAFE_ID.test(id));
    const res = await syncMerge.apply(r, io, { firstSync: first, keep: first || keep ? _keep : null, remoteAt: item.at, localAt: mine ? mine.at : 0, sceneIds });
    if (res.skipped === 'file') return 'retry';
    await syncIndex.raw.put('pulled', { key: item.machine + '/' + item.key, hash: item.hash });
    await syncIndex.idle();
    const now = await syncIndex.raw.get('index', item.key);
    if (now && now.hash === item.hash) await syncIndex.raw.put('synced', { key: item.key, hash: item.hash });
    return 'done';
  }

  // The held records that may land now, one per idle slice.
  async function _drain(snap, first, prog, met) {
    let held = 0;
    // The Campaign after the maps, so a road's end finds the map it names.
    const order = Array.from(pending).sort((a, b) => (a[1].key === 'campaign') - (b[1].key === 'campaign'));
    for (const [id, item] of order) {
      if (syncMerge.deferred() || syncMerge.held(item.key)) { held++; continue; }
      await syncMerge.idle();
      if (syncMerge.deferred() || syncMerge.held(item.key)) { held++; continue; }
      let out;
      const meeting = !met.has(item.machine) || Date.now() - met.get(item.machine) < MEETING_MS;
      try { out = await _applyItem(item, snap, first, meeting); } catch (err) {
        if (err.code === 'missingBlob') { held++; continue; }
        throw err;
      }
      if (out === 'retry') { held++; continue; }
      pending.delete(id);
      if (prog) { prog.done++; status.progress = { done: prog.done, total: prog.total }; }
    }
    status.held = held;
  }

  // ─── Deleted maps and the 30-day trash ──────────────────────────────────────

  async function _goneMap() {
    const g = {};
    for (const x of await syncIndex.raw.all('gone')) g[x.id] = x;
    return g;
  }

  async function _goneSave(before, after) {
    const one = (g, id) => syGoneText({ [id]: g[id] });
    for (const id of Object.keys(after)) if (one(before, id) !== one(after, id)) await syncIndex.raw.put('gone', { ...syGoneClean({ [id]: after[id] })[id], id });
  }

  // Every other computer's deletion records merged into this one's, and the trash past 30 days purged.
  async function _goneTake(snap, pulled, now) {
    const mine = await _goneMap(), marks = [];
    let gone = mine;
    for (const r of snap.records) {
      const mark = r.machine + '/gone';
      if (r.key !== 'gone' || r.machine === machine || !(r.format <= SY_FORMAT) || pulled[mark] === r.hash) continue;
      let text;
      try { text = await _drive('getRecord', { fileId: r.fileId }); } catch (err) { if (err.code === 'notFound') continue; throw err; }
      gone = syGoneMerge(gone, syGoneParse(text));
      marks.push({ key: mark, hash: r.hash });
    }
    gone = syPurge(gone, syTrashDue(gone, now));
    await _goneSave(mine, gone);
    for (const m of marks) { await syncIndex.raw.put('pulled', m); pulled[m.key] = m.hash; }
    return gone;
  }

  // A purged map leaves the Drive; a map deleted elsewhere moves into this computer's trash unless edited here since, and
  // waits while it is on screen; a restored map comes back from this computer's trash, else from the newest copy on the
  // Drive; a purged map leaves this computer's trash. Answers how many wait.
  async function _goneApply(gone, snap, now) {
    const purged = Object.keys(gone).filter(id => gone[id].purged);
    for (const fileId of syPurgeFiles(snap.records, snap.blobs, purged)) await _drive('remove', { fileId });
    let held = 0;
    for (const id of Object.keys(gone)) {
      if (!allScenes.some(s => s.id === id)) continue;
      const rec = await sceneStore.loadScene(id);
      if (!rec || !syGoneWins(gone[id], sySceneEditedAt(rec, now), now)) continue;
      if (syncMerge.deferred() || syncMerge.held('scene:' + id)) { held++; continue; }
      await syncMerge.idle();
      await syncMerge.drop(id, gone[id].at);
    }
    const back = syRestoreFrom(gone, allScenes.map(s => s.id), await sceneTrash.ids());
    for (const id of back.trash) if (!syncMerge.deferred()) await sceneTrash.restore(id);
    for (const id of back.drive) {
      const item = syNewestRecord(snap.records, 'scene:' + id);
      if (!item || syncMerge.deferred()) continue;
      try { await _applyItem(item, snap, false); } catch (err) { if (err.code !== 'missingBlob') throw err; }
    }
    // After the drops, so a purged map that just moved into the trash leaves it too.
    for (const id of syPurgedHeld(gone, await sceneTrash.ids())) await sceneTrash.purge(id);
    return held;
  }

  async function _goneSend(now) {
    const g = await _goneMap();
    if (!Object.keys(g).length) return;
    const text = syGoneText(g), hash = await syncIndex.sha(text);
    if ((await syncIndex.raw.get('synced', 'gone') || {}).hash === hash) return;
    await _drive('putRecord', { key: 'gone', text, props: { hash, format: SY_FORMAT, at: now } });
    await syncIndex.raw.put('synced', { key: 'gone', hash });
  }

  // "Recently deleted": [{ id, name, at }] of maps and tracks, newest first. A map's name is read from its newest record
  // on the Drive; a track's id is `music:<hash>`, one of the DM's own sounds `sounds:<hash>`.
  async function trash() {
    const gone = await _goneMap(), snap = await _drive('snapshot'), out = [];
    for (const id of syTrashIds(gone)) {
      if (allScenes.some(s => s.id === id)) continue;
      const item = syNewestRecord(snap.records, 'scene:' + id);
      let name = '';
      if (item) try { const r = JSON.parse(await _drive('getRecord', { fileId: item.fileId })); name = (r.rec && r.rec.name) || ''; } catch (_) { /* listed without a name */ }
      out.push({ id, name, at: gone[id].at });
    }
    return out.concat(await syncMusic.trash(), await syncSounds.trash()).sort((a, b) => b.at - a.at);
  }

  // Restore brings the map back here at once and on every other computer at its next sync.
  async function restore(id) {
    const folder = id.startsWith('music:') ? syncMusic : id.startsWith('sounds:') ? syncSounds : null;
    if (folder) {
      const hash = id.slice(id.indexOf(':') + 1);
      await folder.restore(hash);
      await now();
      return folder.has(hash);
    }
    if (!(await markRestored(id))) return false;
    await now();
    return allScenes.some(s => s.id === id);
  }

  // The deletion record marked restored, with no tick: a map restored from this computer's trash is marked before it
  // comes back, so a tick in between cannot drop it again.
  async function markRestored(id) {
    const g = await _goneMap(), next = syRestore(g, id, Date.now());
    if (next === g) return false;
    await _goneSave(g, next);
    return true;
  }

  async function emptyNow() {
    const g = await _goneMap(), ids = syTrashIds(g).filter(id => !allScenes.some(s => s.id === id));
    await _goneSave(g, syPurge(g, ids));
    const tracks = await syncMusic.emptyNow() + await syncSounds.emptyNow();
    await now();
    return ids.length + tracks;
  }

  // ─── Replaced map pictures ──────────────────────────────────────────────────

  // The map files a sync replaced, kept on this computer: [{ name, sceneId, at, ext, mapName }] of maps still in the
  // library, newest first. Local files only, so it needs no sign-in.
  async function kept() {
    const out = [];
    for (const k of await _drive('listKept')) {
      const s = allScenes.find(x => x.id === k.sceneId);
      if (s) out.push({ ...k, mapName: s.name });
    }
    return out;
  }

  // The kept file back as the map, and the map it replaces kept in turn. The map is stamped as edited now, so the
  // next sync carries it to every computer. Answers 'held' for a map on screen, which it leaves alone.
  async function restoreKept(name) {
    const k = syKeptParse(name), local = k && allScenes.some(s => s.id === k.sceneId) ? await sceneStore.loadScene(k.sceneId) : null;
    if (!local) return 'gone';
    const id = k.sceneId;
    if (syncMerge.held('scene:' + id)) return 'held';
    const rec = { ...local };
    let blob = null, d = null;
    if (k.video) {
      await _drive('restoreKept', { name });
      Object.assign(rec, { mapType: 'video', mapPath: `maps/${id}.${k.ext}` });
      delete rec.mapBlob;
      const abs = await window.electronAPI.getVideoFilePath(id);
      try { d = await _decodeOffscreen('file:///' + abs.replace(/\\/g, '/'), true); } catch (err) { console.error('[sync] the restored video did not decode', err); }
    } else {
      blob = new Blob([await _drive('restoreKept', { name })], { type: k.mime });
      d = await _decodeOffscreen(blob, false);
      Object.assign(rec, { mapType: 'image', mapBlob: blob });
      delete rec.mapPath;
    }
    if (local.mapBlob) await _drive('keepMap', { sceneId: id, data: await local.mapBlob.arrayBuffer(), mime: local.mapBlob.type });
    if (d) Object.assign(rec, { mapWidth: d.w, mapHeight: d.h, thumbnail: d.thumb });
    const edits = local.edits || {};
    rec.edits = { ...edits, scene: { ...(edits.scene || {}), map: Date.now() } };
    await sceneStore.putScene(rec);
    syncMerge.cardUpdated(rec);
    return 'restored';
  }

  // ─── Signing in ─────────────────────────────────────────────────────────────

  // The token lives in the main process (syncAuth.js); a sync follows either way, so the status line catches up.
  const signedIn = () => _drive('signedIn');
  const remembered = () => _drive('remembered');

  // What the first-sync question counts: the maps here, and the maps and other computers on the Drive.
  async function _firstCounts() {
    const snap = await _drive('snapshot');
    let gone = await _goneMap();
    for (const r of snap.records) {
      if (r.key !== 'gone' || r.machine === machine || !(r.format <= SY_FORMAT)) continue;
      try { gone = syGoneMerge(gone, syGoneParse(await _drive('getRecord', { fileId: r.fileId }))); } catch (err) { if (err.code !== 'notFound') throw err; }
    }
    return { here: allScenes.length, ...syDriveCounts(snap.records, machine, gone, Date.now()) };
  }

  // A computer that never finished a first sync answers `first`, the counts, and syncs nothing until the DM answers:
  // confirmFirst starts it, cancelFirst signs out again.
  async function connect() {
    asking = true;
    // A computer that never connected has no index yet; it is built here, before the question.
    try { await syncActivate(); } catch (err) { asking = false; throw err; }
    // A tick already running finishes signed out, so none starts the first sync before the question.
    await chain;
    let r;
    try { r = await _drive('connect', { lang: I18N_LANG }); } catch (err) { asking = false; throw err; }
    if (r.ok && !(await syncIndex.raw.get('synced', FIRST_KEY))) {
      await syncIndex.raw.put('synced', { key: ASK_KEY, hash: 'waiting' });
      try { return { ...r, first: await _firstCounts() }; } catch (err) {
        await cancelFirst();
        return { ok: false, code: err.code, message: String(err.message) };
      }
    }
    asking = false;
    if (r.ok) await now();
    return r;
  }
  async function confirmFirst() {
    await syncIndex.raw.del('synced', ASK_KEY);
    asking = false;
    await now();
  }
  async function cancelFirst() {
    await _drive('disconnect');
    await syncIndex.raw.del('synced', ASK_KEY);
    asking = false;
    await now();
  }
  async function disconnect() {
    await _drive('disconnect');
    await now();
  }

  // ─── One tick ───────────────────────────────────────────────────────────────

  async function _tick() {
    if (!started || asking) return;
    _set('syncing', { last: status.last, held: status.held });
    try {
      await syncIndex.idle();
      const snap = await _drive('snapshot');
      const now = Date.now();
      const first = !(await syncIndex.raw.get('synced', FIRST_KEY));
      const index = _map((await syncIndex.raw.all('index')).filter(e => syncMerge.supported(e.key)));
      const synced = {}, pulled = {};
      for (const s of await syncIndex.raw.all('synced')) synced[s.key] = s.hash;
      for (const p of await syncIndex.raw.all('pulled')) pulled[p.key] = p.hash;
      const met = new Map(Object.keys(synced).filter(k => k.startsWith(MET)).map(k => [k.slice(MET.length), Number(synced[k]) || 0]));
      // Deletions first, so a map deleted on any computer is neither pulled nor sent. The first sync deletes nothing.
      const gone = await _goneTake(snap, pulled, now);
      const heldGone = first ? 0 : await _goneApply(gone, snap, now);

      // Inbox. A map deleted here stays gone, whatever another computer still holds of it.
      const records = snap.records.filter(r => syncMerge.supported(r.key) && !(r.key.startsWith('scene:') && syGoneWins(gone[r.key.slice(6)], r.edited, now)));
      const fresh = syNewRemote(records, machine, index, pulled);
      if (fresh.tooNew.length) status.message = 'update';
      for (const r of fresh.same) {
        await syncIndex.raw.put('pulled', { key: r.machine + '/' + r.key, hash: r.hash });
        await syncIndex.raw.put('synced', { key: r.key, hash: r.hash });
      }
      const live = new Set(records.map(r => r.machine + '/' + r.key + '/' + r.hash));
      for (const id of Array.from(pending.keys())) if (!live.has(id + '/' + pending.get(id).hash)) pending.delete(id);
      for (const r of fresh.take) pending.set(r.machine + '/' + r.key, r);
      const prog = { done: 0, total: pending.size };
      if (first) status.progress = { done: 0, total: prog.total };
      await _drain(snap, first, first ? prog : null, met);
      for (const m of new Set(records.map(r => r.machine))) if (m !== machine && !met.has(m)) await syncIndex.raw.put('synced', { key: MET + m, hash: String(now) });
      status.held += heldGone;

      // Outbox: map files first, so a record never names a file the Drive lacks.
      await syncIndex.idle();
      for (const k of Object.keys(synced)) delete synced[k];
      for (const x of await syncIndex.raw.all('synced')) synced[x.key] = x.hash;
      const entries = (await syncIndex.raw.all('index')).filter(e => syncMerge.supported(e.key));
      const have = snap.blobs.map(b => b.name);
      const upBlobs = syBlobsToUpload(_wanted(entries), have);
      const up = syToUpload(_map(entries), synced).filter(k => !(k.startsWith('scene:') && gone[k.slice(6)] && gone[k.slice(6)].purged));
      let total = prog.total + upBlobs.length + up.length, done = prog.done, failed = 0;
      const tick = () => { done++; if (first) status.progress = { done, total }; };
      const sent = new Set();
      for (const w of upBlobs) {
        await syncMerge.idle();
        try { await _putBlob(w); sent.add(syBlobName(w.owner, w.hash)); } catch (err) { if (err.code === 'offline' || err.code === 'quota' || err.code === 'auth') throw err; failed++; console.error('[sync] a file was not sent', err); }
        tick();
      }
      for (const key of up) {
        await syncMerge.idle();
        const e = await syncIndex.raw.get('index', key);
        if (!e || e.hash === synced[key]) { tick(); continue; }
        const need = _wanted([e]).map(w => syBlobName(w.owner, w.hash));
        if (need.some(n => !have.includes(n) && !sent.has(n))) { failed++; tick(); continue; }
        const p = await _pack(e);
        const again = await syncIndex.raw.get('index', key);
        if (!p || !again || again.hash !== e.hash) { tick(); continue; }
        if (!p.none) await _drive('putRecord', { key, text: p.text, props: p.props });
        await syncIndex.raw.put('synced', { key, hash: e.hash });
        tick();
      }

      await _goneSend(now);
      if (!first) for (const fileId of syPicFilesGone(snap.records, snap.blobs, galleryGone())) await _drive('remove', { fileId });

      // Tidying. Nothing is removed on the first sync.
      if (!first) {
        const after = await _drive('snapshot');
        const refs = after.records.flatMap(r => r.blobs).concat(_wanted(entries).map(w => syBlobName(w.owner, w.hash)));
        const recorded = after.records.map(r => r.key.slice(r.key.indexOf(':') + 1));
        const loose = syBlobsUnreferenced(after.blobs.map(b => b.name), refs.map(n => ({ owner: _blobOwner(n), hash: n.slice(n.lastIndexOf('.') + 1) })), recorded);
        const seen = new Set(loose);
        for (const n of Array.from(unrefSince.keys())) if (!seen.has(n)) unrefSince.delete(n);
        for (const n of loose) {
          if (!unrefSince.has(n)) { unrefSince.set(n, now); continue; }
          if (Date.now() - unrefSince.get(n) < BLOB_GRACE_MS) continue;
          await _drive('remove', { fileId: after.blobs.find(b => b.name === n).id });
          unrefSince.delete(n);
        }
        for (const id of after.dupes) await _drive('remove', { fileId: id }).catch(() => {});
      }
      // Music last, after every map, record and note.
      const mu = await syncMusic.tick(snap, { machine, first, now, changes: () => changes });
      status.held += mu.held;
      status.held += (await syncSounds.tick(snap, { machine, first, now, changes: () => changes })).held;
      await _purgeCopies(Date.now());
      try { status.space = await _drive('about'); } catch (_) { /* the line keeps the last reading */ }
      if (first && !failed && !pending.size) await syncIndex.raw.put('synced', { key: FIRST_KEY, hash: 'done' });
      _set('idle', { last: Date.now(), held: status.held, message: status.message });
    } catch (err) {
      if (err.code === 'quota') try { status.space = await _drive('about'); } catch (_) { /* no reading */ }
      const map = { offline: 'offline', auth: 'signedOut', quota: 'full' };
      _set(map[err.code] || 'error', { last: status.last, held: status.held, message: String(err.message || err) });
      if (!map[err.code]) console.error('[sync]', err);
    }
  }

  // A tick that starts after this call, joined with any already queued.
  function now() {
    if (!queued) {
      queued = chain.then(() => { queued = null; return _tick(); });
      chain = queued.catch(() => {});
    }
    return queued;
  }

  function schedule(ms) {
    if (!started) return;
    clearTimeout(timer);
    timer = setTimeout(now, ms);
  }

  async function start() {
    if (started || !syncIndex.isOn()) return;
    try { machine = await _drive('machine'); } catch (_) { return; }
    if (await syncIndex.raw.get('synced', ASK_KEY)) {
      try { await _drive('disconnect'); await syncIndex.raw.del('synced', ASK_KEY); } catch (err) { console.error('[sync]', err); return; }
    }
    started = true;
    _set('idle');
    syncIndex.onChange(() => { changes++; schedule(TICK_AFTER_CHANGE_MS); });
    setInterval(now, TICK_EVERY_MS);
    window.addEventListener('online', now);
    // A map held back is tried again as soon as the screen lets go of it.
    setInterval(() => { if (!syncMerge.deferred() && Array.from(pending.values()).some(i => !syncMerge.held(i.key))) now(); }, 5000);
    schedule(1500);
  }

  const soon = () => schedule(TICK_AFTER_CHANGE_MS);

  return { start, now, soon, trash, restore, markRestored, kept, restoreKept, emptyNow, signedIn, remembered, connect, confirmFirst, cancelFirst, disconnect, status: () => ({ ...status, machine, pending: pending.size }), pending: () => Array.from(pending.keys()) };
})();

// Sync's start after the scenes are up. The section shows wherever there is a Google client; the index and the
// engine run only on a computer that has connected (signed in now, or its sync database already made), so a DM who
// never connects pays nothing on a save.
async function syncBoot() {
  try {
    if (isPane || !(window.electronAPI && window.electronAPI.syncAvailable && await window.electronAPI.syncAvailable())) return;
    syncSettingsInit();
    const made = indexedDB.databases ? (await indexedDB.databases()).some(d => d.name === 'evermist-sync') : true;
    if (made || await syncEngine.signedIn()) await syncActivate();
  } catch (err) { console.error(err); }
}

// The index and the engine, on: at start on a computer that has connected, or at its first Connect.
async function syncActivate() {
  if (syncIndex.isOn()) return;
  if (!(await syncIndex.init())) return;
  await syncIndex.reconcile();
  syncMusic.reconcile();
  syncSounds.reconcile();
  await syncEngine.start();
}
