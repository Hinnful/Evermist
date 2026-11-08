'use strict';
// syncPlan.js — pure kernel for syncing the library between computers: what goes up, what comes down, which
// map files the Drive already holds or no longer needs, which pulled changes wait for a map or table on screen,
// and the 30-day trash a deleted map goes to. No DOM, no network. Tested.
//
// A record is named by a key: `scene:<id>`, `pic:<id>`, `backdrop`, `campaign`, `gone`, `music`, or `local:<storage key>`. The index holds each
// record's content hash as last saved here; `synced` holds the hash last uploaded under that key, and `pulled` the
// hash last taken from another computer, keyed `machine/key`. A map file is named by its owner and content hash.

const _SY_ES = typeof esCanon === 'function' ? { esCanon } : require('./editStamps.js');

const SY_FORMAT = 1;
const SY_TRASH_MS = 30 * 24 * 3600 * 1000;
// The Blobs a scene record carries. They travel apart, so the record that goes up leaves them out.
const SY_SCENE_BLOBS = ['mapBlob', 'baseFogBlob', 'thumbnail', 'pictureBlobs'];
const SY_BLOB_NAME_RE = /^[0-9a-zA-Z_-]{1,80}\.[0-9a-f]{64}$/;
const SY_KEY_RE = /^(scene|pic):[0-9a-zA-Z_-]{1,80}$|^(backdrop|campaign|gone|music)$|^local:evermist[.\w-]{1,80}$/;
const SY_ID_RE = /^[0-9a-zA-Z_-]{1,80}$/;

// What a scene record's hash is made of: the record without its Blobs, in a stable text.
function syRecordBody(rec) {
  const out = {};
  for (const k of Object.keys(rec || {})) if (!SY_SCENE_BLOBS.includes(k)) out[k] = rec[k];
  return _SY_ES.esCanon(out);
}

// The `campaign` record's text from an export's campaign.json text (notesCampaignPayload), keys in a stable order, so two
// computers holding the same Campaign hash it the same and a pulled one is not sent back. Null for none or unreadable.
function syCampaignText(payload) {
  if (typeof payload !== 'string') return null;
  try { return _SY_ES.esCanon(JSON.parse(payload)); } catch (_) { return null; }
}

// The backdrop's stored numbers, read the same way: an import writes its keys in another order than a pick does.
function syBackdropMetaText(meta) {
  try { return _SY_ES.esCanon(JSON.parse(meta)); } catch (_) { return String(meta); }
}

const syBlobName = (owner, hash) => owner + '.' + hash;
const syBlobNameOk = name => typeof name === 'string' && SY_BLOB_NAME_RE.test(name);
const syKeyOk = key => typeof key === 'string' && SY_KEY_RE.test(key);

// The record keys whose content here is not what was last uploaded: they go up. A pulled change leaves the index
// and `synced` equal, so it is never sent back.
function syToUpload(index, synced) {
  return Object.keys(index || {}).filter(k => index[k] && index[k].hash && index[k].hash !== (synced || {})[k]).sort();
}

// Another computer's records, `remote` = [{ machine, key, hash, format }]. `take` are new here and readable;
// `same` already match what this computer holds (noted as pulled, not applied); `tooNew` come from a newer sync
// format and are skipped; `bad` carry a key this release would not accept.
function syNewRemote(remote, own, index, pulled) {
  const out = { take: [], same: [], tooNew: [], bad: [] };
  for (const r of remote || []) {
    if (!r || r.machine === own) continue;
    if (!syKeyOk(r.key) || typeof r.hash !== 'string' || !r.hash) { out.bad.push(r); continue; }
    if (!(r.format <= SY_FORMAT)) { out.tooNew.push(r); continue; }
    if ((pulled || {})[r.machine + '/' + r.key] === r.hash) continue;
    if (index && index[r.key] && index[r.key].hash === r.hash) out.same.push(r); else out.take.push(r);
  }
  return out;
}

