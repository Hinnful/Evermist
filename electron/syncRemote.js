'use strict';
// syncRemote.js — the Drive side of sync, over Node http(s) so the rig's fake Drive and Google run the same code.
// Layout in the app's hidden `appDataFolder`: one `rec-<machine>` folder per computer for its records, one `blobs`
// folder for map files named `<owner>.<sha256>`, and one `music` folder for tracks named `<machine>.<sha256>`. A file exists only once its resumable upload finishes, so a cut
// upload never reads as present. Every name read back is checked before it is used. Tested against the fake Drive.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { readSyncConfig } = require('./syncConfig.js');
const { createAuth, tokenUrlFor } = require('./syncAuth.js');
const { hashFile } = require('./fileHash.js');
const sp = require('../src/scenes/syncPlan.js');

const GOOGLE_API = 'https://www.googleapis.com';
const FOLDER = 'application/vnd.google-apps.folder';
const CHUNK = 8 * 1024 * 1024;
const MACHINE_RE = /^[0-9a-zA-Z_-]{1,64}$/;
const NAME_TO_KEY = /^(?:(scene|pic|local)~(.+)|(backdrop|campaign|gone|music))\.json$/;

class SyncError extends Error {
  constructor(code, message) { super(message || code); this.syncCode = code; }
}

// One HTTP exchange. A refused or dropped connection is `offline`.
function request(urlStr, opts) {
  const o = opts || {};
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const body = o.body === undefined ? null : (Buffer.isBuffer(o.body) ? o.body : Buffer.from(String(o.body)));
    const headers = Object.assign({}, o.headers);
    if (body) headers['Content-Length'] = String(body.length);
    else if (o.method && o.method !== 'GET') headers['Content-Length'] = '0';
    const req = lib.request(u, { method: o.method || 'GET', headers }, res => {
      if (o.toFile) {
        const ws = fs.createWriteStream(o.toFile);
        res.pipe(ws);
        ws.on('finish', () => resolve({ status: res.statusCode, headers: res.headers, body: null }));
        ws.on('error', err => reject(new SyncError('disk', err.message)));
        res.on('error', err => { ws.destroy(); reject(new SyncError('offline', err.message)); });
        return;
      }
      const parts = [];
      res.on('data', c => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
      res.on('error', err => reject(new SyncError('offline', err.message)));
    });
    req.setTimeout(60000, () => req.destroy(new Error('timed out')));
    req.on('error', err => reject(err instanceof SyncError ? err : new SyncError('offline', err.message)));
    if (body) req.write(body);
    req.end();
  });
}

const bufSource = buf => ({ size: buf.length, read: async (a, b) => buf.subarray(a, b), close() {} });

function fileSource(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const size = fs.fstatSync(fd).size;
  return {
    size,
    read: async (a, b) => {
      const out = Buffer.alloc(b - a);
      let got = 0;
      while (got < out.length) {
        const n = fs.readSync(fd, out, got, out.length - got, a + got);
        if (!n) break;
        got += n;
      }
      return out.subarray(0, got);
    },
    close() { try { fs.closeSync(fd); } catch (_) { /* already closed */ } },
  };
}

const keyToName = key => key.replace(':', '~') + '.json';
function nameToKey(name) {
  const m = NAME_TO_KEY.exec(String(name));
  if (!m) return null;
  const key = m[3] || m[1] + ':' + m[2];
  return sp.syKeyOk(key) ? key : null;
}

