'use strict';
// syncIndex.js — what sync knows without reading the library: each record's content hash as last saved here, the hash
// last uploaded or pulled, the deletion records of maps, and the 30-day pre-merge copies.
// ⚠ ITS OWN DATABASE, `evermist-sync`: never add a store to or bump `evermist`, `evermist-gallery` or `evermist-world`,
// or the previous release fails to open them. A record is hashed when SAVED, a Blob only when its part's edit time
// moved, and `reconcile` at start catches what the previous release or a missed path changed. It does nothing unless
// sync has a Google client (syncConfig.js).

const syncIndex = (() => {
  const DB_NAME = 'evermist-sync';
  const STORES = { index: 'key', synced: 'key', pulled: 'key', gone: 'id', copies: 'key' };
  const LOCAL_KEYS = ['evermist.combat', 'evermist.combatFights', 'evermist.notesEntries', 'evermist.campaignNotes',
    'evermist.campaignNotesAt', 'evermist.moduleText'];
  // What the one `campaign` record carries: the Campaign's places, roads and party marker, and the deletion records.
  const CAMPAIGN_KEYS = ['evermist.placeNotes', 'evermist.roadNotes', 'evermist.placeShapes', 'evermist.worldRoads',
    'evermist.worldParty', 'evermist.groupUids', 'evermist.gonePlaces', 'evermist.goneRoads', 'evermist.gonePictures'];

  let _db = null;
  let _on = false;
  let _chain = Promise.resolve();
  let _listener = null;

  function _open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        for (const [name, keyPath] of Object.entries(STORES)) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function _tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }

  const get = (store, key) => _tx(store, 'readonly', s => s.get(key));
  const all = store => _tx(store, 'readonly', s => s.getAll());
  const put = (store, rec) => _tx(store, 'readwrite', s => s.put(rec));
  const del = (store, key) => _tx(store, 'readwrite', s => s.delete(key));

  async function _sha(data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : await data.arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  }

  // Writes one at a time, so two saves of one record cannot interleave their reads and writes of its entry.
  function _later(fn) {
    _chain = _chain.then(() => (_on ? fn() : null)).catch(err => console.error('[sync index]', err)).then(() => { if (_listener) _listener(); });
    return _chain;
  }

  // A scene part's Blob hash, rehashed only when its edit time moved from the one the entry holds.
  async function _partHash(prev, part, stamp, blob, sceneId) {
    if (prev && prev.parts && prev.parts[part] && prev.parts[part].stamp === stamp && (prev.parts[part].hash || part === 'fog')) return prev.parts[part];
    let hash = '';
    if (blob) hash = await _sha(blob);
    else if (part === 'map' && window.electronAPI && window.electronAPI.hashVideoFile) {
      const h = await window.electronAPI.hashVideoFile(sceneId);
      hash = h ? h.hash : '';
    }
    return { stamp, hash };
  }

  // What changes a record's stamp, as a short text: the same edit times the records carry.
  const _stampOf = rec => esCanon(rec.edits || {});

  // `body` and the stamps are read at the call, so the record may change while the hashes are made.
  function _sceneWork(rec) {
    const id = rec.id, body = syRecordBody(rec), sc = (rec.edits && rec.edits.scene) || {}, edits = _stampOf(rec);
    const mapStamp = sc.map || 0, fogStamp = sc.fog || 0, mapBlob = rec.mapType === 'video' ? null : rec.mapBlob, fogBlob = rec.baseFogBlob;
    return async () => {
      const prev = await get('index', 'scene:' + id);
      const map = await _partHash(prev, 'map', mapStamp, mapBlob, id);
      const fog = await _partHash(prev, 'fog', fogStamp, fogBlob, id);
      const hash = await _sha(body + '|' + map.hash + '|' + fog.hash);
      await put('index', { key: 'scene:' + id, hash, edits, parts: { map, fog }, blobs: map.hash ? [{ owner: id, hash: map.hash }] : [], at: Date.now() });
    };
  }

  function sceneSaved(rec) {
    if (!_on || !rec || !rec.id) return null;
    return _later(_sceneWork(rec));
  }

  // A deleted map: its entry goes, and one this computer synced before becomes a deletion record at this moment. A
  // deletion already standing (another computer's, applied here) keeps its time; a restored map's is renewed.
  function sceneDeleted(id) {
    return _later(async () => {
      await del('index', 'scene:' + id);
      const g = await get('gone', id);
      if (g && !g.purged && (g.restoredAt || 0) < g.at) return;
      if (g || await get('synced', 'scene:' + id)) await put('gone', { ...g, id, at: Date.now() });
    });
  }

  function picSaved(pic) {
    if (!_on || !pic || !pic.id) return null;
    const meta = JSON.stringify([pic.name, pic.added, pic.named || false]), blob = pic.blob, size = blob ? blob.size : 0;
    return _later(async () => {
      const prev = await get('index', 'pic:' + pic.id);
      const same = prev && prev.size === size && prev.blobHash;
      const blobHash = same ? prev.blobHash : (blob ? await _sha(blob) : '');
      await put('index', { key: 'pic:' + pic.id, hash: await _sha(meta + '|' + blobHash), size, blobHash, blobs: blobHash ? [{ owner: pic.id, hash: blobHash }] : [], at: Date.now() });
    });
  }

  function picDeleted(id) { return _later(() => del('index', 'pic:' + id)); }

  // `blob`: the image itself changed. Reads it back from the store, so no caller hands over 30 MB.
  function backdropChanged(blob) {
    if (!_on) return null;
    return _later(async () => {
      const meta = localStorage.getItem('evermist.worldBg');
      const prev = await get('index', 'backdrop');
      let blobHash = prev ? prev.blobHash : '';
      if (!meta) { await del('index', 'backdrop'); return; }
      if (blob || !prev) {
        const img = await _wbStore('readonly', s => s.get('image')).catch(() => null);
        blobHash = img ? await _sha(img) : '';
      }
      const hash = await _sha(syBackdropMetaText(meta) + '|' + blobHash);
      if (!prev || prev.hash !== hash) await put('index', { key: 'backdrop', hash, blobHash, blobs: blobHash ? [{ owner: 'backdrop', hash: blobHash }] : [], at: Date.now() });
    });
  }

  // Read when the write runs, so a burst of saves hashes once.
  let _campaignDue = false;
  function campaignChanged() {
    if (_campaignDue) return _chain;
    _campaignDue = true;
    return _later(async () => {
      _campaignDue = false;
      const text = syncCampaignText();
      if (text === null) { await del('index', 'campaign'); return; }
      const hash = await _sha(text), prev = await get('index', 'campaign');
      if (!prev || prev.hash !== hash) await put('index', { key: 'campaign', hash, at: Date.now() });
    });
  }

  function localChanged(lsKey) {
    if (!_on) return null;
    if (CAMPAIGN_KEYS.includes(lsKey)) return campaignChanged();
    return _later(async () => {
      const text = localStorage.getItem(lsKey);
      if (text === null) { await del('index', 'local:' + lsKey); return; }
      const hash = await _sha(text), prev = await get('index', 'local:' + lsKey);
      // `at` is when the text last changed here, so a start that finds it the same leaves it alone.
      if (!prev || prev.hash !== hash) await put('index', { key: 'local:' + lsKey, hash, at: Date.now() });
    });
  }

  // At start: bring the index in line with the stores, rehashing only what differs. A map synced before and gone
  // from the library is recorded as deleted at this moment.
  async function reconcile() {
    if (!_on) return;
    const have = new Set();
    await sceneStore.eachRecord(rec => {
      have.add(rec.id);
      _later(async () => {
        const prev = await get('index', 'scene:' + rec.id);
        if (!prev || prev.edits !== _stampOf(rec)) await _sceneWork(rec)();
      });
    });
    await _later(async () => {
      const synced = await all('synced'), goneNow = {};
      for (const g of await all('gone')) goneNow[g.id] = g;
      for (const e of await all('index')) if (e.key.startsWith('scene:') && !have.has(e.key.slice(6))) await del('index', e.key);
      const sm = {};
      for (const s of synced) sm[s.key] = s.hash;
      for (const id of syMissingScenes(sm, Array.from(have), goneNow)) await put('gone', { id, at: Date.now() });
    });
    const pics = await galleryStore.all();
    for (const p of pics) await picSaved(p);
    await _later(async () => {
      const ids = new Set(pics.map(p => 'pic:' + p.id));
      for (const e of await all('index')) if (e.key.startsWith('pic:') && !ids.has(e.key)) await del('index', e.key);
    });
    await backdropChanged(false);
    for (const k of LOCAL_KEYS) await localChanged(k);
    await campaignChanged();
  }

  // `_on` turns on only once the database is open, so no write can reach a null one.
  async function init() {
    let want = false;
    try { want = !!(window.electronAPI && window.electronAPI.syncAvailable && await window.electronAPI.syncAvailable()); } catch (_) { want = false; }
    if (!want) return false;
    _db = await _open();
    _on = true;
    return true;
  }

  return { init, reconcile, sceneSaved, sceneDeleted, picSaved, picDeleted, backdropChanged, localChanged,
    entries: () => all('index'), goneRecords: () => all('gone'), isOn: () => _on,
    // For sync.js: the writes finished, a callback after each change, and the stores it keeps its own marks in.
    idle: () => _chain, onChange: fn => { _listener = fn; }, sha: _sha, raw: { get, all, put, del } };
})();

// A localStorage record's writers call this after the write; it does nothing unless sync is on here.
function syncNoteLocal(lsKey) { if (syncIndex.isOn()) syncIndex.localChanged(lsKey); }

// The `campaign` record's text: the Campaign as an export's campaign.json carries it, less the campaign note and the
// factions and lore, which travel as records of their own. Null with nothing to carry.
function syncCampaignText() {
  return syCampaignText(notesCampaignPayload('', notesPlacesAll(), worldPlacesExport(), worldRoadsExport(), notesRoadsAll(), worldPartyExport(),
    undefined, mxGroupUids(), 0, { pictures: galleryGone(), places: worldPlacesGone(), roads: worldRoadsGone() }));
}