// `wanted` is [{ owner, hash }] the records here reference; the ones whose file the Drive lacks go up, once each.
function syBlobsToUpload(wanted, remoteNames) {
  const have = new Set(remoteNames), seen = new Set(), out = [];
  for (const w of wanted || []) {
    const name = syBlobName(w.owner, w.hash);
    if (have.has(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(w);
  }
  return out;
}

// The files on the Drive that no computer's record references any more. `recorded`: the ids whose record is on the
// Drive. A file whose owner has no record there yet is another computer's upload in flight, never loose.
function syBlobsUnreferenced(remoteNames, refs, recorded) {
  const used = new Set((refs || []).map(w => syBlobName(w.owner, w.hash)));
  const owners = new Set(recorded || []);
  const ownerOf = n => n.slice(0, n.lastIndexOf('.')).replace(/^f_/, '');
  return remoteNames.filter(n => !used.has(n) && owners.has(ownerOf(n)));
}

// Why a pulled change must wait (open, tv, pane, fights, note), or null to apply it now. `ctx`: openScene, tvScene, paneScenes (Two maps),
// fightTable (shown), openNoteKey (the record key the editor's note lives in).
function syHeld(key, ctx) {
  const c = ctx || {};
  if (key.startsWith('scene:')) {
    const id = key.slice(6);
    if (c.openScene === id) return 'open';
    if (c.tvScene === id) return 'tv';
    if ((c.paneScenes || []).includes(id)) return 'pane';
  }
  if (c.fightTable && (key === 'local:evermist.combat' || key === 'local:evermist.combatFights')) return 'fights';
  if (c.openNoteKey && c.openNoteKey === key) return 'note';
  return null;
}

// ─── Deletion and the 30-day trash ───────────────────────────────────────────
// `gone` is { sceneId: { at, restoredAt?, purged? } }. An entry is never dropped, not even after a purge, so a
// computer that was offline longer than 30 days cannot bring the map back.

const _syClamp = (t, now) => (Number.isFinite(t) && t > 0 ? Math.min(t, now) : 0);

// The latest time inside a record's `edits`, a stamp past `now` counting as `now`.
function sySceneEditedAt(rec, now) {
  let m = 0;
  const walk = v => {
    if (typeof v === 'number') m = Math.max(m, _syClamp(v, now));
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k]);
  };
  walk(rec && rec.edits);
  return m;
}

// True when the deletion stands against a copy last edited at `editedAt`: not undone since, and not older than the edit.
// A purged map stays gone whatever the copy says.
function syGoneWins(entry, editedAt, now) {
  if (!entry) return false;
  if (entry.purged) return true;
  const at = _syClamp(entry.at, now);
  if (at <= 0) return false;
  if (_syClamp(entry.restoredAt, now) >= at) return false;
  return at >= editedAt;
}

function syGoneNote(gone, id, now) {
  const prev = gone[id];
  return { ...gone, [id]: { ...(prev || {}), at: Math.max(now, prev ? prev.at || 0 : 0) } };
}

// A restored map counts as an edit at `now`. A purged one cannot be restored.
function syRestore(gone, id, now) {
  const e = gone[id];
  if (!e || e.purged) return gone;
  return { ...gone, [id]: { ...e, restoredAt: now } };
}

// Both computers' deletion records, combined: the later time of each field, a purge once either has it.
function syGoneMerge(a, b) {
  const out = { ...(a || {}) };
  for (const id of Object.keys(b || {})) {
    const x = out[id], y = b[id];
    if (!x) { out[id] = { ...y }; continue; }
    const e = { at: Math.max(x.at || 0, y.at || 0) };
    const r = Math.max(x.restoredAt || 0, y.restoredAt || 0);
    if (r) e.restoredAt = r;
    if (x.purged || y.purged) e.purged = true;
    out[id] = e;
  }
  return out;
}