const esc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// The Drive calls every operation shares. `refreshToken()` answers the refresh token or null (signed out); without a
// Google client the rig's fake serves one.
function createClient(cfg, opts) {
  const o = opts || {};
  const base = (cfg.apiBase || GOOGLE_API).replace(/\/$/, '');
  const tokenUrl = tokenUrlFor(cfg);
  const refreshToken = o.refreshToken || (() => (cfg.apiBase ? 'dev-refresh' : null));
  const retryMs = o.retryMs === undefined ? 400 : o.retryMs;
  const sessions = new Map();   // an upload cut off by a lost connection resumes here: `name|size` -> session URL
  const folders = new Map();
  let access = null;

  async function token(force) {
    if (access && !force) return access;
    const rt = refreshToken();
    if (!rt) throw new SyncError('auth', 'signed out');
    const form = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: rt, grant_type: 'refresh_token' });
    const r = await request(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    if (r.status !== 200) throw new SyncError('auth', 'the sign-in was refused (' + r.status + ')');
    access = JSON.parse(r.body.toString()).access_token;
    return access;
  }

  // A 401 refreshes the token once and repeats the call.
  async function call(method, url, copts) {
    for (let attempt = 0; ; attempt++) {
      const tok = await token(attempt > 0);
      const r = await request(url, Object.assign({}, copts, { method, headers: Object.assign({ Authorization: 'Bearer ' + tok }, copts && copts.headers) }));
      if (r.status === 401 && attempt === 0) continue;
      return r;
    }
  }

  function check(r) {
    if (r.status >= 200 && r.status < 300) return r;
    let reason = '', message = '';
    try { const e = JSON.parse(r.body.toString()).error; reason = (e.errors && e.errors[0] && e.errors[0].reason) || ''; message = e.message || ''; } catch (_) { /* no JSON body */ }
    if (r.status === 401) throw new SyncError('auth', 'the sign-in no longer works');
    if (r.status === 403 && /quota/i.test(reason)) throw new SyncError('quota', 'Drive is full');
    if (r.status === 404) throw new SyncError('notFound', message || 'not found');
    throw new SyncError(r.status >= 500 ? 'server' : 'error', (message || 'Drive answered ' + r.status));
  }

  const json = r => JSON.parse(r.body.toString() || '{}');
  const FIELDS = 'nextPageToken,files(id,name,appProperties,modifiedTime,size,mimeType)';

  // Every page of a listing, whatever size the Drive caps a page at.
  async function list(q) {
    const out = [];
    let pageToken = '';
    do {
      const url = base + '/drive/v3/files?' + new URLSearchParams({ q, spaces: 'appDataFolder', pageSize: '1000', fields: FIELDS, ...(pageToken ? { pageToken } : {}) });
      const j = json(check(await call('GET', url)));
      out.push(...(j.files || []));
      pageToken = j.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  const oldestFirst = (a, b) => (a.modifiedTime || '').localeCompare(b.modifiedTime || '') || a.id.localeCompare(b.id);

  // A folder by name, made when missing. Two computers making one at once settle on the same one: the oldest.
  async function folder(name) {
    if (folders.has(name)) return folders.get(name);
    const q = `name = '${esc(name)}' and mimeType = '${FOLDER}' and 'appDataFolder' in parents and trashed = false`;
    let found = await list(q);
    if (!found.length) {
      check(await call('POST', base + '/drive/v3/files', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: ['appDataFolder'] }) }));
      found = await list(q);
    }
    const id = found.sort(oldestFirst)[0].id;
    folders.set(name, id);
    return id;
  }

  // Where a resumable upload stands: the bytes the Drive holds, or the finished file.
  async function ask(loc, total) {
    const r = await request(loc, { method: 'PUT', headers: { 'Content-Range': 'bytes */' + total } });
    if (r.status === 200 || r.status === 201) return { done: JSON.parse(r.body.toString()) };
    if (r.status === 308) { const m = /bytes=0-(\d+)/.exec(r.headers.range || ''); return { offset: m ? parseInt(m[1], 10) + 1 : 0 }; }
    return { lost: true };
  }

  const wait = ms => new Promise(r => setTimeout(r, ms));

  async function upload(meta, src, resumeKey) {
    const total = src.size;
    let loc = sessions.get(resumeKey), offset = 0, fails = 0;
    try {
      if (loc) {
        const s = await ask(loc, total).catch(() => ({ lost: true }));
        if (s.done) { sessions.delete(resumeKey); return s.done; }
        if (s.lost) loc = null; else offset = s.offset;
      }
      if (!loc) {
        const init = check(await call('POST', base + '/upload/drive/v3/files?uploadType=resumable', {
          headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(total) }, body: JSON.stringify(meta) }));
        loc = init.headers.location;
        if (!loc) throw new SyncError('error', 'Drive gave no upload address');
        sessions.set(resumeKey, loc);
      }
      for (;;) {
        const end = Math.min(offset + CHUNK, total);
        let r;
        try {
          const chunk = await src.read(offset, end);
          r = await request(loc, { method: 'PUT', headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${total}` }, body: chunk });
        } catch (err) {
          if (!(err instanceof SyncError) || err.syncCode !== 'offline' || ++fails > 4) throw err;
          await wait(retryMs * fails);
          const s = await ask(loc, total).catch(() => null);
          if (s && s.done) { sessions.delete(resumeKey); return s.done; }
          if (s && !s.lost) offset = s.offset;
          continue;
        }
        if (r.status === 200 || r.status === 201) { sessions.delete(resumeKey); return JSON.parse(r.body.toString()); }
        if (r.status === 308) { const m = /bytes=0-(\d+)/.exec(r.headers.range || ''); offset = m ? parseInt(m[1], 10) + 1 : 0; continue; }
        sessions.delete(resumeKey);
        check(r);
        throw new SyncError('error', 'upload answered ' + r.status);
      }
    } catch (err) {
      // A refused upload (full Drive, bad answer) starts over next time; a lost connection keeps its session.
      if (!(err instanceof SyncError) || err.syncCode !== 'offline') sessions.delete(resumeKey);
      throw err;
    } finally { src.close(); }
  }

  async function remove(id) {
    const r = await call('DELETE', base + '/drive/v3/files/' + encodeURIComponent(id));
    if (r.status !== 404) check(r);
  }

  return { base, token, call, check, json, list, folder, upload, remove, oldestFirst, forget: () => { access = null; } };
}

const props = p => { const out = {}; for (const k of Object.keys(p || {})) out[k] = String(p[k]); return out; };

function createRemote(cfg, opts) {
  const { base, token, call, check, json, list, folder, upload, remove, oldestFirst, forget } = createClient(cfg, opts);
  const api = {
    forget,
    // Every computer's records and the map files, names checked. Duplicates of one record (a replacement cut between
    // creating and deleting) keep the newest and are listed for removal.
    async snapshot() {
      const roots = await list(`mimeType = '${FOLDER}' and 'appDataFolder' in parents and trashed = false`);
      const records = [], dupes = [];
      for (const f of roots) {
        if (!f.name.startsWith('rec-') || !MACHINE_RE.test(f.name.slice(4))) continue;
        const machine = f.name.slice(4), best = new Map();
        for (const r of await list(`'${f.id}' in parents and trashed = false`)) {
          const key = nameToKey(r.name);
          if (!key) continue;
          const prev = best.get(key);
          if (prev && oldestFirst(prev, r) >= 0) { dupes.push(r.id); continue; }
          if (prev) dupes.push(prev.id);
          best.set(key, r);
        }
        for (const [key, r] of best) {
          const p = r.appProperties || {};
          const blobs = [p.b1, p.b2].filter(n => sp.syBlobNameOk(n));
          records.push({ machine, key, fileId: r.id, hash: p.hash || '', format: parseInt(p.format || '0', 10), at: Number(p.at) || 0, edited: Number(p.edited) || 0, blobs });
        }
      }
      const files = async dir => {
        const out = [], id = await folder(dir);
        for (const b of await list(`'${id}' in parents and trashed = false`)) if (sp.syBlobNameOk(b.name)) out.push({ name: b.name, id: b.id, size: Number(b.size) || 0 });
        return out;
      };
      return { records, blobs: await files('blobs'), music: await files('music'), dupes };
    },

    async putRecord(machine, key, text, p) {
      if (!MACHINE_RE.test(machine) || !sp.syKeyOk(key)) throw new SyncError('error', 'a name Drive would not take');
      const parent = await folder('rec-' + machine), name = keyToName(key);
      const older = await list(`name = '${esc(name)}' and '${parent}' in parents and trashed = false`);
      const buf = Buffer.from(text);
      const f = await upload({ name, parents: [parent], mimeType: 'application/json', appProperties: props(p) }, bufSource(buf), name + '|' + buf.length);
      for (const x of older) await remove(x.id);
      return f.id;
    },

    async getText(fileId) {
      return check(await call('GET', base + '/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media')).body.toString();
    },

    // ⚠ A track goes to `music`, never `blobs`: the previous release removes any file in `blobs` its records do not name.
    async putBlob(name, src, resumeKey, dir) {
      if (!sp.syBlobNameOk(name)) { src.close(); throw new SyncError('error', 'a file name Drive would not take'); }
      const parent = await folder(dir || 'blobs');
      if ((await list(`name = '${esc(name)}' and '${parent}' in parents and trashed = false`)).length) { src.close(); return null; }
      return (await upload({ name, parents: [parent], mimeType: 'application/octet-stream' }, src, resumeKey || name)).id;
    },
    putBlobBuffer: (name, buf) => api.putBlob(name, bufSource(buf)),
    putBlobFile: (name, filePath) => api.putBlob(name, fileSource(filePath)),
    putMusicFile: (name, filePath) => api.putBlob(name, fileSource(filePath), 'music|' + name, 'music'),

    // The file's bytes, checked against the hash its name carries: a short or damaged copy is never taken.
    async getBlob(fileId, name) {
      if (!sp.syBlobNameOk(name)) throw new SyncError('error', 'a file name Drive would not take');
      const buf = check(await call('GET', base + '/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media')).body;
      if (crypto.createHash('sha256').update(buf).digest('hex') !== name.split('.')[1]) throw new SyncError('corrupt', 'the file from Drive does not match its hash');
      return buf;
    },

    async getBlobToFile(fileId, name, dest) {
      if (!sp.syBlobNameOk(name)) throw new SyncError('error', 'a file name Drive would not take');
      const tok = await token();
      const r = await request(base + '/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media', { headers: { Authorization: 'Bearer ' + tok }, toFile: dest });
      try {
        check(r);
        if (await hashFile(dest) !== name.split('.')[1]) throw new SyncError('corrupt', 'the file from Drive does not match its hash');
      } catch (err) { await fs.promises.unlink(dest).catch(() => {}); throw err; }
    },

    remove,

    async about() {
      const j = json(check(await call('GET', base + '/drive/v3/about?fields=storageQuota')));
      return { limit: Number(j.storageQuota && j.storageQuota.limit) || 0, usage: Number(j.storageQuota && j.storageQuota.usage) || 0 };
    },
  };
  return api;
}

// The rig's fake Drive has no browser to show its consent page in: a plain request follows its redirect instead.
async function visit(url) {
  const r = await request(url);
  if (r.status !== 302 || !r.headers.location) throw new SyncError('refused', 'the consent page answered ' + r.status);
  await request(new URL(r.headers.location, url).toString());
}

function machineId(userData) {
  const file = path.join(userData, 'sync', 'machine.json');
  try {
    const id = JSON.parse(fs.readFileSync(file, 'utf8')).id;
    if (MACHINE_RE.test(id)) return id;
  } catch (_) { /* first start */ }
  const id = 'm' + crypto.randomBytes(8).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ id }));
  return id;
}

function register(ctx) {
  const { ipcMain, shell, safeStorage } = require('electron');
  const cfg = readSyncConfig(ctx.userData);
  const auth = cfg ? createAuth(ctx.userData, cfg, {
    post: (url, body) => request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }),
    open: url => (cfg.apiBase ? visit(url) : shell.openExternal(url)),
    vault: {
      // Linux's basic_text store encrypts with a key every install shares, so it counts as none.
      secure: () => safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'),
      encrypt: text => safeStorage.encryptString(text),
      decrypt: buf => safeStorage.decryptString(buf),
    },
  }) : null;
  const remote = cfg ? createRemote(cfg, { refreshToken: auth.refreshToken }) : null;
  const tracks = cfg ? require('./music.js').musicHashes() : null;
  const machine = cfg ? machineId(ctx.userData) : null;
  const part = id => path.join(ctx.mapsDir, id + '.sync-part');
  const ext = e => (e === '.mp4' ? '.mp4' : '.webm');
  const safe = id => { if (!ctx.isSafeId(id)) throw new SyncError('error', 'a bad id'); return id; };
  // A map file a sync replaces is moved here first, and purged 30 days later.
  const keptDir = path.join(ctx.userData, 'sync', 'kept');
  const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
  async function purgeKept() {
    let names = [];
    try { names = await fs.promises.readdir(keptDir); } catch (_) { return; }
    for (const n of sp.syKeptDue(names, Date.now())) await fs.promises.unlink(path.join(keptDir, n)).catch(() => {});
  }
  if (cfg) purgeKept();

  const ops = {
    machine: async () => machine,
    snapshot: () => remote.snapshot(),
    putRecord: a => remote.putRecord(machine, a.key, a.text, a.props),
    getRecord: a => remote.getText(a.fileId),
    putBlob: a => remote.putBlobBuffer(a.name, Buffer.from(a.data)),
    putVideo: async a => {
      for (const e of ['.webm', '.mp4']) {
        const f = path.join(ctx.mapsDir, safe(a.sceneId) + e);
        if (fs.existsSync(f)) return remote.putBlobFile(a.name, f);
      }
      throw new SyncError('error', 'the map file is missing');
    },
    getBlob: async a => new Uint8Array(await remote.getBlob(a.fileId, a.name)),
    getVideo: async a => { await remote.getBlobToFile(a.fileId, a.name, part(safe(a.sceneId))); return true; },
    // The downloaded file takes the place of the map's own, other extension included.
    placeVideo: async a => {
      const id = safe(a.sceneId);
      for (const e of ['.webm', '.mp4']) {
        const f = path.join(ctx.mapsDir, id + e);
        if (!fs.existsSync(f)) continue;
        await fs.promises.mkdir(keptDir, { recursive: true });
        await fs.promises.rename(f, path.join(keptDir, sp.syKeptName(id, Date.now(), e.slice(1))));
      }
      await fs.promises.rename(part(id), path.join(ctx.mapsDir, id + ext(a.ext)));
      purgeKept();
      return true;
    },
    keepMap: async a => {
      const id = safe(a.sceneId);
      await fs.promises.mkdir(keptDir, { recursive: true });
      await fs.promises.writeFile(path.join(keptDir, sp.syKeptName(id, Date.now(), IMAGE_EXT[a.mime] || 'bin')), Buffer.from(a.data));
      purgeKept();
      return true;
    },
    listKept: async () => {
      let names = [];
      try { names = await fs.promises.readdir(keptDir); } catch (_) { return []; }
      return sp.syKeptList(names).map(k => ({ name: k.name, sceneId: k.sceneId, at: k.at, ext: k.ext }));
    },
    // A video swaps places with the map's own file, which is kept in turn; a picture's bytes go back to the page,
    // which keeps the current one through keepMap.
    restoreKept: async a => {
      const k = sp.syKeptParse(a.name);
      if (!k || k.name !== path.basename(k.name)) throw new SyncError('error', 'a bad kept name');
      const id = safe(k.sceneId), from = path.join(keptDir, k.name);
      if (!k.video) return new Uint8Array(await fs.promises.readFile(from));
      await fs.promises.access(from);
      for (const e of ['.webm', '.mp4']) {
        const f = path.join(ctx.mapsDir, id + e);
        if (fs.existsSync(f)) await fs.promises.rename(f, path.join(keptDir, sp.syKeptName(id, Date.now(), e.slice(1))));
      }
      await fs.promises.rename(from, path.join(ctx.mapsDir, id + '.' + k.ext));
      return true;
    },
    dropVideoPart: async a => { await fs.promises.unlink(part(safe(a.sceneId))).catch(() => {}); return true; },
    remove: a => remote.remove(a.fileId),
    about: () => remote.about(),
    // The music folder: its tracks with their hashes, hashed here only when asked (at start and as a track lands).
    musicTracks: a => tracks.list(!!a.hash),
    putMusic: async a => {
      const f = tracks.trackPath(a.name);
      if (!f || !fs.existsSync(f)) throw new SyncError('error', 'the track is missing');
      return remote.putMusicFile(machine + '.' + a.hash, f);
    },
    getMusic: async a => {
      const part = tracks.partPath(a.hash);
      if (a.fileName.split('.')[1] !== a.hash) throw new SyncError('error', 'a bad track file');
      await remote.getBlobToFile(a.fileId, a.fileName, part);
      try { return await tracks.place(part, a.name, a.hash); } catch (err) { await fs.promises.unlink(part).catch(() => {}); throw err; }
    },
    removeMusic: a => tracks.remove(a.name, a.hash),
    signedIn: async () => auth.signedIn(),
    remembered: async () => auth.remembered(),
    connect: a => auth.connect(a.lang),
    disconnect: async () => { auth.disconnect(); remote.forget(); return true; },
  };

  ipcMain.handle('sync-drive', async (_e, op, a) => {
    if (!remote || !ops[op]) return { ok: false, code: 'off', message: 'sync is not set up here' };
    try { return { ok: true, v: await ops[op](a || {}) }; } catch (err) {
      return { ok: false, code: err.syncCode || 'error', message: String(err && err.message) };
    }
  });
}

module.exports = { register, createRemote, SyncError, bufSource, keyToName, nameToKey };