// What the trash holds: deleted, not undone, not purged.
const syTrashIds = gone => Object.keys(gone || {}).filter(id => !gone[id].purged && !((gone[id].restoredAt || 0) >= (gone[id].at || 0)));

// The ids past their 30 days.
const syTrashDue = (gone, now) => syTrashIds(gone).filter(id => now - gone[id].at > SY_TRASH_MS);

// `ids` are kept as records and marked purged: "Empty now" and the 30-day purge.
function syPurge(gone, ids) {
  const out = { ...gone };
  for (const id of ids) if (out[id]) out[id] = { ...out[id], purged: true };
  return out;
}

// The records kept and sent, read back the same way: only well-formed ids and times. `text` is the Drive's, so it may be anything.
function syGoneClean(gone) {
  const out = {};
  for (const id of Object.keys(gone || {}).sort()) {
    const g = gone[id];
    if (!SY_ID_RE.test(id) || !g || !(Number.isFinite(g.at) && g.at > 0)) continue;
    out[id] = { at: g.at };
    if (Number.isFinite(g.restoredAt) && g.restoredAt > 0) out[id].restoredAt = g.restoredAt;
    if (g.purged === true) out[id].purged = true;
  }
  return out;
}
const syGoneText = gone => _SY_ES.esCanon(syGoneClean(gone));
function syGoneParse(text) {
  try { return syGoneClean(JSON.parse(text)); } catch (_) { return {}; }
}

// Restored maps, which come back from the Drive where this computer no longer holds them.
const syRestored = (gone, localIds) => {
  const here = new Set(localIds);
  return Object.keys(gone || {}).filter(id => !here.has(id) && !gone[id].purged && (gone[id].restoredAt || 0) >= (gone[id].at || 0));
};

// The newest copy of a record any computer holds, own included: the latest edit, then the latest upload.
function syNewestRecord(records, key) {
  let best = null;
  for (const r of records || []) {
    if (r.key !== key) continue;
    if (!best || r.edited > best.edited || (r.edited === best.edited && r.at > best.at)) best = r;
  }
  return best;
}

// The Drive files a purge removes: every computer's record of each map and the map and fog files it owned.
function syPurgeFiles(records, blobs, ids) {
  const keys = new Set(ids.map(id => 'scene:' + id)), owners = new Set(ids.flatMap(id => [id, 'f_' + id]));
  return (records || []).filter(r => keys.has(r.key)).map(r => r.fileId)
    .concat((blobs || []).filter(b => owners.has(b.name.slice(0, b.name.lastIndexOf('.')))).map(b => b.id));
}

// The Drive files a deleted picture leaves behind: every computer's record of it, unless edited since the deletion,
// and its file. `gone` is galleryGone(): { picture id: when deleted }.
function syPicFilesGone(records, blobs, gone) {
  const ids = new Set();
  const out = (records || []).filter(r => {
    if (!r.key.startsWith('pic:')) return false;
    const id = r.key.slice(4), at = Object.prototype.hasOwnProperty.call(gone || {}, id) ? gone[id] : 0;
    if (!(at > 0 && at >= r.edited)) return false;
    ids.add(id);
    return true;
  }).map(r => r.fileId);
  return out.concat((blobs || []).filter(b => ids.has(b.name.slice(0, b.name.lastIndexOf('.')))).map(b => b.id));
}

// Maps this computer synced before that are no longer here and have no deletion record: deleted, at `now`.
function syMissingScenes(synced, localIds, gone) {
  const here = new Set(localIds);
  return Object.keys(synced || {}).filter(k => k.startsWith('scene:')).map(k => k.slice(6))
    .filter(id => !here.has(id) && !(gone && gone[id]));
}

// What the first-sync question counts on the Drive: the maps other computers hold there, a deleted one left out, and
// how many other computers sent records.
function syDriveCounts(records, own, gone, now) {
  const maps = new Set(), machines = new Set();
  for (const r of records || []) {
    if (r.machine === own) continue;
    machines.add(r.machine);
    if (r.key.startsWith('scene:') && !syGoneWins((gone || {})[r.key.slice(6)], r.edited, now)) maps.add(r.key.slice(6));
  }
  return { maps: maps.size, computers: machines.size };
}

// A map file a sync replaced is kept as `<scene id>.<time kept>.<ext>`; these are the names past their 30 days.
const SY_KEPT_RE = /^([0-9a-zA-Z_-]{1,80})\.(\d{1,15})\.([a-z0-9]{1,5})$/;
const syKeptName = (id, at, ext) => id + '.' + at + '.' + ext;
const syKeptDue = (names, now) => (names || []).filter(n => { const m = SY_KEPT_RE.exec(n); return !!m && now - Number(m[2]) > SY_TRASH_MS; });

// The types a kept file may carry; `bin` is a picture whose type keepMap did not know.
const SY_KEPT_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bin: '', webm: 'video/webm', mp4: 'video/mp4' };
function syKeptParse(name) {
  const m = typeof name === 'string' ? SY_KEPT_RE.exec(name) : null;
  if (!m || !Object.prototype.hasOwnProperty.call(SY_KEPT_MIME, m[3])) return null;
  return { name, sceneId: m[1], at: Number(m[2]), ext: m[3], video: m[3] === 'webm' || m[3] === 'mp4', mime: SY_KEPT_MIME[m[3]] };
}
// The kept map files behind the Campaign map's "Restore previous picture": the well-formed names, newest first.
const syKeptList = names => (names || []).map(syKeptParse).filter(Boolean).sort((a, b) => b.at - a.at);

// Settings' status line for the engine's state: the English text t() looks up, its {names}, and `when`, the last sync's
// time, which the page writes as {time}. A failure outranks "update needed", and that outranks the last sync.
function syStatusLine(st) {
  const s = st || {};
  if (s.state === 'syncing') {
    const p = s.progress;
    return p && p.total ? { text: 'Syncing {done} of {total}…', vars: { done: p.done, total: p.total } } : { text: 'Syncing…' };
  }
  const say = {
    offline: 'Offline. Your changes go up when the network is back.',
    signedOut: 'Signed out. Connect to Google to sync.',
    off: 'Signed out. Connect to Google to sync.',
    full: 'Your Google Drive is full. Free some space there to keep syncing.',
    error: 'Sync failed. It tries again in 30 seconds.',
  };
  if (say[s.state]) return { text: say[s.state] };
  if (s.message === 'update') return { text: 'The other computer runs a newer Evermist. Update this one to sync everything.' };
  if (s.last) return { text: 'Last synced {time}', when: s.last };
  return { text: 'Not synced yet.' };
}

// Settings' "N% full" after the status: shown from 70%, amber, and red from 90%. Null below that or with no limit.
function syDriveSpace(space) {
  const s = space || {};
  if (!(s.limit > 0) || !(s.usage >= 0)) return null;
  const pct = Math.min(100, Math.floor(s.usage / s.limit * 100));
  if (pct < 70) return null;
  return { pct, level: pct >= 90 ? 'r' : 'y' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SY_FORMAT, SY_TRASH_MS, SY_SCENE_BLOBS, syRecordBody, syBlobName, syBlobNameOk, syKeyOk, syToUpload, syNewRemote,
    syBlobsToUpload, syBlobsUnreferenced, syHeld, sySceneEditedAt, syGoneWins, syGoneNote, syRestore, syGoneMerge,
    syTrashIds, syTrashDue, syPurge, syMissingScenes, syGoneClean, syGoneText, syGoneParse, syRestored, syNewestRecord,
    syPurgeFiles, syPicFilesGone, syCampaignText, syBackdropMetaText, syStatusLine, syDriveCounts, syKeptName, syKeptDue,
    syKeptParse, syKeptList, syDriveSpace,
  };
}
